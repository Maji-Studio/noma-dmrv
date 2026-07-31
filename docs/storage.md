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

## Reads always go through an app route

The client never talks to the bucket except for the one-shot presigned PUT. All
ordinary reads go through `/api/documents/[id]`; external verifier reads go
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

**Ordinary logical key** (stored in `documents.storage_key`, no leading `/`):

```text
org/{organizationId}/{entityType}/{entityId}/{documentType}/{ulid}.{ext}
```

- `buildStorageKey()` builds only the
  `{entityType}/{entityId}/{documentType}/{ulid}.{ext}` suffix; the owning
  server action prepends `org/{ctx.organizationId}/`. Never accept the
  organization segment from client input.
- Original filename lives in `documents.file_name`, NOT in the key — avoids
  URL-encoding pain and PII leakage via names like `"Smith - Confidential.pdf"`.
  ULID sorts by upload time; `entityType`/`entityId` lead within each
  organization namespace so bucket browsing mirrors app navigation.
- `buildStorageKey()` (`src/lib/storage/keys.ts`) is the only place keys are
  built — never construct one by hand. **It may return a key with no extension**:
  `extractExtension` accepts only `[a-z0-9]{1,12}` and drops anything else, so
  code that infers content type from the key extension will break.

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
a new report version and object, so it uses the ordinary key builder under the
`ghgStatementReport` entity namespace. These are logical keys: the
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

Flipping public is a one-row `UPDATE documents SET visibility = 'public'` — no
provider call, no object copy, portable across providers that don't honor ACLs.

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

**1. Presigned upload** — `src/fn/documents.ts`: `requestUpload` → client PUT →
`confirmUpload`. `confirmUpload`'s `headObject` is the **authoritative** size +
content-type gate and the security boundary; client-side and `requestUpload`-time
checks are best-effort UX, because presigned PUTs can't reliably enforce
content-length across S3-compatible providers. On rejection the object is deleted
immediately and `upload_status` becomes `'failed'`.

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

Every documents server action goes through
`assertCanManageDocumentEntity(ctx, entityType, entityId)` — **the storage layer
itself has no authz.** `DOCUMENT_ENTITY_TYPES` enumerates what a user-uploaded
document can hang off.

Per-documentType size and MIME rules live in `src/schemas/documents.ts`
(`UPLOAD_RULES`, `isAllowedMime`, `maxBytesFor`) — read them there, they change.
All user-uploaded document types currently share a 10 MB cap defined once in
`src/lib/documents/upload-policy.ts`; UI limits are clamped to that server policy.
Future file reduction (for example image processing with Sharp) should be a
preprocessing step that produces the final artifact before `requestUpload`, so
both the request check and authoritative `confirmUpload` HEAD check apply to the
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
`createUploadUrl`, `createDownloadUrl`, `headObject`, `deleteObject`,
`putObject`). A new backend (e.g. R2) means implementing it, wiring it into the
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

Legacy telemetry import and registry submission modules remain in the codebase
for historical experiments. They are not called by the operator readings-file
upload.

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
