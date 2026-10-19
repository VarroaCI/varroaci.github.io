// The sidebar groups of the handbook, in order. astro.config.mjs and llms.mjs
// read this list.
export const DOCS_GROUPS = [
  { label: "Architecture", directory: "architecture" },
  { label: "Install", directory: "install" },
  { label: "Tutorials", directory: "tutorials" },
  { label: "Configuration", directory: "config" },
  { label: "Security", directory: "security" },
  { label: "Agents", directory: "agents" },
  { label: "Operations", directory: "operations" },
  {
    label: "API & CLI",
    links: [
      { label: "API reference", link: "/docs/api-reference/", page: "api-reference.md" },
      { label: "varroactl CLI", link: "/docs/varroactl/", page: "varroactl.md" },
    ],
  },
];

export function sidebarFrom(groups) {
  return groups.map((g) =>
    g.directory
      ? { label: g.label, items: [{ autogenerate: { directory: `docs/${g.directory}` } }] }
      : { label: g.label, items: g.links.map(({ label, link }) => ({ label, link })) },
  );
}
