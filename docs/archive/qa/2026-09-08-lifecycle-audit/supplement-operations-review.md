# Supplemental independent investigation

This secondary Astra low report is evidence, not the final finding severity or proof grade. Read [the parent ledger](findings.md), which verifies, qualifies and deduplicates its claims. No new production behavior was implemented.

# Read-only operational audit

Baseline: `ef857545b11fa298f0f08e128868ed14e37fbf5f`. HEAD matched; working tree was clean. No files, databases, storage objects, or external records were modified. No tests, simulations, browser sessions, or agents were run.

Read repository guidance, domain vocabulary, architecture/forms/testing documentation, storage documentation, and relevant production/cohort/Isometric documentation. Isometric MCP `how_to` was unavailable. Findings below concern local implementation only; external contract verification remains with the parent.

## Coverage

**C/U/D** means the mutation entry points and principal persistence/guard paths were statically inspected, not runtime-tested. Paths below are relative to the repository root.

| Assigned surface | C/U/D coverage and layered path | State exceptions and protections |
|---|---|---|
| `/feedstocks` | `components/feedstocks/{feedstock-list,feedstock-form}` → `hooks/use-feedstocks` → `fn/feedstocks` → `data-access/feedstocks` → `schema/feedstock` | Create combines delivery information and one or more bin allocations atomically. Positive wet quantities; over-allocation requires justification. Edit affects an individual allocation. Used feedstocks cannot be deleted; edits have the stock gap in F2. |
| Nested feedstock deliveries | Inspected combined workflow and searched mounted components/actions for separate delivery mutations | Current operator workflow writes `feedstocks`, including `deliveryGroupId`; no separate mounted `feedstock_deliveries` CRUD entry was found. Legacy table/document ownership remains. |
| `/production-runs` | List/form → `use-production-runs` → `fn/production-runs` → `production-runs/mutations` → production tables | Draft/running/complete/failed/cancelled checked. Multiple bin draws, overlap, wet availability, dry balance, automatic cohort membership, downstream product locks, and optional `expectedUpdatedAt` checked. |
| Production-run detail | `/production-runs/[productionRunId]` redirects to `/production-runs?run=…` | Detail and editing are side-sheet surfaces, not a separate detail mutation implementation. |
| In-process measurements | `production-sample-{table,form}` → `use-production-samples` → `fn/production-samples` → `data-access/production-samples` | C/U/D plus deferred uploads inspected. Internal measurements are distinct from certification Samples. Composite parent/org FK prevents cross-org attachment. Their existence blocks parent run deletion through an unmapped FK failure; see state exceptions below. |
| Production incidents | Incident table/form → corresponding hook/action → `data-access/production-incidents` | C/U/D; parent/operator/reactor checks; document retirement on delete. Run deletion removes incidents transactionally. |
| Readings files | `production-readings-documents` → document/upload hooks → `fn/documents` → documents/storage | Upload/open/delete originals. CSV filename/MIME checks, no content inspection by current operator UI. F4 applies. |
| Structured readings/imports | Reading/import hooks → corresponding actions → `production-run-readings` / `production-run-reading-imports` | Legacy import inserts with timestamp deduplication; outcome stored on document. Bulk delete exists. No mounted import entry point; explicitly deferred in repository docs. |
| `/biochar-products` | List/form → `use-biochar-products` → `fn/biochar-products` → `biochar-product-create`, `biochar-products`, allocation/composition/stock helpers | C/U/D; source-bin allocations, ingredient draws, formulation snapshots, wet/dry basis, destination bin checks, delivery/order dependencies. Source-backed composition changes intentionally require a new product. |
| `/orders` | List/form → `use-orders` → `fn/orders` → `data-access/orders` → logistics tables | C/U/D; customer/location relationship, facility/product compatibility, quantity floor against delivery allocations. Product change with inheriting deliveries blocked; delete with deliveries blocked. |
| `/deliveries` | List/form → `use-deliveries` → `fn/deliveries` → delivery stock/order/dry-mass helpers → logistics tables | C/U/D; upcoming versus delivered, positive delivered mass, order allocation serialization, server-derived dry mass, application-dependent mass/lineage locks. Status/date reversal gap: F1. |
| `/applications` | List/form → `use-applications` → `fn/applications` → `data-access/applications` → applications/slices | C/U/D; delivered/date ordering, wet capacity under delivery row lock, dry allocation, effective GPS evidence validation, GIS reparsing, assigned-slice mass/delete locks. F1 can invalidate these invariants from the parent side. |
| `/credit-batches` and detail | List/form → `use-credit-batches` → `fn/credit-batches` → batch/membership/slice helpers | C/U/D; empty declaration supported; overlap/window/feedstock/run membership checks; sampling choice immutable. Detail route redirects to `?batch=…`. Delete preserves Samples but removes their only facility association: F3. |
| Batch durability and sample entry | Durability panel → certification summary hook; “Record a Sample” links to `/samples?create=true&createCreditBatch=…` | Summary is read-only; nested create uses canonical Sample workflow. Local tier/readiness behavior inspected; no external guarantees asserted. |
| `/samples` | List/form → `use-samples` → `fn/samples` → `data-access/samples` → production Sample table | C/U/D; required batch on create; chemistry reconciliation; locked effective-state checks on update; server reads inherited 1000-year requirements. Lab documents and manual transport included. F3/F5. |
| Documents and file deletion | File panels → `use-documents`/`use-file-upload` → `fn/documents` → document safety/retirement/outbox | Request/PUT/confirm, visibility, metadata action, delete, parent retirement inspected. Snapshot references block deletion; storage cleanup follows commit. Parent/upload race: F4. |
| Manual transport legs | Embedded editors/deferred Sample legs → transport hook/action → `data-access/transport-legs` | C/U/D; resolves owning entity, certification guard, transactional document retirement. Derived feedstock/distribution legs resync inside owning mutations. |
| Quick-add | Supplier, vehicle, operator, feedstock-type, formulation and bin dialogs; `fn/quick-add`, `data-access/quick-add`; canonical supplier/formulation actions | Schemas, org stamping, code handling, facility/bin references and selection return paths inspected. Quick-added prerequisites persist independently if the containing form is cancelled. No confirmed quick-add defect raised. |

