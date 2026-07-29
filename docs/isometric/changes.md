# Isometric Docs Change Log

Certification-readiness, transport-evidence, supporting-source, and sampling
correction notes are archived in
[`docs/archive/2026-07-28-certification-readiness-and-sampling-corrections.md`](../archive/2026-07-28-certification-readiness-and-sampling-corrections.md).

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

Removal review, Source lifecycle, and transport-provenance implementation notes
from 2026-07-27 are archived in
[`docs/archive/isometric-changes-archive-2026-07-27-removal-review-sources-transport.md`](../archive/isometric-changes-archive-2026-07-27-removal-review-sources-transport.md).

## 2026-07-29 (automatic GHG Statement data summary)

GHG Statement report preparation is now a one-click export of the current
Isometric statement and its GHG Entries. The generated PDF contains registry
identifiers, reporting dates, entry membership, calculated totals, and document
control metadata. It does not collect or claim qualitative methodology,
evidence, monitoring, exception, or human-review statements.

The operator still reviews and explicitly approves an immutable report version
before submission. A controlled external report URL remains available when a
project or VVB requires its own document. The generated data summary does not
replace such project-specific requirements.

## Registry Source visibility contract

Certification Settings exposes one organization-wide Isometric Source
visibility policy to organization Owners/Admins and Platform Admins. It defaults
to private and applies to every new Source created through the centralized
mirror flow, including generated Removal evidence-ledger PDFs. Per-document
visibility controls and the remote visibility PATCH action were removed, so
callers cannot override the persisted policy.

Policy changes are forward-only: noma does not bulk-rewrite existing Isometric
Sources, and reconciliation continues to preserve the registry-of-record
visibility for Sources that already exist.

Dated implementation and verification notes are archived in
[`docs/archive/isometric-changes-archive-2026-07-24-registry-source-visibility.md`](../archive/isometric-changes-archive-2026-07-24-registry-source-visibility.md).

Earlier implementation notes are archived by date:

- [`2026-07-23 to 2026-07-24`](../archive/isometric-changes-archive-2026-07-23-to-07-24.md)
- [`2026-06-10 to 2026-06-20`](../archive/isometric-changes-archive-2026-06-10-to-06-20.md)
- [`2026-05-26 to 2026-06-08`](../archive/isometric-changes-archive-2026-05-26-to-06-08.md)
- [`2026-02 to 2026-05-24`](../archive/isometric-changes-archive-2026-02-to-05-24.md)

## 2026-07-28 (application boundary evidence binds product mass Sources)

The Removal Source classifier now maps every valid application-boundary
logbook subtype (`weighbridge`, `inventory`, and `affidavit`) to the registry
Inventory role for the measurement-sample `product_mass` Datapoint. Dedicated
`weighbridge_ticket` and `affidavit` document types follow the same rule.

Previously, application readiness accepted all three evidence subtypes, but
Source classification recognized only the literal `inventory` subtype. A
ready Removal backed by a Weighbridge record therefore created or reconciled
its durability measurement sample, then failed closed before GHG-entry creation
because its Source plan had no intended Inventory target. The correction reuses
the shared application-evidence taxonomy and preserves exact application →
credit-batch lineage resolution, Datapoint confirmation, submission journaling,
and duplicate prevention.

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

## 2026-07-22 (ADR 0022 — computed Method-B eligibility)

- Removed stored process sampling regime/unlock state and the associated
  sample-floor/write triggers. A production process now stores only its epoch
  and an all-or-none prerequisite record.
- Added immutable `credit_batches.sampling` (`sampled`/`unsampled`). New
  unsampled batches require an Isometric organization connection, a facility
  project mapping, recorded prerequisites, and enough eligible sampled-batch
  samples since the current epoch.
- Blueprint routing now follows the stored batch choice. Eligibility remains a
  live decision for new batches and does not rewrite existing ones.

## 2026-07-28 (restore automatic evidence-ledger Sources)

- Removal submission once again materializes the generated transport and
  durability evidence-ledger PDFs after side-effect-free preflight and before
  Source mirroring. Generation failures now block submission with an
  actionable error instead of allowing incomplete registry attribution.
