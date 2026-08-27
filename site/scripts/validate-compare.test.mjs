// site/scripts/validate-compare.test.mjs — tests for validate-compare.mjs
// (task 4.4a). Run via `npm test` (node --test scripts/*.test.mjs).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseCompareYaml, validateRows, run, CompareYamlError } from "./validate-compare.mjs";

function withFixture(yamlText, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "varroa-compare-fixture-"));
  const yamlPath = path.join(dir, "compare.yaml");
  const outPath = path.join(dir, "compare.generated.json");
  writeFileSync(yamlPath, yamlText, "utf8");
  try {
    return fn({ yamlPath, outPath, dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VALID_ROW = [
  "rows:",
  '  - feature: "Fleet management"',
  '    varroa: "Kubernetes CRDs"',
  '    cloudbees: "Operations Center UI"',
  '    source: "https://docs.cloudbees.com/docs/cloudbees-ci/latest/managed-master/managing-masters"',
  '    verified: "2026-08-23"',
  "",
].join("\n");

describe("parseCompareYaml", () => {
  test("rows: [] parses to an empty array", () => {
    assert.deepEqual(parseCompareYaml("rows: []\n"), []);
  });

  test("a single valid row parses with all five fields", () => {
    const rows = parseCompareYaml(VALID_ROW);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].feature, "Fleet management");
    assert.equal(rows[0].verified, "2026-08-23");
  });

  test("comment lines and blank lines are ignored", () => {
    const text = ["# a leading comment", "", "rows: []", "# trailing comment"].join("\n");
    assert.deepEqual(parseCompareYaml(text), []);
  });

  test("two rows parse independently", () => {
    const text = [
      "rows:",
      '  - feature: "A"',
      '    varroa: "va"',
      '    cloudbees: "ca"',
      '    source: "https://docs.cloudbees.com/x"',
      '    verified: "2026-01-01"',
      '  - feature: "B"',
      '    varroa: "vb"',
      '    cloudbees: "cb"',
      '    source: "https://www.cloudbees.com/y"',
      '    verified: "2026-02-02"',
      "",
    ].join("\n");
    const rows = parseCompareYaml(text);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].feature, "A");
    assert.equal(rows[1].feature, "B");
  });

  test("an unknown key is a parse error", () => {
    const text = ['rows:', '  - feature: "A"', '    bogus: "x"', ""].join("\n");
    assert.throws(() => parseCompareYaml(text), CompareYamlError);
  });

  test("a nested/flow value is rejected (no nesting)", () => {
    const text = ['rows:', '  - feature: "A"', "    varroa: [1, 2]", ""].join("\n");
    assert.throws(() => parseCompareYaml(text), CompareYamlError);
  });
});

describe("validateRows", () => {
  test("a fully valid row passes with no errors", () => {
    const rows = parseCompareYaml(VALID_ROW);
    assert.deepEqual(validateRows(rows), []);
  });

  test("missing verified fails, naming the row", () => {
    const text = [
      "rows:",
      '  - feature: "No verified date"',
      '    varroa: "v"',
      '    cloudbees: "c"',
      '    source: "https://docs.cloudbees.com/x"',
      "",
    ].join("\n");
    const rows = parseCompareYaml(text);
    const errors = validateRows(rows);
    assert.ok(errors.some((e) => e.includes('"No verified date"') && e.includes("verified")));
  });

  test("non-ISO verified fails, naming the row", () => {
    const text = [
      "rows:",
      '  - feature: "Bad date"',
      '    varroa: "v"',
      '    cloudbees: "c"',
      '    source: "https://docs.cloudbees.com/x"',
      '    verified: "08/23/2026"',
      "",
    ].join("\n");
    const rows = parseCompareYaml(text);
    const errors = validateRows(rows);
    assert.ok(errors.some((e) => e.includes('"Bad date"') && e.includes("ISO date")));
  });

  test("a calendar-invalid ISO-shaped date fails", () => {
    const text = [
      "rows:",
      '  - feature: "Invalid calendar date"',
      '    varroa: "v"',
      '    cloudbees: "c"',
      '    source: "https://docs.cloudbees.com/x"',
      '    verified: "2026-02-30"',
      "",
    ].join("\n");
    const rows = parseCompareYaml(text);
    const errors = validateRows(rows);
    assert.ok(errors.some((e) => e.includes('"Invalid calendar date"') && e.includes("ISO date")));
  });

  test("disallowed source host fails, naming the row", () => {
    const text = [
      "rows:",
      '  - feature: "Wrong host"',
      '    varroa: "v"',
      '    cloudbees: "c"',
      '    source: "https://example.com/cloudbees"',
      '    verified: "2026-08-23"',
      "",
    ].join("\n");
    const rows = parseCompareYaml(text);
    const errors = validateRows(rows);
    assert.ok(errors.some((e) => e.includes('"Wrong host"') && e.includes("source host")));
  });

  test("www.cloudbees.com is an allowed source host", () => {
    const text = [
      "rows:",
      '  - feature: "OK host"',
      '    varroa: "v"',
      '    cloudbees: "c"',
      '    source: "https://www.cloudbees.com/some-page"',
      '    verified: "2026-08-23"',
      "",
    ].join("\n");
    const rows = parseCompareYaml(text);
    assert.deepEqual(validateRows(rows), []);
  });
});

describe("run", () => {
  test("writes compare.generated.json for a valid file", () => {
    withFixture(VALID_ROW, ({ yamlPath, outPath }) => {
      const { rowCount } = run({ yamlPath, outPath });
      assert.equal(rowCount, 1);
      const written = JSON.parse(readFileSync(outPath, "utf8"));
      assert.equal(written.length, 1);
      assert.equal(written[0].feature, "Fleet management");
    });
  });

  test("throws (and does not write output) for an invalid file", () => {
    const badText = ["rows:", '  - feature: "Missing stuff"', '    varroa: "v"', ""].join("\n");
    withFixture(badText, ({ yamlPath, outPath }) => {
      assert.throws(() => run({ yamlPath, outPath }), (err) => {
        assert.ok(err instanceof CompareYamlError);
        assert.ok(err.message.includes('"Missing stuff"'));
        return true;
      });
    });
  });
});
