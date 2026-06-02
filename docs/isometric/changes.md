# Isometric Docs Change Log

## 2026-06-02 (robustness pass — redirect allowlist + submit rate limit)

Resolves three deferred items from `docs/open-questions.md`. No schema/migration
changes; behaviour-affecting where noted.

- **Document-redirect open-redirect closed** (`certification/report-url-allowlist`).
  The `/api/documents/[id]` route's `fileUrl` 302 branch now host-gates the
  target via `src/lib/documents/redirect-allowlist.ts`: allowed = our own origin
  (`NEXT_PUBLIC_APP_URL`) + the configured `STORAGE_ENDPOINT` host + the registry
  / cloud-storage families (`.isometric.com`, `.amazonaws.com`, `.googleapis.com`,
  `.digitaloceanspaces.com`). Embedded credentials (`user:pass@host`) are refused
  outright. Off-allowlist hosts fail closed (502) and are logged (id + host only,
  no PII). **Behaviour change:** operator-pasted GHG-statement report URLs on
  arbitrary hosts now fail closed — Isometric-synced report URLs and same-origin
  links continue to resolve. Decision: "allowlist + cloud hosts" (operator
  2026-06-02) over a strict same-origin-only lock that would have broken the
  Isometric-synced report path. Sibling guard to the upload-host allowlist in
  `@/lib/isometric/utils/signed-upload`.

- **Submit-action rate limiting added** (`security/rate-limit-submissions`).
  `withAction` gained an opt-in `rateLimit` option; the three registry submit
  actions (`submitRemovalAction` + `submitCreditBatchRemoval`,
  `submitGhgStatementToVerifier`, `submitTelemetryAction`) pass it — 5/min/user
  per pipeline, keyed `cert:submit-*:<userId>`. Backed by a process-local
  sliding-window limiter (`src/lib/rate-limit/in-memory.ts`). This is
  defense-in-depth only — ADR 0006 idempotency already makes a fast double-submit
  a no-op; the limiter blunts scripted/runaway bursts. **Known limitation:** the
  store is per-instance, so on Fluid Compute the effective ceiling is
  `5 × instanceCount`. Decision: in-memory over DB-backed (operator 2026-06-02),
  proportionate to a non-correctness guard; swap to a DB/Redis bucket if an exact
  cross-instance limit is ever needed.

- **Form a11y + cert error boundary** (landed earlier this session, commit
  `33920f5`): `FormField`/`FormError` now wire `aria-describedby`; `Modal` warns
  in dev when it has no accessible name; `(app)/certification/error.tsx` segment
  error boundary added. Closes `certification/error-boundary` and the
  `FormField`/`FormError` half of `forms/a11y-shared-layer` (the `useDialog`
  focus-restore half remains open).

## 2026-05-29 (Phase 5 Slice A shipped — telemetry pipeline end-to-end)

Builds on the same-day scoping entry below. Implements the design ADR 0006
locked, with no behaviour change to existing flows.

- **Migration 0029 `heavy_umar`** — additive. New `certifier_sensors`
  table (`reactor_id` FK, `measurement_property` text, `external_sensor_id`,
  `sensor_reference`, `units`) with `unique (reactor_id, measurement_property)`
  and `unique (provider, sensor_reference)`. `measurement_property` is the
  pipe-encoded `MeasurementProperty` (`<kind>` or `<kind>|<qualifier>`) so
  the unique constraint correctly dedups the null-qualifier case Postgres
  unique permits multiple of. New `certifier_projects.external_facility_id`
  text column — operator pastes the `fcl_…` from the Certify UI before
  submitting telemetry (Isometric exposes no `POST /facilities`).
  - **Note on numbering:** the integration-plan stub said "0028 pending";
    by the time this shipped, an unrelated FK-on-delete migration had
    already taken 0028 (`demonic_harpoon`), so the Slice A migration is
    0029. Ledger updated.
- **`src/lib/isometric/transformers/data-upload.ts`** — pure aggregator.
  Buckets `production_run_readings` rows into clock-aligned 60-second
  windows per `(reactor × channel)`; computes min, max, mean, median,
  count, population stddev, first_ts, last_ts per bucket; drops buckets
  with `count = 0`; sorts deterministically by `(start, sensorRef)` so
  the downstream Parquet bytes are stable. Slice A channels: temperature
  + pressure (matches the smoke probe).
- **`src/lib/isometric/parquet/writer.ts`** — thin `hyparquet-writer`
  wrapper that builds an explicit `SchemaElement[]` with `INT64 +
  logical_type TIMESTAMP NANOS` on the four timestamp columns. Column
  order + tags match `scripts/probe-parquet-smoke.mts` exactly (the
  contract validated against the sandbox on 2026-05-29). `bigint` values
  are constructed via `BigInt(…)` instead of the `1_000_000n` literal so
  the project's ES2017 `target` does not reject the file.
- **`src/lib/isometric/sensors.ts`** — typed `POST /sensors`,
  `GET /sensors/{id}`, `findSensorByReference` (claims an orphan remote
  sensor on a sandbox-reset path). Includes a stable
  `buildSensorReference` (`nm-snr-<reactor-short-hash>-<property-slug>`)
  so reconciliation is deterministic.
- **`src/data-access/certifier-sensors.ts`** — `ensureSensorForReactor`
  reconciles by sensor reference before POSTing, so a partial run that
  lost the local row does not mint a duplicate Isometric sensor; uses
  `onConflictDoUpdate` against the unique constraint to absorb a
  concurrent race winner's external ids.
- **`src/lib/isometric/utils/submission-claim.ts`** — extended with the
  `dataUploadResume` branch per ADR 0006 §4. New claim kinds
  (`resume-poll-existing` / `resume-re-put`) and a
  `dataupload-orphan-restart` `create-new-version` reason. Picks the
  right step-specific recovery action from the journaled
  `payloadSnapshot.journaled` state on a stale lock; falls through to
  the existing `resume` kind when nothing has been journaled. Test
  matrix extended from 18 → 24 cases covering every new branch + a
  sub-threshold URL-freshness case (race-safe expiry handling).
- **`src/fn/certification/submit-telemetry.ts`** —
  `withAction`-wrapped server action. Loads the removal context, ensures
  a sensor per `(reactor × channel)`, pulls readings clipped to the
  derived clock window, aggregates, builds Parquet, then runs the three
  POSTs (`/file-uploads` → `PUT signed_upload_url` →
  `/data-upload-submissions`) inline with `journalStep` after each step
  so the journaled state is current for any resume. Hash covers
  source-data inputs (sensorRefs, sourceReadingIds, window), not Parquet
  bytes — ADR 0006 §2 rationale. Single ledger row per
  `(removal, submissionType='dataUpload')`. Surfaces a `SafeError` when
  `certifier_projects.external_facility_id` is empty.
- **`src/components/certification/telemetry-panel.tsx`** + the
  `useTelemetrySubmissionState` / `useSubmitTelemetry` hooks. Mounted on
  `/certification/removals/[removalId]` below the existing SourcesPanel.
  Submit button + status badge (maps remote `pending|completed|failed`
  to verified/running/rejected) + an Isometric-error display.
- **Integration test** — `tests/isometric-sandbox.integration.test.ts`
  gains a write-path case that exercises the byte path through the real
  `lib/isometric` + `transformers/data-upload` + `parquet/writer`
  modules end-to-end against sandbox. Gated by `ISOMETRIC_DEMO_FACILITY_ID`
  in addition to the existing `RUN_ISOMETRIC_SANDBOX_TESTS=1` gate, so
  CI without facility credentials skips cleanly.
- **`scripts/probe-*`** kept as reference (the parquet-smoke pattern is
  the implementation blueprint); tsconfig now excludes
  `scripts/probe-*` so the throwaway `.mts` extension import does not
  break `tsc`.
- **Typecheck + tests green** — 300 unit tests passing (24 from the
  extended submission-claim matrix); typecheck clean; lint clean of new
  errors (36 pre-existing warnings unchanged).

## 2026-05-29 (Phase 5 Slice A scoped — biochar reactor time-series)

Design-only update. No code changes; no schema migration; the noma
codebase is unchanged outside throwaway sandbox probes under
`scripts/probe-*`. The 2026-05-28 grilling session resolved every
design fork for the Parquet-bulk upload slice of Phase 5; this entry
records the conclusions so the integration plan reads as a buildable
spec.

- **Phase 5 row rewritten** (`integration-plan.md` §Phase status) — was
  "Not started"; now **Slice A scoped**, Slices B (`POST
  /biochar_applications`) and C (`MonitoringSubmission`) deferred to
  `open-questions.md`.
- **[ADR 0006](../adr/0006-data-upload-submission-idempotency.md) —
  DataUploadSubmission idempotency uses journaled-step IDs.** The
  `CreateDataUploadSubmissionRequest` schema has no
  `supplier_reference_id` field, breaking the reconciliation pattern
  every other outbound POST in the integration uses. The decision:
  carry `{ fileUploadId, uploadUrl, uploadUrlExpiresAt,
  dataUploadSubmissionId, parquetBytesSha256 }` in
  `certificationSubmissions.payloadSnapshot` step-by-step within a
  single short-lived server action, and reconcile by stored Isometric
  IDs on a stale lock. Orphan FileUpload records (POST sent, response
  lost) are tolerated — verifier-invisible.
- **Migration 0028 stubbed** — additive: `certifier_sensors` table +
  `certifier_projects.external_facility_id` column. No destructive
  ops, no constraint drops.
- **Per-facility bootstrap step added** — operator must create the
  biochar facility in Certify UI (no `POST /facilities` endpoint
  exposed) and paste the resulting `fac_…` ID into noma. Same pattern
  as `externalProjectId` today. Until pasted, the "Submit Telemetry"
  button stays disabled on the Removal page.
- **Parquet writer choice: `hyparquet-writer`** (most recently
  maintained pure-JS option, last published 2026-05-25), with the
  `INT64 + TIMESTAMP_NANOS` logical-type override to match Isometric's
  `timestamp[ns]` spec. De-risk step: write 10 rows + post to sandbox
  end-to-end before any schema migration; fall back to `parquet-wasm`
  only if nanos override fails to clear sandbox ingest.
