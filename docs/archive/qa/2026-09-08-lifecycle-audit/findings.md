# Prioritized findings and operator recovery

This ledger consolidates the three primary investigators and parent verification at staging `ef857545`. It distinguishes reproduced defects, static defects, existing product gaps, and unproven hypotheses. The operator copy below is proposed guidance, not text already shipped. Read [coverage](coverage.md) for reachability and [verification](verification.md) for reproducible commands. Source paths are relative to the repository root; independent reports provide the full layer traces.

## Priority and evidence

P1 means correct before relying on the affected workflow for routine operations. P2 means a material correctness or recovery gap needing a scoped fix. P3 means guidance or usability debt. None of these findings establishes that the preserved staging Removal is corrupt.

| ID | Priority | Finding | Strongest evidence |
|---|---|---|---|
| F01 | P1 | Stocked bin can change role/restriction, hiding or reclassifying stock | Actual PostgreSQL, two reproductions |
| F06 | P1 | Supply reduction can leave negative stock despite taking a bin lock | Actual PostgreSQL |
| F08 | P1 | Failed supplier delete can permanently remove locations | Actual PostgreSQL FK failure |
| F14a | P1 | Feedstock Type quick-add omits canonical Admin gate | Actual PostgreSQL plus action trace |
| F05 | P1 | Registry deadline ends at headers, leaving response body unbounded | Actual HTTP module with fake timers; independent corroboration |
| F02 | P2 | Partial Feedstock Type patch persists invalid category/usage | Actual PostgreSQL + schema comparison |
| F03 | P2 | Stale full forms overwrite newer saved fields | Facility PostgreSQL + feedstock mock; production runs already protect this |
| F04 | P2 | Organization switched, but preference failure reports not switched | Actual action with injected post-switch failure |
| F07 | P2 | Feedstock partial mass changes leave inconsistent dry mass; omitted distance clears | PostgreSQL mass reproduction; actual schema/transport trace |
| F09 | P2 | Held GIS file prevents Application edit from reaching save/upload | Actual guard + full static UI wiring |
| F10 | P2 | Empty values cannot clear some fields; omitted fields clear others | Actual coercion and customer-location action mocks; DAL trace |
| F11 | P2 | Customer plus locations partially saved while form stays in create mode | Actual extracted handler with failure injection |
| F12 | P2 | Lost upload acknowledgement retries with a new document identity | Static phase-by-phase trace; reconfirm rejection covered by existing test |
| F14b | P2 | Quick-add drops chosen Isometric Feedstock Type identity | Actual payload-expression simulation + persistence trace |
| F15 | P2 | Incident/measurement local datetime is interpreted in server timezone | Actual schema/conversion simulation |
| F16 | P2 | Concurrent sensor misses issue two POSTs; existing sensor ignores changed units/destination | Actual module with concurrent mocks; backend currently unmounted |
| F19 | P2 | Source mirror awaits a global-pool audit insert while holding a pool transaction | Static resource-dependency proof; independently corroborated |
| F20 | P2 | Partial Removal cleanup does not persist a deletion-only workflow state | Static orchestrator trace; deletion convergence tests pass |
| F22 | P2 | Lost telemetry submission ID leads to another POST path and false “not submitted” | Actual retry-policy simulation + orchestration trace; provider duplicate processing unproven |
| F23 | P2 | Loss retry deducts twice; no shipped bounded correction | Actual mutation mock + schema/UI trace |
| F24 | P2 | In-process measurement schema accepts negative quantities and invalid time | Actual schema simulation |
| F25 | P2 | Post-commit enrichment failure can report a known saved record as not created | Actual action/mock + real post-commit read trace |
| F26 | P2 | Run deletion with an in-process measurement fails opaquely on FK | Static FK/transaction proof; no partial loss claimed |
| F27 | P2 / known | Feedstock provenance weights original intake, not remaining attribution | Static; already recorded in open questions |
| F13 | P3 | Order customer chooser stops at first 100 | Static selector/query proof |
| F17 | P3 | Customer delete advises cancelling orders, but cancellation is unavailable | Static policy/UI proof |
| F21 | P2 / product gap | Some registry drift/absence states have no safe repair action | Static journal/action inventory; narrow supported recovery tests pass |
| F28 | P1 | Anonymous invitation bootstrap is blocked by middleware | Actual middleware with mocked signed-out session |
| F29 | P1 / static | Delivery status/date edits can invalidate existing Applications | Parent-verified guarded-field/creation-rule trace; no DB reproduction |
| F30 | P1 / static | Shared customer-location edits recalculate frozen derived transport without lineage guard | Parent-verified call chain; external payload mutation not claimed |
| F18 | Not promoted | Context-taking helpers in Server Action files | Build found none of five suspects registered; no demonstrated endpoint exposure |

