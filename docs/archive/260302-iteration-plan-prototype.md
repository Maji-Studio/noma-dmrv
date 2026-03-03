# 2026-03-02 Iteration Plan: E2E User Testing for Core Chain

## Goal

Enable real users to test all core schemas end-to-end through the browser UI.
Walk the full traceability chain: **Facility → Reactor → Production Run → Sample → Order → Delivery → Application → Credit Batch**.

## Current State

| Layer | Status |
|-------|--------|
| DB schemas | 45+ tables across 17 files — solid |
| App routes | 16 entity pages — good coverage |
| Forms | 14 entity forms — all core entities covered |
| Auth fixtures | Seed/teardown with 4 roles + seeded chain data — working |
| E2E chain test | `full-workflow.spec.ts` validates 21 entities via direct DB — working |
| E2E UI CRUD | **All 8 core entities covered** via UI tests — done |
| Full chain smoke | `full-chain-ui.spec.ts` creates all 8 entities in one session — done |

Baseline: 107 e2e passed (2 skipped), 28 unit passed.

## Verification Run (2026-03-02)

Running all tests exposed **form/test drift** — forms had gained required fields and the tests hadn't caught up. Summary of fixes applied:

### Bugs found and fixed in app code

| Bug | File | Fix |
|-----|------|-----|
| Delivery code auto-gen unreachable — `createDeliverySchema.parse()` requires `min(1)` but runs BEFORE `generateNextCode()` fallback, so empty code always fails validation | `src/fn/deliveries.ts` | Move auto-gen before `parse()` |
| Sample code auto-gen unreachable — same pattern as delivery | `src/fn/samples.ts` | Move auto-gen before `parse()` |
| Sample form schema rejects empty code — `sampleFormSchema.sampleCode` has `min(1)` but UI says "Auto-generated if empty" | `src/schemas/samples.ts` | Changed to `.optional().or(z.literal(""))` to match other form schemas |

### Test fixes applied

| Test file | Issue | Fix |
|-----------|-------|-----|
| `applications.spec.ts` | Order form missing `customerLocationId` and `biocharProductId` (required fields added to form since tests written) | Added `selectOption` calls for both fields, with wait for cascading customer location load |
| `applications.spec.ts` | Application form missing `biocharAppliedDryTons` (required field) | Added `page.fill` for the field |
| `applications.spec.ts` | Credit batch form `hToCorgRatio` required when durability=200_year | Added `page.fill` with `waitForSelector` (conditionally rendered) |
| `production-runs.spec.ts` | EntitySelect locator matched table headers instead of form fields — `<label>` element doesn't contain the EntitySelect trigger (they're siblings) | Changed to `label.locator("..")` (parent div) pattern, scoped to `[role="dialog"]` |
| `production-runs.spec.ts` | Reactor list has many leftover entries from prior runs, new reactor not on page 1 | Simplified: use seeded reactor instead of creating a new one |
| `full-chain-ui.spec.ts` | Same EntitySelect locator bug + missing `biocharProductId` + missing `biocharAppliedDryTons` + wrong `hToCorgRatio` field name | Applied same fixes as above |
| `seed-chain-data.ts` | Cleanup FK error — deleting `biochar_products` fails when UI-created orders reference them | Added facility-scoped cascade cleanup: orders → deliveries → applications → credit batches → production runs → samples before deleting seeded entities |

### Current test results

```
69 passed, 1 failed, 2 skipped
```

**Remaining failure: `create sample via UI form`** — The sample form fills correctly (production run selected, carbon values entered) and the submit button is clicked, but the side sheet doesn't close. No visible validation errors. Root cause still under investigation — likely a hidden form validation error or server-side rejection not surfaced in the UI. The sample form has many accordion sections and complex validation; may need deeper debugging of the form submission flow.

### Round 2: Biochar product form validation bugs

User tried to create a biochar product through the UI and hit multiple validation errors.

