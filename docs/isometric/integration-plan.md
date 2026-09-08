# Isometric Certify Integration Contract

> **Current state.** This document describes the integration implemented in the
> repository. Dated implementation history belongs in
> [`changes.md`](./changes.md); historical decisions belong in
> [`docs/adr`](../adr/); unresolved decisions belong in
> [`docs/open-questions-isometric.md`](../open-questions-isometric.md).

## Boundary

noma compiles operational data into Isometric GHG Entries (called Removals in
the noma UI), reconciles those entries into GHG Statements, mirrors supporting
evidence as Sources, and can prepare a controlled GHG Statement report.

Provider-neutral persistence is in `src/db/schema/certification.ts`. Pure
Isometric HTTP/types/transformers are in `src/lib/isometric/`. Authenticated
orchestration is in `src/fn/certification/`.

Interactive Removal and GHG Statement submission uses
`POST /api/certification/submissions` as a thin NDJSON transport over that
orchestration layer. The route completes organization authentication, Admin
authorization, request validation, and per-user rate limiting before opening a
stream. The stream reports real orchestration checkpoints; it is not a
background-job boundary. A 15-second transport ping keeps a healthy, quiet
submission distinguishable from a stalled connection; clients ignore pings and
time out after 60 seconds without stream data. Disconnecting does not
deliberately cancel the core, but a serverless runtime may stop it after the
response is gone. Refresh or retry is safe because the submission ledger
reconciles incomplete local state idempotently. The non-streaming server-action
wrappers remain compatibility/fallback entry points over the same cores, with
guards and rate-limit keys kept in sync with the route.

## Credentials and authorization

Application credentials are not environment-only:

- each organization stores one Isometric access token and client secret in
  `certifier_credentials`;
- both values are encrypted through `src/lib/crypto/secrets.ts`;
- Owners/Admins manage their active organization's credentials through
  `src/data-access/certifier-credentials.ts`;
- application calls construct an organization-specific client with
  `getIsometricClientForOrg(organizationId)`;
- environment credentials are retained only for scripts and dedicated health
  checks through `getIsometricClientFromEnv()`.

External certification writes require organization Admin authorization. This
includes Removal submission, telemetry submission, GHG Statement create/submit,
generated-report preparation/approval, Source mirroring, and mapping changes.
Data access is organization-scoped and resolves the facility from trusted
lineage. Fine-grained “user may access facility X inside this organization”
membership does not exist; that narrower authorization question remains open.

The local New Removal grouping step writes no registry resource. It is
organization/facility-scoped, re-derives selected-batch health on the server,
and locks membership during creation. The later registry submission is
Admin-only.

## Facility and project mapping