- **Aggregation window: 60-second clock-aligned** (corrected from the
  1-hour decision made earlier the same day). The sandbox smoke
  surfaced an undocumented hard cap on `aggregation_period_end -
  aggregation_period_start`:
  `AggregationPeriodDurationInvalidError: Aggregation period of 3600.0
  seconds exceeds maximum allowed of 60 seconds`. Buckets are clock-
  aligned per facility; only buckets with `count > 0` are emitted.
  Source-of-truth filter is pure clock window on
  `production_run_readings.timestamp` against the Removal's reporting
  period (no whole-run inclusion, no lineage scoping — see ADR 0006
  §Decision for rationale). File-size impact: 30-day window × 2
  sensors at 1-min cadence ≈ 86 k rows max, ~1–2 MB Parquet
  (compressed), well under the 100 MB per-upload cap.
- **Sandbox probes lodged in `scripts/probe-*.{ts,mts}`** (`THROWAWAY`
  headers) — confirmed: biochar submission_type accepted; sensor
  measurement_property enums accepted with lowercase only;
  `application/vnd.apache.parquet` file uploads work; signed upload
  URL TTL is **5 minutes** (`X-Goog-Expires=300`), not the 24h I
  assumed in early scoping — pipeline must run in one server action.
  Full end-to-end smoke (`probe-parquet-smoke.mts`) creates 2 sensors,
  generates a 10-row Parquet via hyparquet-writer, PUTs to signed URL,
  POSTs the DataUploadSubmission, polls to terminal — succeeded
  through step 6 and surfaced the 60-second cap on step 7's failure
  response, validating both the Parquet bytes layer and the
  journaled-step idempotency model end-to-end.
- **Two doc bugs filed under `open-questions.md`** for Isometric MCP
  `submit_feedback`: (1) UPPERCASE enum values in the docs prose vs.
  lowercase in the live API; (2) DAC-only intro paragraph on a page
  that lists biochar measurement properties.

## 2026-05-26 (Phase 3.5 hardening — source-mutation correctness)

Follow-up to the Phase 3.5 ship, addressing five findings from a
post-ship audit (two P1 concurrency / authorization, one P1 race, two
P2 reconciliation + tests). No data migration; behaviour change is
strictly stricter (mutations that previously succeeded under the gaps
below now refuse).

- **Transactions actually scope the work** — `mirrorDocumentToSource`,
  `unlinkDocumentSource`, and (new) `setDocumentSourceVisibility` open
  a transaction and thread `tx` through every data-access read/write
  inside. The six functions in
  `src/data-access/certifier-document-uploads.ts` now accept an
  optional trailing `txOrDb: DbClient` (default `db`), matching the
  existing pattern in `applications.ts` / `credit-batches.ts` /
  `production-runs.ts`. The advisory locks now bracket real work
  instead of a no-op closure.
- **Source mutations scoped to the removal's lineage** —
  `unlinkDocumentSourceSchema` and `setDocumentSourceVisibilitySchema`
  now require `removalId` in addition to `documentId`. The new
  `assertDocumentIsCandidateForRemoval(userId, removalId, documentId)`
  helper walks the same lineage `loadCandidateDocumentsForRemoval`
  shows the panel, and refuses if the document isn't in the candidate
  set. Closes the IDOR where any authenticated user who learned a
  document UUID could unlink or flip visibility on a Source mirrored
  under another removal / facility.
  `src/hooks/use-certification-sources.ts` stamps `removalId` onto the
  hook input so UI callers don't change.
- **Submit / unlink / mirror interlock on one lock key** —
  `src/lib/isometric/utils/source-lock.ts` (new) defines
  `mirrorLockKey(documentId) = "mirror:isometric:{documentId}"` plus
  `acquireMirrorLock(tx, id)` and `acquireMirrorLocksSorted(tx, ids)`.
  mirror, unlink, and submit (per-document, sorted to prevent ABBA)
  all serialize on the same key. `submitRemoval`'s create-new-version
  branch now uses the new composable
  `insertDraftSubmissionWithMappingLockAndLocks(userId, guard, prepare)`
  data-access helper: it opens the tx, takes the mapping lock FIRST
  (consistent lock order: `mapping → mirror[sorted]`), invokes a
  caller-supplied `prepare(tx)` that acquires the per-document locks
  and re-resolves source IDs inside the lock, then inserts the draft
  snapshot in the same transaction. If the locked re-resolution
  differs from the tentative set (concurrent mirror/unlink committed
  during lock acquisition), the hash and `datapointBodies` are rebuilt
  once before insert. Closes the snapshot-orphan race.
- **`isPublic` reconciliation trusts the registry** — when
  `findSourceBySupplierRef` returns an existing remote Source on the
  recovery path, the persisted local metadata uses
  `remoteExisting.is_public` instead of the caller's requested value.
  Closes the case where two attempts with different `isPublic`
  intentions could leave local + Isometric disagreeing.
- **Recovery-flow integration tests** —
  `tests/isometric-sources-mirror-flow.test.ts` (new, 4 tests) covers
  the two approval-gate paths (GET found → `signed_upload_url` 200 →
  PUT → insert, and GET found → 409 → insert), the reconciled
  `isPublic` contract, and rejection of out-of-lineage documents.
  Mocks the Isometric client, storage provider, and data-access
  layer; runs against the real server action.
- **Three insert variants in `src/data-access/certification.ts`
  collapsed** — extracted `insertDraftSubmissionRow(tx, input)` (single
  source of truth for the row shape) and
  `withUniqueViolationGuard(fn)` (centralizes the 23505 →
  `SafeError("Submission already in progress")` mapping).
  `insertDraftSubmissionWithMappingLock` now delegates to
  `…AndLocks`; `insertDraftSubmission` shares the same guard.
- **Provider literals moved to non-server module** —
  `src/lib/isometric/utils/constants.ts` (new) holds
  `ISOMETRIC_PROVIDER`, `REMOVAL_SUBMISSION_TYPE`,
  `REMOVAL_ENTITY_TYPE`, `GHG_STATEMENT_SUBMISSION_TYPE`,
  `GHG_STATEMENT_ENTITY_TYPE`. `src/fn/certification/shared.ts`
  re-exports them so the existing import surface keeps working, but
  utils that can't cross the `"use server"` boundary
  (`source-lock.ts`) import directly.
- **Cross-provider scoping on snapshot reference check** —
  `isExternalSourceReferencedInSnapshots` now filters by `provider`
  (forward-compat: only `isometric` issues source_ids today, but the
  enum permits `puro_earth` and `verra` and nothing structurally
  prevents two providers from generating the same id string).
- **Sources panel syncs local visibility with refetched data** —
  `src/components/certification/sources-panel.tsx` adds a `useEffect`
  resetting the `isPublic` toggle from `mirror?.isPublic` so a
  cross-tab visibility flip doesn't leave a stale UI value.

Open-questions trail: closes `isometric/sources-integration-tests` and
`isometric/sources-submit-lock`; opens
`isometric/sources-lock-hold-time` (mirror lock held across HTTP) and
four `code/*` deferred-simplification entries.

Tests: 294 passing, typecheck clean.

## 2026-05-26 (Phase 3.5 — Sources upload landed)

Ships Phase 3.5 end-to-end. noma `documents` rows mirror to Isometric
Sources via server-side proxy, the resulting `source_ids` ride into
every monitored Datapoint payload, and the resolved set is part of the
semantic hash so a mirror or unmirror supersedes the Removal version.
No DB migration — `certifier_document_uploads` (created in migration
0000) gets its first writers.

- **Server-side mirror flow** —
  `src/fn/certification/sources.ts` (`mirrorDocumentToSource`):
  pre-flight (storage key + size ≤ 50 MB + recorded MIME +
  `headObject` size match) → advisory lock keyed on
  `mirror:isometric:{documentId}` → reconciliation
  (`GET /sources?supplier_reference_id=…` → if found,
  `POST /sources/{id}/signed_upload_url` → 200 re-PUT or 409 already
  uploaded) or fresh (`POST /sources`) → host-allowlist-validated
  `PUT` with `redirect: "error"` → `INSERT certifier_document_uploads`
  with `(provider, document_id)` uniqueness as the idempotency lock.
  Every outbound HTTP call wraps `withSyncEventOnFailure` so failures
  land in `certifier_sync_events` before throwing.
- **Hash-covered source attribution** —
  `src/lib/isometric/transformers/datapoint.ts` plumbs `sourceIds`
  into every monitored Datapoint's `source_ids` (no INPUT_MAPPING
  change → `MAPPING_REVISION` unchanged).
  `src/fn/certification/submit-removal.ts` resolves source IDs from
  the lineage already loaded in `RemovalSubmissionContext`, adds them
  to `semanticPayload.sourceIds` and to
  `payloadSnapshot.transport.datapointBodies[].body.source_ids`. The
  `datapointTransportSchema` now requires `source_ids` so resumed
  pre-Phase-3.5 snapshots fail loud locally rather than POST a
  malformed Datapoint.
- **UI** — `src/components/certification/sources-panel.tsx` lists
  every document attached to entities along the Removal's
  chain-of-custody (application, delivery, order, biochar product,
  production run, samples, feedstocks, reactor, credit batch) with
  per-row Mirror / Unlink / public-private toggle. Mounted under the
  credit-batch side sheet's `CertifyPanel` and at the new dynamic
  route `/certification/removals/[removalId]`. The Removals hub adds
  a "Sources →" link on each card. UI handles its own
  loading/empty/error states matching sibling certification panels.
- **Authorization model on unlink** —
  `certifier_document_uploads` rows referenced by any persisted
  submission snapshot cannot be deleted: `unlinkDocumentSource`
  guards via `isExternalSourceReferencedInSnapshots`
  (jsonb_path_exists over `payload_snapshot`), wrapped in a
  transaction + post-delete recheck. The Source remains on Isometric
  in all unlink cases; the user can re-mirror to restore the link.
- **Document deletion compatibility** — `deleteDocument`
  (`src/fn/documents.ts`) now pre-checks `certifier_document_uploads`
  before deleting storage bytes; FK violations are surfaced as a
  user-friendly `SafeError` instead of a 500.
- **New env var** — `ISOMETRIC_UPLOAD_HOST_ALLOWLIST` (optional;
  comma-separated host suffixes; defaults to `.s3.amazonaws.com,
  .amazonaws.com, .isometric.com, .digitaloceanspaces.com`). The
  mirror flow's PUT refuses to ship bytes to any URL outside this
  list (SSRF defense-in-depth).
- **Known v1 compromise** — removal-wide source attribution; every
  monitored Datapoint receives the same `source_ids` list. Per-input
  refinement is a Phase 5 follow-up tracked under
  `isometric/sources-per-input-attribution`. 50 MB hard cap on
  mirrored bytes tracked under
  `isometric/sources-stream-large-files`.
