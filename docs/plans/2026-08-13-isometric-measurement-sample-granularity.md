# Isometric measurement-sample granularity correction

Owner: Engineering
Status: Proposed
Last reviewed: 2026-08-13

## Executive summary

Noma currently submits the three laboratory Samples that characterise a sampled
1,000-year credit batch as one Isometric `MeasurementSample` containing all
replicate values. The registry therefore shows one Production batch Sample with
seven datapoints: three total-carbon values, three inertinite-fraction values,
and one batch product-mass value.

The GHG Entry calculation still consumes three carbon measurements and three
`s_fraction` measurements, so the observed stored-carbon calculation is not
missing replicates. The defect is the registry entity grain and its provenance:
three independently analysed noma Samples have been collapsed into one registry
Sample, all are assigned a batch/removal-level measurement timestamp, and the
batch product mass is presented as though it were a property of that aggregate
Sample.

The target contract is one Isometric `MeasurementSample` per noma Sample, with
a stable per-Sample supplier reference and the Sample's own sampling timestamp.
Each current 1,000-year registry Sample should carry one total-carbon value and
one inertinite-fraction value. Product mass remains one scalar GHG input and
should preferably be submitted as a standalone Datapoint, rather than attached
to an arbitrary physical Sample. The final mass transport must be confirmed
with a disposable sandbox Removal before the affected sandbox records are
remediated.

This plan is intentionally coordinated with
[`2026-08-13-isometric-1000-year-inorganic-carbon.md`](./2026-08-13-isometric-1000-year-inorganic-carbon.md).
That plan changes the active component and replicate tuple. The granularity
change here should land in the same versioned wire-contract migration, or land
first behind tests that make the subsequent inorganic-carbon addition a simple
per-Sample field extension.

## Verified incident

The following Isometric sandbox records were inspected on 2026-08-13:

- Facility Samples tab: `fcl_1KZNQRW23SBXH1W7`
- Measurement Sample: `mts_1KZX2RVHHSBXA17A`
- GHG Entry: `rmv_1KZX2RYD7SBXTC7R`
- Sequestration component: `cmp_1KZX2RYD7SBXJ0ZG`

Observed registry state:

| Surface | Observed state |
| --- | --- |
| Facility Production batch samples | One Sample row, seven datapoints |
| Sample detail | Carbon `0.770`, `0.755`, `0.780`; inertinite `0.930`, `0.940`, `0.930`; mass `1,970 kg` |
| GHG component carbon input | Three measurements, list input |
| GHG component `s_fraction` input | Three measurements, list input |
| GHG component product mass | One scalar, `1,970 kg` |
| Registry result | `4.381 tCO2e` stored; `3.70 tCO2e` net Removal |

This rules out a registry list-binding failure: the calculation sees all three
replicates. It also rules out a display-only grouping issue because the facility
table itself reports one Sample entity.

The exact local submission row was not present in any available development or
test database. The live registry shape nevertheless matches the deterministic
payload builder and its tests exactly.

## Root cause

The application implements the aggregate shape deliberately:

1. `src/data-access/credit-batch-samples.ts` correctly loads the distinct noma
   Sample rows for a credit batch.
2. `src/fn/certification/durability-measurement-samples.ts` sorts those rows,
   maps them to replicate values, and passes the complete array to one builder.
3. `src/lib/isometric/transformers/measurement-sample.ts` flattens every
   replicate into one `values` array and appends one product-mass value.
4. `src/lib/isometric/measurement-samples.ts` creates a supplier reference at
   Removal + credit-batch + version grain, with no local Sample identity.
5. The snapshot, journal, reconciliation, and source-patching paths therefore
   persist and resume one remote Sample per credit batch.
6. Unit and registry-boundary tests explicitly assert one submission and one
   `/measurement_samples` POST, making the incorrect shape the protected
   behavior.

There is a related timestamp defect: payload construction currently supplies
the Removal aggregation's latest production time as `measured_at`. It does not
preserve each noma Sample's `samplingTime` in the remote Sample.

## Desired contract

For a credit batch with three complete noma Samples, Noma creates three remote
Samples linked to the same Isometric production batch:

