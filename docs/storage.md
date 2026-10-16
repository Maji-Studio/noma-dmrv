# Object Storage

How evidence files (lab reports, photos, COAs, calibration certificates,
production-readings CSVs, server-generated PDFs) get into and out of S3-compatible
object storage. Read this before touching upload flows, the documents API route,
storage env vars, or production-run readings files. For auth/org scoping see
[auth.md](./auth.md) and [organization.md](./organization.md); for env inventory
and secrets see [security.md](./security.md).

## Providers

`STORAGE_PROVIDER` selects the backend:

- **`s3-compatible`** (production) — DigitalOcean Spaces or AWS S3. Same code
  path; only `STORAGE_ENDPOINT` differs.
- **`local-fs`** (dev/test) — filesystem provider under `.storage/` (gitignored)
  that simulates the same presigned-PUT / presigned-GET flow, with
  `/api/storage-local/[...key]` standing in for the bucket.

Production rejects `local-fs` in `src/config/env.ts` (`superRefine`), with one
deliberate carve-out: `allowsCiLocalFsStorage` permits it only when
`NOMA_HERMETIC_CI=true`, `CI` is set, and `NEXT_PUBLIC_APP_URL` is an HTTP(S)
loopback URL. Only the hermetic CI and PR Playwright workflows set the marker;
live sandbox workflows and deployments do not ([testing.md](./testing.md)).

**The provider is a module-level memoized singleton** (`_provider` in
`src/lib/storage/index.ts`). Env changes need a process restart, and tests MUST
inject via `__setStorageProviderForTests` — mutating env in a test silently uses
the real provider.

### Env gotchas

- If `STORAGE_REGION` looks like a DigitalOcean Spaces region and
  `STORAGE_ENDPOINT` is unset, env validation errors — otherwise the AWS SDK
  silently targets a nonexistent `amazonaws.com` host. This is the most common
  storage misconfiguration.
- `STORAGE_PREFIX` must be a relative safe key: no empty / `.` / `..` segments,
  no trailing slash. Validated twice — in `src/config/env.ts` and again in the
  `S3CompatibleProvider` constructor.
- The local-fs signing secret falls back `STORAGE_SIGNING_SECRET` →
  `BETTER_AUTH_SECRET` → an ephemeral per-process secret. Under the ephemeral
  fallback, tokens minted before a dev-server restart stop verifying — a
  confusing local-only failure.

## Reads always go through an app route

The client never talks to the bucket except for the one-shot presigned PUT. App
reads go through `/api/documents/[id]`; API reads use the owner-scoped
`/api/v1/{owner}/{id}/documents/{documentId}/content`; external verifier reads go
through `/api/ghg-statement-reports/[reportId]?token=…`. Both mint a fresh
signed GET per request. **The app never embeds signed storage URLs in HTML or
the DB** — so users never see "URL expired".

## Bucket and prefix convention

One bucket per environment (`noma-dev`/`noma-staging`/`noma-prod`), or a shared
bucket plus `STORAGE_PREFIX` (e.g. `STORAGE_BUCKET=maji`,
`STORAGE_PREFIX=noma-dmrv/staging`).

The prefix is a **provider concern**: `physicalKey()` prepends it to every
S3-compatible PUT, GET, HEAD, DELETE, and `putObject`, but it is never stored in
the DB. The local-fs provider ignores it entirely. This keeps the logical key
stable when an environment moves bucket or prefix.

**Browser upload logical keys** (stored without a leading `/`):

```text
org/{organizationId}/uploads/{documentId}/{ulid}
org/{organizationId}/{entityType}/{entityId}/{documentType}/{documentId}-{sha256}.{ext}
```

`buildUploadKey()` creates the client-writable key. Both providers refuse to
presign a PUT outside that namespace. `buildFinalStorageKey()` creates the
server-only key after inspection. The original filename stays in
`documents.file_name`, never in either key. An unusable filename extension is
omitted. Legacy uploaded rows keep their existing keys and download normally.
`buildStorageKey()` remains available for server-generated objects.

**Generated objects use deterministic logical namespaces where idempotent
reuse matters:**

```text
org/{organizationId}/transport-evidence/{facilityId}/{removalId}/{contentHash}.pdf
org/{organizationId}/durability-evidence/{facilityId}/{removalId}/{contentHash}.pdf
org/{organizationId}/ghgStatementReport/{reportId}/pdf/{ulid}.pdf
```