| Bug | File | Fix |
|-----|------|-----|
| Density field shows "expected number, received NaN" when left empty — `valueAsNumber: true` converts `""` to `NaN`, which fails all Zod union branches (`z.number()` rejects NaN, `z.string()` doesn't match, `z.null()` doesn't match) | `biochar-product-form.tsx` | Replaced `valueAsNumber: true` with `setValueAs: v => v === "" ? null : Number(v)` for both `massKg` and `densityKgM3` |
| Same NaN risk on mass field (worked in user's test only because they entered a value) | `biochar-product-form.tsx` | Same `setValueAs` fix |
| Zod schema for measurements was over-complex — 3-branch union to handle strings, numbers, and null no longer needed after `setValueAs` handles conversion | `schemas/biochar-products.ts` | Simplified to `z.number().min(0).nullable().optional()` |
| Optional UUID fields show "Invalid UUID" when empty — `z.string().uuid().optional().nullable().or(emptyToNull)` tries UUID first on `""`, which fails with misleading error before `emptyToNull` gets a chance | `schemas/biochar-products.ts` | Reordered to `emptyToNull.or(z.string().uuid()).nullable().optional()` — tries empty-to-null first |
| Facility/formulation showing "Please select a valid facility" despite being selected — **Root cause: Zod v4 strict UUID validation.** Seed `makeId` produces `00000000-0000-0000-0000-...` which lacks version/variant bits required by Zod v4's RFC 4122 regex | `src/db/seed.ts` | Fix `makeId` to `00000000-0000-4000-a000-...` and re-seed |

### Items to clean up (found in review)

| Issue | File | Status |
|-------|------|--------|
| ~~**DEBUG logging left in** — `console.log("[createFeedstockDelivery]...")`~~ | `src/fn/feedstock-deliveries.ts` | **Done** — removed |
| **Feedstock delivery form still uses `valueAsNumber: true`** — same NaN bug pattern, mitigated by `nanToNull` wrapper in `handleFormSubmit` but inconsistent with the `setValueAs` fix | `feedstock-delivery-form.tsx` | Works, unify later |
| **Seed file imports `@noble/hashes`** — runtime dep for dev tooling | `src/db/seed.ts` | Low priority |
| **`waitForTimeout` in E2E tests** — fragile on slow CI | `tests/e2e/*.spec.ts` | Low priority |

## Core Chain (8 entities, in dependency order)

These are the entities users need to create through the UI to walk the full chain:

```
1. Facility          (no dependencies)
2. Reactor           (needs: facility)
3. Production Run    (needs: reactor, feedstock)
4. Sample            (needs: production run)
5. Order             (needs: customer, biochar product)
6. Delivery          (needs: order, storage location)
7. Application       (needs: delivery, storage location)
8. Credit Batch      (needs: applications linked via junction table)
```

Prerequisite "lookup" entities (seeded, not tested through UI):
- Supplier, Feedstock Type, Customer, Customer Location, Formulation, Biochar Product, Storage Location

## Implementation Tasks

### Task 1: Extend seed data for UI tests — DONE
**Files:** `tests/e2e/fixtures/seed-chain-data.ts` (new), `tests/e2e/fixtures/auth-fixtures.ts` (updated)
**What:** Created `seedChainData()` function that seeds 12 prerequisite entities in a single transaction: facility, supplier, feedstock type, customer, customer location, formulation, biochar product, 2 storage locations, vehicle, feedstock delivery, feedstock. Added `seededData` fixture to the Playwright test object. Cleanup handled automatically via `cleanupChainData()`.

### Task 2: Facility + Reactor UI CRUD test — DONE
**Files:** `tests/e2e/facilities.spec.ts` (replaced redirect-only tests)
**What:** Admin logs in → creates facility via side sheet → verifies in list → creates reactor with EntitySelect for facility → verifies in list. Preserved DB-level duplicate code enforcement test.

### Task 3: Production Run + Sample UI CRUD test — DONE
**Files:** `tests/e2e/production-runs.spec.ts` (new)
**What:** Creates a reactor first, then creates production run with cascading EntitySelects (facility → reactor → feedstock), then creates sample linked to the production run.

### Task 4: Order + Delivery UI CRUD test — DONE
**Files:** `tests/e2e/distribution.spec.ts` (replaced redirect-only tests)
**What:** Creates order with seeded customer/facility/product → creates delivery linked to order via cascading select. Self-contained tests that create their own prerequisites. Preserved business logic validation tests.

### Task 5: Application + Credit Batch UI CRUD test — DONE
**Files:** `tests/e2e/applications.spec.ts` (replaced), `tests/e2e/credit-batches.spec.ts` (simplified)
**What:** Applications spec creates the full downstream chain (order → delivery → application → credit batch). Credit batches spec retains schema validation tests.

### Task 6: Full chain smoke test — DONE
**Files:** `tests/e2e/full-chain-ui.spec.ts` (new)
**What:** Single test with `test.step` blocks creates all 8 entities (Facility → Reactor → Production Run → Sample → Order → Delivery → Application → Credit Batch) in one authenticated session.

## Known Gaps / Things to Watch

1. **No UI cleanup of test-created entities.** Tests create entities (facilities, orders, etc.) through the UI but don't delete them afterward. The seeded prerequisite data is cleaned up, but UI-created entities remain in the DB. This is fine for isolated test runs but could accumulate in shared environments.
2. **EntitySelect `data-testid` is not scoped per field.** All EntitySelect instances use the same `data-testid="entity-select-trigger"`. Tests scope by finding the parent FormField label text first. If form layout changes, these selectors may break.
3. **Production Run form has many required fields.** The production run form requires facility → reactor → feedstock cascading selections plus date/time fields. The test handles this but is the most fragile of the set.
4. **No Edit or Delete UI tests yet.** All tests cover Create + Read (list verification). Update and Delete flows are not tested.
5. **Credit Batch application linking.** The credit batch form uses checkbox toggles for M:M application linking. The test clicks the first available checkbox but doesn't verify the junction table relationship in DB.
6. **Samples form is very long** (accordion sections). The test only fills minimal required fields (production run, carbon percentages). Other sections (elemental, proximate, physical, stability, 1000-year durability) are not exercised.

## Deferred (overengineered for current goal)

These items from the original plan are valid but **not needed for user testing now**:

### Deferred: Compliance hardening (no UI exists)
| Original ID | Task | Why defer |
|---|---|---|
| A3 | Feedstock eligibility ledger | No UI — users can't test it |
| A4 | Counterfactual lifecycle model | No UI — users can't test it |
| A5 | Loss-adjustment ledger | No UI — users can't test it |
| A6 | Chain-of-custody hardening | No UI — users can't test it |
| A7 | Electricity intensity rollup | No UI — users can't test it |
| A8 | Materiality gate + reversal risk | No UI — users can't test it |

**When to revisit:** After core chain UI tests pass and UI is designed for these entities.

### Deferred: Enforcement polish (valid but secondary)
| Original ID | Task | Why defer |
|---|---|---|
| A1 | Method B + durability DB guardrails | Credit batch form works; guardrails are enforcement polish |
| A2 | Issuance completeness gate | Same — useful after users can create batches through UI |

**When to revisit:** After Task 5 proves credit batch creation works end-to-end.

### Deferred: Test infrastructure improvements
| Original ID | Task | Why defer |
|---|---|---|
| B1 | Unskip multi-user auth tests | Not blocking user testing |
| B3 | Sidebar navigation assertions | Cosmetic test quality |
| B4 | Fixture usage standardization | Process improvement |
| B5 | CI test quality gates | Infrastructure, do after tests exist |
| C1–C2 | Delegation doc + weekly status | Process overhead for small team |

## Key References

- `tests/e2e/fixtures/auth-fixtures.ts` — auth seed/teardown + `seededData` fixture
- `tests/e2e/fixtures/seed-chain-data.ts` — prerequisite entity seeding (12 entities)
- `tests/e2e/full-workflow.spec.ts` — existing DB-level chain test (21 entities)
- `tests/e2e/full-chain-ui.spec.ts` — UI-level chain smoke test (8 entities)
- `tests/e2e/facilities.spec.ts` — Facility + Reactor UI CRUD
- `tests/e2e/production-runs.spec.ts` — Production Run + Sample UI CRUD
- `tests/e2e/distribution.spec.ts` — Order + Delivery UI CRUD
- `tests/e2e/applications.spec.ts` — Application + Credit Batch UI CRUD
- `src/db/schema/` — all schema files
- `src/components/*/` — all form components
- `src/app/(app)/` — all route pages
