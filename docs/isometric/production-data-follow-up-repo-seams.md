# Isometric production-data: current repository seams

> Companion to
> [`production-data-follow-up-research.md`](./production-data-follow-up-research.md)
> (researched 2026-08-04). That doc holds the registry contract and its open
> questions; this one maps the contract onto the code as it stands.
>
> **Observations only. No application-code changes are proposed here.** Line
> references verified 2026-08-04 on `codex/conserve-dry-biochar`.

## 7. Repository seams

### 7.1 Production Batch does not exist in the integration at all

Verified by direct grep during this pass: `grep -rn "production_batches" src/`
outside `src/lib/isometric/generated/` returns **nothing**, and
`grep -rn "productionBatchId" src/` outside
`src/lib/isometric/transformers/measurement-sample.ts` returns **nothing**.
Generated types exist (`certify.d.ts`); no call site does. The
`productionBatchId` parameter at `measurement-sample.ts:237,337,416` is a
pre-wired seam with **zero callers** — every measurement sample noma has posted
carries `production_batch_id: null`. `measurement_location_id` is likewise
hard-coded `null`.

### 7.2 `credit_batches` is the ready-made local Production Batch, minus three fields

`src/db/schema/credits.ts:31-207`. ADR 0016 already names the credit batch "the
protocol production batch" (cited in `src/db/schema/production.ts:210-213`).
Membership is `credit_batch_production_runs` with a unique on `productionRunId`
— a production run belongs to at most one credit batch.

Against `CreateProductionBatchRequest`: `facility_id` ✓ (`facilityId`);
`feedstock_type_ids` **partial** (single `feedstockTypeId` vs a wire **array**,
so blended-feedstock batches have no representation); `started_at`/`ended_at` ✗
(derivable from member runs, not stored); `mass` ✗; `supplier_reference_id` ✗
(no external-ID column, no provider column).

### 7.3 The three-sample grain: current code is closer than it looks

The brief's fixed decision is one remote MeasurementSample per local Sample.
Current code does something different, and the distinction matters:

- **1000-year path** — `build1000YearSequestrationSample`
  (`measurement-sample.ts:430`) emits **one** MeasurementSample whose `values[]`
  repeats `CARBON_CONTENTS` and `S_FRACTION` **once per replicate**. Since each
  value mints its own datapoint, this **preserves `num_samples = |s_fraction|`**
  at the datapoint level. The in-file comment at `:367-370` shows this was
  deliberate: *"NEVER a pre-reduced mean/−SE/cap (collapsing to one
  aggregate → n=1 → massive over-penalty). The registry owns the reduction."*
- **200-year path** — the batch-chemistry builder pools to `content.mean` /
  `content.stdDev` (`:222`, `:262`), one value per property. Because the
  200-year formula uses `mean(h_c_molar_ratios)` with **no √n term**, this is
  numerically equivalent to sending replicates. What it loses is **replicate
  provenance**, which Ag Soils §3.4.1.1 and §3.5 require as evidence.
- The supplier-ref doc comment (`src/lib/isometric/measurement-samples.ts:132-138`)
  still describes the production-batch role as *"one measurement sample per
  credit batch carrying its pooled mean + std-dev"* — accurate for the 200-year
  path, stale for the 1000-year one.

**Observation, not a design:** the gap between the brief's decision and the code
is about **record grain** (three `mts_` records vs one), not about **datapoint
cardinality** (already three on the 1000-year path). Per §3.1, the calculation
binds datapoints and never samples, so both shapes satisfy the blueprint
arithmetic. Three separate records buy per-replicate `measured_at`,
`supplier_reference_id`, and independent correction granularity; one record with
repeated values buys fewer round-trips. That trade-off is a design decision for
the implementation plan, and it should be made explicitly rather than inherited.

### 7.4 `samples` already stores what the protocol requires

