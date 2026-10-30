# Isometric Certify integration contract

Read this for the invariants around Removal submission, evidence, retries and
GHG Statements. Code ownership is indexed in [README](./README.md); API limits
and dated observations live in [registry behavior](./registry-behavior.md).
This is an implementation guide, not registry approval. Code checked 2026-10-30;
external observations retain their original dates.

## Authorization and mapping

Application calls use organization-scoped encrypted credentials through
`src/data-access/certifier-credentials.ts:resolveIsometricClient`.
Environment credentials in `client-env.ts` are for scripts and health checks.
External certification writes require organization Admin authorization; local
Removal grouping does not. Resolve facility scope from trusted lineage, never
from a client-supplied facility ID. Intra-organization facility membership is
still an [open decision](../open-questions-isometric.md).

A facility maps to a project, template and external facility ID. Several
facilities may share a project. First adoption of an external facility ID is
allowed with existing submissions; rebinding an established identity requires
superseding the affected submissions. Operators obtain the facility ID from
Certify because the committed API has no facilities-list operation.

## Removal scope and submission

A Removal assigns unassigned **Application by credit-batch slices**, not entire
credit batches. Later applied slices of the same batch can join another Removal.
The 1,000-year grouping path selects one credit batch. Canonical lineage and
roll-ups come from `src/data-access/credit-batch-accounting.ts`; do not rebuild
accounting in submission code. Attribution is defined by
[ADR 0020](../adr/0020-production-emissions-front-loaded-per-credit-batch.md).

Compilation reads the live template and builds inputs, evidence targets, warnings
and a semantic hash. Admin confirmation reruns preflight, generates evidence,
mirrors Sources, recompiles and claims the submission ledger. Registry creation
then confirms Datapoints and measurements, the GHG Entry, Production Batches,
Storage Locations and Biochar Applications, followed by Source verification.
Read `src/fn/certification/submit-removal.ts` for ordering and recovery.

Batch context construction loads canonical roll-ups together before deriving
member contexts; preserve that batching when changing lineage reads.

The submission route streams actual checkpoints; it is not a background job.
Authentication, Admin authorization, validation and rate limiting precede the
stream. Disconnects may interrupt serverless execution. Refresh/retry recovers
through the ledger; it does not establish that the registry write failed.

### Reporting window

Dates use facility calendar days. Completion is the latest Application date and
requires an Application. Start currently uses earliest production start, not
feedstock sourcing. This is a known gap against the historical pinned protocol
interpretation, not a conformant reporting boundary. See
`src/fn/certification/removal-reporting-window.ts` and the
[requirements shortlist](./requirements-shortlist.md).

## Immutable versions and evidence

`certification_submissions` records claims, semantic hashes and immutable
snapshots. Same-hash retries reuse confirmed identities or reconcile by stable
supplier reference before creating. Changed reviewed inputs create a superseding
version. See `src/data-access/certification-submissions.ts` and
`src/fn/certification/registry-create.ts`.

A draft retry keeps its frozen operator-evidence tuple. Submitted and accepted
Removals retain that evidence on supersession while deterministic ledgers are
regenerated. Later uploads require a new Removal or a future amendment workflow;
a rejected or superseded attempt with no live claim rebuilds from current evidence.

Sources target exact inputs through
`src/lib/certification/removal-source-bindings.ts` and the semantic catalog.
Do not attach every Source to every Datapoint. Entry files target their frozen
contribution inputs; recorded zeros contribute no files. Lab Sources stay
sample-specific. Source descriptions are server-derived from the evidence role
and owning records, not an unimplemented free-label field. Mirrors read managed
objects directly through the storage provider; large files still buffer in
memory. See `src/fn/certification/sources-transfer.ts`.
Post-submit verification follows component attributions and
Datapoints; propagation delay and a true mismatch are different outcomes.

