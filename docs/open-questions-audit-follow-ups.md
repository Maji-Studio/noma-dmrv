# Audit Follow-Up Open Questions

This companion holds audit-sourced deferred items split out of
[open-questions.md](./open-questions.md). Read it when reviewing cross-cutting
audit debt; the parent document's schema, invariants, and resolution rules apply
here.

## Audit follow-ups (opened 2026-05-25)

Deferrals from the whole-codebase tech-debt audit (CRITICAL + HIGH landed
in-PR). Roughly ordered by leverage.

### Architecture audit — remaining phases (opened 2026-05-21)

The 2026-05-21 audit plan
([`docs/archive/2026-05-21-architecture-audit-scalability-tech-debt.md`](./archive/2026-05-21-architecture-audit-scalability-tech-debt.md))
was partially executed: Phase 0 (PII log line, doc-query cap, parallel FK
checks, `max-lines` lint, `DB_POOL_MAX` docs, CI prod approval gate) and the
observability half of Phase 2 (structured logger) are done; Phase 4 split the
two oversized data-access files. Still open:

- **Phase 1 — schema-wide indexes.** Two of the originally-listed indexes have
  landed: `transport_legs_entity_type_entity_id_idx`
  (`src/db/schema/logistics.ts`) and `production_run_readings_run_timestamp_uq`
  (`src/db/schema/production.ts`). Remaining scope: `index()` for the unindexed
  FK columns in `src/db/schema/feedstock.ts`, `facilities.ts`,
  `storage-inventory.ts` and `geo.ts`, plus
  `soilTemperatureMeasurements.measurement_date`. **Also folded in here** (was
  the separate `perf/missing-indexes` entry, deleted 2026-07-20 after the two
  drifted apart on column order): `certifier_sync_events`
  (`src/db/schema/certification.ts`) carries an `organization_id` index but
  nothing supporting the detail-page lookup by `(entity_type, entity_id)` ordered
  by `attempted_at DESC`, so every detail page seq-scans. Under org scoping the
  useful composite leads with `organization_id`:
  `(organization_id, entity_type, entity_id, attempted_at DESC)`. One
  `pnpm db:generate` migration for the whole set. See
  [`docs/database.md`](./database.md).
- **Phase 3 — read-path + correctness.** Explicit column selection on
  wide-table reads, full document pagination, a central `query-config.ts`,
  narrowed React Query invalidation, and `revalidatePath` on key mutations.
- **Phase 4 (remainder) — file size.** `src/db/seed-data.ts` remains well over
  the 1000-line cap while the previously flagged oversized forms have been
  split. `max-lines` is now an error; what remains is finishing
  `db/seed-modularization` above and then removing `src/db/seed-data.ts` from the
  eslint `ignores` array.
### Structural / cross-cutting

- **Duplicate-hooks factory** (`code/hooks-factory`). The
  `src/hooks/use-*.ts` family contains substantial near-identical
  query/mutation wiring per entity; a `createEntityHooks(...)` factory would
  collapse much of it. Dedicated refactor PR — should not stack on in-flight
  feature work. See
  [`docs/architecture.md`](./architecture.md).

- **Pin the document-redirect allowlist to the exact Isometric report bucket**
  (`security/redirect-host-pinning`). The default allowlist families in
  `src/lib/documents/redirect-allowlist.ts` match **any** bucket on S3/Spaces, so
  an authed user could store a `fileUrl` on an arbitrary bucket host — low risk
  (browser 302, not request-attacker-controlled), accepted for now.
  **Ops task, no code change:** the mechanism is fully built
  (`ISOMETRIC_STORAGE_REDIRECT_HOSTS` in `src/config/env.ts` replaces the default
  families) — discover the exact host Isometric presigns report URLs against and
  set it per environment.

### Performance / scalability

- **Sequential datapoint POSTs in `submitRemoval`** (`perf/datapoint-fanout`).
  `src/fn/certification/submit-removal.ts` iterates `transport.datapointBodies`
  and awaits each `performRegistryCreate` sequentially — N × Isometric RTT per
  submission. Each monitored input adds another Isometric round trip.
  `Promise.all` with bounded concurrency would reduce wall time without
  overwhelming Isometric's per-second budget; sync-event ordering becomes
  interleaved — a trade-off the owner should call.

