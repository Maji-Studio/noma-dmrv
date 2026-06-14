# Consolidated Fix Execution Plan - 2026-06-13

## Purpose

This plan consolidates the browser QA plans and findings created on 2026-06-13 into an
execution-ready sequence. It is scoped to the current changed files plus the follow-on
fixes identified by today's QA passes.

The plan assumes the current branch already contains in-flight changes for:

- Shared slide-over panel state and animation.
- Position picker invalid-coordinate crash prevention.
- E2E maintenance for facility creation, full-chain UI creation, position picker bounds,
  and certification removal submit-boundary readiness.

This document is dated execution material. Keep evergreen product and architecture docs in
`docs/`; move or remove this plan when the work is complete.

## Current Changed Files

Application files:

- `src/app/globals.css`
- `src/components/forms/position-picker/position-picker-map.tsx`
- `src/components/ui/slide-over-panel/index.tsx`

Test files:

- `tests/e2e/certification-full-removal-submit.spec.ts`
- `tests/e2e/facilities.spec.ts`
- `tests/e2e/fixtures/certification-helpers.ts`
- `tests/e2e/full-chain-ui.spec.ts`
- `tests/e2e/position-picker.spec.ts`

Reference QA notes created today:

- `docs/archive/2026-06-13-full-browser-e2e-qa-results.md`
- `docs/archive/2026-06-13-operator-e2e-removal-ghg-plan.md`
- `docs/archive/2026-06-13-operator-qa-pass-3.md`
- `docs/archive/2026-06-13-operator-qa-pass-4.md`
- `docs/archive/2026-06-13-operator-qa-pass-5.md`
- `docs/archive/2026-06-13-data-integrity-authz-qa-pass.md`
- `docs/archive/2026-06-13-data-integrity-authz-qa-pass-2.md`
- `docs/archive/2026-06-13-facilities-related-records-ghg-qa-plan.md`
- `docs/archive/2026-06-13-frontend-ux-qa-pass.md`

## Execution Principles

- Work in small vertical phases. Each phase must leave the app runnable and the relevant
  browser path retested.
- Prefer existing layered flow: UI component -> hooks -> fn -> data-access -> db.
- Keep auth and authorization checks in `src/data-access/`.
- Do not surface raw database, provider, or internal stack details to the browser.
- Add focused regressions for every fixed bug, then run broader E2E only after targeted
  specs pass.
- Browser retesting is required after each UI or workflow phase, not only at the end.

## Phase 0 - Land And Prove The Current In-Flight Fixes

### Scope

This phase is limited to the files already changed.

### Fixes

1. Keep the slide-over state CSS in `src/app/globals.css`.
2. Keep `slide-over-panel-popup` on `SlideOverPanel.Content` in
   `src/components/ui/slide-over-panel/index.tsx`.
3. Keep the `mapPoint(...)` bounds guard in
   `src/components/forms/position-picker/position-picker-map.tsx`.
4. Keep the facility dialog viewport and close-cleanup assertions in
   `tests/e2e/facilities.spec.ts`.
5. Keep the invalid map-bounds regression in `tests/e2e/position-picker.spec.ts`.
6. Keep the full-chain facility timezone update in `tests/e2e/full-chain-ui.spec.ts`.
7. Keep the richer ready-batch fixture additions in
   `tests/e2e/fixtures/certification-helpers.ts`.
8. Keep the removal submit-boundary spec aligned to the current wizard step labels and
   `Submit removal` button.

### Acceptance Criteria

- Create facility sheet opens fully inside the viewport.
- Cancel hides the sheet and removes the dialog.
- Successful create hides the create sheet before any optional Isometric link dialog is
  handled.
- Position picker no longer crashes when latitude or longitude is outside valid map
  bounds.
- Full-chain UI spec creates a facility with timezone filled.
- Certification submit-boundary fixture reaches an enabled `Submit removal` button
  without requiring a live external submit by default.

### Targeted Retest

Run:

```bash
pnpm test:e2e tests/e2e/facilities.spec.ts
pnpm test:e2e tests/e2e/position-picker.spec.ts
pnpm test:e2e tests/e2e/full-chain-ui.spec.ts
pnpm test:e2e tests/e2e/certification-full-removal-submit.spec.ts
```

Browser retest:

