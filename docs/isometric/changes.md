# Isometric Docs Change Log

Certification remodel implementation notes from 2026-06-03 and 2026-06-04 are
archived in
[`docs/archive/isometric-changes-archive-2026-06-certification-remodel.md`](../archive/isometric-changes-archive-2026-06-certification-remodel.md).

Feedstock type certification guardrail implementation notes from 2026-06-13 are
archived in
[`docs/archive/isometric-changes-archive-2026-06-13-feedstock-type-certification-guardrails.md`](../archive/isometric-changes-archive-2026-06-13-feedstock-type-certification-guardrails.md).

Transport-leg evidence now reaches Isometric as mirrored Sources, and submit can
auto-generate a transport evidence ledger Source from live legs. Dated
implementation and sandbox-verification notes from 2026-06-19 are archived in
[`docs/archive/isometric-changes-archive-2026-06-19-transport-evidence-sources-and-ledger.md`](../archive/isometric-changes-archive-2026-06-19-transport-evidence-sources-and-ledger.md).

## 2026-07-21 (actionable transport-evidence readiness)

Transport evidence now has one reusable operator workflow across feedstocks,
deliveries, and manually managed transport legs. The UI uses one multi-file
uploader with an explicit classification choice: bill of lading, weigh-scale
ticket, or other transport evidence. These are alternatives; one successfully
uploaded classified file is sufficient.

Readiness is composite and reflects saved state: the effective distance source
must be `document` and at least one accepted transport-evidence document must
exist. Either fact alone remains incomplete. Persisted complete fields stay
green in view and edit modes; incomplete evidence is orange and dashboard
attention links focus the actionable transport section. Migration 0084 adds
`other_transport_evidence` to `documentation_type`.

This is an operator-readiness and evidence-classification change. It does not
change Isometric payload mappings or make a new protocol claim.

## 2026-07-10 (1000-year sandbox submission verified end to end)

The 1000-year removal path has now passed a live Isometric sandbox submission
with three raw lab replicates. The sandbox accepted `carbon_contents` as
`mass_fraction_dry_basis/total_carbon` and `s_fraction` as
`dimensionless_ratio/inertinite_fraction`, both with dimensionless 0–1 values.
The removal was created successfully and its GHG Statement membership was
reconciled from Isometric.

- `samples.s_reflectance_fraction` is captured in the lab-sample form as a
  percentage and stored/submitted as a 0–1 fraction. Server-side validation and
  certification readiness require it for 1000-year samples.
- The sandbox-only `DURABILITY_MEASUREMENT_SAMPLES_LIVE` environment opt-in now
  drives the versioned measurement-sample snapshot and POST. Enabling it against
  production is rejected at boot.
- 1000-year submission fails closed unless every sample in the batch carries
  total carbon plus `s_fraction` and at least three complete replicates exist.
- The local readiness preview derives paired R0/non-reactive-carbon statistics
  from sample replicates, accepts reactive carbon by deriving its residual
  complement, and never mixes partial sample statistics with legacy batch
  aggregates.
- A facility soil-temperature reference is no longer required for a 1000-year
  snapshot; it remains mandatory for 200-year durability samples.
- GHG Statement creation adopts one exact pre-existing Isometric draft before
  attempting a POST and remains fail-closed when multiple matching drafts exist.

This validates sandbox wire compatibility only. Production remains gated, and
the 200-year H/C binding and unit questions below remain open.

## 2026-07-04 (durability tier facility-scoped + 1000-year submission path — ADR 0021, issue #358)

The durability tier (200-year vs 1000-year) is now **declared once per facility
and inherited downward** — its credit batches, their samples, and the facility's
Isometric removal template all read one tier (**ADR 0021**). `facility.durabilityOption`
is authoritative (renamed from `defaultDurabilityOption`); the per-batch
`credit_batches.durability_option` column is **dropped** and the tier is
**join-derived from the facility** on every batch-loading query, so the ~28
existing `batch.durabilityOption` read sites keep working. 1000-year is the
go-forward tier; 200-year is surfaced-but-disabled ("available later") in the UI.
DEC (Moshi) reseeds as a 1000-year facility.

- **Submit-time template↔tier guard.** `submitRemoval` now maps the facility tier
  to its expected sequestration blueprint (`expectedSequestrationBlueprintKeys`:
  200-year → `biochar_sequestration_200_year_{c_org,unsampled}`; 1000-year →
  `biochar_sequestration_1000_year`) and **fails closed early** with an actionable
  message when the template's `co2-stored` component is outside that set. This
  replaces today's misleading "no INPUT_MAPPING entry … update
  transformers/datapoint.ts" error for a 1000-year template.
- **Sequestration family recognition.** `resolveTemplateInputs` now skips the whole
  `biochar_sequestration_*` **family** (`isSequestrationBlueprintFamily`) from the
  datapoint loop, and `biochar_sequestration_1000_year` is in
  `SEQUESTRATION_BLUEPRINT_KEYS`, so a 1000-year template reaches the staging gate
  (`DURABILITY_MEASUREMENT_SAMPLES_LIVE`, still **false**) — the intended
  "staged, not yet live" stop — instead of the missing-mapping error.
- **1000-year measurement-sample builder (⚠️ built to the live BLUEPRINT, not
  module Eq.6).** `build1000YearSequestrationSample` submits per-replicate
  `carbon_contents` + `s_fraction` LISTS + a `product_mass` SCALAR, with **no local
  mean/−SE/cap** — the registry computes
  `product_mass × mean(carbon_contents) × (mean(s_fraction) − binomial SE) × 3.667`.
  The blueprint has no non-reactive-carbon input and no 0.95 cap (both in Eq.6 —
  divergence recorded in ADR 0013 and `open-questions.md`
  `certification/fdurable-1000-r0-semantics`). Unit-tested; **not yet wired into the
  (blocked) submit path** — the exact datapoint↔list-input binding is the remaining
  sandbox confirm.
- **s_fraction data model.** New nullable `samples.s_reflectance_fraction` — the
  per-sample proportion (0–1) of R₀ readings ≥ 2% (ISO 7404-5 inertinite fraction).
  Seeded on the 1000-year replicates. Form capture landed in the 2026-07-10
  sandbox-verification change above.
- **Still needs Isometric staff sign-off** (does not block the gated plumbing):
  Eq.6-vs-blueprint governance for the durable fraction; total-vs-organic carbon for
  `carbon_contents`; cross-entry shared-datapoint uncertainty; the empirical sandbox
  test-submit before flipping the flag. See `open-questions.md`.

All local protocol summaries are non-authoritative — verify against the linked
Isometric blueprint/module before making a credit claim.

## 2026-07-04 (Isometric compliance sign-off — issue #353)

