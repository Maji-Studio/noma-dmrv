# 2026-07-23 UI-only operational stress test

## Executive summary

The scheduled staging stress test could not reach GitHub Actions or noma-dmrv. Across three consecutive goal turns, the authorized visible Computer Use runtime reported that macOS was locked and could not unlock it automatically. The runtime explicitly required a manual unlock.

No browser page was opened, no credentials were entered, the user-run staging reset was not rerun or visibly confirmed, no staging record or document was created, and no source code was modified. Because the authoritative brief prohibits every non-visible fallback, every application test section is **untested**. This is an automation-environment blocker, not a confirmed noma-dmrv defect.

- Scheduled time: 02:00 Europe/Zurich
- Active run received: approximately 2026-07-23T08:24:33+02:00
- First blocked attempt: 2026-07-23T08:28:00+02:00 (first goal turn)
- Second blocked attempt: 2026-07-23T08:31:00+02:00 (second goal turn)
- Third blocked attempt and formal threshold: 2026-07-23T08:33:00+02:00 (third goal turn)
- Report completed: 2026-07-23T08:33:14+02:00
- Transport attempted: `mcp__node_repl__js` invoking the plugin-owned visible `@oai/sky` Computer Use runtime
- Application/GitHub interaction: none
- Source changes: none
- Synthetic staging data left in place by this run: none

## Findings ledger

### ENV-001 — Locked Mac prevents all visible UI execution

- **Severity:** P0 execution blocker (environment; not a product defect)
- **Type:** Reliability
- **User role and active facility:** Not reached; no login and no active facility
- **Route/screen:** macOS session before Chrome state could be acquired
- **Exact Computer Use reproduction:** (1) load the plugin-owned visible Computer Use wrapper; (2) request the full state of `com.google.Chrome`; (3) end the turn without bypassing the lock; (4) resume and repeat in two further consecutive goal turns
- **Input:** No credentials or application data entered
- **Expected:** Chrome becomes visibly available so the existing user-run GitHub reset can be confirmed before staging is opened
- **Actual:** Each attempt returned: “The Mac is locked and automatic unlock could not unlock it. Ask the user to unlock the Mac manually before continuing.”
- **Operator impact:** The complete reset confirmation and staging stress test could not start
- **Evidence:** Computer Use textual result on each turn; no screenshot was available because the runtime could not access the locked desktop
- **Reproducibility:** 3/3 attempts across three consecutive goal turns in the fresh 2026-07-23 blocked audit
- **Likely root cause:** Host desktop session was locked; repository source inspection is not applicable
- **Suggested fix:** Unlock the Mac before the automation window and keep the visible desktop session available; after resuming, first confirm the existing reset workflow and do not rerun it
- **Confidence:** High

No confirmed noma-dmrv defect, product observation, or product hypothesis was produced in this run.

## Section checklist

| Section | Result | Exact blocker |
| --- | --- | --- |
| GitHub Actions reset confirmation | Untested | Chrome inaccessible because macOS was locked; reset was not rerun |
| A. Empty-state onboarding | Untested | Browser UI inaccessible |
| B. Active-facility context and isolation | Untested | Browser UI inaccessible |
| C. Roles and permissions | Untested | Browser UI inaccessible; authorized account inventory not reached |
| D. Storage and inventory integrity | Untested | Browser UI inaccessible |
| E. Record lifecycle and dependency protection | Untested | Browser UI inaccessible |
| F. Documents and evidence | Untested | Browser UI inaccessible; no fixture uploaded |
| G. Tables, filters, and navigation | Untested | Browser UI inaccessible |
| H. Session and recovery behavior | Untested | Browser UI inaccessible |
| I. Dashboard, maps, and traceability consistency | Untested | Browser UI inaccessible |
| J. Accessibility and responsive behavior | Untested | Browser UI inaccessible |
| Visible console/network monitoring | Untested | DevTools could not be opened visibly |

## Two-facility isolation matrix

