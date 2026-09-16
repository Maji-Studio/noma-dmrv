# Independent production investigation

Consult [the parent audit](README.md) for verified rankings and later database simulations. This report records an Astra low read-only CLI run.

# Production and inventory lifecycle audit

**Baseline:** `ef857545b11fa298f0f08e128868ed14e37fbf5f`  
**Audit date:** 2026-09-08  
**Scope:** feedstock types and deliveries, production runs and children, inventory movements, formulations, biochar products, energy, credit batches, membership, allocations, and certification locking at these seams.

The strongest confirmed gaps are inconsistent authorization in feedstock-type quick-add, stock-reducing writes without balance validation, loss retries that duplicate inventory deductions, and inconsistent update contracts. Production-run mutations have substantially stronger concurrency protection than several adjacent entities.

## Method and evidence limits

I read the repository guidance, `CONTEXT.md`, the handoff, and the relevant forms, database, schema-overview, testing, architecture, code-style, UX-writing, and certification documentation.

I made no repository edits, commits, database calls, registry calls, or communications to other investigators. I did not access the original checkout or spawn agents.

Evidence labels:

- **Static:** traced implementation and schema.
- **Executed mock:** executed the repository’s transpiled TypeScript with explicitly mocked dependencies.
- **Executed pure:** executed actual schemas, pure functions, or an extracted source expression.
- **Untested:** requires browser, PostgreSQL, or registry verification.

The in-memory harnesses used `pnpm exec node`, TypeScript’s `transpileModule`, explicit import allowlists, and synthetic records. They did not load the application DB module, test environment, storage provider, or registry client. An initial here-document command failed before execution because the read-only sandbox prevented its temporary file; subsequent harnesses used `node -e`.

**No Vitest or PostgreSQL integration suite was run.** Repository test configuration loads `.env.test`, and relevant integration suites import the real database. Their existence is recorded below, not represented as passing verification.

The final status check showed an untracked `docs/archive/qa/2026-09-08-lifecycle-audit/` directory. This auditor did not create, inspect, or modify it.

Registry HTTP orchestration and external protocol verification remain with the registry investigator. Certification statements below describe the local implementation, not independently verified Isometric requirements.

## Route, operation, and state coverage

Paths below are repository-relative. `C/U/D` means create/update/delete.

