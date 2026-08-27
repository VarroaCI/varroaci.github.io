#!/usr/bin/env node
// Resolves every internal link on the hand-authored brochure pages against built output.
//
// starlight-links-validator runs with errorOnLocalLinks: false and only walks the
// Starlight content collection, so index.astro and compare.astro are unvalidated: a
// broken brochure link ships with a green build. This closes that gap.
//
// Runs as postbuild because it reads dist/, which does not exist at prebuild time.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(SITE_DIR, "dist");
const PAGES = join(SITE_DIR, "src", "pages");

/** Every route dist actually serves, normalized with a trailing slash. */
export function builtRoutes(distDir) {
  const routes = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "index.html") {
        const rel = relative(distDir, full).replace(/index\.html$/, "");
        routes.add(`/${rel}`.replace(/\/+/g, "/"));
      } else if (extname(entry) === ".html") {
        const rel = relative(distDir, full).replace(/\.html$/, "");
        routes.add(`/${rel}/`.replace(/\/+/g, "/"));
      }
    }
  };
  walk(distDir);
  return routes;
}

/** id="..." and name="..." targets on a built page, for fragment resolution. */
export function anchorsIn(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  for (const m of html.matchAll(/\bname="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

/** Internal hrefs from a source page. External, mailto, and tel links are skipped. */
/** Route a page file builds to: index.astro -> "/", compare.astro -> "/compare/". */
export function routeForPage(pageFile) {
  const name = pageFile.replace(/\.astro$/, "");
  return name === "index" ? "/" : `/${name}/`;
}

/**
 * True for an href that names a file rather than a route: the last segment has
 * an extension and it is not .html. Routes on this site are extensionless
 * directory URLs ("/compare/", "/docs/agents/overview/").
 */
export function isAssetPath(path) {
  const last = path.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return false;
  return last.slice(dot).toLowerCase() !== ".html";
}

export function internalHrefs(source) {
  const hrefs = [];
  for (const m of source.matchAll(/href=(?:"([^"]+)"|\{`([^`]+)`\}|'([^']+)')/g)) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (!raw || /^(https?:|mailto:|tel:|#\{|\$\{)/.test(raw)) continue;
    hrefs.push(raw);
  }
  return hrefs;
}

function readBuilt(route) {
  const candidates = [
    join(DIST, route, "index.html"),
    join(DIST, `${route.replace(/\/$/, "")}.html`),
  ];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  return null;
}

function main() {
  if (!existsSync(DIST)) {
    console.error("check-brochure-links: dist/ not found. Run after astro build.");
    process.exit(1);
  }

  const routes = builtRoutes(DIST);
  const pages = readdirSync(PAGES).filter((f) => extname(f) === ".astro");
  const failures = [];

  for (const page of pages) {
    // Read the BUILT page, not the .astro source. Scanning source only sees
    // literal href="..." strings, so links coming from shared components
    // (SiteHeader/SiteFooter) or expressions (href={pillar.href}) were never
    // checked and a broken one shipped green.
    const route = routeForPage(page);
    const source = readBuilt(route);
    if (source === null) {
      failures.push(`${page}: no built output at ${route}`);
      continue;
    }

    for (const href of internalHrefs(source)) {
      const [path, fragment] = href.split("#");

      // An href carrying a file extension is an asset reference, not a route:
      // <link rel="icon" href="/favicon.svg">, a linked example manifest, and
      // so on. Resolve it as a file in dist/ rather than as a page, so a
      // missing asset still fails instead of being skipped.
      if (path && isAssetPath(path)) {
        if (!existsSync(join(DIST, path))) {
          failures.push(`${page}: "${href}" -> no file at dist${path}`);
        }
        continue;
      }

      if (path) {
        const route = path.endsWith("/") ? path : `${path}/`;
        if (!routes.has(route) && !routes.has(path)) {
          failures.push(`${page}: "${href}" -> no built route ${route}`);
          continue;
        }
      }

      if (fragment) {
        const target = path || `/${page.replace(/\.astro$/, "")}/`.replace("/index/", "/");
        const html = readBuilt(target.endsWith("/") ? target : `${target}/`);
        if (!html) {
          failures.push(`${page}: "${href}" -> cannot read built page for ${target}`);
        } else if (!anchorsIn(html).has(fragment)) {
          failures.push(`${page}: "${href}" -> no #${fragment} on ${target}`);
        }
      }
    }
  }

  if (failures.length) {
    console.error("check-brochure-links: unresolved links on hand-authored pages");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`check-brochure-links: ${pages.length} pages, all internal links resolve`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
