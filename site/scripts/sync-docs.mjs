#!/usr/bin/env node
// site/scripts/sync-docs.mjs — regenerates the two git-ignored output trees
// (site/src/content/docs/docs/** and site/public/docs-examples/**) from
// ../docs/ at build time. See the header comments below
// §2 for the full contract. Never hand-edit the output trees; edit
// ../docs/ instead and re-run (via `predev`/`prebuild`).
//
// Usage: node scripts/sync-docs.mjs   (run with cwd = site/)

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SITE_ROOT = path.resolve(__dirname, "..");
export const REPO_ROOT = path.resolve(SITE_ROOT, "..");
export const SITE_REPO_URL = "https://github.com/VarroaCI/varroaci.github.io";

const EXCLUDED_TOP_LEVEL_DIRS = new Set(["internal", "superpowers"]);
const EXCLUDED_TOP_LEVEL_FILES = new Set(["AGENTS.md"]);
const EXAMPLES_REL = "install/examples"; // relative to docs/, posix

// ---------------------------------------------------------------------------
// Error types — carry file/line/destination so build failures name exactly
// what to fix (design §2, tasks 2.3/2.4 acceptance).
// ---------------------------------------------------------------------------
export class SyncDocsError extends Error {
  constructor(message, { file, line, destination } = {}) {
    const parts = [message];
    if (file) parts.push(`file=${file}`);
    if (line !== undefined) parts.push(`line=${line}`);
    if (destination !== undefined) parts.push(`destination=${JSON.stringify(destination)}`);
    super(parts.join(" "));
    this.name = "SyncDocsError";
    this.file = file;
    this.line = line;
    this.destination = destination;
  }
}

// ---------------------------------------------------------------------------
// EXTRA_MANIFEST_PATHS — read from site/extra-manifest-paths.txt, which both
// this script and hack/export-site.sh consume, so the two stay in lockstep.
//
// This used to parse the assignment out of hack/export-site.sh. That kept the
// two in lockstep inside this repo but broke the exported one, which ships
// site/ and docs/ without hack/: the site repo's first `npm run build` failed
// with ENOENT on a path that cannot exist there. The manifest lives under
// site/ so it travels with the code that reads it.
// ---------------------------------------------------------------------------
export function parseExtraManifestPaths(
  manifestPath = path.join(SITE_ROOT, "extra-manifest-paths.txt"),
) {
  const text = readFileSync(manifestPath, "utf8");
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Traversal — walk docsRoot, returning posix relative paths (from docsRoot)
// of every *.md file to stage, skipping internal/, superpowers/,
// install/examples/ (copied verbatim separately), and the top-level
// AGENTS.md.
// ---------------------------------------------------------------------------
export function collectMarkdownFiles(docsRoot) {
  const out = [];
  function walk(dir, relParts) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relParts2 = [...relParts, entry.name];
      const relPosix = relParts2.join("/");
      if (entry.isDirectory()) {
        if (relParts.length === 0 && EXCLUDED_TOP_LEVEL_DIRS.has(entry.name)) continue;
        if (relPosix === EXAMPLES_REL) continue;
        walk(path.join(dir, entry.name), relParts2);
      } else if (entry.isFile()) {
        if (relParts.length === 0 && EXCLUDED_TOP_LEVEL_FILES.has(entry.name)) continue;
        if (entry.name.endsWith(".md")) out.push(relPosix);
      }
    }
  }
  walk(docsRoot, []);
  return out;
}

