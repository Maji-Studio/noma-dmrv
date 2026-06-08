# Fix Plan — E2E Manual Test Findings (2026-06-06 walkthrough)

Source: full manual browser E2E walkthrough of every entity + certification, cross-checked against the Isometric sandbox registry. Findings detail in `memory/e2e-manual-test-findings-2026-06.md`.

Tiers: **P0** ship-blocker (security) · **P1** correctness · **P2** polish/UX · **P3** product decision / defer.
Each item has verified `file:line` refs and a concrete fix. Effort: S (<1h) · M (half-day) · L (multi-day).

---

## P0 — Authorization / data-isolation (systemic)

### A1. EntitySelect option-fetchers return all owners' rows (no user/facility scoping)
**Severity: HIGH · Effort: M · Risk of fix: low**

The UI symptom (supplier picker shows 4, list shows 1) is one instance of a **systemic** gap: `requireAuth(userId)` only checks *authentication*, not *ownership*, and several `get*Options` queries have **no `.where()` scoping at all** — they return every row across all users.

Confirmed unscoped (zero scoping clause):
- `getSupplierOptions` — `src/data-access/suppliers.ts:417`
- `getProductionRunOptions` — `src/data-access/production-runs/queries.ts:479`
- `getBiocharProductOptions` — `src/data-access/biochar-products.ts:780`
- `getFeedstockOptions` — `src/data-access/feedstocks.ts:563`
- `getFormulationOptions` — `src/data-access/formulations.ts:374`

Needs a closer look (have a `.where`, but verify it scopes by *owner*, not only by parent id):
- `getSampleOptions` — `src/data-access/samples.ts:735` (filters by `productionRunId` only)
- `getApplicationDeliveryOptions` — `src/data-access/applications.ts:257`
- `getCreditBatchApplicationOptions` — `src/data-access/applications.ts:325`

**Decision needed first:** is the tenancy model per-user (list pages scope by `userId`, implying yes) or per-facility? The list queries (`getSuppliers`, etc.) are the source of truth for the intended filter — match them.

**Fix:** add the same ownership filter the sibling list query uses to every `*Options` query (e.g. `.where(eq(suppliers.userId, userId))`, or facility-scoped where appropriate). Where an option list feeds a facility-scoped form, scope by `facilityId` too so the dropdown can't reference another facility's entity.

**Verification:** run `reviewer-authz` over `src/data-access/` after the fix to confirm no entry point still reads user-scoped data without scoping. Add a data-access test per fixed function (seed two users, assert each sees only its own rows).

> Note: if the app is actually single-org/shared-data by design, the correct fix may instead be to **remove the now-misleading per-user filters from the list queries** and document the model — but do not leave list and options inconsistent.

---

## P1 — Correctness

### B1. Biochar product Dry Mass overstated when water is added
**Severity: MEDIUM (display/reporting; credits unaffected) · Effort: S · Risk: low**

`deriveMassDryKgWithAddedWater(wet, moisture%, water)` returns `(wet + water) × (1 − moisture%/100)` — `src/lib/calculations/mass-dry.ts:35`. Adding water cannot increase dry (carbon) solids; this counts `moisture% × water` as extra dry mass. Example: 1500 kg @ 2% + 30 kg water → reports **1499.4 kg**, should be **1470 kg**. It also contradicts the form's own "final moisture 3.92%" (which implies 1470).

Used by the create-form preview (`biochar-product-form.tsx:278`) and the products list column (`biochar-product-list.tsx:60`). Dry mass is **not persisted** and the credit path derives dry mass at the **delivery** level via the correct `deriveMassDryKg` (`applications.ts:177`), so credits are unaffected — this is a misleading displayed number only.

