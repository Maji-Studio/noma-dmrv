# Data-Integrity / Authorization / Unsafe-State-Transition QA Pass — 2026-06-13

Browser-based operator QA of `http://localhost:3100`, authenticated as Admin, with a
specific lens: **data integrity, authorization, and unsafe state transitions** — not
UX/visual (those were covered by the three prior 2026-06-13 passes). No auth bypass; no
PII inspected; records referenced by stable IDs/codes.

This pass combined four read-only code audits (authz, data-integrity, concurrency, and a
prerequisite/route map) with targeted **in-browser confirmation** of the highest-value
candidates. Findings are tagged **[browser-confirmed]** (reproduced live) or
**[code-confirmed]** (audit-derived with file:line, not separately driven in-browser
because the realistic trigger is a crafted payload / two-session race rather than a
single click).

## Documented posture (the lens that shapes severity)

`docs/security.md`: noma-dmrv is **single-org / shared-data** today. Facility context
"scopes workflows but is **not** a tenant boundary." `userId` columns are attribution,
not ownership. **So a generic cross-facility *read* is expected-by-design, NOT a
finding.** The interesting cases are where the UI *implies* per-facility isolation the
code doesn't enforce, where a **wrong-facility / cross-parent write** creates an
inconsistent record, where a **certification artifact** is built on stale/contradictory
data, or where a **state transition** lacks a server-side guard.

## Environment notes

- Viewport was full desktop (~1537px) this session — the prior pass's 514px pin was gone.
- **Parallel QA checks were running on the same server** (tabs/facilities observed:
  `DupSubmit QA4 Race`, `QA Pass3 Facility`, plus a sibling probing credit-batch detail
  cross-facility). I worked in my own tab, used guaranteed-to-fail (non-destructive)
  deletes on shared data, and created write-test residue only in the empty scratch
  facility `QA Raw Facility qaaek723` (`170b41a0-…`).
- **QA residue created** (scratch facility `170b41a0` only): reactor `R-26-005` "QA-DI
  Reactor" and production run `PR-26-003` (deliberately saved `Complete` with no data —
  see F3). Safe to delete.

## Not duplicated (already-open issues in this lane)

`#226` lost-update/optimistic-concurrency · `#229` optimistic updates · `#200`
correcting completed records · `#116` over-withdraw bin · `#114`/`#40` biomass-draw
validation · `#104` supplier picker shows customers · `#245`/`#246`/`#247` zero-removal
GHG / readiness semantics / removal draft preconditions · `#248`/`#249`/`#250`
date/list/status display.

---

## Findings

Severity: **P0** crash / data-loss / critical-security · **P1** high · **P2** medium ·
**P3** low.

### P1

#### F2 — Unguarded delete surfaces a raw SQL statement (and internal UUID) to the operator **[browser-confirmed]**

A delete that hits a foreign-key constraint returns the **raw database error verbatim**
to the UI. Reproduced on storage-bin delete; the same un-guarded pattern exists on
customer and delivery deletes.

**Repro (non-destructive — the row survives the FK rejection):**
1. `/storage-locations?facility=f346545f-…` (Operator facility), bin **SL-26-001**
   "Operator Feedstock Bin" (holds 150 kg of a feedstock batch).
2. Click the trash icon → confirm dialog "Delete Storage Bin — … This action cannot be
   undone" (note: **no warning that the bin holds feedstock**).
3. Click **DELETE**. A red banner appears verbatim:
   > `Failed query: delete from "storage_locations" where "storage_locations"."id" = $1 params: 2eb416a7-c962-4bc5-8643-a01e5d7085f4`
4. The bin is **not** deleted (FK `NO ACTION` protected it — no orphan), but the operator
   is left with an un-actionable SQL string.

