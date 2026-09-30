# Layout variant brief (PROTOTYPE, never merge)

Branch `prototype/landing-width-variants`. Ten layout variants of the noma landing page, each on its own static route `/v/<n>/`, plus today's page on `/` as variant 0. A floating switcher (bottom centre, ← / → keys) cycles through them. Dev server: http://localhost:3122 (already running; do not start another, do not stop it).

## The question

Kenji saw the current page (edge to edge, full-bleed visuals, gutter only) and said: **"I think edge to edge is not that much readable."** Each variant is a different answer to: *what page width, measure and composition make this page easy to read at 1280, 1440, 1920 and 2560 px, and still work at 400 px?*

What the current page gets wrong at 1920 and 2560 (so every variant has something to beat):
- The hero headline runs to about 1600 px, and the lead and the figures are split across a very wide row.
- The trace's "How to read it" side panel sits at the far right viewport edge, about 1300 px from where the eye starts on the diagram.
- The dense trace and the map are letterboxed at 2560 (`--viz-max-h: 820px`), leaving empty wings.
- Section heading grids (heading left, lead right) push the lead far from its heading.
- Full-width rules and bands mixed with boxed panels give two competing edge systems.

Readability targets: prose at 60 to 75 characters per line; a diagram's explanation within easy eye reach of the diagram; one consistent edge system per variant.

## Read first

1. `site/src/pages/index.astro` (variant 0) and the components it composes in `site/src/components/`.
2. `site/src/styles/tokens.css`: the only source of colours, fonts, type scale and layout tokens (`--gutter`, `--measure`, `--side-width`, `--viz-max-h`, `--viz-pad`, `--side-pad`).
3. `site/src/visuals/index.js` and `site/src/visuals/visuals.css`: the five interactive visuals (chain, dense, map, bins, morph), their `data-*` options (e.g. `data-side="right|below|none"`) and the `.nv-*` classes.
4. `site/src/content/copy.js`: all approved copy.
5. `docs/plans/2026-09-29-landing-page.md` on branch `docs/landing-page-plan` (worktree `.claude/worktrees/landing-plan/docs/plans/`): sections "Visual language", "Claim boundaries", "Page, top to bottom".
6. `docs/design-system.md` in the repo root only if you need the app's panel conventions.

## What you own

- `site/src/pages/v/<n>.astro` for your variant(s). Each starts as a copy of `index.astro` with `layout="<n>"` on `BaseLayout`. Rewrite it freely.
- Optional helpers in `site/src/variants/v<n>/` (variant-only components or CSS).
- **Do not edit shared files**: `site/src/components/*`, `site/src/visuals/*`, `site/src/styles/tokens.css`, `site/src/layouts/*`, `site/src/content/copy.js`, `index.astro`, the switcher. Nine other variants use them. To change how a shared component lays out, override from your own page: `<html data-layout="<n>">` is set for you, so page-level `<style is:global>` rules scoped under `:root[data-layout="<n>"]` (including token overrides like `--gutter`, `--measure`, `--side-width`, `--viz-max-h`) only affect your route. Scoped `<style>` plus `:global(...)` also works. If a variant truly needs different markup than a shared component emits, copy that component into `site/src/variants/v<n>/` and change the copy.

## Must stay true in every variant

