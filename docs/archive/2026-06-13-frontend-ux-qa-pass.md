# Frontend / UX QA Pass — 2026-06-13

Browser-based UX/UI review of `http://localhost:3100`, authenticated as Admin,
against facility `Operator Facility mqceboe4` (`f346545f-…`, full operator data).
No auth/authz bypass.

This pass is **purely frontend / UI design** — consistency, placement, sizing,
user-friendliness — and is the design-quality complement to the three prior
operator/engineering passes:

- `2026-06-13-full-browser-e2e-qa-results.md`
- `2026-06-13-operator-e2e-removal-ghg-plan.md`
- `2026-06-13-operator-qa-pass-3.md`

Open decision issues **#245 / #246 / #247** (zero-removal GHG, readiness badge
semantics, removal-draft preconditions) are out of scope here.

## ⚠️ Testing constraint — read first

The automation-driven Chrome window could **not be resized** (it stayed pinned at
**514px CSS wide**, `resize_window` had no effect, zoom shortcuts unsupported). So
**every observation in this pass is at a single ~514px-wide viewport** — a narrow
tablet / large-phone width. This is genuinely useful (it exercises the in-flight
`fix/visual-improvements-details` responsive work), but it means:

- **Desktop (≥1280px sidebar rail, multi-column KPI strips, full-width tables) was
  not observed in-browser.** Desktop-specific behaviour was inferred from CSS /
  component code where noted.
- **Phone (390px) and tablet (768px) breakpoints were not separately verified.**

Several findings below are width-independent (date formats, status colours, row-action
affordances, copy). Those marked _(narrow)_ are observed at 514px and need
re-verification at phone/desktop before sizing the fix.

## In-flight work verified, NOT re-reported

Branch `fix/visual-improvements-details` was open during this pass. The following
were confirmed working and are **not** flagged as new bugs:

- Slide-over panel opens inside the viewport, full-width on mobile, Escape closes it
  (offscreen-transform fix now lives in `globals.css`).
- `page-shell` responsive vertical rhythm (20→24→32px) renders correctly.
- Production-run readings table sticky header.
- Position-picker map out-of-range guard.
- The Next.js dev-mode indicator ("N" circle, bottom-left) is **dev-only**, not app
  UI — ruled out as a finding.

## Tested routes

`/dashboard`, `/facilities`, `/feedstocks`, `/production-runs`, `/suppliers`,
`/storage-locations`, `/credit-batches`, `/biochar-products`, `/reactors`,
`/energy`, `/chain-of-custody` (DAG + Sankey), `/certification` → `/certification/removals`,
`/certification/ghg-statements` (+ New GHG Statement wizard), `/certification/settings`,
`/admin`, plus the mobile navigation drawer and the Feedstock create sheet
(representative of the shared FormSpine / FormActions / EntitySelect / validation
components).

Entities confirmed to share the generic data-table list (Code/label rows + `COLUMNS`
+ `⋮` kebab + arrow pager): feedstocks, production-runs, suppliers, biochar-products,
reactors. Bespoke-card entities: facilities, credit-batches. Unique layouts: storage
(3-lane board), chain-of-custody, energy, admin/settings (hub/tab pages).

## Tested workflows

- Sidebar / mobile-drawer navigation across all areas; facility context preserved in
  `?facility=` on every link.
- Create flow: opened the Feedstock create sheet via `?create=true`; empty-submit
  validation; EntitySelect dropdown; Escape-to-close.
- Certification flow end-to-end surfaces: Removals list → GHG Statements list → New
  GHG Statement wizard (step 1) → Settings (Connection tab). No external submission
  triggered.
- Chain-of-custody: selected credit batch `CB-26-001`, viewed DAG and Sankey.

## Edge cases attempted (UX lens)

- Long / hostile names in lists (facility `Trim ⚠️ <b>QA</b>` — confirmed **HTML is
  safely escaped**, rendered literally, no injection).
- Primary identity at narrow width (dashboard H1 facility name).
- Empty-value rendering across entities (`—` vs `0` vs `0.00 t` vs `Empty`).
- Required-field signalling before vs after submit (asterisk vs inline error vs prior
  "Required" premature copy).