## F01. Stocked storage-bin identity changes

`src/data-access/storage-locations.ts:406–576` checks references but does not join the bin stock lock or protect current lane/restriction against stock/history. The form exposes type and feedstock selection (`storage-location-form.tsx:136,194`). `storage-location-lane-summary.ts:137` chooses the displayed mass by current bin type.

**Reproduce:** fixture has 25 kg feedstock movement. `updateStorageLocation(..., {type: 'biochar_bin'})` succeeds. Both displayed lane totals become zero while the 25 kg movement remains. A separate test changes the stocked bin from forestry/pyrolysis to mineral/blend and retains all 25 kg under the new identity. This is hidden/reclassified stock, not physical deletion of mass rows.

**Expected/fix:** serialize identity changes with stock writers, re-read locked effective facts, and refuse incompatible changes while history/current stock makes them unsafe. Rename/capacity metadata need not be frozen by default. Decide whether empty historical bins may change role or should be archived and replaced.

**Current guidance:** “This bin’s setup changed while it still had stock. Check the saved bin type and Feedstock type before recording another movement. If no later activity occurred, restore the original setup in Storage bins.” Member can inspect `/storage-locations` → Edit. If activity followed the change, Admin/engineering must reconcile history; do not fabricate an adjustment. Retrying the same edit does not repair it. No registry operation is sent by this local edit.

**Proposed refusal:** “This bin still has stock in its current material lane. Its setup was not changed. Review its stock and movement history before changing Storage type.”

## F06. Supply reductions bypass final balance validation

`src/data-access/feedstocks.ts:625–668` takes locks and writes but does not assert resulting stock. **DB reproduction:** intake 100 kg, recorded loss 80 kg, available 20 kg. Update intake to wet 50/dry 45 succeeds; available becomes −30 kg.

Protect source reductions, source moves, cancellation and source deletion with a final nonnegative balance check under the existing bin locks. Related deletion variants identified by the investigator remain static, not separately reproduced. Preserve the existing withdrawal checks.

**Current guidance:** “This bin has a negative balance after an intake edit. Reopen the feedstock intake and review the original quantity and recorded withdrawals. Do not add an adjustment just to make the total positive.” Member uses `/feedstocks` → Edit → Save Changes, subject to certification locks. The edit already saved; no registry send occurred. Correct known wrong inputs, not blind retry. Escalate uncertain provenance to an Admin.

**Proposed refusal:** “Feedstock was not saved because this change would make the bin’s stock negative. Review its intake and withdrawals.” Return the bin and blocker records with this error.

## F08. Supplier deletion loses children before parent failure

`src/data-access/suppliers.ts:519–548` checks `feedstocks`, deletes `supplierLocations`, then deletes `suppliers` without a transaction. `feedstock_deliveries.supplier_id` is another restrictive FK (`src/db/schema/feedstock.ts:30`). **DB reproduction:** a supplier referenced only by a legacy delivery passes the precheck; its locations disappear; final deletion rejects and supplier remains.

Wrap all writes in one transaction, include all references and map FK refusal to blocker-aware copy. Also test failure and concurrent reference insertion after the precheck.

