# Full Browser E2E QA Plan and Results - 2026-06-13

## Scope

Local app: `http://localhost:3100`

Run type: browser-based operator QA using a newly created facility and authenticated app UI. The pass must not bypass application authentication or authorization checks.

Prior decision issues already identified and not to duplicate:

- GitHub #245: Decide policy for zero-removal GHG statements.
- GitHub #246: Decide certification readiness semantics for list badges vs removal gates.
- GitHub #247: Decide removal draft behavior when emission estimates are missing.

## Tested Routes

Visited in the in-app browser against the existing operator facility unless noted. No route-level Next.js error boundary appeared after the slide-over fix.

- `/`
- `/login`
- `/dashboard`
- `/facilities`
- `/chain-of-custody`
- `/feedstocks`
- `/production-runs`
- `/formulations`
- `/biochar-products`
- `/reactors`
- `/storage-locations`
- `/energy`
- `/suppliers`
- `/customers`
- `/orders`
- `/deliveries`
- `/applications`
- `/credit-batches`
- `/samples`
- `/certification`
- `/certification/removals`
- `/certification/ghg-statements`
- `/certification/settings`
- `/admin`
- `/admin/users`
- `/admin/emission-estimates`
- `/quick-add-demo`
- `/styleguide`
- `/schema`
- `/schema/links`
- `/schema/[table]`
- `/unauthorized`

New empty facility checked with `QA Raw Facility qaaek723` (`170b41a0-75c6-4d24-9be9-62dd27b53bdd`):

- `/dashboard`
- `/chain-of-custody`
- `/feedstocks`
- `/production-runs`
- `/formulations`
- `/biochar-products`
- `/reactors`
- `/storage-locations`
- `/energy`
- `/orders`
- `/deliveries`
- `/applications`
- `/credit-batches`
- `/samples`
- `/certification/removals` -> redirected to `/certification/settings`
- `/certification/ghg-statements` -> redirected to `/certification/settings`
- `/certification/settings`

## Tested Workflows

Attempted/verified:

1. Protected-route/auth coverage: full Playwright suite verified unauthenticated redirects for protected routes and public `/login`/`/unauthorized`.
2. Facility creation: initially blocked by the shared slide-over being translated offscreen; fixed locally in `src/components/ui/slide-over-panel/index.tsx`, then created `QA Raw Facility qaaek723` through the in-app browser using raw key events.
3. Facility context: selected the new facility through the sidebar selector; verified sidebar route hrefs carried `facility=170b41a0-75c6-4d24-9be9-62dd27b53bdd`.
4. New-facility empty states: visited production, infrastructure, distribution, verification, energy, and certification routes with no child records.
5. Existing complete operator data: visited the prior operator facility routes containing feedstock, production run, product, order, application, credit batch, submitted-removal/GHG data from the previous audit plan.
6. Certification gating: unlinked new facility hides Removals/GHG nav and direct operational certification URLs redirect to Settings with the link-project blocker.
7. Browser automation suite: ran `pnpm test:e2e`; latest result after fixes was 122 passed, 11 failed, 2 skipped.
8. Core clean browser workflow: `tests/e2e/full-chain-ui.spec.ts` now passes after filling the required facility timezone, covering UI creation of the 8 core operational entities.
9. Removal submit-boundary workflow: `tests/e2e/certification-full-removal-submit.spec.ts` now passes to the enabled sandbox `Submit removal` boundary without posting externally by default. The ready-batch fixture was updated to include current readiness evidence: telemetry, fuel/electricity fields, truck weighing, and geotagged application evidence.
10. Shared slide-over workflow: verified create drawer opens inside the viewport and Cancel removes the dialog in E2E. The in-app browser also exposed an intermediate blank-panel close regression while fixing the offscreen bug; that is covered by the new regression.
11. Final GHG statement surface: existing operator facility loaded `/certification/ghg-statements` with `Statements (1)`, `1 removal`, registry record `ggs_1KT97JMH1SBXJDR4 · v1`, and status `Submitted`. Refresh preserved the statement row.
12. GHG statement create drawer: opened in browser, Cancel returned to the list. The drawer still shows `Required` immediately on initial render. Native date input automation was unreliable in the in-app browser, so later-period advancement was not treated as a confirmed app failure in this pass.

## Edge Cases Intended Before Testing

