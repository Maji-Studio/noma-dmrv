# Supplemental independent investigation

This secondary Astra low report is evidence, not the final finding severity or proof grade. Read [the parent ledger](findings.md), which verifies, qualifies and deduplicates its claims. No new production behavior was implemented.

# Static lifecycle audit

Baseline: `ef857545b11fa298f0f08e128868ed14e37fbf5f`.

**Seven concrete defects identified.** Highest priorities: anonymous invitation access, stocked-bin reclassification, and customer-location edits bypassing certified transport-lineage protection.

No tracked files, databases, registry records, or external records were modified. No agents were spawned. No tests or live integrations were run. One pure Node simulation checked invitation-route classification.

Isometric `how_to` was unavailable. Findings concern local implementation, not current external registry guarantees.

The initial checkout matched the requested baseline. At the final status check, `tests/audit-lifecycle-probes.test.ts` appeared as untracked; this worker did not create or modify it.

## Coverage inventory

C = create; U = update; D = delete. “Traced” means static source inspection, not runtime verification. Names below are relative to `src/`.

| Route/entity | C | U | D | Trace and state exceptions |
|---|---|---|---|---|
| `/facilities` | Traced | Traced | Archive/restore only | `components/facilities` → `hooks/use-facilities.ts` → `fn/facilities.ts` → `data-access/facility-mutations.ts`, `facilities.ts` → `db/schema/facilities.ts`. Tier locking, archive cascade and restoration inspected. |
| `/reactors` | Traced | Traced | Traced | Corresponding reactor component/hook/action/data-access modules → facilities schema. Production-run dependency check on delete; active-facility check on create/move. |
| `/feedstock-types` | Traced, including import/quick-add | Traced | Hard delete, archive/restore | Corresponding modules → `db/schema/feedstock.ts`. Normal mutations require Admin; quick-add follows a different authorization path. |
| Feedstock-type production processes | New epoch traced | Prerequisites traced | N/A | Sampling panel → `use-production-processes.ts` → `fn/production-processes.ts` → `data-access/production-processes.ts`. Prerequisite editor belongs to credit-batch setup; no process delete surface. |
| `/suppliers` | Parent plus initial locations traced | Traced | Traced | Supplier modules → `db/schema/parties.ts`. Initial creation transactional. Parent deletion explicitly deletes locations before supplier. |
| `/suppliers/[supplierId]`; embedded locations | Traced | Traced | Traced | Location dialog/form → supplier hooks/actions → supplier data access. Default promotion and partial payloads inspected. |
| Supplier quick-add | Traced | N/A | N/A | Uses canonical transactional supplier-plus-location action. |
| `/customers` | Parent plus initial locations traced | Traced | Traced | Customer modules → parties schema. Initial locations are separate client-orchestrated writes. |
| `/customers/[customerId]`; embedded locations | Traced | Traced | Traced | Location dialog → customer hooks/actions/data access. Update also rebuilds derived transport legs. FK-backed deletion dependencies inspected. |
| `/storage-locations` | Traced | Traced | Hard delete, archive/restore | Storage modules → facilities schema. Stock/history deletion guards, archive lock and effective-row normalization inspected. |
| Storage-bin quick-add | Traced | N/A | N/A | Full form → quick-add adapter → `fn/quick-add.ts` → `data-access/quick-add.ts`; transactional enrichment. |
| Bin movements | Loss and stock-take actions traced | N/A | N/A | Append-only. Mounted sheet records losses; stock-take hook/action remains without a mounted component caller found. |
| `/formulations`; ingredient lines | Traced, including quick-add | Traced | Traced | Formulation modules → `db/schema/products.ts`. Parent transaction, stable ingredient IDs, duplicate materials and effective ratio-sum guard inspected. |
| Drivers | Quick-add traced | No exposed action found | No exposed action found | Driver form/dialog → quick-add hook/action/data access → parties schema. |
| Vehicles | Quick-add traced | No exposed action found | No exposed action found | Vehicle form/dialog → quick-add chain → logistics schema. Optional metadata and L/100 km conversion inspected. |
| Operators | Quick-add traced | No exposed action found | No exposed action found | Operator form/dialog → quick-add chain → parties schema. Operators are distinct from authenticated users. |
| `/energy` | N/A | N/A | N/A | Read-only rollup through production-run hooks and facility-certifier summary. No standalone energy mutation. |
| `/settings` | N/A | N/A | N/A | Redirects to Members. |
| `/settings/organization` | Invitations | Member roles | Remove member/revoke invite | Organization component/hooks/actions → Better Auth or scoped Platform Admin overrides. |
| `/settings/defaults` | Upsert | Upsert | N/A | Defaults form/hook/action → `organization-settings.ts` → settings schema. Admin gate; defaults seed future forms. |
| `/admin` | N/A | N/A | N/A | Platform-admin layout; redirects to organizations. |
| `/admin/users` | N/A | N/A | N/A | Redirects to Members; no independent user CRUD screen. |
| `/admin/organizations` | Traced | Enter organization; credential rotation | No organization-delete surface | Atomic organization/selected-owner creation; optional default seeding after commit. |
| Settings credentials | Initial save | Partial/full rotation | No exposed delete action | Organization credential components/hooks → `fn/certifier-credentials.ts` → encrypted data-access boundary. Stored-first verification inspected. |
| Facility registry destination/settings | Mapping creation | Repoint/configuration | Unlink | Local mapping locks and submission/site-registration blockers inspected. External orchestration deferred to parent. |
| Auth/invitations | Account bootstrap; session creation | Password reset/set, verification, invite acceptance | Sign-out/session removal | Auth pages/components/provider and Better Auth configuration inspected. Installed Better Auth internals were not exhaustively audited. |
| Structured telemetry | Legacy import action | Import skips duplicate timestamps | Legacy bulk delete action | Import/readings hooks/actions/data access inspected. No mounted structured-telemetry operator entry point found; bulk delete lacks a certification guard. |
| Readings-file evidence | Upload | N/A | Document delete | Mounted file workflow identified; shared document/storage lifecycle remains parent scope. |

