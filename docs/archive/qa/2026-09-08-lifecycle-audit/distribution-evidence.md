# Distribution and evidence CRUD lifecycle audit

Independent Astra low CLI report. Consult [the parent audit](README.md) for verified rankings, later database simulations, and combined test results. The investigator’s environment limitations below describe its own run; the parent subsequently installed dependencies and tested a disposable database.

**Baseline:** `ef857545b11fa298f0f08e128868ed14e37fbf5f`  
**Checkout:** `/Users/kenji/.codex/worktrees/d483/noma-dmrv`  
**Audit date:** 2026-09-08

This audit found reproducible problems in application GIS editing, optional-field clearing, customer creation, supplier deletion, and upload retry handling. The distribution layer also contains substantial defensive behavior: transactional stock checks, organization filtering, certification lineage locks, and durable storage deletion queues.

No repository files or shared records were edited. No database or registry operations, commits, messages to others, or agent spawning occurred.

## Evidence and verification limits

I read `.claude/CLAUDE.md`, `CONTEXT.md`, the handoff, and the relevant forms, storage, testing, architecture, authentication, and UX-writing documentation.

The checkout reported the expected SHA and no tracked modifications. Git emitted sandbox warnings about creating its temporary macOS cache. This did not prevent reading the SHA.

Four isolated checks executed successfully through `pnpm exec node`. They read function bodies from this checkout and executed them with built-in assertions and in-memory mocks:

1. The shared evidence guard rejects a held attachment.
2. `numericValue("")` returns `undefined`.
3. Customer creation preserves the customer and first location after the second location fails, while retaining create mode.
4. Supplier deletion preserves the supplier but loses its locations when the final deletion fails.

These are **executed function-level simulations**, not browser or database tests. An initial here-document invocation could not create a sandbox temporary file; the equivalent inline invocation succeeded.

There is no checkout-local `node_modules`. I did not install dependencies or run Vitest. I inspected test setup before considering tests. Several relevant suites write to PostgreSQL and were deliberately not executed.

All other conclusions below are static code findings or explicitly labeled hypotheses. Registry orchestration and external Isometric contract validation remain with the registry investigator.

File references are relative to the audited checkout.

## Coverage matrix

**S:** statically traced. **E:** an isolated function-level simulation executed. **N/A:** no corresponding operator capability found.

| Route or entity | Create | Edit | Delete | State and failure coverage |
|---|---|---|---|---|
| `/orders` | S | S, E clearing helper | S | Required product/customer/facility, optional destination/value, derived fulfillment, allocated quantity, stock, downstream deliveries, certified lineage, stale forms |
| `/deliveries` | S | S | S | Upcoming/delivered, mass requirement, product and facility scope, order allocation, application linkage, derived transport, deferred evidence |
| `/applications` | S | S, E evidence guard and clearing helper | S | Applied creation, legacy delivered status, delivery eligibility/date/capacity, GPS evidence, GIS replacement, assigned slices, certification freeze |
| `/customers` | S, E partial creation | S | S | Duplicate names/codes, pending locations, stale forms, related locations/orders, missing records |
| `/customers/[customerId]` and location dialogs | S | S | S | Default location, required GPS in forms, partial action payloads, inherited transport updates, referencing orders/deliveries |
| `/suppliers` | S | S | S, E partial deletion | Atomic supplier-plus-locations creation, duplicate names/codes, references, concurrent/failing deletion |
| `/suppliers/[supplierId]` and location dialogs | S | S | S | Default location, null fields, scoping, location deletion |
| Driver selector quick-add | S | N/A | N/A | Organization-owned insertion, auto-code collision handling, response loss, persistent record after parent cancellation |
| Vehicle selector quick-add | S | N/A | N/A | Unique name, vehicle schema, optional fuel metadata, unit conversion, organization scope |
| Operator selector quick-add | S | N/A | N/A | Organization-owned insertion, duplicate-name handling, response loss |
| Transport legs under feedstock/biochar/sample | S | S | S | Manual/deferred legs, derived legs, parent resolution, certification locks, evidence retirement, retry ambiguity |
| `/samples` | S | S | S | Credit-batch association, laboratory chemistry, tier validation, carbon reconciliation, deferred lab reports and transport legs |
| In-process measurements under production runs | S | S | S | Separate from lab Samples; operator scope, composite run/org FK, evidence cleanup, missing records |
| Documents and evidence panels | S | S metadata/visibility | S | Pending/uploaded/failed, presign/PUT/confirm, MIME/size checks, private/public reads, source snapshots, parent retirement |
| Deferred attachments | S, E guard | S | S local removal | Per-target success retention, partial flush, retry, refresh loss, close guard |
| Storage deletion queue | N/A | S retry processing | S | Commit-before-storage, provider failure, configuration mismatch, retry backoff, idempotent delete |

