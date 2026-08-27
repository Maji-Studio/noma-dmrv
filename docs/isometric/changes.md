# Isometric Docs Change Log

## 2026-08-27 (Biochar Application canonical readback units)

- Live Certify Biochar Application responses canonicalize submitted `t/ha` to
  `metric_ton / hectare` and submitted `kg` to `kilogram` on readback.
- Reconciliation accepts only those semantically identical spelling pairs.
  Quantity magnitudes, application and dependency identities, dates, supplier
  references, and GHG Entry associations remain strict; unrelated units still
  fail closed as registry drift.
- Kilogram request/readback comparison is shared with Production Batch
  reconciliation so both endpoints retain the same verified alias contract.

## 2026-08-26 (Biochar Application API restored)

- Removal submission now ensures Production Batches, then Storage Locations,
  then one Biochar Application per immutable Application by credit-batch slice
  in the configured Isometric environment.
- Biochar Application arrival mass is exactly the slice's allocated wet kg and
  departure mass is zero kg. Commingled slices partition the physical
  Application total.
- Biochar Applications use the ordinary claim, reconciliation, drift, retry,
  and confirmation journal lifecycle. There is no missing-mass gate or
  placeholder lifecycle.
- Delivery truck weighing was removed. Delivery receipts and photos remain
  retained documents but do not bind to sequestration inputs. Delivery bills
  of lading retain only their biochar transport binding.
- Storage Location synchronization now follows the configured environment.

## 2026-08-16 (1000-year Removal grouping and local draft recovery)

- A 1000-year facility can group only one credit batch into each Removal. The
  wizard enforces this before Continue, and the authoritative transaction
  rechecks the locked facility tier before creating a Removal or assigning
  application slices. When one physical Application spans multiple 1000-year
  credit batches, each immutable batch slice can join its own Removal. The
  200-year multi-batch flow still keeps the complete Application together.
- An authenticated operator can discard a purely local Removal draft after
  confirmation. Recovery releases only that Removal's application-slice
  memberships and deletes its local row in one transaction.
- Recovery refuses any Removal with a submission ledger row, production claim,
  reporting dates, GHG Statement membership, or sticky possible-mutation
  marker. Append-only sync events are retained as audit history but do not act
  as registry state or block recovery by themselves. Recovery shares the
  submission advisory lock so a concurrent claim cannot race the discard.
  Before any submit-time Source mirroring can mutate Isometric, noma persists
  the sticky marker under the same Removal and artifact locks, so recovery
  stays fail-closed throughout the pre-ledger external-write window.
- The legacy telemetry draft claim rechecks that its Removal still exists in
  the active organization after taking the shared artifact lock. When discard
  wins the race, telemetry creates no ledger row and performs no registry work.

## 2026-08-16 (whole-batch production-claim concurrency hardening)

- A Removal now reserves all unclaimed member credit batches atomically before
  its first registry POST. A mutation-free failure releases the reservation;
  possible or confirmed remote mutation keeps it fail-closed for reconciliation.
- The earliest reporting period wins a shared batch's production inputs, using
  the latest member Application date as the pre-submit completion date and the
  draft creation time and ID only as tie-breakers.
- Whole-batch production inputs include completed, unapplied member runs and
  their feedstock transport. Those runs do not dilute the applied biochar
  delivery-transport fraction.
- For 200-year facilities, an Application may join a Removal only when all of
  its credit-batch slices are unassigned; an existing sibling owner blocks the
  assignment. A 1000-year Removal instead owns its single batch slice.

## 2026-08-15 (application-slice Removal attribution and carbon ledger)

- Biochar remaining in a source bin can be used for a new product after its
  production run has supported a submitted Removal. Submitted source records
  remain immutable; the new downstream draw is a new record.
- Removal membership now freezes application-by-credit-batch wet and dry mass
  slices. Newly applied mass from the same credit batch remains available for a
  later Removal.
- The first successful Removal claims the full production-emissions bucket.
  Later Removals retain delivery and stored inputs and omit already-claimed
  production inputs.