## Strongest findings

### F1 — P1: Delivery status/date edits invalidate existing applications

**CONFIRMED CODE DEFECT — high confidence; reproduction not executed.**

**References**

- `src/components/deliveries/delivery-form.tsx:345–370`: status/date remain editable.
- `src/data-access/deliveries.ts:751–825`: application check runs only when order, effective product, or wet mass changes.
- `src/data-access/applications.ts:191–235`: application creation enforces delivered status and delivery-before-application ordering.
- `src/data-access/bin-stock-guards.ts:277–307`: physical delivered quantity counts only `status='delivered'`.

**Minimal reproduction**

1. Create an uncertified delivered delivery with positive wet mass.
2. Record an application against it.
3. Edit the delivery, changing only status to **Upcoming**, retaining mass, order and product.
4. Alternatively, change only its delivery date to after the application date.
5. Save using **Update Delivery**.

The server permits both changes. The existing application and its saved dry mass remain. Changing to Upcoming removes that delivery from physical delivered-stock subtraction, inflating available stock despite material already being applied.

**Counterevidence:** application creation locks the delivery; mass/order/product changes are blocked once applications exist; certified lineage blocks edits. These protections do not cover this sequential, uncertified status/date edit. Upcoming allocation accounting provides a separate constraint, so this finding does **not** claim every subsequent duplicate delivery will succeed.

**Operator outcome/message**

- Current: **“Delivery updated.”**
- Proposed rejection: **“Delivery was not saved. Applications already reference this delivery. Keep it Delivered and use a delivery date on or before the earliest application. Review the applications in Applications before correcting these records.”**
- Present recovery: operator opens `/deliveries`, restores the actual delivered status/date and saves. Refresh stock and `/applications`. Do not retry the invalid edit; no registry send occurred.

**Minimal fix:** under the existing delivery lock, check existing applications when status/date changes; reject an effective status other than delivered or a date later than any application.

### F2 — P1: Feedstock edits can remove stock already consumed

**CONFIRMED CODE DEFECT — high confidence; reproduction not executed.**

**References**

- `src/components/feedstocks/feedstock-list.tsx:321–353`: edit submits allocation wet mass, derived dry mass and bin.
- `src/fn/feedstocks.ts:193–211`: validates and forwards those values.
- `src/data-access/feedstocks.ts:625–666`: acquires bin locks, then writes without checking remaining stock.
- `src/data-access/lane-stock-derivation.ts:125–170,370–374`: stock is complete wet intake minus run/ingredient consumption plus movements.
- `src/data-access/lock-bin-stocks.ts:14–64`: locking provides serialization, not stock validation.

