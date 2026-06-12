# Visual Design Improvement Plan

**Date:** 2026-06-12
**Status:** Approved direction, phased rollout
**Inspiration source:** `~/Downloads/Maji noma dMRV` (Maji UX studio concept screens + `theme.css` token layer)

## Direction (decided 2026-06-12)

1. **Warm light theme adopted globally** — `#FFF9F7` (clr-orange @ 5% over white) page field, pure-white panels, plum-tinted hairline borders. Light mode only; dark mode deferred.
2. **Chain of custody stays light** — no dark canvas; instead stronger accent usage, readable nodes, colored Sankey.
3. **Dashboard: full build** — target is the `01-dash` inspiration mock (KPI strip with sparklines, verification queue, feedstock mix, custody ribbon).
4. **Navigation: keep the dark plum sidebar** — refine typography, group accents, and the facility switcher; no top-bar migration.

## Why

The app and the inspiration already share DNA (GT-Flexa, mono uppercase labels, brutalist corners, plum). The gap is **temperature, depth, and discipline**: a cold gray field with white-on-near-white panels, three competing status-badge implementations, three row-action styles, two form grammars, a placeholder dashboard, and a chain-of-custody view that reads as a wireframe. The inspiration's token layer closes most of the gap cheaply.

---

## Phase 0 — Theme foundation (tokens only, app-wide effect)

Port the inspiration token layer into `src/app/globals.css`:

- `--bg: #FFF9F7` page field (replaces `--color-background-light: #fafafa` at the page level), `--paper: #FFFFFF` panels, `--ink: #0F021A`.
- Plum-tinted hairlines: `--edge: #480B73`, `--edge-soft: rgba(72,11,115,0.45)` — used for emphasized borders/dividers; existing gray border tokens remain for quiet chrome.
- Status ramp with ink variants (replaces ad-hoc signal-green usage):
  `--st-ok: #17744A` · `--st-run: #6E2BA8` · `--st-wait: #BC4519` · `--st-off: rgba(15,2,26,0.4)` · `--st-bad: #E54552`.
- Accent triad **ink variants** for text-on-light (`--acc-prod-ink: #BC4519` etc.) so accent text always passes contrast.
- **Sync accent alpha ramps to the new token set** (Figma variables, 2026-06-12): every accent color ships the extended ramp `100 / 80 / 60 / 40 / 30 / 20 / 10 / 5 / 1` (e.g. `--clr-rose-30`, `--clr-orange-5`, `--clr-orange-1`), not the current 6-step ramp. The 5/1 steps are the wash/field tints (the warm `--bg` is effectively orange-5 over white).
- Update `docs/design-system.md` to match; deprecate `--color-signal-green` in favor of `--st-ok`.

**Acceptance:** every routed page sits on the warm field with white panels; no component-level changes required yet.

## Phase 1 — Component debt that blocks everything else

- `Button`: add `destructive` variant (red border/text, red-10 hover) and a quiet icon-button size; then migrate the **86 raw `<button>`s in 45 files** (worst: `customer-form`, `data-table`, `map-controls`, `facility-selector`, `form-file-upload`).
- **One StatusBadge.** Fold the hand-rolled badges in `production-run-list`, `credit-batch-list`, `reactor-list` into `@/components/ui/status-badge` (add icon support); map all states to the Phase-0 status ramp.
- **EmptyState everywhere.** 14 of 16 entities hand-roll empties; migrate them to the shared component.
- Fixes from the token audit: `rounded-[8px]` on the 5 auth pages → `rounded-none`; hardcoded `bg-[#0f021a]` / `bg-[#0c0114]` in `facility-selector` / `mobile-nav` → tokens; stray `font-semibold` / `text-[12px]` → typography classes.

## Phase 2 — One page shell + quiet tables

