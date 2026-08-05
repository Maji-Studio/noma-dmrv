# Isometric production-data follow-up research brief

## Objective

Resolve the remaining first-party Isometric contract questions needed to design
the facility's Production Batch, Production batch sample, and reactor-monitoring
sync. This is research only: return evidence-backed implementation guidance and
explicitly preserve unresolved questions where Isometric has not published an
answer.

Read first:

- [`docs/isometric/README.md`](../isometric/README.md) and its pinned
  [`versions.json`](../isometric/versions.json)
- [`docs/isometric/facility-production-data-api.md`](../isometric/facility-production-data-api.md)
- [`CONTEXT.md`](../../CONTEXT.md), especially Credit batch, Sample, Replicate,
  Production process, and Method A / Method B
- the current Certify integration seams named below

Call the Isometric MCP `how_to` tool first if it is available. If it is not
available, state that limitation and continue with the primary sources below.

## Fixed project decisions

These are inputs to the research, not questions to reopen:

1. One noma **credit batch** maps to one Isometric **Production Batch**.
2. `production_batches.mass` has an **unknown mass basis**. Keep it open. Do
   not choose wet produced mass, dry produced mass, or applied dry mass without
   explicit first-party Isometric evidence.
3. Use **THREE independent Samples per Production Batch**. Preserve one local
   Sample record and create one remote MeasurementSample for each independent
   Sample. Do not collapse the three into one aggregate remote sample.
4. The reactor-monitoring submission route is **unknown**. Keep it open. Do not
   choose MeasurementSamples, Parquet time-series, Monitoring Submissions, or a
   combination without explicit first-party Isometric evidence.
5. The current project uses one manually managed Isometric facility. Retain the
   provider-aware external facility mapping; do not hard-code the sandbox ID.

The research must verify how the live GHG-entry template binds and calculates
across the THREE remote MeasurementSamples. It may recommend aggregation only
inside an Isometric calculation/template when the first-party contract requires
it; it must not replace the three source sample records with one remote record.

## Research questions, in blocker order

### 1. Production Batch mass basis

Determine what physical quantity and basis Isometric expects in
`POST /production_batches.mass` for a Biochar Production Batch:

- produced wet biochar mass;
- produced dry biochar mass;
- dry biochar mass ultimately applied; or
- another explicitly defined quantity.

Cover partial application across reporting periods, unit expectations,
uncertainty/`standard_deviation`, and whether the Production Batch retains its
full produced mass when only part is credited. If the sources do not answer,
record the gap and produce a single precise question for Isometric support. Do
not infer the answer from local field names or the separate GHG-entry
`product_mass` input.

### 2. Binding THREE independent Production Batch samples

With three local Samples represented as three remote
`measurement_type: "biochar_production_batch"` MeasurementSamples linked to the
same `production_batch_id`, determine:

- how all three returned sample/datapoint identities are bound to the live
  GHG-entry component or blueprint;
- whether Isometric's template selects individual values, computes a mean and
  standard deviation, performs outlier handling, or expects another explicit
  calculation step;
- which properties and units must appear on every one of the three records and
  which have a different protocol cadence;
- how lab reports, raw replicate results, QA/QC, uncertainty, and Sources bind
  to the three records and their datapoints;
- how corrections/versioning work once one of the three is referenced by a
  draft or submitted GHG entry; and
- whether the three-record binding differs for Method A, Method B, 200-year,
  and 1,000-year paths.

The research may verify the binding, but it must not reopen the decision to
create three independent remote MeasurementSamples.

### 3. Reactor-monitoring submission route

Determine the project-appropriate first-party Certify route for mandatory or
conditional Pyrolysis reactor monitoring under the pinned v1.1 protocol:

- `measurement_type: "pyrolysis_reactor"` MeasurementSamples;
- Sensors plus Biochar facility Parquet time-series/DataUploadSubmission;
- Monitoring Submissions; or
- an explicitly documented combination.

For each applicable route, identify the triggering monitoring method, required
properties, cadence/resolution, units, equipment/calibration metadata, raw-data
retention, facility association, evidence/source binding, and completion/error
workflow. Resolve or explicitly escalate the current documentation tension
between the Biochar time-series enum/property table and the guide's
DAC-only wording.

### 4. Lower-priority lifecycle questions

Only after the three blockers above, establish the supported correction and
reconciliation lifecycle for Production Batches, MeasurementSamples, Sensors,
and data uploads where PATCH, filtering, or deletion is absent. Distinguish a
documented Isometric guarantee from a client-side noma recommendation.

## Facts already established; do not re-research from scratch

Use these as orientation and re-check them only when needed to resolve a blocker
or when the live specification has changed:

- The current live Certify OpenAPI publishes no Facility list/get/create/update
  API. The facility is managed in Certify and consumed downstream by ID.
- `POST /production_batches` requires `facility_id`, `feedstock_type_ids`,
  `supplier_reference_id`, `kind`, `started_at`, `ended_at`, and `mass`;
  `display_name` is optional. The published surface has create/list/get/delete
  but no PATCH.
