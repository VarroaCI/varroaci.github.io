import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  anchorsIn,
  builtRoutes,
  internalHrefs,
  isAssetPath,
  routeForPage,
} from "./check-brochure-links.mjs";

test("builtRoutes maps index.html to a directory route", () => {
  const dist = mkdtempSync(join(tmpdir(), "dist-"));
  mkdirSync(join(dist, "docs", "install"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<html></html>");
  writeFileSync(join(dist, "docs", "install", "index.html"), "<html></html>");
  writeFileSync(join(dist, "404.html"), "<html></html>");

  const routes = builtRoutes(dist);
  assert.ok(routes.has("/"), "root route");
  assert.ok(routes.has("/docs/install/"), "nested route");
  assert.ok(routes.has("/404/"), "bare .html becomes a route");
});

test("internalHrefs collects site-relative links and skips external ones", () => {
  const src = [
    '<a href="/docs/install/">Get started</a>',
    '<a href="https://github.com/VarroaCI/varroaci.github.io">GitHub</a>',
    '<a href="mailto:x@example.com">Mail</a>',
    '<a href="/compare/#migration">Compare</a>',
  ].join("\n");

  const hrefs = internalHrefs(src);
  assert.deepEqual(hrefs, ["/docs/install/", "/compare/#migration"]);
});

test("internalHrefs skips template-interpolated hrefs", () => {
  const src = "<a href={`${base}/x/`}>x</a>";
  assert.deepEqual(internalHrefs(src), []);
});

test("anchorsIn finds id and name targets", () => {
  const html = '<h2 id="measured-at-scale">M</h2><a name="legacy"></a>';
  const anchors = anchorsIn(html);
  assert.ok(anchors.has("measured-at-scale"));
  assert.ok(anchors.has("legacy"));
  assert.ok(!anchors.has("absent"));
});

test("isAssetPath distinguishes asset files from extensionless routes", () => {
  assert.equal(isAssetPath("/favicon.svg"), true);
  assert.equal(isAssetPath("/docs-examples/controller-class.yaml"), true);
  assert.equal(isAssetPath("/compare/"), false);
  assert.equal(isAssetPath("/docs/agents/overview/"), false);
  // .html resolves as a route, not an asset.
  assert.equal(isAssetPath("/compare/index.html"), false);
  // A dotted directory name must not read as an extension.
  assert.equal(isAssetPath("/docs/v1.2/guide/"), false);
});

test("routeForPage maps page files to their built routes", () => {
  assert.equal(routeForPage("index.astro"), "/");
  assert.equal(routeForPage("compare.astro"), "/compare/");
});
