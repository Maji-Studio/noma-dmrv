# QA Follow-up Questions

Unresolved QA findings, kept separately to respect the file-size limit.
The maintenance rules in [Open Questions](./open-questions.md) apply here too.

## QA 2026-07-21 remediation follow-ups (opened 2026-07-21)

Product decisions deferred from the staging UX audit + Isometric integration
remediation PR (archived ledgers:
[`2026-07-21-staging-ux-audit.md`](./archive/qa/2026-07-21-staging-ux-audit.md) and
[`2026-07-21-staging-isometric-integration.md`](./archive/qa/2026-07-21-staging-isometric-integration.md)).
The PR shipped the
Layer-1 fixes (named exclusion clocks, structured Removal setup gaps, removed
inert lifecycle badge, typed archive confirmation, Method-B baseline lower
bound); these are the decisions it deliberately did not make.

### Are future-dated samples legitimate planned records? (`samples/future-dates`)

- The remediation labels future-dated samples everywhere ("N future-dated -
  counted from <date>") but does not block them at entry: the QA synthetic
  chains themselves are future-dated, and the audit left block-vs-label as an
  open decision.
- **Resolve via:** decide whether sample entry should reject sampling times
  after "now" (with an explicit planned-samples workflow if planning is a real
  need), then enforce in `src/schemas/samples` + data-access (S).

### Who owns the Credit Batch lifecycle? (`credit-batches/lifecycle`)

- `credit_batches.status` still defaults every row to `pending` with no
  transition path; the badge/filter were removed from the UI rather than
  wired to anything. The enum (draft/pending/verified/issued/rejected) remains
  in the schema and the dashboard's "period ended · awaiting verification"
  attention item still keys on `status = 'pending'`.
- **Resolve via:** define the lifecycle's owner (local readiness vs Isometric
  submission/verification/issuance webhooks) and its transitions, then either
  drive the column from that machine and restore the badge, or drop the column
  (M).

### Blueprint-key gaps: operator-fixable or admin diagnostic? (`certification/blueprint-key-gaps`)

- The Removal wizard now names unresolved template blueprint keys instead of
  issuing the false link/template instruction, but the copy can only say "ask
  an administrator" - there is no in-app control that resolves a blueprint
  mapping.
- **Resolve via:** decide whether blueprint resolution belongs in Certification
  Settings (operator-facing) or stays an admin/support escalation; if the
  former, build the mapping surface (M).

### Archive governance for registry-submitted lineages (`facilities/archive-governance`)

- Archiving a facility with submitted Removals/GHG statements now requires the
  typed facility code plus a warning, but is still allowed for any admin. The
  audit proposed an admin-only governed path (reason, audit event, external
  IDs) for submitted lineages.
- **Resolve via:** decide whether submitted-lineage archive needs a separate
  governed workflow or the typed-code gate suffices pre-launch (S).

### Grouped cert-gap counts vs missing-field counts (`certification/gap-count-wording`)

- One grouped "cert gap" can contain several missing fields (e.g. telemetry +
  three photo roles). The counts are consistent across surfaces, but the
  wording never says "1 gap group · 4 missing fields".
- **Resolve via:** pick one convention (group count with expanded field list,
  or field count everywhere) and apply it to the card tag, health strip, and
  Removal wizard copy (S).

### Zoneless date/time construction outside the production-run form (`dates/zoneless-instants`)

- F-2 anchored the production-run start/end combiner to the facility timezone,
  but the same bug class survives elsewhere. `fn/production-incidents` and
  `fn/production-samples` parse a zoneless `"YYYY-MM-DDTHH:mm"` string with
  `new Date(...)` on the **server**, so the stored instant depends on the server
  process timezone; `data-access/production-runs/overlap` formats conflict
  messages in that same zone; and `productionRunDateExpr` casts `start_time` to
  a **UTC** calendar day rather than the facility day, so a near-midnight run
  can land in the wrong cohort date. Display counterparts in
  `production-incident-form`, `production-sample-form` and
  `components/samples/sample-form` render in the browser zone (the
  production-run side sheet was moved to the facility zone on 2026-07-25).
  Output stock events (placement, delivery, loss, count) follow the facility
  zone since 2026-09-29 (`EventTimeInput`, `formatFacilityDateTime`).