**Why it matters (3 problems in one):**
- **Missing dependency guard.** `deleteStorageLocation` (`src/data-access/storage-locations.ts` ~L872) is literally `// TODO: Add checks for related records … For now, we allow deletion` followed by the `db.delete`. No count guard, no friendly `SafeError`.
- **Information disclosure.** `deleteStorageLocationFn` (`src/fn/storage-locations.ts:323-329`) returns `error instanceof Error ? error.message : …` with **no `NODE_ENV` gate**, so the raw Drizzle/Postgres query text + internal PK reach the client **in production too**. This `error.message` passthrough is repeated in *every* `catch` in that file (systemic). Violates `docs/security.md` → "sanitized error messages."
- **Broken recovery.** Per the goal's "recover correctly after failed saves," the operator gets SQL, not "Move or remove the bin's contents first."

**Same un-guarded shape (code-confirmed):**
- `deleteCustomer` (`src/data-access/customers.ts:415`) checks `customerLocations` but **not `orders`** (`orders.customerId` is NOT NULL `NO ACTION`, `src/db/schema/logistics.ts:58`) → raw FK 500 for a customer with orders.
- `deleteDelivery` (`src/data-access/deliveries.ts:781`) omits the `applications` guard (`applications.deliveryId` NOT NULL, `src/db/schema/application.ts:27`) → raw FK 500 for an applied delivery. It also resyncs the biochar transport leg *after* the delete in the fn layer (`src/fn/deliveries.ts:382`), outside the delete transaction — a stale-emissions hazard if that resync throws.

**Fix:** add dependency count guards that throw `SafeError` before deleting (mirror the existing `customerLocations` check), and sanitize the fn `catch` to a generic message for non-`SafeError` errors (return `error.message` only for `SafeError`/Zod).

### P2

#### F1 — Detail routes display & allow editing of another facility's record while the sidebar shows a different active facility **[browser-confirmed]**

**Repro:**
1. Get a credit-batch detail id from the Operator facility — CB-26-001 =
   `/credit-batches/f2532d3e-9645-4885-b18c-e1c7e09b0ea0` (facility `f346545f`).
2. Navigate to that exact id but with the **empty** scratch facility active:
   `…/f2532d3e-…?facility=170b41a0-…` (QA Raw Facility qaaek723, 0 reactors/storage/feedstock).
3. The sidebar selector reads **"QA Raw Facility qaaek723"**, but the page renders
   **CB-26-001 of "Operator Facility mqceboe4"** — breadcrumb, title, all batch details,
   the live-recomputing Submission gate, and an **EDIT DETAILS** button.

**Why it matters:** Under the single-org posture the *read* is allowed, but the detail
route ignores the active `?facility=` entirely, so an operator who switched facilities is
looking at — and can **edit/delete** — a *different* facility's certification batch while
the entire chrome tells them they are in QA Raw Facility. `updateCreditBatch` operates on
the batch's own `facilityId` with no active-facility reconciliation, so a save *succeeds*
cross-facility. This is the "edit records from the wrong facility" hazard, and it
undermines the per-facility isolation the rest of the UI sells.

**Server basis:** `getCreditBatchById(userId, id)` (`src/data-access/credit-batches.ts:401-423`)
does `requireAuth` but its `WHERE` is `eq(creditBatches.id, id)` only — no facility
predicate; the page (`/credit-batches/[id]/page.tsx`) passes only the id. Per the
prerequisite map this is **credit-batch-specific** (removal side-sheets, by contrast,
key off the active-facility overview list and safely close on facility switch).

→ Decision issue filed (see below) — needs a product call, not just a code fix.

#### F3 — A production run can be marked **Complete** with zero production data and no completeness/state-machine guard **[browser-confirmed]**

**Repro:**
1. In scratch facility `170b41a0`, created reactor `R-26-005`.
2. `/production-runs` → New Production Run. Reactor auto-fills; Date + Start Time
   pre-filled. Set **Status = Complete**. Leave Source Bin, Wet Mass, Moisture, Feed
   Rate, Biochar output, and sample **all empty**. Submit.
3. Run **PR-26-003** is created with status **Complete** (green), **Feedstock 0 kg**,
   **Biochar Wet —**, and a red **"Incomplete (9)"** certifier badge. The success toast
   itself says *"Still needed to certify: Telemetry readings, Feedstock wet mass,
   Feedstock moisture, …"*.