- Open `/facilities`, click `New Facility`, verify the sheet is inside the viewport.
- Cancel and confirm no dialog remains.
- Reopen, create a facility, dismiss the optional Isometric dialog, and confirm the sheet
  does not remain mounted.
- Open a form with `PositionPicker`, enter latitude `91` and longitude `181`, and confirm
  no app error boundary appears.
- Check desktop and mobile/narrow widths.

## Phase 1 - Security And Correctness Blockers

### 1A. Date-Only Handling

Problem:

- Production run date shifts one day earlier on create and again on save.
- This is certification-relevant because run dates feed vintage, GHG periods, selectors,
  and operator audit trails.

Fix:

- Audit schemas for date-only inputs still using `new Date(value)` or timestamp parsing.
- Migrate production-run date create and update schemas to the existing date-only helper
  pattern used by feedstock delivery and other corrected forms.
- Normalize display to the chosen app date formatter after storage is corrected.

Regression tests:

- Create a production run with date D and assert list, detail, edit form, and DB-derived
  values still show D.
- Save the edit form without changes and assert the date remains D.
- Include at least one timezone behind UTC.

Browser retest:

- Create production run for `2026-06-13`.
- Verify the production runs list does not show `2026-06-12` or `12/06/2026` because of
  timezone drift.
- Edit and save without changes; verify the date does not compound-shift.

### 1B. Sanitized Action Errors

Problem:

- Several `fn/` catch blocks return `error.message`.
- Drizzle/Postgres failures can expose raw SQL, column names, params, and internal UUIDs
  to the browser.

Fix:

- Add a central helper, for example `toActionError(err, fallbackMessage)`, in the existing
  error utility layer.
- Preserve user-safe errors such as `SafeError` and validation failures.
- Return a generic stable message for unexpected errors.
- Log the full server-side error with structured IDs only. Do not log PII.
- Migrate high-risk mutation files first: production runs, storage locations,
  facilities, feedstocks, samples, deliveries, customers, orders, credit batches, and
  certification actions.

Regression tests:

- Trigger an integer overflow or FK rejection and assert the returned `ActionResult.error`
  does not include `Failed query`, SQL, params, table names, or raw UUID internals.
- Verify a deliberate `SafeError` still reaches the UI with its human message.

Browser retest:

- Attempt to delete an in-use storage bin.
- Confirm the UI shows a friendly dependency or generic failure message, not SQL.
- Attempt an out-of-range integer input and confirm field validation or sanitized error.

### 1C. Dependency Guards Before Delete

Problem:

- Some deletes rely on database FK failure rather than preflight dependency checks.
- The operator sees a generic or raw failure instead of actionable recovery guidance.

Fix:

- Add dependency count guards in data-access delete functions before mutation.
- Start with storage locations, customers, and deliveries.
- Throw `SafeError` with operator-actionable copy.
- Keep deletes transactional where follow-up resyncs are required.

Regression tests:

- In-use storage bin cannot be deleted and reports what blocks it.
- Customer with orders cannot be deleted.
- Delivery with applications cannot be deleted.

Browser retest:

- Confirm delete dialogs mention known dependencies where available.
- Confirm failed delete recovers cleanly without stale sheets or raw SQL.

### 1D. Isometric Provider Error Propagation

Problem:

- `IsometricApiError.body` is captured but dropped in logs, sync-event history, and the UI.
- GHG verifier submit fails with status `400`, but the operator cannot see why.

Fix:

- Special-case `IsometricApiError` in GHG submit handling.
- Log sanitized `{ status, body }`.
- Persist sanitized `responsePayload` or equivalent attempt detail for failed sync events.
- Surface a short human reason in the `SafeError`.
- Keep token, secret, authorization, and PII redaction intact.

Regression tests:

- Mock an Isometric 400 with a body and assert the sync event persists the sanitized body.
- Assert the UI error contains a useful reason, not only endpoint/status.

Browser retest:

- Submit a GHG statement to verifier with an invalid/disallowed report URL.
- Confirm the error explains the provider reason.
- Confirm attempt history includes actionable failure detail.

## Phase 2 - Data Integrity And State-Transition Guards

### 2A. GPS Pair Validation And Clearing

Problem:

- Facility create accepts half coordinates; update rejects later edits.
- Application GPS clearing can be silently ignored because cleared values become
  `undefined` and old values remain.

Fix:

