// site/scripts/client-snippets.test.mjs — Node built-in test runner coverage
// for client-snippets.mjs. Run via `node --test scripts/`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./sync-docs.mjs";
import { CLIENT_HEADINGS, snippetsFrom } from "./client-snippets.mjs";

const SAMPLE = [
  "# Page",
  "",
  "## Configure a client",
  "",
  "### Cursor",
  "",
  "```json",
  '{"one": 1}',
  "```",
  "",
  "### GitHub Copilot",
  "",
  "```json",
  '{"two": 2}',
  "```",
  "",
  "### Stdio bridge",
  "",
  "```json",
  '{"three": 3}',
  "```",
  "",
  "## Next section",
  "",
].join("\n");

describe("snippetsFrom", () => {
  test("returns the snippets in heading order", () => {
    const snippets = snippetsFrom(SAMPLE, { file: "sample.md" });
    assert.deepEqual(
      snippets.map((s) => s.label),
      ["Cursor", "GitHub Copilot", "Stdio bridge"],
    );
    assert.equal(snippets[0].code, '{"one": 1}');
    assert.equal(snippets[0].lang, "json");
  });

  test("fails naming the file and the heading when a heading is missing", () => {
    const text = SAMPLE.replace("### Stdio bridge", "### Other");
    assert.throws(
      () => snippetsFrom(text, { file: "sample.md" }),
      /sample\.md: heading "### Stdio bridge" not found under "## Configure a client"/,
    );
  });

  test("fails when a heading holds no fenced block", () => {
    const text = SAMPLE.replace("### Cursor\n\n```json\n{\"one\": 1}\n```", "### Cursor\n\nNo block here.");
    assert.throws(
      () => snippetsFrom(text, { file: "sample.md" }),
      /sample\.md: heading "### Cursor" holds no fenced block/,
    );
  });

  test("fails when the Configure a client section is missing", () => {
    assert.throws(
      () => snippetsFrom("# Page\n\n## Other\n", { file: "sample.md" }),
      /sample\.md: no "## Configure a client" section/,
    );
  });

  test("fails when the headings are out of order", () => {
    const text = SAMPLE.replace("### Cursor", "### Tmp")
      .replace("### GitHub Copilot", "### Cursor")
      .replace("### Tmp", "### GitHub Copilot");
    assert.throws(
      () => snippetsFrom(text, { file: "sample.md" }),
      /sample\.md: heading "### GitHub Copilot" is out of order/,
    );
  });

  test("reads the committed connecting.md", () => {
    const file = path.join(REPO_ROOT, "docs/agents/connecting.md");
    const snippets = snippetsFrom(readFileSync(file, "utf8"));
    assert.deepEqual(
      snippets.map((s) => s.label),
      CLIENT_HEADINGS,
    );
    for (const s of snippets) {
      assert.doesNotMatch(s.code, /vk_[A-Za-z0-9]/);
    }
  });
});
