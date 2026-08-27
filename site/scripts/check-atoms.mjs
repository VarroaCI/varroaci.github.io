#!/usr/bin/env node
// Drift control for voice rewrites. Design §6b.
//
// Rewriting normative documentation risks silently changing what the software is
// documented to do, and no prose lint detects that. This extracts a page's
// load-bearing tokens and diffs them across a rewrite, so prose can move freely while
// the tokens cannot move silently.
//
// This bounds damage; it does not prove semantic preservation. A rewrite can preserve
// every atom and still invert a negation or reorder conditions that matter. Heavy-tier
// rewrites additionally require a human read.
//
//   node scripts/check-atoms.mjs <before-file> <after-file>
//   git show HEAD:docs/x.md > /tmp/before.md && node scripts/check-atoms.mjs /tmp/before.md docs/x.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RFC2119 =
  /\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|REQUIRED|RECOMMENDED|MAY|OPTIONAL)\b/g;

/**
 * Load-bearing tokens, grouped by kind so a report says what moved.
 * Prose words are deliberately excluded: they are what the rewrite is allowed to change.
 */
export function atoms(markdown) {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");

  const code = [
    ...[...body.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map((m) => m[1].trim()),
    ...[...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()),
  ];

  const links = [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);

  // Numbers with an adjacent unit or symbol, plus bare integers of 2+ digits.
  const prose = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const numbers = [
    ...[...prose.matchAll(/\b\d+(?:\.\d+)*\s*(?:%|ms|s|m|h|d|Gi|Mi|Ki|vCPU)\b/gi)].map((m) =>
      m[0].replace(/\s+/g, ""),
    ),
    ...[...prose.matchAll(/\b\d{2,}(?:\.\d+)*\b/g)].map((m) => m[0]),
  ];

  const keywords = [...prose.matchAll(RFC2119)].map((m) => m[0]);

  return { code, links, numbers, keywords };
}

/** Multiset difference, so a token dropped twice reports twice. */
function multisetDiff(before, after) {
  const counts = new Map();
  for (const x of before) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of after) counts.set(x, (counts.get(x) ?? 0) - 1);

  const removed = [];
  const added = [];
  for (const [token, n] of counts) {
    for (let i = 0; i < n; i++) removed.push(token);
    for (let i = 0; i < -n; i++) added.push(token);
  }
  return { removed, added };
}

export function diffAtoms(beforeText, afterText) {
  const b = atoms(beforeText);
  const a = atoms(afterText);
  const report = {};
  let clean = true;

  for (const kind of Object.keys(b)) {
    const d = multisetDiff(b[kind], a[kind]);
    if (d.removed.length || d.added.length) clean = false;
    report[kind] = d;
  }
  return { clean, report };
}

function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) {
    console.error("usage: check-atoms.mjs <before-file> <after-file>");
    process.exit(2);
  }

  const { clean, report } = diffAtoms(
    readFileSync(beforePath, "utf8"),
    readFileSync(afterPath, "utf8"),
  );

  if (clean) {
    console.log(`check-atoms: ${afterPath} preserves every invariant atom`);
    return;
  }

  console.error(`check-atoms: ${afterPath} changed invariant atoms`);
  for (const [kind, { removed, added }] of Object.entries(report)) {
    for (const t of removed) console.error(`  -${kind}: ${JSON.stringify(t)}`);
    for (const t of added) console.error(`  +${kind}: ${JSON.stringify(t)}`);
  }
  console.error("Each difference must be justified, or the rewrite is rejected.");
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
