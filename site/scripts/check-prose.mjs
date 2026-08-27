#!/usr/bin/env node
// Prose gate for the published docs subset: it walks the Markdown under docs/
// and enforces the voice thresholds below.
//
// It does NOT cover the hand-authored brochure pages under site/src/pages/.
// Those are .astro, so their copy is interleaved with markup and expressions
// and would need real extraction rather than a Markdown walk. Brochure voice is
// held by review plus check-section-order.mjs, which asserts the copy carries no
// scale figures.
//
// The gate covers prose quality and publication hygiene. Internal implementation
// records belong under docs/internal/, not in the exported handbook.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DOCS_DIR = join(REPO_ROOT, "docs");

// Mirrors sync-docs.mjs: these subtrees are never published.
const EXCLUDED_DIRS = new Set(["internal", "superpowers"]);
const EXCLUDED_FILES = new Set(["AGENTS.md"]);

export const THRESHOLDS = {
  // These two do not share a sense. emDashPer100Lines is a ceiling, compared
  // with `>`: 0 forbids exceeding 0. emDashPerSentence is compared with `>=`,
  // so it fails AT its value: 1 means the allowance per sentence is 0, not 1.
  emDashPer100Lines: 0,
  emDashPerSentence: 1,
  // Words per sentence. 45 fails outright; 35-45 warns. Normal technical prose
  // reaches 40 without being defective, so a hard 35 would fail good writing.
  sentenceWordsFail: 45,
  sentenceWordsWarn: 35,
};

export const WORD_LIMITS = {
  page: 1800,
  corpus: 35000,
};

// The identity terms are split across string concatenation so this shipped
// file never contains the private names or dev-process vocabulary that the
// export gate blocklists verbatim (the checker is itself exported with site/).
const PRIVATE_IDENTITIES = [
  "bam" + "bash",
  "n8s" + "\\.dev",
  "dev" + "boi",
  "brood" + "boi",
  "groove" + "lord",
  "chunky" + "ard",
  "kubernetes" + "-admin",
].join("|");

const DEVELOPMENT_TERMS = [
  "Open" + "Spec",
  "dogfood(?:ing)?",
  "historical footgun",
  "migration note",
  "pre-upgrade",
  "no deprecation window",
  "follow-up tracked",
  "this change",
].join("|");

const CONTENT_RULES = [
  {
    rule: "private-identity",
    pattern: new RegExp(`\\b(?:${PRIVATE_IDENTITIES})\\b`, "i"),
    message: "Private identity or infrastructure name in published documentation.",
  },
  {
    rule: "source-provenance",
    pattern: /<!--\s*sources?:/i,
    message: "Source provenance comments belong in internal documentation.",
  },
  {
    // Backend and tooling sources. `yaml` is deliberately absent from both of
    // these: published pages legitimately cite chart values and example
    // manifests (charts/varroa/values.yaml, examples/controller-class.yaml),
    // which are configuration a reader edits, not implementation detail.
    rule: "source-path",
    pattern: /\b(?:internal|cmd|hack|pkg|api)\/[A-Za-z0-9_./-]+\.(?:go|proto|sh)(?::\d+)?\b/,
    message: "Source-level implementation path in published documentation.",
  },
  {
    // Frontend, plugin, and site sources, which the backend pattern above
    // cannot reach: different roots and different extensions.
    rule: "source-path",
    pattern:
      /\b(?:frontend|plugin|site)\/(?:src|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|java|css|astro)(?::\d+)?\b/,
    message: "Source-level implementation path in published documentation.",
  },
  {
    rule: "development-history",
    pattern: new RegExp(`\\b(?:${DEVELOPMENT_TERMS})\\b`, "i"),
    message: "Development history belongs in internal documentation.",
  },
  {
    rule: "issue-history",
    pattern: /(?:\b(?:issue|PR)\s+#\d+\b|^#{2,6}\s+#\d+)/im,
    message: "Issue and change tracking references do not belong in product documentation.",
  },
  {
    rule: "announcing-preamble",
    pattern: /\b(?:this (?:page|guide) (?:covers|describes|explains|walks you through)|in this (?:page|guide),? (?:you will|we will))\b/i,
    message: "Start with the task or contract instead of announcing the page.",
  },
];

/**
 * Strip content where punctuation and length are not the author's prose:
 * fenced code, indented code, inline code, link targets, and HTML comments.
 */
export function stripNonProse(markdown) {
  return stripNonCode(markdown)
    .replace(/^\s*\|.*\|\s*$/gm, ""); // table rows are visible but not sentences
}

function stripNonCode(markdown) {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/, "") // frontmatter
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(?: {4}|\t).*$/gm, "") // indented code blocks
    .replace(/`[^`\n]*`/g, "")
    .replace(/\]\([^)\s]*\)/g, "]")
    .replace(/^\s*\[[^\]]+\]:\s*\S+$/gm, ""); // link reference definitions
}

/** Split prose into sentences. Deliberately simple; over-splitting only under-reports. */
export function sentences(prose) {
  return prose
    .split(/\n{2,}/)
    // A list item is its own unit; without this, consecutive bullets separated by a
    // single newline merge into one very long pseudo-sentence.
    .flatMap((para) => para.split(/\n(?=\s*(?:[-*+]|\d+\.)\s)/))
    .flatMap((para) => para.split(/(?<=[.!?])\s+(?=[A-Z(`"'*[])/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function wordCount(sentence) {
  return sentence.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Heading, list marker, and blockquote prefixes are structure, not sentence content. */