This matrix describes inspection coverage, not a claim that every cell passed runtime verification.

## UI → hook → action → data-access → schema evidence

| Entity | Concrete chain |
|---|---|
| Orders | `components/orders/order-list.tsx:221` → `hooks/use-orders.ts:97` / `:134` / `:252` → `fn/orders.ts:95` / `:132` / `:160` → `data-access/orders.ts:371` / `:431` / `:639` → `schemas/orders.ts:35`, `db/schema/logistics.ts:65` |
| Deliveries | `components/deliveries/delivery-list.tsx:395` → `hooks/use-deliveries.ts:136` / `:179` / `:305` → `fn/deliveries.ts:162` / `:225` / `:279` → `data-access/deliveries.ts:484` / `:619` / `:863` → `schemas/deliveries.ts`, `db/schema/logistics.ts:109` |
| Applications | `components/applications/application-list.tsx:345` / `:347` / `:399` → `hooks/use-applications.ts:107` / `:129` / `:156` → `fn/applications.ts:112` / `:151` / `:200` → `data-access/applications.ts:630` / `:704` / `:849` → `schemas/applications.ts:134`, `db/schema/application.ts:19` |
| Customers | `components/customers/customer-list.tsx:183` → `hooks/use-customers.ts:123` / `:163` / `:291` → `fn/customers.ts` customer CRUD actions → `data-access/customers.ts:330` / `:368` / `:429` → `schemas/customers.ts`, `db/schema/parties.ts:63` |
| Customer locations | `components/customers/customer-location-dialog.tsx:55` → `hooks/use-customers.ts:402` / `:447` / `:490` → `fn/customers.ts` location actions → `data-access/customers.ts:479` / `:556` / `:655` → `schemas/customers.ts` location schemas, `db/schema/parties.ts:100` |
| Suppliers | `components/suppliers/supplier-list.tsx` → `hooks/use-suppliers.ts:171` / `:335` → `fn/suppliers.ts:177` / `:304` → `data-access/suppliers.ts:328` / `:412` / `:498` → `schemas/suppliers.ts:193`, `db/schema/parties.ts:10` |
| Supplier locations | `components/suppliers/supplier-location-dialog.tsx:53` → supplier location hooks → supplier location actions → `data-access/suppliers.ts:578` / `:646` / `:702` → `schemas/suppliers.ts:160` / `:203`, `db/schema/parties.ts:160` |
| Drivers/vehicles/operators | `components/forms/entity-select/{driver,vehicle,operator}-quick-add-dialog.tsx` → `hooks/use-quick-add-submit.ts:26` → `fn/quick-add.ts` → `data-access/quick-add.ts` → `schemas/quick-add.ts`, `db/schema/parties.ts:214` / `:233`, `db/schema/logistics.ts:37` |
| Transport legs | `components/transport-legs/transport-legs-editor.tsx:128` / `:163` → `hooks/use-transport-legs.ts` → `fn/transport-legs.ts` → `data-access/transport-legs.ts:242` / `:286` / `:328` → `schemas/transport-legs.ts`, `db/schema/logistics.ts:213` |
| Lab Samples | `components/samples/sample-list.tsx:319` / `:444` / `:467` → `hooks/use-samples.ts:120` / `:169` / `:306` → `fn/samples.ts:177` / `:279` / `:389` → `data-access/samples.ts:541` / `:668` / `:868` → `schemas/samples.ts:332` / `:338`, `db/schema/production.ts:205` |
| In-process measurements | `components/production-runs/production-sample-table.tsx:128` / `:147` → `hooks/use-production-samples.ts` → `fn/production-samples.ts` → `data-access/production-samples.ts` → `schemas/production-samples.ts`, `db/schema/production.ts:420` |
| Evidence | `components/forms/form-file-upload.tsx` and owning evidence panels → `hooks/use-file-upload.ts` / `hooks/use-documents.ts` → `fn/documents.ts:91` / `:185` / `:321` → `data-access/documents.ts:413` / `:521` → `schemas/documents.ts`, `db/schema/documentation.ts:20` |