| Remote Sample | Identity and time | Values with current component |
| --- | --- | --- |
| Sample A | Stable reference derived from local Sample A; Sample A sampling time | total carbon `0.770`; inertinite `0.930` |
| Sample B | Stable reference derived from local Sample B; Sample B sampling time | total carbon `0.755`; inertinite `0.940` |
| Sample C | Stable reference derived from local Sample C; Sample C sampling time | total carbon `0.780`; inertinite `0.930` |

The GHG Entry still receives:

- one ordered list containing the three total-carbon Datapoint IDs;
- one ordered list containing three direct `s_fraction` Datapoint IDs; and
- exactly one product-mass Datapoint ID.

When the replacement component in the inorganic-carbon plan is implemented,
each remote Sample instead carries the paired total-carbon, inorganic-carbon,
and inertinite measurements from that same noma Sample. Equal-length ordered
lists then follow naturally from the one-Sample-per-submission structure.

## Decisions and constraints

### One remote Sample per local Sample

The remote Sample is the representation of the independently analysed local
Sample, not a container for a batch's replicate population. The credit batch
remains the Isometric production batch to which all three Samples link.

### Sample identity is stable and versioned

Extend the supplier-reference builder with local `sampleId`. The reference must
remain deterministic, fit the registry's 100-character limit, and stay
versioned by Removal submission so supersession creates new remote evidence
rather than mutating historical submitted evidence.

Do not use `sampleCode` as the sole identity. Codes are user-facing and may be
corrected; the stable UUID is the business identity for reconciliation.

### Use the Sample's own timestamp

`measured_at` should be derived from the local Sample's `samplingTime`, because
that is the sampling event represented by the remote entity. Preserve the
instant as ISO 8601. Do not replace it with the Removal window end, production
batch end, analysis date, or submission time.

### Keep batch product mass scalar

Product mass is a credit-batch/application attribution value, not the physical
mass of a laboratory Sample. The preferred implementation is a normal direct
Datapoint with the existing inventory/durability Sources and a stable versioned
reference. Change the sequestration binding for `product_mass` from
`measurement-property` to `direct-datapoint`.

If a sandbox contract probe proves that the active component refuses a direct
product-mass Datapoint, the fallback is to place mass on exactly one
deterministically selected remote Sample. That fallback must be documented as a
registry transport constraint, and tests must still enforce one mass Datapoint
across all three Sample responses.

Never repeat product mass on all three Samples: a scalar binding would then
receive three IDs and fail, or an accidental list/reduction could overstate
mass.

### Preserve raw replicate calculations

Do not average carbon or `s_fraction` locally for the wire payload. The registry
continues to own list reduction and the authoritative stored-carbon result.

### Keep partial submission recoverable

The current sequential create and journal choreography should remain. After a
failure following Sample A or Sample B, a retry must reconcile the already
created supplier references and create only the missing Samples. Journal
uniqueness must remain one-to-one between supplier reference and remote Sample
ID.

### No production enablement

The sampled durability path remains sandbox-only. This correction does not
authorize production submission or resolve the open component-formula
governance questions.

## Implementation plan

### Phase 1 - Lock down the regression

Add failing tests before changing the builder:

1. Use the incident values `0.770/0.755/0.780`,
   `0.930/0.940/0.930`, and `1,970 kg`.
2. Assert three submissions with distinct operation keys and supplier
   references.
3. Assert each submission corresponds to one local Sample and carries only
   that Sample's paired chemistry values.
4. Assert each body uses its Sample's `samplingTime`.
5. Assert input row order does not change the normalized semantic payload or
   supplier references.
6. At the fake-registry boundary, assert three `/measurement_samples` POSTs,
   three journal entries, and three captures.
7. Assert merged carbon and `s_fraction` bindings contain exactly three IDs and
   product mass contains exactly one.

The correct seams are the pure submission builder, the existing fake-registry
boundary test, and the claim/recovery tests. A UI E2E test is not necessary for
the core regression because the bug is entirely in server-side payload shape.

### Phase 2 - Make the submission model Sample-aware

1. Extend `DurabilityMeasurementSampleSubmission` with explicit
   `creditBatchId` and `sampleId` fields for production-batch Samples.
2. Replace `creditBatchIdForSubmission()` string parsing with the explicit
   field. Operation keys remain audit labels, not a data model.
3. Extend `buildMeasurementSampleReference()` with a per-Sample production
   role or a required `sampleId` for the existing role.
4. Generate deterministic short hashes from Removal ID, credit-batch ID, and
   Sample ID while retaining submission version.
