# Plan: Tier 1 — wire the live 200-year durability measurement-samples submission

**Date:** 2026-06-19
**Decisions:** ADR 0013 (registry computes `F_durable`; durability inputs feed the dedicated
`biochar_sequestration_200_year_*` blueprints via measurement samples, **not** `INPUT_MAPPING`)
· ADR 0016 (credit batch = protocol production batch; production process scopes Method A/B; the
sampling unit is the credit batch). Sharpened in a `grill-with-docs` session, 2026-06-19.
**Branch:** `feat/credit-batch-production-process` (builds **on** the ADR 0016 re-grain landing here).
**Status:** Design locked. Buildable/stageable now; the **live POST** stays gated on two
sandbox-empirical confirms the operator runs.

> ⚠️ All Isometric rules below are non-authoritative summaries. The two that drive credit math
> were re-verified verbatim via the isometric MCP on 2026-06-19: biochar protocol **1.2 §8.3.1**
> (sampling — ≥3 independent distributed samples per batch) and module
> **biochar-storage-soil-environments 1.2 §5.1.1.3.1** (soil temperature — project-area scope,
> reference-DB source, 7 °C floor). Re-verify before relying for credit claims:
> https://registry.isometric.com/protocol/biochar/1.2 ·
> https://registry.isometric.com/module/biochar-storage-soil-environments/1.2

## Why this plan exists (the gap the handoff under-scoped)

The handoff framed Tier 1 as "flip the live POST." The grill surfaced a **root issue**: the
entire durability data plane — the gates (`buildDurabilityGateBlockers`), the aggregation
(`ProductionRunWithSamples`, `buildPerBatchDurabilityData`), the Phase-E measurement-sample
builders, and the COA candidate-document walk (`collectCandidateDocumentIdsForRemoval`) — is
written at the **production-run** grain. ADR 0016 re-pointed lab samples to `samples.creditBatchId`
(`production_run_id` now nullable provenance), and `getProductionRunsWithSamples` **skips any
sample with a null run link**. So post-0015 lab chemistry is **invisible** to every durability
surface. The live POST cannot be wired honestly until the data plane is re-grained to the credit
batch. That re-grain is the spine of this plan.

## Design invariants (locked in the grill)

- **Grain.** Gates + aggregation + measurement-sample builders + COA walk key off the **credit
  batch** (the protocol production batch), not the production run.
- **Sample model.** A Sample is **entered against one production run** (provenance + the natural
  data-entry anchor); its **credit batch is derived** from that run's membership; both links stay
  populated. The run is never the characterisation / ≥3-count grain.
- **≥3 replicates.** ≥3 **independent** Samples per credit batch, **distributed across distinct
  runs/days** (§8.3.1) — not aliquots of one grab. Hard-gate the count; **warn** if all of a
  batch's samples cluster on one run/day (anything other than distributed independent samples is a
  registry-agreed alternative, not a code call).
- **Submitted shape.** One **measurement-sample submission** per credit batch carrying the batch's
  **mean + standard deviation** (the API value type is one magnitude + `standard_deviation`). The
  raw ≥3 are evidenced by the COA Source + the durability evidence ledger. The registry means the
  per-batch list across the removal's member batches.
- **Soil temperature.** An operator-declared **facility-level reference value** (global soil-temp
  DB — Lembrechts 2022 or equivalent; the sanctioned path when there's no on-site baselining; air
  temperature prohibited), **7 °C floor**, one decimal. Justification lives in the **PDD**
  (registry-side) — so it needs no API description field. Per-application `soil_temperature_c`
  becomes a future per-removal override / reconciliation.
- **Blueprint selection = Method A/B.** Sampled → `biochar_sequestration_200_year_c_org`. DEC runs
  **Method A everywhere**, so every batch is sampled and only `_c_org` ever receives data.
  `_unsampled` is an **inert** seam (blueprint authored, picker routes to it, hard assertion
  guards an impossible Method-A-unsampled state). **No Method-B estimate math** (future ADR ~0017).
- **No prod data** → reseed, not migrate. Never edit applied migrations.

## Scope — ships in this plan vs deferred