**Current guidance:** “Supplier deletion did not finish. The supplier still exists, but its locations may have been removed. Open the supplier in Suppliers and check its locations before trying again.” Member can use `/suppliers/[supplierId]` → Add Location to restore independently known data. No automatic undo was found; unknown original values need maintainer investigation. Do not delete historical intakes to clear this error. No registry delete occurred.

**After atomic fix:** “Supplier was not deleted because feedstock records still use it. Review the linked records or keep this supplier.”

## F14. Quick-add is a second, inconsistent Feedstock Type writer

Canonical creation requires Admin at `src/data-access/feedstock-types.ts:51`; quick-add at `src/data-access/quick-add.ts:194` checks scope only. **DB reproduction:** Member context is denied by canonical creation but successfully inserts through quick-add. The authenticated action at `src/fn/quick-add.ts:97` uses that writer, and the local build registers that action. This is an intra-organization role-policy gap, not a demonstrated cross-organization escape.

The quick-add dialog (`src/components/forms/entity-select/feedstock-type-quick-add-dialog.tsx:37`) separately omits `isometricFeedstockTypeId` from the full form callback. A chosen registry identity becomes null.

Delegate to the canonical writer and preserve the selected ID. Keep the minimal quick-add UI, not a duplicate lifecycle implementation.

**For denied Member:** “Feedstock type was not created. Ask an Organization Admin or Owner to create it in Feedstock Types.” Nothing saved or sent; repeating as Member cannot resolve it.

**For an existing dropped link:** “The feedstock type was created, but its Isometric link was not saved. An Admin or Owner can open Feedstock Types, select Edit, choose the Isometric entry, and select Update Feedstock Type.” Do not create a duplicate. This action does not create an Isometric catalogue record.

## F05. Registry response-body deadline gap

`src/lib/isometric/client.ts:196` clears the timeout and removes external cancellation before `response.text()` at 205/219. Actual-module simulation advances 60 seconds after successful headers: zero timers, signal not aborted, request still pending. Error bodies have the same gap. Streaming pings can keep the client transport alive while this inner request stalls.

Keep timeout/cancellation active through body read and clean up in a finalizer. Classify a timed-out write as possible external success, not definite failure. Test 200/4xx/5xx headers followed by body stall and external cancellation.

**Current guidance:** “Isometric’s response did not finish. The submission may have been received. Close the dialog and refresh the page before trying again.” Closing is not cancellation. Admin reopens `/certification/removals` → Review & submit, or GHG Statement → Refresh. Retry only through the reconciler for that operation, never by manually recreating remote records.

## F02/F07/F10. One consistent partial-update contract is missing

- **F02:** `updateFeedstockTypeSchema` validates category/usage only when both are supplied. Writer never validates the merged row. Partial `usage:'blend'` preserves category `forestry`; equivalent full payload is rejected. DB confirmed.
- **F07:** `updateFeedstock` writes independent wet/dry/moisture values. DB confirmed 100 wet/50% moisture/90 dry. Full UI derives dry mass, but the server partial contract does not. The update schema also materializes omitted transport distance as null, undermining the transport helper’s preserve-on-undefined branch (`transport-legs.ts:575`).
- **F10a:** `numericValue('')` becomes undefined. Order Value and Application temperature use it. Application optional enums also map empty to undefined. DAL omits those fields, so clear appears to succeed but leaves old values.
- **F10b:** `src/fn/customers.ts:353` converts omitted city/state to null even for `{locationId,isDefault:true}`. Actual action/schema mock reproduced; DAL at `customers.ts:607` applies null. Current full form supplies these fields, so do not claim every normal save clears them.

Use undefined for omission, null for explicit clearing, zero for zero. Validate the locked effective row; derive server-owned mass from its effective inputs. Test all three values at the form/action/DAL seam.