| Check | Facility A | Facility B | Cross-facility result | Status |
| --- | --- | --- | --- | --- |
| Create and configure | Not created | Not created | Not assessed | Untested |
| Active selector, headers, breadcrumbs | Not reached | Not reached | Not assessed | Untested |
| Facility-scoped master/operational data | Not reached | Not reached | Not assessed | Untested |
| Lists, selectors, counts, search | Not reached | Not reached | Not assessed | Untested |
| Refresh and back/forward persistence | Not reached | Not reached | Not assessed | Untested |
| Two-tab context behavior | Not reached | Not reached | Not assessed | Untested |
| Dependency selection isolation | Not reached | Not reached | Not assessed | Untested |
| Visible Facility A URL under Facility B context | Not reached | Not reached | Not assessed | Untested |
| Documents | Not reached | Not reached | Not assessed | Untested |
| Dashboards, maps, traceability | Not reached | Not reached | Not assessed | Untested |

Read-only preflight established that suppliers, customers, their locations, and feedstock types are intentionally organization-wide. A resumed run must not misclassify that visibility alone as facility leakage; facility-scoped records and facility-relative data remain the isolation targets.

## Role-permission matrix

Documentation identifies Platform Admin, Owner, Admin, and Member as the canonical roles. No live controls or additional authorized accounts could be inspected. No invitation was sent.

| Role | View | Create/edit | Delete/archive | Settings/members | Documents | Inventory | Certification | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Platform Admin | — | — | — | — | — | — | — | Untested |
| Owner | — | — | — | — | — | — | — | Untested |
| Admin | — | — | — | — | — | — | — | Untested |
| Member | — | — | — | — | — | — | — | Untested |

Exact blocker: Chrome never became visible, so the administration UI and authorized account inventory were not reached. Multi-role verification cannot be simulated through tokens, APIs, database changes, storage edits, or invitations.

## Storage reconciliation

No facilities, bins, stock, production, deliveries, applications, adjustments, or movements were created.

| Facility | Opening | Additions | Transfers out | Transfers in | Production consumption | Production output | Delivery/application consumption | Adjustments | Displayed ending | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Facility A | — | — | — | — | — | — | — | — | — | Untested |
| Facility B | — | — | — | — | — | — | — | — | — | Untested |

Expected equations and adversarial probes are documented in `docs/qa/artifacts/2026-07-23-ui-only-operational-stress/preflight-expectations.md`; they are not execution evidence.

## Record and document inventory

No organization, facility, entity, stock movement, attachment, invitation, registry submission, or external email was created in staging by this run.

The following existing local synthetic, non-sensitive fixtures were inventoried for a possible unlocked continuation. None was uploaded:

| Fixture | Local path | Size | Upload state |
| --- | --- | ---: | --- |
| Valid PDF | `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-valid-evidence.pdf` | 2,420 bytes | Not uploaded |
| Valid image | `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-valid-image.png` | 58,808 bytes | Not uploaded |
| Unsupported type | `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-unsupported.txt` | 206 bytes | Not uploaded |
| Empty file | `output/pdf/2026-07-22-ui-stress/qa-2026-07-22-empty.txt` | 0 bytes | Not uploaded |
| Duplicate filename A | `output/pdf/2026-07-22-ui-stress/duplicate-a/qa-duplicate-evidence.pdf` | 2,419 bytes | Not uploaded |
| Duplicate filename B | `output/pdf/2026-07-22-ui-stress/duplicate-b/qa-duplicate-evidence.pdf` | 2,421 bytes | Not uploaded |
| Valid sensor CSV | `docs/qa/artifacts/2026-07-21-staging-isometric/qa-only-synthetic-pr-26-001-readings.csv` | 721 bytes | Not uploaded |

## Lifecycle and dependency matrix

| Entity | Created | Edited/reloaded | Duplicate tested | Cancel/unsaved tested | Pre-dependency archive/delete | Post-dependency protection | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Facility | No | No | No | No | No | No | Untested |
| Reactor | No | No | No | No | No | No | Untested |
| Storage location | No | No | No | No | No | No | Untested |
| Supplier/location | No | No | No | No | No | No | Untested |
| Feedstock type | No | No | No | No | No | No | Untested |
| Feedstock intake | No | No | No | No | No | No | Untested |
| Customer/location | No | No | No | No | No | No | Untested |
| Production run | No | No | No | No | No | No | Untested |
| Biochar product | No | No | No | No | No | No | Untested |
| Order | No | No | No | No | No | No | Untested |
| Delivery | No | No | No | No | No | No | Untested |
| Application | No | No | No | No | No | No | Untested |

