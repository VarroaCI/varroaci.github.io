// Converts ```mermaid fences into <pre class="mermaid"> before Expressive Code sees
// them. Left as code nodes they render as syntax-highlighted source, which is what the
// docs were showing instead of diagrams.
//
// The client script in MermaidRenderer.astro turns these into SVG.

import { visit } from "unist-util-visit";

/** Mermaid source is placed verbatim; escape so it cannot break out of the element. */
function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function remarkMermaid() {
  return (tree) => {
    visit(tree, "code", (node, index, parent) => {
      if (node.lang !== "mermaid" || !parent || index === undefined) return;

      parent.children[index] = {
        type: "html",
        value:
          `<pre class="mermaid" data-mermaid-source>${escapeHtml(node.value)}</pre>`,
      };
    });
  };
}

export default remarkMermaid;
