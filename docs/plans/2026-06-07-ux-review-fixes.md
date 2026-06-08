# UX Review — Fix Plan (e2e flow + certification)

**Date:** 2026-06-07
**Source:** Chrome screen-by-screen walkthrough of the seeded "Moshi Biochar Production Center" facility (Dashboard → Feedstocks → Certification Overview → Removals + New Removal wizard → Credit Batches + Health panel → Production Runs → Chain of Custody → GHG Statements → Cert Settings → Suppliers → Energy).

Each item is independently tackleable. File:line pointers were verified at review time — re-confirm before editing.

> Sandbox cleanup: the wizard rehearsal left a draft removal `283afe67…` ("Not submitted") in the sandbox. Delete it if you don't want it lingering.

---

> **Verification 2026-06-07** (review + browser test on Moshi facility). Status legend below: `[x]` implemented & verified, `[ ]` still open. `pnpm typecheck` clean, `pnpm lint` 0 errors, affected unit tests pass (58). See "Verification log" at the bottom.

## P1 — Functional / correctness

- [x] **Required number fields leak raw Zod error.**
  Submitting Create Feedstock empty shows *"Invalid input: expected number, received null"* on **Total Wet Mass** and **Moisture** (selects correctly say "Please select a supplier").
  - Cause: `src/schemas/feedstocks.ts:13-24` — `requiredNonNegativeNumber` / `requiredMoisturePercent` do `z.preprocess(toNumberOrNull, z.number()...)`; `null` + a `z.number()` with no custom `error` → the raw message.
  - Same pattern duplicated in `src/schemas/biochar-products.ts:17`.
  - Fix: per CLAUDE.md, use `toNumberOrUndefined` + `z.number({ error: (iss) => iss.input === undefined ? "Required" : "Invalid number" })`. Centralize a `requiredNumber(message)` helper in `@/schemas/helpers` and reuse so other forms inherit the fix. Audit all `z.preprocess(..., z.number())` usages.

- [x] **Energy vs Certification disagree on Isometric project link.**
  Energy "Per-stage submission preview" says *"This facility is not linked to an Isometric project"*, but Cert Overview shows a green *"✓ Facility linked to an Isometric project"* and Settings shows an active connection.
  - Where: `src/components/energy/energy-summary.tsx` (the "not linked" copy) vs the readiness/link check in `src/lib/certification/readiness.ts` / `src/data-access/isometric.ts`.
  - Fix: make Energy use the same link-detection source of truth as the cert readiness check (or clarify they mean different things and reword).

- [x] **Production-run Readings UI is orphaned.** Decision: wired into the run side-sheet (read-only in View, editable in Edit), not deferred.
  `ProductionRunReadingTable` / `ProductionRunReadingForm` exist (`src/components/production-run-readings/`) but are mounted on **no screen** (only a schema type references them). Likely tied to the deferred "readings CSV stub."
  - Decision needed: wire them into the run UI, or formally defer (record in `docs/open-questions.md`) and stop shipping dead components.

- [x] **Production-run Samples/Incidents are edit-only + no detail route.** Samples/Incidents (and Readings) now render read-only in View mode via `viewModeChildren`. (No dedicated `[id]` route added — detail still uses the side-sheet; see P2 detail-pattern item, still open.)
  `src/components/production-runs/production-run-list.tsx:490-499` renders `ProductionSampleTable` + `ProductionIncidentTable` **only when `mode === "edit"`**. The read-only "View" sheet hides them, and there is no `production-runs/[id]` route.
  - Fix: show samples/incidents in View mode (read-only) too, and/or add a real detail page. Decide the canonical detail pattern (see P2 item below).

---

## P2 — Consistency

- [ ] **Peer entities use different detail patterns.**
  Credit Batch detail = full page (breadcrumb, inline-editable sections, health panel). Production Run detail = right-side sheet quick-view. Pick one convention (full page recommended for entities with child data).

- [ ] **Removals identified by raw UUID.** *(Still open — confirmed live: the draft removal still shows as `283afe67…`.)*
  Removals table shows `283afe67…` where every other entity has a friendly code (FS-/CB-/PR-). Add a local removal code (e.g. `RM-2026-001`) generated on create; keep the registry ID as "Set on submit".

- [ ] **Production-run code format inconsistency.** *(Still open — confirmed live: draft run is `PR-26-001` vs `PR-2026-104` for completed runs.)*
  Draft run is `PR-26-001` (2-digit year) vs `PR-2026-1xx` elsewhere. Align the code generator (`src/data-access/code-generator.ts`). (Matches prior QA note on code-prefix mismatches.)

- [x] **Loading states are mixed.** Shared `DataTable` now renders `TableRowSkeleton` rows; the production-run Readings/Samples/Incidents tables use `TableSkeleton`. (Verified live: Removals table painted skeleton rows. Note: the New Removal wizard body still shows a "Loading credit batches…" text line — in-dialog, out of the table/list scope this item targeted. The cert queue/certifier-mapping text spinners called out below were not separately re-checked.)

