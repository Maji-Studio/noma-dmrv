# noma-dmrv UI-only operational stress test — blocked run

**Run date:** 2026-07-19  
**Scheduled start:** 02:00 Europe/Zurich  
**Execution attempts:** 04:01–04:08, 04:12–04:13, and 04:14 Europe/Zurich  
**Environment:** staging  
**Automation:** `noma-dmrv-ui-only-operational-stress-test`

## Executive summary

The authorized UI-only test could not begin because the Mac was locked. The approved bundled `@oai/sky` Computer Use runtime initialized successfully, but the initial display-name and bundle-ID attempts plus two resumed bundle-ID attempts to inspect Chrome returned: **“The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.”**

No GitHub Actions or noma-dmrv page was opened. The user-run staging reset was not rerun and could not be visibly confirmed. No staging record, document, stock movement, role, session, or external state was changed. No prohibited browser, API, database, session, or authentication method was substituted.

This is an execution-environment blocker, not a confirmed noma-dmrv defect. The complete operational verdict is therefore **Production-blocking for release sign-off (untested)**: this does not assert a product P0; it means the required evidence does not exist and the test must be rerun after the Mac is manually unlocked.

## Findings ledger

There are **no confirmed application defects** from this run because the application was never reached.

| ID | Severity | Type | Role / facility | Route / screen | Reproduction | Expected | Actual | Impact | Evidence | Reproducibility | Root cause | Suggested action | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BLOCK-001 — Locked Mac prevents authorized Computer Use | Blocker (environment; not product severity) | Reliability / test infrastructure | Staging admin / none | Before Chrome access | 1. Initialize the plugin-owned Computer Use wrapper. 2. Call visible Chrome state using `Google Chrome`. 3. Retry using `com.google.Chrome`. 4. Resume twice and retry `com.google.Chrome` once per continuation. | Chrome becomes visible so GitHub Actions and staging can be operated through the approved UI path. | All attempts report that the Mac is locked and automatic unlock failed. | The entire UI-only protocol is untestable; no reset confirmation, onboarding, evidence, or verdict can be produced. | Verbatim Computer Use runtime message quoted above; screenshot unavailable because locked state prevents app capture. | 4/4 attempts across three consecutive goal turns | Host lock state; no application code was executed. | Manually unlock the Mac, keep the logged-in browser session available, then rerun this automation from the reset-confirmation step. | High |

## Section checklist

| Section | Result | Exact blocker |
|---|---|---|
| Visible GitHub Actions reset confirmation | Untested | Chrome inaccessible while Mac is locked. |
| A. Empty-state onboarding | Untested | Staging could not be opened. |
| B. Active-facility context and isolation | Untested | No facilities could be created. |
| C. Roles and permissions | Untested | Admin UI inaccessible; no additional authorized accounts were supplied in this run. |
| D. Storage and inventory integrity | Untested | No operational records could be created. |
| E. Lifecycle and dependency protection | Untested | No representative entities could be created. |
| F. Documents and evidence | Untested | No visible file picker could be opened. |
| G. Tables, filters, and navigation | Untested | Staging UI inaccessible. |
| H. Session and recovery | Untested | Login and protected pages inaccessible. |
| I. Dashboard, maps, and traceability | Untested | No facility lineage could be created. |
| J. Accessibility and responsive behavior | Untested | No application screen could be inspected. |

## Two-facility isolation matrix

| Check | Facility A | Facility B | Cross-facility outcome |
|---|---|---|---|
| Facility creation and persistence | Untested | Untested | Untested |
| Scoped child records and selectors | Untested | Untested | Untested |
| Tables, dashboard counts, maps, and traceability | Untested | Untested | Untested |
| Refresh, back/forward, and multi-tab selection | Untested | Untested | Untested |
| Visible deep link after context switch | Untested | Untested | Untested |
| Document isolation | Untested | Untested | Untested |

## Role-permission matrix

Visible execution was blocked. Read-only source reconnaissance established the expected roles but is not test evidence:

| Capability | Member | Organization Admin | Owner | Platform Admin | Visible result |
|---|---:|---:|---:|---:|---|
| Operational view/create/edit/delete or archive | Expected yes | Expected yes | Expected yes | Expected yes | Untested |
| Documents and inventory adjustments | Expected yes | Expected yes | Expected yes | Expected yes | Untested |
| View organization roster | Expected yes | Expected yes | Expected yes | Expected yes | Untested |
| Invite/change roles/remove/revoke | Expected no | Expected yes | Expected yes | Expected yes | Untested; invitations were not sent |
| Registry-facing submission mutations | Expected no | Expected yes | Expected yes | Expected yes | Untested; external submission remains out of scope |
| Global administration / enter any organization | Expected no | Expected no | Expected no | Expected yes | Untested |
| Registry credentials, facility link, emissions/health management | Expected no | Expected no | Expected no | Expected yes | Untested |