### Other route inventory

| Routes | Classification |
|---|---|
| `/`, `/unauthorized` | Redirect/access information; entity C/U/D N/A. |
| `/dashboard` | Read-only aggregates/setup guidance; underlying create entry points use entity workflows. |
| `/traceability` | Read-only lineage visualization; C/U/D N/A. |
| `/chain-of-custody` | Legacy redirect; C/U/D N/A. |
| `/schema`, `/schema/[table]`, `/schema/links` | Public static schema catalogue/examples; no operational-row CRUD. |
| `/styleguide` | Design reference; protected by proxy; operational CRUD N/A. |
| `/login`, `/forgot-password`, `/reset-password`, `/set-password`, `/verify-email`, `/verify-email/callback` | Auth lifecycle, not domain CRUD. |
| `/accept-invitation/[id]` | Intended anonymous bearer bootstrap; blocked by proxy as described below. |
| `/auth/signout` | Auth/session lifecycle. |
| `/api/auth/[...all]` | Better Auth endpoint family. |
| `/api/storage-local/[...key]`, `/api/documents/[id]` | Shared storage/document boundaries; inventoried, not exhaustively audited here. |
| `/api/ghg-statement-reports/[reportId]` | Deliberate verifier-capability route; parent scope. |
| `/api/certification/submissions` | Parent-owned orchestration. |
| `/certification`, `/certification/removals`, removal detail/review, `/certification/ghg-statements`, `/certification/settings` | Parent-owned certification routes; local configuration mutation guards inspected here. |
| Production, feedstock intake, distribution, credit-batch and sample routes | Other assignments; inspected only where references proved findings. |

## Strongest findings

### 1. P1 — Anonymous invitees cannot reach account bootstrap

**CONFIRMED CODE DEFECT — high confidence.**

References:

- `src/lib/auth/middleware.ts:11–22, 79–90`
- `src/proxy.ts:13–22`
- `src/app/(auth)/accept-invitation/[id]/page.tsx:13–53`
- `src/lib/auth/better-auth.ts:169–172`

The landing page explicitly renders `InvitationBootstrapForm` for an invited email without an existing account. However, `/accept-invitation` is absent from `PUBLIC_ROUTES`. The proxy matches that route and redirects every anonymous visitor to login before the page executes.

**Minimal reproduction**

1. Create an invitation for an email without an account.
2. Open its accept link in a signed-out browser.
3. Observe `/login?from=/accept-invitation/...`, rather than **Create account and join**.

**Saved/external state:** Invitation remains pending. No account or membership is created by this visit. Whether email was delivered is irrelevant; copied links fail identically.

**Counterevidence:** Existing users can sign in first. The page and bootstrap action themselves validate the invitation. Neither helps a new account reach the page.

**Simulation actually performed:** Extracted the checked-in public-route array and evaluated the route matcher for an invitation URL. Result: `isPublic: false`. No HTTP/browser test ran.

**Operator action:** Existing account holders can sign in and reopen the link. A new invitee has no working self-service route until the proxy is corrected; repeatedly re-inviting does not repair this.

**Current message:** Login page says “Sign in to your account.”

**Proposed actionable message:** “Your invitation is still pending. No account has been created. Ask a Platform Admin to restore access to this invitation link, then reopen it and choose Create account and join.”

**Minimal fix:** Add the invitation prefix to the public-route allowlist; preserve the page/action bearer validation.

### 2. P1 — A stocked feedstock bin can be reassigned to another material

**CONFIRMED CODE DEFECT — high confidence.**

References:

- `src/components/storage-locations/storage-location-form.tsx:128–142, 190–205`
- `src/components/storage-locations/storage-location-list.tsx:246–255`
- `src/fn/storage-locations.ts:165–194`
- `src/data-access/storage-locations.ts:463–498, 518–566`
- `src/db/schema/facilities.ts:133–194`
- `src/data-access/production-runs/feedstock-draws.ts:131–186`
- `src/data-access/feedstock-wet-stock.ts:23–35`

The normal edit form enables the held feedstock selector. Data access checks that the replacement type exists in the organization, but does not check existing feedstock stock/history or acquire the bin-stock lock before replacing `feedstockTypeId`.

The only content-conflict probe is for product-bin formulations. The database has no equivalent feedstock-material invariant.

**Minimal reproduction**

1. Have a feedstock bin containing recorded material A.
2. Open **Edit** on `/storage-locations`.
3. Change its feedstock type to B and save.

**Saved state:** Existing A intakes remain assigned to the bin; the bin now declares B. Stock derivation still sums stock by bin. Subsequent source validation uses the bin’s new type/usage.

This does not require a race. Concurrent stock activity is an additional untested exposure because this edit does not participate in the stock-lock protocol.

**Counterevidence:** Intake creation validates against the bin’s declared type. That guard does not protect an already populated bin from later reclassification. Archive checks also do not run during editing.

**Operator action:** Stop using the affected bin. Restore its original material via `/storage-locations` → **Edit** if the erroneous change is known; investigate any records saved after reclassification.

**Current message:** “Storage bin updated.”

**Proposed rejection:** “The bin was not changed because it contains recorded stock of another feedstock type. Keep this bin’s type and create a separate storage bin for the new material.”

**Minimal fix:** Under the shared bin lock, validate identity changes against stock/history before updating. Apply the same review to bin type and facility changes.

### 3. P1 — Customer-location edits bypass the certified transport-lineage guard

**CONFIRMED CODE DEFECT — high confidence for local mutation; external consequences not tested.**

References:

- `src/components/customers/customer-location-dialog.tsx:55–83`
- `src/hooks/use-customers.ts:454–476`
- `src/fn/customers.ts:344–373`
- `src/data-access/customers.ts:614–648`
- `src/data-access/transport-legs.ts:415–510, 649–763, 809–842`
- Counterexample protection: `src/data-access/transport-legs.ts:243–263`