Answers confirmed for the three protocol/platform questions raised in #353
(follow-up to #349 / ADR 0020). Recorded per stakeholder confirmation on
2026-07-04:

- **§8.6.2 cross-period allocation — CONFIRMED IN WRITING by Isometric.** The
  front-loading pattern is accepted: a batch's **earliest-quarter** GHG entry
  carries **all** production-side operational emissions (grid electricity,
  genset + startup diesel, feedstock mass CI, feedstock/sample transport);
  later-quarter entries from the same batch carry **only** that quarter's
  delivery emissions + applied-mass-scoped stored CO₂e. This is more
  conservative than proration (emissions land earlier, never deferred) and
  **unblocks the #349 cross-quarter straddle-path live submission**.
- **`removal*` / `removal_template*` alias sunset — CONFIRMED ~Sept 2026.** The
  deprecated endpoint aliases (renamed to `ghg_entry*`) sunset around September
  2026. **Action:** migrate all remaining `removal*`/`removal_template*` API
  usage to `ghg_entry*` now and remove the deprecated surface (see the dated
  entry below once the migration lands). Supersedes the "~Sept 2026 (unverified)"
  note from #291.
- **Post-verification material-error remedy — CONFIRMED.** Verified GHG
  statements are immutable; the remedy for a material error is always buffer
  pool / reversal, never a restatement of the verified statement.
- **API-level datapoint sharing across a batch's GHG entries — STILL OPEN.**
  Not yet confirmed; #353 stays open on this item only. Measurement samples are
  batch-anchored, so sharing one batch's chemistry across its two quarterly
  entries via the API is the *presumed* model, but Isometric has not confirmed
  the UI "cannot share between removals" restriction is UI-only.

## 2026-07-04 (generator/startup diesel split — two pyrolysis fuel_usage_by_volume components)

Amends #319. The Dark Earth template now declares **two** pyrolysis
`fuel_usage_by_volume` components instead of one combined diesel datapoint:
"Generator diesel usage" and "Startup diesel usage", both sharing the same fixed
volumetric EF. Because the EF is identical on both, total emissions are
unchanged versus one combined component — the split is **presentation-only** (it
shows generator vs. startup diesel separately on the registry). It exists
because a single `fuel_usage_by_volume` triple declared by two components would
otherwise send the combined litres to **each** component (double-count).

- **Re-bucket** — `src/lib/isometric/utils/aggregation.ts`: preprocessing fuel
  moves from the startup bucket to the genset ("summarized") bucket, so
  `totalStartupDieselLitres` = `dieselOperationLiters` only and
  `totalGensetDieselLitres` = `dieselGensetLiters` + `preprocessingFuelLiters`.
  `totalDieselLitres` (the sum) is unchanged. The Energy summary query
  (`data-access/production-runs/queries.ts`) mirrors the same split.
- **Component-aware mapping** — `transformers/datapoint.ts`: the pyrolysis
  `fuel_usage_by_volume/volume_of_fuel` entry gains `sourceByComponent`
  (`PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT`). Certify's template model has **no
  stable per-component key**, so the source is resolved by the component
  **display name** (normalized), via `resolveDatapointSource`.
  `buildCreateDatapointRequest` now takes `componentDisplayName`
  (threaded from `submit-removal.ts`) and **fails closed** on an unrecognized
  name — a rename or added component surfaces loudly instead of silently
  double-counting or mis-bucketing.
- **Cert badging** — `certify-field-registry.ts`: the derived, unbadged
  `startupDieselFuelUsage` descriptor is replaced by three `entered` (badged +
  readiness-gating) descriptors — `dieselOperationLiters`,
  `preprocessingFuelLiters`, `dieselGensetLiters` — so all four energy inputs
  (incl. electricity) are cert-relevant. `isPresent(0)` is true, so a recorded
  `0` still satisfies readiness; a **blank** field now gates.
- **Template requirement** — the two components must be named exactly
  `Generator diesel usage` (carries genset + preprocessing litres) and
  `Startup diesel usage` (reactor-startup / plant litres), matched
  case/whitespace-insensitively. Rename ⇒ update
  `PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT`.
- **Deferred** — the display-name coupling is interim; a facility-configurable
  component→source mapping + assignment wizard is tracked in
  `docs/open-questions.md`.

## 2026-07-03 (issue #319 — diesel submits as fuel_usage_by_volume, litres × template EF)

Fixes protocol-noncompliant fuel accounting (energy-use-accounting v1.3 Eq 7:
fuel emissions = fuel quantity × a well-to-wheel fuel EF). Genset diesel was
converted litres → kWh via the facility genset yield and submitted through
`pyrolysis/energy_based_ci_emissions/energy` — modeling fuel as electricity CI.
Decision recorded as an amendment to
[ADR 0015](../adr/0015-energy-single-combined-measurement-point.md).

- **Mapping** — `src/lib/isometric/transformers/datapoint.ts`: under
  `pyrolysis`, `energy_based_ci_emissions` is deleted and
  `fuel_usage_by_volume/volume_of_fuel` added (unit `l`, quantity kind
  `volume`, source `totalDieselLitres`). The
  `biomass-feedstock-sourcing`/`-processing` `fuel_usage_by_volume` entries
  are deleted (their startup diesel now rides in the combined figure — keeping
  them would double-count). `MAPPING_REVISION` re-hashes, so resubmits
  supersede prior Removal versions (intended).
- **Aggregation** — `src/lib/isometric/utils/aggregation.ts`:
  `AggregatedProductionData.totalDieselLitres` = `totalStartupDieselLitres` +
  `totalGensetDieselLitres` (both attribution-scaled; split fields kept for
  local reporting). `totalGensetKwh`, `FacilityEmissionConfig`, and
  `enrichWithFacilityConfig` are deleted; `submit-removal.ts` drops
  `resolveFacilityEmissionConfig` — the genset yield no longer gates or
  affects submission. The volumetric diesel EF is a **fixed input pre-bound on
  the Isometric template**; noma never stores or submits it (an unbound EF
  fails closed via the existing `unboundFixedInputs` SafeError).
- **Registry/UI** — `certify-field-registry.ts` maps `dieselGensetLiters` and
  `startupDieselFuelUsage` to the shared pyrolysis volume tuple;
  `facilityEmissionConfig` descriptors emptied (admin genset-yield field loses
  its certify badge; the column/form stay as a vestigial local estimate —
  dropping them is a follow-up migration). `/energy` submission preview shows
  one combined "Diesel fuel (genset + startup)" litres row; the litres×yield
  copy and yield-missing prompt are gone.
- **Warnings** — `submission-warnings.ts` advisory now covers genset diesel
  too and checks specifically for a `fuel_usage_by_volume` component in the
  `pyrolysis` group (mitigates silent under-reporting if a future template
  drops the component).
- **Deploy sequencing** — the live/sandbox template must be re-authored to
  declare `pyrolysis/fuel_usage_by_volume` with the diesel EF bound as a fixed
  input. Code-before-template and template-before-code both fail closed
  (missing-mapping / quantity-kind SafeErrors). Live flip gated on the sandbox
  confirm per the issue's acceptance criteria.
- **Out of scope** — wood/kg-metered fuels (`fuel_usage_by_mass`, #319b);
  dropping `certifier_projects.genset_energy_yield_kwh_per_litre`.

## 2026-07-03 (issue #320 — removal period end anchored to biochar application date)

Biochar protocol v1.3 §8.6.2: the Reporting Period "ends upon application of
biochar from that batch at the storage site" — a batch produced in Q1 but
applied in Q2 belongs to the Q2 GHG Statement.

- **`completed_on` = MAX(`applications.application_date`) across the removal's
  lineages** (`resolveLatestApplicationTime` in
  `fn/certification/removal-reporting-window.ts`); `buildCreateGhgEntryRequest` now takes
  an explicit `reportingWindow` instead of the production aggregation. Fails
  closed on an empty lineage list — no fallback to production end anywhere.
- **`measured_at` (durability measurement samples) and the sensor-telemetry
  window keep production-run semantics** — `agg.latestEndTime` still feeds
  them; only the GHG-entry dates, the semantic hash, and the local
  `certifier_removals.startedOn/completedOn` stamp moved.
- **Hash-covered ⇒ supersede:** the new `completedOn` is part of the semantic
  payload hash, so resubmitting an already-submitted removal creates a new
  version that supersedes the production-end-dated one (intended one-time
  correction wave). Pre-#320 locked drafts resume with their snapshot's
  production-end window by design.
- **Inversion guard:** an application dated before the earliest production
  start blocks the submit with an actionable SafeError (before any POST), so
  the DB `startedOn <= completedOn` check can never be tripped by the
  best-effort local stamp.
- **Straddle advisory (non-blocking):** `buildSubmissionWarnings` warns when
  the UTC month of the earliest run start differs from the latest application
  month — §8.6.2 attributes operations emissions to the period they occur in.
- The live behaviour flip stays gated behind the issue's two sandbox confirms
  (statement-membership inequality + `reporting_period_start_at` derivation).

## 2026-07-02 (ADR 0018 — project-emissions journal removed)

Executes the approved removal plan
([`docs/archive/plans/2026-06-17-remove-project-emissions-journal.md`](../archive/plans/2026-06-17-remove-project-emissions-journal.md));
decision recorded in [ADR 0018](../adr/0018-isometric-owns-project-emissions.md),
which supersedes the journal half of ADR 0005.

- **Deleted:** the "Period emissions (LCA-derived)" journal section + registry
  drift panel on `/certification/settings`, the `certifier_project_emissions`
  table + `project_emission_category` pgEnum (migration `0065`, destructive —
  no prod data), the project-emissions schemas/data-access/fn/hooks, the
  `CATEGORY_TO_BLUEPRINT` matcher, and the drift half of
  `scripts/isometric-coverage-check.ts` (its `expectedCategories` fixture field
  included).
- **Kept:** the scope-conflict guard (`PERIOD_INPUT_TUPLES` + `SafeError` in
  `transformers/datapoint.ts`, now self-contained string literals) and the
  template-coverage half of the coverage check (still in
  `isometric-health.yml`; `--source=db` now reads `certifier_projects` only).
- **Operational expectation:** the operator authors PROJECT-scope Components in
  the Isometric UI and attaches the source LCA PDF to each Component's
  **Sources** field — the registry is the sole system-of-record for period
  emissions (matters most for `pyrolyzer_direct`).

## 2026-06-20 (ADR 0017 Track 2 — Method-B unlock backend + operator UI)

Track 2 activates the Method-B unlock end-to-end (ADR 0017; implementation record
[`docs/archive/2026-06-20-method-b-unlock.md`](../archive/2026-06-20-method-b-unlock.md)).
The registry stays the authority for the credited compute (ADR 0013 / D1) —
everything here **gates, routes, and previews**; it never submits a credited
number. The live `_unsampled` POST stays gated behind
`DURABILITY_MEASUREMENT_SAMPLES_LIVE = false` (wire format unconfirmed).

- **Schema/backstop:** new `production_processes` unlock columns
  (`method_b_unlocked_at`, `agreed_baseline_size`, `random_sampling_plan_ref`,
  `moisture_pathway`; migration `0059`) and the process-grain **DB trigger
  backstop** re-asserting the ≥30-sample floor (migration `0060`). The backstop
  counts only the **pre-unlock baseline** (`sampling_time < method_b_unlocked_at`)
  so post-unlock Method-B samples can't mask a later regression/deletion of the
  original baseline; the app guard (`unlockMethodBForProcess`) mirrors the same
  `as_of = unlock` boundary via `countEligibleSamplesByProcess`.
- **Pure engines (non-authoritative):** `previewUnsampledCarbon` (Eq 4/5,
  μ − σ/√n over the trailing-6-month eligible pool) and
  `evaluateProcessComplianceDrift` (the two 6-month review-trigger counters). The
  eligible-window boundary lives in one place (`eligibleWindowCutoff` /
  `isWithinEligibleWindow` / `filterEligibleSamples`), shared by the preview and
  the compliance carbon window.
- **Server actions / reads:** `unlockMethodBForProcess` (app guard + trigger,
  captures the three prerequisites), `getProcessComplianceDrift`,
  `getUnsampledCarbonPreviewForProcess` (shared `loadProcessSamples` loader), and
  `startNewProductionProcess` (baseline reset), wired through `fn/` + hooks.
- **Submission routing:** unsampled Method-B batches route to the `_unsampled`
  blueprint, dispatched off `selectSequestrationBlueprintKey` (the blueprint IS
  the Method A/B distinction; fail-closed on the impossible unsampled-Method-A
  state). Gated — the whole measurement-sample step stays behind the flag.
- **Operator UI** at **`/certification/production-processes`** — moved under the
  `certification` segment so `CertificationRegistryGuard` gates direct URL access
  on a registry link, exactly like Removals/GHG Statements (no Method A/B to
  manage off the registry). Eligible Method-A rows get a one-click **Unlock**;
  the detail panel hosts the protocol-cited explainer (Isometric only), the
  non-authoritative unsampled-carbon preview, the warn-only compliance-drift
  counters, the **Start new process** reset, and the three captured prerequisites
  surfaced read-only. All thresholds pull from `@/config/certification`.

## 2026-06-20 (ADR 0017 Track 1 — re-grain Method-B sampling/eligibility to the production process)

Track 1 of the Method-B unlock (ADR 0017; implementation record
[`docs/archive/2026-06-20-method-b-unlock.md`](../archive/2026-06-20-method-b-unlock.md)).
**Method-A-safe** — changes the
sampling/eligibility *grain*, not behaviour. Moves the Method-A/B baseline counter
off the reactor onto the **production process** (`(facility, feedstock)` campaign),
closing a latent **cross-feedstock over-credit bug** (a reactor's hardwood samples
counted toward a softwood batch's eligibility).

- `getMethodBEligibilityByReactor` → `getMethodBEligibilityByProcess`
  (`src/data-access/isometric.ts`): counts eligible replicate samples via
  `credit_batches.production_process_id`, not the reactor.
- `deriveSamplingRequirement` re-grained run → credit batch (`BatchSampling`);
  per-run replicate check → per-batch pooled. Constants renamed
  `METHOD_B_SAMPLING_CADENCE_RUNS`/`MINIMUM_REPLICATES_PER_RUN` →
  `…_CADENCE_BATCHES`/`…_PER_BATCH`.
- `validateProcessSamplingMethodFn` + `processSamplingMethodSchema` (`process_id`)
  replace the old reactor/credit-batch-grained names.
- New read-only **`/production-processes`** operator surface (Verification nav):
  per-process sampling method, baseline progress (N / 30), cadence status — where
  Track 2's unlock CTA attaches. Verified live in Chrome + PR-CI E2E
  (`tests/e2e/production-processes.spec.ts`).
- Method B itself stays **inert** (the unlock is Track 2); the unsampled `_unsampled`
  route remains deferred under `ADR 0017` Track 2.

## 2026-06-20 (Tier-1 — 200-year durability live-wiring, Phases 1–5; live POST staged behind a flag)

Wires the 200-year durability submission onto the **measurement-sample** path
(ADR 0013: the registry computes `F_durable`; durability inputs feed the dedicated
`biochar_sequestration_200_year_*` blueprints via measurement samples, **not**
`INPUT_MAPPING`) and re-grains the whole durability data plane onto the **credit
batch** (ADR 0016: the credit batch IS the protocol production batch; the sampling
unit is the batch, never the run). Plan:
`docs/plans/2026-06-19-tier1-durability-live-wiring.md`. **The live POST is staged,
not on** — gated behind `DURABILITY_MEASUREMENT_SAMPLES_LIVE = false`
(`src/fn/certification/durability-measurement-samples.ts`) pending two operator
sandbox confirms (see `docs/open-questions.md` →
`isometric/durability-measurement-samples`).

Phase 1 — **run → credit-batch re-grain** (the spine). Post-ADR-0016, lab samples
attach on `samples.creditBatchId` (run link now nullable provenance) and the old
`getProductionRunsWithSamples` read skips null-run samples — so lab chemistry was
invisible to the durability surfaces. Re-grained:

- `src/lib/isometric/utils/durability-aggregation.ts` — `buildPerBatchDurabilityData`
  iterates **credit batches**, pooling each batch's replicates (across member
  runs/days) into one mean + sample std-dev; `PerBatchDurabilityDatapoint` keys on
  `creditBatchId` / `creditBatchCode`, not the run.
- `src/data-access/credit-batch-samples.ts` — `getCreditBatchesWithSamples` /
  `getSamplesByCreditBatchIds` source by `samples.creditBatchId` (no null-run skip).
- `src/lib/certification/durability-submission-gates.ts` — `evaluateDurabilitySubmissionGates`
  evaluates **per credit batch**: eligibility on the batch's pooled replicate mean
  (H/C_org < 0.5 AND O/C_org < 0.2, indeterminate fails closed), ≥ 3 usable
  replicates per sampled batch, plus a non-blocking distribution warning when the
  usable replicates cluster on one run/day (`countDistinctProvenance`).
- `src/fn/certification/sources.ts` — the COA / `lab_report` candidate-document walk
  gathers Samples **by credit batch**.

Phase 2 — **facility reference soil temperature**. New nullable columns on the
facility certification row: `certifier_projects.default_soil_temperature_c` (real,
with a `..._range` check + 7 °C floor / one-decimal via `SOIL_TEMPERATURE_FLOOR_C`,
`roundSoilTemperatureC`) and `default_soil_temperature_source` (dataset/region note
for the PDD). Resolved by `resolveFacilityReferenceSoilTemperature`
(`FacilityReferenceSoilTemperature`); operator-entered on the admin
"Emission estimates" form. This is the sanctioned no-on-site-baseline path (global
soil-temp DB, e.g. Lembrechts 2022; air temperature prohibited); justification lives
in the PDD, so the API needs no description field. The old site-max
`resolveConservativeSoilTemperature` is repurposed as a future per-removal override /
conservative-direction reconciliation check.

Phase 3 — **measurement-samples submission step** (staged). New
`src/fn/certification/durability-measurement-samples.ts`:
`buildDurabilityMeasurementSampleSubmissions` (per sampled credit batch → one
`biochar_production_batch` sample carrying H/C + total/inorganic carbon + product
mass; then one `biochar_soil` facility-reference sample) +
`submitDurabilityMeasurementSamples` (POST via `performRegistryCreate` +
`findMeasurementSampleBySupplierRef` reconcile, idempotent on the versioned supplier
ref). Wired into `runRemovalSubmission` after the datapoint loop, before the
removal-body POST. `resolveTemplateInputs` **and** `buildCreateGhgEntryRequest` skip
the two `biochar_sequestration_200_year_*` components (`isSequestrationBlueprintKey`)
— they're carried by this step, which also makes an input-less `_unsampled` (Method
B) component inert. While the flag is off, `submitRemoval` hard-blocks any template
declaring a sequestration component with a "staged, not yet live" `SafeError`.
**Two sandbox-empirical confirms still gate the flip:** (1) datapoint↔component-input
binding (explicit `datapoint_id` reference vs. auto-link by type/property); (2) the
H/C unit scale (`%` vs. dimensionless ~0.5). Doc evidence leans dimensionless +
explicit reference; both are pre-decided as one-constant edits. `source_ids` cannot
ride on the measurement-sample body (`CreateMeasurementSampleRequest` has no such
field) — evidence stays on the removal's datapoints + removal-body `source_ids`.

> **Deferred to the live-flip cutover:** deleting the stale
> `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry + its two
> `certify-field-registry.ts` tuples. It is load-bearing on the still-live
> old-template carbon path (5 tests); deleting it while the new path is gated breaks
> working tests for zero gain. Tracked in the open-questions entry above.

Phase 4 — **durability evidence-ledger PDF**. `src/fn/certification/durability-evidence-ledger.ts`
+ `src/lib/certification/evidence-ledger/durability-{build-model,pdf,types}.ts`:
@react-pdf renderer → `StorageProvider.putObject` → mirrored as a `durability_evidence_ledger`
Source on submit (best-effort, content-hash idempotent + retire-prior). Reconciles
the raw ≥ 3 replicates → the submitted mean + std-dev, the facility soil-temp
reference + dataset/floor note, and the eligibility verdict — figures from the same
`buildPerBatchDurabilityData` the measurement-sample POST submits, so the ledger ties
out exactly. Generation is **not** gated on the live flag (benign evidence,
unit-stable) and self-skips when there's nothing to evidence. The reuse / render /
store / mirror / retire choreography is shared with the transport ledger via
`evidence-ledger-core.ts` (`ensureLedgerSource`); both run best-effort at submit
through `ensure-evidence-ledgers.ts`.

Phase 5 — **two UX surfaces + the sample→credit-batch linking write-path**.
`sample-batch-progress.tsx` (in the lab-sample form) derives the credit batch from
the chosen run and shows live N/3 progress + distinct run/day provenance + eligibility
chips; `credit-batch-durability-panel.tsx` (on credit-batch detail) shows the sample
roll-up + the submitted mean ± s.d. + readiness chips (`durability-readiness.tsx`).
Both read `durability-batch-summary.ts` (lib + fn) via `useBatchDurabilitySummary` /
`useRunDurabilitySummary`. Building these surfaced a **load-bearing gap**: the
lab-sample form never set `samples.creditBatchId`, so form-created samples never
rolled up. Fixed per ADR 0016's "both links stay populated": `createSample` /
`updateSample` derive `creditBatchId` from the run (`resolveRunCreditBatchId`);
`createCreditBatch` / `updateCreditBatch` back-fill member runs' samples on membership
change. Covered by `tests/credit-batch-sample-linking.test.ts`. **Preserve this
linking** — the durability surfaces and the measurement-sample submission depend on it.

## 2026-06-19 (ADR 0016 Phase 1 — credit batch = production batch, process scopes sampling)

Credit batch becomes the Isometric **production batch**: one feedstock,
facility-scoped, ≤ 1 month under Isometric. A new `production_processes` entity
keyed `(facility, feedstock)` — spanning reactors per Biochar Protocol §8.3.1 —
owns the sampling regime (`sampling_method`), moved **off** `reactors`.

Phase 1 (data model + server-side derivation only; commit `dde0c8e`, PR #294):

- `production_processes` table; find-or-created per `(facility, feedstock)` on
  credit-batch create. Inert `method_b_unlocked_at` seam for ADR 0017.
- `credit_batches`: derived `feedstock_type_id` (NOT NULL) + `production_process_id`
  from member runs; a batch whose runs span > 1 feedstock type is rejected.
- `samples` attach per credit batch (`credit_batch_id`); `production_run_id`
  retained as optional in-process provenance.
- Isometric ≤ 1-month cap: Zod `superRefine` + DB `check`.
- Dropped `reactors.sampling_method` and the migration-`0052` Method-B baseline
  trigger (migration `0057`) — DEC is Method A, nothing left to guard at reactor
  grain. The process-grain trigger ships with the ADR 0017 unlock.

Deferred: Phases 2–4 (live sampling logic, submission mapping, credit-batch UI
for the derived feedstock, process-grain sampling UI) and all Method-B compute
(ADR 0017). Tracked in `docs/open-questions.md` →
`certification/credit-batch-sampling-phases`. Decision of record: ADR 0016
(refines ADR 0014). Archived plan:
`docs/archive/2026-06-19-credit-batch-lab-sampling-compliance.md`.

## 2026-06-19 (transport → mass_distance, multi-leg mass-weighting)

Re-binds feedstock and biochar transport to the registry's
`mass_distance_based_ci_emissions` blueprint, matching the operator's
re-authored "Dark Earth Carbon Template" (`rvt_1KS4S43VPSBXA26X`). Verified
live against the sandbox: **every `mass_distance` input in the Certify
blueprint catalog is `data_shape: SCALAR`** — there is no LIST-shaped transport
blueprint anywhere (LIST exists only on chemistry/sensor blueprints, e.g. the
durability `h_c_molar_ratios`). So per-leg datapoints (one datapoint per leg
into a single input) are **not possible** for transport.

Multiple transport legs per run (a run's feedstock can arrive across several
deliveries / storage bins) are handled by **mass-weighting**: each category
submits one `mass_distance` scalar = **Σⱼ(distⱼ_km × massⱼ_tonnes)**, which the
blueprint multiplies by its fixed `carbon_intensity` emission factor. This is
exact when every leg in the category shares that factor (same transport mode —
Isometric Transportation v1.1 §5); a mixed-method/factor or missing-load-mass
category still surfaces a blocking warning (`aggregateTransportMassDistance`).

- **Aggregation** (`utils/aggregation.ts`) — `aggregateTransportLegs` (returned
  a mass-weighted avg distance) became `aggregateTransportMassDistance`
  (returns `massDistanceTonneKm`). `AggregatedProductionData` now carries
  `feedstockTransportMassDistanceTonneKm` / `biocharTransportMassDistanceTonneKm`
  (null when no legs — feedstock/biochar transport is required, so it fails
  closed at submit) in place of the old `*TransportAvgDistanceKm` fields. The
  sample path was already tonne·km (`sampleTransportMassDistanceTonneKm`, 0 when
  empty — sample shipping is optional).
- **INPUT_MAPPING** (`transformers/datapoint.ts`) — `biomass-feedstock-transport`
  and `biochar-transport` now bind `mass_distance_based_ci_emissions/mass_distance`
  (tonne·km) instead of the deleted `transport/{distance,mass}` blueprint; the
  dead `sampling-required-for-mrv/distance_based_ci_emissions/distance` entry was
  dropped (the template uses `mass_distance` for every transport category).
- **Consumers** — `certify-field-registry.ts` and `certify-context-core.ts`
  (`TRANSPORT_SOURCE_TO_CATEGORY`, coverage) follow the renamed fields. No
  pipeline change: the submission path stays one scalar datapoint per
  (component, input) — no 1:many remodel was needed once SCALAR was confirmed.
- **Decision** — true per-leg *visibility* at the certifier would require one
  `mass_distance_based_ci_emissions` component instance per leg (dynamic
  `AddComponentToRemoval`, beyond the template-driven model) and adds **zero**
  numerical accuracy for same-mode legs, so it was rejected. Mixed-mode
  transport (rail/ship legs needing per-mode components with distinct EFs) is
  deferred — see `docs/open-questions.md`.

## 2026-06-18 (durability DB-layer guardrails & coverage-check papercut — R2–R4)

Closes the DB-layer defense-in-depth items from
`docs/archive/plans/2026-06-18-durability-remaining-work-and-followups.md` (R2–R4). The
app already enforces these invariants; the migrations make them hold against
direct SQL too. R1 (live measurement-samples submit) and R5 (project-emissions
scope) remain operator/sequencing-gated.

- **R3 — Method B switch guardrail (P0-03)** — migration `0052` adds a
  `BEFORE INSERT/UPDATE` trigger on `reactors` rejecting
  `sampling_method='method_b'` unless the reactor has ≥30 prior Method A samples
  (counted on its production runs dated before today — mirrors
  `getMethodBEligibilityByReactor`'s `asOfDate=now()` coercion). The ≥1/10
  cadence stays at the fail-closed submission gate **by design** (a point-in-time
  readiness check over in-scope runs, not a single-row invariant a trigger can
  express without blocking normal run-by-run accumulation). The seed's
  `R-26-002` reactor was flipped to Method A — seeding Method B without the
  baseline is the invalid state the trigger (and `createReactor`) forbid.
- **R4 — 200-year issuance evidence guardrail (P0-06)** — migration `0053` adds
  a `BEFORE INSERT/UPDATE` trigger on `credit_batches` blocking a `200_year`
  batch from reaching `verified`/`issued` while any linked application is missing
  `soil_temperature_c` or `soil_temperature_source`, plus a back-door trigger on
  `credit_batch_applications` preventing an incomplete application from being
  linked into an already-`verified/issued` batch. 1000-year batches are excluded
  (reflectance-based, no soil temperature). Both verified against the seeded DB
  with rolled-back probe transactions.
- **R2 — coverage-check `NODE_ENV` papercut** — already shipped in `cedbd29`
  (`scripts/isometric-coverage-check.ts` defaults `NODE_ENV=development`); the
  remaining-work plan was stale on this point. No change needed.
- **UI — replicate cert tag avoided** — the Production Samples table
  (`production-sample-table.tsx`) explicitly does **not** render a certification
  replicate chip because those rows are in-process measurements, not the lab
  `Sample` rows the Certify path reads for the ≥3-replicate gate.

## 2026-06-18 (200-year durability submission & sampling-method enforcement — Phases A–F)

Makes the removal submission carry everything the registry needs to compute the
200-year durable fraction itself, and turns the biochar sampling-method
requirements from captured-but-unenforced policy into real gates. Plan:
`docs/archive/plans/2026-06-18-200yr-durability-submission-and-sampling-method-enforcement.md`;
decision record: ADR 0013. **The live measurement-samples submit wiring is
sandbox-gated** — see `docs/open-questions.md`
(`isometric/durability-measurement-samples`).

- **Eligibility + replicate engine (Phase A)** —
  `src/lib/calculations/biochar-eligibility.ts`: `evaluateRunEligibility` judges
  the protocol's H/C_org < 0.5 AND O/C_org < 0.2 ceilings (module §3 Table 2) on
  the run's replicate MEAN (D8), flagging individually out-of-spec replicates as
  outliers; `evaluateReplicateCount` checks the ≥3-replicate minimum (§4). The
  sample schema documents that inorganic carbon is derived via Eq.2 when absent.
- **Method-driven sampling-requirement engine (Phase B)** —
  `src/lib/certification/sampling-requirements.ts`: derives the required sample
  set from the reactor's CURRENT method (D6, never stored). Method A = every run;
  Method B = the ≥1-per-10-runs cadence (`METHOD_B_SAMPLING_CADENCE_RUNS`),
  previously "Planned" in `condition-registry.md`.
- **Fail-closed submission gates (Phase C)** —
  `src/lib/certification/durability-submission-gates.ts`, wired into
  `submit-removal.ts`: eligibility, every Method A run sampled, ≥3 replicates per
  sampled run — promoted from method-blind logged warnings to hard `SafeError`
  blocks. The method-blind "no samples" warning was removed from
  `aggregateProductionRuns` (it would wrongly block a valid Method B unsampled
  run). Reactor method read live via `getSamplingMethodsByReactorIds`.
- **Per-batch aggregation + conservative soil-temp (Phase D)** —
  `src/lib/isometric/utils/durability-aggregation.ts`: emits one datapoint per
  production batch (replicate mean + sample std-dev) instead of a collapsed
  scalar (D2 revision), inorganic carbon derived as max(0, total − organic); the
  conservative soil-temp estimate = max site temperature (7 °C floor, > 1 °C
  subdivide advisory), carrying a `conservativeEstimate` flag + method string;
  the D5a declared-vs-aggregated H/C reconciliation guard.
- **Measurement-samples path — offline (Phase E)** —
  `src/lib/isometric/measurement-samples.ts` (HTTP wrappers) +
  `src/lib/isometric/transformers/measurement-sample.ts` (pure payload builders
  for the confirmed H/C → `biochar_production_batch` and soil-temp →
  `biochar_soil` measurement samples; `selectSequestrationBlueprintKey` for D6
  blueprint selection). Two confirms remain gated behind the operator's sandbox
  coverage-check: the datapoint↔component-input binding and the H/C ×100 unit
  transform. The stale `carbon_rich_substance_sequestration` `INPUT_MAPPING`
  entry is left fail-closed until the live wiring replaces it.
- **UI surfaces — durability made visible (Phase F)** — the Phase A–D
  engines surfaced on read-only surfaces, no new domain logic. The reactor-list
  cadence surface that originally displayed `deriveSamplingRequirement` was
  removed by ADR 0016 Phase 1 when sampling moved off reactors; process-grain UI
  returns with ADR 0017. The sample form shows an amber **eligibility advisory**
  when a replicate's H/C_org ≥ 0.5 or O/C_org ≥ 0.2 (non-blocking —
  eligibility is judged on the run mean, D8; `sample-form.tsx`); the removal
  readiness/preflight gains a **durability**
  check row + blocked-reasons (`readiness{,-facts}.ts`), computed ONCE in
  `buildDurabilityGateBlockers` (`src/fn/certification/durability-readiness.ts`,
  extracted to keep `certify-context-core.ts` ≤1000 lines) and carried on
  `RemovalCertifyContext.durabilityGateBlockers` — `submit-removal.ts` now
  READS that field instead of recomputing inline, so the hard block and the
  readiness prediction cannot drift; and the removal carbon breakdown renders a
  **Durability soil temperature** note (value + "Conservative estimate" badge +
  method string + subdivide/floor warnings) from
  `resolveConservativeSoilTemperature` (`removal-breakdown.ts` +
  `removal-carbon-breakdown.tsx`). Browser-verified against the seeded sandbox
  project; no console errors.

## 2026-06-14 (submitted certification artifacts lock upstream source data)

Submitted certification artifacts now freeze the source data they represent,
not just their direct credit-batch/removal membership. This keeps live noma
views from drifting away from the immutable payload snapshot already sent to
Isometric.

- **Data-access guard** — `src/data-access/certification-lineage-guards.ts`
  re-derives the current chain from credit batch → application → delivery →
  biochar product/order → production run/feedstock/sample and checks whether
  the chain reaches a Removal or GHG Statement with a blocking
  `certification_submissions` row.
- **Blocked mutations** — updates and deletes for production runs, lab samples,
  deliveries, biochar products, and feedstocks now fail with a `SafeError` when
  the record participates in a submitted Removal, telemetry data upload, or
  verifier-bound GHG Statement. Creating a new lab sample under a locked
  production run is also blocked.
- **Operator copy** — the surfaced failure explains that the record is part of
  a submitted certification artifact and directs the operator to create a
  correction instead of editing locked source data. Raw SQL/internal errors
  remain hidden.
- **Tests** — `tests/certification-lineage-guards.test.ts` covers production
  run dry-mass edits, production run deletion, sample edits, sample evidence
  deletion, delivery edits through a GHG Statement, biochar product edits, and
  feedstock edits.

## 2026-06-14 (application evidence readiness tightened)

Application evidence readiness now matches the Soil Module application-proof
shape more closely instead of treating "any photo" or "any PDF" as enough.

- **Visual path** — uploaded application photos carry
  `metadata.evidenceRole = stockpile | spreading | incorporation`; readiness
  requires one geotagged uploaded photo for each role.
- **Boundary path** — generic uploaded PDFs no longer satisfy the logbook check.
  A boundary logbook PDF must carry
  `metadata.logbookEvidenceType = weighbridge | inventory | affidavit`, while
  dedicated `weighbridge_ticket` and `affidavit` document types also satisfy
  the semantic evidence requirement.
- **UI/upload metadata** — the application evidence panel exposes separate
  visual upload targets for stockpile, spreading, and incorporation evidence,
  plus a boundary logbook evidence-type selector. Existing untyped application
  photos/PDFs remain visible and can be classified in place without reuploading.
- **Tests** — `tests/application-evidence-readiness.test.ts` covers missing
  roles, the single-photo false pass, all-role success, untyped PDF rejection,
  and typed boundary logbook success.

## 2026-06-13 (application evidence method drives removal readiness)

Applications now declare which Soil Module application-proof path they satisfy:
`visual` (geotagged photo evidence) or `boundary` (GIS boundary reference plus
logbook PDF). Readiness follows the declared method instead of treating all
applications as the same evidence shape.

- **Schema/UI** — `applications.evidence_method` defaults to `visual`;
  `gis_boundary_reference` is required for the boundary path at readiness time.
  The application form switches evidence upload between image files and PDF
  boundary logbooks.
- **Document metadata** — photo uploads without timestamp/GPS EXIF are accepted
  but marked with `metadata.geotagStatus = "missing"` and `missingExif`; this is
  a certification gap, not an upload failure.
- **Readiness** — `buildApplicationEvidenceGaps` flags visual applications that
  lack the required uploaded geotagged photo roles and boundary applications
  that lack either a boundary reference or typed logbook evidence.
- **Migration** — `0048_application-evidence-method` backfills boundary mode for
  applications that already had a GIS boundary reference and removes the old
  blanket `captured_at` photo/video DB check.

## 2026-06-12 (phantom link dialog explained — post-create certifier prompt is intentional)

Closes open question `facilities/phantom-link-dialog`.

- The "Link Isometric project" modal that appeared over `/facilities` right
  after a facility create was not a phantom: `facility-list.tsx` deliberately
  opens `FacilityCertifierDialog` (via `FacilityCertifierLinkLoader`) for
  admins after a successful create, as an optional prompt to link the new
  facility to an Isometric project (commit `aa0e1da`, landed on staging via
  PR #183). The earlier "no mount outside the Settings page" static analysis
  predated that commit's arrival on the analyzed branch.
- The dialog only mounts once its mapping payload loads (~0.5 s after
  create), which is why it raced test assertions and looked nondeterministic.
- E2E suites now dismiss it via a shared
  `dismissCertifierLinkDialog(page)` helper
  (`tests/e2e/fixtures/page-helpers.ts`), used by `facilities.spec.ts`
  (replacing the quarantine workaround) and `full-chain-ui.spec.ts` (whose
  Create Facility step had been failing on staging CI since PR #183 merged).

Open question closed: `facilities/phantom-link-dialog`.

## 2026-06-11 (distance provenance + source-aware priority resolution — map integration Phase 1 §9)

Implements decisions 2–3 of
[`docs/plans/2026-06-10-map-integration.md`](../plans/2026-06-10-map-integration.md).
Distance provenance is now part of the distance value, and the derived
transport legs (the Eq. 3 distance carriers submitted to Isometric) resolve
distance in the documented priority order instead of reading only the
supplier-level / customer-location values.

- **`distanceSource` enum** (`map_estimate` | `manual` | `document`,
  `src/schemas/distance-source.ts` mirroring the `distance_source` pgEnum)
  on every writable persisted distance: `suppliers.distance_to_facility_km`,
  `supplier_locations.distance_from_facility_km`,
  `customer_locations.distance_from_facility_km`,
  `deliveries.distance_km_override`, `transport_legs.distance_km`. Null
  distance ⇒ null source; a distance written without explicit provenance was
  operator-typed ⇒ `manual` (`resolveDistanceSource`, applied at every `fn/`
  write boundary). CALC fill ⇒ `map_estimate`; hand-editing a CALC'd value
  flips it back to `manual` (`DistanceCalcField`); explicit transport legs can
  be marked `document` (bill of lading / weigh ticket) in the leg form.
- **Feedstock side** (`syncFeedstockTransportLeg`): feedstock-form override →
  supplier **default location** `distance_from_facility_km` → supplier-level
  `distance_to_facility_km`. The feedstock form's autofill mirrors the same
  chain (and inherits the suggestion's source) so what the operator sees is
  what persists.
- **Distribution side** (`syncBiocharProductTransportLeg`): per delivery,
  `deliveries.distance_km_override` → destination customer-location distance.
  The aggregated (mass-weighted) leg's source is the **weakest contributing
  source**: null if any contributor is unknown, else `manual` if any manual,
  else `map_estimate` if any estimate, `document` only when all are
  document-backed.
- **Inheritance, not fabrication** — a derived leg copies the winning level's
  source verbatim (`deriveTransportLeg`); a pre-provenance stored distance
  yields a null source rather than a fabricated `manual`.
- **Tests** — `src/lib/calculations/transport-leg.test.ts` (23 cases): source
  inheritance for stored/override winners, null-distance ⇒ null-source,
  rejected non-positive overrides not leaking their source, and the
  weakest-source aggregation rules.

Open question closed: `parties/distance-derivation`.

## 2026-06-10 (fake registry adapter + boundary tests — reliability track Phase 3)

Implements Phase 3 of
[`docs/plans/2026-06-10-certification-reliability-track.md`](../plans/2026-06-10-certification-reliability-track.md):
the registry seam gains its second adapter —
`tests/fixtures/fake-registry.ts`, an in-memory registry-shaped counterparty
installed by faking the CLIENT (`vi.mock("@/lib/isometric/client")`), so the
function-level wrappers (`createDatapoint`, `createGhgEntry`,
`createGhgStatement`, `findGhgEntryBySupplierRef`,
`findDatapointBySupplierRef`, `findDraftGhgStatementsByPeriod`) run for real
— supplier-reference query semantics and `{first, after}` pagination are
exercised, not simulated. No production code changed.

- **The fake** — stores ghg entries / datapoints / GHG statements with
  server-assigned IDs; honors `?supplier_reference_id=` filtering on
  `/ghg_entries` + `/datapoints` and paged listing of `/ghg_statements`
  (+ `GET /ghg_statements/:id`); enforces unique `supplier_reference_id`
  on POST (422 with a body) while allowing multiple DRAFT statements per
  period (the real ambiguity); fails loud on unfaked routes. Per-request
  failure injection: `failNext(route, mode)` with `"reject-before-commit"`
  (4xx `IsometricApiError` with a body, nothing created) and
  `"drop-after-commit"` (created server-side, client sees a network error
  — the mode no per-function mock can express). Request log for POST-count
  assertions.
- **Boundary tests** — `tests/registry-boundary-removal.test.ts` (5 cases)
  and `tests/registry-boundary-ghg-statement.test.ts` (2 cases) run the
  REAL `claimSubmissionDraft` DB-backed plus the real ledger/sync-event
  writes and `performRegistryCreate`, with only the client faked. Mocked
  besides the client: the removal context loader and sources resolver
  (removal file), and the auth session (GHG file — the action runs through
  `withAction`). Covered end-to-end: datapoint orphan → resume reconciles
  by supplier ref and POSTs only the remaining datapoints (registry holds
  exactly one of each); removal orphan → same property, plus same-attempt
  recovery when the post-failure lookup works; 4xx reject → row rejected
  and the failed sync event carries the registry response body +
  `mapping_revision` (the Phase 2 behavior change asserted at the
  boundary); hash-supersede v1→v2 → registry holds two removals with
  version-distinct supplier refs; GHG drop-after-commit → resume
  reconciles the single draft by `(project, end_on)` and finalizes without
  re-POSTing; a second injected draft → rejected with the ambiguity
  message and (Phase 2 parity, pinned by assertion) no failed sync event.
- **Coverage gap from Phase 2 closed** — the two resume-path fixes that
  were folded into Phase 2 without dedicated tests are now pinned:
  `tests/certification-submissions.test.ts` gains a resume-path
  concurrency case (row flips to `submitted` while the resume claimant is
  parked on the mapping lock → `existing`, NOT a CAS revert back to
  draft), and the removal boundary suite gains a
  `readRemovalFixedInputs` fail-loud case (malformed `kind:"fixed"`
  snapshot entry → resume refused with a `SafeError`, zero POSTs).
- **Live anchor unchanged** — the sandbox integration test
  (`tests/isometric-sandbox.integration.test.ts`) and the daily
  `isometric-health.yml` check remain the live-truth anchor; the fake does
  not replace them.

## 2026-06-10 (registry create-or-reconcile module — reliability track Phase 2)

Implements Phase 2 of
[`docs/plans/2026-06-10-certification-reliability-track.md`](../plans/2026-06-10-certification-reliability-track.md):
one implementation of *POST → on failure, reconcile by lookup → record sync
event → claim the orphan or mark rejected* in
`src/fn/certification/registry-create.ts` (`performRegistryCreate`), shared
by datapoint creates, removal creates, and GHG Statement creates.
`submit-removal.ts`'s local `createOrReconcile` is deleted;
`createGhgStatementRemote`'s hand-rolled catch arm is replaced and its two
`finalizeGhgStatement` continuations collapse into one call site (the module
returns `source: "create" | "reconciliation"`).

- **Behavior change (the point of the phase)** — removal/datapoint failure
  sync events now preserve the registry's response body
  (`IsometricApiError.body`, the actionable 4xx detail) alongside
  `mapping_revision`; previously only GHG kept the body and only removal
  kept the revision. Unified failed-event `responsePayload` shape:
  `{ mapping_revision, body? }`.
- **GHG create gains reconcile-first on resume** — a resumed GHG Statement
  draft now looks up `(project, end_on)` BEFORE POSTing (the removal path's
  double-submit guard); previously it re-POSTed and relied on the catch-arm
  reconcile.
- **GHG create audit events** unified onto the removal shape: best-effort
  writes (a failed audit insert no longer unwinds a successful create),
  `requestPayload` + `mapping_revision` on success events, `:reconciled`
  operation suffix for reconciled claims (recorded before
  `markSubmissionSubmitted`, no longer after).
- **Out of scope by decision** — sources mirroring (signed-URL refresh
  shape) and telemetry (ADR 0006 journaled-step recovery) stay on their own
  shapes.
- **Resume-path correctness (found during migration)** — `submitRemoval` now
  reads the `fixed` (pre-bound) datapoint bindings back out of the resumed
  row's `payloadSnapshot.semantic.inputs` instead of mixing live-template
  bindings with the stored transport snapshot; and the claim module's
  `resumeDraft` re-decides under the mapping lock (mirroring `createDraft`)
  so the CAS reset can no longer revert a row a concurrent claimant just
  flipped to `submitted`.
- **Tests** — new `tests/registry-create.test.ts` (9 cases: fresh create,
  resumed reconcile-first hit/miss, POST-fails-orphan-found,
  POST-fails-lookup-misses (body preserved, row rejected), ambiguous
  multiple → reject + message, best-effort audit, `supplierRefLookup`
  adapter). Existing pipeline tests unchanged and green.

## 2026-06-10 (submission-ledger claim module — reliability track Phase 1)

Implements Phase 1 of
[`docs/plans/2026-06-10-certification-reliability-track.md`](../plans/2026-06-10-certification-reliability-track.md):
the claim choreography (*read latest → tentative decide → mapping lock →
re-resolve → authoritative re-decide → insert/reset draft*) now lives in one
module, `src/data-access/certification-submissions.ts`, entered only through
`claimSubmissionDraft`. The Removal path's in-lock defensiveness is now the
only path; GHG Statements inherit it.

- **Behavior change (the point of the phase)** — a concurrent duplicate GHG
  Statement create now resolves to `existing` / `blocked: "in-flight"`
  instead of a raw `cert_submissions_entity_version_unique` constraint error.
- **Seam decision** — internal data-access seam, DB-backed tests against
  real Postgres; no port, no in-memory ledger fake (ADR 0008).
- **Telemetry deferred** — `submit-telemetry.ts` keeps the relocated
  primitives (`getLatestSubmission`, `insertDraftSubmissionWithMappingLock`,
  `resetSubmissionToDraftWithMappingLock`) under an explicit boundary: no
  barrel re-export, `TODO(telemetry-migration)` comments, single permitted
  importer (grep-verified).
- **Tests** — new `tests/certification-submissions.test.ts` (16 DB-backed
  cases incl. real-interleaving concurrency: duplicate-claim race, in-lock
  flip to `existing`, resume CAS won/lost, mid-claim repoint). Pipeline
  tests stub `claimSubmissionDraft` via the shared
  `tests/fixtures/fake-claim.ts` (real pure core over an in-memory store);
  the hand-rolled per-primitive ledger fakes — including the
  `undefined as never` tx handle — are retired.

## 2026-06-10 (GHG entry API migration: removal→ghg_entry wire rename)

Migrates the Certify wire layer from the deprecated removal-named endpoints to
the new `ghg_entry` route family per Isometric's
[2026-06-04 changelog](https://docs.isometric.com/api-reference/certify/api-changelog)
("GHG entry API rename released across Certify REST endpoints"). The old
endpoints stay functional until **September 2026**, then are removed. Verified
against the live Certify spec (62 paths / 187 schemas) on 2026-06-10.

- **Regen pipeline fixed first.** `regenerate-certify-types` defaulted to
  `https://api.isometric.com/openapi.json`, which now serves Isometric's
  internal FastAPI spec (no Certify routes), so `certify.d.ts` was stale
  (pre-rename). Repointed to the docs-hosted Certify spec
  `https://docs.isometric.com/api-reference/certify/mrv.openapi.json`
  (`package.json`, `.github/workflows/isometric-health.yml`,
  `docs/isometric/update-playbook.md`) and regenerated. New + deprecated
  schemas coexist during the transition.
- **Wire renames** (`src/lib/isometric/`): `POST/GET /removals` →
  `/ghg_entries`; `/projects/{id}/removal_templates` → `/ghg_entry_templates`;
  `GET /components?removal_id=` → `?ghg_entry_id=`; create-payload fields
  `removal_template_id`/`removal_template_components`/`removal_template_component_id`
  → `ghg_entry_template_*`; `GhgStatement.removal_ids` (read) →
  `ghg_entry_ids` (required; old field now `deprecated: true`). Symbols/files
  renamed: `createRemoval`→`createGhgEntry`,
  `findRemovalBySupplierRef`→`findGhgEntryBySupplierRef`,
  `listRemovalTemplates`→`listGhgEntryTemplates`,
  `buildCreateRemovalRequest`→`buildCreateGhgEntryRequest`,
  `transformers/removal.ts`→`transformers/ghg-entry.ts`,
  `utils/removal-membership.ts`→`utils/ghg-entry-membership.ts`, and the
  `Removal*`/`RemovalTemplate*` type aliases → `GhgEntry*`/`GhgEntryTemplate*`.
- **Wire-only rename decision.** App-layer + DB naming (`certifier_removals`,
  `credit_batches.removal_id`, `defaultRemovalTemplateId`, ledger
  `'removal'` keys, the `decideRemovalMembership` / `reconcileRemoval` domain
  fns) stays "Removal" — our templates are `credit_type: REMOVAL`, so it
  remains the correct domain word. No DB/data migration; all `rmv_`/`rvt_`/
  `ggs_` ids unchanged, and old Removals resolve through `/ghg_entries` by the
  same `supplier_reference_id`. `listGhgEntryTemplates` now warns on any
  non-REMOVAL `credit_type`. Rejected: full domain rename (no behavioural gain
  on a biochar-only product, ~50 files of churn). Revisit only if we ever
  submit `REDUCTION`-type entries.
- **Tests.** New fetch-mocked contract test
  (`src/lib/isometric/submissions.test.ts`) pins
  `findGhgEntryBySupplierRef` to `GET /ghg_entries?supplier_reference_id=`;
  sandbox read suite migrated to `ghg_entry_templates` (asserts
  `credit_type`) + a `GET /ghg_entries` `rmv_`-shape test + an env-gated
  pre-rename supplier-ref lookup. Free fields now exposed on the migrated
  surface (`credit_type`, `risk_of_reversal_percentage`, `credit_allocation`,
  statement reporting-period readback, source `description`) are tracked as
  follow-ups in `docs/open-questions.md`; not adopted here.

## 2026-06-08 (Schema slim-down: drop unused protocol-stub tables)

Schema-only cleanup; no behaviour change. Dropped tables/columns that were
defined ahead of implementation but never queried or seeded
(migration `drizzle/0037_sour_lethal_legion.sql`). Isometric-relevant drops:
`certifier_sources` (+ `certification_submissions.source_id`),
`reversal_risk_assessments` (Appendix I), `ghg_materiality_assessments`,
`feedstock_sc_assessments`, `custody_handoffs`, `emission_factors`,
`loss_records`, and `production_runs.emission_factors_used`. Full re-add
backlog with protocol citations: `docs/open-questions.md` → "Schema → Dropped
protocol-stub tables". Submissions still record their Source via the
derived-at-submit-time path; nothing read `certifier_sources`.

## 2026-06-08 (Certify readiness hardening)

The New-Removal wizard now treats facility setup as incomplete until selectable
batch data has loaded, preventing a transient ready-looking state when the
facility has no registry mapping/template/protocol config. Facility-level
removal and selectable-batch loaders now bound fan-out at 8 concurrent context
builds to avoid unbounded DB/query bursts for facilities with many removals or
ungrouped batches.

## 2026-06-04 (GHG statement UX: non-overlapping periods, derived start, removal cross-link, amend-not-undo)

Operator-feedback pass on the GHG-statement flow. Behaviour-affecting (a new
create-time guard rejects overlapping periods); no schema/migration change.

- **Non-overlapping reporting periods.** `createGhgStatementDraft`
  (`src/fn/certification/ghg-statements.ts`) now reads the facility's existing
  statements and rejects an `end_on` on or before the latest *other* statement's
  end — periods are consecutive (Isometric derives each start as the prior end +
  1 day), so this stops a period being carved inside an existing one. The
  own-end is excluded so the idempotent re-create (double-click / two tabs) still
  resolves through the submission-claim machinery. Mirrored client-side in the
  create drawer. App-layer guard only (no DB exclusion constraint) — a truly
  concurrent pair of overlapping creates is an accepted TOCTOU gap, tracked under
  `isometric/ghg-period-overlap-db-constraint`.
- **Derived period start shown at create.** The create API still accepts only
  `end_on`; the drawer now displays the derived `[start → end]` window (start =
  prior statement's end + 1 via `addDaysIso`, "Set by Isometric" for the first
  statement) so the operator sees a full period, not a floating end date.
- **Removal cross-link accordion.** New `removal-batches-accordion.tsx` renders a
  statement's removals as an accordion — each expands to its grouped credit
  batches (code, window, stored CO₂e, status) plus a new-tab link to the removal
  review page. Used in both the create preview (step 2) and the detail view.
  Backed by a batched `getCreditBatchSummariesByRemovalIds`
  (`data-access/certifier-removals.ts`); `OpenRemovalView` / `LinkedRemoval`
  gained a `creditBatches` field.
- **Detail view is now a Modal, not a side-sheet.** `GhgStatementDetailSheet` is
  read-only (no form), so it moved from `SlideOverPanel` to the shared `Modal`;
  side-sheets stay reserved for forms (create flow, entity edit). Adds copy
  making the lifecycle explicit: statements can't be withdrawn — to change what's
  included, open a removal, edit it, and resubmit (membership stays
  server-derived by date range, ADR 0004; the pending-changes resubmit path is
  unchanged).
- **Tests** — `tests/isometric-ghg-statement-submit.test.ts` stubs the new
  `listGhgStatementsForFacility` read in its create setup; all GHG-statement
  suites green.

## 2026-06-03 (tighten document-redirect allowlist + reconcile the two SSRF guards)

Closes the broad-suffix breadth in the `/api/documents/[id]` legacy-`fileUrl`
redirect guard. Behaviour-affecting (some previously-allowed hosts now 502); no
schema/migration change.

- **Narrowed the redirect families.** `src/lib/documents/redirect-allowlist.ts`
  previously allowed whole provider families (`.amazonaws.com`, `.googleapis.com`,
  `.digitaloceanspaces.com`) — any tenant bucket / unrelated provider host. It now
  mirrors the upload guard's narrow set: `.s3.amazonaws.com` (+ regional/dualstack
  S3 patterns), `.storage.googleapis.com`, `.digitaloceanspaces.com`,
  `.isometric.com`, plus same-origin + `STORAGE_ENDPOINT`. `maps.googleapis.com`,
  `sts.amazonaws.com`, etc. now fail closed (502). Calibrated low risk (browser
  302, `fileUrl` writable only by an authed user) — consistency hardening.

