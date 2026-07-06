# Durability tier → facility-scoped + 1000-year submission path (build plan)

**Status:** IMPLEMENTED (2026-07-04, issue #358, ADR 0021). Phases 1–4 + 6–7 fully
built; Phase 5 = recognition + guard + `s_fraction` data model + unit-tested pure
builder built, but the 1000-year measurement-sample submit-path **wiring** is left
as the remaining GATED step (never executed while `DURABILITY_MEASUREMENT_SAMPLES_LIVE`
is `false`; the exact datapoint↔list-input binding is an open sandbox confirm). See
`docs/isometric/changes.md` → 2026-07-04 (ADR 0021) and `docs/open-questions.md`.
Decisions locked via grill-with-docs; the section below is the original plan.

**Goal.** Make the **durability tier** a facility-level source of truth (ADR 0021),
surface it as a 2-card selector (1000-year available, 200-year "available later"),
enforce the facility↔removal-template tier match at submit, **build the 1000-year
registry submission path** (kept gated), and reseed Dark Earth Carbon as a
1000-year facility.

## Decisions already locked (do not re-litigate)

- **Durability tier is declared per facility, inherited downward** — `CONTEXT.md`
  (Durability tier / Sample) + **ADR 0021**. One tier per facility; a facility that
  physically makes both tiers must pick one or be two facilities.
- **`facility.durabilityOption` is authoritative** (rename from
  `defaultDurabilityOption`); **`creditBatch.durabilityOption` column is dropped**.
- **Read approach: join-derive on read.** Drop the batch column, but have the
  credit-batch data-access queries JOIN `facilities` and expose `durabilityOption`
  (from the facility) on the returned batch object — so ~28 existing
  `batch.durabilityOption` read sites keep working unchanged. Only schema +
  batch-loading queries + the two forms + the submit guard + seed change.
- **1000-year is the go-forward tier; 200-year is "available later"** (greyed).
  Primary DEC facility (Moshi) reseeds as **1000-year**.
- **Build the 1000-year submission plumbing but keep it gated** behind
  `DURABILITY_MEASUREMENT_SAMPLES_LIVE` (still `false`). No live 1000-yr POST until
  the empirical sandbox confirm + the Isometric sign-offs below.
- **Branch:** continue on the current branch (`feat/credit-batch-cohort-autoselect-inputs`).
- **§8.6.2 front-loading confirmed by Isometric** (#353) — unrelated to this build
  but unblocks the #349 straddle path.

## ⚠️ Critical research finding — the 1000-year blueprint ≠ module Eq.6

Authoritative research (Isometric MCP, 2026-07-04) — **implement to the live Certify
blueprint, not to module Eq.6; they disagree and the blueprint is what runs.**

**`biochar_sequestration_1000_year` blueprint inputs** (matches our live template exactly):

| Input | Shape / quantity kind | Unit | Source from our data |
|---|---|---|---|
| `carbon_contents` | LIST, `mass_fraction_dry_basis` | dimensionless (0–1 fraction) | **one datapoint per replicate** — total carbon, dry basis |
| `product_mass` | SCALAR, `mass` | kg | one scalar — dry biochar product mass applied |
| `s_fraction` | LIST, `dimensionless` | — | **one datapoint per replicate** = that sample's proportion (0–1) of R₀ readings ≥ 2% |

- Registry computes: `result = product_mass × mean(carbon_contents) × durable_fraction × 3.667`,
  where `durable_fraction = mean(s_fraction) − √(mean·(1−mean)/n)` (binomial SE), `n = |s_fraction|`.
- **Submit per-replicate lists, NOT mean+stddev** — the registry needs the full replicate
  list to compute the conservative −SE reduction. Collapsing to one aggregate → `n=1` →
  massive over-penalty.
- The blueprint has **NO non-reactive-carbon input** and **NO 0.95 cap** (both present in
  module Eq.6 — divergence flagged below). `carbon_contents` is **total** carbon (200-year
  subtracts inorganic to get organic; 1000-year uses total).
- **Data-model implication (important):** our stored batch fields
  `meanRandomReflectancePercent` / `stdRandomReflectance` / `meanNonReactiveCarbonPercent` /
  `stdNonReactiveCarbonPercent` **do not map** to this blueprint. The 1000-year path needs a
  **per-sample `s_fraction`** (proportion of that sample's R₀ readings ≥ 2%). Decide in Phase 5
  how to derive/store `s_fraction` per Sample (store the raw R₀ reading set and compute, or
  store a computed per-sample proportion). This is a genuine sub-decision — may need a short
  Isometric confirm on how `s_fraction` is derived from lab R₀ data.
- **Datapoint sharing across a batch's two quarterly GHG entries: API supports it**
  (project-scoped datapoints; `ComponentListInput.datapoint_ids[]`). Pattern: one set of
  project datapoints referenced by each removal's own sequestration component.

Sources: `docs.isometric.com/user-guides/certify/component-blueprint-library`
(`biochar_sequestration_1000_year`), `.../datapoint-sharing`, `.../measurement-samples`;
module `biochar-storage-soil-environments/1.3` §5.1.1.3.2 Eq.6.

## Still needs Isometric staff sign-off (does NOT block building the gated plumbing)

1. **Eq.6 vs blueprint discrepancy** for the 1000-year durable fraction — the blueprint drops
   the non-reactive-carbon factor and the 0.95 cap, and uses binomial-SE not std-dev. Which
   governs verification credit?
2. **Cross-entry shared-datapoint uncertainty** — how the registry handles a datapoint shared
   across two GHG entries in one statement's uncertainty math (#353 Q2, still open).
3. **Total vs organic carbon** for the 1000-year `carbon_contents` input (if inorganic C is
   non-trivial, "total" over-counts).
4. **The two sandbox confirms** (binding + units) — largely resolved by the research (units:
   carbon mg/kg, s_fraction dimensionless; binding: per-replicate datapoint lists). Final tick
   is an empirical sandbox test-submit before flipping `DURABILITY_MEASUREMENT_SAMPLES_LIVE`.

## Build phases

### Phase 1 — Schema (facility authoritative; drop batch column)
- `src/db/schema/facilities.ts` — `defaultDurabilityOption` → `durabilityOption`
  (column `durability_option`), `.notNull()`, default `'1000_year'`.
- `src/db/schema/credits.ts` — **remove** `durabilityOption` column from `creditBatches`.
  Keep the tier-specific evidence columns (they gate on the facility tier now).
- `src/db/schema/common.ts` — `durabilityOption` pgEnum stays.
- Reseed over migrate (not live). `pnpm db:generate` then `pnpm db:reset`, or `db:push`.

### Phase 2 — Reads (join-derive on read)
- Credit-batch data-access (`src/data-access/credit-batches.ts`, `credit-batch-previews.ts`,
  `credit-batch-samples.ts`, `certifier-removals.ts`, `samples.ts`) — JOIN `facilities` and
  select `facilities.durability_option AS durabilityOption` onto the batch row. Update the
  Drizzle result types so `durabilityOption` remains present on the batch object.
- Verify the ~28 read sites (grep `durabilityOption` minus facility) still resolve. Sites that
  used the bare `CreditBatch` table type need the query-result type instead.
- Reference read sites: `src/lib/calculations/biochar-removal.ts`,
  `src/lib/isometric/utils/durability-aggregation.ts`, `src/lib/certification/*`,
  `src/fn/certification/{removal-breakdown,certify-readiness-gaps,certify-context-core}.ts`.

### Phase 3 — UI (2-card selector)
- New durability tier card selector: two cards (200-year / 1000-year); **200-year disabled +
  "Available later"**, 1000-year selectable. Reusable (facility form + anywhere tier is chosen).
- `src/components/facilities/facility-form.tsx` — replace the `FormSelect`
  (`defaultDurabilityOption`) with the card selector; field is now `durabilityOption`, authoritative.
- `src/components/credit-batches/credit-batch-form.tsx` — **remove** the tier toggle + the
  facility-default prefill effect; show the facility's tier **read-only**. 1000-year evidence
  fields gate on the facility tier.
- `src/schemas/facilities.ts` / `credit-batches.ts` — drop batch `durabilityOption` from the
  batch form/action schema; facility schema field rename; keep `durabilityOptions` enum.

### Phase 4 — Submit-time template↔tier validate-guard
- `src/fn/certification/submit-removal.ts` — before the datapoint loop, map facility tier →
  expected sequestration blueprint (`200_year`→`biochar_sequestration_200_year_c_org`/`_unsampled`;
  `1000_year`→`biochar_sequestration_1000_year`). If the template's `co2-stored` component's
  blueprint ≠ expected, **fail closed** with an actionable message (kills today's misleading
  "No INPUT_MAPPING entry … update transformers/datapoint.ts"). Add a predicate
  `isSequestrationBlueprintFamily()` in `transformers/measurement-sample.ts` to detect an
  unsupported/mismatched sequestration component cleanly.

### Phase 5 — 1000-year submission path (per the research above; keep GATED)
- `src/lib/isometric/transformers/measurement-sample.ts` — add
  `biochar_sequestration_1000_year` to `SEQUESTRATION_BLUEPRINT_KEYS`; teach
  `buildSequestrationBlueprintKey` the 1000-year key (by facility tier).
- `src/fn/certification/durability-measurement-samples.ts` + the removal-body builder
  (`transformers/ghg-entry.ts`) — build the 1000-year component's inputs: `carbon_contents`
  (per-replicate LIST), `product_mass` (SCALAR), `s_fraction` (per-replicate LIST). Do **not**
  compute mean/−SE/cap locally — the registry does it.
- Resolve the **s_fraction data-model sub-decision** (per-sample proportion of R₀ readings ≥ 2%):
  where the Sample's R₀ readings live and how `s_fraction[i]` is computed. May need an Isometric
  confirm.
- Keep `DURABILITY_MEASUREMENT_SAMPLES_LIVE = false`. Flag the Eq.6-vs-blueprint assumption
  loudly at the code (mirror the `computeFDurable1000` header note).

### Phase 6 — Reseed
- `src/db/seed-data.ts` — Moshi facility `durabilityOption: '1000_year'`.
- `src/db/seed-credit-batches.ts` — batches under Moshi become 1000-year; give their Samples the
  R₀-derived `s_fraction` evidence the 1000-year path needs (see Phase 5 sub-decision). Keep ≥3
  replicates per batch (durability gate).

### Phase 7 — Docs + validate
- `docs/isometric/changes.md` — dated entry: facility-scoped tier + 1000-year blueprint path
  (per research; cite the blueprint vs Eq.6 divergence).
- `docs/open-questions.md` — record the Isometric sign-offs still needed (list above); update the
  `fdurable-1000-r0-semantics` + `durability-measurement-samples` entries with the blueprint
  resolution.
- `docs/adr/0013` — note the blueprint-vs-Eq.6 finding (the operative math is the blueprint).
- Validate: `pnpm typecheck` + `pnpm lint` + `pnpm vitest run`. (Beware the pipefail
  false-green — check real exit codes.)

## File inventory (surface)
- Facility tier rename (7): `schema/facilities.ts`, `schemas/facilities.ts`, `fn/facilities.ts`,
  `data-access/facilities.ts`, `components/facilities/facility-form.tsx`,
  `components/credit-batches/credit-batch-form.tsx`, `db/seed-data.ts`.
- Batch column drop + reads (~28): schema `credits.ts`/`common.ts`; data-access
  `credit-batches.ts`, `credit-batch-previews.ts`, `credit-batch-samples.ts`, `samples.ts`,
  `certifier-removals.ts`; fn `removal-breakdown.ts`, `certify-readiness-gaps.ts`,
  `certify-context-core.ts`, `durability-measurement-samples*`; lib `biochar-removal.ts`,
  `durability-aggregation.ts`, `certify-field-registry.ts`, `durability-batch-summary.ts`;
  components `credit-batch-{list,form,card,detail}.tsx`, `sample-{form,list}.tsx`,
  `new-removal-dialog/select-batches-step.tsx`; schemas `credit-batches.ts`, `samples.ts`; seed
  `seed-credit-batches.ts`; tests `biochar-removal.test.ts`, `durability-aggregation.test.ts`,
  `entity-readiness.test.ts`, `durability-measurement-samples.test.ts`.

## Verify at the end
Drive a live sandbox submit on the reseeded 1000-year Moshi removal (see the removal URL in
`certify-live-submit-prereqs` memory). Expected: the template↔tier guard passes (facility 1000-yr
matches the `biochar_sequestration_1000_year` template), and the submit reaches the durability
staging gate (`DURABILITY_MEASUREMENT_SAMPLES_LIVE=false`) — the *intended* "staged but not yet
live" stop, not the old missing-mapping error. A real live POST awaits the empirical sandbox
confirm + Isometric sign-offs.