- **Resolve via:** decide one project-wide rule - instants are constructed and
  rendered in the facility zone, date-only values stay pinned to UTC (issue #46)
  - then apply it to the remaining sites and add a lint or test guard so a
  zoneless `new Date(string)` cannot reappear (M).

### Operator-initiated GHG statements are still refused on a shared project (`certification/shared-project-statement-create`)

- ADR 0023 scoped registry statement identity per organization + facility, so a
  re-pointed project no longer locks the new facility out on **sync**. But
  `assertDedicatedGhgStatementProject` still refuses operator-initiated creates
  while a project is shared across facilities, so the unlocked path is the
  sequential one (A imports → project re-points → B imports its own row).
  Whether two facilities on one live project should be able to create statements
  concurrently is unanswered - the guard was deliberately kept.
- **Resolve via:** confirm with Isometric whether one project may carry
  concurrent per-site statements for the same period; if yes, replace the guard
  with per-facility period scoping, if no, keep it and say so in the copy (M).

### Should CERT-field rules vary by pinned protocol version? (`certification/version-flexible-cert-fields`)

- The project is pinned to Biochar Production and Storage **v1.1** + Isometric
  Standard **v1.7** (Certify project settings), while the registry's latest
  certified line is v1.3 + Standard v2.1. `CERTIFY_FIELD_REGISTRY`
  (`src/lib/certification/certify-field-registry.ts`) is version-agnostic.
- Verified 2026-07-27 against registry content: for transport evidence the
  versions are identical (both run on Transportation module v1.1 - same per-leg
  required records, same mapped-distance allowance; delivery proof-of-delivery
  lives at v1.1 §8.3.1.1/§8.3.1.2 vs v1.3 §8.4). The first real divergence is
  the per-handoff custody-documentation clause (soil-environments v1.3 §8.8),
  which has **no counterpart** in agricultural-soils v1.1 - that, plus the
  dropped `custody_handoffs` table (migration 0037), becomes a genuine P0 only
  on a v1.2+ upgrade.
- Complication: Standard v1.7 mandates minor-version adoption "at the following
  verification", Standard v2.1 abolishes forced upgrades until crediting-period
  renewal. Which regime binds this project needs confirmation from Isometric.
- **Resolve via:** ask Isometric which Standard governs upgrades for this
  project; defer version-keyed registry entries until a concrete v1.2+ adoption
  date exists, then key new-in-version requirements (custody handoffs) on the
  pinned version (M).

### Storage board cannot sort bins by on-hand mass (`storage/sort-by-on-hand-mass`)

- The board's sort control (`BIN_SORT_OPTIONS` in
  `src/components/storage-locations/bin-display.ts`) offers only keys that
  resolve in SQL before LIMIT/OFFSET, so the order it shows holds across pages.
  "Most/least on hand" is missing from that list, and it is the sort an operator
  asks for first when deciding where to put a delivery.
- It is missing because on-hand mass is not a column. `binCurrentMassKg` reads
  the enriched row, and that enrichment runs **after** pagination: feedstock
  stock comes from `deriveLaneStock` (aggregates over feedstocks, production-run
  draws, product ingredients and feedstock bin movements), and biochar and
  product bin stock comes from the dry-biochar FIFO layers
  (`getOutputBinStocks`, ADR 0029). Sorting on it means replicating both
  inside the paginated query.
- Sorting the page in the client is not a substitute: it would order the twenty
  rows already fetched, so a nearly-full bin on page 3 would never rise to
  page 1. The board deliberately does no client-side re-sort for this reason.
- `lastActivityAt` shows the tractable shape of the fix - a correlated scalar
  subquery in `src/data-access/storage-location-activity.ts`, pinned by
  `tests/storage-location-activity-sort.test.ts`.
- **Resolve via:** express per-bin on-hand mass as one correlated subquery (or a
  materialised per-bin stock view) that `getStorageLocations` can ORDER BY, then
  add the option and extend the activity-sort test to cover it (M).

### Report-document attachment is check-then-insert (`certification/attach-report-document-race`)

- `attachReportDocument` (`src/data-access/certification.ts`) dedupes by
  selecting an existing `documents` row for the same
  `(organizationId, entityType, entityId, fileUrl)` before inserting, so two
  concurrent submits of the same external report URL can both miss and write
  duplicate ledger rows.
- The obvious fix is a unique constraint on that tuple plus
  `onConflictDoNothing`. It is deferred because `documents` is shared by the
  entity workflows and the generic `createDocument` path: constraining it would
  also stop an operator attaching the same external URL twice to one entity
  with different descriptions, which no one has asked for.