`src/db/schema/production.ts:198-205`. The schema header comment records *"Minimum
3 samples per production batch required"* and Method A/B cadence. `creditBatchId`
is the primary link (DB FK added by migration 0057; no Drizzle `.references()`
to avoid a circular import). The payload covers carbon, elemental, proximate,
physical, H/C and O/C ratios, heavy metals, contaminants. The local model is
ahead of the wire, not behind it.

### 7.5 `certification_submissions` is the right home for the correction ledger

`src/db/schema/certification.ts:431-492` already provides versioned external
IDs, `payloadSnapshot`, `payloadHash`, and a `draft | submitted | accepted |
rejected | superseded` state machine, with a unique on (entity, version).
`submissionType` is free-form text, so a `productionBatch` type needs **no
schema change**. This directly compensates for the documented "no version
history via API" guarantee, and the repo has independently converged on the
pattern §5 recommends: versioned supplier refs
(`nm-mts-<removalHash>-pb-<batchHash>-v{n}`), journal-first reconciliation
(`durability-measurement-samples.ts:354-430` reads `payloadSnapshot` before
touching the registry), and "ask support to check the registry record" as the
terminal path (`:395`, `:401`).

`findMeasurementSampleBySupplierRef` (`measurement-samples.ts:176-186`) is the
client-side compensation for the missing filter, and it is exactly the unbounded
scan §5 flags — `for await … client.paginate("/measurement_samples")` with no
early termination, at a 50-item page cap.

`patchMeasurementSampleSourceBindings` (`:250-294`) despite its name PATCHes the
**minted datapoints**, not the sample — its own comment explains *"Measurement-sample
POSTs mint their Datapoints server-side, so the Inventory Source can only be
attached after reading the response."* This empirically confirms the §3.4 cascade
concern **and** means the repo is already exercising the source-on-locked-datapoint
path whose documented status is the report's top open question.

### 7.6 The telemetry seam is complete; its input is orphaned

`certifier_sensors` (`certification.ts:178-221`) enforces one sensor per reactor
per measurement property, and `submit-telemetry.ts` implements the documented
Isometric flow (sensors → file-upload → signed PUT → data-upload-submission)
with a local supersede ledger. **The gap is upstream: it has no rows to send.**