**Minimal reproduction**

1. Receive 1,000 kg wet feedstock into a bin.
2. Record a non-cancelled run drawing 800 kg.
3. Before certification, edit the feedstock allocation to 100 kg, keeping coherent moisture/dry mass.
4. Save.

The intake becomes 100 kg while the 800 kg draw and provenance allocation remain. Derived bin stock becomes **−700 kg**. Moving the consumed intake to another compatible bin similarly removes its supply from the original bin.

**Counterevidence:** withdrawal creation checks availability; deleting run-used feedstock is blocked; certified lineage blocks edits. None validates the post-edit balance. Stock deliberately remains unclamped to expose reconciliation problems; that display policy does not itself establish authorization for silently creating an overdraw through an ordinary intake edit.

**Operator outcome/message**

- Current: **“Feedstock updated.”**
- Proposed rejection: **“Feedstock was not saved. This change would leave its original bin short by 700 kg. Review the recorded withdrawals in Production runs before changing the intake.”**
- Present recovery: restore the correct intake through `/feedstocks`, then investigate the actual withdrawal/correction. Saving the same incorrect intake again will not repair it. No external send occurs.

**Minimal fix:** compare affected bins’ pre/post balances under the existing locks and reject an incremental overdraw, following the established production-output reduction pattern. Preserve explicit reconciliation workflows.

### F3 — P2: Deleting a credit batch makes current Samples disappear from facility lists

**CONFIRMED CODE DEFECT — high confidence; unlinking itself is an explicit policy choice.**

**References**

- `src/data-access/credit-batches.ts:835–848`: sets every linked Sample’s `creditBatchId` to null, then deletes the batch.
- `src/data-access/samples.ts:541–665`: current Sample creation stores a batch link without a production-run link.
- `src/data-access/samples.ts:200–206`: facility filtering requires either the run’s or batch’s facility.
- `src/components/samples/sample-list.tsx:248–254`: supplies active facility to that filter.
- `src/components/credit-batches/credit-batch-list.tsx:76–77`: confirmation explicitly describes clearing Sample membership.

**Minimal reproduction**

1. Create an unsubmitted credit batch and a Sample through its **Record a Sample** link.
2. Attach a lab report.
3. Delete the credit batch.
4. Refresh `/samples` with the original facility selected.

The Sample and report survive, but both Sample parent links are now null. It matches no facility list. Recreating the cohort does not automatically recover a commingled Sample because automatic relinking follows legacy production-run IDs.

**Counterevidence:** the delete dialog discloses unlinking, and direct Sample lookup still works. Therefore this is a discoverability/recovery defect, not undisclosed deletion of lab evidence.

**Operator outcome/message**

- Current: **“Credit batch deleted.”**
- Proposed minimal rejection: **“Credit batch was not deleted. It has lab Samples. Reassign them in Samples to the correct credit batch before deleting this grouping.”**
- Present recovery, if the Sample UUID was retained: open `/samples?facility=<facilityId>&sample=<sampleId>`, choose **Edit**, select the correct batch and **Save Changes**. Without IDs, the normal facility list offers no recovery destination.
- Do not recreate the Sample blindly; that duplicates retained evidence. Registry state is unchanged.

**Minimal fix:** block deletion while direct commingled Samples remain, or provide a real orphan-recovery surface retaining facility identity. Blocking is the smaller change.

### F4 — P2: Concurrent parent deletion can strand a new document and uploaded object

**CONFIRMED CODE DEFECT in synchronization — high confidence; interleaving not executed.**

**References**

- `src/fn/documents.ts:124–154`: parent check precedes an awaited presign operation and document insertion.
- `src/data-access/documents.ts:413–419`: insertion does not revalidate/lock the owner.
- `src/data-access/documents.ts:640–670`: parent retirement discovers and locks existing documents only.
- `src/db/schema/documentation.ts:25–30`: polymorphic owner ID has no parent FK.
- `src/fn/documents.ts:195–199,337–347`: confirm/delete require the owner to still exist.

**Minimal interleaving**

1. Start an upload on a deletable record, such as a feedstock with no dependencies.
2. Pause `createUploadUrl` after `assertCanManageDocumentEntity` succeeds.
3. Delete the parent completely in another request.
4. Resume presigning; `insertDocument` stores a pending row for the deleted parent.
5. PUT the file, then confirm.

Confirmation fails because the owner no longer exists. The pending document was absent from parent retirement, so its object has no deletion-outbox entry. Normal document deletion also rejects the missing parent.