**Current guidance:** “Reopen the record and check its saved values. Other changes may have been saved. Repeating Save with this field empty will not clear it.” Member uses Orders/Application edit. Do not enter zero to mean absent. For customer location data already cleared, restore independently known city/state in `/customers/[customerId]` → location Edit. For inconsistent feedstock, review wet mass/moisture/transport together in `/feedstocks` before certification. No registry write is implied by these local saves.

**Proposed refusal for invalid effective state:** “Feedstock was not saved because its mass values disagree. Review wet mass and moisture.” Category mismatch should point to Category/Usage. Correct explicit clears should save normally, without an error.

## F03. Stale full forms overwrite newer work

Actual Facility writer reproduction: A changes country CHE→USA; B submits old CHE with a new name; B succeeds and country returns to CHE. `facility-mutations.ts:93` has no expected-version condition. Production runs already carry/check `expectedUpdatedAt`; use that pattern where consequential full forms are saved. Row locks alone cannot detect stale user intent.

**Current guidance:** “Another edit may have replaced these values. Reopen the record and compare it with the intended changes before saving again.” No generic field history/undo was found. Member can restore known correct values; uncertain mass or certification facts need Admin review.

**Proposed conflict:** “This record changed since you opened it. Your changes were not saved. Review the latest values before saving again.” Keep the unsaved draft in the UI. Do not tell the user to refresh away their only copy of work.

## F04/F25. Saved outcome is confused with follow-up failure

**F04 actual action mock:** `setActiveOrganizationAction` switches via Better Auth, then `persistLastActiveOrganization` fails (`src/fn/organizations.ts:244–249`). Result says “Organization was not switched. Try again.” Hook reloads only on success, so old UI can remain after actual server context changed. Treat preference persistence as a separate result and always refresh context once switch succeeds.

**Current guidance:** “The Organization switch may have completed. Refresh the page and check the active Organization before entering data.” Saved records were not changed by the switch. Member can refresh `/dashboard`; automatic retry is not the right response to uncertain context.

**F25:** several create/update writers commit then enrich with a separate read (feedstocks, products, credit batches, in-process measurements). The production investigator injected an in-process post-insert failure and got “not created” with one saved record. Return the durable ID and enrichment warning when commit is known. For an uncertain commit, return an operation identity that can be checked.

**Current guidance:** “The save could not be confirmed. Refresh the record list and check for the new record before creating another.” If commit is known: “The record was saved, but its details could not be loaded.” Do not use this wording for a rollback. Member can inspect the owning route; unresolved lookup failure needs engineering.

## F09. GIS Application edit cannot reach its upload step

GIS Save queues the original file as `held` (`application-evidence-panel.tsx:160`). `application-list.tsx:355` calls a guard rejecting every non-uploaded attachment; its later flush is unreachable. Actual guard reproduced. Failed-file controls show only failed attachments, not held ones.

Permit held files in this edit phase, update once, then flush against the known Application ID. Preserve failed/in-flight behavior. Test through the rendered edit flow before shipping.

**Current guidance:** “Application changes have not been saved. The selected boundary file has not been uploaded. Repeating Save will not resolve this problem. Cancel this edit to keep the saved Application unchanged.” Member can cancel or remove the new boundary; there is no working Retry boundary button. Engineering fix required. Neither local update nor remote upload was reached.

## F11. Compound customer creation partially commits

`customer-list.tsx:183` creates parent, then locations sequentially. Second-location failure leaves parent/first location saved and form still in create mode. Actual handler mock reproduced. Supplier compound creation is already transactional; reuse that pattern.

**Current guidance:** “Customer was created, but not all locations were saved. Open the customer in Customers and check its locations. Use Add Location for any missing locations.” Member uses `/customers/[customerId]`. Do not repeat Create Customer or rename to evade a duplicate warning. No registry write occurred.

## F12. Upload retry loses its durable attempt identity

Presign allocates a new pending document, PUT stores bytes, confirm marks uploaded. If confirm succeeds but its response is lost, client retains no actionable document ID and marks failure; retry allocates another document. `confirmUpload` rejects an already-uploaded row (`src/fn/documents.ts:199`), so reconfirm cannot currently settle this uncertainty.

