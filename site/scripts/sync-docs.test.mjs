// site/scripts/sync-docs.test.mjs — Node built-in test runner coverage for
// sync-docs.mjs (design §2, tasks 2.5). Run via `node --test scripts/`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  REPO_ROOT,
  SITE_REPO_URL,
  NAV,
  checkNavCoverage,
  collectMarkdownFiles,
  run,
  parseAndStripH1,
  parseExtraManifestPaths,
} from "./sync-docs.mjs";

function makeFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "varroa-sync-fixture-"));
  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(root, relPath);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

function runFixture(files, { extraManifestPaths = [], nav } = {}) {
  const root = makeFixture(files);
  const docsRoot = path.join(root, "docs");
  const outDocsDir = path.join(root, "out-docs");
  const outExamplesDir = path.join(root, "out-examples");
  // Fixtures carry their own tiny doc trees, so the real NAV cannot cover them.
  // Default to an entry per fixture page; a test that wants to exercise the
  // coverage check passes its own `nav`.
  const resolvedNav =
    nav ??
    Object.fromEntries(
      Object.keys(files)
        .filter((p) => p.startsWith("docs/") && p.endsWith(".md"))
        .map((p) => p.slice("docs/".length))
        // Mirror collectMarkdownFiles's exclusions, so a fixture that asserts
        // those paths are skipped does not get a NAV entry for them.
        .filter(
          (rel) =>
            !rel.startsWith("internal/") &&
            !rel.startsWith("superpowers/") &&
            path.basename(rel) !== "AGENTS.md",
        )
        .map((rel) => [rel, {}]),
    );
  const result = run({
    docsRoot,
    outDocsDir,
    outExamplesDir,
    siteRepo: SITE_REPO_URL,
    extraManifestPaths,
    nav: resolvedNav,
  });
  return { root, docsRoot, outDocsDir, outExamplesDir, result };
}

function readOut(outDocsDir, relPath) {
  return readFileSync(path.join(outDocsDir, relPath), "utf8");
}