| Route or surface | Entity and operations | States and constraints inspected | UI → hook → action → data access → schema evidence |
|---|---|---|---|
| `/feedstock-types` | Feedstock type C/U/D, archive/unarchive, catalogue import | Pyrolysis/blend; active/archived; linked/unlinked; referenced/unreferenced; Admin gate | `components/feedstock-types/feedstock-type-list.tsx:206`; `hooks/use-feedstock-types.ts`; `fn/feedstock-types.ts:38`; `data-access/feedstock-types.ts:45`; `schemas/feedstock-types.ts:97`; `db/schema/feedstock.ts:74` |
| Feedstock-type EntitySelect quick-add | C | Usage constrained by parent; selected Isometric identity; duplicate name; Member versus Admin | `components/forms/entity-select/feedstock-type-quick-add-dialog.tsx:37` → `hooks/use-quick-add-submit.ts:33` → `fn/quick-add.ts:97` → `data-access/quick-add.ts:194` → `schemas/quick-add.ts:82` |
| `/feedstocks` | Unified delivery and per-bin feedstock C/U/D | `missing_data`/`complete`; one/multiple allocations; consumed stock; certification lock; stale save | `components/feedstocks/feedstock-list.tsx:290,321,361` → `hooks/use-feedstocks.ts:108` → `fn/feedstocks.ts:143,190,236` → `data-access/feedstocks.ts:426,552,677` → `schemas/feedstocks.ts`; `db/schema/feedstock.ts:112` |
| No separate mounted feedstock-delivery CRUD found | Legacy `feedstock_deliveries` | Retained table and dependency references | `db/schema/feedstock.ts:16`; `data-access/feedstock-types.ts:146`. Current operator delivery workflow is the unified `/feedstocks` flow |
| `/production-runs` | Run C/U/D | Draft, running, complete, failed, cancelled; timing; overlap; stock; membership; certification freeze; stale save | `components/production-runs/production-run-list.tsx:292,317,349` → `hooks/use-production-runs.ts` → `fn/production-runs.ts` → `data-access/production-runs/mutations.ts` → `schemas/production-runs.ts`; `db/schema/production.ts:28` |
| `/production-runs/[productionRunId]` | Legacy detail URL | Redirect, not a separate editor | `app/(app)/production-runs/[productionRunId]/page.tsx:27` |
| Production-run edit sheet | In-process measurement C/U/D | Optional measurements; time conversion; null clearing; missing parent; parent deletion | `components/production-runs/production-run-list.tsx:740`; `production-sample-table.tsx:128` → `hooks/use-production-samples.ts:61` → `fn/production-samples.ts:71,128,177` → `data-access/production-samples.ts:109,162,197` → `schemas/production-samples.ts:13`; `db/schema/production.ts:420` |
| Production-run edit sheet | Incident C/U/D | Severity; corrective actions; optional references; time conversion; parent deletion | `components/production-runs/production-run-list.tsx:741`; `production-incident-table.tsx:76` → `hooks/use-production-incidents.ts:42,70,98` → `fn/production-incidents.ts` → `data-access/production-incidents.ts:86,132,184` → `schemas/production-incidents.ts`; `db/schema/production.ts:319` |
| Production-run readings-file surface | Upload/open/delete document | Deferred creation; pending/failed/uploaded; CSV filename/MIME; retry; read-only mode | `components/production-runs/production-readings-documents.tsx:60` → document/upload hooks → document actions/data access; saved readiness predicate at `data-access/production-runs/readings-evidence.ts:27` |
| No mounted structured-import entry point | Telemetry import, read, delete-all | Run window; duplicate timestamp; import outcome metadata; concurrent delete/import | `fn/production-run-reading-imports.ts:35` → `data-access/production-run-reading-imports.ts:24,93,160`; `fn/production-run-readings.ts:63` → `data-access/production-run-readings.ts:99`; `db/schema/production.ts:152` |
| Feedstock-type sampling panel | Start process; record prerequisites | Admin; current process; sample count; prerequisites; repeated start; missing process | `components/feedstock-types/feedstock-type-sampling.tsx:38`; `components/credit-batches/method-b-prerequisites-setup.tsx` → `hooks/use-production-processes.ts:39,51` → `fn/production-processes.ts:32,44` → `data-access/production-processes.ts:57,86,110` → `schemas/production-process.ts`; `db/schema/production-processes.ts:22` |
| Storage-bin reconciliation sheet | Record loss; movement history | Append-only; overdraw; duplicate retry; correction; missing/archived bin | `components/storage-locations/bin-reconcile-sheet.tsx:134` → `hooks/use-bin-movements.ts:99` → `fn/bin-movements.ts:124` → `data-access/bin-movements.ts:169` → `schemas/bin-movements.ts`; `db/schema/bin-movements.ts:18` |
| Unmounted stock-take API | Record count adjustment | Locked current balance; no upward adjustment; feedstock moisture metadata | `hooks/use-bin-movements.ts:82` → `fn/bin-movements.ts:81` → `data-access/bin-movements.ts:207`. Current sheet mounts only `LossForm`, at `bin-reconcile-sheet.tsx:249` |
| `/formulations`, formulation quick-add | Formulation C/U/D and ingredient reconciliation | Partial ratios; total ≤100%; blend usage; stable line IDs; referenced deletion | `components/formulations/formulation-list.tsx:172,183,200` → `hooks/use-formulations.ts:90,130,257` → `fn/formulations.ts:114,168,213` → `data-access/formulations.ts:228,293,495` → `schemas/formulations.ts`; `db/schema/products.ts:26,53` |
| `/biochar-products` | Product C/U/D | Draft/testing/ready/sold; source allocation fixed; wet/dry conservation; water clearing; order/delivery dependencies | `components/biochar-products/biochar-product-list.tsx:369,380,402` → `hooks/use-biochar-products.ts:96,134,260` → `fn/biochar-products.ts:121,181,230` → `data-access/biochar-product-create.ts:61`, `biochar-products.ts:548,921` → `schemas/biochar-products.ts`; `db/schema/products.ts:91` |
| Product creation | Source-lot allocation | Remaining wet/dry capacity; documented loss; exact gram distribution; missing dry basis | `data-access/biochar-product-create.ts:200` → `biochar-product-source-allocations.ts:208,412,628`; `db/schema/products.ts:173` |
| `/energy` | Read-only aggregation | Null measurements; cancelled/archived exclusion; cached-data error state | `components/energy/energy-summary.tsx:44` → `hooks/use-production-runs.ts:177` → `fn/production-runs.ts` → `data-access/production-runs/queries.ts:578`. Writes occur through run CRUD |
| `/credit-batches` | Batch C/U/D | Sampled/unsampled; cohort window/type; auto-membership; assigned/unassigned slices; submission freeze; stale save | `components/credit-batches/credit-batch-list.tsx:263,286,316` → `hooks/use-credit-batches.ts:157,176,201` → `fn/credit-batches.ts:156,189,239` → `data-access/credit-batches.ts:366,535,818` → `schemas/credit-batches.ts:63,186`; `db/schema/credits.ts:31` |
| `/credit-batches/[id]` | Legacy detail URL | Org-scoped lookup, not-found, redirect | `app/(app)/credit-batches/[id]/page.tsx:28,47` |
| Batch membership, slices, sample links | Derived create/update/delete | One batch per run; cohort lock; assigned slices preserved; legacy sample relinking; direct batch samples retained | `data-access/credit-batch-membership.ts:53,189,240,564`; `credit-batch-application-slices.ts:315`; `credit-batches.ts:771,835`; `credit-batch-delete-slices.ts:8`; `db/schema/credits.ts:207,257` |
| Production-emissions claim seam | Reserve/reuse/transfer reservation | Same-attempt retry; active reservation; possible external mutation; missing batch | `data-access/production-claim-reservations.ts:39,64`; registry execution remains outside this report |