No destructive confirmation was reached. No deletion or archive action was taken.

## Document handling matrix

| Check | Result | Exact blocker |
| --- | --- | --- |
| Valid PDF upload | Untested | Browser and file picker inaccessible |
| Valid CSV upload/import | Untested | Browser and file picker inaccessible |
| Valid image upload | Untested | Browser and file picker inaccessible |
| Unsupported file | Untested | Browser and file picker inaccessible |
| Empty file | Untested | Browser and file picker inaccessible |
| Oversized file | Untested | Browser and file picker inaccessible; no safe visible limit reached |
| Duplicate filename, different content | Untested | Browser and file picker inaccessible |
| Progress/cancel/retry | Untested | Upload UI not reached |
| Refresh and logout/login persistence | Untested | Upload UI not reached |
| Open/download and metadata | Untested | Upload UI not reached |
| Draft removal and dependency protection | Untested | Upload UI not reached |
| Facility A/B document isolation | Untested | Facilities not created |

## Tables, filters, and navigation

No list was visible. Full/partial/no-match search, combined filters, clearing, sorting, pagination, list-state return, filtered creation, facility switch, filtered refresh, empty/loading states, count reconciliation, stale rows, links, raw UUIDs, and 404 handling are all untested because Chrome never opened.

## Session and recovery

Refresh mid-form, back/forward, wizard cancellation, ordinary idle continuation, logout with protected pages open, browser back after logout, signed-out deep links, post-login redirects, two-tab drafts, corrected validation failures, and naturally occurring retry behavior are all untested. No session or browser state was manipulated.

## Dashboard, maps, and traceability

Headline counts, warnings, readiness wording, wet/dry labels, GPS points, independent facility maps, DAG, Map, Sankey, Trail, node links, quantities, partial-lineage states, and cross-facility traceability isolation are all untested. No app route was visible.

## Accessibility and responsive behavior

Keyboard form completion, focus visibility, tab order, Escape behavior, focus return, field/error/unit labels, keyboard dropdowns, laptop/narrow viewports, clipping, 200% zoom, non-color status cues, and icon naming are all untested. The blocker occurred before any window content or screenshot could be inspected. This report makes no WCAG claim.

## Console errors and failed requests

None were observed because Chrome and visible DevTools were inaccessible. This does not imply that none exist. No direct network, API, browser evaluation, DOM, console, or storage inspection was used.

## Five most important fixes

No evidence-based noma-dmrv product fix list can be produced without observing the product. Inventing five product fixes would violate the evidence contract. The only substantiated remediation is environmental:

1. Unlock and keep the Mac desktop session available before the scheduled automation window.

Items 2–5 are intentionally not fabricated. Product priorities require a completed visible run.

## Risk and UX conclusions

- **Single worst security/scoping risk:** Not assessed; two-facility UI interaction never began.
- **Single worst operator-experience gap:** Not assessed; onboarding never became visible.
- **Quick UX fixes:** Not determined.
- **Changes requiring product decisions:** Not determined.
- **GitHub issue/PR deduplication:** Not performed because GitHub must be inspected through the unavailable visible browser.
- **External registry submissions:** None.
- **Invitations or external email:** None.

## Untested steps and exact blocker

Every GitHub Actions, application, onboarding, isolation, permission, inventory, lifecycle, document, table, session, dashboard, map, traceability, responsive, accessibility, and visible-console/network step is untested because the visible Computer Use runtime could not access the locked Mac. Playwright, Selenium, Puppeteer, Cypress, browser scripting/evaluation, DOM inspection, APIs, direct network calls, database/ORM/SQL access, session/cookie/storage manipulation, seeded fixtures, and authentication bypasses were not used as substitutes.

## Computer Use attestation

The only attempted application/GitHub transport was the user-authorized `mcp__node_repl__js` → plugin-owned `@oai/sky` visible Computer Use runtime. It failed before any application or GitHub interaction occurred. All three attempts used that transport; no prohibited fallback was used.

## Final verdict

**Production-blocking from a release-evidence standpoint.** This is not a product-quality verdict: noma-dmrv is unassessed in this run. Routine-use safety cannot be established until the full brief is executed after the Mac is manually unlocked.
