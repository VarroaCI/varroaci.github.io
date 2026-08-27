# varroaci.github.io

This is Varroa's public site repo: the source for https://varroa.dev (and, before
DNS is wired, the soft-launch URL https://varroaci.github.io). It contains the
Astro + Starlight site under `site/` and the rendered handbook source under
`docs/`.

This repo is **generated**. It is exported, path-for-path, from a private
source-of-truth repo by that repo's `hack/export-site.sh`. Do not assume anything
you add here survives untouched — see the reconciliation mapping below.

## Reconciliation mapping

- **Mirrored paths** — `site/**` (minus `AGENTS.md`, which is internal and never
  exported), `docs/**` (minus `AGENTS.md`, `internal/`, and `superpowers/`),
  `examples/controller-class.yaml`, `LICENSE` — exist identically in both repos. A community PR that changes one of
  these paths in this repo is cherry-picked path-for-path into the private repo.
  The next export re-converges this repo's copy from the private source, so a
  change here that isn't also carried back into the private repo will be
  overwritten by the next publish.
- **Site-repo-only paths** — the root `README.md` (this file) and everything
  under `.github/workflows/` — do not exist at those paths in the private repo.
  They originate from the private repo's `hack/site-overlay/` and are never
  cherry-picked directly. A change to one of these files made here must instead
  be reapplied under `hack/site-overlay/` in the private repo, so the next export
  regenerates it identically.

If you're proposing a change, a docs fix or a `site/` change is the easy path —
open a PR against this repo as usual. A change to this README or to the
workflows needs to land in the private repo's `hack/site-overlay/` first.