Each facility has a provider-aware `certifier_projects` mapping containing the
external project, default GHG-entry template, protocol metadata, and the
external facility ID (`fcl_…`). The facility ID is required: production-batch
registration (issue #630) submits against it, and telemetry uses it too.
Adopting it for the first time (null to a value) is allowed even when the
facility already has submissions; changing or clearing an established facility
ID, or rebinding the project, still requires superseding those submissions.
Several noma facilities may share one Isometric project.

There is no Certify facilities-list operation in the committed API surface.
Operators therefore paste the external facility ID created in the Isometric UI.
Project and template choices are read from the API and validated against the
organization-specific connection.

## New Removal workflow

The current workflow is:

1. Select ungrouped, ready credit batches for one facility.
2. Rebuild each batch's health from current lineage and facility facts.
3. Create one local `certifier_removals` row and assign the selected batches
   atomically.
4. Compile the live template, ordinary Datapoints, durability bindings,
   reporting window, evidence plan, warnings, and semantic hash.
5. Present the compilation for operator review.
6. On Admin confirmation, rerun preflight, materialize generated evidence
   ledgers, mirror required Sources, recompile, claim the submission ledger,
   create/reconcile Datapoints and durability measurements, create/reconcile the
   GHG Entry, ensure Production Batches then Storage Locations then Biochar
   Applications, and verify Source bindings.

The submission scope is the applied-mass-scoped union of production lineage for
all member credit batches. Lineage and credit-batch roll-ups come from
`src/data-access/credit-batch-accounting.ts`; submission code must not recreate
that accounting independently.

An unchanged submitted Removal can be reopened and recompiled. The same
review/readiness gates apply. An unchanged semantic payload reuses the existing
registry version; changed reviewed data, mappings, or evidence create a
superseding version.

## Reporting window

`completed_on` is the latest application date across the Removal's lineage and
fails closed when no application exists. `started_on` currently uses the
earliest production start. The pinned protocol says the Reporting Period begins
with feedstock sourcing, so the start boundary is a known implementation gap
and must not be described as conformant.

Cross-period allocation follows the recorded front-loading interpretation:
production-side emissions attach to the earliest applicable GHG Entry for the
batch; later-period entries carry their delivery emissions and applied-mass
storage claim.

## Biochar Applications and storage sites

Removal preflight freezes one Biochar Application intent per immutable
Application by credit-batch allocation slice. Submission first confirms all
referenced Production Batches, then each reusable project-scoped Storage
Location, then creates or reconciles the Biochar Applications in the configured
Isometric environment. Multiple Applications may share a Delivery subject to
the existing allocation and capacity rules.

When a registered Storage Location GET returns 404, explicit **Check again**
and Removal submission recheck under the site/project locks, reconcile the
unchanged stable supplier reference, and adopt an exact replacement or create
one if absent. Recovery replaces only the external ID; the local Application,
customer location, and submitted site snapshot remain. Changed local facts,
live remote mismatches, duplicate matches, and inconclusive reads fail closed
or retain the existing drift review. Authentication and transient errors never
establish absence. Lost POST responses and persistence failures reconcile by
reference before retrying creation.

Biochar Application journals retain their original dependency IDs and payloads.
Replacing a Storage Location marks dependent claims for review atomically,
including unconfirmed claims whose POST may already have reached Isometric.
Those stale claims block Removal submission with a dependency-specific error;
recovery does not silently repoint confirmed history. New, unclaimed Biochar
Applications use the replacement. Biochar Application creation holds the same
external-project lock and rechecks the storage registration before using it.

For the provider request, `truck_mass_on_arrival` is exactly the slice's
allocated wet kg and `truck_mass_on_departure` is zero kg. These fields encode
the applied slice mass convention, not Delivery weighing observations.
Commingled slices partition and sum to the physical Application total.

Each slice uses the ordinary local idempotency journal. Noma claims the exact
payload and stable supplier reference before POST, reconciles unconfirmed
orphans across bounded list pages, reads confirmed retries by their persisted
external identity, and fails closed on payload or identity drift. Isometric's
provider-managed `ghg_entry_id` and `removal_id` may both remain null on a fully
persisted Biochar Application; null is accepted and recorded, while any present
association must match the current GHG Entry. The journal row and supplier
reference are versioned by immutable Removal submission: supersession creates a
fresh Biochar Application for the new GHG Entry and leaves the prior registry
artifact intact. The documented provider response omits
`source_ids` on both create and GET, and no REST endpoint exposes the reverse
link. The accepted create request is therefore the attachment contract: a
readback without `source_ids` is not drift. Returned Source IDs, when a response
does include them, must match the exact reviewed set. The immutable local intent
and submission snapshot retain the IDs sent. Authoritative readback through the
GraphQL `BiocharSpreadEvent.biocharSpreadEventSources` field is tracked in
issue #737. Registry failure
blocks Removal submission and leaves the claim safely retryable. There is no
gate or placeholder lifecycle.

## Deleting a never-finalized Removal

Deletion removes draft GHG Entries first (a registry refusal stops all cleanup),
then Biochar Applications, exact version-owned MeasurementSamples, and unshared
Production Batches. Measurement ownership comes from immutable durability
submissions and their journal, with exact supplier-reference reconciliation for
interrupted POSTs. Legacy snapshots without measurements remain deletable;
inconsistent identities fail closed. This never deletes local credit batches,
production lineage or lab samples.

Batch candidates come from the Removal's application-by-credit-batch membership,
including failures before Biochar Application creation. Other memberships,
registrations, immutable submission references and production-claim reservations
retain shared batches and their journal. Every deletion claim stores a lease on
the Removal, including Removals without submission ledger rows. Membership
creation checks that lease under the credit-batch locks; submission creation and
resume check it under the artifact lock. Abandoned leases expire with the shared
submission lock TTL. Release and finalization compare the claim timestamp so an
older caller cannot release or finalize a replacement claim. Sharing is checked again after
registry readback and during finalization. Registry child-reference enforcement
remains the final guard against an already-running concurrent child POST;
production-batch recovery handles disappearance before that POST on retry.

Only confirmed remote deletion or absence permits exact, organization-scoped
journal removal, after the owning Biochar Application journal rows are removed.
The retained ledger records deleted, absent and retained artifacts. A partial
failure releases the claim and keeps local state retryable; it never reports
completed cleanup. Auth/network errors and generic 400s fail. A 404 or the exact
provider missing-resource 400 for the addressed batch or measurement is absence.

## Template and input contract

The live template is read at compilation time. Every monitored ordinary input
must resolve through `INPUT_MAPPING` in
`src/lib/isometric/transformers/datapoint.ts`, and every durability component
must have an explicit supported binding. Unit, quantity-kind, component-name,
tier, and scope conflicts fail before a registry write.

### Energy

Production energy uses:

- `pyrolysis / grid_electricity_use / electricity_use` for total grid kWh;
- `Generator diesel usage`, a
  `pyrolysis / fuel_usage_by_volume / volume_of_fuel` component receiving
  generator plus preprocessing litres;
- `Startup diesel usage`, another component with the same tuple receiving
  reactor-startup/plant litres.

The two diesel components share a registry-fixed lifecycle factor. noma does
not convert litres to kWh and does not submit or store that factor. The display
names are currently the component discriminator; an unknown or renamed diesel
component fails closed.

### Safety margin

`Safety margin` is the only named Removal-scope exception under
`miscellaneous / mass_based_ci_emissions / mass`. noma supplies the same dry
biochar mass used by the storage claim. The carbon-intensity Datapoint and its
justification are registry-owned fixed configuration. Other miscellaneous
emission inputs remain PROJECT-scope and trip the scope guard if placed in a
Removal template.

### PROJECT-scope emissions

Staff travel, direct pyrolyzer gases, storage fuel, lab electricity, sampling
consumables, and other period/LCA overhead are authored as PROJECT-scope
components in Isometric where applicable. noma keeps no project-emissions
journal. The transformer guard prevents these tuples from being silently
submitted as Removal-scope zeroes.

## Durability paths

The facility declares one durability tier. Compilation verifies the template's
sequestration blueprint against that tier.

### Sampled 1,000-year path

The sampled 1,000-year path is implemented for the Isometric sandbox:

- every member batch must have at least three complete replicates;
- paired total-carbon, directly measured inorganic-carbon, and reflectance
  fraction values are created through a measurement sample;
- `s_fraction` binds the measurement sample's
  `dimensionless_ratio/inertinite_fraction` response Datapoints, while
  `product_mass` is created as a standalone direct Datapoint;
- the component input table binds `total_carbon_contents`,
  `inorganic_carbon_contents`, and `s_fraction` as lists and `product_mass` as
  a scalar on `biochar_sequestration_1000_year_f_durable_max`;
- the component calculates organic carbon per replicate as total minus
  inorganic, calculates the binomial lower durability estimate, and caps it at
  0.95;
- noma exposes the raw and capped calculation only as an explanatory preview
  and evidence record;
- the registry computes the credited result.

The deprecated `biochar_sequestration_1000_year` remains readable as legacy
total-carbon/uncapped history but is rejected for new template configuration and
submission builds. Production remains blocked. External confirmation and
sandbox-template migration are still required before end-to-end verification.
The Protocol v1.1, Agricultural Soils module v1.1, and Standard v1.7 pins do not
change with this component migration.

### 200-year path

The measurement properties, aggregation, builders, and evidence-ledger format
exist, but the H/C unit transform and complete explicit input binding are not
confirmed. The path therefore fails closed even in sandbox. It is not a live
submission path.

### Method B

The local production-process prerequisites and immutable unsampled-batch choice
are implemented. The registry representation for an unsampled durability claim
is not confirmed, so no production-live Method-B submission is claimed.

## Sources and evidence

Source attribution is target-specific, not Removal-wide.

`src/lib/certification/removal-source-bindings.ts` classifies operator
documents and generated evidence ledgers into an immutable plan of exact
component/input targets:

- feedstock bill of lading to feedstock transport `mass_distance`;
- delivery bill of lading to biochar transport `mass_distance`;
- delivery receipts and photos remain retained Delivery documents and do not
  bind to sequestration inputs;
- application-boundary inventory/logbook evidence to sequestration
  `product_mass` and, when present, safety-margin `mass`;
- generated transport ledger to the transport inputs present in the template;
- generated durability ledger to the tier-specific durability inputs.

Confirmed Application-owned photos, PDFs, weighbridge tickets, and affidavits
are also mirrored as Sources and attached to each corresponding Biochar
Application through its `source_ids`. GIS boundary uploads remain local: noma
does not mirror them until the Application stores an explicit active-boundary
document identity, so replaced or historical boundaries cannot be submitted.

A draft retry reuses the exact operator-evidence tuple stored in its immutable
submission snapshot. Submitted and accepted Removals keep that frozen operator
evidence on a superseding claim while current deterministic transport and
durability ledgers are regenerated and attached. Evidence added later requires
a new Removal or a future amendment workflow; a rejected or superseded attempt
that has no live claim rebuilds from current evidence.

The plan and mapping revision are hash-covered in the submission snapshot.
After GHG-entry creation, noma follows component attributions to Components and
Datapoints and verifies that every planned Source is attached to its intended
target. Missing registry propagation is recorded as awaiting sync; a true
mismatch requires resubmission.

Generated transport and durability ledgers are created after side-effect-free
preflight and before Source mirroring. Generation failure blocks submission.
Remote Sources are never deleted because submitted snapshots depend on their
IDs.

## GHG Statements and generated reports

GHG Statements are facility-scoped local artifacts backed by Isometric
statements. Creation adopts one exact pre-existing draft for the requested
project/period; ambiguous matches fail closed. Membership reconciliation never
steals a Removal from another local statement.

Submission requires at least one registry-linked GHG Entry and organization
Admin confirmation. noma can use either:

- an approved generated report, or
- a controlled external report URL.

The generated report workflow is:

1. Load the live statement and each live GHG Entry.
2. Build a data-only report model and source fingerprint.
3. Render and store an immutable PDF version.
4. Require explicit Admin approval.
5. Rebuild the fingerprint at submit time and reject stale reports.
6. Mint a verifier capability URL, submit/resubmit the statement, and mark the
   report version submitted only after success or successful reconciliation.

The generated PDF contains identifiers, dates, membership, registry-calculated
totals, and document-control metadata. It does not claim qualitative
methodology, evidence sufficiency, exception resolution, or human review.

## Idempotency and reconciliation

`certification_submissions` is the lock, immutable snapshot store, and version
ledger. `certifier_sync_events` is the attempt/audit stream.

For resources with a caller-controlled supplier reference, the contract is:

1. Canonicalize and hash the semantic payload.
2. Claim the latest local ledger row under the mapping/ledger locks.
3. Return the existing external ID for the same completed hash.
4. For a stale same-hash attempt, look up the remote resource by supplier
   reference before retrying the POST.
5. For changed reviewed inputs, create a new local/remote version rather than
   mutating the historical snapshot.
6. Persist remote status and reconciliation facts without logging credentials
   or PII.

This pattern covers Removal/GHG Entry, Datapoint, Source, measurement-sample,
and GHG Statement creation where the remote API supports the necessary lookup.
`claimSubmissionDraft` in
`src/data-access/certification-submissions.ts` is the internal Postgres-backed
claim seam.

Telemetry follows ADR 0006 because FileUpload/DataUploadSubmission has no
supplier-reference discovery contract. It journals FileUpload ID, signed URL
expiry, upload facts, and DataUploadSubmission ID into `payloadSnapshot` and
resumes from those stored IDs where possible.

## Telemetry status

The server-side Slice A pipeline is implemented:

- creates/reconciles sensors;
- writes the Parquet payload;
- `POST /file-uploads`;
- uploads bytes to the signed URL;
- `POST /data-upload-submissions`;
- reads `/data-upload-submissions/{id}` for status;
- journals step IDs and uses mapping locks.

Production-run readings are now stored as unchanged `sensor_data` CSV
documents, and the upload UI does not populate row-level readings.

The UI is not live. `TelemetryPanel` and its hook exist, but the panel is not
rendered on any current route. There is no usable “Submit Telemetry” button in
the application. Treat the pipeline as implemented but dark until it is
re-homed and revalidated against the sandbox.

## Operational checks

- `pnpm isometric:coverage-check -- --source=fixture` validates checked-in
  template fixtures against ordinary, durability, diesel-name, safety-margin,
  and PROJECT-scope guards.
- `pnpm isometric:coverage-check -- --source=db` inspects configured facility
  templates when credentials/database access are available.
- `.github/workflows/isometric-health.yml` performs the repository's scheduled
  sandbox/type/coverage health checks.
- [`openapi-index.md`](./openapi-index.md) is the call-site-owned inventory of
  the committed generated Certify surface.

Do not use generated operation counts as a freshness signal. A green check
means only that the checked contract still matches its source, not that an
unimplemented protocol requirement has been satisfied.