Retain document ID immediately after allocation, reconcile its state before creating another, and make confirm idempotent after authorization/object checks. Test response loss after each phase. Direct-file and parent-delete review guards must remain.

**Current guidance:** “Upload confirmation was not received. The file may already be saved. Reopen this record and check its documents before using Retry uploads.” Member can inspect/open documents, then delete a confirmed unprotected duplicate with Delete [filename]. Protected certification evidence needs Admin review; no duplicate-source merge exists. This does not mean the parent entity failed to save.

## F15/F24/F26. In-process child lifecycle needs explicit contracts

**F15:** sample/incident forms send offset-free datetime-local; actions use `new Date(string)`. Zurich 14:00 becomes 14:00Z on UTC server rather than 12:00Z. Actual conversion simulation, not a browser replay. Use the established facility-timezone contract; test DST/no-op edits.

**Current guidance:** “The saved time may be incorrect. Preserve the original time in Notes and ask an Organization Admin to review it before editing the time again.” Member inspects `/production-runs` → Edit → incident/in-process measurement. Repeating edits may shift it again.

**F24:** actual schema accepts negative weight/volume and `timestamp:'not-a-date'`. Enforce nonnegative physical quantities and valid time before persistence. Temperature may legitimately be negative. Proposed field copy: “Enter a weight of 0 or greater.” / “Enter a valid measurement time.” Validation rejection must save nothing.

**F26:** run delete does not preflight/delete `productionSamples`, whose run/org FK is restrictive. Expected FK rollback protects previous child deletes, but operator gets generic failure. Choose explicit blocking or clearly disclosed atomic child retirement. Current guidance: “Production run was not deleted because it has in-process measurements. Open Edit and review those measurements before deleting the run.” Do not suggest deleting meaningful evidence simply to clear a blocker.

## F16/F22. Telemetry must remain unexposed until recovery is complete

Actual sensor module mock proves two concurrent misses can send two POSTs and persist the later ID; existing local sensor ignores changed units/facility (`certifier-sensors.ts:74,106,131`). This proves duplicate attempts, not current provider acceptance of duplicates. Serialize at sensor identity, validate destination/property/units and refuse ambiguous reference matches.

Telemetry POST succeeds before its ID is journaled (`submit-telemetry.ts:458`). Lost response/journal failure can enter re-PUT/new-version and another POST. The exact claim-policy module was simulated. Public OpenAPI does not establish replay guarantees. Record unknown outcome before POST and reconcile before restart.

**Current guidance:** “Telemetry submission could not be confirmed. Isometric may already be processing the file. Do not submit again until an Admin has checked the registry outcome.” Sensor mismatch: “Sensor records may already exist in Isometric. Ask an Admin to review the mapping before retrying.” There is no mounted telemetry/Sensors recovery screen. Engineering/registry review is required; do not invent a Settings button.

## F19. Source audit insert waits for its own held pool connection

Source mirror holds `db.transaction` (`sources.ts:402`) and awaits `appendSyncEventBestEffort` before release (`:563`). That helper uses global `db.insert` (`certifier-sync-events.ts:27`). Default pool size is one (`db/index.ts:15`). With one slot, the audit insert waits for acquisition timeout, then is swallowed; with saturated larger pools, the pattern also adds contention. Static dependency proof, not a measured staging incident.

Write via the active transaction if atomic audit semantics fit, or record after transaction release. Do not increase pool size as the only fix. Test with one slot and forced audit failure.

No routine operator action can fix pool contention. Accurate copy only if an audit failure is detected: “The Source was copied, but its activity record could not be saved. Refresh the Removal before retrying.” Do not recopy a confirmed Source. Engineering reviews the persisted mapping and logs.

## F20/F21. Recovery needs durable state and a real resolver