- **CI coverage script serial per-facility loop** (`perf/coverage-check-fanout`).
  The outer `for (const facility of facilities)` in
  `scripts/isometric-coverage-check.ts` iterates one at a time, each running 1×
  `listGhgEntryTemplates`. `p-limit(4)` over the facility array cuts CI
  wall-time linearly.

### Correctness / observability

- **Mapping-revision ambiguity on resume path**
  (`isometric/mapping-revision-resume`). `submit-removal.ts` stamps the current
  `MAPPING_REVISION` on sync events emitted during the resume branch, but the
  actual datapoint bodies were built from `payloadSnapshot.__mappingRevision` (a
  potentially older deploy's mapping). An auditor querying
  `response_payload->>'mapping_revision'` cannot tell which mapping authored the
  bytes. **Resolve via:** stamp both `snapshot_mapping_revision` and
  `runtime_mapping_revision` on every resume sync event. JSONB shape addition,
  no migration.

- **Lossy `IsometricApiError` in submission catch paths**
  (`obs/preserve-error-context`). **Half fixed.** `createGhgStatementRemote`
  (`src/fn/certification/ghg-statements.ts`) now records `status` +
  `sanitizeIsometricErrorBody(err.body)` — copy that pattern. Still lossy:
  `performRegistryCreate` in `src/fn/certification/submit-removal.ts`, which logs
  only `err.message` and drops `err.body` / `err.status` / `err.code`, so neither
  the audit ledger nor any logger receives them. **Resolve via:** include all
  three in `responsePayload` alongside `mapping_revision`; pair with the logger
  work so the developer-facing stack and the operator-facing `SafeError` live in
  different channels.

### Accessibility

- **Color-only severity convention in warning notices** (`a11y/wcag-1.4.1`).
  Mostly fixed — `check-row.tsx` now maps `unmet → WarningIcon` and
  `certify-panel.tsx` no longer carries the `signal-orange` border. The residual
  is `src/components/certification/ghg-statement-create-dialog.tsx`, whose
  warning blocks encode severity only by a `--color-signal-orange` left border +
  matching text color. WCAG
  1.4.1 requires a non-color cue; SR-only text satisfies AT users but the
  sighted-low-vision case still needs a non-color visual signal ("Warning"
  inline text, or an icon with sufficient contrast). **Resolve via:** a
  dedicated `audit-a11y` pass that also runs a runtime contrast check on
  `--color-signal-orange` and picks a house style for severity badges
  ([`docs/design-system.md`](./design-system.md)).

## Audit follow-ups (whole-repo audit, opened 2026-06-07)

Deferred items from the 9-commit + working-tree audit — needing a product/UX
decision or larger than a review-fix. Execution summary archived in
[`docs/archive/2026-06-07-whole-repo-audit-snapshot.md`](./archive/2026-06-07-whole-repo-audit-snapshot.md).
Sizing: (S) small, (M) medium, (L) large.

### Legacy row-reading path (`isometric/structured-telemetry-path`) — **deferred**

- Operator upload stores the original CSV unchanged as a `sensor_data` document.
  It does not parse rows, populate `production_run_readings`, or gate on row count.
- The legacy CSV importer, row table, and reading view are retained.
  `getProductionRunReadingsList` has no `.limit`, and the reading table has no
  virtualization.
- **Resolve via:** decide whether these retained row-reading paths are needed.

### Certification readiness loader lineage fan-out (`perf/overview-lineage-nplus1`) — **deferred**

- `loadCertificationOverview` rebuilds a full submission context per removal;
  each walks every application through `getChainOfCustodyData`, which issues
  several sequential single-row queries and multiplies round trips across
  removals and applications. Same root pattern as the per-batch
  `getCo2eStoredPreview` fan-out in `src/data-access/credit-batches.ts` and the
  per-row `getCreditBatchById`/`getLatestSubmission` loops in
  `certify-context-core.ts`.
- **Why it matters:** the Removals hub readiness payload grows linearly with
  removals×applications; every navigation re-runs the full fan-out.
- **Resolve via:** batch lineage with set-based `inArray` queries
  (delivery→order→product→run in one pass, zip in JS) and/or memoize the
  readiness payload (React Query `staleTime` or a server cache). The batched
  primitive `getCreditBatchSummariesByRemovalIds` already exists as a model (L).

### create-removal idempotency key (`concurrency/create-removal-idempotency`) — **deferred**

- `createRemovalWithBatchesAction` has no server-side idempotency key. Batch
  double-link is already race-safe (rows locked `FOR UPDATE`, re-checked
  `removalId IS NULL`) and the UI Confirm button is `busy`-gated, so single-tab
  and same-batch-set retries are covered. Residual gap: a network retry or a
  second tab submitting a **disjoint** batch set can create an extra
  `certifier_removals` row, and `gcRemovalIfOrphaned` only reaps on delete.
- **Why it matters:** narrow exposure (no batch double-spend, no bad credits —
  just a stray empty/duplicate removal), but it needs product semantics to close.
- **Resolve via:** add an optional client-generated `idempotencyKey` to
  `createRemovalWithBatchesSchema`, persist with a unique index,
  `INSERT … ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` inside the
  existing txn (M). Local Postgres dedupe only — the Isometric POST happens
  later in `submitRemoval`.

### Inline-CRUD table duplication (`refactor/inline-crud-table`) — **deferred**

- The remaining instances,
  `src/components/production-runs/production-incident-table.tsx` and
  `production-sample-table.tsx` still share ~90% boilerplate: identical
  `inlineForm` discriminated-union state machine, header markup,
  `TableSkeleton`, empty state, edit/delete column, and `DeleteConfirmDialog`
  wiring. `production-run-readings/production-run-reading-table.tsx` has since
  left the pattern (no `inlineForm`), and the former copy-pasted
  `formatTimestamp` helper no longer exists in `src/`.
- **Why it matters:** maintenance drift — a fix to one table's CRUD flow has to
  be mirrored in the other. Weaker at two call sites than at three; re-raise if a
  third inline-CRUD table appears.
- **Resolve via:** extract a generic `<InlineEntityTable>` or
  `useInlineCrudTable` hook parameterized by columns + form component + mutation
  hooks; per-entity files collapse to a config (M). Pure refactor, no behavior
  change — wants its own PR + test pass.

### Generic typing for the certify field registry (`types/certify-registry-generic`) — **deferred**

- `certify-field-registry.ts` condition/`formFields` lookups are keyed by bare
  strings probed via `(entity as Record<string, unknown>)[field]` in
  `entity-readiness.ts`. A typo in a registry key compiles fine and silently
  reads `undefined` → a readiness gate passes when it shouldn't. This class of
  bug produced the original **MRV durability gap** (fixed at the data layer +
  covered by a regression test in `tests/isometric-certify-context.test.ts`).
- **Why it matters:** the regression test closes the *known* instance; the
  *class* remains open — another mistyped key fails the same silent way.
- **Resolve via:** make the registry generic per entity —
  `CertifyFieldDescriptor<T>` with `condition.field: keyof T` and
  `formFields: readonly (keyof T)[]`, and `deriveEntityCertifyReadiness<T>`
  bound to the real row type per entity kind, so every key becomes a
  compile-checked property reference (M). Revisit when the registry next grows.

### Correlation-id field drift in removal submit (`observability/submit-correlation-id`) — **deferred**

- The removal submit flow binds `submissionAttemptId` on its child logger but
  several deeper boundary logs key the correlation field as `submissionId` (the
  DB row id) — an aggregator filtering on one won't see records keyed by the
  other. No data loss; weakens "trace one attempt end-to-end".
  `ghg-statements.ts` already uses `submissionAttemptId` consistently.
- **Resolve via:** thread the attempt-scoped `log` child through those boundary
  logs, or include both ids (S).

## Promotion #682 review follow-ups (opened 2026-08-14)

Findings from the multi-agent review of the staging-to-main promotion PR #682
that were verified real but deliberately not fixed in
`fix/promotion-682-review-findings` (which fixed the sync-event entity-id type,
the stale-lock script's entity type, the storage-location lock order, the GHG
interrupted marker, the interrupted-CAS visibility, PDF number formatting, and
the shared-project create gate fallback).

### A drifted draft with a confirmed registry write is permanently blocked (`certification/confirmed-drift-dead-end`)

A removal draft that latched `externalMutation: "confirmed"` and later hits a
payload-hash mismatch is retired by `retireForDrift` in
`src/fn/certification/removal-submission-freshness.ts` with
`preserveForReconciliation = true`, which throws before
`retireStaleSubmissionDraft` can run — and that is the symbol's only caller, so
`create-new-version` is unreachable for this state. `draft` also blocks
regrouping. The escape hatch is now `scripts/isometric-clear-stale-lock.ts`
(fixed to target `localEntityType = 'removal'`), but rejecting a
confirmed-write draft and re-versioning can double-create registry entries
because removal supplier refs are version-suffixed (`buildRemovalSupplierRef`).
**Resolve via:** a deliberate reconcile-or-discard path for
confirmed-mutation drafts, not the reject-and-reversion the script does.

### First-time Storage Location creates always run the bounded reconcile scan (`certification/storage-location-resumed-scan`)

`createStorageLocationUnderLocks` (`src/fn/certification/storage-locations.ts`)
passes `resumed: true` unconditionally, so every first create pages through
`findStorageLocationBySupplierReference`
(`src/lib/isometric/storage-locations.ts`), which scans at most 50 pages x 20
records and throws past that. Once a project holds more than 1000 storage
locations, no new site can be registered. `needs-registry-check`: whether
`GET /storage_locations` supports server-side filtering by
`supplier_reference_id`, which would remove the scan entirely.

### Crash-window interruption still loses the confirmed-write marker (`certification/interrupted-marker-crash-window`)

The interrupted markers written by
`recordClaimedRemovalSubmissionFailureBestEffort`
(`src/fn/certification/removal-submission-failure.ts`) and the GHG create path
are in-process best-effort writes inside a `catch`; a SIGTERM/timeout mid-POST
records nothing. On retry `readRemovalSubmissionExternalMutation` reports
`"none"`, so payload drift retires the draft without
`preserveForReconciliation` and the next version re-POSTs datapoints and
measurement samples under new version-suffixed supplier refs — a duplicate
GHG entry. **Resolve via:** persisting an attempt-started marker before the
first registry POST, or reconciling by unversioned keys.

### Order/delivery repoint does not guard the target lineage (`orders/repoint-target-lineage-guard`)

`updateSample` and `updateApplication` call the certification lineage guard on
the *target* parent when repointing; `updateOrder`
(`src/data-access/orders.ts`, repointing `biocharProductId`) and
`updateDelivery` (`src/data-access/deliveries.ts`, repointing `orderId` /
`biocharProductId`) guard only the entity's current lineage. Repointing an
order onto a product that belongs to a submitted removal grafts new chain-of-
custody onto a locked lineage after submission. Pre-existing, not introduced
by #682.

### Wet-mass allocation attributes draws to depleted intake batches (`feedstock/allocation-original-mass-weights`)

`allocateFeedstockWetMass` (`src/data-access/feedstock-wet-stock.ts`) weights
by each batch's original `massWetKg`, never remaining mass, so cumulative
`production_run_feedstocks` attribution to one batch can exceed its intake once
later batches share the bin. Bin stock stays correct; provenance (credit-batch
feedstock-type derivation, CoC Sankey) degrades. Carried over verbatim from the
pre-#676 dry allocator - a known limitation, not a regression.

### Dead legacy feedstock plumbing after multi-bin draws (`production-runs/legacy-feedstock-column`)

`production_runs.feedstock_storage_location_id` is hard-written `null` on
create and nulled on draw updates (`src/data-access/production-runs/mutations.ts`),
and `rejectLegacyFeedstockFields` (`src/schemas/production-runs.ts`) rejects
both legacy fields at the action layer - yet queries still select/join through
the column and the legacy fallback branches in `createProductionRun` are
unreachable (one validates a bin it then discards). Same cleanup family:
`recordStockTakeFn` / `useRecordStockTake` / `recordStockTakeMovement` lost
their only consumer when #666 deleted `StockTakeForm`, and the `visual`
null-method facet branch in `src/data-access/applications.ts` is unreachable
(`evidence_method` is NOT NULL) with a comment that now contradicts the
`"location"` UI fallback. Pre-production: drop the column and delete the dead
paths in one follow-up.

### Confirm: unapplied member runs now hard-block removal submission (`certification/unapplied-member-run-blocker`)

PR #660 (titled as gap routing) also made `productionReadinessGapForScope`
(`src/lib/certification/production-readiness-from-lineage.ts`) return a gap for
any completed member run with zero applications, and `hasSubmittableRuns` in
`src/fn/certification/certify-context-core.ts` turns that into a hard blocker
for the whole Removal. Batch membership is date-window auto-assignment
(`src/data-access/credit-batch-membership.ts`), and biochar is typically
applied weeks after production, so a run completed late in a crediting period
blocks an otherwise-complete batch until its product is applied. The sub-commit
says deliberate; needs a product confirmation that this is the intended
operational tradeoff, and this is not a registry requirement we verified.