## Confirmed defects, ranked

### F1. P1: Stock-reducing feedstock edits can commit a negative bin balance

**Evidence:** executed mock plus static proof.

`updateFeedstock` locks the row, checks certification, and locks affected bins, but does not validate the resulting stock:

- Feedstock update at `src/data-access/feedstocks.ts:625`.
- Write at `src/data-access/feedstocks.ts:649`.
- Stock is intake minus run/ingredient consumption plus movement deltas: `src/data-access/lane-stock-derivation.ts`.
- Withdrawal protection exists separately at `src/data-access/feedstock-wet-stock.ts:40`.

**Reproduction**

1. Record 100 kg wet feedstock at 20% moisture in a bin.
2. Record an uncancelled run consuming 80 kg from that bin.
3. Before certification locking, edit the intake to 50 kg wet and 40 kg dry.
4. Select **Save Changes** on `/feedstocks`.

**Observed:** the actual update function, under mocked persistence, saved 50 kg. The modeled balance became **−30 kg**. Its trace was certification guard → bin lock → update → transport sync. No balance guard ran.

**Expected:** reject the reduction atomically, retaining the previous intake.

**Related static cases:** feedstock deletion checks run provenance, but not ingredient consumption or recorded losses (`feedstocks.ts:721`). A blend intake used only through product composition can therefore lose its supply row without that usage check catching it. Production-run and product deletion also remove supply without a final bin-balance assertion; recorded bin losses can leave a negative residual even when ordinary product/order dependencies are absent.

These deletion variants were not executed against PostgreSQL.

**Operator copy after adding the guard**

> Feedstock {code} was not saved because the change would make this bin’s stock negative. Review the recorded intake and withdrawals before saving again.

- **Certainty:** rejected transaction saves nothing; no registry send.
- **Retry:** safe only after correcting inputs or conflicting records.
- **Resolver:** Member can correct ordinary operational records; Admin must review certification-related blockers.
- **Route/action:** `/feedstocks` → **Edit** → **Save Changes**. Do not advise a fabricated stock increase.

**Tests:** reduction below run consumption; reduction below ingredient consumption; moving supply between bins; deletion after a loss; exact-zero boundary; concurrent reduction versus withdrawal. Assert all related writes roll back.

---

### F2. P1: Feedstock-type quick-add bypasses the canonical Admin requirement

**Evidence:** static proof and executed mock.

Canonical creation calls `requireOrgRole(ctx, "admin")` at `src/data-access/feedstock-types.ts:51`. Quick-add creation calls only `requireOrgScope` at `src/data-access/quick-add.ts:198`. Its action uses `withAction`, which obtains an org context but does not impose an Admin role.

**Reproduction**

Call `src/fn/quick-add.ts:createFeedstockTypeFn` as an authenticated Member using a valid new name, category, and usage. Compare with the canonical feedstock-type action.

**Observed:** the actual quick-add data-access function reached insertion with a synthetic Member context. The mock did not exercise authentication itself; the missing role guard is statically visible.

**Expected:** both entry points enforce the same role policy in data access.

**Operator copy after fixing**

> Feedstock type was not created. An Organization Admin or Owner must create it in Feedstock Types.

- **Certainty:** rejection occurs before insertion; nothing sent to the registry.
- **Retry:** repeating as Member cannot resolve it.
- **Resolver:** Admin or Owner.
- **Route/action:** `/feedstock-types` → create form. No special permission-request button was found.

**Tests:** invoke both actions with Member/Admin contexts; assert Member denial happens before code generation/insertion where practical. Quick-add should delegate to the canonical writer.

---

### F3. P2: Quick-add silently drops the selected Isometric feedstock identity

**Evidence:** executed actual mapping expression and static persistence trace.

The full form records the selection at `src/components/feedstock-types/feedstock-type-form.tsx:215`. Quick-add forwards name, category, usage, description, and URL, but omits `isometricFeedstockTypeId`:

Quick-add payload at `src/components/forms/entity-select/feedstock-type-quick-add-dialog.tsx:37`.

The quick-add writer stores the absent value as null at `src/data-access/quick-add.ts:229`.

**Reproduction**

1. Open feedstock-type quick-add from a production/feedstock selector.
2. Select a catalogue entry in the Isometric section.
3. Finish its category and select **Create feedstock type**.
4. Inspect its Registry field on `/feedstock-types`.

**Observed:** the executed source mapping omitted a supplied synthetic Isometric ID. The persistence path consequently writes null.

**Expected:** preserve the selected identity.

**Operator copy for a detected existing record**

> Feedstock type {code} was created, but its Isometric link was not saved. An Admin or Owner can open Feedstock Types, select Edit, choose the Isometric entry, and select Update Feedstock Type.

