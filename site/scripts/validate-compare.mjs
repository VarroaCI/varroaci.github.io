#!/usr/bin/env node
// site/scripts/validate-compare.mjs — validates src/data/compare.yaml and
// generates src/data/compare.generated.json for the /compare page (task
// 4.4a). Run from predev/prebuild alongside — not inside — sync-docs.mjs.
//
// This is a minimal, strict, hand-rolled parser for one constrained shape
// only: a top-level `rows:` key holding either `[]` or a YAML block
// sequence of flat string maps, each entry indented exactly
//   "  - key: value"      (first key, 2-space indent + "- ")
//   "    key: value"      (remaining keys, 4-space indent)
// No anchors, no nesting, no flow collections, no block scalars — anything
// else is a parse error. This is not a general YAML parser; it exists only
// to keep this one file simple to validate without a dependency.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SITE_ROOT = path.resolve(__dirname, "..");

const REQUIRED_KEYS = ["feature", "varroa", "cloudbees", "source", "verified"];
const ALLOWED_SOURCE_HOSTS = new Set(["docs.cloudbees.com", "www.cloudbees.com"]);

export class CompareYamlError extends Error {
  constructor(message, { line } = {}) {
    super(line !== undefined ? `${message} (line=${line})` : message);
    this.name = "CompareYamlError";
    this.line = line;
  }
}

function parseScalar(raw, lineNumber) {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[[{&*|>]/.test(trimmed)) {
    throw new CompareYamlError(
      `unsupported YAML feature — only quoted or bare scalar strings are supported: ${JSON.stringify(raw)}`,
      { line: lineNumber },
    );
  }
  return trimmed;
}

function setField(row, key, valueRaw, lineNumber) {
  if (!REQUIRED_KEYS.includes(key)) {
    throw new CompareYamlError(`unknown key "${key}" (allowed: ${REQUIRED_KEYS.join(", ")})`, { line: lineNumber });
  }
  if (Object.prototype.hasOwnProperty.call(row, key)) {
    throw new CompareYamlError(`duplicate key "${key}" in one row`, { line: lineNumber });
  }
  row[key] = parseScalar(valueRaw, lineNumber);
}

// Parses the whole-file text into an array of plain {feature, varroa,
// cloudbees, source, verified} objects (fields present only if the source
// set them — callers validate completeness separately). Full-line
// comments (first non-whitespace char '#') and blank lines are skipped
// wherever they appear.
export function parseCompareYaml(text) {
  const rawLines = text.split(/\r?\n/);
  const meaningful = [];
  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    meaningful.push({ raw: rawLines[i], lineNumber: i + 1 });
  }

  if (meaningful.length === 0) {
    throw new CompareYamlError("no top-level `rows:` key found (file is empty or all-comment)");
  }

  const first = meaningful[0];
  const rowsMatch = first.raw.match(/^rows:\s*(\[\s*\])?\s*$/);
  if (!rowsMatch) {
    throw new CompareYamlError(
      "expected the first non-comment, non-blank line to be exactly `rows:` or `rows: []`",
      { line: first.lineNumber },
    );
  }
  if (rowsMatch[1]) {
    if (meaningful.length > 1) {
      throw new CompareYamlError("unexpected content after `rows: []`", { line: meaningful[1].lineNumber });
    }
    return [];
  }

  const rows = [];
  let current = null;
  for (const { raw, lineNumber } of meaningful.slice(1)) {
    const listItem = raw.match(/^ {2}- ([a-zA-Z]+):[ \t]*(.*)$/);
    const cont = raw.match(/^ {4}([a-zA-Z]+):[ \t]*(.*)$/);
    if (listItem) {
      if (current) rows.push(current);
      current = { __line: lineNumber };
      setField(current, listItem[1], listItem[2], lineNumber);
    } else if (cont && current) {
      setField(current, cont[1], cont[2], lineNumber);
    } else {
      throw new CompareYamlError(
        "unrecognized line under `rows:` — expected `  - key: value` (2-space) or `    key: value` (4-space); no anchors, no nesting",
        { line: lineNumber },
      );
    }
  }
  if (current) rows.push(current);
  return rows;
}

function isValidIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// Mechanical validation only: shape and format. Whether a claim about
// CloudBees is actually still true is a human fact-check (task 6.2), not
// checked here. Returns an array of "row <label>: <problem>" strings — one
// row can produce more than one — so a single run reports every problem,
// each naming its row.
export function validateRows(rows) {
  const errors = [];
  rows.forEach((row, idx) => {
    const label = typeof row.feature === "string" && row.feature.trim() !== "" ? row.feature : `#${idx + 1}`;
    for (const key of REQUIRED_KEYS) {
      if (typeof row[key] !== "string" || row[key].trim() === "") {
        errors.push(`row "${label}": missing or empty key "${key}"`);
      }
    }
    if (typeof row.source === "string" && row.source.trim() !== "") {
      let host = null;
      try {
        host = new URL(row.source).hostname;
      } catch {
        errors.push(`row "${label}": source "${row.source}" is not a valid URL`);
      }
      if (host && !ALLOWED_SOURCE_HOSTS.has(host)) {
        errors.push(
          `row "${label}": source host "${host}" is not allowed (must be one of ${[...ALLOWED_SOURCE_HOSTS].join(", ")})`,
        );
      }
    }
    if (typeof row.verified === "string" && row.verified.trim() !== "" && !isValidIsoDate(row.verified)) {
      errors.push(`row "${label}": verified "${row.verified}" is not a valid ISO date (YYYY-MM-DD)`);
    }
  });
  return errors;
}

export function run({
  yamlPath = path.join(SITE_ROOT, "src", "data", "compare.yaml"),
  outPath = path.join(SITE_ROOT, "src", "data", "compare.generated.json"),
} = {}) {
  const text = readFileSync(yamlPath, "utf8");
  const rows = parseCompareYaml(text);
  const errors = validateRows(rows);
  if (errors.length > 0) {
    throw new CompareYamlError(`compare.yaml failed validation:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  const clean = rows.map(({ feature, varroa, cloudbees, source, verified }) => ({
    feature,
    varroa,
    cloudbees,
    source,
    verified,
  }));
  writeFileSync(outPath, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  return { rowCount: clean.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { rowCount } = run();
    console.log(`validate-compare: ${rowCount} row(s) valid, compare.generated.json written.`);
  } catch (err) {
    console.error(`validate-compare: ${err.message}`);
    process.exit(1);
  }
}