## Ranked confirmed defects

### D1. P1: Supplier deletion can delete locations and then report failure

**Evidence:** `data-access/suppliers.ts:519` checks only `feedstocks`; `:536` deletes supplier locations; `:543` deletes the supplier. These writes are not enclosed in one transaction.

**Executed simulation:** The actual `deleteSupplier` body ran against a mock query builder. The location deletion succeeded; the supplier deletion threw an injected FK failure. Observed state:

```text
supplier exists: true
supplier locations exist: false
operation rejects: true
```

**Concrete database failure path:** `db/schema/feedstock.ts:30` defines a restrictive `feedstock_deliveries.supplier_id` FK. A supplier referenced by a feedstock-delivery row but no current `feedstocks` row passes the precheck and can fail at the final delete. A concurrent intake insertion or infrastructure failure after the location deletion provides another trigger.

**Expected:** Either the supplier and its intended children are deleted together, or all remain intact.

**Operator impact:** A failed delete is not evidence that nothing changed. Retrying cannot restore the locations.

**Accurate copy for the existing failure condition:**

> Supplier deletion did not finish. The supplier still exists, but its locations may have been removed. Open the supplier in Suppliers and check its locations before trying again.

Resolver: a Member can inspect and recreate known location information through `/suppliers/[supplierId]` → **Add Location**. There is no audited undo operation. Missing original values require investigation by the application maintainer; do not promise restoration.

After an atomic implementation, copy can safely say:

> Supplier was not deleted. It is still linked to feedstock records.

Name the blocking records when available. Do not direct users to delete historical material merely to clear this error.

**Fix:** One transaction for reference checks and both deletes, with FK errors translated to a useful blocker message.

**Meaningful tests:** Fail after location deletion; verify rollback. Test a supplier referenced only by `feedstock_deliveries`. Interleave intake insertion with deletion and verify no partial child loss.

---

### D2. P1: Uploading a GIS boundary while editing an application blocks Save

**Evidence:**

- `application-evidence-panel.tsx:160` adds the original GIS file to deferred attachments.
- `use-deferred-attachments.ts:109` assigns status `"held"`.
- `application-list.tsx:355` invokes `guardUpdate()` before saving.
- `use-create-with-evidence.ts:134` blocks every status other than `"uploaded"`.
- The intended save-then-flush operation appears later at `application-list.tsx:362` and is unreachable for this held file.
- `failed-deferred-attachments.tsx:23` renders recovery controls only for `"failed"` attachments.

The comment at `application-list.tsx:352` says held files are permitted. The implementation contradicts that comment.

**Reproduction:**

1. Open an editable application at `/applications`.
2. Edit its GIS boundary using an uploaded file.
3. Click **Save** in the GIS dialog.
4. Submit the application form.

**Observed, static plus executed guard check:** The file is held; the guard returns `true`; the application update and upload do not run. A held file does not appear in the failed-file retry list.

**Expected:** Save the application changes and upload the held boundary, retaining an explicit partial-upload recovery state if upload fails.

**Copy:**

> Application changes have not been saved. The selected boundary file has not been uploaded. Repeating Save will not resolve this problem. Cancel this edit to keep the saved application unchanged.

Resolver: application maintainer. A Member can cancel or remove the newly selected boundary, but there is no working upload-and-save recovery for this edit path as implemented. Do not invent a “Retry boundary” button.

**Fix:** Give application edits an explicit held-file policy. Permit held files to reach the post-save flush while continuing to block failed or in-flight work appropriately.

**Meaningful test:** Render the application edit flow, select a valid GIS file, submit, and assert one update followed by one upload. Inject upload failure and verify the saved application ID and retry state survive.

---

### D3. P2: Customer-plus-locations creation leaves a partial save in create mode

**Evidence:** `components/customers/customer-list.tsx:183` creates the customer, then creates locations sequentially. Its catch sets an error but does not retain the created customer as the editing target.

**Executed simulation:** The actual handler saved the customer and location A; location B failed. The handler remained in create mode and displayed only the child failure.

**Reproduction:**

1. Open `/customers` → **Create Customer**.
2. Add two pending locations.
3. Let customer creation and the first location request succeed.
4. Fail the second location request.

**Observed:** Customer and first location persist. The form still offers **Create Customer**. Retrying repeats parent creation, commonly hitting the unique-name guard. Changing the name to bypass that error risks creating another customer.