- **Tests** — `tests/isometric-sources.test.ts` (13 cases): supplier-
  ref determinism, transformer `source_ids` plumbing, supersede
  contract on hash sensitivity. Existing
  `tests/isometric-submit-removal.test.ts` mocks the new source
  resolver to keep the pre-Phase-3.5 contract pinned. Mirror-flow
  integration tests (POST 200 → PUT, recovery 200 → PUT → insert,
  recovery 409 → insert, mid-PUT failure → retry, race detection)
  tracked under `isometric/sources-integration-tests`.

Open question closed: `isometric/phase-3.5`.

## 2026-05-24 (Period emissions + template-evolution strategy — grilling session)

Resolves the `isometric/phase-3.7-period-inputs` open question
(originally raised 2026-05-21, scope-revised 2026-05-22) and lands a
durable template-evolution strategy. Implementation does not ship in
this change — design-only, written up so `modify-feature` can land
it cleanly. See
[ADR 0005](../adr/0005-period-emissions-as-project-components.md) and
the new "Template-evolution strategy" section of
`docs/isometric/integration-plan.md`.

- **Reframe — period emissions are Project Components, not Removal
  datapoints.** The Certify OpenAPI surface exposes a four-value
  `ComponentScope` enum (`REMOVAL | GHG_STATEMENT | PROJECT |
  NET_NEGATIVITY`) and a `ProjectComponentAmortizationStrategy` enum
  (`ESTIMATED_PROJECT_TONNAGE | MANUAL | CUSTOM_TIME_PERIOD |
  ESTIMATED_PROJECT_LIFETIME`) that handles per-statement attribution
  server-side. Period-level emissions (staff travel, pyrolyzer
  CH₄/CO, lab electricity, sampling consumables, miscellaneous mass)
  fit cleanly as `PROJECT`-scope Components — they are operator
  overhead for an LCA measurement window, not attributable to a single
  Removal or Statement. The client-side apportionment problem the open
  question was structured around is mostly not noma's problem.
- **Posture B — noma is the LCA journal, not the publisher.**
  `/admin/emission-estimates` grows a "Period emissions (LCA-derived)"
  section: one row per (facility, lca_window, category) with an FK to
  the source LCA document and an `allocation_strategy_recommendation`
  text field (default `CUSTOM_TIME_PERIOD; target_date = lca_window_end`).
  noma **does not** POST to `/project_components`; the operator
  publishes Project Components directly in the Isometric UI. A read-only
  drift panel on the certify surface flags noma rows missing from
  Isometric and Components missing from noma.
- **`INPUT_MAPPING` cleanup.** The five `zeroStub: true` families
  move to a new `PERIOD_INPUT_TUPLES` sentinel set; the scope-conflict
  `SafeError` raised by `buildCreateDatapointRequest` names the tuple
  AND the canonical scope, replacing today's silent zero-stub on
  templates that include period-input components. The `noma-mvp`
  template already omits these, so this is a contract enforcer for
  templates authored later.
- **Template-evolution strategy** (B1–B4) — answers the operator
  meta-question on how noma stays consistent as Isometric templates
  drift. All four checks share `isometric-health.yml`'s daily 09:17
  UTC ping (no PR gate). B1: nightly coverage check (`pnpm
  isometric:coverage-check`) asserts every live-template tuple is in
  `INPUT_MAPPING` or `PERIOD_INPUT_TUPLES`, and every Isometric
  Project Component has a matching noma row. B2: nightly
  `openapi-typescript` regen + `git diff --exit-code` on
  `certify.d.ts`. B3: `__mappingRevision = sha256(canonicalJson(INPUT_MAPPING))`
  embedded in `payloadSnapshot` (no migration; reuses
  `payload-hash.ts`) and surfaced in sync events. B4: mapping-version
  dimension deferred until Isometric exposes a `blueprint_version`
  field (none in current OpenAPI; tracked under
  `isometric/mapping-version-dimension` in open-questions).
- **Pre-deploy gate #4 rewritten.** The "no zero-stub template in
  production" gate is replaced by a per-category check: every category
  present in any Removal Template the facility uses must have a row in
  `certifier_project_emissions` AND a Project Component in Isometric.
  The nightly coverage check (B1) runs this assertion headless.

## 2026-05-24 (GHG Statement mapping-lock parity + unlink guard)

Two correctness fixes on the GHG Statement flow now that it's a live
artifact (ADR 0004). See
`docs/adr/0004-ghg-statement-as-independent-artifact.md` (updated in the
same change).

- **`createGhgStatementDraft` uses the `…WithMappingLock` ledger
  variants.** The `resume` and `create-new-version` branches now go
  through `resetSubmissionToDraftWithMappingLock` /
  `insertDraftSubmissionWithMappingLock` with a guard that pins
  `expectedExternalProjectId` (the `expectedDefaultRemovalTemplateId`
  arm is intentionally omitted — a GHG Statement has no template). The
  lock serialises against a concurrent facility repoint/unlink between
  the project read and the remote POST, preventing the registry
  statement being created under a stale project.
- **Unlink/repoint guard widened to include GHG-statement submissions.**
  `hasBlockingFacilitySubmission` (`src/data-access/certification.ts`)
  now runs two parallel probes — one over `certifier_removals`, one over
  `certifier_ghg_statements` — and refuses the unlink/repoint when
  either has an in-flight submission in `BLOCKING_SUBMISSION_STATUSES`.
  Both branches keep the one-hop facility join (no lineage walk) and use
  artifact-specific facility indexes.
- **Stale framing corrected.** The "GHG Statements decoupled / dormant"
  note from the 2026-05-22 entry below no longer holds — the flow is
  live and participates in the same correctness contracts as Removals.

## 2026-05-22 (GHG Statement review follow-ups)

Post-delivery review fixes for the GHG Statements feature: one
statement per `(provider, facility, period)` (double-create dedup
backed by migration `0025`), N+1 ledger lookups batched, and
`finalizeGhgStatement` made atomic. See
`docs/archive/2026-05-22-ghg-statement-review.md` for the detailed
delivery log.

## 2026-05-22 (GHG Statements wired live — Certification route group)

The dormant GHG-statement machinery — kept un-wired by ADR 0003 for "a
future, independent feature" — is now live, delivering integration-plan
Phase 4.5. See `docs/adr/0004-ghg-statement-as-independent-artifact.md`.

- **Provider-neutral Certification route group.** `src/app/(app)/certification/`
  becomes a tile hub (`page.tsx`) with `removals/` (the existing Removals
  hub) and `ghg-statements/`. The sidebar gains a "Certification" section.
- **Period-first creation.** Isometric creates a GHG Statement from only
  `{ project_id, end_on }` and links Removals server-side by reporting-period
  date range, so a 3-step stepper picks the period end → previews the
  predicted removals → creates. After the POST the actual `removal_ids` are
  reconciled onto local `certifierRemovals.ghgStatementId` — never stealing a
  removal already linked to another statement.
- **New `certifierGhgStatements` table** (facility-scoped, period-anchored)
  + nullable `certifierRemovals.ghgStatementId` FK. Migrations `0023`
  (table + column) and `0024` (FK index), both additive.
- **`ghg-statements.ts` re-keyed** from a `creditBatch` to a `ghgStatement`
  local entity; full lifecycle — create draft → submit to verifier → status
  refresh.

## 2026-05-22 (Adapter re-leveled — the Removal is the submission unit)

The Certify adapter was re-leveled again. A production run is the wrong
submission grain (a run's biochar splits across deliveries/applications and
run-as-Removal over-counted), and a GHG Statement is an arbitrary reporting
period — not a synonym for a credit batch. See
`docs/adr/0003-removal-as-submission-unit.md`.

- **New mapping.** The Isometric **Removal** is the submission unit, held
  locally by a new `certifierRemovals` row. **N credit batches map into one
  Removal** (default 1:1 per month, lazily created on first submit;
  multiple can be grouped). `creditBatches` gains a nullable `removalId` FK.
- **Applied-biochar scoping.** A Removal counts only biochar applied to
  soil — each run weighted by `appliedDryKg / runTotalBiocharOutput`
  (linear mass allocation). `aggregateProductionRuns` takes an
  `attributionByRunId` map.
- **Single-phase submit.** `submitRemoval` aggregates the deduped union of
  every member batch's runs into one Removal and POSTs it — no GHG phase.
  The two-phase `submitCreditBatch` is removed.
- **GHG Statements decoupled / dormant.** `ghg-statements.ts` is kept
  un-wired for a future independent GHG-statement feature.
- **New `/certification` Removals hub** manages removals + grouping; the
  credit-batch Certify panel is now a compact removal status strip.
- Supplier ref re-keyed `nm-pr-` → `nm-rmv-`. Migration `0022` is additive.

## 2026-05-21 (Certify integration re-leveled — credit batch = GHG Statement)

The Certify integration was mis-leveled by one tier: it mapped one
`creditBatches` row → one Isometric **Removal** and treated a GHG
Statement as a separate, period-anchored artifact. Isometric's model is
the inverse — a **GHG Statement** is a monthly reporting summary that
*contains* N **Removals**, one per production batch. (This model was
itself superseded the next day; see
`docs/adr/0003-removal-as-submission-unit.md`.)

- **New mapping.** A noma credit batch submits as one **GHG Statement**;
  each production run rolled up by the batch's lineage submits as one
  **Removal**. The `creditBatches` table keeps its name (a rename would
  touch ~50 files); the re-mapping lives in `src/fn/certification/`.
- **Two-phase submit.** `submitCreditBatch` now POSTs every per-run
  Removal (Phase 1 — sequential, sorted by run id, fail-fast) then the
  GHG Statement (Phase 2), and asserts `GhgStatement.removal_ids` is a
  superset of the Phase 1 Removal IDs. Removals link to the statement by
  reporting-period date range, server-side.
- **New** `src/fn/certification/submit-removal.ts` — `submitRemovalForRun`,
  the per-run unit of idempotency (ledger row keyed
  `localEntityType:'productionRun'`).
- **`ghg-statements.ts` re-keyed** to the credit batch:
  `submitGhgStatementForCreditBatch`, `submitGhgStatementToVerifier`,
  `loadCreditBatchGhgStatementState`. Claim hash is
  `(projectId, creditBatchId, endOn)`.