- **Copy is approved and frozen.** Every string comes from `copy.js`. No new sentences, headings, labels or eyebrows. A table of contents or step labels must reuse existing strings (nav labels, section titles). No en or em dashes. No "live", "integrated", "only" or "first" claims. Two flagged strings stay as they are.
- **All content appears**: header with the noma by MAJI mark and the "Book a walkthrough" action reaching `#walkthrough`; hero headline, lead, one hero action (only one), figures and logos (placeholders stay visibly marked); chain trace; dense trace with its screenshots; map; bins with its side text; shipped and upcoming features (each upcoming with its chip); comparison table; registry morph; open-source options; walkthrough form; footer. You may reorder sections after the hero if your variant's idea needs it; say so in your report.
- **App design-system look**: warm `--bg` ground, white `--paper` panels with `--panel-border`, `--row-divider` hairlines, square corners, no shadows, GT Flexa (`--f-sans`, `--f-mono`). `.label-micro` (mono caps) only for header rows and table headers; captions, labels and eyebrows stay sentence case. The palette tokens are the palette; darker bands (e.g. `--clr-dark-purple`) are allowed only if every text colour on them passes 4.5:1.
- Component CSS reads tokens; no literal colours. Layout literals (a max-width like 1280px, a column like 72ch) go in custom properties at the top of your page style.
- No file over 1000 lines. No new dependencies. pnpm only.
- Works at 400 px with no horizontal page scroll, by keyboard (trace pinning with Enter / Space still works), and with `prefers-reduced-motion` (nothing animated).
- **Do not run `astro build` or `astro check`** (other agents share the tree and `dist/`). Do not commit; the orchestrator commits.

## Check your work

Screenshot script (writes `/tmp/claude-501/landing-site-scripts/shots/<name>-<width>.png`, prints scroll width and console errors):

```
LP_URL=http://localhost:3122/v/<n>/ node /tmp/claude-501/landing-site-scripts/lp-shot.cjs 1440 v<n>
```

Run it at 400, 1280, 1920 and 2560 and look at the PNGs (Read the image). Full-page PNGs at 2560 are tall; that is fine. Fix what reads badly. Two or three passes, then stop. For comparison, variant 0 is at `LP_URL=http://localhost:3122/`.

## Report back

For each variant: the idea in two sentences; container widths and prose measure you chose; where each diagram's explanation sits relative to the diagram; any section reordering; any shared component you copied and why; the scroll width and console errors at each width; what you think is weakest about it.

## Round 2 (2026-09-30): Apple and Vercel

Kenji liked **6 (Apple style)** and **8 (Vercel style)**. Round 2 refines both and adds two hybrids. Everything above still applies (frozen copy, tokens, what you may edit, no build, no commit). The switcher now lists 0, 6, 8, 11, 12 first.

Measured problems to fix (from the round 1 review):
- **Diagram labels too small.** The chain trace's labels are 11 units in a 1010-wide viewBox, so they render at 11px only when the chain SVG is at least 1010px wide. Target: chain and dense SVGs at 1010px or wider at 1440 and above. v8 is at about 900px because the "How to read it" panel sits beside it inside a 1360px frame.
- **The side panel is also the hover readout.** It shows details of the record under the pointer. Beside the diagram is better for that than below a tall one, as long as the diagram keeps its 1010px. If it can't, put the panel below and keep the diagram short enough that the panel shows on a 900px-tall screen while hovering, or say why not.
- **v6:** page about 14,000px tall at 1920; the three-line 112px hero pushes the trace below the first screen; long centred leads (registry) read poorly, since centred text changes its line starts; at 1760px the diagram-to-panel eye travel is long again; the two figure tiles are uneven.
- **v8:** bento cells with wide spans leave half their width empty; purple and rose section heads stack many full-width hairlines; the hero is large enough to push the demo down; at 400px the frame rules sit on the viewport edge.

Check with the scripts in the orchestrator's scratchpad (Node, Playwright; they read `http://localhost:3122`):
`/private/tmp/claude-501/-Users-kenji-Dropbox-Maji-18-Dark-Earth-Carbon-noma-dmrv/d834ef15-fa4e-40a8-9d78-471157defa94/scratchpad/`
- `sweep.cjs <keys>`: overflow, console errors, prose characters per line, chain width and panel side, page height at 400 to 2560, plus screenshots in `shots/`.
- `labels.cjs`: label line-box heights on chain and dense (pass your keys, e.g. `labels.cjs 6,8`). A line box of about 15px means an 11px font.
- `scrollviz.cjs`: which diagrams scroll sideways at 1280, 1440 and 1920 (pass keys the same way). None may, at 1280 and above.