**Expected:** An atomic customer-plus-locations operation, or a retained customer ID and recovery flow for only the missing locations.

**Copy:**

> Customer was created, but not all locations were saved. Open the customer in Customers and check its locations. Use Add Location for any missing locations.

Resolver: Member. Retrying **Create Customer** is not the safe recovery. The existing routes support reviewing and completing the saved customer.

**Defensive precedent:** Supplier creation already uses `createSupplierWithLocations` in a transaction at `data-access/suppliers.ts:328`.

**Fix:** Reuse that bounded atomic pattern for customers. Do not introduce a general workflow engine.

**Meaningful test:** Fail each child insertion in turn and assert either total rollback or an explicit partial result containing the customer and saved-location IDs.

---

### D4. P2: Optional order and application values cannot be cleared from their forms

**Evidence:**

- `components/orders/order-form.tsx:368` uses `numericValue` for **Value**.
- `components/applications/application-form.tsx:661` uses it for soil temperature.
- `lib/form-utils.ts:9` maps empty input to `undefined`.
- `schemas/applications.ts` maps empty application-method and soil-temperature-source selections to `undefined`.
- `data-access/orders.ts:610` passes the patch to Drizzle.
- `data-access/applications.ts:824` onward writes optional fields only when they are not `undefined`.

**Executed check:** The actual numeric coercion body returns `undefined` for an empty input.

**Reproduction:**

1. Save an order with Value `250`, or an application with soil temperature `25`.
2. Edit it, empty that field, and save.
3. Reopen the record.

For application method and soil-temperature source, choose the empty selection where offered.

**Observed, static persistence proof:** The cleared field is omitted from the write and the previous value remains. The operation can otherwise succeed.

**Expected:** A submitted empty optional field becomes `null`; an absent patch field remains unchanged.

**Copy until corrected:**

> The saved value was not cleared. Other changes may have been saved. Reopen this record to check its values. Repeating Save with this field empty will not clear it.

Routes: `/orders` or `/applications`, record edit → **Save Changes** or the application form’s save action. Resolver: application maintainer; no audited operator action correctly clears these affected fields. Zero is not an acceptable substitute.

**Fix:** Use nullable coercion for editable optional numbers and `"" → null` for clearable enums. Preserve omission semantics in partial server actions.

**Meaningful tests:** Round-trip populated → empty → `null`, populated → omitted → unchanged, and populated → zero → zero. Test through the form resolver and action boundary.

---

### D5. P2: Upload confirmation response loss makes retry create another document

**Evidence:**

- `fn/documents.ts:154` inserts a new pending document for each request.
- `hooks/use-file-upload.ts:240` waits for confirmation before returning its document ID.
- Its catch at `:248` reports failure without retaining an actionable document ID.
- `use-deferred-attachments.ts:175` records the target as successful only after `upload()` resolves.
- `fn/documents.ts:199` rejects confirmation of an already uploaded row and tells the user to upload again.

**Reproduction by failure injection:**

1. Request upload, PUT bytes, and commit `confirmUpload`.
2. Lose the confirmation response.
3. Click **Retry uploads** or **Retry**.

**Observed, static:** The first document is uploaded, but the client marks the attachment failed. Retry requests a new document and storage key. Both documents can remain uploaded.

A lost response before confirmation instead leaves a pending document/object that retry does not reuse.

**Expected:** Reconcile the same upload attempt and document ID before allocating another document.

**Copy:**

> Upload confirmation was not received. The file may already be saved. Reopen this record and check its documents before using Retry uploads.

Resolver: Member can inspect the owning record and open documents. If duplicate documents exist and are unprotected, the existing **Delete [filename]** action can remove one. If certification history protects them, an Admin must review the linked certification record; this audit found no general duplicate-source merge action.

Retrying is safe for the parent entity only after its ID is known. It is not currently duplicate-free for the evidence.

**Existing test:** `tests/documents-fn.test.ts:417` explicitly expects re-confirmation to fail. That test records current behavior; it does not cover lost-response recovery.

**Fix:** Retain the allocated document ID across failures. Make confirmation idempotently return a successfully uploaded document after authorization checks. Add a reconciliation path for pending attempts.

**Meaningful tests:** Lose responses after pending-row insertion, after PUT, and after confirmation commit. Retry must produce one logical document and must not label an unknown outcome “not uploaded.”

---

### D6. P2: Order customer selection exposes only the first 100 customers