Removal deletion already removes remote parents first, checks shared ownership and tolerates confirmed absence. Existing tests pass. If a GHG Entry deletes and a later child delete fails, the claim is released back to prior state, while normal submission can still reuse its old external ID (`delete-removal.ts:117–143,218`; `submit-removal.ts:914`). Immediate copy says retry deletion, but refresh does not retain a deletion-only state.

**Current recovery:** “Removal deletion is incomplete. Some registry records were deleted, and the local Removal is still saved. Use Delete Removal again to finish cleanup.” `/certification/removals` → Removal detail → Delete Removal. Do not choose Review & submit while cleanup is incomplete. Existing policy permits authorized organization members to delete eligible never-finalized Removals; finalized history blocks this route.

Persist cleanup-started/step outcomes and gate ordinary submission until convergence. Retry cleanup with the same ownership/intent, not a fresh generic submission.

Storage Location confirmed absence can recover safely through Check again or Removal submission when facts match. However, an old Biochar Application referencing the replaced site becomes `review_required`; missing/drifted existing claims have no general safe recreate/adopt action. A stale-lock script does not repair those claims.

**Current guidance:** “The Storage Location was recovered. This Biochar Application still refers to the previous registry site, so the Removal could not finish. Ask support to review the saved claim and registry records before retrying.” Support means an application maintainer coordinated with the registry; no in-app support case/action or completed repair tool was found. Eligible never-finalized Delete Removal is a destructive cleanup alternative, not an amendment workflow.

Use reason-specific site copy. Confirmed absence: “The saved Storage Location no longer exists in Isometric. The Application is still saved. Use Check again to retry the registry check.” A 403/5xx must say “could not be checked,” not “deleted.” True coordinate drift must not silently overwrite remote facts.

## F23/F27. Append-only accounting requires safe corrections

Repeated loss writes have no operation identity. Investigator mock saved two deductions for one retried 10 kg loss. Current UI offers Record loss; the retained stock-take backend rejects increases and no bounded reversal is mounted.

**Current guidance:** “The loss may already be recorded. Check this bin’s movement history before selecting Record loss again.” For a confirmed duplicate: “This loss was recorded twice. Do not record another loss. Ask an application maintainer to review the movements. This screen has no correction action.” Member inspects `/storage-locations`; engineering owns recovery. Add idempotent loss commands and constrained reversal of a named movement, without permitting invented stock.

F27 is already documented: original-intake proportional weights can attribute 150 kg to an intake of 100 kg after a later intake joins the bin (`feedstock-wet-stock.ts:91`). Bin-level balance can remain valid while provenance is not. Choose and implement a conservative remaining-attribution/commingling policy separately. Current guidance: “This run’s feedstock attribution needs review. Ask an Organization Admin to review its intake and withdrawal records before certification.” Resaving is not a repair.

## F13/F17. Small operator dead ends

Order form queries one customer page of 100 (`order-form.tsx:141–155`). A customer outside it cannot be selected. Use the existing searchable/paginated entity selector. Current guidance: “This customer is outside the loaded list. The Order has not been created. Ask the application maintainer to restore access to the full customer list.” Do not create a duplicate customer.

Customer deletion says cancel orders, while order fulfillment is derived and no cancellation exists. Replace with: “Customer was not deleted because orders still use it. Open Orders and review them. Reassign them where appropriate, or keep this customer.” Member uses `/orders` edit, subject to downstream locks. Do not erase operational history to remove a customer.

## F18. Important negative result from build verification

The registry investigator flagged context-taking exports in file-level `use server` modules. Parent production build completed; its 194-action manifest registers none of `mirrorDocumentToSourceForUser`, `mirrorCandidateSourcesForSubmission`, `submitTelemetry`, `issueVerifierReportUrl`, or `assertGhgStatementReportFresh`. No registered context-first export was found by the targeted scan. See [manifest evidence](action-manifest-check.json).

Therefore **do not present this as a demonstrated public endpoint or cross-org vulnerability at this baseline**. Internal helpers still trust their context and are risky to expose through a future client import. Move cores out of action modules when touching them and add a build-manifest guard. Actual deployed manifest and authenticated HTTP exploitation were not tested.