- [ ] **Row-action affordances differ across tables.**
  Feedstocks rows = inline **Edit + Delete** (Delete red, no confirm/menu); Suppliers rows = **View** only. Standardize the DataTable row-action pattern; move destructive Delete behind a `⋯` menu or confirm.

- [ ] **Stat-card row density varies.**
  Feedstocks = 4 cards; Suppliers = 1 card in a full-width row (looks unbalanced). Normalize (consistent card count or a different layout for single-metric pages).

---

## P3 — Polish

- [ ] **Facility selector paints as an empty box** before data loads (no placeholder/skeleton) — reads as broken for a beat on first load.

- [x] **Chain of Custody doesn't fit-to-view on load.** Added `FitViewOnNodesReady` (re-fits once `useNodesInitialized`). Verified via DOM measurement: all 7 nodes (incl. Application) fall inside the pane, centered with symmetric padding. *(Minor: the effect's dep array is `[fitView, nodeCount, nodesInitialized]` — switching between two applications with the **same** node count won't re-fire it; built-in `fitView` only runs on init. Low impact since chains are structurally identical, but consider keying on a node-id signature.)*

- [x] **Verbose helper text on Transport distance** (Create Feedstock) — collapsed into the `SectionLabel hint` ⓘ tooltip; the standalone paragraph is removed and the two inline helperTexts shortened. Verified ⓘ present on the Transport Details label.

- [~] **Disabled SUBMIT gives no reason** in the New Removal wizard. Code in place: when `!canSubmit` the Submit button is wrapped in `<Tooltip>` ("Complete unmet registry requirements before submitting.") with a focusable `<span tabIndex={0}>`. **Not browser-reproduced** — the seed facility has no selectable-but-unready batch to reach the Requirements step's footer.

- [x] **Removal blockers list is a dense run-on.** `buildEntityReadinessGaps` now groups gaps per entity (`Production run PR-…: wet mass · moisture`). Verified live in the Readiness column.

- [x] **Cross-screen wording confusion.** Batch-health label changed to "Final-submit entity fields" with "Still needed before submit: …" detail (was "checked before submit").

- [x] **Copy nit** — Cert Settings now reads "…that every removal and GHG statement…".

---

## P4 — Accessibility

- [x] **New Removal modal isn't a semantic dialog.** `Modal` now sets `role="dialog"` + `aria-modal="true"` on the native `<dialog>`. Verified live: `role=dialog`, `aria-modal=true`, `aria-labelledby=new-removal-title`, focus trapped inside, Escape closes.

- [x] **Tables expose no semantic roles.** Shared `DataTable` `<th>` now carries `scope="col"`; native `<table>` + `scope` yields proper `columnheader` semantics. Verified live on Suppliers (5/5 `th` have `scope=col`).

---

## Strengths (don't regress)

Certification surface is the strongest area: consistent **Sandbox banner**, domain-teaching copy + CTA-bearing empty states, the **Credit-batch Health panel** (status + reason + contextual fix link), **removal wizard gating** (ready vs blocked batches, SUBMIT disabled until requirements pass), the **dual-status** model on Production Runs, and the Chain-of-Custody graph styling.

---

## Verification log — 2026-06-07

**Static checks:** `pnpm typecheck` clean · `pnpm lint` 0 errors (only pre-existing warnings) · affected unit tests pass (`feedstocks-schema`, `biochar-products-schema`, `isometric-transport-aggregation`, `readiness` = 58 tests). New tests added: `tests/feedstocks-schema.test.ts`, plus required-message + transport-mix-factor assertions.

**Browser (Moshi facility):**
- Feedstock create → empty submit shows **"Required"** on Total Wet Mass (was raw Zod). ✅
- Energy → per-stage submission preview renders for the linked facility (no false "not linked"). ✅
- Production run View sheet → Readings/Samples/Incidents render read-only (no Add/Edit/Delete). ✅
- Chain of Custody → DOM-measured fit: all 7 nodes inside pane, symmetric padding. ✅
- Removals → blocker text grouped per run; New Removal = native focus-trapped `dialog` (role/aria-modal/labelledby, Escape closes); DataTable `th scope=col` (Suppliers 5/5); skeleton rows on load. ✅
- No console errors observed.

**Done (12):** P1 all 4 · P2 loading-states · P3 fit-to-view, transport hint, blocker grouping, cross-screen wording, copy nit · P4 both.
**Partial (1):** P3 disabled-Submit tooltip — code correct, not reproduced (seed has no selectable-but-unready batch).
**Still open (6):** P2 detail-pattern, removal RM-code, run code format, row-action affordances, stat-card density · P3 facility-selector empty box.

**Code notes (low priority):**
1. `FitViewOnNodesReady` dep array won't re-fire when switching apps with the same node count (built-in `fitView` only runs on init). Consider keying on a node-id signature.
2. `data-table` `loadingRows = Math.min(pagination.pageSize, 5)` — the `5` is an inline magic number (CLAUDE.md prefers a named constant).
3. Out-of-plan but sound: `replaceDerivedTransportLeg` param narrowed to `"feedstock"`; new aggregation warning for mixed transport-factor fields (tested).