- Unit rendering across cards, labels, capacity meters, and uppercase headers.
- Date rendering across every surface (lists, cards, native input, registry rows).
- Same status word across different entities (`Submitted`, `Ready`, `Complete`,
  `Pending`).
- Footer CTA order/alignment between standard sheet and wizard.
- Graph/table behaviour at narrow width (CoC DAG, energy per-stage table).
- Pluralisation of counts (`1 application` vs `1 applications`).

## Findings

Severity: **P1** = clearly wrong / blocks comprehension · **P2** = visible
inconsistency, friction · **P3** = polish / nit. None are crash-level (those were
covered by prior passes).

### Cross-cutting consistency (the big ones)

| # | Sev | Finding | Evidence | Owner |
|---|-----|---------|----------|-------|
| 1 | P1 | **Date formats are inconsistent across the app — 4+ forms.** Same product shows dates as `Jun 13, 2026` (feedstocks, products), `01/04/2026` (production-runs — **ambiguous** D/M vs M/D), `Jun 1, 2026 — Jun 30, 2026` (credit-batches), `2026-06-13 → 2026-06-30` ISO (certification removals/GHG), and `13.06.2026` / `dd.mm.yyyy` in native date inputs. For a compliance/registry product with a documented date-shift history, ambiguous + divergent dates are a real risk. | production-runs list vs feedstocks list vs removals vs credit-batches | Design System / Frontend → **issue filed** |
| 2 | P1 | **Three different row-action affordances** for the same edit/delete intent. Facilities: text `EDIT` + **red** archive icon. Storage bins: icon-only pencil + trash (grey). Data-table lists: `⋮` kebab overflow. An operator learns one then meets another. | facilities vs storage-locations vs feedstocks | Design System / Frontend → **issue filed** |
| 3 | P1 | **Two list paradigms + two pagers.** Most entities use a generic transposed data-table card (`COLUMNS` customiser, kebab, arrow pager `« ‹ › »`); facilities & credit-batches use bespoke cards (no COLUMNS, text `PREVIOUS/NEXT` pager). Different mental model + affordances per entity. Complements existing #50 (filtering). | feedstocks vs facilities vs credit-batches | Design System / Frontend → **issue filed** |
| 4 | P2 | **Same status word, conflicting colour.** `Submitted` is **green** on the Removals list but **amber/orange** on GHG Statements. If green = terminal-good and amber = awaiting-verification, the *label* must differ, not just the colour. | removals list vs ghg-statements list | Design System / Frontend → **issue filed** |
| 5 | P2 | **Inconsistent unit handling.** (a) Auto-scaled units mixed in one column/board: `150 kg` next to `1.7 t` (facilities), `0% of 1.0 t` next to `15% of 800 kg` (storage). (b) Unit lives in the *value* on some lists (`500 kg`) but in the *column label* on others (`Feedstock (kg)` → bare `225`). (c) Uppercase header transform mangles unit casing: `kWh` → `KWH` (energy per-stage table). | facilities, storage, feedstocks vs production-runs, energy | Design System |
| 6 | P2 | **Footer CTA order/alignment differs from the documented convention.** Feedstock sheet: primary **left, primary-first** (`CREATE FEEDSTOCK` \| `CANCEL`) per `form-cta-conventions`. New GHG Statement wizard: **right, primary-last** (`CANCEL` \| `NEXT`). | feedstock create sheet vs GHG wizard | Frontend |
| 7 | P3 | **Verb inconsistency.** List buttons say `NEW X`; sheet titles say `Create Feedstock` (feedstock) but `New GHG Statement` (GHG). Pick one ("New" or "Create"). | create sheets | Frontend |
| 8 | P3 | **Pluralisation not handled everywhere.** `1 applications` on the credit-batch card, but `1 application` (dashboard, storage) and `1 removal` (GHG) are correct. | credit-batch-list | Frontend |

### Page-shell / layout consistency