- Protected-route redirects when signed out; direct access to admin and certification routes.
- Facility context preservation across sidebar navigation, direct URLs, refresh, browser back/forward, and stale `?facility=` query params.
- New facility with no child data to verify facility-scoped empty states without resetting the database.
- Required-field validation on every creation form before filling values.
- Invalid text formats: malformed email/phone-like fields, long names, duplicate-ish names/codes where code is generated.
- Numeric boundaries: `0`, negative values, very large values, decimals where integers are expected, percentages at `0`, `100`, and `100.1`.
- Date boundaries: today, future dates, reversed start/end ranges, adjacent GHG statement periods, and refresh after date entry.
- Dependent selectors after changing facility/type/customer; stale selected values must clear.
- Quick-add from entity selects, then immediate use of the newly created entity.
- Navigation away/cancel/refresh while forms are open or after partial edits.
- Edit existing records and confirm list/detail values refresh without stale rows.
- Removal/deletion/archive attempts for standalone records and records referenced by downstream entities.
- Feedstock split allocation over delivered mass and truck arrival/departure inconsistencies.
- Production run complete status with missing certification-tagged fields.
- Sample/lab percent boundaries above 100 and missing required lab data.
- Delivery/order/application mass inconsistencies and missing application evidence.
- Credit batch date overlap, reversed date range, empty application selection, and durability option requirements.
- Certification unlinked-facility gating, linked settings stale state, missing emission estimates, removal wizard blockers, zero-removal GHG behavior, GHG refresh reconciliation, and final submit-to-verifier error display.
- Loading and error states while changing filters quickly or refreshing during asynchronous selector loads.
- Authorization gaps: viewer/non-admin ability to see or mutate admin-only surfaces where test access permits.

## Bugs Found

| Severity | Finding | Evidence | Suggested owner area |
| --- | --- | --- | --- |
| P0 fixed | Shared slide-over panels mounted offscreen and were not pointer-accessible. | Initial `Create Facility` dialog computed `translate: 100%`, `x=1265`, `right=1905` in a `1280px` viewport. Fixed with explicit panel state CSS and regression coverage for open geometry plus Cancel cleanup. | Frontend UI infrastructure |
| P0 fixed | Invalid latitude/longitude could crash the app before form validation. | Entering latitude `91` and longitude `181` triggered MapLibre `Invalid LngLat latitude value` and the app error boundary. Fixed by guarding map points before creating/updating the marker. | Forms/geo |
| P1 | Chain of Custody / Carbon Viewer interactions remain regressed or stale. | Latest full suite failures: Carbon Viewer map rail missing, no-GPS empty state missing, application deep-link missing feedstock node, reactor graph node no longer exposes an anchor, batch-to-application drilldown timed out. | Chain of Custody |
| P1 | Position picker stub geocode/CALC values no longer match expected deterministic fixtures. | E2E expected Dodoma `-6.163` and distance `475.5`, but received `-7.29067` and `451.4`. | Geo/forms |
| P1 | Live certifier mapping/settings tests are still failing. | Latest full suite failures: linked Isometric project settings timed out on the Emissions tab; facility certifier mapping side-sheet assertions failed; unlink flow timed out waiting for the Unlink action. | Certification/Isometric |
| P2 | Dashboard E2E expects stale heading copy. | Test expects a heading matching `Carbon removal`; current dashboard H1 is facility-specific. | Test infrastructure |
| P2 | Empty states still duplicate primary actions. | New empty facility showed repeated `New/Create` buttons on Feedstocks, Production Runs, Formulations, Products, Reactors, Orders, Deliveries, Applications, and Samples. | UX/design system |

The original full-chain UI smoke failure was test maintenance rather than an app bug: the screenshot showed the facility form correctly blocking submit because the required Timezone field was not filled. The spec was updated and now passes.

## UX Issues Found

- Side-sheet animation failure made the app appear interactive while the actual form was mostly offscreen. This is a severe UX blocker for all create/edit flows using the shared sheet.
- The GHG statement create drawer displays `Required` before the operator touches or submits the period-end field.
- Required fields display `Required` text immediately in some forms before submit/touch, making the initial state read like the user has already made mistakes.
- Empty states frequently show both a header CTA and an empty-state CTA with the same label; several table empty states expose the duplicate action twice to assistive/automation surfaces.
- The optional post-facility-create `Link Isometric project` dialog appears immediately after facility creation. It is useful, but it interrupts the basic "create facility then inspect empty state" path and should offer clearer "skip for now" framing.
- New unlinked facility certification behavior is directionally correct, but the redirect takes long enough that a quick check can momentarily see a contentless GHG route.
- Chain of Custody copy/affordances are inconsistent: the page says clicking an application card traces rollback, while the current component opens a detail sheet and exposes `Trace rollback` as a second action.

