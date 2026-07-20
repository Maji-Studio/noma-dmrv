# Object Storage

How evidence files (lab reports, photos, COAs, calibration certificates,
production-readings CSVs, server-generated PDFs) get into and out of S3-compatible
object storage. Read this before touching upload flows, the documents API route,
storage env vars, or the readings importer. For auth/org scoping see
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
deliberate carve-out: `allowsCiLocalFsStorage` permits it when `CI` is set **and**
`NEXT_PUBLIC_APP_URL` is localhost, so Playwright can round-trip real uploads
hermetically ([testing.md](./testing.md)).

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

## Reads always go through the app

The client never talks to the bucket except for the one-shot presigned PUT. All
reads go through `/api/documents/[id]`, which mints a fresh signed GET per
request. **The app never embeds signed URLs in HTML or the DB** — so users never
see "URL expired".

## Bucket and prefix convention

One bucket per environment (`noma-dev`/`noma-staging`/`noma-prod`), or a shared
bucket plus `STORAGE_PREFIX` (e.g. `STORAGE_BUCKET=maji`,
`STORAGE_PREFIX=noma-dmrv/staging`).

The prefix is a **provider concern**: `physicalKey()` prepends it to every
S3-compatible PUT, GET, HEAD, DELETE, and `putObject`, but it is never stored in
the DB. The local-fs provider ignores it entirely. This keeps the logical key
stable when an environment moves bucket or prefix.

**Logical key** (stored in `documents.storage_key`, no leading `/`):

```text
{entityType}/{entityId}/{documentType}/{ulid}.{ext}
```

- Original filename lives in `documents.file_name`, NOT in the key — avoids
  URL-encoding pain and PII leakage via names like `"Smith - Confidential.pdf"`.
  ULID sorts by upload time; `entityType`/`entityId` lead so bucket browsing
  mirrors app navigation.
- `buildStorageKey()` (`src/lib/storage/keys.ts`) is the only place keys are
  built — never construct one by hand. **It may return a key with no extension**:
  `extractExtension` accepts only `[a-z0-9]{1,12}` and drops anything else, so
  code that infers content type from the key extension will break.

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

Flipping public is a one-row `UPDATE documents SET visibility = 'public'` — no
provider call, no object copy, portable across providers that don't honor ACLs.

### Legacy `fileUrl` redirects are fail-closed

Rows carrying a legacy `fileUrl` instead of a `storageKey` redirect the browser
out. Guards: non-`http(s)` → 500; embedded `user:pass@host` credentials → 500;
hostname failing `isAllowedRedirectHost` (`src/lib/documents/redirect-allowlist.ts`,
overridable via `ISOMETRIC_STORAGE_REDIRECT_HOSTS`) → 502. This exists so the
route can't be used as an open redirect borrowing the app's domain trust.

## Write paths

**1. Presigned upload** — `src/fn/documents.ts`: `requestUpload` → client PUT →
`confirmUpload`. `confirmUpload`'s `headObject` is the **authoritative** size +
content-type gate and the security boundary; client-side and `requestUpload`-time
checks are best-effort UX, because presigned PUTs can't reliably enforce
content-length across S3-compatible providers. On rejection the object is deleted
immediately and `upload_status` becomes `'failed'`.

**2. Server-side `putObject`** — for artifacts the server generates itself (the
transport evidence ledger PDF, `src/fn/certification/evidence-ledger-core.ts`).
It overwrites any existing object at the key and **skips the confirmUpload
size/MIME gate entirely**.

Client orchestration: `src/hooks/use-file-upload.ts` and
`src/components/forms/form-file-upload.tsx` ([design-system.md](./design-system.md)).

### Write authz and limits

Every documents server action goes through
`assertCanManageDocumentEntity(ctx, entityType, entityId)` — **the storage layer
itself has no authz.** `DOCUMENT_ENTITY_TYPES` (14 entities) enumerates what a
document can hang off.

Per-documentType size and MIME rules live in `src/schemas/documents.ts`
(`UPLOAD_RULES`, `isAllowedMime`, `maxBytesFor`) — read them there, they change.
The local-fs route additionally caps each upload at `min(token cap,
LOCAL_FS_GLOBAL_MAX_BYTES)` (100 MB) as defense-in-depth.

### Deleting is not purely a storage op

`deleteDocument` refuses when the document is mirrored to Isometric as a Source —
checked before the delete for a fast error, and again on FK error as the real race
guard. The user must unlink it from the Removal's Sources panel first.

## Adapter interface

`src/lib/storage/types.ts` defines `StorageProvider` (`name`, `bucket`,
`createUploadUrl`, `createDownloadUrl`, `headObject`, `deleteObject`,
`putObject`). A new backend (e.g. R2) means implementing it, wiring it into the
factory in `src/lib/storage/index.ts`, **and widening the
`StorageProviderName = "s3" | "do-spaces" | "local-fs"` union** — the name is not
a free-form string.

## Production-run readings import

Telemetry rides the same document pipeline, then persists in a second step:
upload a `sensor_data` document against the `production_run`, and
`src/fn/production-run-reading-imports.ts` imports it (fires automatically on
upload). See [ADR 0006](./adr/0006-data-upload-submission-idempotency.md) for how
these reach the registry.

The importer takes a **canonical CSV** with a full UTC timestamp per row, so one
file can span multiple days — no column-mapping step and no filename convention.
Headers are matched case-insensitively and each canonical column has an alias list
(`timestamp_utc` also accepts `timestamp`, `time_utc`, `time (utc)`,
`datetime_utc`, `datetime`; `temperature_c` also `temperature`/`temp_c`/`temp`;
etc.) — the header comment in `src/lib/production-readings/readings-csv.ts` is the
contract. Extra columns are ignored.

PLC dropouts (`---` or blank) in `temperature_c`/`pressure_bar` do **not** drop the
row: the channel is stored as null and the row is counted in `invalidRequiredRows`
so the import summary doesn't overstate usable telemetry. Rows are clipped to the
run's `start_time`/`end_time`; out-of-window and unparseable-timestamp rows are
reported separately. An import replaces existing readings only within the span it
covers (min…max of accepted rows), so separate files for different periods are
additive. XLSX may be stored as generic `sensor_data` evidence (the upload rule is
tabular) but is never parsed into `production_run_readings`.

## CORS (production buckets only)

The browser PUT is cross-origin, so DO Spaces / S3 must allow it:

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

DO Spaces: *Spaces → Settings → CORS Configurations*. AWS S3: bucket
*Permissions → CORS*. local-fs needs none — `/api/storage-local/...` is
same-origin.

## Testing

`pnpm storage:smoke` (`scripts/storage-smoke.ts`) does a real round-trip against
the configured bucket — presigned PUT → HEAD → signed GET byte-for-byte → DELETE →
HEAD 404 — covering exactly what the unit-test fakes deliberately don't:
credentials, region/endpoint, path-style addressing, bucket permissions. It
refuses to run against `local-fs` (exit 2), runs daily against staging via
`.github/workflows/storage-health.yml`, and **does not test browser CORS** — only a
real cross-origin PUT from the app exercises that.

Unit coverage lives in `tests/documents-*.test.ts` and `tests/*storage*.test.ts`
(plus `tests/parent-document-retirement.test.ts`). Conventions:
[testing.md](./testing.md). Known failure modes:
[troubleshooting.md](./troubleshooting.md).