- The mounted operator flow stores the readings CSV **opaquely** as a
  `sensor_data` document (`production-readings-field.tsx:42-50`: *"noma stores
  the original CSV unchanged and does not inspect its contents"*).
- A canonical row-level table exists — `productionRunReadings`
  (`production.ts:152-195`) with a unique on `(productionRunId, timestamp)`
  backing an idempotent import. ⚠️ **Its header cites *"Isometric Protocol:
  Appendix II Monitoring Plan"*, and no such appendix exists.** Adversarial
  verification of protocol **v1.1.1 and v1.3.0** found exactly one appendix in
  each — "Appendix 1: Risk of Reversal Questionnaire". The comment dates to the
  initial commit (`d8fe5bb5`, 2026-02-09), five months before the v1.2→v1.1
  re-pin, and `docs/archive/260213-adjustments.md` compounds it by asserting
  Appendix II mandates 1-minute syngas flow. **Treat the citation as unsupported
  and correct it; do not treat it as evidence that row-level readings are
  required.**
- A full RFC-4180 parser and importer exist but are **self-declared orphaned**
  (`src/lib/production-readings/readings-csv.ts:1`: *"Orphaned: no mounted
  operator entry point"*), as are `src/fn/production-run-reading-imports.ts:3`
  and `src/components/production-run-readings/index.ts:1`.
  `useImportProductionRunReadings` has zero consumers.
- `submitTelemetry` reads only `productionRunReadings`
  (`telemetry-readings.ts:42-67`); **in practice its only writer is the seeder**
  (`seed-data.ts:1076`).

**Consequence:** an operator can upload every readings CSV correctly, satisfy the
`readingsCsv` certify-field requirement, and `submitTelemetry` will still fail
with *"No reactor readings fall inside this Removal's reporting window."* On a
seeded dev database it appears to work, which masks the gap. This is documented
deliberately at `docs/open-questions.md:644-658`. Note also the format step: the
operator surface accepts **CSV**, the Isometric contract requires **Parquet**
with aggregation columns, and `src/lib/isometric/parquet/writer.ts` bridges only
from the canonical table.

Whether to close this is downstream of Blocker 3 — Route A would not need
row-level readings at all, Route B would.

### 7.7 The two durability paths declare the same measurement two different ways

Found while verifying §3.3 against the transformer, and **not** previously
recorded anywhere. In `src/lib/isometric/transformers/measurement-sample.ts`,
total carbon content is declared with a different `quantity_kind` depending on
the durability path:

| Constant | Line | `quantity_kind` | `qualifier` | Path |
|---|---|---|---|---|
| `CARBON_CONTENTS_MEASUREMENT_PROPERTY` | 380 | `mass_fraction_dry_basis` | `total_carbon` | 1000-year |
| `TOTAL_CARBON_MEASUREMENT_PROPERTY` | 149 | `mass_fraction` | `total_carbon` | 200-year |
| `INORGANIC_CARBON_MEASUREMENT_PROPERTY` | 156 | `mass_fraction` | `total_inorganic_carbon` | 200-year |

The published Production-batch catalogue publishes **both** bases — `Total Carbon
mass fraction (dry basis) | MASS_FRACTION_DRY_BASIS | TOTAL_CARBON` **and**
`(wet basis) | MASS_FRACTION_WET_BASIS | TOTAL_CARBON`, likewise for
`TOTAL_INORGANIC_CARBON`. So the 1000-year constant matches a published property
and the 200-year pair's plain `mass_fraction` matches **neither**. The 200-year constants carry an in-file warning that they
are *"the most likely shapes but are UNCONFIRMED"* and the 200-year path is
fail-closed, so this is **not a live defect** — but it is now resolvable against
the catalogue rather than left to a coverage check.

The declared units diverge the same way: `CARBON_CONTENT_UNIT` and
`CARBON_CONTENTS_UNIT` are both `"dimensionless"` (with a %→fraction scale
applied before send), while the catalogue publishes `mg/kg` for
`total_carbon_contents` / `inorganic_carbon_contents`. Per §3.6 the **live
template**, not the catalogue, governs what to send — so this needs a template
inspection to settle, not a catalogue-driven edit.

### 7.8 Corrections owed to `facility-production-data-api.md`

That doc's API-contract claims were re-checked against the live OpenAPI and hold
up, including `production_batch_id` being optional and the Production Batch
required-field set. Three amendments are owed when it is next revised:

1. Its §3 measurement-type table lists `pyrolysis_reactor` without noting that
   **no property catalogue is published for it** — the single fact that blocks
   implementation of that slice. The wire contract is genuinely unpublished, not
   merely unresearched.
2. Its §7 Q5 lists **Monitoring Submissions** as a live candidate route. On
   first-party evidence (storage-monitoring guide scope plus the absent facility
   field on `ProjectMonitoringRequirement`) it can be demoted, pending RM-8.
3. It states the Biochar time-series lane "cannot be assumed to satisfy" the
   protocol. The sharper statement is available: with **no flow-rate property
   published**, Route B is provably incomplete for a §9.2.2
   continuous-instrumentation project.

### 7.9 Cross-cutting

Provider-awareness is inconsistent: `certifier_projects` and `certifier_sensors`
carry a `provider` enum, while `feedstock_types.isometricFeedstockTypeId`
(`feedstock.ts:87`) hard-codes the vendor in the column name and is
single-valued against an array-typed wire field.

`certifier_projects.externalFacilityId` (`certification.ts:124`) is sound: a
partial-unique index prevents cross-org squatting, `withExternalFacilityConflictGuard`
(`src/data-access/certification.ts:189-320`) enforces it, and `submit-telemetry.ts:115-116`
already fails closed without it. The facility half of a Production Batch payload
is therefore already available; **no production-batch identity mapping exists.**
