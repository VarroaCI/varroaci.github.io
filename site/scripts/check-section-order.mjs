#!/usr/bin/env node
// Enforces the brochure section order from design.md §4 against built output.
//
// The order is load-bearing: the MCP showcase sits directly under the hero because
// burying it below the pillar grid was the defect this check exists to prevent. A
// comment in index.astro cannot enforce that, so this reads dist/.
//
// Also asserts the brochure carries no scale figures (design §6).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

/** Landmark sections on `/`, in the order design §4 requires. */
export const EXPECTED_ORDER = [
  "varroa-hero",
  "varroa-mcp",
  "varroa-pillars",
  "varroa-teaser",
];

/** Section class names in the order they appear in the document. */
export function sectionOrder(html) {
  const seen = [];
  for (const m of html.matchAll(/<section[^>]*\bclass="([^"]*)"/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (EXPECTED_ORDER.includes(cls) && !seen.includes(cls)) seen.push(cls);
    }
  }
  return seen;
}

/**
 * Scale-figure shapes that must not appear in brochure copy: "394/400", "99%",
 * "15s p95", "~10s mean". Deliberately narrow, so ordinary copy and version strings
 * such as "2.516.3" do not trip it.
 */
export function scaleFigures(text) {
  const patterns = [
    /\b\d{2,4}\s*\/\s*\d{2,4}\b/g, // 394/400
    /\b\d{1,3}(?:\.\d+)?%/g, // 99%
    /\bp9[059]\b/gi, // p95
    /~?\s*\d+(?:\.\d+)?\s*(?:ms|s)\s+(?:mean|median|avg|average)\b/gi,
  ];
  return patterns.flatMap((re) => [...text.matchAll(re)].map((m) => m[0].trim()));
}

/** Visible text only. Markup attributes and inline script/style are not copy. */
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

function main() {
  const indexPath = join(DIST, "index.html");
  if (!existsSync(indexPath)) {
    console.error("check-section-order: dist/index.html not found. Run after astro build.");
    process.exit(1);
  }

  const failures = [];
  const html = readFileSync(indexPath, "utf8");

  const order = sectionOrder(html);
  if (order.join(",") !== EXPECTED_ORDER.join(",")) {
    failures.push(
      `section order is [${order.join(", ")}], expected [${EXPECTED_ORDER.join(", ")}]`,
    );
  }

  for (const page of ["index.html", join("compare", "index.html")]) {
    const full = join(DIST, page);
    if (!existsSync(full)) continue;
    const figures = scaleFigures(visibleText(readFileSync(full, "utf8")));
    if (figures.length) {
      failures.push(
        `${page} carries scale figures the brochure must not present: ${[...new Set(figures)].join(", ")}`,
      );
    }
  }

  if (failures.length) {
    console.error("check-section-order:");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    `check-section-order: order ${EXPECTED_ORDER.join(" -> ")}, no scale figures`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