5. Update snapshot validation and semantic normalization to preserve the new
   shape and sort submissions deterministically.
6. Bump the mapping revision so the old aggregate snapshot cannot be resumed as
   though it represented the corrected contract.

Exit criterion: one local Sample produces one independently addressable,
snapshot-stable submission identity.

### Phase 3 - Build one body per Sample

1. Retain the existing whole-batch readiness gates: all selected Samples must
   be complete and at least three complete replicates are required.
2. Sort source Samples by stable ID.
3. Map each Sample to its own request body rather than constructing a shared
   replicate array.
4. Build one current-component body containing total carbon and
   `s_fraction`. If coordinated with the replacement component migration, also
   include measured inorganic carbon in that same body.
5. Set `measured_at` from `sample.samplingTime`.
6. Apply the same registered `production_batch_id` to all Samples in the
   credit batch at POST time.
7. Include local Sample identity in labels and failure messages without logging
   user or laboratory PII.

Exit criterion: a three-Sample batch materializes exactly three remote Sample
requests with paired provenance.

### Phase 4 - Separate and bind product mass

Preferred path:

1. Extend the explicit sequestration binding table so `product_mass` uses a
   direct mass Datapoint with unit `kg` and `REPORTED` type.
2. Build exactly one product-mass Datapoint per credit batch/Removal version.
3. Keep `carbon_contents` sourced from remote Measurement Sample responses.
4. Continue building direct `s_fraction` Datapoints from each Sample body's
   evidence value because the template expects quantity kind `dimensionless`,
   while the retained Sample property is `dimensionless_ratio`.
5. Attach the existing inventory and durability Sources according to the
   immutable source-binding plan.
6. Ensure source patching no longer uses the presence of a mass value as the
   condition for processing a Sample capture. Carbon and retained evidence
   Sources must still be patched for every remote Sample.

Fallback path, only if required by the sandbox contract:

1. Select the first Sample in stable Sample-ID order as the single mass carrier.
2. Patch Sources on every Sample capture independently of mass presence.
3. Assert exactly one mass Datapoint is returned across the full submission set.

Exit criterion: the GHG Entry binds three replicate values per list input and
one product-mass scalar without representing three product masses.

### Phase 5 - Harden reconciliation and recovery

1. Update journal tests for three supplier-reference/remote-ID pairs.
2. Simulate failure after the first and second successful Sample create.
3. Verify a resumed attempt performs collection reconciliation for journaled
   Samples and POSTs only the missing ones.
4. Verify a supplier reference resolving to a different remote ID fails closed.
5. Verify duplicate remote IDs or duplicate supplier references remain rejected.
6. Verify production-batch registration happens once and its ID is applied to
   all three Sample bodies.
7. Verify source-patching failure prevents GHG Entry creation and remains
   resumable without duplicating Samples.

Exit criterion: every partial-create boundary can safely resume with no remote
duplicates and no lost Datapoint bindings.

### Phase 6 - Sandbox contract verification

Use a fresh disposable sandbox Removal before touching the incident records:

1. Create a credit batch with three clearly distinguishable Sample values and
   dates.
2. Submit using the corrected code.
3. Confirm the facility shows three Production batch Sample rows.
4. Confirm each detail page contains only its own paired chemistry values and
   its own measurement date.
5. Confirm all three link to the same registered production batch.
6. Confirm the GHG component displays three carbon measurements, three
   `s_fraction` measurements, and one product-mass scalar.
7. Compare remote stored CO2e with Noma's preview and with the pre-change
   calculation using the same inputs.
8. Exercise one interrupted/resumed submission against the sandbox if a safe
   failure seam is available; otherwise rely on the fake-registry recovery
   boundary and inspect supplier references remotely.

Exit criterion: the registry entity count and provenance are corrected while
the calculated result remains equal within existing numeric tolerance.

### Phase 7 - Remediate the affected sandbox records

This phase deletes and recreates external sandbox data and requires explicit
user approval at action time.

1. Capture the affected GHG Entry, production batch, aggregate Sample,
   Datapoint, Source, supplier-reference, and local ledger relationships.
2. Determine the supported dependency order from the registry API. The
   generated API exposes deletion for GHG Entries and Measurement Samples but
   no Measurement Sample update endpoint.
3. Prefer a new corrected Removal version or a freshly recreated draft over
   in-place mutation.