- **Ships:** the run→credit-batch re-grain; the credit-batch sampling gates; the facility soil-temp
  reference field; the measurement-samples submission step in `submit-removal.ts`; deletion of the
  stale `INPUT_MAPPING` entry; the durability evidence-ledger PDF; the two UX surfaces; docs +
  tests.
- **Deferred (ADR ~0016, Method-B unlock):** the `_unsampled` estimate (Winsorized mean ± SE from
  historical batches), the 6-month borrow-pool, per-process eligibility wiring, the super-admin
  unlock, the Method-B operator UI. The seam is laid inert.
- **Gated on the operator (live flip only):** the two sandbox confirms (below).

## The two sandbox confirms (operator runs — agent cannot)

Gate command: `pnpm isometric:coverage-check -- --source=db` (interactive 1Password), against
sandbox template `rvt_1KS4S43VPSBXA26X`. Build + stage everything; keep the live POST behind:

1. **Datapoint ↔ component-input binding** — does a `biochar_sequestration_200_year_*` input carry
   an explicit `datapoint_id` reference, or auto-link by measurement type/property? *Doc evidence
   leans explicit reference.* → decides how the measurement-samples step binds its datapoints.
2. **Unit scalings** — the blueprint declares `h_c_molar_ratios` in `%` but samples store a
   dimensionless ratio (~0.5); `toHcMolarRatioPercent` applies ×100. *Doc evidence
   (`DIMENSIONLESS_RATIO`, module §3 Table 2) leans dimensionless → ×100 likely wrong; send raw.*
   The same coverage-check run also pins the units for `total_carbon_contents`,
   `inorganic_carbon_contents`, `soil_temp` (`degC`) and `product_mass`.

**Decision rule pre-agreed so wiring is mechanical once values arrive:**
- Binding = explicit reference → the step POSTs each datapoint, captures its id, and binds it to
  the matching `_c_org` input. Binding = auto-link → POST the measurement sample and omit explicit
  input refs.
- H/C unit: if the blueprint input declares dimensionless → set `H_C_MOLAR_RATIO_PERCENT_SCALE = 1`
  (send raw ~0.5) and `H_C_MOLAR_RATIO_UNIT` to the declared unit; if it really declares `%` → keep
  ×100. Carbon/mass: scale to whatever the coverage-check reports (mirror the legacy
  `carbon_content /100`). One constant edit each — no structural change.

## Phases

### Phase 1 — Re-grain the durability data plane (run → credit batch)  ⟵ spine
- `src/lib/isometric/utils/durability-aggregation.ts`: `buildPerBatchDurabilityData` iterates
  **credit batches**, pooling each batch's Samples (across its member runs) → one mean+std-dev per
  batch; `productMassKg` = Σ member runs' `biocharDryMassKg × attribution`. Drop the per-run
  `PerBatchDurabilityDatapoint.productionRunId` → `creditBatchId` + `creditBatchCode`.
- `src/lib/isometric/utils/aggregation.ts` / `certify-context-core.ts`: feed the durability path a
  **credit-batch-grouped** sample set. Source samples by `samples.creditBatchId` (a new
  `getCreditBatchesWithSamples` / batch-grouped loader), not `getProductionRunsWithSamples`'
  null-run-skipping read.
- `src/fn/certification/durability-readiness.ts` + `src/lib/certification/durability-submission-gates.ts`:
  `buildDurabilityGateBlockers` evaluates **per credit batch** — eligibility on the batch
  mass-weighted mean (H/C < 0.5 AND O/C < 0.2), ≥3 per sampled batch, **distribution warning**.
- `src/fn/certification/sources.ts`: `collectCandidateDocumentIdsForRemoval` gathers Samples (and
  their `lab_report` COAs) **by credit batch**, not via `run.samples`.
- `src/lib/isometric/measurement-samples.ts`: `buildMeasurementSampleReference` keyed on
  `creditBatchId` (not `productionRunId`).
- Update the offline unit tests for all of the above to the credit-batch grain.

### Phase 2 — Facility soil-temperature reference field
- New nullable column on the facility certification row (`certifier_projects`) — e.g.
  `soil_temperature_c` + `soil_temperature_source` (dataset/region note for the PDD). `db:generate`.
