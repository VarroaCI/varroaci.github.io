import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkCorpus,
  checkPublicationText,
  checkText,
  sentences,
  stripNonProse,
  THRESHOLDS,
  WORD_LIMITS,
} from "./check-prose.mjs";

const rules = (findings) => findings.map((f) => f.rule);

test("clean prose produces no findings", () => {
  const text = [
    "# Prerequisites",
    "",
    "Varroa requires a Kubernetes cluster at version 1.28 or later.",
    "Install the CRDs before the chart. The operator will not start without them.",
  ].join("\n");
  assert.deepEqual(checkText(text, "clean.md"), []);
});

test("em-dash density fails and names a line", () => {
  const body = Array.from(
    { length: 10 },
    (_, i) => `Line ${i} carries a dash — right here.`,
  ).join("\n\n");
  const findings = checkText(`# T\n\n${body}`, "dense.md");
  const density = findings.find((f) => f.rule === "em-dash-density");
  assert.ok(density, "expected an em-dash-density finding");
  assert.equal(density.level, "fail");
  assert.ok(density.line > 1, "should point at the first dash, not the heading");
});

test("a sentence with two em dashes fails as spliced", () => {
  const text = "# T\n\nThe operator reconciles — one shard at a time — and then stops.";
  assert.ok(rules(checkText(text, "splice.md")).includes("spliced-sentence"));
});

test("sentence length warns above the warn ceiling and fails above the fail ceiling", () => {
  const warnLen = THRESHOLDS.sentenceWordsWarn + 3;
  const failLen = THRESHOLDS.sentenceWordsFail + 3;
  const build = (n) => `# T\n\n${"word ".repeat(n).trim()} ends here.`;

  const warned = checkText(build(warnLen), "warn.md").filter(
    (f) => f.rule === "sentence-length",
  );
  assert.equal(warned.length, 1);
  assert.equal(warned[0].level, "warn");

  const failed = checkText(build(failLen), "fail.md").filter(
    (f) => f.rule === "sentence-length",
  );
  assert.equal(failed.length, 1);
  assert.equal(failed[0].level, "fail");
});

test("code fences and inline code are exempt, but visible tables are checked", () => {
  const text = [
    "# T",
    "",
    "```bash",
    "# a — b — c — d — e — f — g",
    "```",
    "",
    "Run `varroa — help — now` to check.",
    "",
    "| col — a | col — b |",
    "| --- | --- |",
    "| x — y | z — w |",
  ].join("\n");
  assert.ok(rules(checkText(text, "code.md")).includes("em-dash-density"));
});

test("frontmatter is not counted as prose", () => {
  const text = "---\ntitle: A — B\neditUrl: x\n---\n\n# T\n\nShort and clean.";
  assert.deepEqual(checkText(text, "fm.md"), []);
});

test("consecutive list items are separate sentences, not one run-on", () => {
  const list = [
    "- the first item here has several words in it",
    "- the second item here has several words in it",
    "- the third item here has several words in it",
  ].join("\n");
  const found = sentences(stripNonProse(list));
  assert.equal(found.length, 3, "each bullet is its own unit");
});

test("markdown link targets do not inflate word counts", () => {
  const text = "# T\n\nSee [the scaling page](/docs/architecture/scaling/) for detail.";
  assert.deepEqual(checkText(text, "link.md"), []);
});

test("publication hygiene rejects private and development-only material", () => {
  const text = [
    "# Install",
    "",
    "<!-- sources: internal/controller/reconcile.go -->",
    "This change targets kubernetes-admin.",
  ].join("\n");
  const found = rules(checkText(text, "leak.md"));
  assert.ok(found.includes("private-identity"));
  assert.ok(found.includes("source-provenance"));
  assert.ok(found.includes("source-path"));
  assert.ok(found.includes("development-history"));
});

test("source-path covers every implementation root, not just the Go ones", () => {
  for (const path of [
    "internal/controller/reconcile.go",
    "cmd/mite/agent.go",
    "hack/gen-plugin-lock.sh",
    "pkg/client/client.go",
    "api/v1alpha1/types.go",
    "frontend/src/pages/LoginPage.tsx",
    "plugin/src/main/java/Realm.java",
    "site/scripts/sync-docs.mjs",
    "site/src/components/SiteHeader.astro",
  ]) {
    const found = rules(checkPublicationText(`See ${path} for details.`, "p.md"));
    assert.ok(found.includes("source-path"), `${path} should be flagged`);
  }
});

test("source-path leaves reader-facing configuration citable", () => {
  // These are files a reader edits, not implementation detail. Flagging them
  // would make the install and configuration pages unwritable.
  for (const path of [
    "charts/varroa/values.yaml",
    "charts/varroa/values-hive.yaml",
    "examples/controller-class.yaml",
  ]) {
    const found = rules(checkPublicationText(`Edit ${path}.`, "p.md"));
    assert.ok(!found.includes("source-path"), `${path} should not be flagged`);
  }
});

test("publication hygiene applies to published YAML examples", () => {
  const findings = checkPublicationText(
    "image: example.com/kubernetes-admin:latest\n",
    "example.yaml",
  );
  assert.equal(findings[0].rule, "private-identity");
});

test("page and corpus word limits fail closed", () => {
  const page = `# Long\n\n${"word ".repeat(WORD_LIMITS.page + 1)}`;
  assert.ok(rules(checkText(page, "long.md")).includes("page-word-limit"));

  const entries = [
    { text: `# A\n\n${"word ".repeat(Math.ceil(WORD_LIMITS.corpus / 2))}` },
    { text: `# B\n\n${"word ".repeat(Math.ceil(WORD_LIMITS.corpus / 2) + 1)}` },
  ];
  assert.equal(checkCorpus(entries)[0].rule, "corpus-word-limit");
});