| # | Sev | Finding | Evidence | Owner |
|---|-----|---------|----------|-------|
| 9 | P2 | **Chain of Custody breaks the canonical page shell**: no area eyebrow, no StatCard KPI strip; raw H1 + a custom right-side `FACILITY / …` label block. Hub pages (Admin) likewise omit the eyebrow. Decide whether hub/tool pages are an intentional shell variant or should conform. | /chain-of-custody, /admin | Design System |
| 10 | P2 | **Bare-text empty state** on Chain of Custody ("Select a credit batch above…") — centred plain text in a large void, not the `EmptyState` component the design system mandates ("never bare text"). | /chain-of-custody | Frontend |
| 11 | P2 | **Certification subtitles violate the one-line rule.** Removals / GHG / Settings each use a 3–5-line explanatory paragraph in the subtitle slot. Condense to one line + move teaching copy to an `InfoHint`/callout. | certification pages | Frontend |
| 12 | P3 | **Redundant heading**: H1 `Removals` immediately followed by a section heading `Removals (1)` (same for `GHG Statements` / `Statements (1)`). | certification lists | Frontend |
| 13 | P3 | **StatCard icon treatment varies**: monochrome dark icons (facilities/feedstocks/production-runs/energy) vs coloured accent icons (storage: orange/purple/pink). Likely intentional for the storage colour story — confirm and document, else align. | storage vs others | Design System |
| 14 | P3 | **Admin/Settings "section icon in a bordered box"** reads like an empty input field (thin-bordered rectangle with a centred icon). Reconsider the container treatment. | /admin, /certification/settings | Frontend |
| 15 | P3 | **Loading-skeleton shape mismatch**: facilities shows list-row skeletons that then resolve into KPI StatCards — skeleton doesn't match final layout. | /facilities (load) | Frontend |

### Content / identity / friendliness

| # | Sev | Finding | Evidence | Owner |
|---|-----|---------|----------|-------|
| 16 | P2 | **Removals are identified by a truncated raw UUID** (`12dba0ff…`) as the primary label, while every other entity has a friendly code (FS-26-001, CB-26-001) and the GHG statement shows the registry id (`ggs_…`). An operator can't recognise/act on a UUID. Show the registry `rmv_…` id or a generated removal code. | /certification/removals | Frontend / Certification |
| 17 | P3 | **Mixed empty-value vocabulary in one card**: credit-batch shows `Weight —` (dash) beside `CO2e Stored 0.00 t` (zero, and coloured **green** though it is zero/pending). Standardise dash-vs-zero and don't colour a zero value as positive. | credit-batch-list | Frontend |
| 18 | P3 | **`create=true` deep-link param persists after the sheet is closed** (Escape/Cancel), so a refresh re-opens the create sheet unexpectedly. | feedstocks?create=true | Frontend |

### Responsive _(observed at 514px — verify at phone/desktop)_

| # | Sev | Finding | Evidence | Owner |
|---|-----|---------|----------|-------|
| 19 | P1 | **CoC DAG is not responsive.** Horizontal LR nodes clip on both edges (left "Production Run" cut off, "Delivery" past the right edge); the minimap/legend floats over empty canvas. Effectively unusable at narrow width with no mobile fallback. (Sankey view degrades gracefully — keep it as the mobile-preferred view.) | /chain-of-custody DAG | Frontend / CoC |
| 20 | P2 | **Header right-side info block wraps badly.** The CoC `FACILITY / FAC-26-001 — Operator Facility mqceboe4` block wraps to 3–4 lines down the right edge and visually collides with the left subtitle. | /chain-of-custody | Frontend |
| 21 | P2 | **Dashboard H1 facility name truncates** to "Operator Facility…" — the `title-chapter-title` display font doesn't scale down, so the page's primary identity is cut off at narrow width. | /dashboard | Frontend |
| 22 | P2 | **Energy "Per-stage submission preview" table doesn't transpose** to cards like the entity lists do — it stays a 4-column table and gets cramped (headers + "Biomass processing" wrap). Tables now have ≥3 treatments (transposing card / sticky-scroll / plain-wrap). | /energy | Frontend |
| 23 | P3 | **Transposed data-table cards right-align long string values**, which crowd their left labels (`Operator Reactor mqceboe4` nearly collides with `Reactor`). Right-align suits codes/numbers, not long text. | data-table lists | Frontend |
| 24 | P3 | **KPI StatCards are very tall single-column** on narrow screens (each ~a full band with a short value) → heavy scrolling before reaching list content. Consider a denser 2-up KPI grid below `lg`. | all list routes | Design System |
| 25 | P3 | **Mobile nav facility selector truncates** the facility name (`Operator Facility mqceb…`). | mobile drawer | Frontend |