- Read it in `resolveFacilityEmissionConfig` (or a sibling resolver); apply the 7 °C floor + one
  decimal (reuse `SOIL_TEMPERATURE_FLOOR_C`, `roundSoilTemperatureC`). Fail closed with an
  actionable message if unset when a 200-year removal is submitted.
- Admin "Emission estimates" form: add the field (number + source note).
- `resolveConservativeSoilTemperature` (site-max) is **repurposed** as the future per-removal
  override / reconciliation — emit a warning if a member application's `soil_temperature_c` exceeds
  the declared facility value (conservative-direction check).

### Phase 3 — Measurement-samples submission step in `submit-removal.ts`
- **Delete** the stale `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry.
- In `resolveTemplateInputs`, **skip** the two `biochar_sequestration_200_year_*` components
  (constant set of blueprint keys) — they are not fed by the aggregation→datapoint loop.
- New step in `runRemovalSubmission` (after the datapoint loop, before the removal-body POST),
  mirroring `sensors.ts`/the transport-evidence flow: for each credit batch build + POST a
  `biochar_production_batch` measurement sample (H/C mean+std-dev) + carbon datapoints
  (`total`/`inorganic`/`product_mass`); build + POST one `biochar_soil` sample (facility reference
  temp); bind per the binding-confirm; thread the removal's COA + ledger `source_ids` on. Reuse
  `findMeasurementSampleBySupplierRef` for idempotent reconcile.
- `_unsampled`: no datapoints emitted under Method A; keep `selectSequestrationBlueprintKey`'s hard
  assertion. **Wiring-time check:** confirm an input-less `_unsampled` component doesn't block the
  submission; if it does, fall back to the operator dropping it from the template until Method B.

### Phase 4 — Durability evidence-ledger PDF
- New ledger mirroring `src/fn/certification/evidence-ledger.ts` (the transport one) +
  `src/lib/certification/evidence-ledger/`: @react-pdf renderer → `StorageProvider.putObject` →
  mirrored as a Source in `submitRemoval` (best-effort, content-hash idempotent + retire-prior).
- Content per credit batch: the raw ≥3 Sample values → the submitted **mean + std-dev**, the
  facility soil-temp reference value + dataset/justification, and the eligibility checks
  (H/C < 0.5, O/C < 0.2). It reconciles raw inputs → submitted figures (the COA stays the lab's
  own certificate; this is **noma's working**).
- **Use the `frontend-design` skill** to drive the PDF layout when building this phase.

### Phase 5 — UX surfaces (Isometric-verifier-gated)
- **Lab-sample create form:** reference exactly **one** production run (single-select); surface the
  **derived credit batch** and a live **"this batch has N samples"** count/preview (progress toward
  ≥3; ideally show the runs/days they span for the distribution check).
- **Credit-batch detail:** list the Samples that roll up to the batch (across its runs) + the
  batch-level mean/std-dev that gets submitted; durability readiness (eligibility + ≥3 +
  distribution) inline.
- Reuse existing form/table primitives; follow the canonical page shell + form conventions.

### Phase 6 — Docs & tests
- ADR 0013 (soil-temp reference value — **done**), ADR 0016 (sample run-provenance/credit-batch
  accounting — **done**), CONTEXT.md (Sample / Replicate / Measurement-sample submission — **done**).
  On landing: update `docs/isometric/{schema-mapping,condition-registry,changes}.md`; close P0-03 /
  P0-06; remove this open-questions entry.
- Tests: re-grained per-batch aggregation; per-batch gates (eligibility, ≥3, distribution warning);
  COA-by-batch collection; measurement-samples payload shape (mean+std-dev) + blueprint selection;
  facility soil-temp floor/unset; `_unsampled`-inert assertion; ledger generate→mirror; E2E —
  multi-run single-feedstock credit batch with ≥3 distributed samples → submit.

## Open / watch
- **Sequencing vs the in-flight re-grain** on this branch — let the ADR 0016 schema work settle/commit
  first; Phase 1 layers on top of it.
- **Issue #291** (template-driven remodel) shares the measurement-sample path — coordinate so the
  submission layer isn't double-built.
- **`_unsampled` input-less component** — verify it doesn't block submission (Phase 3 wiring-time).
- **Sandbox confirms** — the only thing between staged and live; decision rules pre-agreed above.