- **Certainty:** local creation succeeded; this action does not create a remote catalogue entry.
- **Retry:** do not create another type with the same name.
- **Resolver:** Admin or Owner.
- **Tests:** exercise the real quick-add callback with a selected ID; assert both canonical and quick-add persistence retain it.

---

### F4. P2: Feedstock partial updates violate omission and derived-mass semantics

**Evidence:** executed actual schema and data-access function.

Two independent failures exist.

**A. Moisture-only updates retain stale dry mass**

`updateFeedstockSchema` independently accepts wet mass, moisture, and dry mass. Data access spreads them directly into `.set()` without recomputing dry mass.

Reproduction:

```ts
updateFeedstockFn({
  feedstockId,
  moistureContentPercent: 50,
});
```

Starting from wet 100 kg, moisture 20%, dry 80 kg:

- **Observed:** wet 100, moisture 50%, dry **80**.
- **Expected:** dry **50**, derived from the locked effective wet/moisture pair.

The full UI currently derives dry mass at `feedstock-list.tsx:340`; the server contract remains independently callable and unsafe for partial clients.

**B. Omitted transport distance becomes an explicit clear**

Executing the actual schema on the same payload produced:

```ts
{
  feedstockId,
  transportDistanceKm: null,
  moistureContentPercent: 50
}
```

`resolveDistanceSource` maps null distance to null provenance. `syncFeedstockTransportLeg` preserves the existing distance only when the override is **undefined**, at `transport-legs.ts:575`. An unrelated partial update can therefore replace a saved trip override with the supplier/location default, or lose the derived leg when no usable default exists.

**Expected:** omitted means unchanged; explicit null means clear.

**Operator copy after transactional validation**

> Feedstock {code} was not saved because its mass values disagree. Review wet mass and moisture, then select Save Changes.

For a previously affected transport record:

> Reopen feedstock {code} and check its transport distance and Distance source before using it for certification.

- **Certainty:** historical impact requires inspecting the saved record; no registry send is implied.
- **Retry:** safe after reviewing current saved values; blind partial retries repeat the defect.
- **Resolver:** Member for ordinary edits.
- **Route:** `/feedstocks` → **Edit** → **Save Changes**.
- **Tests:** notes-only and moisture-only updates retain omitted transport values; explicit null clears; derived mass uses locked current values under concurrent partial updates.

---

### F5. P2: Stale forms silently overwrite newer values outside production runs

**Evidence:** executed feedstock mutation sequence; static comparison across schemas and writers.

Production runs carry `expectedUpdatedAt` from the form and compare it under row lock:

- `production-run-form.tsx:340`
- `fn/production-runs.ts:284`
- `data-access/production-runs/mutations.ts:591`

Feedstocks, formulations, products, credit batches, incidents, and in-process measurements lack an equivalent client-version predicate.

**Reproduction**

1. Open the same feedstock in two sessions.
2. Session A changes Notes and saves.
3. Session B changes another field and submits its full, older form.

**Observed:** the actual feedstock writer accepted both sequential writes and restored the stale Notes value. Database serialization does not prevent this.

Equivalent full-form submission paths include:

- Product: `biochar-product-list.tsx:389`.
- Credit batch: `credit-batch-list.tsx:292`.
- Formulation: `formulation-list.tsx:183`.
- In-process measurement: `production-sample-table.tsx:136`.

**Expected:** conflict, or an explicitly designed field-merge contract.

**Operator copy after adding conflict detection**

> This feedstock changed since you opened it. Your changes were not saved. Copy any notes you need, refresh the page, and reopen Edit before saving again.

- **Certainty:** conflict rejection saves nothing.
- **Retry:** refresh and review first; do not silently resubmit the stale payload.
- **Resolver:** Member.
- **Tests:** two editors with different and overlapping field changes; delete versus stale save; same-version duplicate submission; conflict preserves form input.

Do not replace stock locks with optimistic concurrency. Both protect different invariants.

---

### F6. P2: Incident and in-process measurement timestamps depend on the server timezone

**Evidence:** executed pure schema/time conversion plus complete UI/action trace.

Both forms generate browser-local `datetime-local` strings:

- `production-sample-form.tsx:59`
- `production-incident-form.tsx:61`

The server constructs dates from those strings:

- `fn/production-samples.ts:89,140`
- `fn/production-incidents.ts:65,108`

The incident schema intentionally leaves `YYYY-MM-DDTHH:mm` as a string.

**Reproduction**

Use a Zurich browser and UTC server. Enter `2026-09-08T14:00`.

**Executed result**

| Value | Instant |
|---|---|
| Intended Zurich time | `2026-09-08T12:00:00.000Z` |
| Sample server conversion | `2026-09-08T14:00:00.000Z` |
| Incident server conversion | `2026-09-08T14:00:00.000Z` |

A no-op edit can shift the timestamp again when the browser reformats the saved instant.

**Expected:** one explicit timezone contract, preferably the facility-timezone approach already implemented for production runs.

**Operator copy for affected records**

> The saved time for this incident may be incorrect. Preserve the original time in Notes and ask an Organization Admin to review it before editing the time again.