Customer-location update saves the location and calls `syncBiocharLegsForCustomerLocation`. That path rebuilds and upserts derived transport legs without calling `assertCanMutateCertifiedLineage`. Direct transport mutation does call that guard.

**Minimal reproduction**

1. Use a customer location for a completed delivery whose derived transport leg contributes to a locally blocking certified lineage.
2. Ensure the delivery inherits the location distance.
3. On `/customers/[customerId]`, edit the location distance from 10 to 20 km.
4. Save.

**Saved state:** The customer location and associated derived transport leg change in one transaction despite the blocking lineage. Clearing the only usable distance can instead remove the derived leg.

**Counterevidence:** Route-topology and aggregate locks serialize recalculation, but do not authorize changes to frozen source data. Submission snapshots can preserve the previously captured payload, so this finding does **not** claim that an accepted external submission is silently rewritten. The proven defect is divergence of protected local source records.

**Operator action:** Do not edit shared destination facts to correct a submitted claim. Ask the organization Admin to identify affected Removals in `/certification/removals` before applying corrections.

**Current behavior:** The location dialog closes after save; no certified-lineage blocker appears.

**Proposed rejection:** “The location was not saved because its transport data belongs to a locked Removal. Ask an organization Admin to review the affected Removal in Certification → Removals before correcting this location.”

**Minimal fix:** Discover affected products under the topology lock, enforce the existing lineage guard before the location write, then recalculate within that transaction.

### 4. P2 — Customer creation partially commits and leaves retry in create mode

**CONFIRMED CODE DEFECT — high confidence. Failure injection not executed.**

References:

- `src/components/customers/customer-list.tsx:183–199, 395–404`
- `src/components/customers/customer-form.tsx:107–134`
- `src/data-access/customers.ts:340–365, 487–555`
- `src/db/schema/parties.ts:80–87`
- `src/data-access/unique-name-guards.ts:99–110`

The client creates the customer first, then creates each initial location with a separate mutation. On any location failure, it retains the original create form without retaining a resumable customer identity.

**Minimal reproduction**

1. Create a customer with two initial locations.
2. Allow customer creation and location one to succeed.
3. Fail location two before commit.
4. Retry **Create Customer**.

**Saved state:** Customer and location one exist. Location two does not. Retry starts customer creation again and ordinarily hits the customer-name unique guard.

**Counterevidence:** The unique name index prevents a same-name duplicate customer. It does not roll back or resume the operation. Supplier creation already provides the transactional counterpart.

**Operator action:** Close the create sheet, refresh `/customers`, open the saved customer, inspect its locations and use **Add location** only for missing entries.

**Current message:** The location action error; fallback “Customer was not created. Check the form.”

**Proposed actionable message:** “Customer saved, but some locations were not saved. Open the customer in Customers, check the saved locations, and use Add location for those missing. Do not create the customer again.”

**Minimal fix:** Transactional parent-plus-initial-locations creation, or explicit partial-success state retaining the saved customer ID.

### 5. P2 — Feedstock quick-add discards the selected registry identity

**CONFIRMED CODE DEFECT — high confidence.**

References:

- `src/components/feedstock-types/feedstock-type-form.tsx:205–239`
- `src/components/forms/entity-select/feedstock-type-quick-add-dialog.tsx:35–44`
- `src/fn/quick-add.ts:110–124`
- `src/data-access/quick-add.ts:194–238`
- `src/lib/certification/feedstock-type-mapping.ts:24–49`

The embedded full form stores the selected `isometricFeedstockTypeId`. Its quick-add adapter forwards name/category/usage/description/URL but omits that ID. Data access consequently inserts `null`.

**Minimal reproduction**

1. From a feedstock-type selector in a mapped facility, choose **Add new feedstock type**.
2. Select an Isometric catalogue entry.
3. Complete category and create.
4. Inspect the saved type.