**Counterevidence:** retirement detects documents appearing between its two discovery reads and protects existing mappings with mirror locks. A document inserted **after parent deletion commits** bypasses that protection.

**Operator outcome/message**

- Current: owner-missing failure during confirmation; parent deletion can already have succeeded.
- Proposed: **“The record was deleted while this file was uploading. The file was not attached. Refresh this page. An administrator must remove the incomplete upload before you attach it to another record.”**
- Operator: refresh the owning route; do not repeatedly retry against the deleted ID.
- Administrator: inspect the document ID/storage key and arrange targeted cleanup. There is no confirmed current operator cleanup button for this orphan.
- Saved state: parent absent, pending document and potentially object retained; no registry send is involved.

**Minimal fix:** serialize owner existence plus document insertion against owner deletion using a shared owner lock/transaction. File bytes remain a separate operation; avoid holding a DB transaction across PUT.

### F5 — P2: Lab-report deletion does not invalidate certification readiness

**CONFIRMED CODE DEFECT — high confidence for missing invalidation; visible duration untested.**

**References**

- `src/components/samples/sample-trailing-sections.tsx:76`: mounts editable lab-document panel.
- `src/components/samples/sample-documents-panel.tsx:40–42,62–68`: calls `useDeleteDocument` without owner information.
- `src/hooks/use-documents.ts:39–44`: owner type excludes `sample`.
- `src/hooks/use-documents.ts:146–160`: only the document list is invalidated without an owner.
- `src/hooks/use-documents.ts:24–30`: shared evidence invalidation explicitly refreshes certification readiness.

**Minimal reproduction**

1. Load readiness for a batch with an uploaded, deletable lab report.
2. Open its Sample in edit mode and delete the report.
3. Inspect cached readiness in the same client session.

The report list refreshes and deletion succeeds, but certification readiness queries are not invalidated by this path. Previously loaded evidence status can remain stale until another fetch.

**Counterevidence:** upload confirmation does invalidate shared evidence readiness; other document owners have deletion invalidation. Referenced submitted documents cannot be deleted. This is a stale local presentation defect, not proof of an invalid external submission.

**Operator outcome/message**

- Current: **“Document deleted”**.
- Proposed interim message: **“Lab report deleted. Refresh Credit batches to update evidence readiness. Submitted certification history was not changed.”**
- Operator: refresh `/credit-batches?batch=<id>` before relying on readiness. Do not retry deletion.
- Minimal fix: support `sample` in deletion owner handling and supply the owner from `SampleDocumentsPanel`.

## Other state exceptions and counterevidence

- **Run deletion with in-process measurements:** `production-runs/mutations.ts:957–990` deletes readings/incidents/draws but not production Samples. The FK at `schema/production.ts:443–446` rejects parent deletion. `fn/production-runs.ts:339–366` maps this to **“Failed to delete production run”**, without identifying the measurement. All transactional deletions roll back. Operator recovery is available: open `/production-runs?run=<id>`, edit, delete the in-process measurements, then retry run deletion. A specific dependency error is preferable to an implicit cascade.
- **Cross-org production-sample creation:** missing explicit parent `assertSameOrg` is backed by the composite organization/run FK. No cross-org write defect established.
- **Method-B contributing-sample snapshots:** `CONTEXT.md` explicitly identifies dependency-version locking as a target contract not yet implemented. The inspected Sample guard follows its own batch/run lineage, not a historical contributing-sample snapshot. Treat as an acknowledged implementation gap for the parent’s orchestration review, not a newly demonstrated registry violation.
- **Facility-tier race:** `samples.ts:486–493` explicitly acknowledges lack of synchronization with concurrent tier promotion. Not reproduced; no new finding asserted.
- **Legacy structured telemetry:** import/bulk-delete paths lack the same visible lineage guard as operational parent mutations, but no mounted operator entry exists. Repository tracks this deferred path. Do not describe a currently available “Re-import” button.
- **Stale forms:** production runs carry an explicit saved timestamp check. Most other forms submit values without equivalent optimistic versioning. Lost edits are possible in principle; no additional specific executed race is claimed.
- **Create recovery:** shared create-with-evidence choreography retains created IDs and opens edit after ordinary attachment failures, avoiding a second parent create. Unknown outcomes caused by lost responses remain untested; auto-generated codes provide uniqueness, not request idempotency.
- **Polymorphic transport creation:** owner resolution also precedes insertion (`transport-legs.ts:242–271`). A corresponding parent-delete race deserves an isolated test; not independently reproduced here.