**Evidence:** `components/orders/order-form.tsx:141` calls `useCustomers({ pageSize: 100 })`, then constructs all customer options from that single page at `:147–155`. No customer pagination or server-search input is passed by this selector.

**Reproduction:** In an organization with more than 100 customers, create an order for a customer outside the first sorted page.

**Observed, static:** That customer is absent from the available options. An existing order referencing such a customer also lacks that customer in this option set.

**Expected:** All organization customers remain selectable through bounded search or pagination.

**Copy:**

> This customer is not available in the order selector. Check that it exists in Customers. Do not create another customer with the same details.

Resolver: application maintainer. `/customers` can establish existence, but there is no audited order-form control that fetches the missing page.

**Fix:** Use the existing searchable entity selector pattern or a paginated customer lookup that preserves the selected record.

**Meaningful test:** Return a first page without the selected customer, then verify by-ID hydration and server search can select that customer without loading the entire organization.

---

### D7. P3: Customer deletion instructs the operator to cancel orders, but cancellation cannot clear the blocker

**Evidence:**

- `data-access/customers.ts:462` says: “Cancel or reassign those orders first.”
- The count includes every referencing order.
- `lib/orders/fulfillment.ts:2` explicitly defines fulfillment as derived.
- The order schema exposes no stored cancellation state or cancellation action.

**Observed:** The error points to an unavailable recovery action. Even a hypothetical status-only cancellation would not satisfy the current reference count.

**Expected copy:**

> Customer was not deleted because orders still use it. Open Orders and review those orders. Reassign them where appropriate, or keep this customer.

Resolver: Member, subject to downstream certification locks. `/orders` → edit → **Save Changes** is an actual route. Do not recommend deleting operational history solely to remove the customer.

**Fix:** Correct the message and, preferably, return blocker IDs/codes for direct navigation.

**Meaningful test:** Assert the delete refusal lists supported recovery choices and remains unchanged when referencing orders exist.

## Confirmed defensive gaps requiring parent reachability verification

These are proven properties of the inspected functions. Their full operator-path impact needs the parent’s cross-area verification before assigning the same confidence as D1–D7.

### G1. Parent document retirement skips reviewed documents that have no provider mapping

**Evidence:**

- Single-document deletion always calls `releaseUnreferencedIsometricMapping`, which checks reviewed evidence before looking for a mapping: `data-access/documents.ts:490`.
- Parent retirement invokes that helper only while iterating existing mappings: `:674–699`.
- Unmapped owned documents then proceed directly to deletion: `:701–720`.
- `data-access/removal-evidence-refresh.ts:41–50` can persist reviewed document IDs without requiring an existing mapping.

**Proven helper-level result:** An unmapped document named in `evidenceRefreshCandidates` is protected by single-document deletion but is not checked by parent retirement.

**Important qualification:** Order, delivery, application, Sample, and transport-leg deletion may already be blocked by their certification-lineage guards. Therefore this report does **not** claim that every such parent can currently bypass review protection.

**Parent verification:** Find a real reviewed candidate whose owning parent lacks an equivalent lineage freeze, or whose ownership is not reached by that guard. Then reproduce parent deletion with an isolated fixture.

**Required invariant and copy if blocked:**

> This record was not deleted because one of its documents is part of reviewed certification evidence. Ask an Organization Admin to review the linked Removal.

Do not promise an “unreview” or “unlock” capability without verifying it. The document and storage object must remain unchanged.

**Fix:** Check review protection for every owned document, independently of whether it has a provider mapping.

### G2. Upload authorization and document insertion do not share a parent-lifetime lock

**Evidence:**

- `fn/documents.ts:124` checks the parent.
- Presigning occurs afterward.
- `:154` inserts the document separately.
- `documents.entityId` is polymorphic, without a parent FK.
- Parent retirement detects documents introduced between its candidate scan and locked scan, but cannot detect insertion after its final scan.

**Static interleaving:**

```text
Upload checks parent existence.
Parent deletion completes and retires its current documents.
Upload inserts a pending document for the deleted parent.
```

Confirmation later rejects because the parent no longer exists. The document row and possibly uploaded bytes can remain orphaned.

**Qualification:** This interleaving was not executed against PostgreSQL.

**Copy:**

> The owning record is no longer available. The file was not attached to an active record. Refresh the page before uploading again.