**Fix:** dry solids are independent of added water: return `deriveMassDryKg(wet, moisture%)` (ignore `water` for the dry-mass figure; keep `effectiveWetMass = wet + water` and `finalMoisture` as-is for their own readouts). Decide product-intent: if "moisture%" is meant to be the *pre-water* product moisture (it is — there's a separate final-moisture readout), the dry mass must use `wet`, not `wet + water`.

**Tests:** update/extend `src/lib/calculations/biochar-removal.test.ts` (or a `mass-dry.test.ts`) — assert `deriveMassDryKgWithAddedWater(1500, 2, 30) === 1470`, and that it equals `deriveMassDryKg(1500, 2)` for any `water`.

### B2. Summary-stat cards don't refresh after create (Production Runs + Deliveries)
**Severity: MINOR · Effort: S · Risk: low**

Root cause (both hooks): the stats query key embeds `filters`/`facilityId` positionally —
`deliveryKeys.stats(filters) = [...all, "stats", filters]` (`use-deliveries.ts:46`), page queries with `stats({facilityId})` (`:121`). The create handler invalidates with `stats()` → `[...all, "stats", undefined]` (`:200`), which does **not** prefix-match `[...all, "stats", {facilityId}]`, so the active stats query is never invalidated. Identical pattern in `use-production-runs.ts` (`stats(facilityId)` `:46`, invalidated via `stats()` `:206/:321/:429`).

**Fix:** invalidate by the stats *prefix* (drop the trailing arg), e.g. `invalidateQueries({ queryKey: [...deliveryKeys.all, "stats"] })` / `[...productionRunKeys.all, "stats"]`, or add a `statsPrefix` key helper and use it everywhere stats are invalidated (create/update/delete handlers — `use-deliveries.ts:200,295,…`, `use-production-runs.ts:206,321,429,…`). Audit other entities for the same positional-filter-in-key pattern.

**Tests:** hook test — create mutation invalidates the facility-scoped stats query (assert it's marked stale/refetched).

---

## P2 — Polish / UX (trivial)

### C1. Temperature label renders raw `°C`
**Effort: S.** In JSX *attribute* strings `°` is literal, not an escape:
- `production-sample-form.tsx:160` `label="Temperature (°C)"`
- `production-run-reading-form.tsx:78` `label="Temperature (°C)"`

**Fix:** use the literal `label="Temperature (°C)"` (or a JS expression `label={"Temperature (°C)"}`). Note `production-sample-table.tsx:161` passes `"°C"` as a *JS arg* so it already renders correctly — don't touch it.

### C2. Credit-batch overlap error banner doesn't clear on date edit
**Effort: S.** The submit-time "Date range overlaps with CB-…" server error persists after the user changes the dates to a non-overlapping range (inline amber warning + applications list do update; clears on next submit). **Fix:** clear `root.serverError` when the start/end date fields change (RHF `clearErrors` on those fields' change, or reset server error on form value change).

### C3. Formulation ratio unit (decimal input vs % display)
**Effort: S.** Input expects 0–1 (`e.g., 0.7`, "Value between 0 and 1"); list + badge show % (70%). Internally consistent. **Fix (pick one):** accept percent input to match the display, or add a "(0–1)" suffix to the label and a unit hint. Low priority.

### C4. Code-prefix inconsistencies
**Effort: M (touches code generators + seed data).** Same entity, multiple prefixes:
- Feedstock created `FI-` vs seeded `FS-`
- Lab sample created `SAM-` vs seeded `S-`; production sample `PS-`
- Facility `FAC-2026-001` (year) vs seeded `FAC-MOSHI-001` (name)

**Fix:** decide one canonical scheme per entity, align the code-generator helpers and the seed data (`tests/e2e/fixtures/seed-chain-data.ts` and any DB seed). Cosmetic but affects data trust/searchability.

---

## P3 — Product decisions / defer

### D1. Production-run Readings are orphaned
`ProductionRunReadingForm` + `ProductionRunReadingTable` (+ schema + data layer) exist but are imported nowhere; the only readings UI is the **non-functional CSV stub** ("UI mock only … not uploaded or saved yet") in the prod-run form. **Decide:** (a) wire the Reading table/form into the prod-run **edit** sheet like Samples/Incidents (`production-run-list.tsx:490`) and implement real CSV upload, or (b) remove the dead components + CSV stub. Don't leave a half-built feature. **Effort: L if (a), S if (b).**

### D2. Reactor "Method B" selectable with 0 prior samples
Create form allows "Method B (Every 10th Batch)" on a brand-new reactor; the "requires 30 prior Method A samples" text is informational only. Eligibility appears gated downstream (Method-B-Eligible stat stays 0). **Decide:** add a blocking validation / disabled state at selection, or keep informational and rely on the downstream gate. **Effort: S.**

### D3. Certification app is local-first; doesn't mirror registry
App cert view shows 0 removals / 0 GHG statements while the live sandbox registry (`prj_1K9YJ33RKSBX9FFF`) holds **7 draft statements / 12 removals**. Period math aligns (app preview "0 removals" for 13–30 Jun matches the registry draft), so this is likely **by-design** (app surfaces only what it created). **Decide:** is a "read/sync existing registry removals" view needed, or is local-first intended? If intended, add a one-line note in the cert UI so the 0-counts aren't read as "registry is empty". **Effort: M–L if sync is wanted; S for the clarifying note. Likely defer.**

---

## Suggested sequencing

1. **A1** (security) — first; gate on the tenancy-model decision, then sweep all `*Options` + `reviewer-authz` pass.
2. **B1, B2** (correctness) — small, well-scoped, test-backed.
3. **C1, C2** (trivial UI) — bundle into one PR.
4. **C3, C4** (unit/cosmetic) — when convenient.
5. **D1–D3** — triage with product before building; D1(b) removal is cheap if readings aren't wanted yet.

## Not bugs (verified working — don't touch)
Required-field validation · delivery dry-mass calc (`752 = 800×(1−6%)`) · credit-batch date-overlap **enforcement** · removal **readiness gating** · cert connection binding (project/template/protocol) · live emission-component reconciliation · Chain-of-Custody graph · order→delivery→application linking · same-session stats refresh on Orders/Customers/Applications/Credit-Batches/Lab-Samples.