Transport and durability ledgers key by their semantic model hash so identical
content reuses the current artifact/Source; changed content creates a new object
before older local ledgers are retired. A GHG Statement report always allocates
a new report version and object. Its key is
`ghgStatementReportKeyPrefix(organizationId, reportId)` plus a lowercase ULID
and `.pdf`. Approval and submission reject any stored key outside that prefix. These are logical keys: the
S3-compatible provider may still prepend `STORAGE_PREFIX` physically.

## Visibility and read authz

**Objects always stay private at the storage layer.** Visibility is a DB-only
concept enforced by `/api/documents/[id]`, and reads are **org-scoped, not merely
auth-scoped**: the route resolves `getDocumentById(orgCtx, id)` first and falls
back to `getPublicDocumentById(id)`.

| Caller | `private` doc | `public` doc |
| ------ | ------------- | ------------ |
| Same org | 302 → signed GET | 302 → signed GET |
| Different org | 404 | 302 → signed GET |
| No org / signed out | 401 | 302 → signed GET |

Non-UUID `id` → 400. A row with neither `storageKey` nor `fileUrl`, or a
`storageKey` row not yet `uploaded` → 500 / 404 respectively.

An Owner or Admin can change visibility through the guarded document writer.
It checks submitted lineage and increments the document version, without a
provider call or object copy. API reads have no public-visibility fallback.

### Verifier capability route

Generated GHG Statement report documents remain
`documents.visibility = 'private'`. They are reviewed by signed-in operators
through `/api/documents/[id]`, while the external verifier receives
`/api/ghg-statement-reports/[reportId]?token=…`.

The public route looks up the report/document pair, verifies the supplied
per-report bearer token against the stored SHA-256 digest, confirms the private
document has an uploaded storage key, then returns `302` to a fresh signed GET.
It never exposes the bucket key directly as authorization. Missing/invalid
capabilities use 404; successful responses set `private, no-store` and
`no-referrer`. The cross-organization lookup is deliberate and carries the
required `// org-scope-ok:` waiver; every other report-management path stays
org-scoped.

### Legacy `fileUrl` redirects are fail-closed

Rows carrying a legacy `fileUrl` instead of a `storageKey` redirect the browser
out. Guards: non-`http(s)` → 500; embedded `user:pass@host` credentials → 500;
hostname failing `isAllowedRedirectHost` (`src/lib/documents/redirect-allowlist.ts`,
overridable via `ISOMETRIC_STORAGE_REDIRECT_HOSTS`) → 502. This exists so the
route can't be used as an open redirect borrowing the app's domain trust.

## Write paths

**1. Presigned upload**: `requestUpload` commits a pending row through an
unregistered app operation, then presigns its upload key for the remaining
five-minute lease. The immutable size, MIME and optional SHA-256 declaration
lives in `metadata.uploadDeclaration`. Client PUTs still send only Content-Type.
`confirmUpload` returns an already uploaded row without storage I/O. A missing
object returns retryable `conflict` and remains pending. A failed row returns
`conflict` with its stored failure reason.

Only pending rows undergo a bounded streaming read. The server verifies exact
size, SHA-256, declared MIME, PDF/image magic bytes and the readings CSV rule,
then records the candidate final key on the pending row before writing the
inspected buffer to that content-addressed key. The bounded candidate list
retains cleanup ownership if preparation or the runner fails. Storage
has a 20-second abort budget within the 25-second confirmation deadline.
The runner revalidates all inspection bindings under the document write locks
before promoting the row. Refusals are returned outcomes so the failed state
and deletion queue commit before the action returns an error. Losing confirms
never delete a winning final key.

All cleanup uses the deletion queue. Upload keys are eligible only after their
lease plus a ten-minute grace period; promotion candidates wait past the
confirmation deadline so an in-flight PUT cannot recreate a deleted object.
A candidate handed off to cleanup cannot become live in a later confirmation. Parent
retirement queues both keys. Draining happens after commit and skips future
`not_before` entries, so a late PUT can only recreate an upload object whose
cleanup is still pending.

Upload-request replays renew pending leases under the same document row lock
used by expiry. Each lease lasts five minutes, capped at creation plus
`DOCUMENT_UPLOAD_MAX_LIFETIME_MS` (one hour). Renewal does not bump the version.
A replay after that maximum returns the original representation without a PUT
link. The ten-minute grace is `DOCUMENT_UPLOAD_GRACE_MS`.

### Abandoned uploads and cleanup

`GET /api/cron/sweep-document-uploads` uses the same bearer `CRON_SECRET`
check and Node runtime as `purge-api-records`. It refuses requests when the
secret is absent or wrong. `vercel.json` schedules it daily at 03:15 UTC on
Production, after the API-record purge at 03:00 UTC. It is not a public v1 route.