- **Canonical list-page shell:** mono uppercase area eyebrow (PRODUCTION / DISTRIBUTION / …) → `title-heading-2` title → one-line subtitle (every page gets one) → KPI strip → toolbar → list. Fix deviants: Production Runs/Orders (missing subtitle), Energy (sentence-case title, divergent KPI card style), Chain of Custody (different page padding).
- **One KPI card** style (gray-filled today vs white-bordered on Energy) with an optional sparkline slot — this becomes the dashboard building block.
- **Quiet the tables:** one row-action pattern across all 11 table entities (recommend: actions revealed on row hover / overflow menu; destructive variant for delete; kill the always-on red outlines). Row click opens the detail sheet consistently.
- Normalize the credit-batches grid breakpoint (`lg:` → `xl:grid-cols-3`).
- **Side-sheet mounting consistency (added 2026-06-12, user call-out):** some sheets slide in/out, some pop — caused by two mounting patterns. Conditional mounting (`{sideSheet && <EntitySideSheet open …>}`) skips both enter and exit animations; the always-mounted controlled pattern (`open={!!sideSheet}`) animates correctly. Convert all conditional-mount lists (customers, suppliers, facilities, production-runs, applications, feedstocks, reactors, credit-batches) to the controlled pattern.

### Phase 2 decisions (resolved 2026-06-12)

- Row actions: **overflow menu** (⋮ via `RowActionsMenu` on a new `DropdownMenu` primitive) — touch-friendly, kills the always-on red outlines.
- Suppliers/Customers View button: **dropped**; row click keeps opening the side sheet, the `/customers/[id]` detail route moves into the menu as "Open details".
- KPI card: **white-bordered wins** (`--paper` + hairline, the Energy style) — gray-filled retired; `StatCard` moved to `@/components/ui/stat-card` with a `sparkline` slot.
- Credit-batches grid: already normalized (`xl:grid-cols-2 2xl:grid-cols-3`, matches facilities) — no change needed.

## Phase 2.5 — Surface & figure-ground treatment (added 2026-06-12, user call-out)

**Problem:** on the warm `--bg` field, the pure-white surfaces — tables, KPI cards, filter bars, entity cards — don't sit well: hairline borders alone give too little figure/ground separation, so panels read as flat floating boxes and pages look washed. This needs real design iteration, not a token swap.

**Approach (iterate visually in the browser, screenshot → adjust → repeat; consult the inspiration mock at `~/Downloads/Maji noma dMRV` + its `theme.css` for how the concept screens ground their surfaces):**

- Define ONE panel recipe as tokens (`--panel-border`, `--panel-shadow`, optional `--panel-bg`) and apply it through the shared components (StatCard, DataTable frame, Card, filter bars) — never per-page classes.
- Candidate treatments to compare side-by-side before choosing:
  1. **Tinted hairline + soft warm shadow** — plum/warm two-layer shadow (e.g. `0 1px 2px rgba(72,11,115,0.06), 0 2px 8px rgba(188,69,25,0.04)`) so white panels lift off the field.
  2. **Tinted table chrome** — header row on an `--clr-orange-1`/`--sea` wash, hairline row dividers, warm row hover; frame the DataTable (toolbar inside a bordered panel) instead of letting a full-bleed white table sit flush on the warm field — tables are the worst offenders.
  3. **Off-white panels** — panels at orange-1-over-white, reserving pure white for elevated surfaces only (menus, side sheets, dialogs) so elevation has a hierarchy.
- Whatever wins: verify at 1440px on facilities, orders, production-runs, energy, credit-batches; check contrast stays ≥ 4.5:1 for text on tinted chrome.

### Phase 2.5 findings & decisions (resolved 2026-06-12)

What the inspiration mock actually does (verified against `dmrv.css` + concept screens):
**zero box-shadows, zero tinted panels** — its entire figure/ground mechanism is a
**hairline hierarchy**: `--hair` (1.5px full-ink) panel outlines, `--hair-2` (1.5px @ 20%)
secondary structure, `--hair-3` (1px @ 10%) row dividers, plus the "two greys" rule
(every grey is a plum alpha, never a neutral). Consequences:

- **Candidate 1 (warm shadow) is rejected** — it contradicts the DS "no drop shadows"
  rule, and in practice rendered near-invisible at 1440px. Built and compared anyway;
  the `html[data-surface="shadow"]` branch can be deleted once a winner is locked.