- **Certainty:** the record can be saved with the wrong instant; these child records are internal operational records.
- **Retry:** repeated time edits are not a reliable workaround while conversion remains broken.
- **Resolver:** Admin coordinates correction after the conversion fix.
- **Route/action:** `/production-runs` → run **Edit** → incident or in-process measurement **Edit** → **Save Changes**.
- **Tests:** browser/server/facility timezone combinations; no-op edit; DST gap and fold; date rollover.

---

### F7. P2: Loss retries duplicate deductions, with no shipped correction path

**Evidence:** executed actual mutation functions with mocked persistence.

`createBinMovement` creates a new row for every valid loss request. There is no operation key or replay detection. The current reconciliation sheet exposes only **Record loss**, not stock-take controls.

- `data-access/bin-movements.ts:169`
- `components/storage-locations/bin-reconcile-sheet.tsx:140,249`
- `db/schema/bin-movements.ts:18`

**Reproduction**

1. Begin with 100 kg.
2. Record a 10 kg loss.
3. Lose the response, or submit the same operation again.
4. Attempt to correct the duplicate.

**Executed result:** two rows, balance **80 kg**.

The retained stock-take API rejects a correction to 90 kg:

> Counted stock cannot exceed the current derived stock. Stock-takes can only confirm or reduce inventory.

That check is at `bin-movements.ts:253`. Generic creation rejects non-loss movements at line 176. There is no update/delete operation.

**Expected:** replay the same loss once, and provide a bounded reversal of an identified erroneous movement. This does not require allowing arbitrary positive inventory.

**Operator copy for an ambiguous response**

> The loss may already be recorded. Check this bin’s movement history before selecting Record loss again.

For a confirmed duplicate:

> This loss was recorded twice. Do not record another loss. Ask a platform operator to review the two movements. There is no correction action in this screen.

- **Certainty:** distinguish unknown response from two confirmed saved movements.
- **Retry:** unsafe until history is checked.
- **Resolver:** platform engineering/operator review; no shipped repair capability was found.
- **Route/action:** `/storage-locations` → affected bin → reconciliation/history surface; actual submit button **Record loss**.
- **Tests:** same operation key submitted twice; lost response; concurrent distinct losses; reversal constrained to the original amount and org/bin; reversal cannot invent provenance.

This is a recovery gap in the append-only design, not a recommendation to make the ledger editable.

---

### F8. P2: Post-commit read failures are reported as “not created” or “not saved”

**Evidence:** static transaction boundaries and executed action failure injection.

Several writers perform a durable mutation and then fetch the enriched result:

- In-process measurement insert → `getProductionSampleById`: `production-samples.ts:132,152`.
- Incident insert → read: `production-incidents.ts:113,129`.
- Feedstock transaction → read: `feedstocks.ts:464,535`.
- Run mutation → read: `production-runs/mutations.ts:843`.
- Credit-batch creation → accounting load: `credit-batches.ts:498`.
- Credit-batch update → read: `credit-batches.ts:805`.

The production-sample action catches a post-insert error and answers:

> In-process measurement was not created. Check the form.

**Executed injection:** the mock incremented a saved-record counter, then threw a post-insert read failure. The actual action returned `success: false` with that message while the saved counter was **1**.

**Expected:** persistence outcome and enrichment outcome remain distinguishable.

**Operator copy when commit is known**

> In-process measurement was saved, but its details could not be loaded. Refresh the production run before adding another measurement.

When the request outcome is unknown:

> The save could not be confirmed. Refresh the production run and check its in-process measurements before trying again.

- **Retry:** creation is not safely repeatable without an operation key or a saved-record check.
- **Resolver:** Member can inspect; persistent lookup failure needs platform investigation.
- **Route/action:** `/production-runs` → run → in-process measurements; **Add Sample** only after checking.
- **Tests:** commit succeeds/read fails; transaction fails before commit; connection lost during commit; duplicate retry; attachment choreography receives a saved ID even if enrichment fails.

The storage-deletion drain is **not** an example of this defect: it catches drain failures and leaves queued work retryable at `storage-object-deletions.ts:203`.

---

### F9. P2: Production-run deletion does not explain in-process measurement dependencies

**Evidence:** static schema and delete trace.

`deleteProductionRun` explicitly checks products and credit batches, then deletes feedstock links, readings, incidents, and the run. It does not delete or preflight `productionSamples`.

- `production-runs/mutations.ts:944,967`
- `db/schema/production.ts:443` has a composite FK from production samples to runs without cascade.
- Migration `drizzle/0079_volatile_plazm.sql:244` preserves `ON DELETE no action`.

**Reproduction**

Create a run with an in-process measurement but no product or credit-batch dependency. Select **Delete** for the run.

**Expected static outcome:** the final run deletion fails on the FK. The transaction protects earlier child deletions, so this is an opaque blocked deletion, not demonstrated partial data loss.

**Expected:** either explicitly block with the child dependency or deliberately include child deletion and document retirement in the confirmation contract.

**Operator copy**