Each expiry batch locks at most `DOCUMENT_SWEEP_BATCH_SIZE` (100) expired pending
rows across organizations with `FOR UPDATE SKIP LOCKED`. An upload expires when
its lease ended more than ten minutes ago. The sweep sets `failed`, stores
`metadata.uploadFailure = { reason: "expired" }`, increments `version`, and
queues its keys in the same transaction. Renewal either commits first and is
skipped by the sweep, or sees the committed failure and cannot renew.

Retention batches remove up to 100 failed rows whose `updatedAt` is older than
`DOCUMENT_FAILED_RETENTION_MS` (30 days), only when every key has already been
queued. Completed queue entries also qualify. Thirty days leaves time to
investigate a failed upload before its declaration disappears. Uploaded evidence
is never removed by this retention policy. Each phase commits batches in separate
transactions while full batches remain, sharing a `DOCUMENT_SWEEP_BUDGET_MS`
(30 seconds) budget. The shared queue drain then processes
50 entries at a time across organizations within
`DOCUMENT_SWEEP_DRAIN_BUDGET_MS` (20 seconds), respecting `not_before`, row locks
and retry backoff. The route allows 60 seconds overall. A failed phase logs its
counts and allows subsequent phases to run; any failure returns HTTP 500.
Logs contain counts and ids, never keys, URLs or file names.

Staging is a Vercel Preview deployment and has no cron. Request-path drains
remain enabled there and in Production, but do not expire abandoned pending
rows. An optional bucket lifecycle rule can expire old upload objects as a
backstop. Match only the physical `org/{organizationId}/uploads/` namespaces
under the deployment prefix, using per-org prefixes or provider-supported
filters. A literal bucket-root `uploads/` prefix does not match these keys.
Keep its age comfortably beyond the one-hour maximum lifetime and grace, for
example seven days; never apply it to final evidence namespaces.

The sweep does not list final objects. A promotion written before a failed
confirmation transaction can leave a final key with no document reference.
See `storage/orphaned-final-keys` in
[architecture open questions](./open-questions-architecture.md).

### Server-generated objects

**2. Server-side `putObject`** — for artifacts the server generates itself:
transport/durability evidence ledgers
(`src/fn/certification/evidence-ledger-core.ts`) and GHG Statement report PDFs
(`src/fn/certification/ghg-statement-reports.ts`). It overwrites any existing
object at the supplied key and **skips the `confirmUpload` size/MIME gate
entirely**; callers must render trusted bytes, set content type explicitly, and
persist their own checksum/metadata.

Client orchestration: `src/hooks/use-file-upload.ts` and
`src/components/forms/form-file-upload.tsx` ([design-system.md](./design-system.md)).

### Write authz and limits