- Impact today is a duplicate ledger row on an org-admin-gated, rate-limited
  action; the generated-report path does not go through this function at all,
  since it reuses the report's own `documentId`.
- **Resolve via:** decide whether same-URL-per-entity duplicates are ever valid
  for any document type. If not, add the partial unique index (`fileUrl is not
  null`) and switch the insert to an upsert (S).

### Reconciled production batches are claimed on the supplier reference alone (`certification/production-batch-remote-drift`)

- `ensureProductionBatchesForCreditBatches`
  (`src/fn/certification/production-batches.ts`) claims an orphaned remote
  Production Batch when `findProductionBatchBySupplierRef` matches the stable
  `nm-ptb-…` reference, then journals the LOCALLY computed mass, window and
  payload hash. Facility, feedstock types, kind, dates and mass on the remote
  record are never compared, so a remote record created from different figures
  is adopted as if it matched.
- The same asymmetry applies after registration: drift between the registered
  payload and current local data is recorded as a sync event and logged, never
  applied, because `POST /production_batches` has no PATCH counterpart (verified
  against the Certify OpenAPI snapshot: `/production_batches` exposes GET/POST,
  `/production_batches/{id}` GET/DELETE only).
- Deferred rather than fixed because the only remedies are a remote-vs-local
  payload diff on every reconcile (a reconciliation engine for a path that
  fires on crash recovery), or DELETE-and-recreate, which discards a registry
  record verifiers may already reference.
- **Resolve via:** decide whether a mismatched remote Production Batch should
  block submission and be resolved by hand in Isometric, or be re-created after
  a DELETE. If blocking, compare the reconciled record's mass/window/facility
  and surface a conflict instead of claiming it (S).

### A zero-dry-mass chain passes every readiness surface and fails only at the registry POST (`certification/zero-dry-mass-late-gate`)

- Verified on staging 2026-08-05 (issue #630 negative case): a production run
  completed with 100 kg wet biochar at 100% moisture (0 kg dry) flows through
  product creation, delivery, application ("Ready"), the credit batch's "All
  batch data checks passed", and the pre-submit review's "Ready to submit,
  9 checks passed" - which simultaneously displays "You are sending 0.0 t".
- The only gate is `buildCreateProductionBatchRequest`
  (`src/lib/isometric/production-batches.ts`), whose `totalDryMassKg <= 0`
  branch fails the "Sending durability measurements" step with an actionable
  operator message. Fail-closed held: no ProductionBatch and no Removal reached
  the registry. But the gate fires AFTER the 15 monitored-input datapoint POSTs
  succeeded, so a refused submission leaves orphan datapoints in the registry.
- Root enabler: run completion validates positive WET output only
  (`complete-output-required` in `src/lib/production-runs/lifecycle.ts`) and a
  moisture of 100% is accepted, so 0 kg dry is legally reachable. The
  `runsMissingDryMass` (NULL dry mass) branch in
  `buildProductionBatchSubmission` (`src/fn/certification/production-batches.ts`)
  is unreachable from the UI - batch
  membership requires `complete` runs and `complete` requires wet output - so
  that branch is defence-in-depth only.
- **Resolve via:** decide which layers should also know. Candidates, roughly
  independent: (a) a readiness/pre-submit check that every member run has dry
  mass > 0, so the 9-check review catches it; (b) bound moisture below 100 or
  require dry mass > 0 at run completion; (c) run the pure production-batch
  payload validation before any datapoint POST so a refused submission leaves
  zero registry residue (S each).

### Where the certification lock falls, and what "Request amendment" does (`certification/amendment-flow`)

- Server-side enforcement exists and is tested
  (`assertCanMutateCertifiedLineage`,
  `tests/certification-lineage-guards.test.ts`); the UI carries an interim
  lock affordance (`isRemovalStatusLocked` drives the credit-batch menu and
  sheet lock plus the dropped-claimed-run warning).
- Interim state: the UI says "amend the Removal with the registry" without
  offering a flow. The UI predicate (derived status kinds) is deliberately
  looser than the server predicate (`BLOCKING_SUBMISSION_STATUSES`, where a
  stale draft submission still blocks), so an edge-case operator can reach a
  server rejection the UI did not preempt.
- **Resolve via:** DEC carbon team + Isometric decide where the lock falls
  per lifecycle state and what an amendment request does (registry API or
  operational process). Then align the two predicates and replace the locked
  Edit affordance with the amendment entry point (M). Per project memory,
  verify any Isometric requirement verbatim before building a gate.
  Follow-up issue: #687.