- **New env override** `ISOMETRIC_STORAGE_REDIRECT_HOSTS` (`config/env.ts`,
  `.env.example`) — same shape as `ISOMETRIC_UPLOAD_HOST_ALLOWLIST`; a non-empty
  value REPLACES the defaults so a deployment can pin redirects to the exact
  Isometric report bucket without a code change.

- **Reconciled the two SSRF guards** (review #7). The matching algorithm
  (leading-dot suffix match, regional/dualstack S3 patterns, env override
  parsing) is extracted to `src/lib/net/host-allowlist.ts` and consumed by both
  `signed-upload.ts` (upload PUT) and `redirect-allowlist.ts` (browser redirect);
  the two keep their own host *sets* and override env vars but can no longer
  drift. Covered by `tests/redirect-allowlist.test.ts` (+ a route-level 502 case
  in `tests/documents-route.test.ts`); `tests/signed-upload.test.ts` unchanged and
  green after the refactor.

- **Note (do not conflate):** this does NOT touch the data-access IDOR — any
  authed user can still fetch any document by UUID (`data-access/documents.ts`),
  the accepted single-tenant debt under integration-plan gate #3 /
  `security/facility-membership-authz`.

## 2026-06-02 (structured logger + isometric API boundary logging)

Closes the `code/logger-introduction` open question — the last item from the
robustness pass. No behaviour change to user-facing flows.

- **New `src/lib/log/`** — a minimal in-house structured logger (newline-delimited
  JSON to stdout/stderr, level filtering via `LOG_LEVEL`, `child()` bindings, and
  key-based redaction of PII/secrets per the CLAUDE.md no-PII rule). Built
  in-house rather than pino **deliberately**: Next.js 16 Turbopack has an open,
  unresolved bug (vercel/next.js#93849) where a `serverExternalPackages` package's
  hashed alias isn't resolvable at Vercel's serverless runtime — independent of
  transport config and not catchable by local testing. The logger covers our
  needs (levels, child bindings, redact) with no external-package/bundler risk;
  revisit pino if that bug is fixed. Covered by `tests/log.test.ts`.

- **Isometric API boundary instrumented** (`src/lib/isometric/client.ts`) — the
  previously-silent `isometricRequest` now logs `{method, path, status, attempt,
  duration_ms}` on success (debug), retry (warn), and terminal network/http
  failure (error). Never logs headers, body, or the `X-Client-Secret` /
  `Authorization` credentials.

- **Submit correlation** — `submitRemoval`, `createGhgStatementDraft`, and
  `submitGhgStatementToVerifier` mint a per-attempt `submissionAttemptId` and emit
  a start breadcrumb; the three cert-fn `console.warn`s are replaced with the
  structured logger. `LOG_LEVEL` widened to the full level set. **Follow-ups
  (tracked in open-questions):** the other ~110 repo-wide `console.*` are a
  separate sweep; threading `submissionAttemptId` into the request boundary for
  full per-attempt correlation is not yet wired.

## 2026-06-02 (audit remediation — focus-restore a11y, constraint-guard fix, parse cleanup)

Follow-up to a deeper review of the telemetry/submission branch. Behaviour fixes
plus small consistency wins; no schema or API-surface change.

- **`useDialog` focus-restore now actually fires (a11y merge-bar fix).** The
  earlier cut (recorded in the section below, and previously marked resolved in
  `docs/open-questions.md`) was dead on the dominant close path: `Modal` returns
  null on close, unmounting the `<dialog>`, so the effect's top-level
  `if (!dialog) return` short-circuited before the focus-restore branch —
  keyboard/screen-reader users were stranded at document start. Fixed in
  `src/hooks/use-dialog.ts` by scoping the early return to the open branch and
  restoring focus via the surviving `triggerRef` regardless of whether the dialog
  node still exists. Regression-covered by `tests/e2e/dialog-focus-restore.spec.ts`.

- **`project-emissions` unique-violation guard corrected.**
  `data-access/project-emissions.ts` read `.constraint_name` (a postgres-js field)
  while this project uses node-postgres (`.constraint`). The field was always
  `undefined`, so the guard relabeled *any* 23505 as the facility/period/category
  conflict, masking unrelated unique violations. Now matches
  `.constraint === certifier_project_emissions_facility_period_category_unique`
  exactly, mirroring the sibling guard in `data-access/certification.ts`.

- **`documents.ts` validation simplified.** The three simple actions
  (`confirmUpload`, `setDocumentVisibility`, `deleteDocument`) now use
  `schema.parse(input)` and let `withAction` format the `ZodError` (accepting its
  `"Validation error: …"` prefix), replacing the hand-rolled `issues[0].message`
  throw and its inconsistency. `requestUpload` keeps `safeParse` as the one
  exception (its joined, prefix-free copy is intentional). `ISOMETRIC_PROVIDER` now
  imports from the neutral `@/lib/isometric/utils/constants` rather than the
  certification feature barrel.

## 2026-06-02 (consistency cleanup — `documents.ts` migration + shared helpers)

Internal-only refactor following code review of the last six commits. No
behaviour change to user-facing flows; touches consistency, reuse, and
native-API adoption.

- **`src/fn/documents.ts` migrated to `withAction`.** Previously hand-rolled
  `getUser()` + `failure()`/`unauthorized()` wrappers across `requestUpload`,
  `confirmUpload`, `setDocumentVisibility`, `deleteDocument`, and
  `getDocumentsForEntity`; now matches every other `fn/` entry point. User-
  facing validation copy is preserved by parsing with `safeParse` and throwing
  `SafeError(parsed.error.issues[…].message)` rather than relying on the
  wrapper's default `"Validation error: …"` prefix. Hard-coded `"isometric"`
  provider strings replaced with `ISOMETRIC_PROVIDER` from
  `@/fn/certification/shared`.

- **Sync-event best-effort helper consolidated.** Three near-identical
  helpers (`appendSyncEventBestEffort` in `submit-removal.ts` and
  `submit-telemetry.ts`; `safeAppendSyncEvent` in `sources.ts`) collapsed to
  one in `@/fn/certification/shared`. Signature:
  `appendSyncEventBestEffort(userId, AppendSyncEventInput, logContext?)`.
  Call sites that previously passed `submissionId` as a positional argument
  now pass it via `{ submissionId: row.id }`. Behaviour identical: failed
  audit-trail inserts still console.warn and do not unwind the submission.

- **Native `URL.canParse` replaces five `try { new URL(x) } catch {}`
  parseability checks** (Node 24 LTS). Sites: `redirect-allowlist.hostOf`,
  `signed-upload.assertUploadHostAllowed`, the `/api/documents/[id]` legacy
  `fileUrl` branch, `parseSignedUrlExpiry` in `submit-telemetry.ts`, and
  `deriveFileName` in `data-access/certification.ts`. Route-relative `new
  URL("/path", request.url)` uses are deliberately untouched (they cannot
  fail-fast via `URL.canParse`).

- **Native one-liners replace `unique`/`minDate`/`maxDate` helpers** in
  `submit-telemetry.ts`. `unique<T>(xs)` → `[...new Set(xs)]`;
  `min/maxDate(dates)` →
  `new Date(Math.min/max(...dates.map((d) => d.getTime())))`. Removes the
  "two ways to dedupe in the same file" smell — the file already used the
  native form in `sourceProductionRunIds`.

- **Rate-limiter comment corrected.** `src/lib/rate-limit/in-memory.ts`
  previously said keys "age out when anything touches it" — only the touched
  key is pruned. Comment now describes the actual behaviour (per-key prune,
  no cross-key sweep) and the accepted bound (active operators × 3 cert
  submit actions), with a note that a size-triggered sweep is the right
  follow-up if the keyspace ever grows.

- **Sources mirror orphan-check comment reworded.** The branch in
  `mirrorDocumentToSource` that records an `source:create:orphaned` event is
  unreachable while `acquireMirrorLock` is held across the insert. Comment
  now frames it as defense-in-depth against a future entry point that
  mints a Source without first taking the lock, instead of describing it as
  a normal race outcome.

- **`withAction` dev-only `console.error` removed.** Logged
  `error.name, error.constructor.name` — identical for plain `Error`
  instances; logging `error.message` would carry PII per CLAUDE.md. Callers
  that need diagnostics should throw `SafeError` (message is then exposed
  to the client) or rely on the framework's server error reporter. Inline
  comment in `with-action.ts` records the rationale.

Verification: `pnpm tsc --noEmit` clean; `pnpm vitest run` 312 pass / 5
skipped (same baseline); `pnpm lint` no new warnings.

## 2026-06-02 (robustness pass — redirect allowlist + submit rate limit)

Resolves three deferred items from `docs/open-questions.md`. No schema/migration
changes; behaviour-affecting where noted.

- **Document-redirect open-redirect closed** (`certification/report-url-allowlist`).
  The `/api/documents/[id]` route's `fileUrl` 302 branch now host-gates the
  target via `src/lib/documents/redirect-allowlist.ts`: allowed = our own origin
  (`NEXT_PUBLIC_APP_URL`) + the configured `STORAGE_ENDPOINT` host + the registry
  / cloud-storage families (`.isometric.com`, `.amazonaws.com`, `.googleapis.com`,
  `.digitaloceanspaces.com`). Embedded credentials (`user:pass@host`) are refused
  outright. Off-allowlist hosts fail closed (502) and are logged (id + host only,
  no PII). **Behaviour change:** operator-pasted GHG-statement report URLs on
  arbitrary hosts now fail closed — Isometric-synced report URLs and same-origin
  links continue to resolve. Decision: "allowlist + cloud hosts" (operator
  2026-06-02) over a strict same-origin-only lock that would have broken the
  Isometric-synced report path. Sibling guard to the upload-host allowlist in
  `@/lib/isometric/utils/signed-upload`.

- **Submit-action rate limiting added** (`security/rate-limit-submissions`).
  `withAction` gained an opt-in `rateLimit` option; the three registry submit
  actions (`submitRemovalAction` + `submitCreditBatchRemoval`,
  `submitGhgStatementToVerifier`, `submitTelemetryAction`) pass it — 5/min/user
  per pipeline, keyed `cert:submit-*:<userId>`. Backed by a process-local
  sliding-window limiter (`src/lib/rate-limit/in-memory.ts`). This is
  defense-in-depth only — ADR 0006 idempotency already makes a fast double-submit
  a no-op; the limiter blunts scripted/runaway bursts. **Known limitation:** the
  store is per-instance, so on Fluid Compute the effective ceiling is
  `5 × instanceCount`. Decision: in-memory over DB-backed (operator 2026-06-02),
  proportionate to a non-correctness guard; swap to a DB/Redis bucket if an exact
  cross-instance limit is ever needed.

- **Form a11y + cert error boundary** (landed earlier this session, commit
  `33920f5`): `FormField`/`FormError` now wire `aria-describedby`; `Modal` warns
  in dev when it has no accessible name; `(app)/certification/error.tsx` segment
  error boundary added. Closes `certification/error-boundary` and the
  `FormField`/`FormError` half of `forms/a11y-shared-layer` (the `useDialog`
  focus-restore half remains open).

## 2026-05-29 (Phase 5 Slice A shipped — telemetry pipeline end-to-end)

Builds on the same-day scoping entry below. Implements the design ADR 0006
locked, with no behaviour change to existing flows.

- **Migration 0029 `heavy_umar`** — additive. New `certifier_sensors`
  table (`reactor_id` FK, `measurement_property` text, `external_sensor_id`,
  `sensor_reference`, `units`) with `unique (reactor_id, measurement_property)`
  and `unique (provider, sensor_reference)`. `measurement_property` is the
  pipe-encoded `MeasurementProperty` (`<kind>` or `<kind>|<qualifier>`) so
  the unique constraint correctly dedups the null-qualifier case Postgres
  unique permits multiple of. New `certifier_projects.external_facility_id`
  text column — operator pastes the `fcl_…` from the Certify UI before
  submitting telemetry (Isometric exposes no `POST /facilities`).
  - **Note on numbering:** the integration-plan stub said "0028 pending";
    by the time this shipped, an unrelated FK-on-delete migration had
    already taken 0028 (`demonic_harpoon`), so the Slice A migration is
    0029. Ledger updated.
- **`src/lib/isometric/transformers/data-upload.ts`** — pure aggregator.
  Buckets `production_run_readings` rows into clock-aligned 60-second
  windows per `(reactor × channel)`; computes min, max, mean, median,
  count, population stddev, first_ts, last_ts per bucket; drops buckets
  with `count = 0`; sorts deterministically by `(start, sensorRef)` so
  the downstream Parquet bytes are stable. Slice A channels: temperature
  + pressure (matches the smoke probe).
- **`src/lib/isometric/parquet/writer.ts`** — thin `hyparquet-writer`
  wrapper that builds an explicit `SchemaElement[]` with `INT64 +
  logical_type TIMESTAMP NANOS` on the four timestamp columns. Column
  order + tags match `scripts/probe-parquet-smoke.mts` exactly (the
  contract validated against the sandbox on 2026-05-29). `bigint` values
  are constructed via `BigInt(…)` instead of the `1_000_000n` literal so
  the project's ES2017 `target` does not reject the file.
- **`src/lib/isometric/sensors.ts`** — typed `POST /sensors`,
  `GET /sensors/{id}`, `findSensorByReference` (claims an orphan remote
  sensor on a sandbox-reset path). Includes a stable
  `buildSensorReference` (`nm-snr-<reactor-short-hash>-<property-slug>`)
  so reconciliation is deterministic.
- **`src/data-access/certifier-sensors.ts`** — `ensureSensorForReactor`
  reconciles by sensor reference before POSTing, so a partial run that
  lost the local row does not mint a duplicate Isometric sensor; uses
  `onConflictDoUpdate` against the unique constraint to absorb a
  concurrent race winner's external ids.
- **`src/lib/isometric/utils/submission-claim.ts`** — extended with the
  `dataUploadResume` branch per ADR 0006 §4. New claim kinds
  (`resume-poll-existing` / `resume-re-put`) and a
  `dataupload-orphan-restart` `create-new-version` reason. Picks the
  right step-specific recovery action from the journaled
  `payloadSnapshot.journaled` state on a stale lock; falls through to
  the existing `resume` kind when nothing has been journaled. Test
  matrix extended from 18 → 24 cases covering every new branch + a
  sub-threshold URL-freshness case (race-safe expiry handling).
- **`src/fn/certification/submit-telemetry.ts`** —
  `withAction`-wrapped server action. Loads the removal context, ensures
  a sensor per `(reactor × channel)`, pulls readings clipped to the
  derived clock window, aggregates, builds Parquet, then runs the three
  POSTs (`/file-uploads` → `PUT signed_upload_url` →
  `/data-upload-submissions`) inline with `journalStep` after each step
  so the journaled state is current for any resume. Hash covers
  source-data inputs (sensorRefs, sourceReadingIds, window), not Parquet
  bytes — ADR 0006 §2 rationale. Single ledger row per
  `(removal, submissionType='dataUpload')`. Surfaces a `SafeError` when
  `certifier_projects.external_facility_id` is empty.
- **`src/components/certification/telemetry-panel.tsx`** + the
  `useTelemetrySubmissionState` / `useSubmitTelemetry` hooks. Mounted on
  `/certification/removals/[removalId]` below the existing SourcesPanel.
  Submit button + status badge (maps remote `pending|completed|failed`
  to verified/running/rejected) + an Isometric-error display.
- **Integration test** — `tests/isometric-sandbox.integration.test.ts`
  gains a write-path case that exercises the byte path through the real
  `lib/isometric` + `transformers/data-upload` + `parquet/writer`
  modules end-to-end against sandbox. Gated by `ISOMETRIC_DEMO_FACILITY_ID`
  in addition to the existing `RUN_ISOMETRIC_SANDBOX_TESTS=1` gate, so
  CI without facility credentials skips cleanly.
- **`scripts/probe-*`** kept as reference (the parquet-smoke pattern is
  the implementation blueprint); tsconfig now excludes
  `scripts/probe-*` so the throwaway `.mts` extension import does not
  break `tsc`.
- **Typecheck + tests green** — 300 unit tests passing (24 from the
  extended submission-claim matrix); typecheck clean; lint clean of new
  errors (36 pre-existing warnings unchanged).

## 2026-05-29 (Phase 5 Slice A scoped — biochar reactor time-series)

Design-only update. No code changes; no schema migration; the noma
codebase is unchanged outside throwaway sandbox probes under
`scripts/probe-*`. The 2026-05-28 grilling session resolved every
design fork for the Parquet-bulk upload slice of Phase 5; this entry
records the conclusions so the integration plan reads as a buildable
spec.

- **Phase 5 row rewritten** (`integration-plan.md` §Phase status) — was
  "Not started"; now **Slice A scoped**, Slices B (`POST
  /biochar_applications`) and C (`MonitoringSubmission`) deferred to
  `open-questions.md`.
- **[ADR 0006](../adr/0006-data-upload-submission-idempotency.md) —
  DataUploadSubmission idempotency uses journaled-step IDs.** The
  `CreateDataUploadSubmissionRequest` schema has no
  `supplier_reference_id` field, breaking the reconciliation pattern
  every other outbound POST in the integration uses. The decision:
  carry `{ fileUploadId, uploadUrl, uploadUrlExpiresAt,
  dataUploadSubmissionId, parquetBytesSha256 }` in
  `certificationSubmissions.payloadSnapshot` step-by-step within a
  single short-lived server action, and reconcile by stored Isometric
  IDs on a stale lock. Orphan FileUpload records (POST sent, response
  lost) are tolerated — verifier-invisible.
- **Migration 0028 stubbed** — additive: `certifier_sensors` table +
  `certifier_projects.external_facility_id` column. No destructive
  ops, no constraint drops.
- **Per-facility bootstrap step added** — operator must create the
  biochar facility in Certify UI (no `POST /facilities` endpoint
  exposed) and paste the resulting `fac_…` ID into noma. Same pattern
  as `externalProjectId` today. Until pasted, the "Submit Telemetry"
  button stays disabled on the Removal page.
- **Parquet writer choice: `hyparquet-writer`** (most recently
  maintained pure-JS option, last published 2026-05-25), with the
  `INT64 + TIMESTAMP_NANOS` logical-type override to match Isometric's
  `timestamp[ns]` spec. De-risk step: write 10 rows + post to sandbox
  end-to-end before any schema migration; fall back to `parquet-wasm`
  only if nanos override fails to clear sandbox ingest.
- **Aggregation window: 60-second clock-aligned** (corrected from the
  1-hour decision made earlier the same day). The sandbox smoke
  surfaced an undocumented hard cap on `aggregation_period_end -
  aggregation_period_start`:
  `AggregationPeriodDurationInvalidError: Aggregation period of 3600.0
  seconds exceeds maximum allowed of 60 seconds`. Buckets are clock-
  aligned per facility; only buckets with `count > 0` are emitted.
  Source-of-truth filter is pure clock window on
  `production_run_readings.timestamp` against the Removal's reporting
  period (no whole-run inclusion, no lineage scoping — see ADR 0006
  §Decision for rationale). File-size impact: 30-day window × 2
  sensors at 1-min cadence ≈ 86 k rows max, ~1–2 MB Parquet
  (compressed), well under the 100 MB per-upload cap.
- **Sandbox probes lodged in `scripts/probe-*.{ts,mts}`** (`THROWAWAY`
  headers) — confirmed: biochar submission_type accepted; sensor
  measurement_property enums accepted with lowercase only;
  `application/vnd.apache.parquet` file uploads work; signed upload
  URL TTL is **5 minutes** (`X-Goog-Expires=300`), not the 24h I
  assumed in early scoping — pipeline must run in one server action.
  Full end-to-end smoke (`probe-parquet-smoke.mts`) creates 2 sensors,
  generates a 10-row Parquet via hyparquet-writer, PUTs to signed URL,
  POSTs the DataUploadSubmission, polls to terminal — succeeded
  through step 6 and surfaced the 60-second cap on step 7's failure
  response, validating both the Parquet bytes layer and the
  journaled-step idempotency model end-to-end.
- **Two doc bugs filed under `open-questions.md`** for Isometric MCP
  `submit_feedback`: (1) UPPERCASE enum values in the docs prose vs.
  lowercase in the live API; (2) DAC-only intro paragraph on a page
  that lists biochar measurement properties.

## 2026-05-26 (Phase 3.5 hardening — source-mutation correctness)

Follow-up to the Phase 3.5 ship, addressing five findings from a
post-ship audit (two P1 concurrency / authorization, one P1 race, two
P2 reconciliation + tests). No data migration; behaviour change is
strictly stricter (mutations that previously succeeded under the gaps
below now refuse).

- **Transactions actually scope the work** — `mirrorDocumentToSource`,
  `unlinkDocumentSource`, and (new) `setDocumentSourceVisibility` open
  a transaction and thread `tx` through every data-access read/write
  inside. The six functions in
  `src/data-access/certifier-document-uploads.ts` now accept an
  optional trailing `txOrDb: DbClient` (default `db`), matching the
  existing pattern in `applications.ts` / `credit-batches.ts` /
  `production-runs.ts`. The advisory locks now bracket real work
  instead of a no-op closure.
- **Source mutations scoped to the removal's lineage** —
  `unlinkDocumentSourceSchema` and `setDocumentSourceVisibilitySchema`
  now require `removalId` in addition to `documentId`. The new
  `assertDocumentIsCandidateForRemoval(userId, removalId, documentId)`
  helper walks the same lineage `loadCandidateDocumentsForRemoval`
  shows the panel, and refuses if the document isn't in the candidate
  set. Closes the IDOR where any authenticated user who learned a
  document UUID could unlink or flip visibility on a Source mirrored
  under another removal / facility.
  `src/hooks/use-certification-sources.ts` stamps `removalId` onto the
  hook input so UI callers don't change.
- **Submit / unlink / mirror interlock on one lock key** —
  `src/lib/isometric/utils/source-lock.ts` (new) defines
  `mirrorLockKey(documentId) = "mirror:isometric:{documentId}"` plus
  `acquireMirrorLock(tx, id)` and `acquireMirrorLocksSorted(tx, ids)`.
  mirror, unlink, and submit (per-document, sorted to prevent ABBA)
  all serialize on the same key. `submitRemoval`'s create-new-version
  branch now uses the new composable
  `insertDraftSubmissionWithMappingLockAndLocks(userId, guard, prepare)`
  data-access helper: it opens the tx, takes the mapping lock FIRST
  (consistent lock order: `mapping → mirror[sorted]`), invokes a
  caller-supplied `prepare(tx)` that acquires the per-document locks
  and re-resolves source IDs inside the lock, then inserts the draft
  snapshot in the same transaction. If the locked re-resolution
  differs from the tentative set (concurrent mirror/unlink committed
  during lock acquisition), the hash and `datapointBodies` are rebuilt
  once before insert. Closes the snapshot-orphan race.
- **`isPublic` reconciliation trusts the registry** — when
  `findSourceBySupplierRef` returns an existing remote Source on the
  recovery path, the persisted local metadata uses
  `remoteExisting.is_public` instead of the caller's requested value.
  Closes the case where two attempts with different `isPublic`
  intentions could leave local + Isometric disagreeing.
- **Recovery-flow integration tests** —
  `tests/isometric-sources-mirror-flow.test.ts` (new, 4 tests) covers
  the two approval-gate paths (GET found → `signed_upload_url` 200 →
  PUT → insert, and GET found → 409 → insert), the reconciled
  `isPublic` contract, and rejection of out-of-lineage documents.
  Mocks the Isometric client, storage provider, and data-access
  layer; runs against the real server action.
- **Three insert variants in `src/data-access/certification.ts`
  collapsed** — extracted `insertDraftSubmissionRow(tx, input)` (single
  source of truth for the row shape) and
  `withUniqueViolationGuard(fn)` (centralizes the 23505 →
  `SafeError("Submission already in progress")` mapping).
  `insertDraftSubmissionWithMappingLock` now delegates to
  `…AndLocks`; `insertDraftSubmission` shares the same guard.
- **Provider literals moved to non-server module** —
  `src/lib/isometric/utils/constants.ts` (new) holds
  `ISOMETRIC_PROVIDER`, `REMOVAL_SUBMISSION_TYPE`,
  `REMOVAL_ENTITY_TYPE`, `GHG_STATEMENT_SUBMISSION_TYPE`,
  `GHG_STATEMENT_ENTITY_TYPE`. `src/fn/certification/shared.ts`
  re-exports them so the existing import surface keeps working, but
  utils that can't cross the `"use server"` boundary
  (`source-lock.ts`) import directly.
- **Cross-provider scoping on snapshot reference check** —
  `isExternalSourceReferencedInSnapshots` now filters by `provider`
  (forward-compat: only `isometric` issues source_ids today, but the
  enum permits `puro_earth` and `verra` and nothing structurally
  prevents two providers from generating the same id string).
- **Sources panel syncs local visibility with refetched data** —
  `src/components/certification/sources-panel.tsx` adds a `useEffect`
  resetting the `isPublic` toggle from `mirror?.isPublic` so a
  cross-tab visibility flip doesn't leave a stale UI value.

Open-questions trail: closes `isometric/sources-integration-tests` and
`isometric/sources-submit-lock`; opens
`isometric/sources-lock-hold-time` (mirror lock held across HTTP) and
four `code/*` deferred-simplification entries.

Tests: 294 passing, typecheck clean.

## 2026-05-26 (Phase 3.5 — Sources upload landed)

Ships Phase 3.5 end-to-end. noma `documents` rows mirror to Isometric
Sources via server-side proxy, the resulting `source_ids` ride into
every monitored Datapoint payload, and the resolved set is part of the
semantic hash so a mirror or unmirror supersedes the Removal version.
No DB migration — `certifier_document_uploads` (created in migration
0000) gets its first writers.

- **Server-side mirror flow** —
  `src/fn/certification/sources.ts` (`mirrorDocumentToSource`):
  pre-flight (storage key + size ≤ 50 MB + recorded MIME +
  `headObject` size match) → advisory lock keyed on
  `mirror:isometric:{documentId}` → reconciliation
  (`GET /sources?supplier_reference_id=…` → if found,
  `POST /sources/{id}/signed_upload_url` → 200 re-PUT or 409 already
  uploaded) or fresh (`POST /sources`) → host-allowlist-validated
  `PUT` with `redirect: "error"` → `INSERT certifier_document_uploads`
  with `(provider, document_id)` uniqueness as the idempotency lock.
  Every outbound HTTP call wraps `withSyncEventOnFailure` so failures
  land in `certifier_sync_events` before throwing.
- **Hash-covered source attribution** —
  `src/lib/isometric/transformers/datapoint.ts` plumbs `sourceIds`
  into every monitored Datapoint's `source_ids` (no INPUT_MAPPING
  change → `MAPPING_REVISION` unchanged).
  `src/fn/certification/submit-removal.ts` resolves source IDs from
  the lineage already loaded in `RemovalSubmissionContext`, adds them
  to `semanticPayload.sourceIds` and to
  `payloadSnapshot.transport.datapointBodies[].body.source_ids`. The
  `datapointTransportSchema` now requires `source_ids` so resumed
  pre-Phase-3.5 snapshots fail loud locally rather than POST a
  malformed Datapoint.
- **UI** — `src/components/certification/sources-panel.tsx` lists
  every document attached to entities along the Removal's
  chain-of-custody (application, delivery, order, biochar product,
  production run, samples, feedstocks, reactor, credit batch) with
  per-row Mirror / Unlink / public-private toggle. Mounted under the
  credit-batch side sheet's `CertifyPanel` and at the new dynamic
  route `/certification/removals/[removalId]`. The Removals hub adds
  a "Sources →" link on each card. UI handles its own
  loading/empty/error states matching sibling certification panels.
- **Authorization model on unlink** —
  `certifier_document_uploads` rows referenced by any persisted
  submission snapshot cannot be deleted: `unlinkDocumentSource`
  guards via `isExternalSourceReferencedInSnapshots`
  (jsonb_path_exists over `payload_snapshot`), wrapped in a
  transaction + post-delete recheck. The Source remains on Isometric
  in all unlink cases; the user can re-mirror to restore the link.
- **Document deletion compatibility** — `deleteDocument`
  (`src/fn/documents.ts`) now pre-checks `certifier_document_uploads`
  before deleting storage bytes; FK violations are surfaced as a
  user-friendly `SafeError` instead of a 500.
- **New env var** — `ISOMETRIC_UPLOAD_HOST_ALLOWLIST` (optional;
  comma-separated host suffixes; defaults to `.s3.amazonaws.com,
  .amazonaws.com, .isometric.com, .digitaloceanspaces.com`). The
  mirror flow's PUT refuses to ship bytes to any URL outside this
  list (SSRF defense-in-depth).
- **Known v1 compromise** — removal-wide source attribution; every
  monitored Datapoint receives the same `source_ids` list. Per-input
  refinement is a Phase 5 follow-up tracked under
  `isometric/sources-per-input-attribution`. 50 MB hard cap on
  mirrored bytes tracked under
  `isometric/sources-stream-large-files`.
- **Tests** — `tests/isometric-sources.test.ts` (13 cases): supplier-
  ref determinism, transformer `source_ids` plumbing, supersede
  contract on hash sensitivity. Existing
  `tests/isometric-submit-removal.test.ts` mocks the new source
  resolver to keep the pre-Phase-3.5 contract pinned. Mirror-flow
  integration tests (POST 200 → PUT, recovery 200 → PUT → insert,
  recovery 409 → insert, mid-PUT failure → retry, race detection)
  tracked under `isometric/sources-integration-tests`.

Open question closed: `isometric/phase-3.5`.


---

Older entries (2026-02-09 → 2026-05-24) are archived in
[`docs/archive/isometric-changes-archive-2026-02-to-05-24.md`](../archive/isometric-changes-archive-2026-02-to-05-24.md).