### Confirmed strengths (keep)

- Canonical page shell (eyebrow → title → subtitle → iconed KPI strip) is **consistent
  across all standard list routes** — strong baseline.
- **Form validation UX is excellent**: empty-submit turns the FormSpine section markers
  red with a ⚠️ icon (optional sections stay neutral), select borders go red, and
  inline messages are specific (`Please select a supplier`).
- EntitySelect dropdown: clean two-line options (name + secondary), clear hover.
- Storage 3-lane board stacks cleanly on mobile with horizontal capacity meters.
- Sankey honestly surfaces a "MASS BALANCE INCONSISTENCIES" callout.
- Prior "Required shown before interaction" issue on the GHG wizard is **resolved**
  (now just a red `*`).
- HTML in user-entered names is safely escaped.

## Recommended fixes (priority order)

1. **Standardise date/time display** behind a single formatter token; pick one
   unambiguous human format (e.g. `Jun 13, 2026`) for all display surfaces and decide
   the period-range presentation. (Findings #1) — _decision issue filed._
2. **Unify list-row actions** to one affordance (recommend the kebab or a consistent
   `EDIT` + icon footer) and one pager; decide whether bespoke cards survive.
   (#2, #3) — _decision issue filed._
3. **Define status-badge colour semantics** (one colour per state-class; differentiate
   "submitted-and-done" vs "submitted-awaiting" by label, not just hue). (#4) —
   _decision issue filed._
4. Give CoC the canonical shell + an `EmptyState` component, fix the right-side label
   wrap, and add a mobile fallback (default to Sankey or a vertical node list below
   `md`). (#9, #10, #19, #20)
5. Show a human removal identifier (registry `rmv_…` / generated code). (#16)
6. Align footer CTAs to the documented left/primary-first convention across sheets and
   wizards. (#6)
7. Standardise unit placement + auto-scaling rules; stop uppercase headers mangling
   unit casing. (#5)
8. Condense certification subtitles to one line + `InfoHint`. (#11, #12)
9. Sweep small copy: pluralisation (#8), New-vs-Create verb (#7), dash-vs-zero +
   zero-coloured-green (#17), clear `create=true` after open (#18).

## Severity & owner summary

| Sev | Items |
|-----|-------|
| P1 | #1 dates, #2 row actions, #3 list paradigms, #19 CoC DAG not responsive |
| P2 | #4 status colour, #5 units, #6 CTA order, #9 CoC shell, #10 bare empty state, #11 cert subtitles, #16 removal UUID, #20 header wrap, #21 H1 truncation, #22 energy table |
| P3 | #7 verb, #8 plural, #12 redundant heading, #13 icon colour, #14 bordered-icon box, #15 skeleton shape, #17 empty vocab, #18 create param, #23 right-align text, #24 KPI height, #25 selector truncation |

Owner areas: **Design System** (cross-cutting tokens: dates, units, row actions, list
paradigm, status colours, shell variance, KPI density) · **Frontend** (per-component
copy, CoC, energy table, removal identity, certification subtitles) · **Certification**
(removal identifier, CoC mobile fallback).

## New GitHub decision issues filed

- **#248** — Decide a single canonical date/time display format across the app (findings #1)
- **#249** — Unify list-row presentation, row-action affordances, and pagination across entities (findings #2, #3, destructive-styling)
- **#250** — Define status-badge colour semantics (finding #4)

All other findings are concrete, owner-assignable fixes captured above and do not need
a product/architecture decision.