4. Delete the old aggregate Sample only after no retained GHG Entry depends on
   its Datapoints.
5. Re-submit the corrected three-Sample structure.
6. Verify the final registry values and local ledger/journal reconciliation.
7. Record what was removed, what replaced it, and whether the deleted sandbox
   artifacts are recoverable.

Do not build a production data backfill. The repository has no production
database, and the durability submission path is sandbox-only.

## Verification matrix

| Layer | Required proof |
| --- | --- |
| Pure transformer | One Sample input becomes one body with paired values |
| Submission builder | Three source Samples become three stable submissions |
| Semantic snapshot | Stable across DB row ordering; changes on any Sample value/date change |
| Supplier reference | Unique per Sample and version; deterministic; <=100 characters |
| Direct datapoints | Three `s_fraction`; one mass; stable versioned identities |
| Fake registry | Three Sample POSTs and three remote entities |
| Response capture | Three carbon IDs merged in stable order; exactly one mass ID |
| Source binding | Correct Sources on mass, carbon, and retained evidence values |
| Recovery | Fail after create 1/2, resume without duplicate POSTs |
| Sandbox UI/API | Three Sample rows; two chemistry values per current-component Sample |
| GHG Entry | Three list values per replicate input; one mass scalar; unchanged result |

Run targeted tests first, followed by the repository's relevant certification
boundary suite, typecheck, and lint. Keep the live sandbox check separate from
hermetic PR gates and tag any lasting Playwright live coverage with `@live`.

## Files expected to change

Primary:

- `src/fn/certification/durability-measurement-samples.ts`
- `src/fn/certification/durability-measurement-sample-snapshot.ts`
- `src/lib/isometric/measurement-samples.ts`
- `src/lib/isometric/transformers/measurement-sample.ts`
- `src/lib/isometric/transformers/sequestration-binding.ts`
- `src/fn/certification/removal-submission-build.ts`
- `src/lib/certification/measurement-sample-journal.ts` if the journal schema
  needs explicit local Sample provenance

Tests:

- `src/fn/certification/durability-measurement-samples.test.ts`
- `src/lib/isometric/transformers/measurement-sample.test.ts`
- `src/lib/isometric/measurement-samples.test.ts`
- `src/fn/certification/durability-measurement-recovery.test.ts`
- `tests/registry-boundary-sequestration.test.ts`
- `tests/isometric-submit-removal-windows.test.ts`
- relevant fixtures that currently assume one aggregate body

Documentation after verification:

- amend `docs/adr/0013-registry-computed-durable-fraction.md`
- update `docs/isometric/changes.md`
- update `docs/isometric/schema-mapping.md`
- reconcile wording in `docs/open-questions-isometric.md`

## Non-goals

- Enabling durability submission against the production registry.
- Enabling 200-year or unsampled Method B submissions.
- Changing the credit batch as the protocol production-batch grain.
- Averaging replicate chemistry locally for submission.
- Solving the replacement component's inorganic-carbon and cap contract outside
  the coordinated plan referenced above.
- Automatically deleting or rewriting existing registry records.
- Adding a production database migration or historical backfill.

## Open confirmations

1. Will the active Isometric component accept `product_mass` from a standalone
   direct Datapoint? This is the only contract question that should alter the
   preferred wire shape.
2. Should the remote Sample `measured_at` represent sampling time or laboratory
   analysis time? Noma's domain model and the registry UI wording both support
   sampling time; confirm during the disposable sandbox check.
3. Should the granularity correction and the replacement four-input component
   migration ship in one PR? Recommended: yes if the component contract is
   confirmed before implementation begins; otherwise land the Sample-aware
   internal model and tests first, keep the active sandbox behavior gated, and
   add inorganic carbon in the immediately following PR.

## Completion criteria

This correction is complete only when:

- every submitted local Sample has one remote Sample identity and timestamp;
- a three-Sample batch shows three rows in the registry;
- chemistry values are paired by local Sample rather than flattened into an
  aggregate entity;
- the GHG Entry still binds three ordered values for each replicate list and
  one product-mass scalar;
- partial retries cannot duplicate remote Samples;
- sandbox calculation output remains unchanged for the incident fixture, apart
  from any separately approved replacement-component formula change; and
- the old aggregate incident record is remediated only after explicit approval
  and successful verification on fresh sandbox data.