- Candidate Source discovery includes documents attached to each member credit
  batch. Generated ledgers remain Removal-scoped through their metadata, so a
  ledger for another Removal cannot be mirrored or bound accidentally.
- Transport ledgers bind to each present `mass_distance` input. Durability
  ledgers bind to the tier-specific measurement-sample inputs, while
  `product_mass` still requires and retains the Inventory Source as well.
- Durability ledger generation now covers both the 200-year H/C pathway and
  the 1000-year carbon-content/reflectance pathway. Content hashes include the
  durability option, preserving idempotent reuse and safe supersession.
- Generated ledgers are excluded from the operator review hash because they do
  not exist until submission, but remain covered by the full immutable
  submission payload hash.
- A submitted Removal can be reopened through its resume link. The same
  compilation and review gates apply: an unchanged payload reuses the existing
  registry version, while changed reviewed evidence or mappings create a
  superseding version. Only a live submission lock blocks reopening.

## 2026-07-29 (Safety margin mass is a Removal-scope datapoint — named carve-out)

The 29 Jul Removal Template (`Dark Earth Carbon Template (29 Jul)`) added a
`Safety margin` component under `miscellaneous / mass_based_ci_emissions`.
Read-only inspection on 2026-07-29 observed its active-template fixed Datapoint
`dtp_1KS4PMV99SBXX88K` at 20 kgCO2e/metric_ton. That value is registry-owned
configuration, not a pinned protocol requirement. noma submits nothing for
`carbon_intensity`; attaching its justification Source is an operator action
in the registry UI. Its `mass` input is
`monitored` and previously hit the ADR 0005/0018 PROJECT-scope guard: sandbox
submitted a 0 kg no-sources stub, production failed closed.

Because the deduction scales with the exact biochar mass each Removal claims,
it cannot be amortized as a PROJECT-scope Component. The guard now supports a
named-component carve-out: `lookupPeriodInputTuple` takes the template
component display name and releases a period tuple only when the matching
`INPUT_MAPPING` entry names that component in `sourceByComponent`. The only
carve-out is `"safety margin"` → `totalBiocharDryMassKg` (dry mass, bucket
`stored` — the identical attribution basis used by the sequestration
`product_mass` claims). Every other `miscellaneous` component, and all six
other period tuples, keep the fail-closed PROJECT-scope behavior; the guard's
error text now lists the recognized carve-out names so a renamed registry
component is self-explanatory.

The Inventory Source rule (application-boundary logbook / weighbridge
evidence) gained the safety-margin mass as an `additionalIntendedTargets`
entry with `optionalInTemplate: true` (the two legacy templates declare an
empty `miscellaneous` group), so the same mass evidence that backs
`product_mass` now backs the deduction. `scripts/isometric-coverage-check.ts`
threads component display names through the guard and validates
`resolveDatapointSource` per tuple, so the nightly health run catches a
renamed `Safety margin` (or diesel-split) component the same way submit does.

Both `MAPPING_REVISION` and `SOURCE_BINDING_MAPPING_REVISION` changed: a
resubmission creates a superseding version carrying the real mass. Sandbox
removals already submitted against the 29 Jul template carry a 0 kg safety
margin and need a deliberate resubmission. Locked drafts replay their stored
snapshot by design.

## 2026-07-29 (application evidence is advisory)

- Missing geotagged photos, boundary references, and boundary logbook records
  no longer block Removal submission.
- Application evidence remains visible as an advisory warning for operator
  follow-up and verification.
- This aligns the submission gate with the pinned agricultural-soils module:
  application evidence may be retained or supplied voluntarily, but it is not
  required in the Certify submission payload.

## 2026-07-29 (mass-weighted biochar-bin provenance)

- Biochar products now draw from a biochar bin. Each draw is allocated across
  every contributing production run in proportion to its remaining wet mass;
  wet and dry kilograms are stored separately on immutable allocation rows.
- Certification, Sources discovery, credit-batch accounting, mutation guards,
  and direct application traceability now follow those allocation rows. A
  mixed-bin product exposes every contributing run and feedstock instead of
  presenting one arbitrary production-run code.
- Seeded products use the same mass-weighted model. The seeded source bin
  balances from 2,550 kg wet produced to 2,480 kg allocated, 18 kg documented
  loss, and 52 kg wet remaining.
