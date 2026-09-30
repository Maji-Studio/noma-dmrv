# Variant brief (PROTOTYPE)

Five landing page variants live on one route (`site/src/pages/variants.astro`, served at `/variants`), switchable with `?variant=A..E`. The question the prototype answers: **which page structure should the noma landing page use?** Variants must differ in layout, information hierarchy and primary affordance, not in colour or copy.

## Read first

1. `docs/plans/2026-09-29-landing-page.md`: decisions and **claim boundaries** (binding).
2. `site/src/content/copy.js`: all approved copy. Use it; don't retype it.
3. `site/src/visuals/index.js`: the five shared visuals and their data attributes, events and controllers.
4. `site/src/variants/VariantA.astro`: the reference variant (conventions, how visuals and the form are placed).
5. `site/src/lib/variant.js` (`onShown`) and `site/src/components/WalkthroughForm.astro`.

## Must appear in every variant

- Nav with the noma by MAJI mark and a "Book a walkthrough" action that reaches the form (`id="walkthrough"`).
- The hero headline exactly as in `copy.hero.title`.
- The simple trace (`data-visual="chain"`) somewhere prominent. The dense graph, map, bins and registry mapping all appear too; placement and size are yours.
- Logos and figures (placeholders as in copy.js), the nine shipped features, the five upcoming features each with the "Upcoming" chip, the spreadsheet comparison, the open-source choice, the walkthrough form, the footer.
- No "Open the demo" button (launch is without the demo).

## Rules

- Edit only your own `site/src/variants/VariantX.astro`. Helpers may go in `site/src/variants/X/`. Do not change shared files; if you need a shared capability, say so in your report.
- Colours and fonts only from `site/src/styles/tokens.css` variables. Light rose page (`--page`). GT Flexa via `var(--f-sans)` / `var(--f-mono)`. Scoped `<style>` in the component; prefix classes with your variant letter.
- New copy (labels, connective lines) is allowed only if short, true to the claim boundaries, no en or em dashes, sentence case. List every new line in your report.
- Client scripts: `<script>` inside the component. Do setup inside `onShown("X", (root) => { ... })` so hidden variants stay idle. Visuals are mounted before `onShown` fires, so `root.querySelector('[data-visual="chain"]').noma.pin("r1")` works there. Trace visuals emit a bubbling `noma:select` event.
- Must work at 400 px wide with no horizontal page scroll, by keyboard, and with `prefers-reduced-motion` (no scroll-jacking; motion is optional garnish).
- No new dependencies. Don't run `astro build` (others share `dist/`); the dev server is already running at http://localhost:3120.

## Check your work

From the worktree root: `node /tmp/claude-501/lp-shot.cjs X 1280` and `node /tmp/claude-501/lp-shot.cjs X 400`. Each prints scroll width and console errors and writes `/tmp/claude-501/lp-shots/X-<width>.png`; read the PNGs and fix what looks wrong. Two or three passes, then stop.