- **Dropped:** the `certifierGhgPeriods` table (migration `0021`), the
  `/certification` page, and `certification-page.tsx` — the
  GHG-statement surface moved onto the credit-batch side-sheet Certify
  panel, which renders N per-run Removal rows + the GHG Statement
  status. Also removed the `GHG_PERIOD_ENTITY_TYPE` constant and the
  legacy `nm-cb-` supplier-ref builder.
- **Open question revised:** `isometric/phase-3.7-period-inputs` — the
  per-reporting-period emission inputs now belong on the GHG Statement's
  "Reporting period emissions" tab, not as per-run Removal zero stubs.

## 2026-05-19 (Review follow-ups — minor)

- **Centralised submission-metadata keys.** Added
  `SUBMISSION_METADATA_KEYS` to
  `src/lib/isometric/utils/submission-metadata.ts` covering the four
  read/write keys (`remoteStatus`, `pendingTotalCo2eRemovedKg`,
  `removalIds`, `rejectionReason`). Replaced the literal strings in
  `certification-page.tsx`, `certify-panel.tsx`, and `ghg-statements.ts`
  (read sites + `remoteMetadata` write site) so reader and writer cannot
  drift independently.
- **Evergreen polish on `sandbox-template-authoring.md`.** Removed the
  dated parenthetical "verified 2026-05-11 via …" from the prerequisites
  block; replaced with an evergreen instruction to run
  `pnpm tsx scripts/isometric-smoke.ts inspect-template` to confirm
  connectivity.
- **Deferred review suggestions parked** in
  `docs/open-questions.md` → "Documentation hygiene" (changelog
  archival, plan-snapshot extraction, open-questions reformatting,
  README phase-language polish, `env-banner` style constants). Each
  carries a rationale + resolve-via hint so they don't get lost.

## 2026-05-13 (Dark Earth template — fixed-constant bootstrap script)

Unblocks `submitCreditBatch` against `Dark Earth removal template`
(`rvt_1K9YK6YRQSBXFVZ0`) on sandbox project `prj_1K9YJ33RKSBX9FFF`. The
template carried 13 unbound `type=fixed` inputs (DEFRA / IPCC constants);
`submit-credit-batch.ts:312-319` refused to submit until each was bound
to a Datapoint in the Registry UI.

- **New — `scripts/isometric-bootstrap-constants.ts`.** Curated
  `FIXED_CONSTANT_DEFAULTS` table keyed by
  `${componentDisplayName}::${inputKey}`, with magnitude + citation per
  entry. Unit string is intentionally NOT in the table — it is read
  off the live blueprint's `compatible_unit` at POST time to avoid
  string drift (`"L"` vs `"l"`).
- **New mode — `bootstrap-fixed-constants <projectId> <templateId>` on
  `scripts/isometric-smoke.ts`.** Walks every unbound fixed input,
  POSTs a constant Datapoint with `source_ids: []`, prints the binding
  table for the admin to paste into the Registry UI. Idempotent via
  `supplier_reference_id = nm-fc-<templateId>-<rtcId>-<inputKey>` —
  re-runs reconcile through `findDatapointBySupplierRef` rather than
  POSTing duplicates.
- **Walkthrough — `docs/isometric/sandbox-template-authoring.md`**
  appended with an "Alternative — Bootstrap fixed constants on
  `Dark Earth removal template`" section (Steps A/B/C plus the 13-row
  defaults table).
- **Closed open question:** `isometric/sandbox-template-binding`
  (opened 2026-05-13) — the 13-input failure is now resolvable via the
  bootstrap script + UI bind.

**Overengineering guard (per request 2026-05-13):**

The Datapoint magnitudes are hardcoded in the script. This is the
deliberate minimum:

- ✅ Defaults live in a single TS file (`isometric-bootstrap-constants.ts`)
  — diff-reviewable, citation per entry.
- ✅ Unit string read live from blueprint — no hardcoded unit assertions.
- ✅ Supplier-ref idempotency — script is safe to re-run.
- ❌ **No `fixed_constants` DB table.** Constants are policy-level
  reference data, not noma-specific operational data.
- ❌ **No admin UI for editing factors.** Override path: edit the
  Datapoint magnitude in the Registry UI; binding survives.
- ❌ **No per-project configuration.** If a verifier asks for
  project-specific factors, lift the map into a small JSON keyed by
  project ID — do not promote it to a DB table.
- ⚠️ **`Sampling consumables / carbon_intensity = 1.0` is a
  placeholder**, flagged in the script and in
  `docs/isometric/sandbox-template-authoring.md` (Verifier-readiness
  section). Must be researched before any production submission.

## 2026-05-13 (Transport v1.1 compliance fixes — review follow-up)