- A Production Batch sample uses `POST /measurement_samples`,
  `measurement_type: "biochar_production_batch"`, and the remote
  `production_batch_id`. Several request properties are required but nullable.
- MeasurementSample responses return datapoint identities used by later
  evidence and calculation bindings. The list route has no published
  supplier-reference filter and the resource has no PATCH operation.
- Sensors are channel metadata for the separate time-series upload flow. The
  documented file flow is sensor registration, Parquet file upload,
  DataUploadSubmission, and terminal-status polling.
- The current first-party docs expose a tension: the time-series guide contains
  Biochar reactor properties and the live Biochar submission enum, while also
  containing DAC-only wording.
- The local domain already defines a Sample as one independently analysed
  replicate belonging to one credit batch. THREE such Samples characterize a
  sampled Production Batch for this project.

Treat the existing local research document as context, not primary evidence.

## Repository context and current seams

Inspect only what is needed to connect the researched contract to the current
design:

- `certifier_projects.externalFacilityId`: canonical manual facility mapping.
- `credit_batches`: intended local Production Batch identity and production-run
  membership.
- `feedstock_types.isometricFeedstockTypeId`: remote feedstock mapping.
- `certification_submissions`: provider-aware external IDs, payload snapshots,
  hashes, versions, and state.
- `samples`: independent per-credit-batch laboratory Samples and evidence.
- `src/lib/isometric/transformers/measurement-sample.ts`: current optional
  `productionBatchId` wire seam.
- `src/fn/certification/durability-measurement-samples.ts`: current
  removal-scoped durability representation.
- `certifier_sensors` and
  `src/fn/certification/submit-telemetry.ts`: existing sensor/upload seam.
- Current Readings file flow: the raw CSV is retained unchanged and does not
  populate the canonical row-level readings expected by telemetry submission.

Do not redesign these seams unless a cited Isometric contract makes a change
necessary. Identify contract-to-code gaps without implementing them.

## Required sources and evidence standard

Use primary Isometric sources only:

- [live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json);
- [Biochar Production and Storage Protocol v1.1](https://registry.isometric.com/protocol/biochar/1.1);
- [Biochar Storage in Agricultural Soils v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1);
- first-party [Certify guides](https://docs.isometric.com/user-guides/certify/)
  and endpoint reference pages; and
- the project's sandbox Certify UI in read-only mode when it exposes live
  template or binding behaviour not documented elsewhere.

For every conclusion, provide the exact URL, protocol/module version and
section or OpenAPI schema/operation, access date, and a short supporting
paraphrase. Clearly label:

- a documented Isometric requirement;
- an observed read-only sandbox behaviour;
- an inference;
- a conflict between first-party sources; or
- a source gap that requires an Isometric support answer.

Do not use blogs, search-result snippets, third-party SDKs, community posts, or
the existing noma research as authority. Do not mutate sandbox data. Do not
include credentials, signed upload URLs, or personal data in the report.

## Non-goals

- No application, schema, migration, generated-client, test, or UI changes.
- No facility API design or multi-facility product design.
- No choice of Production Batch mass basis without evidence.
- No replacement of the THREE independent remote MeasurementSamples with an
  aggregate record.
- No choice of reactor-monitoring submission route without evidence.
- No implementation of sensor ingestion, CSV parsing, Parquet generation,
  GHG-entry submission, or evidence upload.
- No broad re-audit of unrelated Biochar compliance requirements.
- No sandbox create, update, submit, or delete operations.

## Deliverable

Produce one concise Markdown research report suitable for
`docs/isometric/production-data-follow-up-research.md`, containing:

1. an executive decision table with `resolved`, `unresolved`, or
   `source-conflicted` status for each blocker;
2. the evidence and answer for each ordered research question;
3. a wire-level mapping for the THREE independent MeasurementSamples and their
   datapoint/source/template bindings;
4. a route comparison for reactor monitoring, without choosing an unsupported
   route;
5. a split between API-required, certification-required, conditional, and
   optional data;
6. implications for the named repository seams, without code changes; and
7. exact, ready-to-send Isometric support questions for every unresolved gap.

Keep authoritative facts separate from implementation recommendations. If a
blocker remains unanswered, say so directly rather than manufacturing a
decision.

## Acceptance criteria

- The mass basis is either resolved by explicit first-party evidence or remains
  visibly open with an exact support question; no wet/dry/applied choice is
  guessed.
- The report assumes exactly THREE independent local Samples and THREE remote
  MeasurementSamples per Production Batch and explains or escalates how all
  three bind into the calculation/template.
- The monitoring route is either resolved by explicit first-party evidence or
  remains visibly open with an exact support question; no route is guessed.
- Every material factual claim has a nearby primary-source citation and source
  classification.
- Conflicts and silence in first-party documentation are reported, not smoothed
  over through inference.
- The output distinguishes API validation requirements from certification
  requirements and conditional project choices.
- The recommendations map to the current repository seams and introduce no
  application-code changes.
- No secrets, personal data, third-party authority, or sandbox mutations appear
  in the deliverable.