> Production run {code} was not deleted because it has in-process measurements. Open Edit and review those measurements before deleting the run.

- **Certainty:** FK failure rolls back the transaction.
- **Retry:** safe but ineffective until dependencies are addressed.
- **Resolver:** Member.
- **Route/action:** `/production-runs` → **Edit** → **Delete in-process measurement**. That child deletion is irreversible and must be intentional.
- **Tests:** run with sample and sample document; failed run deletion preserves readings/incidents; concurrent child creation versus deletion; actionable dependency error.

---

### F10. P2: In-process measurement validation accepts negative physical quantities and malformed time strings

**Evidence:** executed actual schema; static DB definition.

`productionSampleFormSchema` uses `optionalNumber` for weight and volume and only `min(1)` for timestamp, at `schemas/production-samples.ts:15`.

Executed inputs:

- `weightGrams: -1`, `volumeMl: -2`: **accepted**.
- `timestamp: "not-a-date"`: **accepted**.
- Clearing a numeric field with `""`: correctly produced **null**.

The table uses unconstrained `real` columns for these measurements at `db/schema/production.ts:429`.

**Expected:** physical weight/volume reject negatives; timestamp validation rejects malformed values before constructing a `Date`.

**Operator copy**

> Enter a weight of 0 or greater.

> Enter a valid measurement time.

- **Certainty:** validation should save nothing.
- **Retry:** safe after correcting the indicated field.
- **Resolver:** Member.
- **Route/action:** run **Edit** → in-process measurement → **Add Sample** or **Save Changes**.
- **Tests:** negative, zero, empty, non-finite, and malformed timestamp inputs. Do not impose an arbitrary non-negative temperature rule.

Future-dated sample policy is separately documented as an open decision; it is not included in this defect.

---

### F11. P2, already documented: Feedstock provenance allocates against original intake weights rather than remaining quantities

**Evidence:** static implementation and existing recorded issue.

`allocateFeedstockWetMass` selects each complete intake’s original `massWetKg`, at `data-access/feedstock-wet-stock.ts:91`, then weights every new draw using those values. It does not subtract prior attribution.

The repository already records this at `docs/open-questions.md:947`.

**Reproduction**

1. Intake A: 100 kg.
2. Consume 100 kg.
3. Intake B: another 100 kg into the same bin.
4. Consume another 100 kg.

**Static result:** the second draw attributes 50 kg to A and 50 kg to B. A has now supplied 150 kg despite its 100 kg intake.

**Expected:** whatever commingling policy is chosen must preserve defensible per-intake attribution. Bin-level overdraw protection alone does not establish that.

**Operator copy for detected inconsistency**

> This production run’s feedstock attribution needs review. The bin total does not confirm which intake supplied the run. Ask an Organization Admin to review the intake and withdrawal records before certification.

- **Certainty:** physical bin total can remain correct; provenance is inconsistent.
- **Retry:** resaving is not a reliable repair.
- **Resolver:** Admin and platform engineering; no explicit attribution-repair action was found.
- **Route:** `/production-runs` and `/feedstocks` for inspection.
- **Tests:** intake/withdrawal/intake sequence; multiple draws; recorded loss; gram rounding; conservation per intake and per bin.

## Defensive behavior and intentional restrictions

These mechanisms should be preserved.