Addresses P1/P2 findings from the code review of commit 6bb0576 against
Isometric Transportation Emissions Accounting Module v1.1
(https://registry.isometric.com/module/transportation/1.1).

- **Per-leg uniformity enforced (P1).** `aggregateTransportLegs` in
  `src/lib/isometric/utils/aggregation.ts` now rejects mixed methods,
  mixed emission factors, or missing per-leg fields within a transport
  category, surfacing the issue via `agg.warnings`. The mass-weighted
  distance is preserved only when the category is uniform — that's the
  condition under which Certify's
  `distance × Σmass × factor = Σⱼ(distⱼ × massⱼ × factor)`, the per-leg
  sum required by v1.1 §5. `submit-credit-batch.ts` short-circuits on
  the new warnings post-`enrichWithTransportLegs`.
  - Original plan (flip `INPUT_MAPPING` to CO2e) abandoned: Certify's
    `transport` blueprint takes `distance` / `mass` / `carbon_intensity`
    as separate inputs with strict unit + `quantity_kind` guards.
    Rationale logged in `docs/open-questions.md` under
    `isometric/transport-v1.1-aggregation`.
- **Parent-scoped transport-leg auth (P1).** New
  `resolveEntityFacility` in `src/data-access/transport-legs.ts`
  walks the polymorphic `entity_id` back to a facility on every
  read-by-id, update, and delete (sample resolves via
  `production_runs.facility_id`). Closes the orphan-mutation hole the
  bare `requireAuth` guard left open.
- **Template-aware Certify coverage (P2#1).**
  `loadCertifyContextForCreditBatchForUser` now emits
  `requiredTransportCategories` derived from
  `defaultTemplate.groups[*].components[*].inputs[*]` via
  `INPUT_MAPPING`. `<CertifyPanel>` only blocks on the categories the
  active template actually consumes, and shows
  "Not requested by the active removal template." for templates with
  no transport inputs.
- **Deferred (P2#2 evidence model).** `transport_legs` schema columns
  for factor source citation, factor vintage, round-trip flag, onward
  destination, and distance-method fallback evidence are tracked in
  `docs/open-questions.md` under `isometric/transport-v1.1-evidence`
  for a follow-up PR with its own migration + condition-registry
  updates.
- **Tests:** 47 unit tests pass
  (`tests/isometric-transport-aggregation.test.ts`,
  `tests/isometric-certify-context.test.ts`,
  `tests/isometric-transformers.test.ts`,
  `tests/isometric-transport-lineage.test.ts`).
  `pnpm typecheck` and `pnpm lint` pass with the pre-existing warning
  list unchanged.

## 2026-05-13 (Phase 3.6 completion — transport-leg UI + submission wiring)

- **Scope:** finished the UI / orchestration half of Phase 3.6 sitting on
  top of the 2026-05-11 foundation. Closes the transport portion of
  `phase-3-input-coverage` in `docs/open-questions.md`. The biomass→
  processing, biochar→storage, and sample→lab transport-distance inputs
  on the `noma-mvp` template now have a real end-to-end path from data
  entry through to the Removal payload.
- **Polymorphic data layer.** New `src/data-access/transport-legs.ts`:
  `getTransportLegsForEntity(userId, entityType, entityId)` +
  `getTransportLegsForEntities(userId, entityType, entityIds[])` (bulk;
  single `IN`-query) + auth-guarded `create / update / delete` with
  per-`entityType` existence checks. **Schema decision:**
  `entityType='feedstock'` references `feedstocks.id` (not the vestigial
  `feedstock_deliveries.id`). Users only see `feedstocks` in the UI;
  pointing the polymorphic system at the user-visible entity removes the
  "feedstockDeliveryId might be null" mounting trap.
- **Schemas + server actions + hooks.** `src/schemas/transport-legs.ts`
  uses a Zod `superRefine` that mirrors the DB-level check constraints
  exactly (`energy_usage` requires `fuelType` + (`fuelConsumedLiters`
  OR `electricityKwh`) + `emissionFactorUsed`; `distance_based` requires
  `loadMassKg` + `vehicleType` + `emissionFactorUsed`).
  `src/fn/transport-legs.ts` wraps with `withAction`.
  `src/hooks/use-transport-legs.ts` exposes
  `useTransportLegsForEntity` + the three mutations with per-`(entityType,
  entityId)` invalidation.
- **UI components.** New `src/components/transport-legs/`:
  - `TransportLegForm` — modal dialog, method-conditional required
    fields.
  - `TransportLegsPanel` — list / add / edit / delete, dropped into any
    surface with `(entityType, entityId)` via `viewModeChildren`.
  Mounted in three places:
  - `src/components/deliveries/delivery-list.tsx` —
    `entityType="delivery"`, replacing the previous read-only
    transport-leg sections that ran through `useTransportLegsForDelivery`.
  - `src/components/samples/sample-list.tsx` — `entityType="sample"`.
  - `src/components/feedstocks/feedstock-list.tsx` —
    `entityType="feedstock"`, always rendered (no `feedstockDeliveryId`
    conditional).
  Legacy `getTransportLegsForDeliveryFn` / `useTransportLegsForDelivery`
  / `deliveryKeys.transportLegs` removed; old read-only display deleted.
- **Shared lineage walker.** New
  `src/lib/isometric/utils/transport-lineage.ts` exporting a pure
  `collectTransportEntityIds(lineages, runs)` that returns
  `{feedstockIds, biocharProductIds, sampleIds}` (deduped). Re-exported
  from `src/lib/isometric/index.ts`. Consumed by both the submission
  orchestrator and the Certify-Panel coverage loader so the two views
  can't drift.
- **Submission wiring.** `src/fn/certification/submit-credit-batch.ts`
  now, after `aggregateProductionRuns(runs)`:
  1. Calls `collectTransportEntityIds(lineages, runs)`.
  2. Fans out `getTransportLegsForEntities` in parallel for all three
     categories.
  3. Pipes the result through the existing
     `enrichWithTransportLegs(agg, { feedstock, biochar, sample })`.
  4. Passes the enriched aggregation (not the bare one) to the payload
     build. Submitted Removals now carry real transport distances on
     the three transport blueprints.
- **Pre-flight coverage UX.** `src/fn/certification/certify-context.ts`
  gained a `transportCoverage` field on `CertifyContextForCreditBatch`:
  `{ feedstock|biochar|sample: { count, entityIds } }`. Populated only
  in the fully-resolved branch (no remote calls when unlinked /
  template missing / drift). `<CertifyPanel>`
  (`src/components/certification/certify-panel.tsx`) renders a
  three-row checklist between the template-blocker notice and the
  Submission row. Each missing category gets an `Add legs →` link to
  the relevant entity surface (`/feedstocks`, `/biochar-products`,
  `/samples`). The Submit button is disabled while any required
  category is empty; the tooltip names the missing categories.
- **Tests.** Full unit suite green: 28 files / 182 tests / 3 pre-existing
  skips.
  - New `tests/isometric-transport-lineage.test.ts` (6 cases) covers
    the lineage walker — empty / dedup / null biocharProduct / runs
    with no samples.
  - `tests/isometric-certify-context.test.ts` extended to mock the new
    data-access deps and assert the `transportCoverage` shape across
    every branch + a populated-coverage walker case.
- **Out of scope** (carried in `docs/open-questions.md`): per-run
  electricity readouts (`final_readout`/`initial_readout`), per-run
  GHG concentrations (CH4/CO at run level), webhook ingestion (no
  Certify contract yet), source-upload presigned-URL flow.

## 2026-05-11 (Phase 3.6 foundation — tailored-template path)

- **Scope:** Foundation work that unblocks the `phase-3-input-coverage`
  (transport portion) and `phase-3-fixed-constants` gates by making
  `INPUT_MAPPING` and the aggregation surface match real-template
  shape, plus authoring guidance for the sandbox template.
- **`INPUT_MAPPING` refactor — flat → three-level.**
  `src/lib/isometric/transformers/datapoint.ts` now keys mapping
  entries by `(group_key, blueprint_key, input_key)` rather than just
  `input_key`. Required because real templates re-use blueprints
  across groups (e.g., the `transport` blueprint appears in both
  `biomass-feedstock-transport` and `biochar-transport`, with
  different semantic meaning). New `lookupInputMapping(groupKey,
  blueprintKey, inputKey)` helper exported.
- **Datapoint builder signature.** `BuildCreateDatapointArgs` gained
  `groupKey` + `componentBlueprintKey` fields. The
  `submitCreditBatch` orchestrator threads them through its
  `(group, component, rtcInput)` loop and surfaces them in the
  `SafeError` messages for missing mapping / null source cases.
- **Transport aggregation.** `AggregatedProductionData` gained three
  optional fields: `feedstockTransportAvgDistanceKm`,
  `biocharTransportAvgDistanceKm`, `sampleTransportAvgDistanceKm`.
  Populated by two new pure helpers in
  `src/lib/isometric/utils/aggregation.ts`:
  - `aggregateTransportLegs(legs)` — mass-weighted average
    `Σ(distance × load_mass) / Σ(load_mass)`. Returns `null` for
    empty input or when every leg has `loadMassKg == null`. Legs
    with null mass are skipped (don't contribute to either sum) so
    the result stays finite.
  - `enrichWithTransportLegs(agg, { feedstock, biochar, sample })` —
    layers the three category averages onto an existing aggregation
    result without mutating it.
- **Template-validation signatures.** `ResolvedTemplateInput` (in
  `aggregation.ts`) gained `groupKey`; `validateForTemplate` now
  takes the nested `NestedInputMapping` shape and reports
  group/blueprint/input in its `MissingInput.reason` text.
- **Smoke script.** `scripts/isometric-smoke.ts inspect-template`
  now reports unmapped entries as
  `group_key / blueprint_key / input_key` so operators can see which
  group context an input belongs to.
- **New doc — `docs/isometric/sandbox-template-authoring.md`.**
  Step-by-step walkthrough for an admin to author a `noma-mvp`
  Removal Template in the Registry UI:
  - 4 components across 4 groups
    (`co2-stored/carbon_rich_substance_sequestration`,
    `biomass-feedstock-transport/transport`,
    `biochar-transport/transport`,
    `sampling-required-for-mrv/distance_based_ci_emissions`).
  - 7 monitored inputs (carbon_content, product_mass, distance×2,
    mass×2, sample distance).
  - 6 fixed-constant Datapoints to pre-bind
    (`carbon_intensity` per transport leg, with DEFRA/IPCC defaults).
  - Omitted from MVP: `grid_electricity_use`, `fuel_usage_by_volume`,
    `mass_based_ci_emissions`, `metered_energy_based_ci_emissions`
    (blocked by electricity-readout schema work), `ghg_direct_emissions`
    (blocked by per-run GHG-concentration schema work), `staff-travel`
    (noma has no data).
  - Verification: `pnpm tsx scripts/isometric-smoke.ts
    inspect-template` should list the new template with all 7
    monitored inputs unbound and all 3 `carbon_intensity` fixed
    inputs pre-bound.
- **New utility — `src/lib/isometric/utils/submission-metadata.ts`.**
  Pure `getMetadataValue(metadata, key)` helper that safely reads a
  key off an `unknown` metadata blob (typed as `Record<string,
  unknown>` after the guard). Replaces three near-identical local
  copies that previously lived in `certify-panel.tsx`,
  `certification-page.tsx`, and `ghg-statements.ts`.
- **Tests.**
  - All 16 `tests/isometric-transformers.test.ts` cases updated to
    pass `groupKey` + `componentBlueprintKey` (anchored on
    `co2-stored / carbon_rich_substance_sequestration`,
    `biochar-processing / grid_electricity_use`,
    `sampling-required-for-mrv / mass_based_ci_emissions`).
  - New `tests/isometric-transport-aggregation.test.ts` — 11 cases
    covering empty input, single leg, multi-leg mass-weighted
    average, equal-load simple-average equivalence, null-mass skip,
    all-null-mass returns null, zero-distance handling, and
    `enrichWithTransportLegs` non-mutation + non-transport-field
    preservation.
  - Full suite: 175 / 178 passing (3 pre-existing skips).
- **Status snapshot in `integration-plan.md`** updated to
  2026-05-11 and rewritten to gate on the user authoring `noma-mvp`
  in the Registry UI rather than on Isometric template configuration
  in general.
- **Phase 3.6 still pending:** polymorphic
  `<TransportLegForm entityType entityId>` + data-access
  generalization (`getTransportLegsForEntity`) + 3 mount points
  (delivery, feedstock-delivery, sample) + pre-flight
  transport-coverage checklist on `<CertifyPanel>`. Electricity-readout
  and per-run-GHG portions of `phase-3-input-coverage` stay deferred.

## 2026-05-07 (Env awareness + dialog/schema refactor)

- **Scope:** UX polish across the certification dialogs plus a small
  helper-extraction pass that removed three near-duplicate local
  implementations. No public API changes; all server actions and
  data-access functions keep their existing signatures.
- **New components.**
  - `src/components/certification/env-banner.tsx` — ambient
    environment indicator. Sandbox is informational (orange,
    `TestTube` icon); production is high-attention (red border,
    `ShieldWarning` icon). Supports `variant="page"` and
    `variant="inline"` so the same component fits both page headers
    and inside dialogs. Used in `CertificationPage`, `CertifyPanel`,
    and inside `ProductionConfirmation`.
  - `src/components/certification/production-confirmation.tsx` —
    reusable inline production-environment gate that combines an
    inline `EnvBanner` with a descriptive checkbox bound to a
    react-hook-form `confirmProduction` field. Consumed by
    `GhgStatementCreateDialog`, `GhgStatementSubmitDialog`, and
    `FacilityCertifierDialog`. Replaces three near-identical
    per-dialog confirmation gates.
- **`SubmitConfirmDialog` refactor.** Replaced the freeform
  `artifactLabel?: string` prop with a typed
  `artifact?: "removal" | "ghgStatement"` discriminator backed by an
  internal `ARTIFACT_LABEL` map. Added an `isProduction?: boolean`
  prop that drives the embedded `EnvBanner`, so the dialog correctly
  shows the sandbox banner under sandbox (it was hard-coded to
  production previously). `CertifyPanel` now passes
  `artifact="removal"` + the resolved `isProduction` flag.
- **`chooseGhgSubmitMode` ordering fix.**
  `src/lib/isometric/utils/ghg-statement-state.ts` previously
  short-circuited an `AWAITING_VERIFICATION` statement into the
  `resubmit` branch when `pending_total_co2e_removed_kg > 0` because
  the `pending > 0` check was evaluated before the
  `AWAITING_VERIFICATION` check. Reordered so
  `AWAITING_VERIFICATION` blocks first. The matching
  `chooseGhgSubmitModeFromKnownState` fallback in
  `ghg-statements.ts` got the same reordering.
- **`ghgSubmitAppearsApplied` correctness.** Previously trusted
  `remote.submitted_at !== null` as a "submission landed" signal;
  but `submitted_at` is set on every Certify-side state transition,
  not only on transitions away from `DRAFT`. Now checks
  `status === "AWAITING_VERIFICATION" || status === "VERIFIED"` for
  an unambiguous post-submit signal.
- **`isLockedInFlight` consolidated.** Promoted to a shared helper
  on `src/lib/isometric/utils/lock.ts`:
  `isLockedInFlight({ status, lockedAt }) -> boolean`. Three call
  sites collapsed onto it (`loadCreditBatchSubmissionState` in
  `submit-credit-batch.ts`, `CertifyPanel`/`SubmissionRow`,
  `CertificationPage`). The page-side variant previously also did
  date-string parsing because the row may arrive over the
  serialization boundary as ISO string; that variant is now expressed
  via `toDate(value)` at the call site, leaving the lock helper a
  pure `Date | null` consumer.
- **`getMetadataValue` consolidated.** Moved to
  `src/lib/isometric/utils/submission-metadata.ts` (see Phase 3.6
  entry above). The local copies in `certification-page.tsx`,
  `certify-panel.tsx`, and `ghg-statements.ts` were deleted.
- **Centralized GHG-statement schemas.**
  `src/schemas/certification.ts` now owns
  `createGhgStatementSchema`, `submitGhgStatementSchema`,
  `submitGhgStatementDialogSchema`, and the
  `buildSubmitGhgStatementDialogSchema({ isResubmit, isProduction })`
  factory. The factory returns a schema that conditionally requires
  `summaryOfChanges` (resubmit-only) and `confirmProduction`
  (production-only). `GhgStatementCreateDialog` and
  `GhgStatementSubmitDialog` were updated to import from there
  rather than declaring their own inline schemas.
- **`httpsUrlSchema` added.** A shared
  "valid URL + must use HTTPS" schema for report URLs, used by both
  the GHG-statement create and submit flows.
- **Zod 4 migration touchups.** `createGhgStatementSchema` and
  `submitGhgStatementDialogSchema` now use Zod 4's unified `error`
  parameter (instead of `message`), the new
  `superRefine` → `check` callback shape (mutating `ctx.issues`),
  and `parseLocalDateString` / `formatLocalDate` from
  `@/lib/date-utils` instead of two private helpers. Net effect: one
  source of truth for "yyyy-mm-dd in this user's local time."
- **`panel-layout.tsx` — `<dt>`/`<dd>` → `<div>`.** `Field` previously
  emitted a `<dt>`/`<dd>` pair without a wrapping `<dl>`, which is
  invalid markup. Switched to plain `<div>` to keep the visual
  structure without the HTML conformance error.
- **`certify-panel.tsx` orchestration fixups.**
  - Hoisted `MS_PER_SECOND` / `SECONDS_PER_MINUTE` to module-level
    constants (instead of being re-declared every render of
    `formatElapsed`).
  - Added a `toDate(value)` helper that coerces the
    `Date | string | null | undefined` shape from server-serialised
    rows; `ElapsedChip` only renders when `toDate(latest.lockedAt)`
    returns a finite `Date`.
  - `deriveErrorMessage` now reads `rejectionReason` via
    `getMetadataValue` instead of an ad-hoc `key in metadata` check.
- **`submitCreditBatch` orchestration fixups.**
  - Lineage fetch parallelised:
    `creditBatch.applicationIds.map((id) => getChainOfCustodyData(...))`
    is now wrapped in `Promise.all` rather than awaited
    sequentially.
  - `LOCK_TTL_MS` re-export removed from
    `src/data-access/certification.ts`; the constant now lives only
    in `src/lib/isometric/utils/lock.ts` and is imported directly by
    the two server-action files that need it.
- **`ghg-statements.ts` orchestration fixups.**
  - `submitGhgStatementForFacility` parallelised its preflight
    reads (`getGhgPeriodById`, `getCertifierProjectByFacility`,
    `getFacilityById`, `getGhgStatement`) under one `Promise.all`.
- **Dependency bump.** `next` and `eslint-config-next` from
  `16.2.5` → `16.2.6`. No code changes required.
- **`src/lib/isometric/client.ts` defensive fix.** When an outer
  `AbortController` aborts without a `reason`, the request now
  throws a synthetic `new Error("Isometric request aborted")`
  instead of `throw undefined`.
- **Open question resolved.** `docs/open-questions.md`'s
  `Live-template INPUT_MAPPING coverage` block was trimmed to a
  one-line status summary; the detailed findings are now covered by
  `phase-3-input-coverage` / `phase-3-fixed-constants` plus the
  Phase 3.6 changes-log entry above.

## 2026-05-07 (Phase 6 deferred — outbound links shipped)

- **Resolved open question:** Datapoints with empty `source_ids` are valid for
  the Datapoints + Removal MVP. `POST /datapoints` with `source_ids: []`
  returned 2xx against the production demo project
  (`prj_1K5F2F6SN1S0ZKDQ`) on 2026-05-05 and the sandbox project
  (`prj_1K9YJ33RKSBX9FFF`) on 2026-05-06. Source upload remains deferred to
  Phase 3.5.
- **Decision:** defer the Phase 6 build-time SOP snapshot indefinitely.
  Operators read protocol/Certify documentation directly on
  `registry.isometric.com` and `docs.isometric.com`; copying it into
  the app would carry ongoing snapshot-refresh maintenance with no
  workflow benefit.
- **Shipped instead:** `src/lib/isometric/links.ts` with
  `isometricRegistry.{project,protocol,module}` and `isometricDocs.*`
  URL builders. Verified URL conventions: registry public projects use
  the singular `/project/<id>` path; protocol/module URLs match the
  `authoritative_url` shape already pinned in `versions.json`. All
  helpers `encodeURIComponent` their inputs so future non-URL-safe
  IDs/slugs stay safe.
- **Link additions:**
  - `facility-certifier-section.tsx` — "View on Isometric ↗" beside
    the project ID; protocol slug + version is now an outbound link
    when `protocolVersion` is set.
  - `certify-panel.tsx` (credit-batch side sheet) — "View on
    Isometric ↗" beside the project ID; "Learn about component
    blueprints ↗" beside the blueprint section heading.
  - `certification-page.tsx` (`/certification`) — "View GHG
    statement guide ↗" beside the GHG Statement section heading
    (chosen over the page header to sit next to the action it
    contextualises).
- **Plan doc updated:** Phase 6 in `integration-plan.md` rewritten to
  record the deferral and point at `links.ts` as the lighter-weight
  alternative; the build-time snapshot and runtime-MCP options remain
  documented as fallback paths if external-link friction surfaces.
- Verification: `pnpm typecheck` and `pnpm lint` pass; manual click
  verification covered by the implementer.

## 2026-05-07 (Phase 1 carryover E2E)

- **`tests/e2e/facility-certifier-mapping.spec.ts`.** Two-test
  Playwright spec covering the Phase 1 deferrals: N facilities → one
  Isometric project (proves the dropped
  `certifier_projects_provider_external_unique` constraint
  end-to-end through the side-sheet view-mode UI), and unlink
  refused with the exact `SafeError`
  ("Cannot unlink: this facility has certifier submissions.
  Supersede or reject them first.") surfaced in
  `UnlinkConfirmDialog`.
- DB-seeded preconditions, UI-driven assertions: `certifierProjects`
  (and a `creditBatches` + `certificationSubmissions` pair for the
  unlink case) inserted directly via Drizzle so the spec doesn't
  drive the link/edit dialog and doesn't perform Isometric writes.
  The loader's `listProjects` + `listRemovalTemplates` reads still
  fire — sandbox project ID is required.
- **Skip gate.** Reads `ISOMETRIC_DEMO_PROJECT_ID` from
  `process.env`; `test.skip` if absent. Loads `.env.local` from the
  spec file (Playwright's harness only reads `.env.test`).
- Recorded `ISOMETRIC_DEMO_PROJECT_ID=prj_1K9YJ33RKSBX9FFF` in
  local `.env.local` so `pnpm test:e2e
  tests/e2e/facility-certifier-mapping.spec.ts` runs the spec by
  default; CI without the var skips cleanly.
- Verified twice in succession (idempotent cleanup); `pnpm
  typecheck` and `pnpm lint` pass with no new warnings.

## 2026-05-06 (Simplify pass — race fix + sandbox test gating)

- **Certifier mapping race in `submitCreditBatch`.** Added
  `insertDraftSubmissionWithMappingLock` and
  `resetSubmissionToDraftWithMappingLock` in `data-access/certification.ts`.
  Each opens a transaction, takes `SELECT ... FOR UPDATE` on the
  `certifier_projects` row keyed by `(facilityId, provider)`, and verifies
  the locked row still matches the `expectedExternalProjectId` (and, for
  Removals, the `expectedDefaultRemovalTemplateId`) the orchestrator
  observed when it built the payload. Both `submitCreditBatch` and
  `createGhgStatementForFacility` now use these variants. The lock
  serializes against the `unlink`/`repoint` paths in
  `upsertCertifierProject` / `deleteCertifierProject`, so a concurrent
  remap either blocks the in-flight submission or fails it cleanly with
  no `certification_submissions` row written.
- **Live sandbox tests are now opt-in.** `tests/isometric-sandbox.integration.test.ts`
  also requires `RUN_ISOMETRIC_SANDBOX_TESTS=1`, on top of the existing
  `ISOMETRIC_*` env preconditions. `pnpm test` skips the file by default;
  use `pnpm test:integration` (sets the env var and includes only
  `tests/**/*.integration.test.ts`) to exercise it. This stops accidental
  hits on the live sandbox during plain `pnpm test`.
- **Internal simplifications.** `submit-credit-batch.ts` now uses a single
  `createOrReconcile` helper for both the datapoint loop and the removal
  POST, replacing two duplicated try/reconcile/log paths.
  `submissions.ts` consolidated `findRemovalBySupplierRef` /
  `findDatapointBySupplierRef` onto a shared `findBySupplierRef` helper.
  `utils/supplier-ref.ts` now names the slug-length constants instead of
  inlining magic numbers.
- **New unit tests** (`tests/isometric-mapping-lock.test.ts`) cover the
  three mapping-lock failure paths (missing row, repointed
  externalProjectId, changed defaultRemovalTemplateId) and both happy
  paths (insert-draft + reset-to-draft).

## 2026-05-06 (Sandbox validation pass)

- **Scope:** First validation pass against the Isometric Certify sandbox
  (`https://api.sandbox.isometric.com/mrv/v0`) using the new sandbox
  credentials in local `.env.local`.
- Updated `scripts/isometric-smoke.ts` and `scripts/isometric-link-demo.ts`
  so the demo project can be overridden by argv or
  `ISOMETRIC_DEMO_PROJECT_ID`. The production demo project remains the
  default guardrail.
- Sandbox baseline:
  - `pnpm tsx scripts/isometric-smoke.ts` confirmed
    `ISOMETRIC_ENVIRONMENT=sandbox` and returned one project:
    `prj_1K9YJ33RKSBX9FFF`.
  - `pnpm tsx scripts/isometric-smoke.ts inspect-template
    prj_1K9YJ33RKSBX9FFF` returned two templates: `Protocol default`
    (`rvt_1K9YJ33RKSBXR2Y3`) and `Dark Earth removal template`
    (`rvt_1K9YK6YRQSBXFVZ0`). Sandbox still has monitored-input coverage
    gaps: 21 unmapped monitored inputs across the two templates. Fixed
    constants are still mostly unbound; the custom template has one
    pre-bound `carbon_intensity` datapoint on the "Last mile feedstock
    transport" component.
  - `pnpm tsx scripts/isometric-smoke.ts datapoint-empty-sources
    prj_1K9YJ33RKSBX9FFF` confirmed sandbox accepts Datapoints with
    `source_ids: []`; created `dtp_1KQYVM2KRSBX2ZF6`.
  - `pnpm tsx scripts/isometric-smoke.ts ghg-statement-list
    prj_1K9YJ33RKSBX9FFF` returned one visible draft statement:
    `ggs_1K9YK7J6FSBX4QM0`, period `2026-01-01..2026-04-01`, one
    Removal.
- Local mapping/context checks:
  - Repointed the two local facility mappings to sandbox project
    `prj_1K9YJ33RKSBX9FFF`, confirming the Phase 1 N-facilities-to-one
    project shape still works.
  - Verified stale default-template drift by temporarily setting the local
    credit-batch facility to production template `rvt_1K5F2F6SN1S0N53K`;
    `loadCertifyContextForCreditBatchForUser` surfaced
    `missingDefaultTemplateId` distinctly from the unset-template state.
  - Restored the credit-batch facility to custom sandbox template
    `rvt_1K9YK6YRQSBXFVZ0`; context resolved 9 component blueprints and
    no unresolved blueprint keys. `isProduction=false`, so the production
    confirmation gate remains off under sandbox.
- Verification run:
  - `pnpm test` — 146 tests passed.
  - `pnpm test:e2e` — 75 tests passed, 2 skipped.
  - `pnpm typecheck` — passed.
  - `pnpm lint` — passed with 27 pre-existing warnings outside the touched
    scripts.
- Not yet sandbox-verified end-to-end: credit-batch Removal POST,
  Removal idempotency/supersede, stale-lock recovery, and GHG statement
  create/submit/refresh. The sandbox templates still need pre-bound fixed
  constants and/or a noma-tailored template before the Phase 3 write path
  can pass beyond its current guard.

### Re-validation (later 2026-05-06)

- Tightened `scripts/isometric-smoke.ts` so project-specific modes
  (`inspect-template`, `datapoint-empty-sources`, `ghg-statement-list`)
  refuse to silently fall back to the production demo project ID when
  `ISOMETRIC_ENVIRONMENT=sandbox`. They now require an explicit argv or
  `ISOMETRIC_DEMO_PROJECT_ID` env var on sandbox; production keeps the
  hard-coded fallback.
- Re-ran the gate sequence end-to-end against sandbox `prj_1K9YJ33RKSBX9FFF`:
  - **Gate A**: project list + ghg-statement list reachable; smoke
    datapoint `dtp_1KQYXPV3QSBXPPNG` created with `source_ids: []`.
  - **Gate B**: `inspect-template` re-reports the same gap shape — 21
    unmapped monitored inputs across both templates and unbound fixed
    constants. `submitCreditBatch` would still bail at its template
    guard, so Gates D + E remain `blocked-by-template-readiness`.
  - **Gate C**: confirmed Phase 1 N→1 mapping (both local facilities
    linked to the sandbox project) and the Phase 2 panel rendering on
    credit batch `CB-2026-001`. Phase 2 panel showed 9 blueprints
    matching the inspect-template output and the "Submit to Isometric"
    button was reachable. Drift state re-verified via a temporary
    DB-level template-id swap; the credit-batch panel surfaced the
    distinct "Default removal template is no longer available in
    Certify for this project" warning, and the original template ID
    (`rvt_1K9YK6YRQSBXFVZ0`) was restored immediately.
- Outstanding from this re-validation:
  - Stale-template **server-action** rejection (Gate C step 3) is still
    only covered indirectly. A pure project↔template validation helper
    extracted from `saveFacilityCertifierMapping` would let us assert
    the failure case from a `pnpm tsx` script without standing up a
    Next.js request context.

## 2026-05-06 (Refactor)

- **Scope:** Extract the duplicated submission-claim decision from
  `submitCreditBatch` and `createGhgStatementForFacility` into a pure
  policy module. No runtime-behaviour changes; previously-untested gate
  is now covered by unit tests.
- New code:
  - `src/lib/isometric/utils/submission-claim.ts` —
    `decideSubmissionClaim({ latest, payloadHash, now, lockTtlMs, policy })`
    returns one of `create-new-version` / `resume` / `return-existing` /
    `blocked-in-flight` / `blocked-rejected-with-external` /
    `invalid-changed-hash`. Pure: no I/O, no DB, no fetch. Owns all
    versioning math (callers no longer special-case version=1). Status
    switch is exhaustive with an `assertNever` default so a future
    `certificationSubmissionStatus` enum value is a compile-time error.
  - The single policy parameter `onSubmittedHashChanged` is `'supersede'`
    for Removals (bump version, mark previous superseded) and
    `'invalid-changed-hash'` for GHG-statement creation (the remote
    period row is unique per `(project, end_on)`, so a hash change at
    that state is a programmer error).
  - `tests/isometric-submission-claim.test.ts` — 18 cases covering both
    policies, lock-TTL boundary (strict `<`), defensive
    `submitted + externalId=null`, every status path, determinism, and
    the assertNever guard.
- Refactored:
  - `src/fn/certification/submit-credit-batch.ts` — replaced the
    `if (latest)` tree (lines 283–313 prior to the refactor) with a
    `switch (claim.kind)` on the new module's output. `console.warn` on
    `rejected-hash-changed` preserved.
  - `src/fn/certification/ghg-statements.ts` — same shape for
    `createGhgStatementForFacility` (replaced lines 156–195 prior to the
    refactor). `console.warn` on `rejected-hash-changed` preserved.
- Re-exports: `src/lib/isometric/index.ts` exposes
  `decideSubmissionClaim`, `SubmissionClaim`, `SubmissionClaimInput`,
  `SubmissionClaimPolicy`, `SubmissionClaimRow`, `SubmissionClaimStatus`.
  Internal helpers stay private to the module.
- Why now / why this scope:
  - The two call sites duplicated ~30 lines of nearly identical decision
    logic with one policy difference; small drift had already started
    (different in-flight messages, different rejected handling).
  - This module sits before every external API side effect, so a bug in
    it is high-blast-radius. It was untested.
  - Deliberately *not* an orchestrator or generic state machine — the
    reconciliation, sync-event, and POST/retry layers below it are
    untouched. Those depend on this landing first and remain on the
    backlog.
- Refactor RFCs still on the backlog (from the architecture review,
  not started): reconciliation orchestrator
  (`runRemovalSubmission`/`postOrReconcileRemoval`); input catalog
  centralising `INPUT_MAPPING` + datapoint factory; sync-trail recorder
  to guarantee paired sync events around every external call.

## 2026-05-05 (Phase 4)

- **Scope:** GHG statement lifecycle and reconciliation hardening.
- Added `certifier_ghg_periods` as the local project-period anchor for
  GHG statement submissions. Statement state stays in
  `certification_submissions`; supplier-hosted report URLs are recorded in
  `documents` rows with `entity_type='ghgStatement'`.
- Added typed Certify wrappers for `POST /ghg_statements`,
  `GET /ghg_statements/{id}`, and `POST /ghg_statements/{id}/submit`.
  `GET /ghg_statements` is pagination-only, so local reconciliation
  client-filters by project, period end, and `DRAFT` status.
- Split `src/fn/certification.ts` into a `src/fn/certification/`
  module set before adding Phase 4 actions.
- Added `/certification` for creating, submitting, refreshing, and
  resubmitting GHG statements for the selected facility's Isometric project.
- Hardened Phase 3 submission recovery: stale locks and same-hash failed
  attempts now reconcile Datapoints and Removals by stored supplier refs
  before POSTing missing resources.
- Explicitly still deferred: webhook ingestion, noma-driven PATCH
  orchestration for Removals, automatic resubmission, and external
  amendment claiming for registry-side statement-version drafts.

## 2026-05-05 (Phase 3)

- **Scope:** Phase 3 of the Certify API integration — single credit
  batch → single Removal end-to-end, with idempotency ledger.
  Backfilled changelog entry; Phase 3 shipped alongside Phase 4 on
  2026-05-05.
- **Updated by:** Kenji / Claude
- No new schema; Phase 0's `defaultRemovalTemplateId` column is enough.
- New library code under `src/lib/isometric/`:
  - `transformers/datapoint.ts` — `INPUT_MAPPING` + numeric reading →
    `CreateDatapointRequest`. Replaces the planned `source.ts` /
    `component.ts` split: sources are deferred to Phase 3.5
    (presigned-URL flow blocked on the documents subsystem) and
    component-group assembly lives directly in `transformers/removal.ts`.
  - `transformers/removal.ts` — assembles components into the live
    template's component groups.
  - `utils/aggregation.ts` — mass-weighted blends, durability ratios
    (ported from the varuna prototype, correct per Biochar v1.2).
  - `utils/payload-hash.ts` — canonical-JSON sha256 for the idempotency
    ledger. Tests in `tests/isometric-payload-hash.test.ts`.
  - `utils/supplier-ref.ts` — stable client-side reference IDs used to
    GET-by-`supplier_reference_id` after stale locks.
  - `submissions.ts` — `findRemovalBySupplierRef` /
    `findDatapointBySupplierRef` for stale-lock recovery.
- `src/fn/certification.ts` was split into `src/fn/certification/`
  (`facility-mapping.ts`, `certify-context.ts`,
  `submit-credit-batch.ts`, `shared.ts`, `index.ts`) before adding the
  Phase 4 GHG-statement actions.
- New server action `submitCreditBatch(creditBatchId)` in
  `submit-credit-batch.ts`. Reuses `getApplicationLineage()` (does not
  re-derive lineage), runs aggregation, then idempotency-ledger flow
  against `certification_submissions` keyed on `lockedAt` +
  `payloadHash` + `version`. Each HTTP attempt appends a
  `certifier_sync_events` row. The retry-decision gate at the head of
  the orchestrator was later extracted into
  `utils/submission-claim.ts` (see 2026-05-06 entry above).
- UI extensions in `src/components/certification/`:
  - `certify-panel.tsx` gained the "Submit to Isometric" button —
    disabled when the facility is unlinked, when lineage has blocking
    warnings, or when the latest submission row is locked in flight.
  - `submission-status-badge.tsx` and `sync-event-log.tsx` — status
    surfaces driven by the latest `certification_submissions` row and
    the recent `certifier_sync_events` history.
  - Mounted via the existing `viewModeChildren` slot on the
    credit-batch `EntitySideSheet`
    (`src/components/credit-batches/credit-batch-list.tsx`).
- Pre-coding gates resolved during Phase 3 (see
  `docs/open-questions.md`):
  - Empty `source_ids` confirmed accepted by Certify against the demo
    project (`prj_1K5F2F6SN1S0ZKDQ`); Phase 3.5 sources stay deferred.
  - Live-template inspection surfaced two new blockers tracked under
    `phase-3-input-coverage` (20 monitored inputs without
    `INPUT_MAPPING` entries) and `phase-3-fixed-constants` (~12
    `type=fixed` constants needing pre-bound datapoints in the
    Isometric template editor).
- Explicitly deferred at Phase 3 close: source-upload presigned-URL
  flow (Phase 3.5), per-Datapoint sub-ledger rows, transformer unit
  tests. Idempotency-decision unit tests landed via the 2026-05-06
  refactor.

## 2026-05-05 (Phase 2)

- **Scope:** Phase 2 of the Certify API integration — read-only Certify
  panel inside the credit-batch side sheet
- **Updated by:** Kenji / Claude
- New code:
  - `src/lib/isometric/projects.ts` — added `listComponentBlueprints()`
    against the global `GET /component_blueprints` endpoint, plus the
    `IsometricComponentBlueprint` type alias. Re-exported from
    `src/lib/isometric/index.ts`.
  - `src/fn/certification.ts` — added
    `loadCertifyContextForCreditBatch(creditBatchId)`. Resolves credit
    batch → facility → mapping → live project + template + referenced
    blueprints. Distinguishes "no default template" from "default template
    is stale" (drift) via `missingDefaultTemplateId`, and per-blueprint
    drift via `unresolvedBlueprintKeys`. Skips remote calls when
    unlinked, and skips the global blueprint catalog when no resolvable
    template is available.
  - `src/hooks/use-certification.ts` — added
    `useCertifyContextForCreditBatch(creditBatchId)` (5 min stale time)
    and the matching `certifyContextForCreditBatch` query key.
  - `src/components/certification/certify-panel.tsx` — accordion panel
    with five states: loading, error, not-linked, no-default, stale-default,
    and resolved-template (renders the blueprint list).
  - `src/components/certification/blueprint-list.tsx` — pure presentational
    list of resolved blueprints (display name, key, description, inputs
    summary).
- Side sheet:
  - `src/components/credit-batches/credit-batch-list.tsx` mounts
    `<CertifyPanel creditBatchId={…} />` via the existing
    `viewModeChildren` slot on `EntitySideSheet`. No new route or
    detail page.
- Docs:
  - `integration-plan.md` Phase 2 section, "Critical files",
    "Verification": marked done with the actual files shipped.

## 2026-05-05

- **Scope:** Phase 1 of the Certify API integration — facility ↔ Isometric project mapping
- **Updated by:** Kenji / Claude
- Schema changes (migration `drizzle/0016_panoramic_selene.sql`):
  - Dropped `certifier_projects_provider_external_unique` so multiple
    noma facilities can roll up into a single registry project (matches
    how operators register; Isometric's data model has no facility
    concept). Kept `(facilityId, provider)` unique to preserve
    unambiguous routing per facility.
- New code:
  - `src/lib/isometric/projects.ts` — `listProjects()`,
    `listRemovalTemplates(externalProjectId)` using the nested
    `GET /projects/{project_id}/removal_templates` endpoint
    (verified via OpenAPI types; no top-level `/removal_templates`
    exists).
  - `src/data-access/certification.ts`, `src/fn/certification.ts`,
    `src/schemas/certification.ts`, `src/hooks/use-certification.ts` —
    layered CRUD + RHF/Zod schema for the mapping. Unlink guarded by
    `SafeError` if any `creditBatch` submission exists for the
    facility (one-hop join via `creditBatches.facilityId`).
  - `src/components/certification/{facility-certifier-section,
    facility-certifier-dialog}.tsx` — view-mode card (in the facility
    list `EntitySideSheet`) plus modal form with project picker,
    template select, protocol version, and a production-confirm
    checkbox shown only when `ISOMETRIC_ENVIRONMENT === 'production'`.
- Side sheet primitive:
  - Added `viewModeChildren?` to `EntitySideSheet`; renders below the
    existing `sections` block so callers can mount interactive content
    in view mode without overriding the static-section render.
- Stopgap:
  - `scripts/isometric-link-demo.ts` updated: removed the
    `externalConflict` exit (incompatible with the dropped unique
    constraint); now logs an informational note about co-linked
    facilities.
- Docs:
  - `integration-plan.md` Phase 1 section, "Critical files",
    "Verification": marked done with the actual files shipped.

## 2026-04-19

- **Scope:** P0-01, P0-07, P0-11 schema gaps closed
- **Updated by:** Kenji / Claude
- Schema changes (migration `drizzle/0014_nasty_silver_samurai.sql`):
  - Added `credit_batches.total_feedstock_mass_kg` and `credit_batches.ineligible_feedstock_mass_kg` (nullable real, with non-negative and ordering DB checks). Closes P0-01 schema gap; ineligible fraction derived by app logic.
  - Added `stockpile_events` table (`facility_id`, `material_type` biochar|feedstock, `material_id`, `started_at`, `ended_at`, `last_control_at`, `risk_level`, `mitigation_notes`, `exception_ref`, `document_ref`). DB check enforces `exception_ref` is non-null when duration >12 months. Closes P0-07 schema gap.
  - Added `power_procurement_evidence` table keyed to `facility_id` + `period_start`/`period_end`. Stores `contract_type`, `generator_cod_date`, `grid_region`, `matching_type`, `eac_registry`, `eac_retirement_id`, `retired_at`, `document_ref`, `notes`. EC1-EC5 pass/fail derived by app logic; no boolean flags stored. Closes P0-11 schema gap.
- Docs changes:
  - Updated `simple-implementation-guide.md`: fixed `document_id` → `document_ref` (nullable text), removed `ec1_pass…ec5_pass` boolean columns, corrected `material_type` values to `biochar | feedstock`.
  - Updated `schema-mapping.md`: changed coverage status for P0-01, P0-07, P0-11 rows from `missing` to `schema-done`.
  - Updated `p0-compliance-checklist.md`: set P0-01, P0-07, P0-11 status to `in_progress` (schema done; app-layer guards and UI follow in next PR).
  - Updated `condition-registry.md`: added `stockpile.exception_ref_required` condition row.
  - Updated `schema-overview.md`: added rows for `stockpile_events` and `power_procurement_evidence`; noted new columns on `credit_batches`.

> Tracks documentation updates only. Not an authoritative policy source.
> Note: historical entries may reference pre-squash migration filenames that are no longer present in the current repo baseline.

## 2026-02-11

- **Scope:** Detailed implementation guidance and glossary
- **Updated by:** Codex
- Docs changes:
  - Added `simple-implementation-guide.md` with topic-by-topic implementation notes for ineligible biomass, stockpiling, power procurement evidence, BCU, amortization, embodied inventory, and trigger guardrails.
  - Added plain-language explanations for derived-vs-stored field decisions.
  - Added abbreviation glossary (RP, EC1-EC5, BCU, EAC, PPA, COD, EPD, etc.).
  - Updated `README.md` to include and route readers to the new guide.

- **Scope:** Documentation reconciliation to current schema baseline
- **Updated by:** Codex
- Docs changes:
  - Rewrote `schema-mapping.md` to match current table/column names and live implementation status in `src/db/schema/*`.
  - Corrected `condition-registry.md` enforcement statuses to distinguish implemented checks from planned (not yet migrated) trigger guardrails.
  - Added `p0-compliance-checklist.md` as an execution checklist table for highest-priority compliance gaps.
  - Updated `README.md` index and freshness date for the isometric docs set.
- Baseline references used:
  - `drizzle/0000_blue_mastermind.sql`
  - `src/db/schema/*`

## 2026-02-11

- **Scope:** Sampling method enforcement baseline
- **Updated by:** Codex
- Schema/workflow changes:
  - Added `sampling_method` enum (`method_a`, `method_b`) and moved ownership to `reactors.sampling_method` (default `method_a`).
  - Removed sampling-method storage from `facilities` and `credit_batches`.
  - Added server-side Method B eligibility evaluation for reactor-level selection (minimum 30 prior samples).
  - Added DB trigger guardrail to block ineligible `reactors.sampling_method=method_b`.
  - Added DB trigger guardrail on `credit_batches` to enforce Method B cadence (>=1 sampled run per 10 runs) for reactors configured with Method B.
  - Updated Isometric condition registry and schema mapping entries for sampling-method rules.
- Migration: guardrails and columns updated in `drizzle/0000_lowly_grim_reaper.sql`.

- **Scope:** Durability immutability guardrail
- **Updated by:** Codex
- Schema/workflow changes:
  - Added DB trigger guardrail to freeze `credit_batches` durability fields once batch status is `verified` or `issued`.
  - Documented the guardrail in the condition registry as `durability.lock_after_verification`.
- Migration: guardrail SQL squashed into `drizzle/0000_lowly_grim_reaper.sql`.

## 2026-02-10

- **Scope:** Phase 2 schema + validation alignment (greenfield reset)
- **Updated by:** Codex
- Schema/workflow changes:
  - Added condition registry and explicit requiredness model (`required`, `conditional_required`, `optional`).
  - Added `customer_locations`; linked orders to required location; added optional delivery location override.
  - Added `deliveries.mass_dry_kg` and `deliveries.delivered_wet_mass_kg` with consistency checks.
  - Normalized coordinates to `gps_latitude`/`gps_longitude` with range checks.
  - `transport_legs` confirmed as canonical transport accounting model.
  - Added Isometric lifecycle fields (`version`, `status`, `submitted_at`, `superseded_at`) on submission tables.
  - Added `isometric_sources` and `isometric_monitoring_submissions`.
  - Added compliance ledgers: `feedstock_sc_assessments`, `custody_handoffs`, `ghg_materiality_assessments`.
  - Added server-layer conditional validators and dry-mass derivation utility with tests.
- Migration: replaced legacy baseline with squashed `drizzle/0000_lowly_grim_reaper.sql`.

## 2026-02-09

- **Scope:** Biochar + Soil Storage initial baseline
- **Updated by:** Codex
- Protocol `biochar` pinned at v1.2 (patch 1.2.0).
- Modules pinned: `biochar-storage-soil-environments v1.2`, `biomass-feedstock-accounting v1.3`, `energy-use-accounting v1.2`, `transportation v1.1`, `ghg-accounting v1.0`, `embodied-emissions v1.0`.
- Initial requirements shortlist and schema mapping created.