**Saved/external state:** Local type exists without its selected registry mapping. Nothing was sent to the registry. Local certification readiness subsequently reports a missing mapping.

**Counterevidence:** The normal full-page create passes the form payload. The quick-add schema also accepts the ID; neither repairs the adapter omission.

**Operator action:** An organization Admin should edit the existing type on `/feedstock-types`, select its registry entry and save. Do not create another type.

**Current behavior:** Quick-add closes and selects the created record without warning.

**Proposed message:** “Feedstock type saved without its Isometric link. Ask an organization Admin to edit this type in Feedstock types and select the registry entry. Nothing was sent to Isometric.”

**Minimal fix:** Forward the selected ID and add an adapter-level payload test.

### 6. P2 — Storage quick-add silently drops two visible fields

**CONFIRMED CODE DEFECT — high confidence.**

References:

- `src/components/storage-locations/storage-location-form.tsx:174–185, 225–234`
- `src/components/forms/entity-select/storage-location-quick-add-dialog.tsx:49–59`
- `src/schemas/quick-add.ts:103–145`
- `src/data-access/quick-add.ts:280–292`

The quick-add embeds the full form, including **Storage method** and **Description**, but neither its payload schema nor insert writes those fields.

**Minimal reproduction:** Create a bin through quick-add with both fields populated, then open it on `/storage-locations`.

**Saved state:** Bin exists; both fields are null. Refresh does not recover the entered text.

**Counterevidence:** The normal storage-bin action persists both fields. Transactional quick-add enrichment protects atomic creation, not payload completeness.

**Operator action:** Edit the saved bin on `/storage-locations` and re-enter the missing fields. Do not repeat creation.

**Current behavior:** Dialog closes successfully without a data-loss warning.

**Proposed message:** “Storage bin saved, but its storage method and description were not saved. Open the bin in Storage locations, choose Edit, and enter those details again.”

**Minimal fix:** Carry the fields through the quick-add schema and data access, or reuse the canonical create action.

### 7. P2 — Partial location updates clear omitted text fields

**CONFIRMED CODE DEFECT — high confidence; direct-action reproduction.**

References:

- `src/schemas/suppliers.ts:203–215`
- `src/fn/suppliers.ts:405–427`
- `src/data-access/suppliers.ts:639–690`
- `src/schemas/customers.ts:179–191`
- `src/fn/customers.ts:350–368`
- `src/data-access/customers.ts:597–612`

Optional fields are converted with `value || null` before data access receives them.

**Minimal reproduction**

- Supplier location with name/address/city/region: call `updateSupplierLocationFn({ locationId, isDefault: true })`.
- Customer location with city/region: call `updateCustomerLocationFn({ locationId, isDefault: true })`.

**Saved state:** Supplier name/address/city/region, or customer city/region, are cleared despite being omitted.

**Counterevidence:** The normal dialogs usually send full field sets, reducing ordinary UI exposure. Customer address already correctly preserves `undefined`; that protection was not applied consistently.

**Operator action:** Restore affected values through the supplier/customer detail location editor. Repeating the partial request will not restore them.

**Current behavior:** Successful action result, with no warning about cleared fields.

**Proposed message after correction:** “Location saved. Fields omitted from this update were kept.”

**Minimal fix:** Preserve `undefined`; normalize only explicitly supplied empty/null values.

## Existing protections and non-findings