| Area | Existing protection | Evidence and existing tests |
|---|---|---|
| Production-run lifecycle | Explicit transition table; cancelled terminal; complete/failed can reopen through running; complete requires positive output; terminal outcomes require consumed feedstock and end time | `lib/production-runs/lifecycle.ts`; `lib/production-runs/lifecycle.test.ts`; `tests/production-run-lifecycle-transitions.test.ts` |
| Timing and overlap | Facility-aware time handling; future-time checks; locked overlap check; reactor/start uniqueness backstop | `production-runs/mutations.ts:697`; `production-runs/overlap.ts`; `mutations-future-preflight.test.ts`; `overlap.test.ts` |
| Multi-bin run input | Duplicate-bin and precision checks; each draw validated; one overdraw rolls back replacement of all draws | `production-runs/feedstock-draws.ts:190`; `feedstock-draws.test.ts`; `tests/production-run-feedstock-wet-stock.test.ts:329,364` |
| Run stale save | Client timestamp compared against locked row | `mutations.ts:591` |
| Run cohort consistency | Editing a member outside its facility/date/feedstock cohort is rejected | `credit-batch-membership.ts:621` |
| Product source integrity | New source-bin products have fixed source allocation; source wet/dry capacity checked; recipe ratio snapshot avoids rewriting old stock math | `biochar-products.ts:577,755`; `biochar-product-source-allocations.ts:208`; source allocation and mass tests |
| Product stock reductions | Includes water changes and upcoming delivery allocations; derives effective values under lock | `biochar-product-stock-locks.ts:92,302`; `tests/stock-reducing-update-guards.test.ts:328` |
| Formulation partial writes | Parent lock plus effective current ingredients/ratio prevents two partial updates jointly exceeding 100%; stable line IDs retained | `formulations.ts:339`; `tests/formulations.test.ts` |
| Credit-batch membership | Run/process/batch lock ordering; snapshot recheck; one batch per run; overlapping cohorts rejected | `credit-batches.ts:588`; `credit-batch-membership.ts`; `db/schema/credits.ts:271`; auto-membership/scope-race tests |
| Sampling choice | Updating `sampling` is explicitly rejected; eligibility/prerequisites checked for unsampled creation | `schemas/credit-batches.ts:213`; `credit-batches.ts:427` |
| Sample links | Direct batch samples survive membership updates; only legacy run-backed links are reassigned | `credit-batches.ts:771`; `tests/credit-batch-sample-linking.test.ts` |
| Assigned slices | Reconciliation deletes only unassigned slices; assigned natural keys excluded from recreation | `credit-batch-application-slices.ts:330` |
| Certification freeze | Local `draft`, `submitted`, and `accepted` submission rows block upstream mutations; artifacts locked and lineage re-resolved | `certification-lineage-guards.ts:246,277`; `credit-batch-certification-lock.ts`; `tests/certification-lineage-guards.test.ts` |
| Production claim retry | Same submission may resume; takeover rejects possible/confirmed external mutation; batches locked in sorted order | `production-claim-reservations.ts:39,77`; reservation/write tests |
| Evidence creation | Known saved entities retained when attachment upload fails; opens edit and reports “created, but attachment…” | `hooks/use-create-with-evidence.ts:68`; readings deferred retry at `production-readings-documents.ts:85` |
| Evidence deletion | Transactional retirement plus post-commit best-effort storage outbox | `storage-object-deletions.ts:130`; `tests/parent-document-retirement.test.ts` |
| Cross-org child association | Production-sample/run composite FK prevents a foreign run association despite missing explicit parent lookup in sample creation | `db/schema/production.ts:443` |
| Energy absence | Null aggregates remain unavailable; cancelled/archived runs excluded; stale cached data accompanied by error | `production-runs/queries.ts:584`; `components/energy/energy-summary.tsx` |

In-process measurements are not certification replicates. Their lack of a blanket certification freeze is not, by itself, a defect.

Product statuses are accepted enum values without a production-run-style transition machine. I found no sufficiently explicit requirement to classify that as a defect.

## Hypotheses and unresolved design mismatches

These should not enter implementation as confirmed findings without parent verification.

1. **Method-B historical boundary.** `CONTEXT.md` says sampling choice is fixed when production begins. Unsampled creation evaluates eligibility with `new Date()` at `credit-batches.ts:437`, rather than the cohort start. Test whether a newly eligible process can create an old unsampled cohort. The ADR describes choice fixed at creation, so the documented contracts need reconciliation before choosing the fix.

2. **Production-process start date.** The glossary describes an operator-entered operational start date. The UI sends only facility/type, and the writer saves `new Date()` at `production-processes.ts:102`. There is no start-date field or edit path. This is a clear documentation/implementation mismatch; its intended product behavior needs confirmation.

3. **Feedstock-type usage changes after use.** Canonical updates can change usage/category without dependency or certification checks. A used pyrolysis type can become blend usage, changing bin capability and future validation. Partial usage updates also skip category/usage pair validation because one side is absent. Determine whether usage must become immutable after use; do not silently impose that policy based on this audit alone.

4. **Structured telemetry freeze.** Import/delete-all writers do not invoke the certification lineage guard. They are explicitly unmounted legacy paths. Determine whether deployed server-action reachability or any supported caller still makes them operationally relevant before treating this as an active registry-integrity defect.

5. **Credit-batch metadata edits with assigned slices.** The UI submits cohort fields even when unchanged. Their presence sets `shouldRefreshMembership`, which triggers `assertCreditBatchSlicesAreUnassigned`. A notes-only UI edit can therefore be blocked where a notes-only API payload would pass. Verify the intended editable-field policy and actual sheet lock state.

6. **100% moisture feedstock.** The schema permits it and dry mass becomes zero. `determineFeedstockStatus` requires positive dry mass, and stock derivation counts complete rows only. Thus a physically recorded wet intake can contribute no wet stock. Decide whether 100% is invalid intake or valid wet stock before changing this boundary.

7. **Mixed lock-order deadlocks.** Feedstock updates lock the feedstock row before the bin, while run/product paths generally take bin locks before row/reference work. The code justifies a targeted PostgreSQL interleaving test; this audit did not prove a deadlock.

8. **Optimistic cache overlap.** Product/formulation errors restore whole saved list snapshots. Concurrent mutations could restore older list state after a newer mutation succeeds. Detail invalidation exists; a focused React Query interleaving test is needed before reporting a user-visible defect.

## Simulation and untested-case ledger