- A commingled physical Application compiles one registry Biochar Application
  per immutable credit-batch slice while retaining the shared observed truck
  facts.
- Removal review and credit-batch detail now show a compact carbon ledger, one
  stored-CO₂e estimate, linked source records, and the prior production claim.
- Noma submits accounting inputs; Isometric remains authoritative for project
  emissions and the net removal result.

## 2026-08-13 (Production Batch physical run windows)

New Isometric Production Batches now submit the earliest member production-run
start and latest completed member-run end as `started_at` and `ended_at`. These
are physical instants, matching the checked-in Certify OpenAPI descriptions and
the existing Production Batch mapping decision, rather than UTC day-boundary
timestamps derived from the credit batch's date-only window. This keeps every
member run inside the immutable remote Production Batch, preserves non-zero
same-day windows, and renders the operator's physical run times consistently in
positive- and negative-offset facility timezones.

Reconciliation accepts the former UTC day-start/day-end representation for a
remote batch carrying the same stable supplier reference and otherwise matching
identity and records that compatibility claim in the sync audit trail. Stored
payload hashes from that exact legacy representation migrate once to the
physical-window hash; changes to mass, facility, feedstock, kind, supplier
reference, or a later physical window still emit drift. Open member runs fail
before that batch's registry POST.
The behavior is covered hermetically; fresh sandbox verification is pending.

## 2026-08-15 (Storage Location and Biochar Application Removal integration)

One customer location represents one reusable agricultural application site per
Isometric project. Organization Owners/Admins can explicitly synchronize that
site from an Application detail sheet. Sandbox Removal submission also ensures
all required Production Batches, then Storage Locations, then Biochar
Applications before completing the submission. Storage Location reconciliation
and drift handling remain unchanged; application create and update actions do
not perform registry writes, and local name or coordinate drift never triggers
an automatic PATCH.

Delivery create/edit now records optional observed truck mass before and after
unloading in kilograms. Sandbox Removal preflight requires both observations
for every included Application and never substitutes delivered wet mass or zero
as observed evidence. It also requires a positive field size, compiles
commingled mass as one immutable application-by-credit-batch slice per registry
Production Batch, refuses deliveries split across multiple Applications, and
snapshots the resolved values before any registry mutation. The Biochar Application
journal claims the exact payload before POST and reconciles bounded list pages
by its versioned environment/provider reference after retries. Rate is applied
tonnes divided by field hectares (`t/ha`); truck mass values use `kg`.
Production-environment registry synchronization remains explicitly disabled for
both Storage Location and Biochar Application resources.

This traceability layer does not change the GHG Entry `CO2 stored` component,
its payload hash, or the existing sequestration calculation. Measurement
Locations remain out of scope. The migration chain and focused local
tenant/concurrency tests are verified independently of the live provider; live
sandbox Storage Location behavior and any registry UI URL remain unverified.

Certification-readiness, transport-evidence, supporting-source, and sampling
correction notes are archived in
[`docs/archive/2026-07-28-certification-readiness-and-sampling-corrections.md`](../archive/2026-07-28-certification-readiness-and-sampling-corrections.md).

Application mass records remain uploadable, but new uploads do not use the
inapplicable Soil Environments v1.2 classification taxonomy. Completed
production runs require one successfully uploaded, unchanged readings CSV for
certification readiness. This file-presence check is a conservative Noma
control and does not claim that structured telemetry was submitted to Certify.
Dated implementation context is archived in
[`docs/archive/isometric-changes-archive-2026-07-31-operational-feedback.md`](../archive/isometric-changes-archive-2026-07-31-operational-feedback.md).

Certification review corrections for report serialization, Production Batch
reconciliation, workspace eligibility, and grouped Removal readiness are
archived in
[`docs/archive/2026-08-09-certification-review-corrections.md`](../archive/2026-08-09-certification-review-corrections.md).

Removal submission recovery and the observed Production Batch mass-unit
readback are archived in
[`docs/archive/2026-08-10-removal-submission-recovery.md`](../archive/2026-08-10-removal-submission-recovery.md).

