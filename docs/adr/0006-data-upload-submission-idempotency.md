# DataUploadSubmission idempotency uses journaled-step IDs, not supplier-reference reconciliation

> **Current status: Accepted and implemented in the server pipeline**
> (reviewed 2026-07-29). `src/fn/certification/submit-telemetry.ts` journals
> FileUpload and DataUploadSubmission step IDs and implements the resume/status
> paths described here. `tests/isometric-submission-claim.test.ts` covers the
> ADR 0006 decision matrix. The UI remains dark: `TelemetryPanel` exists but is
> not rendered, so this is not an operator-live workflow.
>
> **Historical status (2026-05-29): Accepted, design-only.** Scopes Phase 5
> Slice A (biochar reactor time-series upload). Departs from the supplier-reference
> reconciliation pattern used by every other outbound POST in the
> integration (`submitRemoval`, GHG Statement create, Sources mirror,
> Datapoint create).

## Context

Phase 5 Slice A adds outbound `POST /data-upload-submissions` to noma
to push hourly-aggregated biochar reactor telemetry as Parquet. The
pipeline is three sequential POSTs:

1. `POST /file-uploads` → `{ file_upload_id, upload_url }`
2. `PUT <upload_url>` with Parquet bytes (5-minute signed-URL TTL,
   per sandbox probe `X-Goog-Expires=300` on 2026-05-29)
3. `POST /data-upload-submissions` with the file_upload_id →
   `data_upload_submission_id`

Each step can fail independently (network drop, process crash, 5xx).

The rest of noma's certification integration relies on
**supplier-reference reconciliation** (`ADR 0003` / integration-plan
§Idempotency design) — every outbound POST carries a stable
`supplier_reference_id`, and recovery on a stale lock calls
`GET /<resource>?supplier_reference_id=…` to find the orphaned record
and claim it. The sandbox probe on 2026-05-29 confirmed:

- `CreateDataUploadSubmissionRequest` (`certify.d.ts:1619`) has **no
  `supplier_reference_id` field**.
- `GET /data-upload-submissions` exposes no query parameter we can
  filter by from the noma side (status / submission_type only).
- `POST /file-uploads` returns only `{ id, upload_url }` — no
  caller-supplied reference accepted.

Conclusion: if noma POSTs step 1 or step 3 and loses the response
(crash, network drop, restart), there is **no API path to rediscover
the resulting record on Isometric's side**. The supplier-reference
reconciliation arm in `decideSubmissionClaim` is unreachable.

## Decision

Adopt a **journaled-step ID model** scoped to a single short-lived
server action; reconcile by **stored Isometric IDs**, not by
supplier-reference.

### 1. New `submissionType = 'dataUpload'` branch in `certificationSubmissions`

One ledger row per `(certifierRemovals.id, submissionType='dataUpload')`.
`localEntityType='removal'`, `localEntityId=certifierRemovals.id`.
Reuses the existing table — no new persistence primitives.

### 2. `payloadHash` covers source-data inputs, not Parquet bytes

`payloadHash = sha256(canonicalJson({ facilityId, externalFacilityId,
  windowStart, windowEnd, bucketSeconds, sensorRefs,
  sourceProductionRunIds, sourceReadingsDigest, aggregatedRowCount }))`

Why not the Parquet bytes themselves: Parquet binary output is
non-deterministic across `hyparquet-writer` versions (compression
codec defaults, row-group boundary heuristics, metadata ordering),
and a Parquet-bytes hash would force a new version on every library
bump even when the source data is unchanged. Hashing the source-data
inputs keeps the lock-and-resume semantics meaningful.

### 3. Step IDs are journaled into `payloadSnapshot` after each step

The existing JSONB `payloadSnapshot` column accumulates step by step
within a single server action invocation:

```text
After step 1 (POST /file-uploads):
  { fileUploadId, uploadUrl, uploadUrlExpiresAt, parquetSchemaVersion }
After step 2 (PUT to upload_url):
  …+ { parquetBytesSha256, parquetBytesLength }
After step 3 (POST /data-upload-submissions):
  certificationSubmissions.externalId := dataUploadSubmissionId
  status := 'submitted'
```

No new columns or migration — `payloadSnapshot` is already JSONB.

### 4. Reconciliation reads stored IDs, not supplier-reference

`decideSubmissionClaim`'s `dataUpload` branch on a stale lock:

| Stored state | Action |
|---|---|
| `dataUploadSubmissionId` present | `GET /data-upload-submissions/{id}` → map `pending`/`completed`/`failed` to local status. Done. |
| `fileUploadId` present, no submission ID, `uploadUrlExpiresAt > now+30s` | Re-PUT the Parquet to the existing `upload_url` (signed URLs are idempotent), then `POST /data-upload-submissions`. |
| `fileUploadId` present, URL expired | Treat as orphan; start over from step 1 with a new ledger version. |
| Nothing journaled | Start from step 1. |

### 5. The whole pipeline runs in a single short-lived server action

Because the signed `upload_url` TTL is 5 minutes (probed against
sandbox 2026-05-29: `X-Goog-Expires=300`), splitting steps across user
interactions is brittle. The operator clicks "Submit Telemetry," and
the server action runs all three steps inline. The journaled-step
recovery model handles only **within-action** crashes (process
restart, 5xx, timeout) — not "user closed the tab between clicks."

### 6. Orphan `FileUpload` records in Isometric are accepted

A crash *during* step 1 — POST sent, response lost — leaves a
FileUpload record in Isometric that noma can never re-find. This is
tolerable: a FileUpload without an attached DataUploadSubmission is an
unused blob, not verifier-visible state. We do not chase it.

### 7. No auto-retry on `status: failed`

When `GET /data-upload-submissions/{id}` returns `status: 'failed'`,
the ledger row goes to `rejected` and `error_message` lands in
`payloadSnapshot.lastError`. The UI surfaces the error and a manual
**Retry** button; clicking it creates a new ledger version (N+1) and
re-runs the pipeline. Auto-retry is intentionally absent because
`failed` always means human-attention-needed (Parquet shape rejected,
sensor unknown, data invalid).

## Consequences

- **`decideSubmissionClaim` grows one branch.** Test matrix in
  `tests/isometric-submission-claim.test.ts` extends from 18 → ~24
  cases covering the new dataUpload paths. Pure-function tests; no
  fixture pollution.
- **Recovery is narrower** than the rest of the integration. A
  pathological "POST sent, response permanently lost" case leaves an
  orphan FileUpload — acceptable per (6).
- **No new tables, no new migration.** Reuses
  `certificationSubmissions` (and adds the new `certifier_sensors`
  table tracked separately under integration-plan Phase 5 Slice A).
- **The integration plan's "no skip-if-external-id-exists idempotency"
  rule still holds.** The new branch still locks + hashes + journals;
  the only departure is the discovery mechanism on a stale lock.

## Alternatives considered

### A. Wait for Isometric to add `supplier_reference_id` to `DataUploadSubmission`

Cleanest from a model-consistency standpoint — the existing
reconciliation pattern would extend unchanged. Rejected because:

- The feature request is unfilled and we do not control Isometric's
  roadmap.
- The 5-minute URL TTL on `POST /file-uploads` would still force step
  1 + step 2 into a single short-lived server action regardless of
  supplier-reference support — the journaled-step model is needed for
  the within-action recovery story even if step 3 gained
  supplier-reference reconciliation.
- File feedback with Isometric via the MCP `submit_feedback` tool;
  revisit this ADR if supplier-reference lands later.

### B. Embed a noma-controlled tag in `file_name` and rediscover via list

`CreateFileUploadRequest.file_name` is documented as "display
purposes only" — not queryable. Even if it were, `GET /file-uploads`
isn't exposed. Rejected on no-discovery-path grounds.

### C. Synchronously block until `status: completed`

Polling `GET /data-upload-submissions/{id}` inside the server action
until terminal. Rejected — Isometric's processing time is "a few
minutes" per docs (2026-05-29
`docs.isometric.com/user-guides/certify/time-series-data-upload`),
exceeding Vercel's serverless function timeout budget. We accept the
two-state UI ("submitted" → "completed/failed", revealed via
follow-up GET on next page load or user-initiated refresh).

### D. Use `MonitoringSubmission` (`POST /projects/{id}/monitoring_requirements/{id}/submissions`) instead of bulk Parquet

Different API surface — structured per-requirement submissions
rather than facility-level time-series. Deferred to Slice C per
integration-plan Phase 5. Sliced out, not rejected.

## Resolution

Resolves the Phase 5 idempotency sub-question raised in the
2026-05-28 grilling session. Tracks Phase 5 Slice A only — Slices B
(biochar_applications) and C (MonitoringSubmission) remain open under
`docs/open-questions.md` and re-enter the design process when
prioritised.