function isStructural(sentence) {
  return /^(#{1,6}\s|[-*+]\s*$|>\s*$)/.test(sentence);
}

export function checkText(text, label) {
  const findings = [];
  const prose = stripNonProse(text);
  const visibleText = stripNonCode(text);
  const lines = text.split("\n");

  const proseLines = visibleText.split("\n").filter((l) => l.trim()).length || 1;
  const totalEmDashes = (visibleText.match(/—/g) || []).length;
  const rate = (totalEmDashes / proseLines) * 100;

  if (rate > THRESHOLDS.emDashPer100Lines) {
    // Report the first offending line so the fix has somewhere to start.
    const firstLine = lines.findIndex((l) => l.includes("—")) + 1;
    findings.push({
      level: "fail",
      file: label,
      line: firstLine || 1,
      rule: "em-dash-density",
      message:
        `${totalEmDashes} em dashes across ${proseLines} prose lines ` +
        `(${rate.toFixed(1)} per 100, ceiling ${THRESHOLDS.emDashPer100Lines}). ` +
        `Use a period, a comma, or parentheses.`,
    });
  }

  findings.push(...checkPublicationText(text, label));

  const words = countProseWords(text);
  if (words > WORD_LIMITS.page) {
    findings.push({
      level: "fail",
      file: label,
      line: 1,
      rule: "page-word-limit",
      message: `${words} prose words (ceiling ${WORD_LIMITS.page}). Split or tighten the page.`,
    });
  }

  for (const sentence of sentences(prose)) {
    if (isStructural(sentence)) continue;

    const dashes = (sentence.match(/—/g) || []).length;
    if (dashes >= THRESHOLDS.emDashPerSentence) {
      findings.push({
        level: "fail",
        file: label,
        line: lineOf(lines, sentence),
        rule: "spliced-sentence",
        message: `${dashes} em dashes in one sentence. Split it: "${excerpt(sentence)}"`,
      });
      continue;
    }

    const words = wordCount(sentence);
    if (words > THRESHOLDS.sentenceWordsFail) {
      findings.push({
        level: "fail",
        file: label,
        line: lineOf(lines, sentence),
        rule: "sentence-length",
        message: `${words} words (ceiling ${THRESHOLDS.sentenceWordsFail}): "${excerpt(sentence)}"`,
      });
    } else if (words > THRESHOLDS.sentenceWordsWarn) {
      findings.push({
        level: "warn",
        file: label,
        line: lineOf(lines, sentence),
        rule: "sentence-length",
        message: `${words} words: "${excerpt(sentence)}"`,
      });
    }
  }

  return findings;
}

export function checkPublicationText(text, label) {
  const findings = [];
  for (const { rule, pattern, message } of CONTENT_RULES) {
    const match = pattern.exec(text);
    if (!match) continue;
    findings.push({
      level: "fail",
      file: label,
      line: text.slice(0, match.index).split("\n").length,
      rule,
      message,
    });
  }
  return findings;
}

export function countProseWords(text) {
  return stripNonCode(text)
    .split(/\s+/)
    .filter((word) => /[A-Za-z0-9]/.test(word)).length;
}

export function checkCorpus(entries) {
  const words = entries.reduce((sum, entry) => sum + countProseWords(entry.text), 0);
  if (words <= WORD_LIMITS.corpus) return [];
  return [{
    level: "fail",
    file: "docs/",
    line: 1,
    rule: "corpus-word-limit",
    message: `${words} prose words (ceiling ${WORD_LIMITS.corpus}).`,
  }];
}

function excerpt(sentence, max = 70) {
  return sentence.length <= max ? sentence : `${sentence.slice(0, max)}…`;
}

function lineOf(lines, sentence) {
  const probe = sentence.slice(0, 30).trim();
  if (!probe) return 1;
  const idx = lines.findIndex((l) => l.includes(probe));
  return idx >= 0 ? idx + 1 : 1;
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (EXCLUDED_DIRS.has(relative(base, full).split("/")[0])) continue;
      walk(full, base, out);
    } else if (extname(entry) === ".md" && !EXCLUDED_FILES.has(entry)) {
      out.push(full);
    }
  }
  return out;
}

function walkExamples(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkExamples(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const warnOnly = !process.argv.includes("--strict");
  const files = walk(DOCS_DIR);
  const entries = files.map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const exampleEntries = walkExamples(join(DOCS_DIR, "install", "examples"))
    .map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const findings = [
    ...entries.flatMap(({ file, text }) => checkText(text, relative(REPO_ROOT, file))),
    ...exampleEntries.flatMap(({ file, text }) =>
      checkPublicationText(text, relative(REPO_ROOT, file))),
    ...checkCorpus(entries),
  ];

  const fails = findings.filter((f) => f.level === "fail");
  const warns = findings.filter((f) => f.level === "warn");

  for (const f of [...fails, ...warns]) {
    const tag = f.level === "fail" ? "FAIL" : "warn";
    console.error(`${tag} ${f.file}:${f.line} [${f.rule}] ${f.message}`);
  }

  const summary =
    `check-prose: ${files.length + exampleEntries.length} files, ${fails.length} failures, ${warns.length} warnings`;

  if (fails.length && !warnOnly) {
    console.error(
      `${summary} — prose thresholds: at most ${THRESHOLDS.emDashPer100Lines} em dashes ` +
        `per 100 lines and at most ${THRESHOLDS.emDashPerSentence - 1} per sentence; ` +
        `sentences at most ${THRESHOLDS.sentenceWordsFail} words`,
    );
    process.exit(1);
  }
  console.log(
    warnOnly && fails.length
      ? `${summary} (warn mode; pass --strict to enforce)`
      : summary,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