Saved-byte certainty remains unknown until reconciliation. Resolver: Member can verify the parent; application maintainer handles orphan cleanup because no orphan-management UI was found.

**Fix:** Serialize document insertion with parent retirement through a shared entity-lifetime lock and revalidate within the protected operation.

## Hypotheses and unresolved design choices

| Area | Evidence and uncertainty | Verification needed |
|---|---|---|
| Stale-form overwrites | Inspected forms submit full values; writes generally have no expected-version predicate. Row locks preserve invariants but do not detect that an operator edited an old snapshot. | Two forms read the same row; save different fields in each; establish whether the second silently restores the first field. Decide where conflict detection is required. |
| Ordinary create response loss | Auto-codes prevent code collisions, not duplicate logical requests. Orders, applications, deliveries, Samples, and drivers lack an audited persistent create-attempt key. | Commit create, drop response, retry. Check duplicates and stock/capacity consequences. |
| Deferred files on refresh/close | Files and per-target success are held in React state. `confirmClose` only prompts for attachments in create mode; post-create failures move to edit mode. | Verify sheet-level dirty guards and browser navigation behavior before claiming silent loss. |
| Date-only round trips | Orders, deliveries, and applications use `z.coerce.date()` with local-date defaults. Documentation acknowledges this legacy contract. | Test repeated edit/save in both positive and negative UTC offsets. No date defect was executed here. |
| Customer-location partial patches | `updateCustomerLocationFn` converts omitted state/city to null; numeric helper semantics also need checking for omission. The full form supplies these fields, so action-level exposure differs from ordinary UI usage. | Parse an ID-only/name-only patch and assert unrelated values remain unchanged. |
| Location default concurrency | First-location creation counts rows without a parent lock; partial unique indexes prevent duplicate defaults. | Concurrent first-location creation should produce either two valid locations with one default or a useful retryable conflict. |
| Evidence metadata after review | Classification updates at `fn/documents.ts:277` do not use the review/mirror lock used by deletion. | Registry investigator must establish whether snapshots preserve classification or later operations reread mutable metadata. |
| Transport model year | `schemas/transport-legs.ts` uses a general optional positive number; `db/schema/logistics.ts:242` is an integer. The current form does not appear to expose an editable model-year control. | Action-level fractional/overflow cases; do not describe this as a reproduced operator-form failure. |
| In-process measurements on archived runs | Composite FK enforces org consistency, but create does not explicitly check active run state. These measurements are internal-only. | Parent should decide whether archived-run mutation is prohibited and inspect actual UI reachability. |
| Customer-location cleanup drain | `data-access/customers.ts:649` returns its transaction before the following storage-deletion drain. The call is unreachable. | Establish whether any current location update retires managed objects before ranking operational impact. |
| Quick-add edit/delete absence | Drivers, vehicles, and operators have create/select capability but no update/delete functions found in `src`. | Treat as a product lifecycle decision, not automatically a defect. Determine how erroneous entries should be corrected. |

## Existing defenses worth preserving

### Organization and reference scope

Normal inspected queries filter their owning records by organization. Creation derives organization ownership from authenticated context.

Examples:

- Delivery driver and vehicle references: `data-access/deliveries.ts:512`.
- Delivery order/product organization and facility validation: `:518–548`.
- Order customer/location validation: `data-access/orders.ts:388`.
- Sample credit-batch reference validation: `data-access/samples.ts:587`.
- Transport parent resolution before mutation: `data-access/transport-legs.ts:248`.
- In-process measurement run/org composite FK: `db/schema/production.ts:443`.

I found no confirmed cross-organization read or write bypass in the assigned flows. A missing explicit application-layer guard is not a leak when a checked composite FK prevents the write; the in-process measurement case is an example.

### Stock and downstream consistency

- Upcoming deliveries allocate order quantity, even though physical stock treatment differs.
- Delivery creation locks order balance after the physical-stock tier.
- Delivery updates merge against the locked delivery before enforcing delivered-mass validity.
- Changing order, product, or wet mass is refused when applications already depend on the delivery.
- Order quantity cannot fall below existing delivery allocations.
- Application capacity is checked against a locked delivery.
- Application dry mass is server-derived.
- Application slice mutability is checked before recalculating attribution.
- Sample carbon reconciliation runs against the locked row, not just the earlier read.
- Sample tier checks account for moving a Sample between credit batches.

These are useful domain invariants. Replacing them with optimistic UI checks would weaken correctness.

### Certification freeze