// ---------------------------------------------------------------------------
// H1 parsing — the first non-blank line must be `# Title`. Returns
// { title, body } with the H1 line (and one following blank line, if any)
// removed. Throws SyncDocsError naming file+line when missing.
// ---------------------------------------------------------------------------
export function parseAndStripH1(content, filePath) {
  const lines = content.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const firstLine = lines[i];
  const m = firstLine !== undefined ? firstLine.match(/^#\s+(.+?)\s*$/) : null;
  if (!m) {
    throw new SyncDocsError("missing leading # H1", { file: filePath, line: i + 1 });
  }
  const title = m[1];
  let bodyStartIndex = i + 1; // 0-indexed into `lines`
  if (lines[bodyStartIndex] !== undefined && lines[bodyStartIndex].trim() === "") bodyStartIndex++;
  const body = lines.slice(bodyStartIndex).join("\n");
  // bodyStartLine: 1-indexed line number, in the *original* file, of body's
  // first line — callers use it to translate a within-body offset back to
  // an original-file line number for error messages.
  return { title, body, bodyStartLine: bodyStartIndex + 1 };
}

// ---------------------------------------------------------------------------
// Link rewriting
// ---------------------------------------------------------------------------
function splitDestination(raw) {
  let rest = raw;
  let fragment = "";
  const hashIdx = rest.indexOf("#");
  if (hashIdx !== -1) {
    fragment = rest.slice(hashIdx + 1);
    rest = rest.slice(0, hashIdx);
  }
  let query = "";
  const qIdx = rest.indexOf("?");
  if (qIdx !== -1) {
    query = rest.slice(qIdx + 1);
    rest = rest.slice(0, qIdx);
  }
  return { base: rest, query, fragment };
}

function isAbsoluteOrAnchor(raw) {
  if (raw.startsWith("#")) return true;
  if (raw.startsWith("//")) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return true; // scheme: http:, https:, mailto:, ...
  return false;
}

export function rewriteDestination(raw, ctx) {
  const { fileAbsPath, docsRoot, repoRoot, extraManifestPaths, siteRepo, lineNumber } = ctx;
  if (isAbsoluteOrAnchor(raw)) return raw;

  const { base, query, fragment } = splitDestination(raw);
  const suffix = (query ? `?${query}` : "") + (fragment ? `#${fragment}` : "");
  if (base === "") return raw; // e.g. bare "#frag" already handled above; empty base otherwise = within-page

  const fileDir = path.dirname(fileAbsPath);
  const targetAbs = path.resolve(fileDir, base);

  if (!existsSync(targetAbs)) {
    throw new SyncDocsError("unresolved relative link target (no such file or directory)", {
      file: fileAbsPath,
      line: lineNumber,
      destination: raw,
    });
  }
  const isDir = statSync(targetAbs).isDirectory();
  const repoRel = toPosix(path.relative(repoRoot, targetAbs));
  const docsRel = toPosix(path.relative(docsRoot, targetAbs));

  const isExcluded =
    docsRel === "AGENTS.md" ||
    docsRel === "internal" ||
    docsRel.startsWith("internal/") ||
    docsRel === "superpowers" ||
    docsRel.startsWith("superpowers/");
  const isEscaping = docsRel === ".." || docsRel.startsWith("../");

  if (isEscaping || isExcluded) {
    if (!extraManifestPaths.includes(repoRel)) {
      throw new SyncDocsError(
        `escaping or excluded link target is not listed in site/extra-manifest-paths.txt`,
        { file: fileAbsPath, line: lineNumber, destination: raw },
      );
    }
    return `${siteRepo}/blob/main/${repoRel}${suffix}`;
  }

  const isExample = docsRel === EXAMPLES_REL || docsRel.startsWith(`${EXAMPLES_REL}/`);
  if (isExample) {
    const exampleRel = docsRel === EXAMPLES_REL ? "" : docsRel.slice(EXAMPLES_REL.length + 1);
    if (isDir) {
      return `${siteRepo}/tree/main/docs/install/examples/${exampleRel}${suffix}`;
    }
    return `/docs-examples/${exampleRel}${suffix}`;
  }

  if (isDir) {
    const route = docsRel === "" ? "/docs/" : `/docs/${docsRel}/`;
    return `${route}${suffix}`;
  }

  if (!docsRel.endsWith(".md")) {
    throw new SyncDocsError(
      "docs/ link target is not a markdown page and not under install/examples/",
      { file: fileAbsPath, line: lineNumber, destination: raw },
    );
  }

  const basename = path.posix.basename(docsRel);
  let route;
  if (basename === "README.md") {
    const dir = path.posix.dirname(docsRel);
    route = dir === "." ? "/docs/" : `/docs/${dir}/`;
  } else {
    route = `/docs/${docsRel.slice(0, -3)}/`;
  }
  return `${route}${suffix}`;
}

// Link text/destinations can span multiple source lines (these docs are
// hand-wrapped prose), so matching happens over the whole body rather than
// line-by-line. Fenced code blocks and inline code spans are masked first —
// replaced with same-length, newline-preserving space filler — so link
// syntax inside them is never matched; matches are then located by
// character offset in that masked text, which is otherwise byte-identical
// to the original body outside masked spans, so offsets apply directly to
// the unmasked body for splicing.
const FENCE_BLOCK_RE = /^([ \t]{0,3})(```+|~~~+)[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const INLINE_LINK_RE = /\[(?:[^[\]]|\[[^[\]]*\])*\]\((?<dest>[^)\s]+)(?:\s+[^)]*)?\)/gd;
const REF_DEF_RE = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(?<dest>\S+)/gmd;

function maskSpans(text, regex) {
  return text.replace(regex, (m) => m.replace(/[^\n]/g, " "));
}

function lineNumberAt(body, index) {
  let n = 1;
  for (let i = 0; i < index; i++) {
    if (body[i] === "\n") n++;
  }
  return n;
}

function findDestMatches(maskedForScan, regex) {
  const matches = [];
  for (const m of maskedForScan.matchAll(regex)) {
    const [start, end] = m.indices.groups.dest;
    matches.push({ start, end, url: m.groups.dest });
  }
  return matches;
}

export function rewriteLinksInMarkdown(body, ctx) {
  let maskedForScan = maskSpans(body, FENCE_BLOCK_RE);
  maskedForScan = maskSpans(maskedForScan, INLINE_CODE_RE);

  const matches = [
    ...findDestMatches(maskedForScan, INLINE_LINK_RE),
    ...findDestMatches(maskedForScan, REF_DEF_RE),
  ].sort((a, b) => a.start - b.start);

  const lineOffset = ctx.lineOffset ?? 0; // lines already stripped before `body` (e.g. the H1)
  let out = "";
  let cursor = 0;
  for (const { start, end, url } of matches) {
    if (start < cursor) continue; // overlapping match (shouldn't happen); skip defensively
    const lineNumber = lineOffset + lineNumberAt(body, start);
    const newUrl = rewriteDestination(url, { ...ctx, lineNumber });
    out += body.slice(cursor, start) + newUrl;
    cursor = end;
  }
  out += body.slice(cursor);
  return out;
}

// ---------------------------------------------------------------------------
// NAV — sidebar label and position per page.
//
// Starlight's autogenerated sidebar sorts alphabetically by title, which is
// meaningless as a reading order: it opened Install on "Air-gapped" and buried
// "Prerequisites" at the bottom. Declaring order here fixes the sequence and
// keeps it stable when a page is retitled.
//
// `label` is the sidebar text only. Page H1s stay long and descriptive; the
// nav gets the short form, so "Jenkins RBAC (data-plane roles)" reads as
// "Jenkins RBAC" in the tree without touching the page itself. Omit `label`
// to use the H1 verbatim.
//
// Keys are paths relative to docs/, posix-style. Every synced page must appear
// here — checkNavCoverage() fails the build on a page that is missing or on a
// stale entry left behind by a rename.
// ---------------------------------------------------------------------------
export const NAV = {
  // Top-level pages sit outside any group.
  "README.md": { order: 1 },

  "architecture/overview.md": { label: "Overview", order: 1 },
  "architecture/mite.md": { label: "The mite", order: 2 },
  "architecture/scaling.md": { label: "Scaling", order: 3 },

  "install/prerequisites.md": { label: "Prerequisites", order: 1 },
  "install/helm-install.md": { label: "Helm", order: 2 },
  "install/ingress.md": { label: "Ingress", order: 3 },
  "install/multi-cluster.md": { label: "Multi-cluster", order: 4 },
  "install/aws-eks.md": { label: "Amazon EKS", order: 5 },
  "install/air-gapped.md": { label: "Air-gapped", order: 6 },
  "install/network-policies.md": { label: "Network policies", order: 7 },

  "tutorials/first-controller.md": { label: "Your first controller", order: 1 },
  "tutorials/custom-bundle.md": { label: "Authoring a bundle", order: 2 },

  "config/composed-bundles.md": { label: "Composed bundles", order: 1 },
  "config/casc-catalog.md": { label: "CasC catalog", order: 2 },
  "config/bundle-sources.md": { label: "Bundle sources", order: 3 },
  "config/items.md": { label: "Jobs & items", order: 4 },
  "config/controller-classes.md": { label: "Controller classes", order: 5 },
  "config/jenkins-versions.md": { label: "Jenkins versions", order: 6 },
  "config/plugin-pinning.md": { label: "Plugin pinning", order: 7 },
  "config/plugin-packs.md": { label: "Plugin packs", order: 8 },
  "config/pod-customization.md": { label: "Pod customization", order: 9 },

  "security/authentication.md": { label: "Authentication", order: 1 },
  "security/varroa-rbac.md": { label: "Varroa RBAC", order: 2 },
  "security/jenkins-rbac.md": { label: "Jenkins RBAC", order: 3 },
  "security/api-keys.md": { label: "API keys", order: 4 },
  "security/execute-groovy.md": { label: "executeGroovy", order: 5 },

  "agents/overview.md": { label: "Overview", order: 1 },
  "agents/connecting.md": { label: "Connecting a client", order: 2 },
  "agents/tools.md": { label: "Tool reference", order: 3 },
  "agents/writing.md": { label: "Writing through MCP", order: 4 },
  "agents/identity.md": { label: "Identity & auditing", order: 5 },
  "agents/jenkins-tools.md": { label: "Jenkins controller tools", order: 6 },

  "operations/reconciliation.md": { label: "Reconciliation", order: 1 },
  "operations/lifecycle.md": { label: "Lifecycle", order: 2 },
  "operations/multi-tenancy.md": { label: "Multi-tenancy", order: 3 },
  "operations/brood-operations.md": { label: "Brood operations", order: 4 },
  "operations/brood-schedules.md": { label: "Brood schedules", order: 5 },
  "operations/rollout-waves.md": { label: "Rollout waves", order: 6 },
  "operations/update-center.md": { label: "Update center", order: 7 },
  "operations/jenkins-upgrades.md": { label: "Jenkins upgrades", order: 8 },
  "operations/observability.md": { label: "Observability", order: 9 },
  "operations/troubleshooting.md": { label: "Troubleshooting", order: 10 },

  // "API & CLI" is an explicit-link group in astro.config.mjs, so these two
  // need an entry for coverage but their label/order are not consumed.
  "api-reference.md": { label: "API reference" },
  "varroactl.md": { label: "varroactl CLI" },
};

/**
 * Fails on any drift between the synced page set and NAV: a new page with no
 * entry would silently sort to the bottom, and an entry left behind by a
 * rename would silently do nothing. Both are build errors.
 */
export function checkNavCoverage(relPaths, nav = NAV) {
  const present = new Set(relPaths);
  const missing = relPaths.filter((rel) => !nav[rel]).sort();
  const stale = Object.keys(nav).filter((rel) => !present.has(rel)).sort();

  if (missing.length || stale.length) {
    const parts = [];
    if (missing.length) parts.push(`pages with no NAV entry: ${missing.join(", ")}`);
    if (stale.length) parts.push(`NAV entries with no page: ${stale.join(", ")}`);
    throw new SyncDocsError(`NAV is out of sync with docs/ (${parts.join("; ")})`);
  }
}

// ---------------------------------------------------------------------------
// Per-file transform: read -> parse/strip H1 -> rewrite links -> frontmatter.
// ---------------------------------------------------------------------------
export function transformDocFile(relPosixFromDocsRoot, opts) {
  const { docsRoot, repoRoot, siteRepo, extraManifestPaths, nav = NAV } = opts;
  const fileAbsPath = path.join(docsRoot, ...relPosixFromDocsRoot.split("/"));
  const raw = readFileSync(fileAbsPath, "utf8");
  const { title, body, bodyStartLine } = parseAndStripH1(raw, fileAbsPath);
  const rewrittenBody = rewriteLinksInMarkdown(body, {
    fileAbsPath,
    docsRoot,
    repoRoot,
    siteRepo,
    extraManifestPaths,
    lineOffset: bodyStartLine - 1,
  });
  const editUrl = `${siteRepo}/edit/main/docs/${relPosixFromDocsRoot}`;

  // sidebar.order fixes the position; sidebar.label shortens the nav text
  // without shortening the page's own H1. See NAV above.
  const entry = nav[relPosixFromDocsRoot];
  let sidebarBlock = "";
  if (entry) {
    const lines = ["sidebar:"];
    if (entry.label) lines.push(`  label: ${JSON.stringify(entry.label)}`);
    if (entry.order !== undefined) lines.push(`  order: ${entry.order}`);
    if (lines.length > 1) sidebarBlock = `${lines.join("\n")}\n`;
  }

  const frontmatter =
    `---\ntitle: ${JSON.stringify(title)}\neditUrl: ${JSON.stringify(editUrl)}\n${sidebarBlock}---\n`;
  const outContent = `${frontmatter}\n${rewrittenBody.replace(/^\n+/, "")}`;

  const isReadme = path.posix.basename(relPosixFromDocsRoot) === "README.md";
  const dir = path.posix.dirname(relPosixFromDocsRoot);
  let outRelPosix;
  if (isReadme) {
    outRelPosix = dir === "." ? "index.md" : `${dir}/index.md`;
  } else {
    outRelPosix = relPosixFromDocsRoot;
  }
  return { outRelPosix, outContent };
}

// ---------------------------------------------------------------------------
// Top-level run
// ---------------------------------------------------------------------------
export function run({
  docsRoot = path.join(REPO_ROOT, "docs"),
  outDocsDir = path.join(SITE_ROOT, "src", "content", "docs", "docs"),
  outExamplesDir = path.join(SITE_ROOT, "public", "docs-examples"),
  siteRepo = SITE_REPO_URL,
  extraManifestPaths = parseExtraManifestPaths(),
  nav = NAV,
} = {}) {
  const repoRoot = path.resolve(docsRoot, "..");

  // Clean both output trees.
  rmSync(outDocsDir, { recursive: true, force: true });
  rmSync(outExamplesDir, { recursive: true, force: true });
  mkdirSync(outDocsDir, { recursive: true });
  mkdirSync(outExamplesDir, { recursive: true });

  // Copy install/examples/** verbatim.
  const examplesSrc = path.join(docsRoot, ...EXAMPLES_REL.split("/"));
  if (existsSync(examplesSrc)) {
    cpSync(examplesSrc, outExamplesDir, { recursive: true });
  }

  // Stage + transform markdown files.
  const files = collectMarkdownFiles(docsRoot);
  checkNavCoverage(files, nav);
  for (const relPosix of files) {
    const { outRelPosix, outContent } = transformDocFile(relPosix, {
      docsRoot,
      repoRoot,
      siteRepo,
      extraManifestPaths,
      nav,
    });
    const outAbs = path.join(outDocsDir, ...outRelPosix.split("/"));
    mkdirSync(path.dirname(outAbs), { recursive: true });
    writeFileSync(outAbs, outContent, "utf8");
  }

  return { fileCount: files.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { fileCount } = run();
    console.log(`sync-docs: staged ${fileCount} page(s).`);
  } catch (err) {
    console.error(`sync-docs: ${err.message}`);
    process.exit(1);
  }
}
