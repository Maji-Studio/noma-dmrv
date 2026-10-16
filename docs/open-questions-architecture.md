# Architecture Open Questions

Deferred architecture, API and data decisions. Read this before working in
these areas; the entry rules and invariants live in
[open-questions.md](./open-questions.md).

## Architecture

### Align the Applications page credit batch filter (`app/application-batch-lineage-filter`, opened 2026-10-15)

- `src/data-access/applications.ts:getApplications` filters by delivery lineage
  (`inDeliveryCreditBatchLineage`), while the API uses each application's frozen
  shares or slices (`inApplicationCreditBatchLineage` in
  `src/data-access/credit-batch-lineage-filter.ts`). This includes mix-bin held-out
  applications; `src/data-access/credit-batch-accounting.ts:loadCreditBatchAccounting`
  requires a slice for its accounting view.
- **Follow-up:** align the app page on `inApplicationCreditBatchLineage`.

### Large application boundaries over the API (`api/large-gis-boundary`, opened 2026-10-15)

- REST and MCP bodies cap at 256 KiB (`API_BODY_MAX_BYTES`), while the app accepts
  raw boundary input up to 768 KiB and normalized geometry up to 512 KiB
  (`src/config/geo.ts`). Phase 6b accepts raw GeoJSON in the body and serves
  geometry through the separate boundary read; it does not expand that cap.
- **Follow-up:** decide whether larger geometry needs its own bounded transfer
  path. Until then, add larger boundaries in the app and tell API clients so.

### Simplification rollout follow-ups (`simplification/remaining-decisions`, opened 2026-10-14)

- **A5:** Data-access consolidation is skipped for now. List-query duplication
  remains in `src/data-access/suppliers.ts:getSuppliers` and peer accessors.
  Revisit when a list-query bug shows the duplication hurting; add a paging
  helper when already working in an affected file.