| Case | Evidence | Result |
|---|---|---|
| Empty required feedstock inputs | Static schemas | Required supplier/type/bin/positive mass; create requires delivery date |
| Partial moisture update | Executed schema + actual writer/mock | Dry mass remained stale |
| Omitted distance on partial update | Executed schema; static transport trace | Became null, defeating preserve-on-omission |
| Sample numeric clearing | Executed actual schema | Empty string became null correctly |
| Negative sample weight/volume | Executed actual schema | Accepted |
| Malformed sample timestamp | Executed actual schema | Accepted |
| Zurich browser/UTC server time | Executed schemas/conversion | Two-hour shift for sample and incident |
| Stale feedstock save | Executed actual writer/mock | Older value overwrote newer value |
| Feedstock reduction below consumption | Executed actual writer/mock | Negative modeled balance |
| Repeated loss | Executed actual writer/mock | Two rows and two deductions |
| Correct duplicate loss upward | Executed retained stock-take writer/mock | Rejected |
| Member quick-add | Executed actual writer/mock; static action/role trace | Insertion reached |
| Quick-add registry identity | Executed extracted source mapping | ID omitted |
| Post-insert read failure | Executed actual action with injected failure | False “not created” result |
| Production-run transition enumeration | Executed pure function | Matches documented local transition table |
| Concurrent withdrawals | Static + existing DB test inspection | Shared bin lock; not executed here |
| Concurrent claim/claim, claim/delete | Static + existing DB tests | Reservation/slice/artifact protections present; not executed |
| Run delete with child measurement | Static FK/delete trace | Transaction expected to fail safely but opaquely |
| Supply deletion after recorded loss | Static | Missing final balance assertion; DB reproduction pending |
| Cross-org read/write attempts | Static scoping/FK review | No cross-org runtime test executed |
| Attachment upload partial failure | Static choreography | Known saved entity retained; browser retry not executed |
| HTTP timeout or disconnect | Failure-injection reasoning | No live transport fault executed |
| Registry unavailable/drift/deletion | Outside assigned orchestration scope | Not tested |
| Archived-facility races | Static only | Full descendant mutation/archive interleavings untested |
| Browser double-click and remount | Untested | Pending UI flags inspected; event-level behavior not verified |

## Operator guidance for existing certification locks

The current shared message states only that a record is locked by a certification submission, at `src/lib/certification/lineage-lock-message.ts:33`.

A more useful message, without inventing an amendment capability:

> This production run was not saved because it is locked by a certification submission. Ask an Organization Admin to review the linked Removal in Certification.

For deletion, substitute “was not deleted.”

- Do not promise that refresh unlocks it.
- Do not advise deleting downstream records merely to bypass certification.
- Do not claim **Request amendment** exists.
- The relevant destination is `/certification/removals`; identifying the exact Removal should come from the guard’s resolved lineage.
- An interrupted submission can remain deliberately locked. The registry investigator must supply the supported recovery action for its actual state.

## Prioritized implementation plan

### 1. Close the shared write-boundary gaps

- Route feedstock-type quick-add through canonical creation.
- Preserve its selected registry identity.
- Add final stock validation to supply reductions, relocation, and deletion.
- Derive feedstock dry mass in data access from locked effective inputs.
- Preserve omitted fields in update schemas.

**Verification:** targeted action/schema tests plus isolated PostgreSQL transactions for negative-stock and rollback behavior. No broad CRUD abstraction is needed.

### 2. Make loss operations safely repeatable

- Add a stable client operation key to loss submission.
- Return the existing movement for an exact replay.
- Reject changed payloads using the same key.
- Design a reversal of a specific movement with amount, org/bin, reason, and provenance constraints.
- Keep arbitrary positive stock creation prohibited.

**Verification:** lost-response replay, concurrent replay, distinct concurrent losses, over-reversal, cross-org reversal, and downstream accounting effects.

### 3. Separate saved outcome from enrichment and upload outcome

Return a durable identifier immediately after known commit, with enrichment/evidence failures represented separately. Preserve an explicit unknown-outcome branch for transport uncertainty.

**Verification:** inject failures before commit, after commit, during enrichment, and during attachment flush. Assert the UI never tells operators to recreate a known-saved record.

### 4. Extend production-run stale-save protection deliberately

Apply an equivalent version check to feedstock, formulation, product, batch, incident, and in-process measurement editors. Keep row/bin locks and effective-state validation.

**Verification:** two real editors, disjoint and overlapping changes, deletion between open/save, unchanged save, and retained user input after conflict.

### 5. Correct child-record time and validation contracts

Use explicit facility timezone conversion and validated instants for incidents and measurements. Add physical quantity bounds. Improve production-run child-dependency deletion messages.

**Verification:** timezone round trips and DST; negative quantities; invalid time; parent deletion rollback including documents.

### 6. Resolve the remaining domain decisions separately

- Historical Method-B eligibility and process start-date semantics.
- Usage changes for already-used feedstock types.
- Feedstock provenance allocation policy.
- Editable batch metadata once slices are assigned.
- Retirement or supported status of structured telemetry actions.

These decisions should not be bundled into the immediate correctness fixes.

The existing locks, immutable source allocations, assigned-slice snapshots, and deletion outbox provide useful foundations. The needed changes are primarily consistent enforcement and accurate mutation outcomes at the existing seams.