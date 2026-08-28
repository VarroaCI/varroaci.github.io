// astro.config.mjs — Varroa public site (varroa.dev): brochure pages plus a
// Starlight-rendered copy of the operator handbook under /docs/. See
// the generated-path and publication contracts for the
// full contract.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import { remarkMermaid } from "./src/plugins/remark-mermaid.mjs";

export default defineConfig({
  site: "https://varroa.dev",
  integrations: [
    starlight({
      title: "Varroa",
      components: {
        // Wraps Starlight's default Head and adds the mermaid renderer.
        Head: "./src/components/Head.astro",
        // Carries the brochure's brand mark into /docs/ so the header is
        // consistent across /, /compare/ and the handbook.
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      description: "Kubernetes-native Jenkins fleet management",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/VarroaCI/varroa-jenkins",
        },
      ],
      // editLink.baseUrl deliberately left unset: sync-docs.mjs emits a
      // per-page editUrl frontmatter override pointing at the page's
      // original docs/ source path. A global editLink.baseUrl would append
      // Starlight's *generated* path instead, which is wrong for renamed
      // README.md pages (see design §2).
      sidebar: [
        { label: "Architecture", items: [{ autogenerate: { directory: "docs/architecture" } }] },
        { label: "Install", items: [{ autogenerate: { directory: "docs/install" } }] },
        { label: "Tutorials", items: [{ autogenerate: { directory: "docs/tutorials" } }] },
        { label: "Configuration", items: [{ autogenerate: { directory: "docs/config" } }] },
        { label: "Security", items: [{ autogenerate: { directory: "docs/security" } }] },
        { label: "AI & Agents", items: [{ autogenerate: { directory: "docs/agents" } }] },
        { label: "Operations", items: [{ autogenerate: { directory: "docs/operations" } }] },
        {
          label: "API & CLI",
          items: [
            { label: "API reference", link: "/docs/api-reference/" },
            { label: "varroactl CLI", link: "/docs/varroactl/" },
          ],
        },
      ],
      // Pagefind search stays on (Starlight's default — no `pagefind: false`
      // here).
      plugins: [
        starlightLinksValidator({
          // docs/tutorials/first-controller.md legitimately tells the
          // reader to open http://localhost:8080 (kubectl port-forward
          // target); it is not a stray internal link.
          errorOnLocalLinks: false,
        }),
      ],
      customCss: ["./src/styles/tokens.css"],
      head: [
        {
          tag: "script",
          content: `
            // Default first-time visitors to dark theme. Only writes the
            // storage key when it is absent, so a visitor's previously
            // saved selection (light or dark) is never overwritten. Must
            // run before Starlight's own theme script reads the key, so
            // it is injected via the head config rather than a body
            // script.
            (function () {
              try {
                if (!localStorage.getItem("starlight-theme")) {
                  localStorage.setItem("starlight-theme", "dark");
                }
              } catch (e) {
                // Storage inaccessible (private mode, disabled storage) —
                // Starlight's own default handles this visitor instead.
              }
            })();
          `,
        },
        {
          tag: "script",
          content: `
            // Expressive Code renders wide fenced code blocks with their own
            // horizontal scroll (overflow-x: auto on the <pre>). Axe flags
            // scrollable-region-focusable for any such region a keyboard
            // user cannot reach — only tag the ones that actually overflow.
            document.addEventListener("DOMContentLoaded", function () {
              document.querySelectorAll(".expressive-code pre").forEach(function (pre) {
                if (pre.scrollWidth > pre.clientWidth) {
                  pre.setAttribute("tabindex", "0");
                  pre.setAttribute("role", "region");
                  pre.setAttribute("aria-label", "Code block, scrollable horizontally");
                }
              });
            });
          `,
        },
      ],
    }),
  ],
  markdown: {
    remarkPlugins: [remarkMermaid],
  },
});