## Existing protections

- Server actions authenticate organization context and validate mutation schemas; data access scopes queries and writes to that organization.
- Core stock withdrawals use shared bin locks; delivery allocations additionally serialize on orders/products.
- Product source allocations and ingredient mass basis preserve dry-biochar provenance.
- Application capacity checks lock the delivery before summing applied quantities.
- Cohort changes lock/recheck discovered membership and reject concurrent scope drift.
- Certification guards refuse mutations of captured lineage with blocking local ledger states.
- Document deletion checks reviewed evidence and persisted Source references under mirror locks.
- Parent deletion retires documents transactionally. Irreversible object deletion runs after commit through an organization-scoped retryable outbox.
- Storage deletion failures are retained for retry rather than rolling back a successfully deleted operational record.

## Tests for the parent

**None ran during this audit.** The following are existing relevant files, not claimed coverage of all findings.

Pure/mocked checks:

```bash
pnpm exec vitest run tests/documents-fn.test.ts src/hooks/use-documents-invalidation.test.ts src/hooks/use-create-with-evidence.test.ts src/schemas/feedstocks.test.ts src/schemas/deliveries.test.ts src/schemas/credit-batches.test.ts
```

Database-backed, registry-free checks, only after the parent provisions an isolated test database and fake storage where applicable:

```bash
pnpm exec vitest run tests/production-run-feedstock-wet-stock.test.ts tests/bin-stock-guards-concurrency.test.ts tests/stock-reducing-update-guards.test.ts tests/delivery-order-balance.test.ts tests/applications-mutations.test.ts tests/credit-batch-sample-linking.test.ts tests/credit-batch-auto-membership.test.ts tests/parent-document-retirement.test.ts tests/parent-document-mirror-release.test.ts tests/documents-delete-certification-history.test.ts tests/certification-lineage-guards.test.ts
```

Relevant hermetic browser files, requiring the parent’s isolated app/database:

```bash
pnpm exec playwright test tests/e2e/feedstocks.spec.ts tests/e2e/production-runs.spec.ts tests/e2e/production-run-readings-file.spec.ts tests/e2e/applications.spec.ts tests/e2e/credit-batches.spec.ts tests/e2e/samples.spec.ts --grep-invert '@live'
```

### Minimal high-value added tests

Extend existing fixtures rather than introducing a broad new suite:

1. `tests/delivery-order-balance.test.ts`: after creating an application, reject status-only Delivered → Upcoming and date-after-application edits; assert delivery/application/stock state unchanged.
2. `tests/production-run-feedstock-wet-stock.test.ts`: after an 800 kg draw from 1,000 kg intake, reject reducing intake to 100 kg and moving it to another bin.
3. `tests/credit-batch-sample-linking.test.ts`: delete a batch with a current commingled Sample and assert either intentional refusal or continued facility-scoped discoverability.
4. `tests/parent-document-retirement.test.ts`: gate fake-provider presigning, delete the owner, resume upload request, and assert no orphan document/outbox omission.
5. A focused Sample document-panel test: delete a lab report and assert certification readiness invalidation, not merely document-list refresh.

Suggested failure-injection structure for F4, to integrate with the existing fake provider and isolated DB fixture:

```ts
// Proposed source structure; not written or executed.
const entered = Promise.withResolvers<void>();
const resume = Promise.withResolvers<void>();
const originalPresign = provider.createUploadUrl.bind(provider);

provider.createUploadUrl = async (args) => {
  entered.resolve();
  await resume.promise;
  return originalPresign(args);
};

const pendingUpload = requestUpload(validUploadForParent);
await entered.promise;
await deleteParent(ctx, parentId);
resume.resolve();

const result = await pendingUpload;

// Expected after the fix:
expect(result.success).toBe(false);
expect(await documentsOwnedBy(parentId)).toEqual([]);
```

Use a second test for a parent deleted during PUT; that verifies byte cleanup/recovery separately from insertion serialization.

## Untested cases

No real database interleavings, transaction failures, network disconnects, upload retries, browser refresh behavior, timezone round trips, or external certification operations were executed. Quick-add persistence, nested transport failure recovery, durability promotion races, Method-B historical dependencies, and mutation-response loss require the parent’s isolated runtime or external contract verification. The coverage table records static inspection, not proof that every route/state combination passes.