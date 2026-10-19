// site/scripts/llms.test.mjs — Node built-in test runner coverage for
// llms.mjs. Run via `node --test scripts/`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { NAV } from "./sync-docs.mjs";
import { DOCS_GROUPS } from "./docs-groups.mjs";
import { buildLlms, pageUrl, summaryOf } from "./llms.mjs";

const SITE = "https://varroa.dev";
const AGENTS = { title: "Agents in Varroa", description: "Agents page." };

function allPages() {
  return Object.keys(NAV).map((relPath) => ({ relPath, title: `Title ${relPath}`, body: "Prose." }));
}

function build(pages) {
  return buildLlms({ pages, groups: DOCS_GROUPS, nav: NAV, site: SITE, agentsPage: AGENTS });
}

describe("summaryOf", () => {
  test("takes the first sentence of the first prose paragraph with links reduced to text", () => {
    const body = "See [the overview](overview.md) for more. It has a second sentence.";
    assert.equal(summaryOf(body, "T"), "See the overview for more.");
  });

  test("skips fences, tables, lists, headings, and comments", () => {
    const body = [
      "# Heading",
      "",
      "```bash",
      "echo hidden. text",
      "```",
      "",
      "| a | b |",
      "",
      "- item one.",
      "",
      "<!-- comment. -->",
      "",
      "The real summary is here.",
    ].join("\n");
    assert.equal(summaryOf(body, "T"), "The real summary is here.");
  });

  test("falls back to the title when a page has no prose paragraph", () => {
    assert.equal(summaryOf("## Only headings\n\n- a list\n", "Fallback title"), "Fallback title");
  });

  test("cuts a summary to 200 characters", () => {
    const long = "word ".repeat(80).trim();
    const out = summaryOf(long, "T");
    assert.equal(out.length, 200);
    assert.ok(out.endsWith("…"));
  });
});

describe("pageUrl", () => {
  test("maps README.md to the handbook root and other pages to their route", () => {
    assert.equal(pageUrl("README.md", SITE), `${SITE}/docs/`);
    assert.equal(pageUrl("agents/overview.md", SITE), `${SITE}/docs/agents/overview/`);
  });
});

describe("buildLlms", () => {
  test("opens with the title and the summary line", () => {
    const text = build(allPages());
    assert.match(text, /^# Varroa\n\n> Kubernetes-native Jenkins/);
  });

  test("lists README and the agents page under Start, and the agents page once", () => {
    const text = build(allPages());
    const start = text.slice(text.indexOf("## Start"), text.indexOf("## Architecture"));
    assert.match(start, /- \[Title README\.md\]\(https:\/\/varroa\.dev\/docs\/\)/);
    assert.match(start, /- \[Agents in Varroa\]\(https:\/\/varroa\.dev\/agents\/\): Agents page\./);
    assert.equal(text.split("(https://varroa.dev/agents/)").length - 1, 1);
  });

  test("writes groups in DOCS_GROUPS order under their sidebar labels", () => {
    const text = build(allPages());
    let at = -1;
    for (const group of DOCS_GROUPS) {
      const next = text.indexOf(`## ${group.label}\n`, at + 1);
      assert.ok(next > at, `group ${group.label} is out of order`);
      at = next;
    }
  });

  test("sorts pages inside a group by NAV order", () => {
    const text = build(allPages());
    const tutorials = [...text.matchAll(/\]\(https:\/\/varroa\.dev\/docs\/(agents\/[a-z-]+)\/\)/g)].map((m) => m[1]);
    const agentNav = tutorials.map((rel) => NAV[`${rel}.md`].order);
    assert.deepEqual(agentNav, [...agentNav].sort((a, b) => a - b));
  });

  test("lists every NAV page exactly once", () => {
    const text = build(allPages());
    for (const rel of Object.keys(NAV)) {
      if (rel === "README.md") continue;
      const needle = `](${pageUrl(rel, SITE)})`;
      assert.equal(text.split(needle).length - 1, 1, `${rel} is listed other than once`);
    }
  });

  test("throws on a page that no group holds", () => {
    const pages = allPages().concat({ relPath: "internal/secret.md", title: "x", body: "y." });
    assert.throws(() => build(pages), /internal\/secret\.md sits in no sidebar group/);
  });
});