Document mutations enforce organization, owner and submitted-lineage checks in
transaction-aware data-access writers. The lock order is documented in
[architecture.md](./architecture.md#database-boundaries). Archived owners refuse
request and confirm; delete remains allowed. Visibility requires an Owner or
Admin at the data-access boundary and bumps the document version, as does
application evidence reclassification. Submitted lineage refuses every app
mutation, including deletion of documents that are not registry Sources.
Server-generated ledgers and GHG Statement reports retain their own writers.
The storage layer itself does not perform authorization.

`reflectance_histogram` is a Sample-only document type available through the app,
not the public API.

Per-documentType size and MIME rules live in `src/schemas/documents.ts`
(`UPLOAD_RULES`, `isAllowedMime`, `maxBytesFor`) — read them there, they change.
All user-uploaded document types currently share a 10 MB cap defined once in
`src/lib/documents/upload-policy.ts`; UI limits are clamped to that server policy.
Future file reduction (for example image processing with Sharp) should be a
preprocessing step that produces the final artifact before `requestUpload`, so
both the request check and authoritative `confirmUpload` bounded inspection apply to the
bytes that are actually retained.
The local-fs route additionally caps each upload at `min(token cap,
LOCAL_FS_GLOBAL_MAX_BYTES)` (100 MB) as defense-in-depth.

### Deleting is not purely a storage op

Evidence is replaced or removed from its owning record (for example Feedstock),
not from the Removal detail. Before submission, `deleteDocument` acquires the
same per-document lock used by Source mirroring and Removal submission. If an
Isometric mapping is not referenced by any persisted submission payload, the
delete retires that local mapping and the owning document together; the remote
Isometric Source is never deleted.

If any submission snapshot references the Source, deletion/replacement fails:
the document belongs to submitted certification history and both its local audit
record and remote Source must remain intact. Submitted Removals expose source
status only and cannot be used to change supporting evidence.

## Adapter interface

`src/lib/storage/types.ts` defines `StorageProvider` (`name`, `bucket`,
`createUploadUrl`, `createDownloadUrl`, `getObject`, `readObjectBounded`, `headObject`,
`deleteObject`, `putObject`). `getObject` is the server-side read seam and
returns the bytes plus a content type. The s3-compatible provider presigns a
fresh URL and fetches it, refusing redirects, under the timeout in
`src/lib/storage/get-object.ts`. local-fs reads straight from disk, with no
HTTP hop and no timeout, so a server-side reader (CSV imports, report proxies,
CLI seeds) never depends on the app's own route being reachable. A new backend (e.g. R2) means implementing it, wiring it into the
factory in `src/lib/storage/index.ts`, **and widening the
`StorageProviderName = "s3" | "do-spaces" | "local-fs"` union** — the name is not
a free-form string.

## Production-run readings files

The operator workflow is file-only. A readings CSV is uploaded once as a
`documents` record with `entity_type='production_run'` and
`document_type='sensor_data'`. noma stores the original object unchanged and
does not inspect or validate its headers, timestamps, run window, sensor values,
or other contents. The normal document security, size, and file-type checks are
the complete validation boundary for this workflow.
The operator picker deliberately narrows uploads to `.csv` even though the
`sensor_data` storage rule accepts the wider tabular MIME set.

The production-run create, edit, and detail surfaces do not parse the CSV or
write `production_run_readings` rows. They list the stored filename and size,
allow authorized users to delete it, and open it in a new tab through
`/api/documents/{id}` so the existing organization authorization and signed
download flow remain in force.

For Noma certification readiness, every completed production run must have at
least one saved `sensor_data` document whose upload status is `uploaded`.
Pending and failed upload rows do not satisfy the control. The control means
only that the required file was supplied: Noma does not validate the file's
contents. Failed and cancelled runs retain their lifecycle-only readiness
result.

One CSV per completed run is Noma's conservative evidence-completeness control,
not a requirement stated verbatim by Isometric Biochar Protocol v1.1. The
project's approved monitoring method, PDD, or verifier instructions may define
a different evidence grain or require a separate Certify delivery route.

The legacy row importer and `production_run_readings` remain separate from
the operator readings-file upload.

## CORS (deployed buckets)

The browser PUT is cross-origin, so DO Spaces / S3 must allow the exact
`NEXT_PUBLIC_APP_URL` origin. Domain changes require updating bucket CORS too;
allowing an old marketing/app hostname does not cover the new app subdomain:

```json
[
  {
    "AllowedOrigins": ["https://<your-prod-domain>"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3000
  }
]
```

Run `pnpm storage:cors` to check the configured app origin.
`pnpm storage:cors --apply` repairs the upload rule for that exact HTTPS origin
and preserves existing rules for other applications sharing the bucket. This
administrative command needs bucket CORS read/write permission; it does not
change object ACLs or make files public. On staging, dispatch **Storage health**
with `repair_cors=true` to load the staging settings from 1Password, apply the
repair, and verify the real storage round-trip. Scheduled health runs never
change bucket configuration. If the storage key lacks CORS administration
permission, a bucket administrator must apply the rule through the control panel.

DO Spaces: *Spaces → Settings → CORS Configurations*. AWS S3: bucket
*Permissions → CORS*. local-fs needs none — `/api/storage-local/...` is
same-origin.

## Testing

`pnpm storage:smoke` (`scripts/storage-smoke.ts`) does a real round-trip against
the configured bucket — presigned PUT → HEAD → signed GET byte-for-byte → DELETE →
HEAD 404 — covering exactly what the unit-test fakes deliberately don't:
credentials, region/endpoint, path-style addressing, bucket permissions. It
refuses to run against `local-fs` (exit 2), runs daily against staging via
`.github/workflows/storage-health.yml`, and checks the browser PUT preflight for
the configured app origin plus the actual PUT response CORS header. This catches
stale origin allowlists as well as credential and storage failures. A full UI
walkthrough remains separate.

Outside CI, an HTTP loopback `NEXT_PUBLIC_APP_URL` (the local/worktree default)
deliberately skips browser CORS checks and still tests the storage round-trip.
Set `NEXT_PUBLIC_APP_URL` to the deployed HTTPS app origin to check its CORS too.
CI always requires an exact HTTPS origin and never skips the CORS gate.

Unit coverage lives in `tests/documents-*.test.ts` and `tests/*storage*.test.ts`
(plus `tests/parent-document-retirement.test.ts`). Conventions:
[testing.md](./testing.md). Known failure modes:
[troubleshooting.md](./troubleshooting.md).
