# Issue and merged-change dedup — QA-B `d3f5`

No GitHub issue was created or modified.

## Finding dedup decisions

| Finding | Existing issue / PR | Decision |
|---|---|---|
| QA-B-D3F5-001 — branch-local Tailwind compile failure | None of requested issues | New branch-local regression; resolved concurrently during run, not active at handoff. |
| QA-B-D3F5-002 — allocation exceeds received mass | #40 is adjacent but does not describe intake allocation sum > delivery | New distinct feedstock-ingress invariant defect. |
| QA-B-D3F5-003 — organic carbon > total carbon | #461/#464 added individual caps/ratios but no cross-field chemistry | New distinct reconciliation defect. |
| QA-B-D3F5-004 — 118.8% dry yield | **#317** | Duplicate / direct reproduction. |
| QA-B-D3F5-005 — failed run does not restore stock | **#49** | Duplicate / direct reproduction. |
| QA-B-D3F5-006 — telemetry import reason hidden | #460 is create-attachment orchestration; import failed safely but reason was discarded | Follow-up defect/UX gap adjacent to #460, not proof that #460 regressed uploads. |
| QA-B-D3F5-007 — delete guard generic error | #478 retired document parent delete, not production-run FK messaging | New P3 operator-friction gap; integrity guard itself passed. |

## Requested open issues

| Issue | Browser result |
|---|---|
| #246 — application readiness dual implementation | Evidence 3→2→3 refreshed without reload; certification stayed incomplete because all three files lacked required GPS/timestamp. No contradictory readiness observed in this data set. |
| #317 — production plausibility | **Reproduced:** `PR-26-003` saved at 118.8% dry yield. |
| #420 — historical transport freeze/location delete guard | Not browser-reproduced: existing location edit/delete was not exposed in customer/supplier edit sheets. Map/Trail correctly showed the original 30 km and 20 km derived legs. Code recon says issue remains open. |
| #456 — org-global suppliers/customers/locations | QA-B exact matches were used exclusively. No QA-A/C record was selected. No new UI scoping proof captured. |
| #40 — production UX/stock tranche | Overdraw and rapid double-create guards passed; output-vs-input policy failed and is also covered more directly by #317. |
| #34 — inter-bin transfer | Not run; no transfer UI used. |
| #49 — failed-run dump-back | **Reproduced:** 960 kg available before an 80 kg run, 880 kg after it failed. |
| #476 — recursive computer use | Complied: one isolated Playwright browser layer; no recursive computer-use call. |

## Priority merged PR verification

| PR | Browser focus | Result |
|---|---|---|
| #448 | Stock serialization / duplicate protection | Pass: overdraw blocked and double-click created one run/draw. |
| #458 | Read-only evidence | Pass for production/application view modes: no file inputs or delete actions. |
| #460 | Create attachments | Feedstock, delivery and application files persisted; production CSV uploaded but its readings import failed with recoverable edit state. |
| #461 | Sample caps / application readiness / dates | Individual caps passed; live application evidence count passed; cross-field chemistry remains defective. |
| #462 | Dashboard flow | Pass after reload; chain totals rendered. |
| #464 | Ratio caps | Percentage and pH caps passed; hidden O:C field was not separately forced. |
| #471 | Dashboard certification gaps | Pass: transport, application and pending-batch gaps were shown. |
| #472 | Atomic derived transport legs | Initial 30 km/20 km legs appeared in Map/Trail. Historical location mutation was not available in UI. |
| #475 | UTC calendar-day helper | Pass for Jul 14–19 delivery/run/order/delivery/application/batch dates. |
| #478 | Parent document retirement | Read-only evidence passed; production parent FK deletion remained atomic. |
| #479 / #484 | Shared set-based lineage facts | DAG, Sankey, Trail and dashboard used the created chain consistently. |
| #480 | Traceability batch selection | Pass: CB-002→CB-001 selection, application, and Trail state survived reload. |
| #481 / #482 | Lifecycle rules/constants | Complete, Failed, Cancelled and invalid transitions exercised; guards passed except failed-stock disposition tracked by #49. |
| #486 | Date formatting | Pass: date-only values remained on intended calendar days. |
| #487 | Status-state classes | Labels rendered for all exercised statuses; no semantic mismatch observed. |
| #488 | Shared list controls | Search/filter/page-size/pagination controls rendered; exhaustive multi-page sorting was not possible with the isolated data volume. |

## Recon snapshot

- Merged changes from 2026-07-13 through 2026-07-19 were inspected before execution.
- All requested priority PRs were merged; #486, #487 and #488 merged on 2026-07-20.
- Open PRs observed during recon: #489 and #485.