- **Root cause of the washed look was not border *strength* alone but border
  *temperature*:** the semantic tokens (`--color-border-*`, `--color-text-*`,
  `--color-background-light/medium/strong`, `--color-surface-*`) pointed at cool
  neutral grays (#e1e2e2, #5f6565, #f5f5f5…) that read dirty on the warm field.
  All re-pointed to plum alphas in `globals.css` — one change warm-corrected every
  hand-rolled card, divider, and muted label app-wide.
- **Panel recipe shipped as tokens** (`--panel-bg/-border/-shadow/-head-bg/-head-border`,
  `--row-divider/-hover-bg/-stripe-bg`) applied through StatCard, the DataTable frame,
  Card, facility/storage cards, and the energy per-stage table. **Winner (user pick,
  2026-06-12): 1.5px plum hairline @ 40%** (`--panel-border: 1.5px solid
  var(--clr-dark-purple-40)`) — mock-faithful full ink was tried and judged too heavy
  for app-density layouts; 20% under-separated. The shadow candidate and the
  `data-surface` compare switch were deleted.
- **DataTable framed:** toolbar + pagination now live inside the bordered panel
  (pagination moved below the table in the DOM — was rendering above it), header row
  on the `--sea` wash with **mono uppercase micro-labels** (new `.label-micro` class,
  the 12px sibling of `title-chapter-title`), 1px 10%-plum row dividers, `--sea` row
  hover, **zebra striping retired** (the mock separates rows with dividers, not stripes).
- **Alpha washes are not opaque surfaces:** re-pointing `--color-background-light` to a
  2% alpha made the side sheet translucent (caught by user). Rule recorded: overlays
  (sheets, menus, dialogs) get pure `--paper` + a full-ink hairline and **no shadow**
  (scrim + border do the elevation); tinted alphas are only for fills *inside* panels.
  Pure white is reserved for elevated surfaces — the field stays warm.
- **StatusBadge squared** (`rounded-[4px]` removed — brutalist rule) and reused for the
  certifier readiness chips (`entity-certify-readiness-badge`, batch health summary),
  killing the last divergent hand-rolled status pills (user call-out).
- Gotcha for future toggles: flipping a token-bearing attribute at runtime on elements
  with `transition-colors` + `border: var(--…)` shorthand pins the old border color in
  Chrome (stuck transition). Real page loads are unaffected; kill transitions before
  flipping when screenshot-comparing.

## Phase 3 — Side-sheet & form system (sampling first — worst surface in the app)

- **One form grammar — the production-run style is the keeper:** small mono uppercase section labels, tight 2-col grid, derived-value strips, CERT chips, sticky footer. ~~**Rebuild the Create/Edit Sample sheet first**~~ **DONE 2026-06-12 (pulled forward into the Phase 2.5 branch, user call-out):** accordions removed from `sample-form.tsx`; now flat `SectionLabel` sections with hairline dividers in the production-run grammar; the conditional 1000-year block renders as two flat sibling sections (R₀ Reflectance · TGA), nutrient fields stay behind the claim checkbox.
- Extract shared `FormSection` / section-label primitives so sheets can't drift again.
- Document the spacing rule (`space-y-20` standard; `space-y-24` only for full-page/auth forms) in `docs/forms.md`.
- Side-sheet chrome: consistent header (code + date subtitle), section treatment, and footer CTA row across all 14 entity sheets; detail-sheet section headings get the same mono label treatment.

### Phase 3 implementation notes (resolved 2026-06-12, `feat/visual-design-phase-3`)

- **`FormSection` shipped** (`src/components/forms/form-section.tsx`): SectionLabel +
  `space-y-16` stack + `pt-16` hairline divider (first section `divider={false}`);
  `hint`/`certifyRequired` forward to SectionLabel; `actions` slot absorbs trailing
  header chrome (Add Bin / Add Ingredient buttons, ReadOnlyBadge) so no section
  header stays hand-rolled.
- **Migrated** all sectioned forms: sample, production-run, production-sample,
  production-incident (local SectionLabel copy deleted), feedstock, biochar-product,
  formulation, credit-batch, application, transport-leg. Top-level sheet-form rhythm
  normalized to `space-y-20` (the documented standard); `space-y-24` is now
  full-page/auth only.
- **Nested CTA rows unified:** production-sample and production-incident forms moved
  from hand-rolled button rows to `FormActions sticky={false}` (their wrappers became
  real `<form>` elements — nesting-safe because ProductionRunForm renders `children`
  after its `</form>`).
- **DetailSection re-cut** to mirror FormSection: mono SectionLabel heading, flat
  hairline-divided sections (gray `rounded-[8px]` box removed — brutalist rule);
  EntitySideSheet/EntityDetailPanel view-body gap 32→20 for view ↔ edit parity.
- **Header chrome:** create mode = title only (filler subtitles like "Fill in the
  form to…" dropped across 12 lists); view/edit keeps code title + contextual
  subtitle (name or date). Customer/supplier full-page detail routes left to the
  page-shell pattern (Phase 2 scope, not sheets).
- Spacing rule + FormSection/FormActions usage documented in `docs/forms.md`
  (design-system.md already carried the 20/24 rule).

## Phase 4 — Chain of custody (light, but no longer a wireframe)

- Tinted canvas (`--sea`-style plum/rose wash at ~4%) + dotted grid so the graph has figure/ground; panels stay white.
- **Node redesign:** stronger accent-triad coding (left edge + header chip with ink-variant text), readable primary line at default zoom, kg labels on edges only at sufficient zoom.
- **Sankey:** full color ramp per stage (rose biomass → orange production → red biochar → purple field use, per the inspiration's carbon-flow ribbon); relocate the mass-balance warning out of the column-title row.
- **Map:** never render a white void — graceful no-basemap fallback (tinted field + grid + node markers still plotted) and a visible "basemap unavailable" note; align page padding with the app shell.

### Phase 4 implementation notes (resolved 2026-06-12, `feat/visual-design-phase-4`)

- **Canvas:** DAG + Sankey React Flow canvases sit on the `--sea` wash with a
  28px plum dotted grid; shared chrome constants (`GRAPH_CANVAS_CLASS`,
  `GRAPH_DOTS`, `GRAPH_CONTROLS_CLASS`, minimap) live in `chain-constants.ts`.
  Controls/minimap are paper boxes with full-ink hairlines, hover-inverting.
- **Nodes** rebuilt to the concept recipe: 1.5px plum-20 frame + 3px accent
  left edge, accent-**ink** header chip (type label + icon), mono 21px primary
  line (date-first kept), label/value detail rows (mono micro-label left,
  light value right). `detailLines: string[]` became structured
  `details: {label, value}[]` — the map popups consume the same rows.
  Distribution accent moved rose → pink (`--acc-dist`), matching the accent
  triad and the existing map markers; trail chips/labels use ink variants.
  Status pills squared with a 6px dot, mapped to the `--st-*` ramp.
- **Edges rebuilt as `ChainEdge`** (user call-out, 2026-06-12): paper casing
  under each line keeps crossings separable; the kg chip renders via
  `EdgeLabelRenderer` and hides below zoom 0.62 (`EDGE_LABEL_MIN_ZOOM`,
  store-driven — a globals.css attribute-selector approach was dropped after
  the compiled chunk silently omitted the rule).
- **Hover focus** (user call-out, 2026-06-12): hovering a card dims every
  card/edge outside its lineage (ancestors + descendants, computed per hover
  in `ChainFlowGraph`) and thickens the path edges; interactive cards get a
  fade-in header affordance (↗ open record / trace icon for batch drill-down).
  `NODE_HEIGHT` raised to 232 so tall feedstock cards (wrapping supplier
  names) can't overlap in dense batch graphs.
- **Sankey:** stage ramp rose → orange → red → purple; ribbons are
  source→target SVG gradients at 0.5 stop-opacity with an animated marching
  centerline (`.coc-flow-line` in globals.css, reduced-motion safe);
  mass-balance warnings relocated bottom-right out of the column-title row;
  warning chrome unified (dashed `--st-wait` boxes here and on the DAG).
- **Map keyless fallback:** MapLibre now always mounts — without
  `NEXT_PUBLIC_MAPTILER_KEY` it runs a blank transparent style over a
  sea-tinted dotted field (`.cvm-field`), so markers/legs/chips stay plotted
  and the SAT raster (key-independent) still toggles; a corner "basemap
  unavailable" note replaces the old centered void. WebGL failure keeps the
  explicit notice.
- **Header padding** aligned with the app shell (`container-max`); split-view
  panels use the Phase-2.5 panel hairline (1.5px plum-40).

## Phase 5 — Dashboard + credit batch detail

- **Dashboard (the `01-dash` mock):** breadcrumb eyebrow + display headline; 5-card KPI strip with sparklines and delta badges (`StatCard` exists, unused); verification/needs-attention queue (reuse certification overview data); feedstock mix bars; custody flow ribbon (reuse Sankey aggregates); date-range toggle.
- **Credit batch detail page:** proper detail header (code, status badge, period, facility, KPI row: CO2e stored / weight / buffer / applications); clear separation of read panels vs the edit form (today inputs sit directly in the "detail" view); health check restyled as a compact checklist strip.

### Phase 5 implementation notes (resolved 2026-06-12, `feat/visual-design-phase-5`)

- **Dashboard data: one new aggregate endpoint won** (the plan's open question).
  Standard layered flow — `data-access/dashboard-overview.ts` → `fn/` →
  `use-dashboard-overview` — returns KPIs (value + delta vs the previous
  equal period + a 12-bucket sparkline series), the attention queue, the
  feedstock mix, and the custody-flow totals in one facility-scoped read.
  Row-narrow fetches, aggregation in JS (facility scale, not SQL bucketing).
  The pre-existing **orphaned `dashboard-stats` chain was deleted** (component
  was never rendered anywhere).
- **KPI strip reads as the mass-flow story** left → right: Feedstock
  processed → Biochar produced → Pyrolysis yield → Applied to soil → CO₂e
  stored — mirroring the custody ribbon below. No data renders "—", never a
  fabricated zero; yield only counts runs that recorded both sides of the
  conversion. `StatCard`'s sparkline slot (built Phase 2, unused since)
  finally lights up.
- **Needs-attention queue = derived record checks, not a task system**
  (concept adopted from the codex operator dashboard — merged via #237 mid-
  phase and replaced wholesale by this build; its `CONTEXT.md` "Attention
  item" term stays canonical):
  cheap capped queries over existing MRV records — complete runs missing
  mass, lots with no linked run, feedstocks `missing_data`, upcoming
  deliveries, pending batches past their period — each row links to where
  the record is fixed and disappears when it is. The plan's "reuse
  certification overview data" was **rejected**: that loader walks lineage
  per removal (too heavy for a dashboard tile) and is registry-gated, so a
  facility without a registry link would lose its queue.
- **Custody flow ribbon reuses the Sankey grammar, not the Sankey walk:**
  new pure `buildStageFlow(totals)` sibling beside `buildBatchSankey` in
  `src/lib/chain-of-custody/sankey.ts` (same columns, same labeled exits,
  same clamp-negative-residuals-to-warning rule; unit-tested in
  `tests/dashboard-stage-flow.test.ts`). The batch-level per-application
  rollback resolution is O(N) queries — facility-period totals come from
  SQL sums instead. The batch-only ineligible-feedstock exit has no
  facility-period analogue and is omitted. Rendered as a static SVG with
  the batch Sankey's exact recipe (accent ramp rose→orange→red→purple,
  source→target gradients @ 0.5, marching `.coc-flow-line` centerline);
  below `sm` the diagram is dropped (not shrunk to noise) and exits render
  as text rows.
- **Header is the mock's display headline** (`title-heading-1` + `-thin`
  span), not the standard PageHeader — the dashboard is the one
  intentional exception to the list-page shell. Period toggle = the mock's
  `.seg` segmented control (30D / YTD / ALL; "all" disables deltas).
- **Credit batch detail recut:** PageHeader (VERIFICATION eyebrow, code,
  status badge in actions) → 4-card KPI row (CO₂e stored falls back to the
  certify preview, labeled "Preview estimate") → health check as a compact
  chip strip (`credit-batch-health-strip.tsx`, same `useBatchHealth`
  classifier + fix-link mapping; the full `CreditBatchHealthPanel` deleted)
  → read panels (`DetailSection`/`DetailField`) with the edit form mounted
  only behind the "Edit details" toggle. Page moved onto the canonical
  `container-max` shell.
- E2E: `tests/e2e/dashboard.spec.ts` (dashboard panels + period toggle;
  batch detail read/edit toggle + health strip).

---

## Sequencing & verification

Each phase is a separate branch/PR in order (0→5); 0+1 can land together. After each UI phase: `pnpm lint`, `pnpm build`, Playwright smoke (`pnpm test:e2e`), plus a browser pass at 1440px and mobile width (mobile guard spec: `tests/e2e/mobile-responsive.spec.ts`).

## Open questions (decide per-phase, recommendations noted)

- Row actions: hover-reveal vs always-visible overflow menu (rec: overflow menu — touch-friendly).
- Suppliers/Customers "View" button vs row-click-to-detail everywhere (rec: row click, drop View).
- ~~Dashboard data: live queries from existing hooks vs new aggregate endpoints~~ — resolved Phase 5: one new aggregate endpoint (`dashboard-overview`), see the Phase 5 notes.
- Dark mode: deferred; tokens are structured so a `html[data-theme]` flip remains possible later.