## Engineering Risks Found

- Browser-level E2E is currently red: 11 failed of 135. The failures cluster around Chain of Custody/Carbon Viewer, live Isometric mapping/settings, position picker fixtures, and stale dashboard copy.
- The app has several generated/fixture-backed flows where tests can pass database integrity while browser workflows are stale. Example: database traceability chain specs passed, but Chain of Custody browser views did not render the seeded lineage.
- Shared slide-over infrastructure affects nearly every entity CRUD form; regressions there have very high blast radius.
- Position picker previously sent invalid coordinates to MapLibre before Zod/RHF validation could protect the component tree; a focused regression now covers the invalid-bounds path.
- Existing security tests still skip cross-user/project authorization scenarios; this is consistent with the current single-org/shared-data decision, but the skipped tests should be rewritten or removed to match the documented model.
- Final GHG behavior still depends on open decision issues #245, #246, and #247.

## Recommended Fixes

1. Keep the slide-over panel state CSS and regression coverage. Any future panel animation change should verify both open geometry and close cleanup.
2. Keep the `PositionPickerMap` out-of-range guard, then add user-facing validation copy so invalid coordinates explain the problem without relying only on schema submit errors.
3. Fix or intentionally update Chain of Custody/Carbon Viewer interaction contracts: direct card drilldown vs detail-sheet trace action, graph node full-record links, map rail rendering, and no-GPS empty state.
4. Reconcile position-picker stub fixtures with current geocoder/routing behavior, or update deterministic fixtures and tests if the new coordinates/distances are intentional.
5. Stabilize live certification mapping/settings tests. The removal submit-boundary path now passes; mapping side-sheet/settings tab flows still time out or assert stale sheet content.
6. Update dashboard E2E copy expectations to the current facility-specific dashboard H1, or restore a visible `Carbon removal` heading if that copy is required.
7. De-duplicate empty-state CTAs across table/list routes.
8. Do not treat final GHG create/submit policy as complete until issues #245-#247 are decided or explicitly accepted.

## Severity and Suggested Owner Area

| Severity | Owner area | Items |
| --- | --- | --- |
| P0 fixed | Frontend UI infrastructure | Slide-over offscreen transform and close cleanup covered by regression tests. |
| P0 fixed | Forms/geo | Invalid coordinate crash in `PositionPickerMap` covered by regression test. |
| P1 | Chain of Custody | Carbon Viewer rail/empty state, deep-link graph completeness, drilldown/link affordance consistency. |
| P1 | Certification/Isometric | Live Settings/mapping flows still red; removal submit-boundary fixed. |
| P1 | Test infrastructure | Position-picker deterministic fixtures and dashboard copy expectations. |
| P2 | UX/design system | Duplicate empty-state CTAs and immediate required-field copy. |

## Verification Summary

- `pnpm typecheck` -> passed.
- `pnpm lint` -> passed with existing warnings.
- `pnpm test:e2e` -> failed: 122 passed, 11 failed, 2 skipped.
- `pnpm test:e2e tests/e2e/facilities.spec.ts` -> passed.
- `pnpm test:e2e tests/e2e/full-chain-ui.spec.ts` -> passed.
- `pnpm test:e2e tests/e2e/certification-full-removal-submit.spec.ts` -> passed.
- `pnpm test:e2e tests/e2e/position-picker.spec.ts -g invalid` -> passed.
- In-app browser route audit -> completed for all listed routes; no route-level error boundary after the slide-over fix.
- New facility created via browser UI: `QA Raw Facility qaaek723`.
- New facility empty states -> completed for core facility-scoped routes.
- Existing operator final GHG statement -> verified route renders one submitted statement with one linked removal after refresh.
- New facility through external final GHG statement submission -> not completed in this pass. Core operational UI creation and removal submit-boundary were verified, but external GHG create/submit policy remains constrained by the existing decision issues #245-#247 and live registry behavior.

## GitHub Decision Issues

No new product/architecture decision issue was created in this pass. Existing decision issues remain open:

- #245 Decide policy for zero-removal GHG statements.
- #246 Decide certification readiness semantics for list badges vs removal gates.
- #247 Decide removal draft behavior when emission estimates are missing.
