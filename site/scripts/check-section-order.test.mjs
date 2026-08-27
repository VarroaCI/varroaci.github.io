import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPECTED_ORDER,
  scaleFigures,
  sectionOrder,
  visibleText,
} from "./check-section-order.mjs";

const page = (classes) =>
  classes.map((c) => `<section class="varroa-shell ${c}"><h2>x</h2></section>`).join("");

test("sectionOrder reports landmark sections in document order", () => {
  assert.deepEqual(sectionOrder(page(EXPECTED_ORDER)), EXPECTED_ORDER);
});

test("a showcase demoted below the pillar grid is detected", () => {
  const demoted = ["varroa-hero", "varroa-pillars", "varroa-mcp", "varroa-teaser"];
  assert.notDeepEqual(sectionOrder(page(demoted)), EXPECTED_ORDER);
});

test("unrelated sections are ignored", () => {
  const html = page(["varroa-hero", "varroa-mcp"]) + '<section class="varroa-other"></section>';
  assert.deepEqual(sectionOrder(html), ["varroa-hero", "varroa-mcp"]);
});

test("scaleFigures catches ratio, percentage, percentile, and mean-latency shapes", () => {
  assert.deepEqual(scaleFigures("394/400 controllers"), ["394/400"]);
  assert.deepEqual(scaleFigures("reached 99% convergence"), ["99%"]);
  assert.deepEqual(scaleFigures("15s p95 across cohorts"), ["p95"]);
  assert.deepEqual(scaleFigures("~10s mean install"), ["~10s mean"]);
});

test("scaleFigures does not fire on version strings or ordinary copy", () => {
  assert.deepEqual(scaleFigures('version: "2.516.3"'), []);
  assert.deepEqual(scaleFigures("Run a job and read the result."), []);
  assert.deepEqual(scaleFigures("Build #1 queued, then SUCCESS"), []);
});

test("visibleText strips markup, scripts, and styles", () => {
  const html = '<style>.a{content:"99%"}</style><script>var x="1/2"</script><p>Hello</p>';
  const text = visibleText(html);
  assert.ok(text.includes("Hello"));
  assert.deepEqual(scaleFigures(text), [], "figures inside script/style are not copy");
});
