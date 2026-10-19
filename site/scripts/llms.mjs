// Builds /llms.txt from the handbook pages. Each page line names the page and
// gives one sentence from its first prose paragraph. The order follows the
// sidebar groups in DOCS_GROUPS, so llms.txt and the sidebar cannot drift.

const NON_PROSE = /^(```|~~~|\||[-*+]\s|\d+\.\s|#|<!--|>|:::)/;
const FENCE = /^(```|~~~)/;
const SUMMARY_LIMIT = 200;
const SITE_TAGLINE =
  "Kubernetes-native Jenkins: pipelines on a stateless engine, classic controllers, and agents that act as an identity.";

/** The first prose sentence of a page body, or the title when none exists. */
export function summaryOf(body, title) {
  const lines = String(body ?? "").split("\n");
  if (lines.length && /^#\s/.test(lines[0])) lines.shift();

  const paragraphs = [];
  let current = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line.trimStart())) {
      inFence = !inFence;
      if (current.length) paragraphs.push(current);
      current = [];
      continue;
    }
    if (inFence) continue;
    if (line.trim() === "") {
      if (current.length) paragraphs.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(current);

  const prose = paragraphs.find((p) => !NON_PROSE.test(p[0].trimStart()));
  if (!prose) return title;

  const text = prose
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = text.match(/^(.+?[.!?])(?=\s|$)/);
  const first = sentence ? sentence[1] : text;
  if (first.length > SUMMARY_LIMIT) {
    return first.slice(0, SUMMARY_LIMIT - 1).trimEnd() + "…";
  }
  return first;
}

/** The public URL of a handbook page, from its path under docs/. */
export function pageUrl(relPath, site) {
  if (relPath === "README.md") return `${site}/docs/`;
  return `${site}/docs/${relPath.replace(/\.md$/, "")}/`;
}

/**
 * Builds the llms.txt body. Throws when a page sits in no group, or when a
 * links group names a page that is missing.
 */
export function buildLlms({ pages, groups, nav, site, agentsPage }) {
  const byPath = new Map(pages.map((p) => [p.relPath, p]));
  const link = (p) => `- [${p.title}](${pageUrl(p.relPath, site)}): ${summaryOf(p.body, p.title)}`;
  const placed = new Set(["README.md"]);

  const lines = ["# Varroa", "", `> ${SITE_TAGLINE}`, "", "## Start", ""];
  const readme = byPath.get("README.md");
  if (readme) lines.push(link(readme));
  lines.push(`- [${agentsPage.title}](${site}/agents/): ${agentsPage.description}`);

  for (const group of groups) {
    lines.push("", `## ${group.label}`, "");
    if (group.directory) {
      const prefix = `${group.directory}/`;
      const members = pages
        .filter((p) => p.relPath.startsWith(prefix))
        .sort((a, b) => {
          const d = (nav[a.relPath]?.order ?? Infinity) - (nav[b.relPath]?.order ?? Infinity);
          return d !== 0 ? d : a.relPath.localeCompare(b.relPath);
        });
      for (const p of members) {
        placed.add(p.relPath);
        lines.push(link(p));
      }
    } else {
      for (const l of group.links) {
        const p = byPath.get(l.page);
        if (!p) throw new Error(`llms: ${l.page} is listed in "${group.label}" but is missing`);
        placed.add(l.page);
        lines.push(link(p));
      }
    }
  }

  for (const p of pages) {
    if (!placed.has(p.relPath)) throw new Error(`llms: ${p.relPath} sits in no sidebar group`);
  }
  return lines.join("\n") + "\n";
}
