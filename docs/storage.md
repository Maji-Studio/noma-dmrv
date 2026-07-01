# Object Storage

File uploads (lab reports, photos, COAs, calibration certificates,
production readings CSVs, etc.) are stored in S3-compatible object
storage. The provider is chosen via
the `STORAGE_PROVIDER` env var:

- **`s3-compatible`** (production) — DigitalOcean Spaces or AWS S3. Same
  code path; only the `STORAGE_ENDPOINT` differs.
- **`local-fs`** (dev/test) — filesystem-backed provider that simulates
  the same presigned-PUT / presigned-GET flow. Stores objects under
  `.storage/` (gitignored). The matching API route at
  `/api/storage-local/[...key]` accepts uploads.

Production rejects `local-fs` at env-validation time as a security
safeguard (see `src/config/env.ts` `superRefine`).

## Architecture

```
                                  ┌────────────┐
   Client ── presigned PUT ───►  │ DO Spaces  │
     │                            │ / AWS S3   │
     │                            └────────────┘
     │                                   ▲
     │                                   │ signed GET
     ▼                                   │
   ┌─────────────────────────────────────┴───┐
   │  Next.js server                          │
   │   • POST requestUpload  → mints PUT URL  │
   │   • POST confirmUpload  → HEAD verify    │
   │   • GET /api/documents/[id]  → 302 GET   │
   └──────────────────────────────────────────┘
```

The client never sees S3 directly except for the one-shot PUT URL. All
reads go through `/api/documents/[id]`, which mints a fresh signed GET
on each request. **The app never embeds signed URLs in HTML or the DB**
— so the user never sees "URL expired".

## Bucket convention

One bucket per environment: `noma-dev`, `noma-staging`, `noma-prod`.

**Key format** (no leading `/`):

```
{entityType}/{entityId}/{documentType}/{ulid}.{ext}
```

Example: `sample/3a7e.../lab_report/01hn93.....pdf`

- Original filename lives in `documents.file_name`, NOT in the key.
  This avoids URL-encoding pain and accidental PII leakage via
  filenames like `"Smith - Patient Confidential.pdf"`.
- ULID is sortable by upload time → useful bucket browsing.
- `entityType` and `entityId` lead so bucket-level traversal mirrors
  app navigation.

The single chokepoint for building keys is `buildStorageKey()` in
`src/lib/storage/keys.ts`. Always use it; never construct keys
manually.

## Visibility

**Objects always stay private at the storage layer.** Visibility is a
DB-only concept enforced by `/api/documents/[id]`:

| `documents.visibility` | Anonymous request | Authed request |
| ---------------------- | ----------------- | -------------- |
| `private`              | 401               | 302 → signed GET |
| `public`               | 302 → signed GET  | 302 → signed GET |

Flipping public is a one-row `UPDATE documents SET visibility =
'public'` — no provider-specific call, no object copy. This keeps the
design portable across S3-compatible providers that may not honor
object ACLs.

## Adapter interface

`src/lib/storage/types.ts` defines `StorageProvider`:

```ts
interface StorageProvider {
  name: string;
  createUploadUrl(args): Promise<PresignedUpload>;
  createDownloadUrl(args): Promise<string>;
  headObject(key): Promise<ObjectHead | null>;
  deleteObject(key): Promise<void>;
}
```

To add a new backend (e.g. Cloudflare R2): implement this interface in
`src/lib/storage/r2.ts` and wire it into the factory in
`src/lib/storage/index.ts`. No other code needs to change.

## Upload flow

```
Client                       Server                      Storage
  │ pick file                 │                            │
  │── requestUpload(meta) ───►│                            │
  │                           │── createUploadUrl(key) ───►│
  │                           │◄────── presigned PUT ──────│
  │                           │── INSERT documents pending │
  │◄── { documentId, url } ───│                            │
  │── PUT file ──────────────────────────────────────────►│
  │◄── 204 ─────────────────────────────────────────────── │
  │── confirmUpload(docId) ──►│                            │
  │                           │── headObject(key) ────────►│
  │                           │◄────── size, contentType ──│
  │                           │   (size/MIME gate)         │
  │                           │── UPDATE upload_status=ok  │
  │◄── 200 ───────────────────│                            │
```