`data-access/certification-lineage-guards.ts` resolves lineage, acquires artifact locks in deterministic order, re-resolves lineage, and rejects newly introduced unlocked artifacts.

`BLOCKING_SUBMISSION_STATUSES` includes `draft`, `submitted`, and `accepted`. An apparently “draft” local submission can therefore intentionally freeze upstream records. That is not itself a defect.

The operator messages often lack a concrete linked Removal, but the lock should remain server-enforced.

### Evidence and storage

- Upload rules are checked before presign and authoritatively after PUT using object HEAD.
- Pending documents do not satisfy uploaded-evidence checks.
- Missing photo EXIF is flagged rather than rejected.
- Ordinary document reads go through the application authorization route.
- Private/public cross-org behavior is deliberate and tested.
- Legacy external redirects are allowlisted.
- Single-document deletion protects reviewed candidates and Source references.
- Unreferenced local Isometric mappings can be retired without deleting the remote Source.
- Parent retirement queues object deletion within the database transaction.
- Storage deletion happens only after commit.
- Failed storage deletion remains durably retryable.
- Provider/bucket mismatch does not cause deletion from a different configured bucket.
- Storage cleanup failure is caught rather than converted into a false parent-mutation failure.

### Deferred creation

`use-create-with-evidence` retains created IDs and opens edit mode after ordinary attachment failure. `use-deferred-attachments` records successful target IDs and skips those targets on subsequent retries. Sample creation separately retains failed transport legs.

Those are good foundations. The GIS bug comes from applying the same unresolved-file guard to two different phases of work.

## Failure and concurrency simulation ledger

| Scenario | Result | Basis |
|---|---|---|
| Customer saved; second location fails | Partial save, create mode retained | Executed actual handler with mocks |
| Supplier locations deleted; final supplier delete fails | Partial deletion | Executed actual function with mocks |
| Held GIS file during application edit | Save guard blocks | Executed actual guard; static UI wiring |
| Clear order Value/application temperature | Empty becomes omitted value | Executed coercion; static persistence trace |
| Create succeeds; one attachment fails | Created ID retained; edit recovery opened | Static code; existing choreography tests |
| Multi-target file partly succeeds | Successful targets skipped on retry | Static deferred-attachment implementation |
| PUT hangs | Ten-minute total XHR timeout | Static `use-file-upload.ts` |
| Presign or confirm action hangs | No equivalent explicit deadline found in this hook | Static; runtime framework behavior untested |
| PUT succeeds; confirmation response is lost | Retry can duplicate document | Static failure interleaving |
| Storage delete fails after DB commit | Record retired; queued retry survives | Static implementation; existing DB-backed tests |
| Submitted Source document deleted directly | Refused before storage deletion | Static; existing DB-backed tests |
| Reviewed unmapped document retired through parent helper | Review check omitted | Static helper proof; route reachability pending |
| Upload races with parent deletion | Orphan pending document possible | Static interleaving; DB test pending |
| Delivery exceeds physical stock/order balance | Server checks under locks | Static; existing targeted test coverage |
| Application exceeds delivery capacity | Server refusal | Static |
| Delivery lineage changes after applications exist | Server refusal | Static |
| Mutation targets another organization | Scoped absence/FK rejection in inspected paths | Static; no live cross-org execution |
| Two stale forms save | No audited user-version conflict check | Hypothesis pending full-flow test |
| Create commits; response lost; operator retries | Logical duplication possible | Static absence of persistent request identity |
| Refresh during failed deferred work | In-memory file queue cannot survive remount | Static; exact navigation UX untested |
| Quick-add succeeds; parent form cancelled | Quick-added entity remains independently saved | Static; product policy needs explicit treatment |

## Existing tests and gaps

Inspected relevant coverage includes:

- `src/hooks/use-create-with-evidence.test.ts`: success order, partial failure, retained IDs, task-specific error messages, update guards, close prompts.
- `tests/documents-fn.test.ts`: authorization, size/MIME rejection, CSV restrictions, EXIF flags, confirmation, classification, certification-safe deletion.
- `tests/documents-route.test.ts`: private/public reads, malformed IDs, pending rows, redirect restrictions.
- `tests/documents-delete-certification-history.test.ts`: unreferenced mapping retirement, failed storage cleanup, persisted Source references.
- `tests/parent-document-retirement.test.ts`: rollback, cross-org preservation, nested evidence, storage failure retries, configuration mismatch and queue fairness.
- `src/fn/samples.test.ts`: local credit-batch sampling-window behavior.
- Sample carbon-reconciliation, delivery balance/stock, schema parity, and transport-evidence tests.

