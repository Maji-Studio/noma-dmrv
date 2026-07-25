# Isometric change archive: 2026-06-10 to 2026-06-20

Historical implementation and verification notes moved from `docs/isometric/changes.md` to keep the active changelog within the repository line cap.


## 2026-06-20 (ADR 0017 Track 2 — Method-B unlock backend + operator UI)

Track 2 activates the Method-B unlock end-to-end (ADR 0017; implementation record
[`docs/archive/2026-06-20-method-b-unlock.md`](2026-06-20-method-b-unlock.md)).
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
[`docs/archive/2026-06-20-method-b-unlock.md`](2026-06-20-method-b-unlock.md)).
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