**Why it matters:** The app *computes* that the run is incomplete yet still transitions it
to `Complete` — an internally contradictory record (a pyrolysis batch that consumed
nothing and produced nothing, yet "Complete" and counted in the COMPLETED KPI). Status is
a blind-overwrite column with **no server-side precondition / allowed-transition table**:
`createProductionRun` (`src/data-access/production-runs/mutations.ts:192`) takes
`status ?? "draft"` directly, and `updateProductionRun` (`:339`) is
`if (data.status !== undefined) updateData.status = data.status;` with no re-check. The
two-session variant of the goal's "submit after data changed elsewhere" follows directly:
open a draft run in Tab A, delete its sample in Tab B, then flip Tab A's stale form to
`Complete` — it saves, because completeness is only ever a client-render concern.

→ Decision issue filed (see below) — is `Complete` an operational marker decoupled from
cert-readiness (current), or should it gate on completeness?

#### F4 — Order accepts a `customerLocationId` belonging to a *different* customer (cross-parent FK write) **[code-confirmed]**

`createOrder` (`src/data-access/orders.ts:401`) / `updateOrder` (`:474`) validate that the
biochar product's facility matches, but **never verify the supplied `customerLocationId`
belongs to the supplied `customerId`** (and `createOrder` never confirms the customer
exists beyond the DB FK). The order form scopes the location dropdown to the chosen
customer client-side via `dependsOn`, so this is purely a client constraint — the server,
which is the integrity boundary, writes a customer-A order with customer-B's delivery
location. That location's GPS + `distanceFromFacilityKm` then feed the delivery
transport-leg derivation and the certification distance/emissions inputs
(`getApplicationDeliveryOptions` even joins it for soil temperature), so the bad reference
propagates into the GHG preview. **Fix:** assert `customerLocation.customerId === customerId`
(reuse `getCustomerLocationById`) in create/update, mirroring the existing product-facility
check.

#### F5 — Certified Removal desync: upstream edits/deletes aren't blocked by the submission guard that protects the batch/application layer **[code-confirmed]**

The immutability guard exists only at the top two layers: `deleteCreditBatch`
(`src/data-access/credit-batches.ts:707`, `removalHasBlockingSubmission`) and
`deleteApplication` (`src/data-access/applications.ts:567`, `IMMUTABLE_CREDIT_BATCH_STATUSES`).
**No equivalent guard exists below the application** — `updateProductionRun`,
`updateCreditBatch`, `deleteSample`, biochar-product, delivery, and feedstock mutations.
A submitted Isometric Removal freezes its numbers in the immutable
`certification_submissions.payloadSnapshot`, but every noma surface (credit-batch detail,
removal view, CoC DAG) **live-joins the current entities**. Editing a run's
`biocharOutputKg` (which recomputes dry mass) on a run feeding a verified/issued batch — or
deleting a sample whose R₀/H:Corg already fed the batch's durability — leaves the noma UI
showing numbers that contradict what was certified, silently. This is the goal's "GHG
statement with stale/contradictory data," reached by normal edits. Cross-references `#200`
(corrections on completed records) but is specifically the **certification-immutability
asymmetry**. **Fix:** centralize the `removalHasBlockingSubmission` / immutable-status
check so all upstream mutations re-derive linked batches and reject when any is live.

### P3

#### F6 — Cross-tab / multi-session duplicate creates have no DB backstop **[code-confirmed]**

The submit button is correctly disabled while a mutation is in flight (verified: same-tab
double-click is blocked). But the lock is per-component-instance and the only unique
constraint is on the **per-request auto-generated `code`**, so two tabs / two sessions
submitting the same content create two distinct rows (production runs, orders,
applications, deliveries, credit-batches) — worst for production runs and feedstock
deliveries, which double-count into the certification aggregation. Distinct from `#226`
(lost update) and `#229` (optimistic UI); neither adds a natural-key unique index. A
sibling parallel check ("DupSubmit QA4 Race" facility) appears to be probing this same
class. **Fix:** natural-key unique index per entity (e.g. `(facilityId, date, reactorId,
startTime)`) and/or a client idempotency key — the certification layer already does this
correctly via `claimSubmissionDraft`.