Each Delivery needs uploaded proof before submission, regardless of template
transport categories. The accepted classifications are owned by
`src/lib/certification/delivery-evidence.ts`. Application evidence health is
informational and is a separate rule. Confirmed Application-owned photos, PDFs,
weighbridge tickets and affidavits also attach to Biochar Applications. GIS
uploads remain local until an explicit active-boundary identity is supported.

## Storage Locations and Biochar Applications

Preflight freezes one Application intent per allocation slice. Its arrival mass
is the slice's wet kg and departure mass is zero. These are an applied-mass
encoding, not truck weighing observations. Commingled slices must sum to the
physical Application total.

A confirmed missing Storage Location is recovered under the site/project locks
by stable-reference reconciliation before creation. Only its external ID changes.
Auth errors, transient failures, duplicate matches and contradictory reads do
not prove absence. Existing Biochar Application claims keep their old dependency
IDs and become `review_required`; recovery never silently rewrites history.
See `src/fn/certification/storage-locations.ts` and
`src/data-access/certifier-storage-locations.ts`.

Biochar Application journals claim immutable payloads before POST and use
version-specific references on supersession. Confirmed retries read by saved
external ID. Absent provider GHG Entry associations are accepted; present ones
must match. Evidence readback uses GraphQL because REST omits the Source IDs.
The [registry behavior record](./registry-behavior.md) describes the filter trap;
the peer-owned query correction and full staging retest remain pending.

Empty expected Source sets are not checked; confirmed checks are reused. For
nonempty expected sets, a wrong or malformed readback blocks submission. Empty
readbacks get propagation retries before becoming a mismatch. An unavailable read persists `unconfirmed`
and a warning; it must never clear a previous mismatch. Summary refresh rechecks
a bounded number of unconfirmed/mismatch registrations without failing the whole
summary. See `src/fn/certification/biochar-application-source-readback.ts`.

## Templates and durability

[Sandbox template authoring](./sandbox-template-authoring.md) owns the compatible
storage shapes, validation commands and support boundaries. Reviewed contracts
keyed by component ID determine automatic sources and emissions-entry support.
Display names confer no binding authority. Establishment/end-of-life stay at
project scope; missing operating inputs need records, entries or an explicitly
confirmed zero. See [ADR 0032](../adr/0032-per-batch-emissions-entries-bound-to-template-lines.md).
Fixed factors and their justification remain registry-owned.

## Deletion and reports

Deleting a never-finalized Removal deletes the draft GHG Entry first; refusal
stops cleanup. Further cleanup removes Biochar Applications, exact version-owned
measurements and unshared Production Batches. Live snapshot
references retain shared artifacts. Datapoints and shared Storage Locations
remain. Local production lineage, credit batches and Samples are never deleted.
Ownership and sharing must be rechecked under the deletion locks at each remote
mutation; a partial failure before finalization leaves local state retryable.
After local finalization, released Sources are deleted best-effort. A refusal
is audited and leaves that Source behind while Removal deletion succeeds; it
does not leave a Removal available for a Source-cleanup retry. See
`src/fn/certification/delete-removal.ts` and
`src/data-access/certifier-removal-deletion.ts`.

GHG Statement creation serializes the overlap check and registry creation under
the organization/facility certification boundary lock. It adopts only one exact
draft for the project/period and
never steals another statement's Removal. Submission requires linked GHG Entries
and either an approved immutable generated report or a controlled external URL.
Generated reports contain registry facts, not methodology or human-review claims.
A refreshed source fingerprint must still match at submission. See
`src/fn/certification/ghg-statement-reports.ts`.

## Reactor time-series upload

The unchanged Readings file is the retained pressure/temperature evidence on each
production run. Readiness checks file presence independently of parsed readings;
noma does not check file contents. There is no reactor time-series submission.
The optional row importer is a separate operational path. See
[project monitoring](./requirements-shortlist.md#project-reactor-monitoring) and
[ADR 0006](../adr/0006-data-upload-submission-idempotency.md).
