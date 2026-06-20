# Plan: Tier 1 — wire the live 200-year durability measurement-samples submission

**Date:** 2026-06-19
**Decisions:** ADR 0013 (registry computes `F_durable`; durability inputs feed the dedicated
`biochar_sequestration_200_year_*` blueprints via measurement samples, **not** `INPUT_MAPPING`)
· ADR 0015 (credit batch = protocol production batch; production process scopes Method A/B; the
sampling unit is the credit batch). Sharpened in a `grill-with-docs` session, 2026-06-19.
**Branch:** `feat/credit-batch-production-process` (builds **on** the ADR 0015 re-grain landing here).
**Status:** Design locked. **Phases 1–4 DONE (staged)** on `feat/tier1-durability-live-wiring`;
the **live POST** stays gated (`DURABILITY_MEASUREMENT_SAMPLES_LIVE = false`) on two
sandbox-empirical confirms the operator runs. **Phases 5–6 pending** (next: Phase 5 UX surfaces —
lab-sample create form + credit-batch sample list/aggregation).

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
written at the **production-run** grain. ADR 0015 re-pointed lab samples to `samples.creditBatchId`
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
  guards an impossible Method-A-unsampled state). **No Method-B estimate math** (future ADR ~0016).
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

### Phase 3 — Measurement-samples submission step in `submit-removal.ts` ✅ DONE (staged) — 2026-06-19, branch `feat/tier1-durability-live-wiring`
- ✅ New step `src/fn/certification/durability-measurement-samples.ts`: pure
  `buildDurabilityMeasurementSampleSubmissions` (per sampled credit batch → one
  `biochar_production_batch` sample carrying H/C + total/inorganic carbon + product mass values,
  then one `biochar_soil` facility-reference sample) + `submitDurabilityMeasurementSamples` (POSTs
  each via `performRegistryCreate` + `findMeasurementSampleBySupplierRef` reconcile, idempotent on
  the versioned supplier ref). Wired into `runRemovalSubmission` after the datapoint loop, before
  the removal-body POST.