## 2026-08-14 (replacement s_fraction binding matches observed blueprint shape)

The live `biochar_sequestration_1000_year_f_durable_max` blueprint declares
`s_fraction` as a `dimensionless_ratio` LIST. Removal compilation now binds the
existing `dimensionless_ratio/inertinite_fraction` Measurement Sample response
Datapoints directly instead of duplicating them as `dimensionless` Datapoints.
Product mass remains the only standalone durability Datapoint. The local
contract now matches the read-only sandbox blueprint shape and removes the
false template-admin blocker. Registry confirmation that this replacement
governs the Protocol v1.1 project and a fresh end-to-end sandbox submission
remain pending.

## 2026-08-13 (measurement Samples preserve local Sample grain)

Sampled 1,000-year submission now creates one Isometric
`MeasurementSample` for each independently analysed noma Sample. Each request
uses a deterministic versioned reference containing the stable local Sample
identity, the Sample's own sampling instant, and only its paired total-carbon,
inorganic-carbon, and `s_fraction` values. Input row ordering does not change
the semantic snapshot or supplier references.

Batch product mass no longer appears as a property of an aggregate physical
Sample. It is materialized once as a standalone direct `REPORTED` kg Datapoint,
with the existing inventory and durability Sources. The GHG Entry continues to
receive three ordered IDs for each chemistry/reflectance list and one scalar
mass ID. Measurement Sample source patching processes every capture even though
none carries mass.

The snapshot schema and mapping revision reject the former aggregate shape.
Supplier-reference journaling and collection reconciliation resume after one or
two successful Sample creates, and a source-patching retry reconciles all three
without duplicate POSTs. This is code-implemented and hermetically verified;
fresh sandbox verification is still pending. No production enablement or
external-record remediation is included.

## Feedstock inventory mass basis

Feedstock-bin stock, withdrawals, losses, and reconciliation now use wet,
as-received kilograms as their authoritative physical inventory unit.
`production_run_feedstocks.wet_mass_used_kg` records that wet allocation and
replaces the former ambiguously named `mass_used_kg` column. Production runs
continue to derive dry feedstock mass from their recorded wet mass and moisture
for process calculations and certification inputs. Certification lineage uses
the wet allocation shares to select contributing intake batches without
changing the dry-mass values submitted for protocol calculations.

## 2026-08-10 (customer location application evidence)

Application records now support `location` as the first and default evidence
method for identifying where biochar was applied under Agricultural Soils v1.1.
The location path uses the application's complete latitude/longitude pair,
normally derived from the selected delivery customer's saved location. GIS
boundary evidence remains available as an alternative, while visual evidence
remains unavailable in the creation UI.

This changes noma's local application evidence enum and defaults; it does not
add or change an Isometric API operation. Application evidence-health counts
remain informational and do not block certification submission.

## Live submission progress

Removal and GHG Statement submission dialogs now show progress from noma's
actual orchestration checkpoints. Completed registry calls receive checkmarks,
repeated monitored-input and durability calls show completed and total counts,
conditional steps are marked as not required, and work recovered from an
earlier attempt is marked as already sent. This is UI feedback over the existing
single submission request, not a background job or a new Isometric API
capability.

Submission dialogs cannot be dismissed while the request is active. If a call
fails, the failed step remains visible and retry continues through the existing
submission-ledger reconciliation path without assuming that an uncertain
registry write did not happen.

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

## 2026-07-29 (application evidence removed from Removal readiness)

Application evidence health no longer produces Removal submission blockers,
advisory notes, or incomplete certification badges. The configured project uses
Biochar Protocol v1.1, which binds Biochar Storage in Agricultural Soils v1.1.
That module places project-boundary evidence in the PDD and does not contain the
later Soil Environments module's per-application boundary-logbook taxonomy.

Application document uploads remain available. Biochar Protocol v1.1 still
requires weigh-scale tickets or equivalent application-mass records to be
retained for verification for at least five years. Retained records are not
treated as evidence that must be attached to each application before a Removal
can be submitted.

