// src/pages/llms.txt.ts: the handbook index for language models, served at
// /llms.txt. The text is generated on each build, so no copy is committed.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { NAV } from "../../scripts/sync-docs.mjs";
import { DOCS_GROUPS } from "../../scripts/docs-groups.mjs";
import { buildLlms } from "../../scripts/llms.mjs";
import { AGENTS_PAGE } from "../../scripts/agents-page.mjs";

const EDIT_MARK = "/edit/main/docs/";

export const GET: APIRoute = async () => {
  const entries = await getCollection("docs");
  const pages = entries.map((entry) => {
    const url = String(entry.data.editUrl ?? "");
    const at = url.indexOf(EDIT_MARK);
    if (at < 0) throw new Error(`llms.txt: ${entry.id} has no docs editUrl`);
    return {
      relPath: url.slice(at + EDIT_MARK.length),
      title: entry.data.title,
      body: entry.body ?? "",
    };
  });

  const text = buildLlms({
    pages,
    groups: DOCS_GROUPS,
    nav: NAV,
    site: "https://varroa.dev",
    agentsPage: { ...AGENTS_PAGE, path: "/agents/" },
  });
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