describe("parseAndStripH1", () => {
  test("parses a leading H1 and strips it from the body", () => {
    const { title, body } = parseAndStripH1("# Hello World\n\nBody text.\n", "/x.md");
    assert.equal(title, "Hello World");
    assert.equal(body, "Body text.\n");
  });

  test("throws naming file+line when the leading H1 is missing", () => {
    assert.throws(
      () => parseAndStripH1("Not a heading.\n\nMore text.\n", "/nofile.md"),
      (err) => {
        assert.equal(err.file, "/nofile.md");
        assert.equal(err.line, 1);
        return true;
      },
    );
  });

  test("YAML-unsafe title (colon) round-trips via JSON-quoting in the emitted frontmatter", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": "# Tutorial: X\n\nBody.\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /^title: "Tutorial: X"$/m);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("link rewriting branches", () => {
  test("fenced code block and inline code are never rewritten", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": [
        "# Home",
        "",
        "```text",
        "See [not a link](page.md) here.",
        "```",
        "",
        "Inline: `[also not a link](page.md)` stays literal.",
        "",
        "[real link](page.md)",
        "",
      ].join("\n"),
      "docs/page.md": "# Page\n\nBody.\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /```text\nSee \[not a link\]\(page\.md\) here\.\n```/);
    assert.match(out, /`\[also not a link\]\(page\.md\)`/);
    assert.match(out, /\[real link\]\(\/docs\/page\/\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("query strings and fragments are preserved on an in-tree route", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": "# Home\n\n[q](page.md?foo=bar#section)\n",
      "docs/page.md": "# Page\n\nBody.\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /\[q\]\(\/docs\/page\/\?foo=bar#section\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("README.md target (with fragment) maps to the directory route", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": "# Home\n\n[r](sub/README.md#frag)\n",
      "docs/sub/README.md": "# Sub\n\nBody.\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /\[r\]\(\/docs\/sub\/#frag\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("a bare directory target (docs/ root itself) also maps to a route", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": "# Home\n\nBody.\n",
      "docs/sub/page.md": "# Sub Page\n\n[up](../)\n",
    });
    const out = readOut(outDocsDir, "sub/page.md");
    assert.match(out, /\[up\]\(\/docs\/\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("example file target maps to /docs-examples/<path>", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": "# Home\n\n[ex](install/examples/foo.yaml)\n",
      "docs/install/examples/foo.yaml": "foo: bar\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /\[ex\]\(\/docs-examples\/foo\.yaml\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("example directory target maps to the GitHub tree URL", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": "# Home\n\n[exdir](install/examples/bar/)\n",
      "docs/install/examples/bar/baz.yaml": "baz: qux\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(
      out,
      /\[exdir\]\(https:\/\/github\.com\/VarroaCI\/varroaci\.github\.io\/tree\/main\/docs\/install\/examples\/bar\)/,
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("allowed escaping link (in EXTRA_MANIFEST_PATHS) maps to a GitHub blob URL", () => {
    const { root, outDocsDir } = runFixture(
      {
        "docs/README.md": "# Home\n\n[out](../outside.yaml)\n",
        "outside.yaml": "k: v\n",
      },
      { extraManifestPaths: ["outside.yaml"] },
    );
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /\[out\]\(https:\/\/github\.com\/VarroaCI\/varroaci\.github\.io\/blob\/main\/outside\.yaml\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("disallowed escaping link fails the build naming file, line, and destination", () => {
    const files = {
      "docs/README.md": "# Home\n\n[bad](../not-manifested.yaml)\n",
      "not-manifested.yaml": "k: v\n",
    };
    const root = makeFixture(files);
    const docsRoot = path.join(root, "docs");
    assert.throws(
      () =>
        run({
          docsRoot,
          outDocsDir: path.join(root, "out-docs"),
          outExamplesDir: path.join(root, "out-examples"),
          siteRepo: SITE_REPO_URL,
          extraManifestPaths: [],
          nav: { "README.md": {} },
        }),
      (err) => {
        assert.match(err.file, /README\.md$/);
        assert.equal(err.line, 3);
        assert.equal(err.destination, "../not-manifested.yaml");
        return true;
      },
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("excluded-path link (docs/internal/) fails unless manifested", () => {
    const files = {
      "docs/README.md": "# Home\n\n[bad](internal/secret.md)\n",
      "docs/internal/secret.md": "not a real page\n",
    };
    const root = makeFixture(files);
    const docsRoot = path.join(root, "docs");
    assert.throws(
      () =>
        run({
          docsRoot,
          outDocsDir: path.join(root, "out-docs"),
          outExamplesDir: path.join(root, "out-examples"),
          siteRepo: SITE_REPO_URL,
          extraManifestPaths: [],
          nav: { "README.md": {} },
        }),
      (err) => {
        assert.equal(err.destination, "internal/secret.md");
        return true;
      },
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("a dead relative link fails naming file, line, and destination", () => {
    const files = { "docs/README.md": "# Home\n\n[dead](nope.md)\n" };
    const root = makeFixture(files);
    const docsRoot = path.join(root, "docs");
    assert.throws(
      () =>
        run({
          docsRoot,
          outDocsDir: path.join(root, "out-docs"),
          outExamplesDir: path.join(root, "out-examples"),
          siteRepo: SITE_REPO_URL,
          extraManifestPaths: [],
          nav: { "README.md": {} },
        }),
      (err) => {
        assert.match(err.file, /README\.md$/);
        assert.equal(err.line, 3);
        assert.equal(err.destination, "nope.md");
        return true;
      },
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("absolute URLs and pure #anchors are left untouched", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": [
        "# Home",
        "",
        "[ext](https://example.com/foo)",
        "[mail](mailto:a@example.com)",
        "[anchor](#some-section)",
        "",
      ].join("\n"),
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /\[ext\]\(https:\/\/example\.com\/foo\)/);
    assert.match(out, /\[mail\]\(mailto:a@example\.com\)/);
    assert.match(out, /\[anchor\]\(#some-section\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("a link whose text spans two source lines is still found and rewritten", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": ["# Home", "", "See [line one", "line two](page.md) for details.", ""].join("\n"),
      "docs/page.md": "# Page\n\nBody.\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /\(\/docs\/page\/\)/);
    rmSync(root, { recursive: true, force: true });
  });

  test("reference-style link definitions are rewritten too", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": ["# Home", "", "See [ref link][1].", "", "[1]: page.md", ""].join("\n"),
      "docs/page.md": "# Page\n\nBody.\n",
    });
    const out = readOut(outDocsDir, "index.md");
    assert.match(out, /\[1\]: \/docs\/page\//);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("traversal exclusions", () => {
  test("internal/, superpowers/, and AGENTS.md never appear in the output trees", () => {
    const { root, outDocsDir } = runFixture({
      "docs/README.md": "# Home\n\nBody.\n",
      "docs/AGENTS.md": "not a page\n",
      "docs/internal/secret.md": "# Secret\n\nBody.\n",
      "docs/superpowers/plans/plan.md": "# Plan\n\nBody.\n",
    });

    function collect(dir) {
      const out = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...collect(p));
        else out.push(p);
      }
      return out;
    }
    const produced = collect(outDocsDir);
    for (const p of produced) {
      assert.doesNotMatch(p, /AGENTS\.md$/);
      assert.doesNotMatch(p, /[/\\]internal[/\\]/);
      assert.doesNotMatch(p, /[/\\]superpowers[/\\]/);
    }
    assert.deepEqual(
      produced.map((p) => path.relative(outDocsDir, p)),
      ["index.md"],
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("install/examples/** is mirrored verbatim into public/docs-examples/", () => {
    const { root, outExamplesDir } = runFixture({
      "docs/README.md": "# Home\n\nBody.\n",
      "docs/install/examples/foo.yaml": "foo: bar\n",
      "docs/install/examples/bar/baz.yaml": "baz: qux\n",
    });
    assert.equal(readFileSync(path.join(outExamplesDir, "foo.yaml"), "utf8"), "foo: bar\n");
    assert.equal(readFileSync(path.join(outExamplesDir, "bar", "baz.yaml"), "utf8"), "baz: qux\n");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("EXTRA_MANIFEST_PATHS lockstep", () => {
  test("every path in site/extra-manifest-paths.txt is git-tracked", () => {
    const paths = parseExtraManifestPaths();
    // An all-comment manifest is legitimate (nothing escapes docs/), and
    // hack/export-site.sh treats it as such, so this asserts tracking of
    // whatever is listed rather than that something is listed.
    for (const p of paths) {
      const res = spawnSync("git", ["ls-files", "--error-unmatch", p], { cwd: REPO_ROOT });
      assert.equal(res.status, 0, `EXTRA_MANIFEST_PATHS entry is not git-tracked: ${p}`);
    }
  });
});

describe("determinism", () => {
  test("running sync-docs.mjs twice against the real docs/ tree produces byte-identical output", () => {
    const root = mkdtempSync(path.join(tmpdir(), "varroa-sync-determinism-"));
    const outDocsDirA = path.join(root, "a", "docs");
    const outExamplesDirA = path.join(root, "a", "examples");
    const outDocsDirB = path.join(root, "b", "docs");
    const outExamplesDirB = path.join(root, "b", "examples");

    run({ outDocsDir: outDocsDirA, outExamplesDir: outExamplesDirA });
    run({ outDocsDir: outDocsDirB, outExamplesDir: outExamplesDirB });

    function snapshot(dir) {
      const out = new Map();
      function walk(d, rel) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const abs = path.join(d, e.name);
          const relPath = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(abs, relPath);
          else out.set(relPath, readFileSync(abs));
        }
      }
      walk(dir, "");
      return out;
    }

    const docsA = snapshot(outDocsDirA);
    const docsB = snapshot(outDocsDirB);
    assert.deepEqual([...docsA.keys()].sort(), [...docsB.keys()].sort());
    for (const [k, v] of docsA) {
      assert.ok(v.equals(docsB.get(k)), `content differs for ${k}`);
    }

    const exA = snapshot(outExamplesDirA);
    const exB = snapshot(outExamplesDirB);
    assert.deepEqual([...exA.keys()].sort(), [...exB.keys()].sort());
    for (const [k, v] of exA) {
      assert.ok(v.equals(exB.get(k)), `content differs for ${k}`);
    }

    rmSync(root, { recursive: true, force: true });
  });
});

describe("checkNavCoverage", () => {
  test("passes when NAV covers exactly the page set", () => {
    const nav = { "a.md": { order: 1 }, "b/c.md": { label: "C", order: 2 } };
    assert.doesNotThrow(() => checkNavCoverage(["a.md", "b/c.md"], nav));
  });

  test("fails naming a page that has no NAV entry", () => {
    const nav = { "a.md": { order: 1 } };
    assert.throws(
      () => checkNavCoverage(["a.md", "b/new.md"], nav),
      (err) => {
        assert.match(err.message, /b\/new\.md/);
        assert.match(err.message, /no NAV entry/);
        return true;
      },
    );
  });

  test("fails naming a NAV entry left behind by a rename", () => {
    const nav = { "a.md": { order: 1 }, "b/old.md": { order: 2 } };
    assert.throws(
      () => checkNavCoverage(["a.md"], nav),
      (err) => {
        assert.match(err.message, /b\/old\.md/);
        assert.match(err.message, /no page/);
        return true;
      },
    );
  });

  test("the committed NAV covers the real docs tree", () => {
    // Guards the actual repo, not a fixture: a page added to docs/ without a
    // NAV entry fails here as well as at build time.
    const files = collectMarkdownFiles(path.join(REPO_ROOT, "docs"));
    assert.doesNotThrow(() => checkNavCoverage(files, NAV));
  });

  test("every autogenerated group's orders are unique and contiguous from 1", () => {
    // Only directory groups are autogenerated from frontmatter. Root-level
    // pages either sit outside the sidebar (README, roadmap) or belong to the
    // explicit-link "API & CLI" group in astro.config.mjs, where sidebar.order
    // has no effect.
    const groups = new Map();
    for (const [rel, entry] of Object.entries(NAV)) {
      if (!rel.includes("/")) continue;
      const group = rel.slice(0, rel.lastIndexOf("/"));
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(entry.order);
    }
    for (const [group, orders] of groups) {
      const sorted = [...orders].sort((a, b) => a - b);
      const expected = Array.from({ length: orders.length }, (_, i) => i + 1);
      assert.deepEqual(sorted, expected, `group ${group || "(root)"} has orders ${sorted.join(",")}`);
    }
  });
});

describe("parseExtraManifestPaths", () => {
  test("ignores comments and blank lines", () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "varroa-manifest-")), "m.txt");
    writeFileSync(f, "# a comment\n\n  \nexamples/one.yaml\n  examples/two.yaml  \n", "utf8");
    assert.deepEqual(parseExtraManifestPaths(f), ["examples/one.yaml", "examples/two.yaml"]);
  });

  test("an all-comment manifest resolves to an empty list, not an error", () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "varroa-manifest-")), "m.txt");
    writeFileSync(f, "# nothing escapes docs/\n\n", "utf8");
    assert.deepEqual(parseExtraManifestPaths(f), []);
  });
});