- ✅ `buildBiocharSoilSample` now consumes `FacilityReferenceSoilTemperature` (Phase 2's value), not
  the site-max `ConservativeSoilTemperature`; `buildBiocharProductionBatchSample` extended with the
  carbon + product-mass values (sandbox-gated property/unit/scale constants).
- ✅ `resolveTemplateInputs` **and** `buildCreateGhgEntryRequest` skip the two
  `biochar_sequestration_200_year_*` components (constant key set via `isSequestrationBlueprintKey`)
  — they're carried by the measurement-samples step, not the datapoint loop. This also makes an
  input-less `_unsampled` component inert (skipped, never blocks the submission) — the wiring-time
  concern is resolved structurally; `selectSequestrationBlueprintKey`'s hard assertion stays.
- ✅ **Live POST gated** behind `DURABILITY_MEASUREMENT_SAMPLES_LIVE = false`. While off,
  `submitRemoval` hard-blocks any template that declares a sequestration component with a "staged,
  not yet live" `SafeError` (so the new template can't be submitted until the two confirms land).
- ⏸️ **DEFERRED (user-approved 2026-06-19):** deleting the stale `carbon_rich_substance_sequestration`
  `INPUT_MAPPING` entry. It is load-bearing for the still-live old-template carbon path (5 tests +
  `certify-field-registry.ts`); deleting it while the new path is gated breaks working tests for
  zero gain. Delete at the **live-flip cutover** (the final cleanup) — tracked in
  `docs/open-questions.md` `isometric/durability-measurement-samples`.
- ⚠️ **Two deltas the next session must know:**
  1. **`source_ids` can't ride on the measurement-sample body** — `CreateMeasurementSampleRequest`
     has no `source_ids` field (verified against `certify.d.ts`). The COA/ledger evidence still
     attaches to the removal's monitored datapoints + removal-body `source_ids`; binding evidence to
     the measurement-sample datapoints (D4) is part of the gated binding follow-up.
  2. **Binding = auto-link structural default.** The removal body skips the sequestration
     components, assuming the registry auto-links the measurement-sample datapoints by
     type/property. If sandbox confirm #1 returns **explicit reference**, switch to: capture each
     POSTed sample's `values[].datapoint_id` (the response carries them) → populate
     `datapointIdsByRtcInput` → stop skipping in `buildCreateGhgEntryRequest` (bind as LIST inputs).
     The feasibility is confirmed (`MeasurementSample.values[].datapoint_id` is returned on POST).

### Phase 4 — Durability evidence-ledger PDF ✅ DONE — 2026-06-20, branch `feat/tier1-durability-live-wiring`
- ✅ New ledger mirroring `src/fn/certification/evidence-ledger.ts` (the transport one) +
  `src/lib/certification/evidence-ledger/`: @react-pdf renderer (`durability-pdf.ts`) →
  `StorageProvider.putObject` → mirrored as a Source in `submitRemoval` (best-effort, content-hash
  idempotent + retire-prior).
- ✅ Content per credit batch: the raw ≥3 Sample values → the submitted **mean + std-dev**, the
  facility soil-temp reference value + dataset/justification + floor note, and the eligibility
  verdict (H/C_org < 0.5, O/C_org < 0.2). Figures come from `buildPerBatchDurabilityData` (the same
  aggregation the measurement-sample POST submits), so the ledger reconciles exactly. Shown in
  noma's native units (the wire-unit transforms are a separate, gated concern). COA stays the lab's
  own certificate; this is **noma's working**.
- ✅ Used the `frontend-design` skill — hero is the eligibility gate written literally (tinted
  mean vs `< 0.50` ceiling + verdict swatch); per-batch tables reduce raw replicates into a
  SUBMITTED mean ± s.d. subtotal; soil-reference block closes the sheet. Glyph-safe (Latin subset
  only — pass/fail carried by colour + word, never a tick glyph). Eyeballed eligible + ineligible +
  floored + single/multi-batch states.
- ✅ **DRY refactor (no behaviour change):** the reuse/render/store/mirror/retire choreography is now
  a shared `src/fn/certification/evidence-ledger-core.ts` (`ensureLedgerSource`); both transport and
  durability ledgers are thin wrappers over it. A `src/fn/certification/ensure-evidence-ledgers.ts`
  helper runs both best-effort at submit (kept `submit-removal.ts` under the 1000-line cap).
- ✅ Generation is NOT gated on `DURABILITY_MEASUREMENT_SAMPLES_LIVE` (benign evidence, unit-stable);
  it self-skips when there are no sampled batches / no soil reference / no mapping / no batches.
  Tests: `durability-build-model.test.ts` (raw→submitted reconciliation, eligibility verdicts,
  inorganic Eq.2 derivation, distribution count, unsampled skip, soil floor). Full suite green (840).

### Phase 5 — UX surfaces (Isometric-verifier-gated)
- **Lab-sample create form:** reference exactly **one** production run (single-select); surface the
  **derived credit batch** and a live **"this batch has N samples"** count/preview (progress toward
  ≥3; ideally show the runs/days they span for the distribution check).
- **Credit-batch detail:** list the Samples that roll up to the batch (across its runs) + the
  batch-level mean/std-dev that gets submitted; durability readiness (eligibility + ≥3 +
  distribution) inline.
- Reuse existing form/table primitives; follow the canonical page shell + form conventions.

### Phase 6 — Docs & tests
- ADR 0013 (soil-temp reference value — **done**), ADR 0015 (sample run-provenance/credit-batch
  accounting — **done**), CONTEXT.md (Sample / Replicate / Measurement-sample submission — **done**).
  On landing: update `docs/isometric/{schema-mapping,condition-registry,changes}.md`; close P0-03 /
  P0-06; remove this open-questions entry.
- Tests: re-grained per-batch aggregation; per-batch gates (eligibility, ≥3, distribution warning);
  COA-by-batch collection; measurement-samples payload shape (mean+std-dev) + blueprint selection;
  facility soil-temp floor/unset; `_unsampled`-inert assertion; ledger generate→mirror; E2E —
  multi-run single-feedstock credit batch with ≥3 distributed samples → submit.

## Open / watch
- **Sequencing vs the in-flight re-grain** on this branch — let the ADR 0015 schema work settle/commit
  first; Phase 1 layers on top of it.
- **Issue #291** (template-driven remodel) shares the measurement-sample path — coordinate so the
  submission layer isn't double-built.
- ~~**`_unsampled` input-less component** — verify it doesn't block submission (Phase 3 wiring-time).~~
  **Resolved (Phase 3):** sequestration components (incl. `_unsampled`) are skipped in both
  `resolveTemplateInputs` and `buildCreateGhgEntryRequest`, so an input-less one can't block.
- **Sandbox confirms** — the only thing between staged and live; decision rules pre-agreed above.
