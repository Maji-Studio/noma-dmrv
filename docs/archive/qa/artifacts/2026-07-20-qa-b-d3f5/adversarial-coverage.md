# Adversarial coverage — QA-B `d3f5`

| Attack | Exact probe | Result | Evidence / finding |
|---|---|---|---|
| Empty / whitespace | Facility name = spaces | Rejected: facility name required | [02](screenshots/02-facility-whitespace-validation.png) |
| Negative number | Reactor throughput `-1` | Rejected | [04](screenshots/04-reactor-negative-validation.png) |
| Negative distance | Supplier location distance `-1` | Rejected | [06](screenshots/06-supplier-location-negative-validation.png) |
| Zero values | Four production energy inputs `0` | Accepted as explicit zero and removed those readiness gaps | Run detail / Trail |
| Oversized / range | Credit-batch window over one month | Rejected with protocol window message | [19](screenshots/19-credit-batch-window-validation.png) |
| Percentage caps | Feedstock moisture `101` | Rejected 0–100 | [11](screenshots/11-feedstock-moisture-cap-validation.png) |
| Sample caps | Total C `101`, pH `15` | Both rejected | [22](screenshots/22-sample-caps-validation.png) |
| Sample cross-field ratio | Total C `70`, organic C `80`, inorganic C `5` | **Failed:** saved as complete chemistry | [23](screenshots/23-sample-cross-field-contradiction-saved.png), QA-B-D3F5-003 |
| Feedstock mass mismatch | 2,000 kg received; 2,100 kg allocated; blank justification | **Failed:** saved and credited extra mass | [12](screenshots/12-feedstock-allocation-overage-attempt.png), QA-B-D3F5-002 |
| Duplicate create | Double-click Create on a 100 kg running run | One run (`PR-26-003`) and one 80 kg dry draw only | Stock before/after messages |
| Stock overdraw | Request 4,000 kg dry from 960 kg available | Blocked with exact available/required values | [40](screenshots/40-stock-overdraw-blocked.png) |
| Failed-run stock | Fail the 80 kg dry run, then query stock with a 970 kg draw | **Failed:** only 880 kg remained; draw not restored | [45](screenshots/45-failed-run-stock-not-restored.png), QA-B-D3F5-005 / #49 |
| Overlapping runs | Start new running run Jul 15 09:00 on occupied reactor | Blocked with overlap conflict | [42](screenshots/42-overlapping-run-blocked.png) |
| Running with end | Create Running with end date/time | Rejected: running run cannot have end | Recorded in run ledger |
| Complete without end | Transition `PR-26-001` to Complete without end | Rejected | [17](screenshots/17-run-complete-missing-end-validation.png) |
| Failed without end | Transition `PR-26-003` to Failed without end | Rejected | [41](screenshots/41-failed-run-missing-end-and-superunit-yield.png) |
| Cancel without reason | Create Cancelled without reason | Rejected; saved after explicit QA-B reason | `PR-26-004` |
| Invalid completed reopen | Clear `PR-26-001` end and set Running while product child exists | Blocked before mutation: remove linked products | [43](screenshots/43-completed-run-reopen-blocked-by-child.png) |
| Super-unit yield | 80 kg dry feedstock → 95 kg dry biochar | **Failed:** 118.8% yield saved | [41](screenshots/41-failed-run-missing-end-and-superunit-yield.png), QA-B-D3F5-004 / #317 |
| Parent deletion | Delete `PR-26-001` with product/batch descendants | Parent preserved; generic error only | [44](screenshots/44-parent-delete-guard-generic-error.png), QA-B-D3F5-007 |
| Create attachment | Feedstock BOL/ticket, production CSV, delivery BOL, three application photos | Files persisted; production CSV import failed separately | Trail and QA-B-D3F5-006 |
| Read-only evidence | Open production/application details | No file inputs or delete controls in view mode | [16](screenshots/16-run-view-readonly.png), [30](screenshots/30-application-readonly-detail.png) |
| Evidence add/remove | Delete one application photo, confirm, re-add same file | File count changed 3→2→3 without reload | Application edit session |
| Certification refresh | Application evidence changed in edit mode | Live evidence count refreshed; list retained `Incomplete (1)` because files lacked GPS/timestamp | [29](screenshots/29-application-created-three-stage-evidence.png) |
| Two-batch switch | Switch `CB-26-002` empty → `CB-26-001` full | Correct run/application counts and lineage; selected state persisted in URL/local storage and after reload | [31–36](screenshots/) |
| DAG / lineage | CB-001 full chain | Correct records and dates rendered | [33](screenshots/33-traceability-dag-batch-1.png) |
| Map | Supplier 30 km and application 20 km | Headless WebGL unavailable; correct rail fallback rendered | [34](screenshots/34-traceability-map-graceful-fallback.png) |
| Sankey | 400 dry in → 143 dry out → 76 dry applied | Masses reconciled subject to rounding | [35](screenshots/35-traceability-sankey-batch-1.png) |
| Trail | Trace `AP-26-001` rollback | Six steps, nine attesting records, both derived legs and files | [36](screenshots/36-traceability-trail-evidence.png) |
| Empty state | `CB-26-002`, one run / zero applications | Explicit no-member-applications message | [32](screenshots/32-traceability-batch-2-empty-state.png) |
| Dashboard reconciliation | Reload dashboard for FAC-26-001 | 0.7 t processed, 0.3 t produced, 0.1 t applied; legitimate gaps | [38](screenshots/38-dashboard-overview-chain-gaps.png), [39](screenshots/39-dashboard-flow-view.png) |

## Not completed without inventing coverage

- Non-numeric entry was not force-injected into number inputs; native controls and schema number coercion were observed but not separately scored.
- Maximum-length text and database integer ceilings were not exhaustively probed on every entity.
- Reload-while-submitting was not deliberately repeated after the shared Next development server showed long concurrent HMR navigations; double-click/idempotency received the higher-integrity priority.
- Existing supplier/customer locations had no edit control in the exposed create/edit sheets, so issue #420’s location-change freeze was not browser-reproduced. Code recon still indicates it remains open.
- A mid-form facility switch and QA-B deep-link to a different facility were not performed because no second QA-B facility was created and selecting another thread’s facility was forbidden.
- Inter-bin transfer (#34) had no operational UI in this chain and was not simulated.
- Sorting/search were not repeated across every one-page list; controls rendered and created records were visible.

These cases are **Not run**, not passes.