**None of these suites were run in this audit.** Their presence is evidence of intended coverage, not a passing result for this checkout.

The highest-value missing tests cross existing module boundaries:

1. Application GIS edit plus the shared evidence guard.
2. Customer parent creation plus child-location failure.
3. Supplier parent deletion plus final-step failure.
4. Form clearing through action payload and stored result.
5. Upload completion plus lost acknowledgement.
6. Reviewed evidence without a provider mapping plus parent retirement.
7. Upload insertion interleaved with parent deletion.
8. Two stale operator forms saving the same record.

## Prioritized implementation plan

### 1. Stop partial destructive outcomes

Make supplier deletion atomic. Check all relevant references, retain FK backstops, and translate refusal into blocker-aware copy.

In parallel, verify G1’s reachable parents and protect every reviewed document during retirement.

### 2. Restore blocked and misleading form behavior

Fix application held-GIS handling and optional null clearing. These are bounded changes with clear regression cases.

Use existing schemas/helpers. Preserve explicit `undefined` for omitted partial updates and `null` for clearing.

### 3. Make compound customer creation atomic

Add a customer-plus-locations action following the supplier implementation. Avoid client-side rollback through separate delete requests.

### 4. Preserve operation identity across uncertain outcomes

Start with uploads:

- Retain document IDs before PUT.
- Reconcile pending/uploaded state after lost responses.
- Make confirmation idempotent.
- Distinguish definite failure from unknown outcome.
- Retry the same attempt before allocating another.

Then evaluate persistent create-attempt IDs for non-unique operational records. Auto-code retries solve collisions, not request deduplication.

### 5. Close parent/evidence concurrency seams

Use one shared parent-lifetime synchronization contract for upload insertion and parent retirement. Do not rely solely on a document scan to prevent later insertions.

Test deterministic interleavings with barriers rather than probabilistic repeated runs.

### 6. Improve stale-form and blocker handling

For records where lost updates matter, introduce expected-version checks or carefully scoped patches. Return a conflict that keeps the operator’s draft available.

Return blocker identity and the relevant route alongside refusal text. Avoid generic instructions to “remove dependencies” when those dependencies represent real operational history.

### 7. Complete selector and copy fixes

Replace the capped order customer dropdown with the existing searchable selector pattern. Remove the unsupported order-cancellation instruction.

Decide the intended correction lifecycle for quick-added drivers, vehicles, and operators before implementing broad master-data CRUD.

## Minimal hermetic verification plan for the parent

The executed checks require only Node and can be repeated with `pnpm exec node -e`. They read the function body from disk, instantiate it with `Function`/`AsyncFunction`, and inject in-memory callbacks/query builders. They do not import the application DB module.

For repository regression tests, use an isolated Vitest configuration with **no `tests/setup.ts`**, and mock:

- `@/db` and every data-access dependency that could connect.
- Authentication context.
- Storage through the explicit test-provider injection seam.
- Document actions for UI tests.
- Browser PUT through fake XHR.

Before executing each suite, inspect its complete import/setup path. In particular, do not run `tests/parent-document-retirement.test.ts` or `tests/documents-delete-certification-history.test.ts` as “unit tests”: they import the real DB and create fixtures.

Database lock/FK tests should be prepared for a separately authorized disposable database. They were not run under this audit’s prohibition on DB mutation.

## Explicitly untested

- Browser rendering, focus, actual button disable timing, and side-sheet navigation.
- Real PostgreSQL FK failures, deadlocks, isolation interleavings, and rollback.
- Real storage PUT/HEAD/DELETE, CORS, credentials, and provider timeouts.
- Registry availability, submission, deletion, recreation, or remote Source behavior.
- Live staging records, including all records named in the handoff.
- Full cross-org execution with two authenticated browser sessions.
- Date-only round trips across timezones.
- Exact end-to-end reachability of unmapped reviewed evidence through every parent delete.
- Stale-form preservation after background query invalidation.
- Browser refresh/resume of deferred files.
- Exhaustive schema boundary values for every laboratory measurement.

The findings above should be verified and fixed individually. The existing stock, lineage, and storage safeguards provide a strong base; the most urgent work is to make partial outcomes atomic where possible and explicit where they are unavoidable.