- Use the paired-GPS schema in facility and application create/update flows.
- Attach errors to the GPS section or a specific coordinate path.
- Normalize intentionally cleared coordinate inputs to `null`.
- Update both coordinate columns together.

Regression tests:

- One coordinate provided without the other fails with a field-level error.
- Both coordinates cleared persist as `null`.
- Saving an unrelated edit is not blocked by hidden stale invalid GPS state after create.

Browser retest:

- Create facility with only latitude and confirm it is rejected.
- Edit application and clear both GPS fields; reload and confirm both are empty.
- Clear only longitude and confirm a field-level error appears.

### 2B. Active Facility After Facility Create

Problem:

- A newly created facility does not become the active facility context.
- Operators can immediately create child records under the previous facility.

Fix:

- Decide auto-switch versus explicit prompt.
- Recommended implementation: after successful create, set the new facility in query
  state and localStorage, then dismiss or scope the optional link dialog to that facility.
- Ensure the sidebar selector and route links update.

Regression tests:

- Create a facility and assert `?facility=` becomes the new facility id.
- Immediately create a reactor and assert it belongs to the new facility.

Browser retest:

- Create a facility.
- Confirm sidebar selector switches to it.
- Navigate to reactors and create one; confirm the reactor appears under the new facility.

### 2C. Cross-Parent And Cross-Facility Write Guards

Status: Completed 2026-06-14.

Completion notes:

- Added data-access guards so order create/update rejects a `customerLocationId` that
  belongs to a different customer.
- Chose the cross-facility credit-batch detail behavior: redirect the detail URL to the
  batch's actual `?facility=` before rendering the edit surface.
- Added focused regressions:
  - `tests/order-cross-parent-guard.test.ts`
  - `tests/e2e/credit-batch-facility-scope.spec.ts`
- Browser retested with a local authenticated admin session: direct navigation to a
  credit-batch detail URL with a wrong facility query redirected to the batch facility,
  rendered the expected batch/facility, and showed no app error boundary.

Problems:

- Orders can accept a `customerLocationId` belonging to a different customer.
- Credit-batch detail routes can show and edit records from another facility while the
  chrome shows the active facility.

Fix:

- In order create/update data-access, verify `customerLocation.customerId === customerId`.
- For facility-scoped detail routes, resolve decision issue #253:
  - either redirect/not-found when record facility differs from active `?facility=`, or
  - visibly switch/adopt the record's facility and make that state explicit.

Regression tests:

- Crafted order write with mismatched customer/location fails server-side.
- Cross-facility credit-batch detail URL follows the decided behavior.

Browser retest:

- Attempt normal order creation after changing customer; dependent location clears.
- Direct-nav cross-facility detail route and confirm no misleading edit surface remains.

### 2D. Production Run Complete State

Problem:

- A production run can be marked `Complete` with zero production data while the app also
  computes it is incomplete.

Fix:

- Resolve decision issue #254.
- If `Complete` is a gated operational state, enforce required preconditions server-side.
- If it remains decoupled from certification readiness, relabel or visually separate the
  operational state from readiness so it is not interpreted as certification complete.

Regression tests:

- Complete transition fails when required operational fields are missing, or confirms the
  chosen decoupled semantics explicitly.
- Stale two-tab save cannot bypass the server-side transition guard if gating is chosen.

Browser retest:

- Create a minimal run and attempt `Complete`.
- Verify either clear blocking feedback or explicit decoupled-state messaging.

### 2E. Certification Immutability Below Application

Status: Completed 2026-06-14.

Completion notes:

- Added a shared data-access lineage guard that re-derives whether an upstream
  record participates in a credit batch whose Removal or GHG Statement has a
  blocking certification submission.
- Guarded production run, sample, delivery, biochar product, and feedstock
  mutation boundaries, including adding a sample to an already locked production
  run.
- Added focused regressions in `tests/certification-lineage-guards.test.ts`
  covering production run dry-mass edits, production run deletion, sample edits,
  sample evidence deletion, delivery edits through a verifier-bound GHG
  Statement, biochar product edits, and feedstock edits.

Problem:

- Submitted removals are protected at credit batch/application layers, but upstream
  production run, sample, delivery, biochar product, and feedstock edits can desync live
  noma views from the immutable certification payload snapshot.

Fix:

- Centralize "is this upstream record linked to a blocking submitted removal?" checks.
- Re-derive linked batches/removals before upstream update/delete.
- Reject mutations when they would alter a submitted or verifier-bound artifact.
- Route legitimate corrections through the existing correction policy from #200.

Regression tests:

- Updating a sample used by a submitted removal is rejected.
- Updating production run dry mass used by a submitted removal is rejected.
- Deleting upstream evidence used by a submitted removal is rejected.

Browser retest:

- Open a submitted-removal chain and attempt upstream edits.
- Confirm blocking copy explains correction workflow.

## Phase 3 - Certification Workflow Clarity

### 3A. Resolve Open Certification Decisions

Open decisions:

- #245: zero-removal GHG statements.
- #246: list readiness badges versus removal wizard readiness gates.
- #247: local removal draft behavior when emission estimates are missing.

Execution:

- Decide each policy before final UI polish.
- Encode decisions in schemas/server actions where relevant, not only UI copy.
- Update tests to match the chosen policy.

Browser retest:

- Create GHG statement period with zero predicted removals.
- Verify the chosen block/acknowledgement path in Preview and Confirm.
- Attempt removal creation with missing emission estimates and confirm the chosen draft or
  pre-create block behavior.

### 3B. GHG Verifier Status In Lists

Problem:

- GHG list shows `Submitted` while verifier status remains `DRAFT` and submit attempts
  have failed.

Fix:

- Badge the row by the furthest blocking state, or show both registry status and verifier
  status.
- Ensure colors and labels follow the eventual #250 badge semantics.

Regression tests:

- A registry-created but verifier-draft statement does not read as terminal complete.

Browser retest:

- Open GHG statements list for a statement with failed verifier attempts.
- Confirm list status communicates pending/failed verifier state.

### 3C. Human Removal Labels

Problem:

- Removals are listed as truncated internal UUIDs.

Fix:

- Add a display label such as generated `RMV-YY-NNN`, registry `rmv_...`, or reporting
  period plus linked batch code.
- Prefer a stable searchable label.

Regression tests:

- Removal list and detail use the new display label.
- Internal UUID remains available only where needed for diagnostics, not primary UI.

Browser retest:

- Open certification removals with at least two removals and confirm they are
  distinguishable.

### 3D. Verifier Report UX

Problem:

- Submit-to-verifier requires raw URL paste with little guidance.

Fix:

- Prefer existing `FormFileUpload` storage flow for report upload.
- If URL remains supported, validate host/format early and show guidance.
- Link guidance to allowed host/report requirements without exposing secrets.

Regression tests:

- Uploaded report yields a usable URL for verifier submit.
- Invalid host is blocked before provider round trip if policy allows.

Browser retest:

- Upload or enter a verifier report and submit.
- Confirm success or provider error is actionable.

## Phase 4 - Restore Full Browser E2E Green

Status: Completed 2026-06-14.

Completion notes:

- Restored the red browser/E2E clusters without changing product behavior:
  - Chain of Custody and Carbon Viewer deep links now carry the active `facility=`
    scope in tests, matching the app's stale/foreign anchor clearing behavior.
  - Chain tests now follow the current node side-sheet and `Trace rollback`
    interactions instead of obsolete direct-link assumptions.
  - Dashboard assertions now expect the active facility heading and the `Pipeline`
    panel label.
  - Certification Settings tests target the ARIA `tab` controls and the current
    Settings-based facility/project management surface.
  - Applications CRUD uses the DataTable row's keyboard activation path, avoiding
    flaky pointer hits on nested interactive row content.
- Verification run:
  - Phase 4 targeted E2E cluster: `32 passed`.
  - `pnpm test:e2e`: `134 passed`, `2 skipped`.
  - `pnpm typecheck`: passed.
  - `pnpm lint`: passed with existing warnings only.
- Browser retested in the in-app browser against `http://localhost:3100`:
  - Dashboard rendered in facility scope with KPI strip and `Pipeline`.
  - Chain of Custody rendered the facility-scoped batch selector and empty state.
  - Certification Settings tabs switched between Connection, Emissions, and
    Environment without app errors.
  - Applications rendered the facility-scoped empty state and primary create action.

Known red clusters from today's full run:

- Chain of Custody / Carbon Viewer interactions.
- Position picker deterministic stub geocode/CALC expectations.
- Live certifier mapping/settings tests.
- Dashboard stale copy expectation.

Execution:

1. Run targeted specs for each failing cluster.
2. For each failure, classify as app regression, fixture drift, or obsolete test copy.
3. Fix app regressions first.
4. Update tests only when the product behavior is intentionally changed.
5. Re-run targeted specs.
6. Run full E2E.

Targeted retest examples:

```bash
pnpm test:e2e tests/e2e/chain-of-custody*.spec.ts
pnpm test:e2e tests/e2e/position-picker.spec.ts
pnpm test:e2e tests/e2e/certification*.spec.ts
pnpm test:e2e tests/e2e/dashboard*.spec.ts
pnpm test:e2e
```

Browser retest:

- Chain of Custody: DAG, map, Sankey, application drill-down, no-GPS state, and
  batch-to-application navigation.
- Position picker: stub geocode, reverse-geocode, CALC distance, no basemap fallback,
  invalid bounds.
- Certification settings: link, unlink, emissions tab, mapping sheet, stale state after
  save.
- Dashboard: current facility-specific heading and empty/populated states.

## Phase 5 - UX, Accessibility, And Design-System Cleanup

This phase should happen after correctness fixes so polish does not mask data issues.

### Cross-Cutting UI Consistency

Fix:

- Standardize date display behind one formatter.
- Standardize row action affordances and pagination.
- Standardize units and avoid uppercase transforms that mangle `kWh`.
- Standardize status badge labels and colors.
- Align footer CTA order across sheets and wizards.
- De-duplicate empty-state CTAs.
- Clear `create=true` after sheet close.

Browser retest:

- Visit standard list routes at desktop, tablet, and phone widths.
- Confirm primary actions, row actions, pagination, dates, units, and statuses are
  consistent.

### Chain Of Custody Responsiveness

Fix:

- Bring Chain of Custody closer to the canonical shell or document a deliberate tool-page
  variant.
- Replace bare text empty state with `EmptyState`.
- Add mobile fallback for DAG, such as Sankey default or vertical node list below `md`.
- Fix right-side facility label wrapping.

Browser retest:

- Test 390px, 768px, and desktop.
- Confirm DAG does not clip critical nodes or overlap controls.
- Confirm Sankey remains usable.

### Accessibility

Fix:

- Remove nested/duplicate interactive row controls.
- Ensure each row action menu appears once in the accessibility tree.
- Add labels to clickable GHG statement rows.
- Keep keyboard navigation complete for rows, menus, dialogs, and wizards.

Browser retest:

- Keyboard-only navigation through list rows, action menus, create sheets, confirmation
  dialogs, and certification wizard.
- Assert no unlabeled buttons in the GHG statement list.

## Final Verification Gate

Before declaring the execution complete:

1. Run typecheck and lint.
2. Run all targeted specs touched by the phases above.
3. Run full E2E.
4. Perform manual browser retest at desktop, tablet, and mobile widths for:
   - Facilities create/edit/delete.
   - Position picker invalid and valid coordinate flows.
   - Production run create/edit/complete.
   - Full chain creation path.
   - Credit batch readiness and removal wizard.
   - GHG statement create/refresh/submit-to-verifier failure path.
   - Chain of Custody DAG/Sankey/map.
5. Confirm no browser route throws a Next.js app error boundary.
6. Confirm no raw SQL, provider payloads with secrets, email addresses, or internal stack
   traces are visible to operators.
7. Confirm docs are either updated in evergreen locations or dated/archive notes remain
   clearly marked as execution artifacts.

## Suggested Work Order Summary

1. Finish and verify the current changed-file fixes.
2. Fix production-run date-only handling.
3. Add centralized sanitized action error handling.
4. Add delete dependency guards.
5. Propagate Isometric 400 body safely.
6. Unify GPS validation and clearing.
7. Fix active facility after create.
8. Add cross-parent guards. Completed 2026-06-14 for order customer/location writes and
   credit-batch detail facility canonicalization.
9. Resolve production-run state-transition policy issue #254 and implement the chosen
   `Complete` behavior. Skipped pending product decision.
10. Add certification immutability below application. Completed 2026-06-14 with
   upstream lineage guards for submitted Removal and GHG Statement artifacts.
11. Resolve certification policy issues #245, #246, #247 and implement the decisions.
12. Restore full E2E green. Completed 2026-06-14 with full E2E green and
   in-app browser retest.
13. Sweep UX and accessibility consistency.
