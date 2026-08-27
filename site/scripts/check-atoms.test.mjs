import { test } from "node:test";
import assert from "node:assert/strict";

import { atoms, diffAtoms } from "./check-atoms.mjs";

test("pure voice edits preserve every atom", () => {
  const before = [
    "# Update center",
    "",
    "The operator reconciles declared plugins — and it does so every tick — against",
    "`status.storedPlugins`, which MUST match the pinned set. See [pinning](/docs/config/plugin-pinning/).",
  ].join("\n");
  const after = [
    "# Update center",
    "",
    "The operator reconciles declared plugins against `status.storedPlugins` on every",
    "tick. The stored set MUST match the pinned set. See [pinning](/docs/config/plugin-pinning/).",
  ].join("\n");

  assert.equal(diffAtoms(before, after).clean, true);
});

test("a dropped RFC-2119 keyword is caught", () => {
  const before = "The value MUST be set.";
  const after = "Set the value.";
  const { clean, report } = diffAtoms(before, after);
  assert.equal(clean, false);
  assert.deepEqual(report.keywords.removed, ["MUST"]);
});

test("a changed identifier is caught as one removal and one addition", () => {
  const before = "Set `spec.version` on the CR.";
  const after = "Set `spec.jenkinsVersion` on the CR.";
  const { clean, report } = diffAtoms(before, after);
  assert.equal(clean, false);
  assert.deepEqual(report.code.removed, ["spec.version"]);
  assert.deepEqual(report.code.added, ["spec.jenkinsVersion"]);
});

test("a changed number is caught", () => {
  const before = "Default is 8 concurrent reconciles, with a 30s TTL.";
  const after = "Default is 8 concurrent reconciles, with a 60s TTL.";
  const { report } = diffAtoms(before, after);
  assert.deepEqual(report.numbers.removed, ["30s"]);
  assert.deepEqual(report.numbers.added, ["60s"]);
});

test("a retargeted link is caught", () => {
  const before = "See [scaling](/docs/architecture/scaling/).";
  const after = "See [scaling](/docs/architecture/overview/).";
  const { report } = diffAtoms(before, after);
  assert.deepEqual(report.links.removed, ["/docs/architecture/scaling/"]);
  assert.deepEqual(report.links.added, ["/docs/architecture/overview/"]);
});

test("multiset semantics: dropping one of two occurrences is caught", () => {
  const before = "Set `a` here and set `a` there.";
  const after = "Set `a` here.";
  const { report } = diffAtoms(before, after);
  assert.deepEqual(report.code.removed, ["a"]);
});

test("frontmatter is excluded so sync-added editUrl does not register", () => {
  const withFm = '---\ntitle: "T"\neditUrl: https://example.com/x\n---\n\nBody `a`.';
  const withoutFm = "Body `a`.";
  assert.equal(diffAtoms(withFm, withoutFm).clean, true);
});

test("atoms separates kinds", () => {
  const a = atoms("Use `foo` MUST see [x](/y/) at 30s.");
  assert.deepEqual(a.code, ["foo"]);
  assert.deepEqual(a.keywords, ["MUST"]);
  assert.deepEqual(a.links, ["/y/"]);
  assert.deepEqual(a.numbers, ["30s"]);
});
