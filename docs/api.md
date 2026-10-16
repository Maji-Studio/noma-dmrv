# REST and MCP data-entry API

This guide covers REST and MCP authentication, shared operations, and resource
contracts. Read it before changing API routes, MCP tools, or their write and
read behavior.

## REST credential boundary

`/api/v1` bypasses session middleware. Private routes authenticate through
`resolveApiContext`. This privileged authentication seam reads the key's hash,
owner and live membership through `data-access/api-credential-auth.ts` before
constructing an `OrgContext`; its cross-organization lookup is explicitly
waived. Membership hooks use the same module to disable affected credentials.
Ordinary credential management keeps the action → data-access → database
flow and never trusts input organization or owner IDs. The plugin retains
hashing and verification responsibility.

`GET /api/v1/me` uses `lib/read-models/api-me.ts` → `data-access/api-me.ts`;
route handlers do not import the database. The shared REST problem builder
lives at `lib/api/problem.ts`. See [auth.md](./auth.md#api-credentials) for
credential and denial contracts.

### Lab samples on the runner

Lab sample create, update (including a move to another credit batch) and delete
run through `src/lib/operations/lab-samples.ts`; the Server Actions in
`src/fn/samples.ts` and REST/MCP share them. Every writer takes locks in one
order (`src/data-access/samples/write-scope.ts`): certification artifacts for
every lineage the write touches, then credit batches in id order, then the
sample. A transport leg whose parent is a sample takes the same scope. Lineage is
re-resolved against the artifacts held, so a Removal assigned while the writer
waited refuses the write (`certification_locked`) and no artifact is locked late.
Existence, archive state, facility, window and time zone are read from the
locked batch. Archived batches refuse create, update and move. Facility archive
locks its credit batches in id order first, matching the sample writers.
Ratios and warnings come from the merged locked row
(`src/lib/calculations/sample-ratios.ts`,
`src/lib/certification/sample-entry-warnings.ts`).
Reads (`src/data-access/api-lab-samples.ts`, `api-credit-batches.ts`) hide
samples on archived batches from lists and still serve them by id.

### Documents

Feedstocks, deliveries, lab samples and applications expose nested document
reads and upload requests at `/{owner}/{idOrCode}/documents`. Reads use the owner's read scope;
uploads and confirmation use its write scope. Files never travel in these API
bodies. POST a declaration with its SHA-256 and a required `Idempotency-Key`
(400 `idempotency_key_required` when missing), PUT the bytes to `upload.url` with `upload.headers`, then
POST an empty object or no body to `/{documentId}/confirm`. Use the upload URL
without the API key before `expiresAt`. Request returns 201 with the document
GET `Location` and ETag; confirm returns 200 with the verified document and ETag.
Neither command offers a dry run. There is no API document delete or edit.

Use the owner UUID path for safe retries after owner deletion or code changes;
the `Location` header uses that UUID. Reusing the request key on the UUID path
returns 201 with `Idempotent-Replayed: true` and the stored `data`.
Each pending replay mints a fresh upload link with a renewed
lease. An uploaded, failed, deleted, expired, archived or submitted upload
returns `upload: null` with `warnings`, preserving the historical success.

Confirm has a 25 second budget, including inspection, promotion and the database
transition, within a 30 second route duration. Missing bytes answer retryable
409 `conflict` with `Retry-After`; the document stays pending. Deadline exhaustion
answers retryable 500 `deadline_exceeded`. Submitted records refuse uploads
with 409 `certification_locked`; submission between request and confirm fails
the pending upload. Archived records remain readable but refuse new uploads.

The published owners and types are:

| REST owner | MCP `ownerType` | Allowed document types | Scopes |
|---|---|---|---|
| `feedstocks` | `feedstock` | `bill_of_lading`, `weighbridge_ticket`, `other_transport_evidence` | `feedstocks:read`, `feedstocks:write` |
| `deliveries` | `delivery` | `bill_of_lading`, `weighbridge_ticket`, `other_transport_evidence`, `delivery_receipt`, `photo` | `deliveries:read`, `deliveries:write` |
| `lab-samples` | `lab_sample` | `lab_report` | `lab-samples:read`, `lab-samples:write` |
| `applications` | `application` | `photo`, `pdf` | `applications:read`, `applications:write` |

There is no separate document scope.
The app retains its internal owner and type table. API uploads stay private.

Under `/api/v1/{owner}/{idOrCode}/documents`:

| Method and suffix | Result |
|---|---|
| GET collection | Keyset page, newest first; `documentType` and `uploadStatus` filters, default `uploaded` |
| GET `/{documentId}` | Document with a strong version and representation-revision ETag |
| GET `/{documentId}/content` | 302 to a fresh five-minute GET capability, uploaded objects only |
| POST collection | 201 upload request, required `Idempotency-Key` |
| POST `/{documentId}/confirm` | 200 confirmed document; 422 committed refusal (409 for certification_locked); 409 conflict on a repeat of a failed upload |

All reads enforce the owner and organization, including content; wrong-owner
and foreign documents return 404. Content has `Cache-Control: private, no-store`
and `Referrer-Policy: no-referrer`. Fetch the redirect without the API bearer.
There is no public-visibility fallback. Legacy URL-only documents can appear
with unknown content type and size, but have no API content link. Document
writes do not bump owner versions or change owner ETags.

MCP exposes `find_documents`, `get_document_download_url`,
`request_document_upload` and `confirm_document_upload`. Downloads return a
short-lived URL and expiry. A shell-capable client PUTs bytes separately; no
MCP tool accepts file bytes. There is no document DELETE route or tool.
A missing owner scope returns `missing_scope` in MCP, matching REST.

Blocking lineage includes draft submission attempts as well as submitted and
accepted Removal or GHG statement submissions. App upload, confirm, delete,
reclassification and visibility changes share the refusal; server-generated
ledgers and reports retain their own writers. A pending confirm that loses the
submission race commits failure and queues its objects. See
[storage lifecycle](./storage.md#abandoned-uploads-and-cleanup) for leases,
promotion and the expiry sweep.

REST problem responses expose `retryable: true` for any retryable domain error,
including missing upload bytes and a lineage that changes while locks are
acquired. MCP carries the same flag. A byte inspection refusal is 422
`validation_failed` and commits the failed state; retrying that failed row
returns 409 with its stored reason.

### Operation effects and API bookkeeping

Document upload requests use the registered `request_document_upload` operation.
Its output is the document representation, including the declared file name,
size, MIME type and SHA-256, without storage locations or signed URLs. After
both a first response and a replay, adapters call `mintDocumentUploadCapability`
outside idempotency. It renews a pending upload under the document write locks
and signs a PUT within that lease. An unavailable upload returns no link and
plain-text guidance; the historical representation stays the same.

REST and MCP confirmation share `confirmDocumentUpload`. Its client input
contains only owner type, owner id and document id. The facts-carrying runner
operation remains unregistered. Uploaded and failed retries read stored state
without storage I/O. Refusals commit before the shared `mapConfirmOutcome`
maps them to a problem: 422 `validation_failed`, or 409 `certification_locked`.
A failed retry is 409 `conflict` with the stored reason; a missing document or
owner mismatch is 404 `not_found`.

Two named exceptions apply to this state-machine command:

- **E1:** confirmation ignores `Idempotency-Key` and keeps no idempotency record.
- **E2:** confirmation takes no `If-Match` or expected version. The declaration
  is immutable and the row lock serializes its pending-to-uploaded or
  pending-to-failed transition. A supplied `If-Match` is ignored, including an
  invalid tag; confirm never answers 412 or requires a precondition.

`src/lib/operations/runner.ts:Operation` optionally supplies `describe(input,
output)`, which returns `src/lib/operation-effect.ts:OperationEffect`: outcome
code (`created`, `updated`, `deleted`), entity type and ids, versions before and
after, and changed field names. It contains no field values. The runner returns
this transport-neutral effect alongside data. A state-machine operation can
return no effect when its outcome changes no entity, so a gone confirmation
writes no activity event.

Dry-run stock writes also return `stockEffects` beside `data`. The runner supplies
an optional `OperationScope.snapshotStock` observer, passed to transaction writers.
Writers declare the affected old and new bins after their normal locks and before
the first mutation. The runner reads the balances again after execution, inside
the same transaction, and returns one before/after/delta entry per changed bin.
Real writes and the UI have no observer and pay no snapshot reads. Feedstock
wet kilograms use the existing stock derivation; dry kilograms are its
intake-moisture estimate, nullable when unavailable. Output bins use the guard's
all-layer dry balance (null for unresolved layers) and leave wet kilograms null. This contract replaces the
feedstock-create additions-only `preview` and is shared by create, PATCH and
DELETE in REST and MCP. Output-stock postings and product creates pass the same observer.

Output-stock postings run inside the runner's transaction through
`src/data-access/output-stock-post.ts:withOutputStockPostingInTransaction`;
`withOutputStockPosting` remains the `db.transaction` wrapper for callers outside
the runner. Product create and update have matching `...InTransaction` writers.
A product create that carries a form request key first looks it up from the
operator's facts (`src/data-access/biochar-product-create.ts:findCommittedBiocharProduct`,
under the request lock) before the live facility and recipe checks, so a retry
replays the committed product after a formulation line is added or removed or
the facility is archived. A facility-local placement takes the ordinary path,
since resolving it needs the facility's zone.
Product creates and movement postings take an optional `basisFingerprint` (product
updates use a version precondition instead): a stale one fails with
`stock_basis_changed` (409), and without one the write acts on current stock under
the bin locks. REST and MCP adapters answer that error through
`src/lib/operations/stock-basis-preview.ts:runWithStockBasisPreview`, which runs
the same input as a dry run without the stale fingerprint, within the request's
own deadline, and attaches its `basisFingerprint` and `stockEffects` as `preview`.
If that dry run fails, the 409 carries no `preview`; a failure the API treats as
unexpected is logged value-free with the operation and request ids, a domain
refusal is not. The fallback never claims an idempotency key.

Production-run operation inputs accept offset date-time strings or facility-local
`{ date, time }` objects. Local times resolve through the transaction's effective
facility, including a new facility on update. Native Dates are an in-process
convenience and do not appear as a third published shape. UI actions validate
the form contract before passing only operation fields to the runner.

The `audit` run option supplies request and credential IDs for API writes only.
Audited operations must implement `describe`.
`src/data-access/activity-events.ts:recordActivity` is the single audit writer.
Committed runner writes with a non-null `describe` effect record value-free
`activity_events` in the operation's transaction for form, script, REST and MCP
calls. Every runner event carries `operationId`, `versionBefore` and
`versionAfter`. The API audit row contract is defined in [Activity events](./database.md#activity-events).
Form writes have null credential IDs.
No-op descriptions, dry runs, idempotent replays and `activity.skip()` add no
events. An audited write whose effect yields no activity rows throws and rolls
back.
The runner records one event per entity and distinct batch/run scope supplied by
`activity.scope(entityId, scopes)` in `src/lib/operations/activity-links.ts`.
Application create resolves its scopes after saving; update includes the batches
it leaves and joins; delete captures scopes before removing shares. Activity
source is `rest`, `mcp` or `form` for the corresponding transport, or `script`
for a trusted script call.

Stored outcome v2 is `{ kind: "success", data, effect? }` in
`api_idempotency_records`, with schema version 2. Effects retain outcome code,
entity ids and versions for adapters; data is JSON-normalized and a void result
is stored as `null`. Only committed successes are retained. Older schema
versions answer `replay_unavailable`. The claim path deletes expired records
lazily before reclaiming their keys.

`src/lib/api/guards.ts:preAuthGuard` charges the pre-authentication IP limit
first. Routes then resolve the credential with `resolveApiContext` (including
organization API access), and call `src/lib/api/guards.ts:postAuthGuard`: the
write kill switch precedes credential and organization limits, charged in that
order with separate read/write budgets. Dry runs count as writes. PostgreSQL
token buckets are debited outside the operation transaction; rollback never
refunds them. Limits come from `src/config/api-rate-limits.ts:API_RATE_LIMITS`.

`GET /api/cron/purge-api-records` verifies a bearer `CRON_SECRET`, then purges
expired idempotency records and idle rate-limit buckets in bounded batches.
`vercel.json` schedules it daily at 03:00 UTC on Production deployments only.
Staging is Preview and relies on lazy claim expiry; see
[security.md](./security.md#environment-variables).

### Feedstock REST adapter

`lib/api/route.ts` records the deadline, runs `preAuthGuard`, resolves the
credential, checks role/scope through `admitApiRequest`, then runs
`postAuthGuard` before the handler. GET and HEAD use read budgets (including
`/api/v1/me`); all other methods, including dry runs, use write budgets. Guard
denials return directly. Admitted responses, including problems, carry the
returned rate-limit headers alongside private response headers. Domain
failures use the server-action conversion with REST's value-free logger;
unexpected errors never expose their messages or causes.

Feedstock reads and stale-write re-reads use `lib/read-models/api-feedstocks.ts`,
which calls `data-access/api-feedstocks.ts`. Read models accept an organization
context, parsed filters, a limit and a decoded cursor position, and return
representations plus the next position. REST and MCP share parsed-input readers in `lib/api/*-queries.ts` and cursor encoding and decoding;
`lib/read-models/api-list.ts` owns page slicing for feedstock and lookup reads. The list orders by
`(createdAt, id)` descending and keeps PostgreSQL microseconds in the cursor;
cursors bind the resource, organization and filters, but not page size. The
representation deliberately contains only feedstock-owned fields and reference
ids, without joined transport data or entity names. Feedstock representation
revision 2 removes intake GPS fields; date, supplier, wet mass, moisture and bin
are non-null. Moisture is below 100%. PATCH cannot clear the bin or supply derived
`massDryKg`. Supplier-location and driver
ids are not feedstock columns. Percent values use 0 to 100. Business dates use
`YYYY-MM-DD`; creation/update instants use UTC RFC 3339.

`POST /api/v1/feedstocks` records an intake that may split across bins, so
`data` is always an array of the created feedstock representations, including
for one allocation. The REST adapter caps each intake at 200 allocations.
Every REST create requires `Idempotency-Key`, including dry runs. A dry run
never claims, consumes or replays the key; a committed key returns 409
`key_already_used`. MCP dry-run tools may still omit `requestKey`.
`Location` and `ETag` identify the first returned feedstock;
each array member also has its own id and version. GET detail and PATCH return
one object. All mutation responses map the runner's JSON outcome, keeping
create and PATCH replay bodies identical to the original response.

PATCH passes partial input to the operation, which resolves omitted fields
against the locked row. The body cannot supply `feedstockId` or
`expectedVersion`; these come from the path and strong If-Match tag. Revision
and target checks run in the operation's execute phase, after the runner's
idempotency replay, so a committed retry remains recoverable after later edits
or deletion. Version/revision conflicts return the current representation.

A create dry run returns `stockEffects` alongside `data`, with before/after/delta
wet and dry kilogram balances for each changed bin.
DELETE dry runs return the representation that would be removed, and
run the same locked deletion guards before rolling back. Bodyless DELETE is
accepted, including zero-byte streams without Content-Type. Non-empty bodies
use the bounded JSON reader, require application/json and must be empty objects.
Stock-lane refusals return `insufficient_stock` with the bin and blockers plus
`errors[].meta`: `storageLocationId`, `availableWetKg`, `requestedWetKg` and
`unit: "kg"`. For post-write integrity, available mass is the proposed intake
supply plus positive net movements; requested mass is existing consumption plus
negative net movements. The operator message remains unchanged.

### Intake lookup REST adapters

Facilities, suppliers, feedstock types, storage locations, vehicles and drivers
expose read-only list and id-or-code routes through `lib/api/route.ts` and their
resource scopes. `lib/api/*-queries.ts` validates strict query schemas and calls
`lib/read-models/api-*.ts`, including the supplier-location list. The read models
map explicit output schemas in `lib/representations/`; organization predicates
and facility-filter checks remain in `data-access/api-*.ts`.

`lib/api/lookup-query.ts` shares the feedstock cursor contract: newest-first
`(createdAt, id)` ordering, PostgreSQL microseconds, organization/resource/filter
binding, configured page limits, and no totals. Lookup search is a literal,
case-insensitive prefix on code or name; `code` is exact. Only storage locations
have a facility filter. Each lookup table reserves codes per organization, so
facility-level code ambiguity is not possible with the current constraints.

Lists exclude archived rows where supported; detail reads return them with
`archivedAt`. Facilities, suppliers, feedstock types, storage locations, vehicles
and drivers return row versions and strong version/revision ETags on detail reads.
Vehicles and drivers have no archive column and return `archivedAt: null`.
Output projections exclude contact fields and driver license numbers. Facilities expose `timeZone`, storage
locations expose the material lane, capacity in kilograms and feedstock-type
restriction, and vehicles expose their stored identifier/plate and vehicle type.

`GET /api/v1/suppliers/{id}/locations` accepts a supplier UUID only, checks the
parent's organization before querying its children, and paginates locations with
name search and required coordinates in decimal degrees. Its cursor also binds the
supplier ID; a missing or foreign supplier returns 404, including when it has
no locations. Supplier locations have no code or archive column.

### Customers and orders on REST and MCP

`GET /api/v1/customers`, `/{idOrCode}` and `/{idOrCode}/locations` use
`customers:read`. Customer representations exclude email, phone and address;
locations include required names and coordinates, plus optional one-way distance. Orders expose list and
id-or-code reads under `orders:read`. Both read scopes are on by default.
Storage locations expose `formulationId` at representation revision 3 and
accept `type` and `formulationId` list filters.

`src/lib/operations/orders.ts` shares create, update and delete between app
actions and REST/MCP. `POST /api/v1/orders` and `PATCH /api/v1/orders/{id}`
need opt-in `orders:write`; DELETE needs the separate `orders:delete`, off by
default. PATCH and DELETE take UUIDs and `If-Match`. Create requires
`customerLocationId` for the delivery destination. PATCH may omit it to keep the
saved location, but refuses null and empty values with 422 `validation_failed`
at `/customerLocationId`. Packaging defaults from
organization settings inside the transaction after replay. Order writes lock
topology, sorted facilities, a supplied formulation, the order and lineage,
then key-share locks on the customer and location,
skipping locks they do not need. Code generation holds topology. Delete takes
topology, order and lineage. Archive refusals are 404 `not_found`; an archived
order without deliveries can still be deleted. Storage deletion drains after
commit, never on dry runs.

Delivery create locks route topology, the movement request key (replay exits),
sorted advisory bins, the discovered lineage artifact union, the active facility
FOR SHARE and the order FOR UPDATE with its wet balance, then revalidates lineage
without locking newly discovered artifacts. It reads the order unlocked first
for its facility and zone and rechecks that relationship under the row lock.
Products stay locked by posting after the insert: the facility lock serializes
archive and restore before their delivery/product/order locks; topology
serializes order writes, delivery updates and corrections, and sorted bins
serialize product placement. Application create takes no topology or bin lock:
`lockApplicationWriteScope` locks lineage artifacts, facilities, runs and batches
before delivery and application rows. See
[Database boundaries](./architecture.md#database-boundaries). Delivery create
also locks artifacts first and never locks an existing delivery, so these writers cannot cycle.
Delivery updates take artifacts before the facility share lock, then the delivery
row, preserving the same archive ordering.

REST/MCP order writes reject unknown keys.

The order body contains stored fields only. `GET /api/v1/orders/{idOrCode}/balance`
and `get_order_balance` use one repeatable-read snapshot for ordered, delivered
and remaining wet kilograms and fulfillment status. Archived orders include
archived deliveries. Remaining mass rounds down to the gram and clamps at zero.
The REST ETag hashes the body and representation revision. Delivery writes do
not bump the order version, and orders reserve no stock.

MCP exposes `find_customers`, `find_customer_locations`, `find_orders`,
`get_order`, `get_order_balance`, `record_order`, `update_order` and
`delete_order`. Reads share REST readers; writes share its operations and
idempotency records. Update and delete require `expectedVersion`. Committed
MCP deletion returns `{ deleted: { id, code } }`; dry runs return the order
that would be deleted.

### Deliveries on REST and MCP

`GET /api/v1/deliveries` and `/{idOrCode}` use `deliveries:read`, on by
default. `POST /api/v1/deliveries` and `PATCH /api/v1/deliveries/{id}` use
opt-in `deliveries:write`. There is no DELETE route or `deliveries:delete`.
MCP exposes `find_deliveries`, `get_delivery`, `record_delivery` and
`update_delivery` with the same scopes, readers and write adapters.
MCP writes require `requestKey` except on dry runs; update takes the UUID and
`expectedVersion`. REST create requires `Idempotency-Key` even for dry runs;
PATCH requires the UUID and strong `If-Match`.

Create records one finished-product delivery, distinct from feedstock intake.
The order supplies the facility and time zone. The source must be a product bin
in that facility with the order's formulation. See
[Customers and orders](#customers-and-orders-on-rest-and-mcp) for lock ordering
and order-version behavior. The submitted-order lineage guard answers
`certification_locked`.

Archived orders, source bins and facilities refuse create with 404 `not_found`.
Archived deliveries refuse PATCH with 404 `not_found` at `/deliveryId` before
any representation-revision 412; PATCH under an archived facility returns 404
at `/deliveryId`. Archived rows remain readable by id and are hidden from lists.
Driver and vehicle references check existence and organization; neither has an
archive state.

Create returns `data`, `allocations` and `warnings`. Dry runs also expose
`basisFingerprint` and bin-level `stockEffects`. The internal operation retains
the fingerprint from the plan actually posted; committed API responses expose
the allocations without the fingerprint or stock effects. A stale optional fingerprint
returns 409 `stock_basis_changed` with a fresh dry-run `preview` containing
`basisFingerprint`, `stockEffects` and `allocations` when that preview succeeds.
Each allocation has `layerId`, product `code`, `dryBiocharKg`, `solidsKg`,
`wetKg`, `moisturePercent` and `policy`, in draw order. Stored dry and wet
allocation masses have 3 decimal places, moisture up to 6, and exact rational
solids truncate to 12. Sums can differ from the delivery's 3 decimal place dry
mass in trailing digits; the adapter does not round the allocations again.
REST dry runs return 200 without Location or ETag, committed creates 201 with
both, and PATCH 200.

The non-blocking bill-of-lading warning is create-only, API-only and saved in
the outcome for replay. Upload it as a delivery document of type `bill_of_lading`. Older stored outcomes keep their original warning text. The app create action has
no such warning because the form uploads evidence immediately after create.

`deliveredAt` accepts an offset instant or facility-local `{ date, time }`;
future instants are refused in the app and API. `moisturePercent` is the recorded
reading without `sources`. With split-bin `sources`, the top-level moisture is
accepted but ignored: each source carries its reading and the stored overall
moisture is 100 times (1 minus solids divided by wet mass), including ingredient
solids. The mode at the delivery instant governs source eligibility. Every
output-stock command refuses `sources` on a bin that is mix at that instant
with 422 at `/sources`. Never infer a new reading from historical bin estimates.

PATCH changes only code, driver, vehicle and distance metadata. Omitted values
stay unchanged; null clears a distance override and its source. The documentary
provenance exception remains. Overrides must be above zero and are one-way km;
the server counts the round trip. Mass, moisture, sources, time, order and bin
are not PATCH fields; corrections stay in the app.

The representation uses stored delivery fields plus the order destination in
`destinationCustomerLocationId`: masses have 3 decimal places, moisture 6, and
distance retains the column's 32-bit real precision. Revision 2 sources
`destinationCustomerLocationId` from the order. The destination is read-only
and cannot be overridden on a delivery. Order relationships freeze once a
delivery exists, so unrelated order edits leave the delivery response and ETag
unchanged.
Lists use `(createdAt desc, id desc)` keysets, shipping-facility filters and
explicit-offset `deliveredFrom` inclusive / `deliveredBefore` exclusive bounds.
Drawn products are available through stock movements under `biochar-products:read`.

`src/lib/operations/deliveries.ts` registers `record_delivery` and
`update_delivery`. App create runs on the runner as `record_posted_delivery`;
app edit uses `update_posted_delivery` for metadata and latest-entry corrections.
Both app operations remain unregistered. Public outcomes strip native product
rows with bigint posting sequences before JSON serialization. The app create
shares the runner's retries, deadline and statement timeout.

### Applications on REST and MCP

Applications record spreading from one delivered load. They consume its wet mass
without moving bin stock. Read scope `applications:read` is on by default;
`applications:write` is opt-in and `applications:delete` is off by default.

| Route under `/api/v1` | Scope | Contract |
|---|---|---|
| GET `/applications` | `applications:read` | Keyset page, newest first |
| GET `/applications/{idOrCode}` | `applications:read` | UUID or exact code, strong version/revision ETag |
| GET `/applications/{idOrCode}/boundary` | `applications:read` | Full normalized GeoJSON collection and summary, 404 without a boundary |
| POST `/applications` | `applications:write` | One application; required `Idempotency-Key`, including dry runs |
| PATCH `/applications/{id}` | `applications:write` | UUID and strong `If-Match` required |
| DELETE `/applications/{id}` | `applications:delete` | UUID and strong `If-Match` required; optional empty JSON body |
| GET `/deliveries/{idOrCode}/application-balance` | `deliveries:read` | Delivered, applied and remaining wet kg, earliest date and site defaults |

List filters include `facilityId`, `deliveryId`, `orderId`, `creditBatchId`,
`evidenceMethod`, `q`, `code`, `appliedFrom` inclusive and `appliedBefore`
exclusive. The dates are calendar dates. `creditBatchId` follows physical
lineage through slices or frozen shares from member runs, including mix-bin
applications held out of credit batches. The app page still uses delivery
lineage; its alignment is tracked in `app/application-batch-lineage-filter`.

Send `appliedWetMassKg` in 0.001 kg steps and positive `fieldSizeHa` in hectares.
`dryBiocharKg` is derived from the delivery's saved provenance and cannot be
supplied. Capacity is rechecked under the delivery lock; no stock fingerprint
is needed and committed allocations are authoritative. `applicationDate` is
`YYYY-MM-DD` on the delivery facility's clock, stored as a UTC-midnight calendar
date. It cannot precede the delivery's facility-local day or be in the future.
Never invent field size or GPS. `visual` cannot be selected; legacy rows remain
readable until that method is changed.

On create only (Q78), omitted GPS coordinates for `location` copy the order
customer location's pair, with a warning naming the location. An explicit null
stays null; a `location` record without a complete GPS pair after defaulting
is refused. Soil temperature
copies the customer location default, else the facility default, only when both
its value and source are omitted and the facility is not 1000-year. The copied
source is `global_database`, with a warning naming its origin. PATCH never
fills defaults. Omitted PATCH fields stay unchanged and null clears optional
fields, subject to validation of the merged record. Other non-blocking warnings
cover mix-bin credit holds and the 200-year facility reference temperature.

`gisBoundary` accepts raw WGS 84 Polygon, MultiPolygon, Feature or
FeatureCollection GeoJSON. The server normalizes it with `source: "api"` inside
the operation, after fingerprinting the client's body for replay. Do not send
the app's boundary envelope. The whole JSON request must fit `API_BODY_MAX_BYTES`
(256 KiB); larger boundaries must be added in the app. Lists and detail bodies
carry only the boundary summary; the boundary route returns geometry. Q79
requires a boundary whenever `evidenceMethod` is `boundary`, on create and after
merging PATCH. Removing that boundary without changing the method answers 422
at `/gisBoundary` in both the app and API.

POST returns 201 with Location and ETag; PATCH returns 200. Both return `data`,
`allocations`, target `deliveryBalance` before/after and optional `warnings`.
Repointing rebuilds shares and reports the target delivery's balance only.
A missing If-Match on PATCH or DELETE answers 428; a stale tag answers 412 with
`current`, the current application representation. Optional mutation keys replay
before precondition checks. DELETE returns 204; a DELETE dry run returns the
representation that would be removed. Create and PATCH dry runs return 200
without Location or ETag and commit no application or activity event.
Deletion retires documents in the same transaction and drains storage after
commit. Submitted lineage refuses every edit; Removal-owned slices refuse mass,
delivery and delete changes. Verified or issued linked batches refuse deletion.

Lists hide applications on archived deliveries. Detail, boundary and document
reads remain available. Archived deliveries or facilities refuse create and
PATCH with 404 `not_found`; DELETE remains allowed subject to certification
rules. Application writes never bump the delivery version. The balance read
uses one repeatable-read snapshot and a body-hash ETag covering every published
field, including site defaults. Remaining wet mass clamps at zero and rounds
down to the gram. It is not a reservation. `hasRemainingMass=true` on
`GET /deliveries` and `find_deliveries` selects deliveries with capacity;
`false` selects exhausted deliveries.

MCP exposes `find_applications`, `get_application`, `record_application`,
`update_application` and `delete_application` with their matching application
scopes. `get_delivery_application_balance` requires `deliveries:read`. Find a
delivery and read that balance before recording an application. MCP updates
and deletes take UUID `applicationId` and `expectedVersion`; write retries use
`requestKey`, optional on dry runs. There is no MCP boundary tool;
`get_application` points to the REST boundary read. Application photos and PDFs
use the shared document routes and tools with `ownerType: "application"`.
Activity uses `form` for app actions, `rest` for REST and `mcp` for MCP, with one
runner event per affected batch scope, including both sides of a repoint.

### Output-bin stock read

`GET /api/v1/storage-locations/{idOrCode}/stock` and MCP `get_bin_stock`
share the app picker's projection. The whole read uses one repeatable read,
read only snapshot: the bin lookup runs first, then the server captures one
instant for the projection. The published body carries no evaluation instant.

Representation revision 2 includes `drawOrder`: `oldest_first` or
`newest_first` for split bins, null for mix bins. `subBins` stays oldest first.

The REST ETag is `"sha256-..."` over the published body and representation
revision. It is a read validator, not a reservation or a write precondition.
A loss's optimistic check stays the dry run's `basisFingerprint`.
See [output-stock.md](./output-stock.md#api-stock-read) for bins, figures and
unresolved stock.

### Public API contract

No resource answers 304. API reads return their representation even when a
client supplies `If-None-Match`; ETags support version checks and body comparison.

Published UUID inputs accept either case and are lowercased before the operation
runs: body and query fields through `src/schemas/helpers.ts:uuidSchema` (older
feedstock and run chains with their own messages end in `.toLowerCase()`, which
keeps `format: uuid` in the published schema), path ids and the MCP
movement target through `src/lib/api/canonical-uuid.ts:canonicalUuid`. Rows come
back lowercase, so string comparisons and idempotency fingerprints see one
spelling; the published JSON Schema is unchanged.

`src/lib/api/openapi/document.ts:buildOpenApiDocument` builds OpenAPI 3.1 with
relative `/api/v1` servers and stable operation ids. Operation bodies use only
`src/lib/operations/json-schema.ts:toOperationJsonSchema`; output representations
use Zod's output JSON Schema conversion. Strict query schemas live in
`src/lib/api/query-schemas.ts` and `src/lib/api/query.ts`. The `resourceQueries`
map is shared by resource adapters and the document generator. Descriptions belong in
Zod schemas. Transport headers and possible statuses are declared in the generator.
The generator imports no runtime credentials, environment or database modules.

`GET /api/v1/openapi.json` and `GET /api/v1/llms.txt` are public, bypass credential
resolution and rate-limit guards, and cache publicly for 300 seconds. OpenAPI
serialization is cached lazily per module instance; the agent guide is a
module-level string. Each origin response carries a fresh `X-Request-Id`. The short
agent guide covers discovery, units, local business dates and safe retry behavior.
The rendered reference remains deferred in
[Architecture open questions](./open-questions-architecture.md#rendered-api-reference-apirendered-reference-opened-2026-10-08).

Run `pnpm openapi:generate` after a contract change and include `openapi/v1.json`
in its PR. The colocated generator test compares the exact stable, pretty-printed
snapshot with code (a generated file, exempt from the 1000-line cap),
checks route coverage and validates the OpenAPI structure.

`pnpm openapi:client-check` generates TypeScript API types from `openapi/v1.json`
with `openapi-typescript` into a temporary directory outside the repository,
then checks that file with the repository's TypeScript compiler using
`tsc --noEmit --strict`. The temporary directory is removed on success or failure;
the generated client is not committed. CI runs this check in `quality-static`
on every PR and push, including the first release without a base snapshot.

The CI `openapi-breaking` job compares the snapshot at `git merge-base(base, head)`
with the head, so breaks that landed on staging meanwhile are not blamed on the PR.
It uses checksum-verified oasdiff v1.32.1 and `breaking --fail-on ERR`. A merge base
without the snapshot is the first release and passes with an explicit notice.

Prefer additive changes in v1; incompatible versions use v2 with Deprecation and
Sunset headers. For an accepted deliberate break or contract correction, regenerate
the snapshot and add the specific method/path and exact change description from
`oasdiff breaking <base> openapi/v1.json --format singleline` to
`openapi/accepted-breaking-changes.txt` in the same PR. CI passes that file to
`--err-ignore`; do not blanket-ignore a check or endpoint. Explain the client
impact in the PR and remove stale entries after the change reaches the base.
The [oasdiff ignore-file format](https://github.com/oasdiff/oasdiff/blob/v1.32.1/docs/BREAKING-CHANGES.md#ignoring-specific-breaking-changes)
requires the method/path (or `components`) and change description on each line.

### MCP tools on API keys

`src/app/api/mcp/route.ts` serves stateless JSON-RPC POSTs through the pinned
`mcp-handler` and MCP server SDK. GET and DELETE return 405. Origin validation
runs first; requests without Origin pass. The shared `lib/api/route.ts`
admission wrapper starts the deadline before authentication, assigns a request
id and applies the same API-key resolver and rate-limit buckets as REST.
After authentication, the preparation hook bounds the body to `API_BODY_MAX_BYTES`
and returns HTTP 413 `payload_too_large` if it exceeds that limit. JSON-RPC
batch arrays return HTTP 400 `batch_not_supported`. Both refusals use
`application/problem+json` and precede authenticated rate limiting and dispatch.
`lib/mcp/server.ts` classifies calls to write tools as writes, including dry runs;
other admitted MCP requests count as reads.

`src/lib/mcp/tools/read-tools.ts` defines whoami, the intake find tools and
get_feedstock. Each request captures its resolved context in a fresh server.
`src/lib/mcp/tools/write-tools.ts` adds log_feedstock_delivery, update_feedstock
and delete_feedstock through the same operation runner as REST. Each write needs
one requestKey reused on retry; dryRun previews may omit it. Updates and deletes
take expectedVersion from get_feedstock. Activity audit rows record source `mcp`.
Existing tools keep their single `hasRoleAndScope` scope check. Document tools
use `visible(ctx)` to appear when the role floor and any supported owner's
scope allow them, then `authorize(ctx, args)` checks the selected owner before
execution. A missing owner scope returns an `isError` `missing_scope` problem.
`find_documents` and `get_document_download_url` use the owner's read scope;
`request_document_upload` and `confirm_document_upload` use its write scope.
The upload request requires `requestKey`; confirmation takes neither a key nor
an expected version. Neither offers a dry run. Only confirmation gets the
25 second budget, measured from before authentication. Tool
schemas reuse REST query schemas and transport-neutral `lib/representations/`
output envelopes. Numeric limits accept JSON numbers as well as REST strings.
HTTP-only ETag builders live in `lib/api/representation-etags.ts`.

The SDK publishes schemas through `toToolSchema`. A low-level tools/call
handler owns argument parsing so validation failures remain structured.
Success structuredContent uses the matching REST response envelope. Expected
failures use the REST problem code and JSON Pointer errors, named `issues` in
MCP, without HTTP metadata. Tool errors carry `retryable: true` for retryable
domain errors. Both transports include query validation issues
with JSON Pointers: REST uses `errors` and MCP uses `issues`. Each issue carries
`pointer`, `code` and `detail`.
Each output schema is a success/error union with `type: "object"` at its root.
Unexpected failures are generic JSON-RPC internal errors, logged with
request id and tool name without raw input. The tool dispatcher checks the
request deadline before each tool. `API_WRITES_DISABLED` returns an in-MCP
`isError` result with code `api_writes_disabled`; reads keep working. No sessions
are exposed. Initialize returns short server instructions built from the domain
section shared with `llms.txt`, plus MCP grounding and retry guidance.