- Organization predicates and same-org reference checks were present in the inspected mutation paths. Organization scope is the security boundary; organization-wide suppliers/customers are not a facility isolation defect.
- Facility archive/restore uses a transaction and distinguishes facility-cascade stamps from individually archived bins.
- Facility durability changes serialize against consequential submission/batch state; non-tier updates strip unchanged echoed tiers.
- Bin loss and stock-take writes share stock locks, reject archived bins, enforce lane compatibility and prevent overdraw.
- Stock-take deltas use freshly derived stock. Replaying an absolute count does not subtract the original delta again. Replaying a **loss** is different and can record another loss; lost-response retry was not executed.
- Formulation updates lock the parent and reconcile omitted ratios against current persisted ingredients. Stable ingredient IDs preserve ratio-only edits.
- Supplier-plus-initial-location and organization-plus-owner creation are atomic.
- Name/code constraints provide duplicate backstops; automatic-code retries address code collisions, not general request idempotency.
- Credential secrets are encrypted, not returned in plaintext, and partial rotation updates only supplied halves. Verification failure normally reports that keys were saved.
- Mapping repoint/unlink checks blocking submissions and registered application sites under dedicated mapping locks.
- Platform Admin membership overrides serialize last-owner checks. Ordinary Better Auth membership races remain untested.
- Feedstock-type normal CRUD is Admin-only, while quick-add allows a resolvable member context. This is a **confirmed authorization inconsistency**, but whether member quick-add is intended needs policy reconciliation before labeling it privilege escalation.
- Structured telemetry is explicitly orphaned. Its unguarded bulk-delete action deserves follow-up, but no mounted operator route or external-state reproduction was established here.
- No broad rewrite or test-removal recommendation is justified by this audit.

## Parent-run verification

### Hermetic tests inspected; not run

```bash
pnpm exec vitest run \
  tests/middleware.test.ts \
  tests/invitation-bootstrap-fn.test.ts \
  tests/invitation-bootstrap-data-access.test.ts \
  tests/certifier-credentials-fn.test.ts \
  src/schemas/quick-add.test.ts \
  src/schemas/storage-locations.test.ts \
  src/schemas/customers.test.ts \
  src/schemas/formulations.test.ts \
  src/schemas/production-process.test.ts \
  src/components/forms/entity-select/supplier-quick-add-dialog.test.tsx
```

These do not establish coverage for the newly identified quick-add omissions or customer partial-create behavior.

### Database-backed tests requiring parent-provisioned isolation

```bash
pnpm exec vitest run \
  tests/quick-add-storage-location-atomicity.test.ts \
  tests/organization-creation-transaction.test.ts \
  tests/storage-location-archive.test.ts \
  tests/formulations.test.ts \
  tests/customer-code-concurrency.test.ts \
  tests/organization-settings.test.ts \
  tests/facilities-durability-guard.test.ts
```

These tests mutate their configured database. They were read, not executed.

### Minimal additional regression source

Append to `tests/middleware.test.ts`, using its existing `getSessionMock`:

```ts
it("allows an anonymous invitee to reach bearer-token validation", async () => {
  getSessionMock.mockResolvedValueOnce(null);
  const { updateSession } = await import("@/lib/auth/middleware");

  const response = await updateSession(
    new NextRequest("http://localhost:3100/accept-invitation/invite-test"),
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
});
```

Expected to fail on this baseline. This isolates the proxy defect without accounts, email or database access.

Highest-value additional failure injections:

1. **Customer initial locations:** reject the second location mutation after parent/first location succeed; assert either full rollback or resumable existing-customer state. Retry must not call parent create again.
2. **Customer-location certification lock:** isolated DB fixture with blocking local submission lineage; change inherited distance and assert location plus transport rows remain unchanged.
3. **Bin identity:** populated A bin → B update must reject; then race identity edit against a stock write using the shared lock.
4. **Quick-add adapters:** submit the embedded forms with registry ID/storage metadata; assert the action receives every field and the persisted row retains them.
5. **Partial location actions:** omit text fields while changing `isDefault`; assert omitted fields stay absent from the data-access update payload.

## Untested limits

No browser flows, HTTP requests, database transactions, migrations, network failures, registry calls or concurrent schedules were executed. The invitation route classification was the only executed simulation.

This is a complete route/entity inventory with static mutation tracing, **not exhaustive runtime C/U/D certification**. Remaining gaps include full Better Auth plugin internals, membership races, every stale-form interleaving, document/storage recovery, supplier deletion interrupted between its two deletes, reactor relocation with existing references, credential changes during in-flight registry work, and all structured-telemetry external recovery behavior.