`confirmUpload` is the **authoritative** size + content-type gate. The
client-side and `requestUpload`-time checks are best-effort UX —
presigned PUTs can't reliably enforce content-length across S3-compatible
providers, so the HEAD verification step is the security boundary.

If `confirmUpload` rejects, the object is immediately deleted and
`upload_status` is set to `'failed'`.

## Production-run Readings Import

Production-run telemetry uses the same document pipeline, but persistence is a
two-step operation:

1. Upload a `sensor_data` document against the `production_run`.
2. Import that uploaded document through
   `src/fn/production-run-reading-imports.ts` (fires automatically on upload).

The importer accepts a **canonical CSV** with a full UTC timestamp per row, so a
single file can span multiple days. Columns are matched by header
(case-insensitive; extra columns are ignored) — there is no column-mapping step
and no filename convention:

| Column                  | Required | Unit | Notes |
|-------------------------|----------|------|-------|
| `timestamp_utc`         | yes      | ISO-8601 UTC | e.g. `2026-04-02T22:15:00Z`; zone-less values are read as UTC |
| `temperature_c`         | yes      | °C   | |
| `pressure_bar`          | yes      | bar  | |
| `dryer_frequency_hz`    | optional | Hz   | blank cell → null |
| `reactor_frequency_hz`  | optional | Hz   | blank cell → null |

Parsing lives in `src/lib/production-readings/readings-csv.ts`. Rows are clipped
to the production run's `start_time`/`end_time` window (a run may span multiple
days but is itself bounded by its credit batch); out-of-window and
unparseable-timestamp rows are reported in the import summary. An import replaces
existing readings only within the span it covers (min…max of the accepted rows),
so importing separate files for different periods is additive. XLSX files may
still be stored as generic `sensor_data` evidence because the upload rule is
tabular, but they are not parsed into `production_run_readings`.

## CORS configuration (production buckets only)

The browser PUT is cross-origin. DO Spaces / S3 must allow it:

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

For DO Spaces, configure via the control panel under
*Spaces → Settings → CORS Configurations*. For AWS S3, set via the
bucket's *Permissions → CORS* tab.

The local-fs provider doesn't need CORS — `/api/storage-local/...`
shares an origin with the rest of the app.

## Per-documentType limits

Defined in `src/schemas/documents.ts` (`UPLOAD_RULES`). Edit there to
tune:

| Type | Max size | MIME types |
| ---- | -------- | ---------- |
| `lab_report` | 50 MB | PDF, images, CSV, XLSX |
| `pdd` | 50 MB | PDF |
| `video` | 100 MB | mp4, webm |
| `photo` | 25 MB | png, jpeg, gif, webp |
| `sensor_data` | 25 MB | CSV, XLSX for storage; production-run readings import parses CSV only |
| (others) | 25 MB | PDF + images |

The local-fs route also enforces a hard `LOCAL_FS_GLOBAL_MAX_BYTES =
100 MB` ceiling as a defense-in-depth backstop.

## Testing

- `tests/documents-fn.test.ts` — `requestUpload` / `confirmUpload`
  with injected fake provider via `__setStorageProviderForTests`.
  Covers happy path, oversize rejection, content-type mismatch
  rejection, unauth, and re-confirm refusal.
- `tests/documents-route.test.ts` — `/api/documents/[id]` covering all
  5 branches of the resolution order (visibility gate, storage key,
  legacy `fileUrl`, pending refusal, invariant violation).
- `tests/storage-local-fs.test.ts` — path-safety + HMAC token
  round-trip / tampering / expiry tests.

## Related

- `src/lib/storage/` — provider implementations.
- `src/fn/documents.ts` — server actions.
- `src/hooks/use-file-upload.ts` — client-side upload orchestration.
- `src/fn/production-run-reading-imports.ts` — document-backed readings
  preview/import.
- `src/components/forms/form-file-upload.tsx` — UI component.
- `src/components/samples/sample-documents-panel.tsx` — first
  production integration (sample evidence panel).