#### F7 — Inconsistent not-found handling across detail routes **[browser-confirmed]**

A bogus credit-batch id (`/credit-batches/000…000`) renders a graceful in-app **"No credit
batch found."** card (app chrome intact). A bogus production-run id
(`/production-runs/000…000`) drops to a **bare Next.js 404** with no sidebar/nav. Neither
crashes, but the recovery experience is inconsistent. **Fix:** pick one convention
(prefer the in-app empty card so the operator keeps navigation).

#### F8 — Delete-confirm copy has no dependency awareness **[browser-confirmed]**

The storage-bin delete dialog says only "This action cannot be undone" even when the bin
holds 150 kg of feedstock (and the delete will in fact fail — see F2). Confirm copy should
reflect known dependents.

---

## Confirmed strengths (keep)

- **Auth guards are solid.** The authz audit found **no** missing-guard data-access
  function and **no** admin surface reachable by a non-admin. Every `data-access` fn calls
  `requireAuth`/`requireProjectMember`/`requireAdmin`; `/admin/*` is layout-gated;
  `documents/[id]` correctly splits authenticated vs `visibility="public"` reads;
  `storage-local` is signed-token gated.
- **Certification submit is server-enforced and re-validated.** Removal/GHG create & submit
  re-check facility↔Isometric link, default template + resolved blueprints, facility
  emission config, batch membership, **per-batch readiness recomputed server-side**, full
  production lineage, and reporting-period non-overlap — the client gates are UX-only. The
  submission ledger (`claimSubmissionDraft`) serializes against concurrent unlink. This is
  the gold-standard layer the others should mirror.
- **Missing-prerequisite create blocks cleanly.** New Production Run in a facility with no
  reactor → empty dropdown + "Please select a reactor" + red section marker, no crash.
- **Bogus / cross-facility detail ids don't crash** (404 or graceful card). The removal
  side-sheet safely closes on facility switch; certification routes redirect to Settings
  when the registry link is missing.
- Empty-submit validation UX is strong; HTML in names is escaped (prior pass).

---

## Severity & coverage summary

| Sev | Finding | Type |
|-----|---------|------|
| P1 | F2 unguarded delete leaks raw SQL + internal id; no dependency guard (systemic `error.message` passthrough) | browser |
| P2 | F1 cross-facility detail read/edit (credit-batch route ignores active facility) | browser → decision issue |
| P2 | F3 production-run `Complete` with zero data, no transition guard | browser → decision issue |
| P2 | F4 order accepts cross-customer `customerLocationId` | code |
| P2 | F5 certified-removal desync (upstream edits unguarded vs batch/app layer) | code |
| P3 | F6 cross-tab duplicate creates (no natural-key unique) | code |
| P3 | F7 inconsistent not-found handling | browser |
| P3 | F8 delete-confirm copy lacks dependency awareness | browser |

Goal checklist coverage: access wrong records → F1 · edit/remove from wrong facility →
F1 · duplicate/inconsistent records → F3/F4/F6 · GHG on stale/contradictory data → F5
(+ submit-prereqs confirmed solid) · direct-nav missing prerequisites → tested, mostly
graceful (F7 the exception) · submit after data changed elsewhere → F3 two-session
variant (+ `#226`) · recover after failed save → F2 (broken) vs empty-submit validation
(good).

## GitHub decision issues filed

- **#253 (F1)** — should facility-scoped detail routes guard against displaying/editing a
  record whose facility ≠ the active `?facility=`?
- **#254 (F3)** — should production-run `Complete` enforce completeness preconditions
  (guarded state machine), or stay an operational marker decoupled from cert-readiness?

The remaining findings (F2, F4, F5, F6, F7, F8) are concrete engineering bugs with clear
fixes and do not need a product decision.
