// The MCP client snippets shown on /agents. The source is the "Configure a
// client" section of docs/agents/connecting.md. CLIENT_HEADINGS must match the
// ### headings in that section, in order.

export const CLIENT_SECTION = "Configure a client";
export const CLIENT_HEADINGS = ["Cursor", "GitHub Copilot", "Stdio bridge"];

const FENCE = /^(```|~~~)([\w-]*)\s*$/;

/**
 * Returns one { label, lang, code } per heading, in heading order. Throws
 * with the file and the heading when the section or a block is missing.
 */
export function snippetsFrom(
  markdown,
  { file = "docs/agents/connecting.md", headings = CLIENT_HEADINGS } = {},
) {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${CLIENT_SECTION}`);
  if (start < 0) throw new Error(`${file}: no "## ${CLIENT_SECTION}" section`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }

  const snippets = [];
  let cursor = start + 1;
  for (const heading of headings) {
    const at = lines.findIndex((line, i) => i > start && i < end && line === `### ${heading}`);
    if (at < 0) {
      throw new Error(`${file}: heading "### ${heading}" not found under "## ${CLIENT_SECTION}"`);
    }
    if (at < cursor) {
      throw new Error(`${file}: heading "### ${heading}" is out of order`);
    }

    let sectionEnd = end;
    for (let i = at + 1; i < end; i++) {
      if (lines[i].startsWith("### ")) {
        sectionEnd = i;
        break;
      }
    }

    let open = -1;
    for (let i = at + 1; i < sectionEnd; i++) {
      if (FENCE.test(lines[i])) {
        open = i;
        break;
      }
    }
    if (open < 0) {
      throw new Error(`${file}: heading "### ${heading}" holds no fenced block`);
    }

    const [, marker, lang] = lines[open].match(FENCE);
    let close = -1;
    for (let i = open + 1; i < sectionEnd; i++) {
      if (lines[i].trim() === marker) {
        close = i;
        break;
      }
    }
    if (close < 0) {
      throw new Error(`${file}: heading "### ${heading}" holds no fenced block`);
    }

    snippets.push({
      label: heading,
      lang: lang ?? "",
      code: lines.slice(open + 1, close).join("\n"),
    });
    cursor = close;
  }
  return snippets;
}