Canonical source references: `CONTEXT.md:431` and `CONTEXT.md:441`; `requireOrgRole` and `requirePlatformAdmin` in `src/lib/auth/server.ts:217-232`; `inviteMemberAction`, `revokeInvitationAction`, `changeMemberRoleAction`, and `removeMemberAction` (each guarded by `requireOrgRole(ctx, "admin")`) in `src/fn/organizations.ts:129-210`; and `requireAdminAction` guards in `src/fn/certification/facility-mapping.ts:136-225`.

## Storage reconciliation

No stock-bearing records or movements were created.

| Facility | Opening | Additions | Transfers out | Transfers in | Production consumption | Delivery/application consumption | Adjustments | Displayed ending | Reconciled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Facility A | — | — | — | — | — | — | — | — | Untested |
| Facility B | — | — | — | — | — | — | — | — | Untested |

Read-only research indicates the current visible reconciliation model is expected to expose append-only stock-take and documented-loss movements, while no operator transfer path was found. This is a test target, not a finding.

## Created-record and document inventory

| Kind | Count | Details |
|---|---:|---|
| Organizations | 0 | None created |
| Facilities | 0 | None created |
| Operational/domain records | 0 | None created |
| Documents | 0 | None uploaded |
| Stock movements | 0 | None recorded |
| Invitations/emails | 0 | None sent |
| External registry submissions | 0 | None attempted |

## Lifecycle and dependency matrix

| Entity | Create | Immediate list/detail | Edit/cancel/refresh | Delete/archive before dependency | Protection after dependency |
|---|---|---|---|---|---|
| Facility | Untested | Untested | Untested | Untested | Untested |
| Reactor | Untested | Untested | Untested | Untested | Untested |
| Storage location | Untested | Untested | Untested | Untested | Untested |
| Supplier / location | Untested | Untested | Untested | Untested | Untested |
| Feedstock type / feedstock | Untested | Untested | Untested | Untested | Untested |
| Customer / location | Untested | Untested | Untested | Untested | Untested |
| Production run | Untested | Untested | Untested | Untested | Untested |
| Biochar product | Untested | Untested | Untested | Untested | Untested |
| Order / delivery / application | Untested | Untested | Untested | Untested | Untested |

## Console errors and failed requests

Chrome and DevTools were inaccessible. No application console or network observation was possible. No failed application request was generated.

## Priority on rerun

These are read-only reconnaissance targets, not confirmed defects:

1. Verify the user-run reset visibly before opening staging; do not rerun it.
2. Exercise facility-context behavior because same-organization detail reads may authorize by organization while the UI owns facility-context clarity.
3. Reconcile facility summaries against storage details after stock-take/loss and deliveries; source paths derive those totals differently.
4. Verify zero-byte upload rejection and upload cancel/retry behavior through visible controls.
5. Verify product transfers are actually absent before reporting the transfer requirements unavailable.

The worst potential security/scoping risk remains **cross-facility ambiguity or stale Facility A data while Facility B is active**, but it is only a hypothesis until reproduced through the visible UI.

The worst potential operator-experience gap remains **missing or non-discoverable operational stock transfer controls**, also unconfirmed through the visible UI.

## Quick UX fixes versus product decisions

No fix is recommended from this blocked run. UI-visible evidence is required before separating quick fixes from product decisions.

## Untested steps and resumption point

All application sections are untested because the Mac must be manually unlocked. Resume at the first permitted UI action: open the existing Chrome session, navigate visibly to GitHub Actions, locate the user-run staging reset, and confirm its successful completion before opening staging.

## Interaction-method confirmation

- Approved Computer Use transport: initialized through the plugin-owned `@oai/sky` wrapper.
- Application/GitHub Actions interaction performed: none; Chrome was inaccessible.
- Prohibited browser automation, DOM scripting/inspection, API/network calls, database/ORM/SQL access, session manipulation, seeded fixtures, and authentication bypasses: **not used**.
- Source/CLI inspection: read-only expected-behavior research only; it was not used to access the application or discover hidden routes.