## Additional candidates, not promoted

The supplementary and primary reviewers identified these for explicit future fixtures: upload insertion after parent retirement’s final scan; unmapped reviewed documents missing a parent-retirement check; archived parent create/edit races; Sample facility visibility after batch deletion; lab-document cache invalidation; omitted storage-method fields in quick-add; first-default-location concurrency; account/credential rotation during an in-flight registry operation. They have not all survived parent reachability/contract verification and must not be blanket implemented.


## F28. New invitees cannot reach account bootstrap

The page `src/app/(auth)/accept-invitation/[id]/page.tsx` deliberately offers anonymous account bootstrap for a new invited user. The middleware public-route list omits `/accept-invitation` (`src/lib/auth/middleware.ts:11`). Actual middleware simulation with a signed-out session returns 307 to login before the page runs. An existing user can sign in; a new user has no account to use. This is a blocked onboarding flow, not an authentication bypass.

Admit the invitation landing route while preserving its token validation, account-exists branch, rate limit, expiry and email ownership checks. Add a proxy+page integration test for new/existing/expired/wrong-user cases.

**Current guidance:** “This invitation cannot open account setup. Ask the Organization Admin to have the application maintainer restore invitation access. You do not need another invitation while this one remains valid.” No account was created by the blocked request. Retrying login without an account will not resolve it. Admin inspects Members/invitations at `/settings/organization`; there is no working self-service repair button for this admission bug.

## F29. Delivery status/date edits can invalidate existing Applications

Parent verified `src/data-access/deliveries.ts:751–825`: existing Application guard runs only when order, effective product or wet mass changes. Status/date are still spread into the update. Application creation requires a delivered delivery and an Application date not before delivery (`applications.ts:191–235`). Before certification freeze, changing only delivered→upcoming or advancing delivery date can violate those existing Application invariants. Current form exposes status/date. Static confirmed control-flow gap; no database fixture was run for this case, and no claim is made that all later duplicate deliveries would pass separate allocation checks.

Check dependent Applications whenever effective status/date changes, under the existing delivery lock. Keep delivered state and delivery date no later than the earliest Application, or require an explicit coordinated correction.

**Current guidance:** “The Delivery changed while Applications still reference it. Restore its actual delivered status and date, then check Applications and stock.” Member uses `/deliveries` → Edit → Update Delivery. Local update has saved; no registry send occurred. Do not repeat the invalid edit.

**Proposed refusal:** “Delivery was not saved. Applications already reference it. Keep it Delivered and use a delivery date on or before the earliest Application.” Test status-only/date-only edits, equal-date boundary, and certified refusal.

## F30. Shared customer-location edits bypass derived-transport freeze

Parent verified `updateCustomerLocation` → `syncBiocharLegsForCustomerLocation` → `syncBiocharProductTransportLegs` → `replaceDerivedTransportLeg`. The location write and recalculation are transactional and topology-locked, but none of this chain calls `assertCanMutateCertifiedLineage`; direct transport mutations do (`transport-legs.ts:251,303,344`). An inherited location distance can therefore rewrite/delete a derived local transport leg even when direct editing is blocked. This is a static verified enforcement inconsistency, not an executed DB/certification case or a claim that immutable submitted external payloads change.

Before changing location facts that affect derived legs, discover affected products under topology lock and apply the existing certification lineage guard, then recalculate in the same transaction. An alternative versioned location policy needs an explicit product decision.

**Current guidance:** “Do not change a shared destination to correct a submitted claim. Ask an Organization Admin to review the affected Removals before changing its transport data.” Admin inspects `/certification/removals`; Member can inspect `/customers/[customerId]`. No generic unlock/amendment action exists.

**Proposed refusal:** “The location was not saved because its transport data belongs to a locked Removal. Ask an Organization Admin to review the linked Removal.” Test inherited versus overridden distance, null removal, shared products and a real blocking submission before shipping.