The submit pipeline now accepts the generated durability evidence ledger as the
Source for the `product_mass` datapoint. It no longer requires that Source to
carry the Application-logbook-specific `Inventory` role. Preflight also waits
for submit-time ledger generation instead of blocking an existing Removal when
no operator-uploaded Source exists.

This also closes the open question "Application evidence-readiness: two
implementations, one taxonomy" (opened 2026-07-20). The duplication went away by
deleting the certification submission gate rather than by unifying the two
evaluators. The shared SQL builder is now the only path that feeds a surface,
and what it feeds is an informational evidence-health count rather than a gate.
The JS twin in `src/fn/certification/application-evidence-readiness.ts` survives
only as the test oracle that keeps the SQL builder honest.
## 2026-07-29 (interpretation docs refreshed against v1.1)

[`requirements-shortlist.md`](./requirements-shortlist.md) and
[`schema-mapping.md`](./schema-mapping.md) were rewritten against the v1.1 pin
recorded on 2026-07-24, so they no longer carry the earlier v1.2 extraction.
[`versions.json`](./versions.json) drops the "pending refresh" note accordingly.
The pin itself did not move: protocol v1.1 and Standard v1.7 remain the observed
Certify project versions, and these files stay non-authoritative local
interpretations that must be verified against the registry.

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

## 2026-08-13 (replacement sampled 1,000-year component implemented locally)

The current sampled component contract is
`biochar_sequestration_1000_year_f_durable_max`, with paired list inputs
`total_carbon_contents`, `inorganic_carbon_contents`, and `s_fraction`, plus
scalar `product_mass`. Every submitted replicate requires directly measured
inorganic carbon; noma does not derive it from total minus reported organic
carbon on this path.

The local explanatory preview now mirrors the component: calculate organic
carbon per replicate as total minus inorganic, average it, calculate raw
durability as the binomial lower estimate, bound credit-bearing organic carbon
and durability at zero, cap durability at 0.95, and use the bounded value for
stored CO2e. Evidence ledgers show the three per-replicate
values, `s_fraction`, product mass, raw and capped durability, cap status,
component key, and formula label. Isometric remains authoritative.

The deprecated `biochar_sequestration_1000_year` remains readable and is
labelled as legacy total-carbon/uncapped semantics. New template selection and
submission compilation reject it. Production sampled submission remains
blocked, and unsampled Method B remains unsupported. Protocol v1.1,
Agricultural Soils module v1.1, and Standard v1.7 pins are unchanged. Isometric
confirmation and external sandbox-template migration remain outstanding; no
registry template was changed by this implementation.

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
## 2026-07-29 (GIS-only removal evidence)

- The unconditional mapped-Source submission requirement is removed. A
  Removal with only GIS boundary evidence can now be submitted.
- A `gis_boundary` document on Application lineage is deliberately excluded
  from the Removal Source binding plan until an Application `source_ids` or
  equivalent boundary target exists.
- The partial-mirroring blocker is retained.

## 2026-08-14 (sync-event key widened; stale-lock script re-keyed)

- `certifier_sync_events.entity_id` widened from `uuid` to `text` (migration
  0108). The column is polymorphic per `entity_type`: local UUIDs for removals,
  GHG statements, and documents; `nm-slc-*` supplier references (or an
  `unmapped:*` fallback) for Storage Locations, whose sync events previously
  failed to insert and crashed the application sync panel on read.
- `scripts/isometric-clear-stale-lock.ts` now targets the Removal ledger key
  (`localEntityType='removal'`); it previously queried `creditBatch` and could
  never find current rows. It refuses to clear a draft whose
  `metadata.externalMutation` is `possible`/`confirmed` unless
  `--force-confirmed` is passed, because rejecting such a draft re-versions
  the supplier references and can duplicate registry entries.
- GHG statement creates now persist the interrupted marker (`lastError`,
  `lastAttemptOutcome`, `externalMutation`) when a timeout/5xx may have
  reached the registry, matching the Removal pipeline.
