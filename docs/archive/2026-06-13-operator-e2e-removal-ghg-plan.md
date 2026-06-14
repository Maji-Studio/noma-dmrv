# Operator E2E Removal/GHG Audit Plan - 2026-06-13

## Scope

Local app: `http://localhost:3100`
Database: reset before the run with `pnpm db:reset`
Registry mode: Isometric sandbox
Facility created from scratch: `Operator Facility mqceboe4` (`f346545f-ac5e-4642-95f1-9110458012f1`)

The browser pass visited the empty-state routes first, then repeated the operational routes after creating data:

`/`, `/dashboard`, `/facilities`, `/chain-of-custody`, `/feedstocks`, `/production-runs`, `/formulations`, `/biochar-products`, `/reactors`, `/storage-locations`, `/energy`, `/suppliers`, `/customers`, `/orders`, `/deliveries`, `/applications`, `/credit-batches`, `/samples`, `/certification`, `/certification/removals`, `/certification/ghg-statements`, `/certification/settings`, `/admin`, `/admin/users`, `/admin/emission-estimates`, `/quick-add-demo`, `/styleguide`, `/schema`, `/schema/links`, `/schema/facilities`, `/unauthorized`.

No route crashed and no Next.js error overlay appeared. `/admin/emission-estimates` redirected to `/certification/settings`.

## Created Data

- Supplier, customer, customer location, feedstock type, three storage bins, reactor.
- Feedstock intake, production run `PR-26-001`, production reading, sample, biochar product, order, delivery `DL-26-001`, application `AP-26-001`, credit batch `CB-26-001`.
- Facility linked to Isometric project `prj_1K9YJ33RKSBX9FFF`.
- Default removal template set to `rvt_1KS4S43VPSBXA26X`.
- Emission estimates saved through Certification Settings -> Emissions.

## Certification Outcome

- Removal `12dba0ff-533c-46da-8aca-ac57f5011324` was created and submitted to sandbox as `rmv_1KV0MSWNWSBX7JDC`.
- Existing GHG statement `ggs_1KT97JMH1SBXJDR4` initially had 0 linked removals because it was created before the removal was submitted.
- Refreshing the GHG statement status reconciled it to `Linked removals (1)` and linked `rmv_1KV0MSWNWSBX7JDC`.
- Submitting the GHG statement to verifier failed with Isometric `POST /ghg_statements/ggs_1KT97JMH1SBXJDR4/submit -> 400` using both a fixture URL and a public PDF URL.

Coverage caveat: the application geotagged photo evidence row was inserted directly as a DB fixture because the in-app browser controller cannot drive the native file picker. The removal wizard consumed the same `documents` metadata path that production upload writes.

## Fix Plan

| Priority | Area | Finding | Proposed fix |
| --- | --- | --- | --- |
| P0 | Dates | Date-only fields shifted one day earlier in production run and downstream selectors. Entered `2026-06-13`; production run showed `2026-06-12` and DB stored a UTC-shifted timestamp. | Treat operator-entered date-only values as date-only throughout forms, mutations, and display. Prefer `date` columns or explicit noon/local parsing where a timestamp is unavoidable. Add regression tests across production run, biochar product, delivery, application, and credit batch selectors. |
| P0 | GHG submit | GHG statement verifier submit fails with Isometric `400` after a removal is linked. The UI surfaces only the endpoint/status. | Capture and surface provider error body, log a non-PII structured error, and add a sandbox-contract test for the submit payload/report URL requirements. |
| P0 | Readiness | List badges said Delivery and Application were "Ready", while the removal wizard blocked on delivery truck weighing and application geotagged evidence. | Use one shared readiness source for entity badges and removal wizard gates, or explicitly label list badges as "entity-local ready". |
| P0 | Removal submit preconditions | The wizard created a local removal before emission estimates were configured, then blocked external submit later. | Show emission-estimate readiness before local removal creation, or allow draft creation but make the draft state explicit and actionable. |
| P1 | Certification settings | Linking an Isometric project saved in DB, but the settings UI remained unlinked until reload. | Invalidate/refetch the facility mapping query after link/save and keep the side panel state in sync. |
| P1 | GHG workflow | The app allowed creating and submitting a GHG statement with 0 linked removals. It later reconciled after Refresh, but only because a removal was submitted afterward. | Decide whether zero-removal statements are allowed. If allowed, make the warning stronger and explain the refresh/reconcile model. If not, block create/submit. |
| P1 | GHG period validation | `2026-07-31` was rejected as overlapping an existing statement ending `2026-06-30`; `2026-08-31` advanced. | Fix stale/incorrect overlap validation and add tests around adjacent and later period ends. |
| P1 | Navigation/copy | Submit errors point operators to "Admin area (Emission estimates)", while `/admin/emission-estimates` redirects to Certification Settings. | Either restore a real admin route or update all copy to "Certification Settings -> Emissions". |
| P1 | Delivery edit | Delivery edit opened with the date input blank even though the row displayed `Jun 13, 2026`. | Normalize delivery date default values in edit forms and add a regression test. |
| P1 | Async selectors | Newly created/selectable entities often appeared late: storage bins, feedstock source bin, production run, and product bin selectors showed no options briefly after dependencies changed. | Add loading/refresh states and query invalidation after create/select flows. Prevent "no options" from displaying while dependent queries are still fetching. |
| P1 | Evidence UX | The app does not provide a direct path from the removal wizard blocker to uploading application evidence or entering delivery truck weights. | Make each blocker actionable with deep links to the exact entity and section, not just the batch page. |
| P2 | Removal preview | Ready batch preview showed `Weight -` and `CO2e stored -`; confirm step showed `0.0 t CO2e`. | Investigate whether lab/sample inputs, credit weight, or CO2e calculation were incomplete despite readiness passing. |
| P2 | Empty states | Several empty routes show duplicate "New" actions, especially Removals and other table plus empty-card combinations. | De-duplicate primary actions per empty state or make secondary actions visually subordinate. |
| P2 | Operator copy | Feedstock allocation displayed `0 kg remaining` for an empty destination bin, which reads like an unavailable destination. | Reword destination-bin availability separately from source-bin remaining mass. |

## Decision Items

1. Should the product allow a GHG statement to be created/submitted when predicted linked removals is 0? GitHub: https://github.com/Maji-Studio/noma-dmrv/issues/245
2. Should list-level certification badges include cross-entity/removal gates, or should they stay entity-local with clearer labels? GitHub: https://github.com/Maji-Studio/noma-dmrv/issues/246
3. Should the removal wizard block before local removal creation when emission estimates are missing, or intentionally create a draft removal and guide the operator to finish setup? GitHub: https://github.com/Maji-Studio/noma-dmrv/issues/247

## Verification To Add

- Playwright E2E fixture for a full clean-db operator chain through submitted removal and GHG reconciliation.
- Browser/file-upload coverage for application geotagged evidence, or an explicit test fixture API that mirrors upload metadata.
- Integration test for GHG submit-to-verifier payload and provider error rendering.
- Unit/integration tests for date-only parsing and display across all operational forms.