- **B1:** Keep `/schema` public, gate it to Platform Admins, or delete it? **Anchor:** `src/lib/auth/middleware.ts:PUBLIC_ROUTES`.
- **B3:** Keep both diagnostic views, only the trace view, or replace the pane with the CLI report? **Anchor:** `src/components/certification/removal-template-diagnostic-panel.tsx:RemovalTemplateDiagnosticPanel`.
- **B4:** Wire the two protocol constants, or retire them after registry verification? Contaminant results stay outside noma (#942 q6). **Anchor:** `src/lib/isometric/utils/constants.ts`.
- **B5:** Batch hub shared facts with per-row retry and polling, or use a blocking facility-wide load? **Anchor:** `src/hooks/use-certification.ts:useRemovalPreflightSummaries`.
- **B6:** Keep the three submission builds, or use an immutable guarded snapshot? **Anchor:** `src/fn/certification/biochar-application-intents.ts:compileBiocharApplicationIntents`.
- **B7:** Preserve each existence-check message, or standardize the copy? **Anchor:** `src/data-access/utils.ts:assertSameOrg`.
- **B8:** Standardize or preserve amber versus red unmet checks, six deep-link toast strings, Escape dismissal, and shared party fields? **Anchor:** `src/components/credit-batches/credit-batch-list.tsx:CreditBatchList`, `src/components/ui/data-table/index.tsx:DataTableColumnVisibility`.
- **B9:** Apply the facility phone regex everywhere, or keep entity-specific validation and update nullability? **Anchor:** `src/schemas/facilities.ts:contactPhoneSchema`.
- **B10:** Keep the archive policy, relocate history, and commit selected QA reports or ignore generated artifacts? **Anchor:** `docs/README.md`, `docs/qa/`.
- **B11:** Keep the day-boundary compatibility after a read-only sandbox timestamp audit? **Anchor:** `src/fn/certification/production-batches.ts:matchesLegacyDateBoundPayloadHash`.
- **B12:** Delete the two one-off investigation scripts? **Anchor:** `scripts/find-supplier-customer-overlap.ts`, `scripts/isometric-link-demo.ts`.
- **B13:** Introduce a composite CI action in two stages? **Anchor:** `.github/workflows/ci.yml`, `.github/workflows/migration-gate.yml`.
- **B14:** Split bin-picker aggregates into two phases only after a measured plan improvement? **Anchor:** `src/data-access/entities/storage-locations.ts:buildInventoryAggregates`.
- **A4 (appendix A16):** The gated submit-dialog flag and title extraction was omitted from #743. **Anchor:** `src/components/certification/ghg-statement-submit-dialog.tsx:GhgStatementSubmitDialogContent`. **Resolve via:** revisit once the GHG report folder is stable; extract the derivation beside `ghg-statement-workflow-state.ts` with a table-driven test pinning every current output and no label changes.
- **Resolve via:** Kenji answers B1 and B3 to B14 above; A5 stays deferred until the list-query trigger above.

### Keyset cursors accept foreign or unknown positions (`api/keyset-cursor-position`, opened 2026-10-14)

- **Anchor:** `src/lib/api/cursor.ts:decodeCursor` and
  `src/data-access/api-lookup-filters.ts:lookupPosition`.
- A re-encoded cursor with a foreign or unknown `position.id` answers 200
  instead of 404 on every reader that uses `lookupPosition`. The binding covers
  organization, resource and filters, but not the position. No rows leak.
- **Resolve via:** validate or sign the position once in the shared cursor
  code, with a test per reader for foreign and unknown positions.

### Positive mass inputs can be stored as zero (`api/mass-input-minimum`, opened 2026-10-14)

- **Anchor:** `src/schemas/helpers.ts:positiveMassKgSchema` and
  `src/schemas/feedstocks.ts:createFeedstockSchema`, `updateFeedstockSchema`.
- Zod's `multipleOf(0.001)` passes denormal values such as 5e-324. Feedstock
  total, allocation and PATCH wet mass can then be stored as zero
  (`src/schemas/feedstocks.ts` `feedstockFormSchema.totalWetMassKg`,
  `binAllocationSchema.allocatedWetMassKg` and `updateFeedstockSchema.massWetKg`).
  Run draws and product source mass answer 422. Orders have a 0.001 kg minimum since #1005.
- **Resolve via:** give `positiveMassKgSchema` a 0.001 kg minimum for every
  caller, with regression tests for denormals and the minimum.

### Rendered API reference (`api/rendered-reference`, opened 2026-10-08)

- **Anchor:** `src/lib/api/openapi/document.ts:buildOpenApiDocument` and
  `src/app/api/v1/openapi.json/route.ts:GET` publish the machine-readable contract.
- **Deferred:** Plan section 4 also calls for an adjacent rendered HTML reference.
  Choose the renderer and hosting path, then render this same document without
  maintaining a second contract.
- **Resolve via:** A documentation-surface follow-up after the public v1 contract.

### Auto-fill sample chemistry from an uploaded lab report (`samples/coa-autofill`, opened 2026-07-02)

- Parse an uploaded COA/lab-report PDF to pre-fill the sample form's ~30
  hand-transcribed chemistry fields. Upload slot already exists (`lab_report` on
  the sample's Evidence step). **Owned by #329** — extraction approach,
  review UX, and where parsing runs are all scoped there.

### #473 no-flash guarantee is now per-page, not global (`navigation/select-facility-deep-link-skeleton`, opened 2026-07-20)

- **Context:** the layout-level `FacilityGate` was deleted; the pre-resolution
  loading skeleton for a deep-linked `?facility=<id>` (issue #473) now lives
  inside `SelectFacilityEmptyState`
  (`src/components/navigation/select-facility-empty-state.tsx`), rendered only
  when a facility-scoped page reaches the point of rendering that component
  for its no-selection state.
- **Consequence:** the guarantee "a deep-linked facility never flashes an
  empty/select-a-facility state while it resolves" is an **invariant of
  `SelectFacilityEmptyState` usage**, not something the router or layout
  enforces. Any facility-scoped page that branches on the facility itself
  (e.g. an early return or a different empty-state component instead of
  rendering `SelectFacilityEmptyState`) can still flash on a direct/deep-link
  navigation, and nothing will catch it.
- **Test coverage gap:** the regression spec for #473
  (`tests/e2e/facility-gate.spec.ts`, `describe("Deep-linked facility
  resolves on direct navigation (#473)")`) only exercises `/reactors`. It does
  not assert the invariant on any other facility-scoped page.
- **To resolve:** either (a) audit every facility-scoped page to confirm its
  no-selection branch always routes through `SelectFacilityEmptyState` and add
  a lint/test convention that prevents future pages from rolling their own, or
  (b) extend `tests/e2e/facility-gate.spec.ts` to cover a second, differently-
  shaped facility-scoped page. Until then: **new facility-scoped pages must
  route their no-selection state through `SelectFacilityEmptyState`** rather
  than a bespoke empty state or early return.

### Facility switcher unreachable while an entity side sheet is open (`navigation/sheet-blocks-facility-switch`, opened 2026-07-20)

- QA 2026-07-20
  ([findings](./archive/qa/artifacts/2026-07-20-qa-a-b93d/findings.md), P2):
  with a detail or create sheet open, the modal overlay of
  `src/components/ui/entity-side-sheet/index.tsx:EntitySideSheet` makes the sidebar facility
  selector inert, so the operator cannot switch facilities without first
  closing the sheet. This is the modal behavior working as designed — the
  open question is the intended UX: keep the sheet modal (status quo),
  make it non-modal, or add an explicit close-and-switch flow that
  reconciles URL, navigation, and unsaved form state.
- **To resolve:** UX decision with DEC; adjacent to #253 (cross-facility
  context reconciliation), which any switch-while-open flow must satisfy.

### Registry picker needs approved Puro Earth / CSI logo assets (`onboarding/registry-picker-logos`, opened 2026-07-22)

- The archived onboarding plan
  ([`2026-07-21-onboarding.md`](./archive/plans/2026-07-21-onboarding.md)) asks the registry picker to show Puro Earth and CSI greyed **with their logos**.
  `src/components/certification/registry-picker.tsx` deliberately renders styled
  text wordmarks instead: we hold no approved logo files, and bundling
  unofficial reproductions of third-party registry branding is worse than no
  logo. (The component moved out of `onboarding/` on 2026-07-28 when the
  certifier settings pane became its second consumer.)
- **To resolve:** DEC obtains approved logo assets (and usage permission) for
  both registries, or amends the plan to accept text wordmarks. Swap the
  wordmark spans in `registry-picker.tsx` for the assets when they arrive.

### An Organization cannot be renamed (`tenancy/organization-rename`, opened 2026-07-28)

- `organizations.name` and `slug` (`src/db/schema/auth.ts`) are settable only at
  creation, through `createOrganizationWithOwner`
  (`src/data-access/organizations.ts`). There is no `updateOrganization`, so a
  typo at onboarding is permanent and shows in the sidebar brand, the settings
  subtitle, and every invitation email.
- **To resolve:** add `updateOrganization` plus a name/slug field on
  `/settings/organization` for Owners. A slug change needs a decision on
  existing invitation-accept URLs, which embed the invitation id rather than the
  slug — so probably none, but confirm before assuming.

### Discard-draft data access has no caller since Removal deletion (`certification/discard-draft-retirement`, opened 2026-09-08)

- Removal deletion (`src/fn/certification/delete-removal.ts:deleteRemoval`)
  replaced the wizard's discard control, and the discard hook and server
  action were removed with it. The data-access seam
  `src/data-access/certifier-removals.ts:discardLocalRemovalDraft` remains
  with no production caller, exercised only by
  `tests/registry-boundary-removal.test.ts`,
  `tests/removal-application-slice-assignment.test.ts`, and
  `tests/certification-submissions.test.ts` as the lock-protocol fixture.
  The `submissionExternalMutationPossible` Removal marker it used to consult
  is **not** dead: both delete surfaces read it as `registryBoundaryOpened`
  for the confirmation copy (`src/lib/certification/removal-external-mutation.ts`,
  consumed by `src/fn/certification/removals-hub.ts` and the certify
  context); issue #746 decides whether it also becomes a role gate.
- **To resolve:** retire `discardLocalRemovalDraft` and port the three
  fixtures onto `claimRemovalDeletion` (which takes the same Removal row and
  artifact locks), or record why the discard seam stays. The marker and its
  writer stay either way.

### A write whose commit is genuinely unknown has no operation identity (`architecture/uncertain-commit-identity`, opened 2026-09-16)

- Issue #769 removed the writers that reported a *known* commit as "not
  found". A connection lost between `COMMIT` and its acknowledgement is a
  different case: nothing in the app can tell a committed write from a rolled
  back one, so no result is honest. **To resolve:** decide whether writes
  carry a client-supplied operation id the server records and a retry can look
  up, or whether the retry-and-duplicate risk stays with the operator.

### An operation that awaits non-database work keeps its request past the deadline (`architecture/operation-callback-deadline`, opened 2026-10-07)

- `runOwnedTransaction` (`src/data-access/owned-transaction.ts`) arms
  `transaction_timeout`, but PostgreSQL ends only the session, not the
  JavaScript callback. If an operation's `execute` awaited a slow external call
  after its last query, the request and its checked-out client would wait for
  that call, past the deadline. Today no operation does: external effects run
  in after-commit hooks or are enqueued in the transaction (plan section 4).
  **To resolve:** if an operation ever needs external work inside its
  transaction, race the callback against the deadline and keep the client out
  of the pool until the callback settles; until then keep `execute` database-only.

### Production run row precedes delivery lineage artifacts (`data/production-run-artifact-order`, opened 2026-10-14)

`updateProductionRunInTransaction` in `src/data-access/production-runs/mutations.ts`
locks the run row FOR UPDATE before lineage artifacts. Delivery create in
`src/data-access/delivery-output-writes.ts:createDeliveryInTransaction` holds the
order's artifacts and then needs FK key-share on the run when `post` in
`src/data-access/output-stock-post.ts` inserts `outputStockRunAllocations`.
If both share a not-yet-submitted Removal, this can raise 40P01. Delivery creates
now run through the operation runner in both the app and the registered API
operation, so the whole transaction retries within its deadline. The lock-order
inversion remains: fix the run writer to lock artifacts before the run row.
Application writers are a new counterpart: they hold runs FOR SHARE from step 4
through commit, while production-run update and delete take FOR UPDATE before
artifacts; both use the runner, which retries deadlocks.
Credit-batch membership refresh is another counterpart: it holds batch
artifacts before locking current and prospective runs FOR UPDATE, opposite
production-run writers. Membership create, update and delete now use the same
bounded transaction retry policy in `src/lib/db/transaction-retry.ts` as the
runner, so either writer can retry a deadlock, serialization failure or lock
timeout; exhaustion returns
`concurrent_write_retry`.

This is part of `data/lock-order` below.

### Run writers, feedstock edits and output postings lock in different orders (`data/lock-order`, opened 2026-10-09)

Application create, update and delete now run through the operation runner and
lock artifacts before facilities, runs, batches, deliveries and the application.
This closes their document-write inversion. The companion membership reorder
also closes the commit 1 application/membership cycle (C1 and C2): explicit
batch create, update and delete now take artifacts, facility shares, sorted run
UPDATE locks on create or membership refresh, process scope and batch UPDATE,
then revalidate artifacts, member sets and cohort before reconciling slices.
Both artifact helpers share the same
global sorted acquisition helper. Facility shares serialize archive and Removal
create; runs stay before process scope to match production-run auto-attachment.
After scope, newly matching unassigned runs use non-blocking SKIP LOCKED
acquisition; a missed row returns a typed conflict. Scalar edits and delete do
not lock runs. Changed artifacts or current membership still refuse with a
typed conflict. Membership now shares the runner's bounded retry policy through
`src/lib/db/transaction-retry.ts`.
Production-run auto-attachment retains scope-before-batch-artifacts, opposite
membership's artifacts-before-scope, as well as run-before-artifacts, opposite
membership refresh. Both sides retry transaction aborts.

- `src/data-access/production-runs/mutations.ts:updateProductionRunInTransaction`
  and `src/data-access/production-runs/delete.ts:deleteProductionRunInTransaction`
  lock bins before the run row and certification lineage. Feedstock edits in
  `src/data-access/feedstocks.ts:updateFeedstockInTransaction` lock the intake
  row and lineage before bins, leaving a run-versus-feedstock deadlock cycle.
- Moving run rows and lineage ahead of bins would introduce other inversions:
  - Explicit credit-batch membership takes artifacts before process scope.
    Run attachment through `updateProductionRunInTransaction` still holds its
    run before that scope and before the batch artifacts. Changing the run
    writer's order must coordinate this residual too.
  - `src/data-access/output-stock-post.ts:withOutputStockPosting` takes bins
    before lineage or allocation foreign-key KEY SHARE locks on runs. A run
    writer holding its row or lineage while waiting for a bin would reverse
    this order.
  - `src/data-access/production-runs/feedstock-draws.ts:replaceProductionRunFeedstockDraws`
    inserts allocations into `productionRunFeedstocks`, taking foreign-key KEY
    SHARE locks on intake rows. Prelocking prospective lineage on run create
    can wait on `updateFeedstockInTransaction`, which already holds the intake
    row and waits on lineage.
- See [production run artifact order](#production-run-row-precedes-delivery-lineage-artifacts-dataproduction-run-artifact-order-opened-2026-10-14) for the delivery-create cycle.
- Run writers retain bins before rows and best-effort attachment. A global
  order must coordinate every writer, including implicit foreign-key locks.
- **Mitigation today:** `src/lib/operations/runner.ts:runOperation` retries the
  whole transaction a bounded number of times, with jitter, on deadlocks
  (40P01), serialization failures (40001) and operation lock-timeout aborts
  (55P03) before COMMIT, within the original deadline. Claims and writes roll
  back together. Exhausted attempts answer the retryable
  `concurrent_write_retry`; claim-lock waits answer `idempotency_in_progress`;
  spent deadlines answer `deadline_exceeded`.
  `src/data-access/owned-transaction.ts:runOwnedTransaction` rethrows COMMIT
  failures with SQLSTATE class 23 or 40, maps 25P04 to `deadline_exceeded`, and
  reports other COMMIT failures as `outcome_unknown`. The runner does not retry
  COMMIT failures. This does not establish a global order or add retries to
  callers that bypass the runner.
- Output-stock postings and product creates now run inside the runner's
  transaction (`record_output_stock_movement`, `make_biochar_product`,
  `update_biochar_product`), so they get the bounded retry above. Their bin lock
  order is unchanged, so the inversions listed here still apply to them.
- **Resolve via:** a cross-writer lock inventory, a documented order covering
  process scopes, artifacts, bins, parent rows and foreign keys, and
  deterministic races for run create/update/delete against intake edits, batch
  updates and output postings. Keep the runner retry even after the known
  inversions are removed.

### Production-run readings and incidents are not on the API (`api/production-run-readings-incidents`, opened 2026-10-09)

- Production runs expose start, update and delete only. The readings batch from
  [data-entry API plan section 8](./plans/2026-10-06-data-entry-api.md#8-batches-and-offline-design-now-build-later)
  and incident endpoints are deferred by decision 39. The existing seams are
  `src/lib/operations/production-runs.ts:startProductionRun`,
  `src/data-access/production-runs/readings.ts:getProductionRunReadings` and
  `src/fn/production-incidents.ts:createProductionIncidentFn`.
- Incident time (`src/schemas/production-incidents.ts:productionIncidentFormSchema.incidentTime`)
  still reads any string through `new Date(value)`, so a time without an offset
  takes the server's zone. Lab sample `samplingTime` moved onto
  `offsetInstantSchema` in Phase 5a.
- **Resolve via:** a scoped follow-up defining readings batch size, per-item
  outcomes and externalId replay semantics, plus incident operations,
  permissions, representations and outcome/BOLA tests. Reuse the reading import
  core and the shared operation runner before registering REST routes or MCP
  tools. Move incident time onto the shared instant helpers in the same change,
  with schema tests proving the parsing.

### Output-stock corrections are not on the API (`api/stock-corrections`, opened 2026-10-12)

- Decision 50 in the [data-entry API plan](./plans/2026-10-06-data-entry-api.md#13-decisions-kenji-2026-10-06)
  keeps corrections UI-only. `record_output_stock_movement` publishes
  `loss | count` and ignores `correctsMovementId`; the UI passes it through
  `src/fn/output-stock.ts:postOutputStockFn`. Movement history is readable at
  `GET /storage-locations/{id}/stock-movements`.
- **Resolve via:** a decision on scope (a destructive `stock-corrections:write`
  granted per key, any-of admission shared by REST and MCP listing,
  registration and rate-limit classification), delivery corrections, and
  tests for ordinary-only, correction-only, both and neither credentials.

### Output stock projection cost grows with bin history (`data/output-stock-projection-cost`, opened 2026-10-14)

- Every stock reader (posting, UI and API) reads all of a bin's rows before
  counting held layers, so cost grows with bin history. No cap or paging was
  added to the [stock read](./output-stock.md#api-stock-read). Pointer: `src/data-access/output-stock.ts:readOutputBinRows`, `src/data-access/output-bin-stock.ts:readOutputBinStockAt`.
- **Resolve via:** a held-layer index or a materialized balance if a real bin
  gets slow.

### Product ingredient snapshot repair has no operator action (`data/product-ingredient-snapshot-repair`, opened 2026-10-14)

- The stock read's `ingredient_snapshot_mismatch` answer gives no action an
  operator can take. No repair path exists for a product whose saved ingredient
  dry solids disagree with its composition. Pointer: `src/lib/output-stock/layer-projection.ts:UNRESOLVED_STOCK_SENTENCES.ingredient_snapshot_mismatch`.
- **Resolve via:** settle the repair action, then name it in the stock read's sentence.

### A submitted Removal locks an order against further deliveries (`certification/order-lineage-lock`, opened 2026-10-14)

- Round 9 Q69 (decision 78 in the [data-entry API plan](./plans/2026-10-06-data-entry-api.md#13-decisions-kenji-2026-10-06)) keeps the refusal: a new delivery on an order whose earlier delivery is in a submitted Removal is refused (typed `certification_locked` from 5b-2). Long-running partial-delivery orders need a second order today. Pointer: `src/data-access/delivery-output-writes.ts:createDeliveryInTransaction` guards the order through `lockCertifiedLineageArtifacts` and `assertLockedLineagesAllowMutation`.
- **Resolve via:** before allowing further deliveries, check that the derived per-product transport legs of submitted products cannot move. Enforce this in both the app and the API.

### Evidence found after submission (`certification/post-submission-evidence`, opened 2026-10-15)

`src/data-access/document-write-scope.ts:assertDocumentOwnerWritable` refuses
document changes on blocking submitted lineage, including new receipts, in both
the app and API. This follows round 10 Q75: affected records must not change
after submission. A receipt discovered later has nowhere to go except a new
record. Decide how operators should attach and relate that late evidence without
changing the submitted record or its certification history. This is a product
follow-up, not permission to weaken the current guard.


### A multi-sample create must not assume one credit batch or one sampling time (`api/multi-sample-create`, opened 2026-10-13)

- Round 7 Q49 kept `POST /lab-samples` and `record_lab_sample` single
  (`src/lib/operations/lab-samples.ts:recordLabSample`). Kenji's note: saving
  several samples at once should be possible, but they usually come from
  different production dates. See the batches topic in plan
  [section 8](./plans/2026-10-06-data-entry-api.md#8-batches-and-offline-design-now-build-later).
- **Resolve via:** a multi-sample endpoint whose items each carry their own
  `creditBatchId` and `samplingTime`, with one idempotency key and audit effect
  for the whole body, results in request order and pointers
  `/samples/{index}/...`. Do not copy the earlier one-batch draft.

### Transport-leg update and delete read their parent outside the transaction (`data/transport-leg-parent-reads`, opened 2026-10-13)

- `src/data-access/transport-legs.ts:updateTransportLeg` and
  `deleteTransportLeg` read the leg's parent through the global `db` before
  their transaction. Only `createTransportLeg` was moved under the sample lock
  scope (artifacts, credit batches in id order, then sample) in Phase 5a. A
  sample deleted or reassigned in between is not seen by the pre-read, and the
  global read can self-deadlock when the pool size is 1.
- **Resolve via:** take the same lock scope and re-resolve the parent inside the
  transaction for update and delete, with create-vs-delete and update-vs-delete
  tests in both orders.

### No keyset index backs the API list orderings (`data/api-keyset-list-indexes`, opened 2026-10-13)

- Every API list orders by `(createdAt, id)` within an organization
  (`src/data-access/api-lab-samples.ts`, `src/data-access/api-credit-batches.ts`,
  and the feedstock, production-run and product lists). No list table has an
  `(organization_id, created_at, id)` index; `src/db/schema/production.ts`
  indexes `production_runs` by facility only, and `samples` by credit batch and
  sampling time.
- Fine at pilot volumes. **Resolve via:** measure a list at realistic volume,
  then add one covering index per list table in a single migration.

### Registry credentials can be replaced but not removed (`certification/credential-removal`, opened 2026-07-28)

- The certifier settings pane replaces keys by typing over a masked field, and
  the "Remove" control that used to sit above the form is gone
  (`src/components/organizations/organization-certifier-credentials.tsx`). The
  data-access primitive `deleteCertifierCredentials`
  (`src/data-access/certifier-credentials.ts`) remains and is exercised by test
  teardown, but no surface calls it, so an organization cannot disconnect from
  the registry from the UI.
- **To resolve:** decide whether disconnecting is a real operator need. If it
  is, it belongs as a destructive action on the Certifier pane with a confirm
  dialog, not as the row treatment it replaced.

### New organizations still inherit Dark Earth Carbon's feedstock catalog (`tenancy/starter-feedstock-catalog`, opened 2026-07-28)

- `seedOrgDefaults` (`src/db/org-defaults.ts`) injects
  `STARTER_FEEDSTOCK_TYPES`, an operator-specific starter catalog, into every
  organization at creation. Harmless while DEC is the only tenant; wrong as
  soon as it is not.
- **To resolve:** a Platform-Admin choice at org creation, or an onboarding step
  that picks a catalog. Not an operating default: it creates records rather than
  seeding a form, so it does not belong on `/settings/defaults`.

### ADR 0026's org-level plausibility overrides are unbuilt (`data-quality/plausibility-overrides`, opened 2026-07-28)

- [ADR 0026](./adr/0026-plausibility-warnings-are-advisory.md) specifies that
  each rule has "a versioned system default and may have an Admin-managed
  Organization override". No plausibility module exists under `src/`, so neither
  half is implemented.
- **To resolve:** build the rule engine first. When it exists, the override
  surface is `/settings/defaults`
  (`src/components/settings/organization-defaults-form.tsx`) — the table
  `organization_settings` and its Owner/Admin gate are already in place. Keep
  the distinction that page is built on: advisory thresholds may be
  org-editable, certification gates may not.

### White-label dashboards per Organization (`tenancy/white-label`, opened 2026-06-11)

- **Deferred (2026-06-11 multi-tenancy grilling):** at launch each Organization
  gets the org-scoped app with its name/logo in the chrome — no per-org
  subdomains, theming, or branded invitation emails.
- **To resolve:** revisit on client demand; scope is wildcard domain routing,
  per-org theme tokens, branded Resend templates
  ([`docs/mail-setup.md`](./mail-setup.md)).

### Facility-wide monitoring dashboard / live map (`coc/facility-dashboard`, opened 2026-06-11)

- **Recorded as future, out of scope** (2026-06-11 chain-of-custody-views
  grilling): the Maji concept canvas also contains a one-screen monitoring
  dashboard (KPIs, geospatial panel, mini-Sankey, sensors, credit ledger), a
  facility-wide live map spanning all batches/routes, and an outward-facing
  public provenance showcase. The credit-batch anchor
  ([ADR 0011](./adr/0011-credit-batch-anchored-chain-of-custody.md)) deliberately
  covers only batch-scoped provenance.
- **To resolve:** decide whether the existing dashboard route grows a
  geospatial/mass-balance panel, and whether a buyer-facing shareable page is
  wanted (different audience, different auth surface).

### Facility-anchored transport origin breaks on multi-hop / multi-storage orgs (`transport/multi-hop-distribution`, opened 2026-06-11)

Merged 2026-07-20 with the former `transport/storage-topology` — one question.

- **Current model:** a biochar product carries exactly ONE auto-derived
  distribution leg (facility → delivery destination), aggregated from its
  deliveries via `aggregateDistributionLegs` (mass-weighted distance,
  `transport_legs` one-derived-per-entity invariant). The **facility** (name +
  GPS) is the hard-coded origin — the storage location a product actually sits
  in never enters the route. Matches Dark Earth Carbon's flow. The manual
  "biochar → storage" leg editor was removed from the product sheet (it predated
  derivation and invited rows the resync didn't own).
- **Question:** how to stay correct when an org trucks biochar to an
  intermediate storage/depot first, or simply adds a second storage location.
  Both cases mean two or more real legs per product with different masses per
  hop, which the single-derived-leg invariant can't represent; and
  `biochar-storage` emissions (template group currently empty) would need
  per-location attribution once sites have different energy/fuel profiles. The
  live Certify template's `biochar-transport` component takes one distance + mass
  pair per removal.
- **Why it matters:** a second storage site silently changes real transport
  distances and storage emissions without changing anything the derivation
  reads, so submitted numbers drift from reality.
- **To resolve:** wait for an org with intermediate storage or a second site;
  then decide (a) multi-leg derivation with hop ordering (origin = the product's
  bin location, storage locations gaining GPS + distance provenance), folded into
  one equivalent Σ(dist×mass) for Certify, or (b) per-hop components in the
  removal template — plus whether storage-site transfers become first-class
  custody events in the trail. Touches `aggregateDistributionLegs`, the
  one-derived-per-entity index, and the batch readiness transport gate.
- **Route freezing (#420):** `src/data-access/biochar-delivery-transport.ts:loadBiocharDeliveryTransportLegs`
  uses live customer-location
  distances even for submitted Removals; only the submitted payload snapshot is
  immutable. Decide when and how to freeze routes separately from applied loads.
- **See also:** #456, #420.

### Order dates display the previous day west of UTC (`orders/order-date-display`, opened 2026-10-14)

- **Anchor:** `src/components/orders/order-list.tsx:OrderList` and
  `src/components/orders/order-read-sections.tsx:orderSheetSections`.
- The order list and read view format `orderDate` in the browser zone and show
  the previous day west of UTC (`src/components/orders/order-list.tsx` `OrderList` date cell,
  `src/components/orders/order-read-sections.tsx` `orderSheetSections` date field). The form was fixed in #1005.
- **Resolve via:** use calendar-date formatting in both views, with regression
  tests in a browser zone west of UTC.

### Split `src/db/seed-data.ts` into domain seed modules (`db/seed-modularization`, opened 2026-06-11)

- **Problem:** `seed-data.ts` is well over the repository's 1000-line cap and
  grows as each new domain appends its block to the single transaction.
- **Note the lint exemption:** `eslint.config.mjs` lists
  `src/db/seed-data.ts` in the `ignores` array alongside the generated Isometric
  types, so `max-lines` will **never** flag it. Removing that exemption is part
  of this work; nothing else will surface the file.
- **To resolve:** extract per-domain modules into a new domain seed-module
  directory and leave `seed-data.ts` a thin orchestrator. Mechanical but
  touchy — the blocks share the `ids` map — so do it as a dedicated refactor
  PR (M).

### Postgres RLS as defense-in-depth (`tenancy/rls`, opened 2026-06-11)

- **Deferred, not rejected** ([ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md)):
  the `organizationId`-on-every-table schema is RLS-ready with zero schema
  change. Add RLS policies + per-transaction `SET LOCAL` if a client
  contractually requires isolation guarantees beyond data-access enforcement.
  Drizzle's first-class `pgPolicy` support (0.45/kit 0.31) is available now.

### Certifier-credential key rotation (`tenancy/credentials-key-rotation`, opened 2026-07-12)

- **Problem:** stored per-org certifier credentials
  (`certifier_credentials.*_encrypted`) are AES-256-GCM payloads prefixed with
  `v1:` — a *payload-format* version, **not** a key identifier. There is exactly
  one active `CREDENTIALS_ENCRYPTION_KEY`, so rotating it makes every existing
  row undecryptable (fail-closed: reads throw "authentication failed", not
  silent corruption). No dual-key or re-encrypt path exists.
- **Why it matters:** once real production credentials are stored, rotation
  (routine hygiene, or incident response after a suspected leak) becomes a
  data-loss event requiring every org to re-enter its secrets.
- **Decide before production data exists:** (a) add a key-id to the payload
  header (`v1:<keyId>:…`) so rows self-describe; (b) support a primary + set of
  decrypt-only retired keys with a background re-encrypt pass during a bounded
  rotation window. Cheap now, expensive to retrofit (M). See
  [`docs/security.md`](./security.md).

### Drop the `ALLOW_SELF_SIGNUP` flag (`auth/drop-self-signup-flag`, opened 2026-07-20)

- **Decided:** public self-signup is not a supported configuration. The product
  is B2B invite-only, so the flag has exactly one correct value and is a tunable
  that is never tuned.
- **Current state:** `false` in every environment — `.env.example:28`,
  `tests/setup.ts:21`, `.github/workflows/e2e.yml:35`,
  `.github/workflows/e2e-live.yml:41` — feeding
  `disableSignUp: !env.ALLOW_SELF_SIGNUP` (`src/lib/auth/better-auth.ts:171`).
- **Simplification (S):** hardcode `disableSignUp: true`, delete
  `ALLOW_SELF_SIGNUP` from `src/config/env.ts:64` and the four environment
  declarations, and rewrite `tests/auth-config.test.ts:6` to assert the constant
  rather than the env round-trip. Removes a config surface whose only failure
  mode is someone setting it to `true`.
- **Why it hasn't been done:** no urgency — the flag is fail-closed and every
  environment already pins it. Worth folding into the next auth-area change
  rather than as its own PR.

### Does the app-shell scrollport deserve a permanent E2E guard? (`e2e/scrollport-guard`, opened 2026-07-29)

- **Problem:** the temporary `zz-app-shell-scrollport` / `zz-redirect-route-errors`
  specs were deleted (they pinned facility UUID `6769395d-…` that no seed or
  fixture creates, so every route rendered the select-facility empty state and
  the suite hung 600s×2 in CI). The layout change they were written for
  (`md:h-screen md:overflow-hidden` in `src/app/(app)/layout.tsx`, which moves
  the desktop scrollbar from the window into `main`) shipped and settled, but
  nothing now asserts the scrollport frame: a regression would break
  `position: sticky` silently on every page.
- **To resolve:** decide whether the frame warrants a purpose-built spec on
  `seededData.facility.id` (assert `main` is the scrollport on a normal route
  and that the two full-bleed canvas routes do not scroll), or whether the
  sticky behavior is exercised enough by existing route specs to leave
  unguarded (S).

### Only the GHG statement report PDF renders deterministic bytes (`certification/ledger-pdf-determinism`, opened 2026-08-06)

- **Observed:** @react-pdf/pdfkit writes each compressed object when its own
  async deflate ends (so the threadpool permutes object order in the file) and
  tags every embedded subset font with `Math.random()`. Neither has a seam in
  @react-pdf/renderer 4.5.1, so `renderGhgStatementReportPdf` post-processes its
  output through
  `src/lib/certification/ghg-statement-report/canonical-pdf.ts`.
- Every other document built on `renderLedgerToBuffer`
  (`src/lib/certification/evidence-ledger/pdf-theme.ts`) is still byte-unstable.
  That is harmless today because only the GHG statement report has a stored
  checksum operators and verifiers compare.
- **Resolve via:** if a second ledger ever gains a checksum or a stored-artifact
  verification gate, move the canonicalizer next to `renderLedgerToBuffer` and
  apply it to every ledger rather than copying it (S).

### Final objects left by a failed confirmation (`storage/orphaned-final-keys`, opened 2026-10-15)

Promotion candidates now persist on the pending document before PUT. Confirm,
delete, owner retirement and the sweep hand off unused candidates to the deletion
queue, excluding the committed live key. Candidate cleanup waits past in-flight
preparation; a key handed off to cleanup cannot become live in a later confirm.
A crash between recording the candidate and PUT is harmless: cleanup deletes an
absent object. No final bytes from this upload path remain untracked. An inventory
collector is no longer required for this residual.


### Index failed-document retention scans (`storage/failed-retention-index`, opened 2026-10-15)

Consider a partial index `documents(updated_at) WHERE upload_status = 'failed'`
to keep the retention sweep from scanning unrelated documents as the table grows.
This requires a migration and is deferred from this PR. Measure the retention
query plan and scan cost before adding it.
