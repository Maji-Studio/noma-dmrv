# UI-only operational stress test — staging — 2026-07-16

## Executive summary

The one-time staging run completed as far as the visible Computer Use surface allowed. Google Chrome was operated exclusively through the bundled visible `@oai/sky` Computer Use transport. No application API, scripted selector, browser evaluation, database access, authentication bypass, seeded fixture, or source modification was used.

GitHub Actions run `29429035837` was visibly verified successful after the user performed the authorized empty staging reset. One synthetic organization, two correctly scoped facilities, and a complete Facility A lineage from feedstock intake through credit batch were created. Facility B received distinct prerequisites and feedstock inventory for isolation testing. All synthetic staging data was left in place.

Final verdict: **Production-blocking**.

The blocking risks are:

- organization switching can retain and expose a facility belonging to another organization;
- facility-scoped suppliers/customers are exposed and selectable across facilities;
- inventory loss accepts an amount larger than stock and creates a negative balance;
- supported evidence PDFs cannot be uploaded because staging cannot reach its S3 endpoint.

The core Facility A mass balance otherwise reconciled through dashboard and traceability: 400 kg dry feedstock processed → 142.5 kg dry biochar → 95 kg dry applied, with 47.5 kg dry finished product remaining. DAG, Map, Sankey, and production-run filtering agreed after an internal, non-submitted credit batch was created.

## Run manifest

| Item | Result |
|---|---|
| Target | `https://staging.noma.maji.studio/` |
| Requested start | 2026-07-16 02:00 Europe/Zurich |
| Visible reset verification | Pass — GitHub Actions run `29429035837`, `reset-empty-staging` 2m05s, workflow Success |
| Browser | Google Chrome through visible Computer Use |
| Staging identity | Existing authorized staging administrator/organization owner; identifier redacted |
| Source changes | None |
| Invitations or email | None |
| Registry/verifier submissions | None |
| Cleanup | Not requested; synthetic data remains |
| Evidence | `docs/qa/evidence/2026-07-16/` |

## Severity-sorted findings

### DEF-001 — Foreign facility survives organization switch

- Severity / type: **P1 — Security/scoping**
- Role / context: authorized staging owner; active organization changed from the pre-existing organization to `QA UI Stress 20260716-0902`.
- Route: facility selector, dashboard, and facility list.
- Reproduction:
  1. While the pre-existing organization remained active, create synthetic Facility B.
  2. Switch organization to `QA UI Stress 20260716-0902` through the visible organization selector.
  3. Observe the active facility, dashboard context, facility selector, and facility list.
- Input: synthetic facility `QA Coastal Biochar 20260716`, ID `2d9b35c8-2a7b-4084-ac15-518d0be64b30`.
- Expected: switching organization clears or rejects a foreign facility and lists only facilities belonging to the selected organization.
- Actual: the foreign facility remained active and appeared under the QA organization.
- Impact: operators can view or act in the wrong tenant context; records can be created under an unintended organization.
- Evidence: `DEF-001-cross-org-facility-context.jpeg`, `DEF-001-cross-org-facility-list.jpeg`.
- Reproducibility: 1/1 organization switch; persisted across list navigation.
- Suggested fix: bind active facility to organization membership server-side, clear it on organization change, and fail closed on every route/query when the pair is invalid.
- Confidence: High.

### DEF-003 — Facility A dependencies are exposed and selectable in Facility B

- Severity / type: **P1 — Security/scoping and data integrity**
- Role / context: staging owner; active Facility B `QAORG B Coastal Biochar 20260716`.
- Routes: Suppliers, Customers, and Feedstock creation.
- Reproduction:
  1. Create different A/B suppliers and customers.
  2. Switch to Facility B.
  3. Open supplier/customer lists and a new feedstock draft.
  4. Select Facility A's supplier in the Facility B draft.
- Input: Facility A supplier `SUP-26-001` with 12 km stored distance.
- Expected: operational dependencies are facility-scoped, or clearly labeled and governed as organization-global.
- Actual: A and B suppliers/customers appeared under B; A's supplier was accepted and auto-filled A's 12 km distance.
- Impact: cross-facility attribution and transport emissions can be silently wrong.
- Evidence: `DEF-003-cross-facility-supplier-selectable.jpeg`, `DEF-003-cross-facility-supplier-list.jpeg`, `DEF-003-cross-facility-customer-list.jpeg`.
- Reproducibility: lists 2/2; dependency selection 1/1.
- Suggested fix: enforce facility ownership in list queries and mutations, or make organization-global scope explicit and require an intentional cross-facility selection warning.
- Confidence: High for behavior; Medium for intended product scope.

### DEF-004 — Excessive loss creates negative inventory

- Severity / type: **P1 — Data integrity**
- Role / context: staging owner; Facility A.
- Route: Storage Locations → Reconcile `SL-26-001` → Record Loss.
- Reproduction:
  1. Start with 400 kg dry derived stock.
  2. Enter loss `401` kg and reason `QA excessive loss boundary test`.
  3. Submit once.
- Expected: reject a loss greater than available stock without creating a movement.
- Actual: submission succeeded and the summary displayed `FEEDSTOCK ON HAND -1 kg`.
- Impact: physical inventory, mass balance, dashboard, and certification inputs can become impossible.
- Recovery: a visible 500 kg wet stock-take restored the bin to 400 kg dry after evidence capture.
- Evidence: `DEF-004-negative-inventory-loss.jpeg`.
- Reproducibility: 1/1 exact boundary attempt.
- Suggested fix: validate loss against current derived stock atomically in the data-access transaction; return a field-level error and preserve the draft.
- Confidence: High.

### DEF-006 — Supported evidence uploads cannot reach staging storage

- Severity / type: **P1 — Reliability**
- Role / context: staging owner; Facility A delivery `DL-26-001`.
- Route: delivery detail → Transport Evidence.
- Reproduction:
  1. Use the visible file picker for `delivery-receipt.pdf` as bill of lading.
  2. Repeat once with `feedstock-weighbridge-ticket.pdf` as weigh-scale ticket.
- Expected: both small supported PDFs upload, persist, and become source candidates.
- Actual: both fail with `Upload network error — could not reach noma-staging.s3.fra1.amazonaws.com`.
- Impact: required certification evidence cannot be attached; downstream readiness cannot be trusted.
- Evidence: `DEF-006-document-upload-network-error.jpeg`; visible UI error reproduced on two attachment categories.
- Reproducibility: 2/2 supported uploads.
- Suggested fix: restore staging object-storage reachability/CORS/signing configuration and add a retry action with retained file metadata.
- Confidence: High.

### DEF-002 — Escape closes the whole storage draft

- Severity / type: **P2 — UX and accessibility**
- Role / context: staging owner; Facility A.
- Route: Create Storage Bin side sheet, feedstock-type dropdown.
- Reproduction: populate a storage draft, open the feedstock-type dropdown, press Escape.
- Expected: only the dropdown closes and focus returns to its trigger.
- Actual: the entire side sheet closes and the draft is discarded.
- Impact: keyboard users lose work and cannot safely dismiss overlays.
- Evidence: reproduced twice; clean screenshot unavailable because the first capture contained password-manager UI and was deliberately not preserved.
- Suggested fix: stop Escape propagation at the dropdown and add dirty-draft confirmation at the side-sheet boundary.
- Confidence: High.

### DEF-005 — Upcoming delivery is counted and labeled as delivered

- Severity / type: **P2 — Functional/content**
- Role / context: staging owner; Facility A.
- Routes: Deliveries list and `DL-26-001` detail.
- Reproduction: create a 100 kg delivery with status `Upcoming` and open its list/detail before changing status.
- Expected: delivered counters and labels include only `Delivered` records.
- Actual: `WET MASS DELIVERED` showed 100 kg, detail labeled `Delivered Wet Mass`, and readiness said `Ready for certification` while status remained `Upcoming`.
- Protection that passed: the application selector disabled this delivery as `not yet delivered`.
- Impact: operational totals and certification messaging contradict lifecycle state.
- Evidence: `DEF-005-upcoming-delivery-counted-delivered.jpeg`.
- Reproducibility: 1/1 delivery.
- Suggested fix: make lifecycle-qualified aggregates/labels derive from delivered status and align readiness terminology across list/detail/dependency selectors.
- Confidence: High.

### DEF-007 — Empty-state content is repeated in the accessibility tree

- Severity / type: **P2 — Accessibility**
- Role / context: staging owner; Orders and Biochar Products tables.
- Reproduction: search for `NO-MATCH-20260716` or open an empty product list and inspect keyboard/accessible content through Computer Use.
- Expected: one concise empty-state announcement.
- Actual: the same `No orders found` / `No biochar products yet` block appeared roughly nine times in the accessibility tree.
- Impact: screen-reader navigation is noisy and misleading even though the visual UI shows one state.
- Evidence: visible Computer Use accessibility output recorded during the run; no visual screenshot can show hidden duplicate nodes.
- Suggested fix: remove hidden responsive/table clones from the accessibility tree with correct conditional rendering or `aria-hidden`.
- Confidence: High.

### DEF-008 — Dashboard feedstock-mix label contradicts processed quantity

- Severity / type: **P2 — Content/data presentation**
- Role / context: staging owner; Facility A dashboard.
- Route: Dashboard, 30D.
- Reproduction: after 800 kg dry intake and 400 kg dry production consumption, load the dashboard.
- Expected: every “processed” metric uses the 400 kg actually consumed, or the mix is labeled as intake/on-hand basis.
- Actual: headline `FEEDSTOCK PROCESSED` is 0.4 t, while Feedstock Mix says `0.8 T DRY` and `DRY MASS PROCESSED BY FEEDSTOCK TYPE`.
- Impact: operators cannot tell whether the chart represents received, available, or processed feedstock.
- Evidence: `04-dashboard-loaded.jpeg`.
- Reproducibility: 1/1 populated dashboard load.
- Suggested fix: derive both widgets from the same production-consumption basis or rename the mix to `Feedstock received`.
- Confidence: High.

## Observations and hypotheses

- Dashboard and Chain of Custody initially showed a blank theme frame and then loading skeletons before rendering. Visible console showed no JavaScript errors. Files prefixed `OBS-` preserve these frames; they are not classified as defects.
- Product totals use wet mass (`150 kg`) while production and traceability also expose dry mass (`142.5/143 kg`). Most downstream screens label dry mass, but Storage's product headline does not explicitly state wet/dry.
- Order detail omits selected product, packaging, value/currency, customer location, and distance even though the create form captures them.
- Storage Reconcile exposes Stock-take and Record Loss only. No transfer operation appeared even after a compatible second feedstock bin existed.
- Chain of Custody uses internal IDs in accessible edge descriptions while visible cards use human-readable codes. This is acceptable for diagnostics but noisy for assistive technology.

## A–J coverage checklist

| Section | Result | Evidence / limitation |
|---|---|---|
| A — Empty-state onboarding | Pass | Reset verified; required/whitespace/lat-long validation; organization and two facilities created; refresh persistence checked |
| B — Active-facility isolation | Fail | DEF-001 and DEF-003; core products/orders/storage/feedstocks otherwise isolated by facility |
| C — Roles and permissions | Partial | Owner UI and Owner/Admin/Member choices inspected; no authorized secondary accounts or test inboxes, so enforcement matrix could not be executed |
| D — Storage and inventory | Fail | Exact reconciliation completed; DEF-004; product/feedstock balances reconciled after recovery; no transfer control exposed |
| E — Lifecycle and dependencies | Partial | Upcoming delivery correctly blocked from Application; product/order/delivery/application/credit batch chain created; destructive dependency delete not submitted because Computer Use requires action-time deletion confirmation |
| F — Documents/evidence | Fail | Two supported PDFs failed at S3; unsupported Markdown rejected; refresh proved no false attachment |
| G — Tables, filters, navigation | Partial | Order partial/no-match search, status filters, clearing, empty state, pagination controls, back navigation tested; exhaustive every-list combinations and supported sorting not completed |
| H — Session and recovery | Partial | Refresh persistence, validation correction/resubmit, cancel/reopen, failed-upload refresh, and back navigation tested; logout/back/login and same-draft two-tab save blocked after Chrome detached into an inaccessible responsive window |
| I — Dashboard, maps, traceability | Partial/Fail | DAG/Map/Sankey and mass balance pass; DEF-008; Facility B has no full lineage for independent traceability comparison |
| J — Accessibility/responsive | Fail/Partial | Labels/errors/units, dropdown keyboard behavior, focus sequence, Escape, and hidden duplicate nodes checked; 200%/narrow viewport could not be authoritatively verified after responsive-device UI detached Chrome |

## Two-facility isolation matrix

| Surface | Facility A | Facility B | Cross-exposure | Verdict |
|---|---|---|---|---|
| Header/active context | Correct after explicit selection | Correct after explicit selection | Foreign old-organization facility persisted through organization switch | Fail — DEF-001 |
| Feedstock intakes | FS-26-001 only | FS-26-002 only | None observed | Pass |
| Reactors | R-26-001 | R-26-002 | None observed | Pass |
| Storage | A bins/stores | B bins/stores | None observed | Pass |
| Biochar products | BP-26-001 | Empty | None observed | Pass |
| Orders | OR-26-001 | Empty | None observed | Pass |
| Suppliers/customers | A records | A and B visible | A selectable under B | Fail — DEF-003 |
| Feedstock types | A and B visible in both | A and B visible in both | Scope appears organization-global but is not explained | Observation |
| Dependency selectors | A production/product/bin dependencies scoped | B supplier dependency exposed A | Supplier accepted across facility | Fail — DEF-003 |
| Dashboard/map/traceability | Complete A lineage | B prerequisites/intake only | No A products/orders appeared in B lists | Partial pass |
| Refresh/deep links | A selection persisted | B direct URLs showed B context | Invalid organization/facility pair did not fail closed | Fail — DEF-001 |

## Role-permission matrix

Visible Organization settings exposed Owner, Admin, and Member role choices. The current authorized account was Owner. No invitations were sent.

| Role | View/create/edit | Delete/archive | Members/settings | Inventory/documents/certification | Result |
|---|---|---|---|---|---|
| Owner | Exercised | Delete dialogs visible; final deletion not submitted | Organization/member UI visible | Exercised | Partial |
| Admin | Untested | Untested | Untested | Untested | No authorized Admin account |
| Member | Untested | Untested | Untested | Untested | No authorized Member account |
| Platform Admin | Admin navigation visible under current account | Untested | Untested | Untested | Distinct platform-admin enforcement not isolated |

Exact blocker: the brief forbids invitations without authorized test inboxes, and none were supplied. Role simulation or authorization bypass was not used.

## Storage reconciliation

| Facility / stock | Opening | Additions | Consumption/removal | Adjustments | Expected ending | Displayed ending | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| A feedstock dry | 0 | +800 intake | -400 production | -401 excessive loss; recovery stock-take +401 to 400 | 400 | 400 kg | Reconciled after DEF-004 recovery |
| A unallocated biochar dry | 0 | +142.5 production | -142.5 product transfer | 0 | 0 | 0 kg | Pass |
| A finished product dry | 0 | +142.5 product | -95 delivered | 0 | 47.5 | 50 kg | Pass with whole-kg rounding |
| B feedstock dry | 0 | +1050 intake | 0 | 0 | 1050 | 1.1 t on list | Pass with one-decimal tonne rounding |
| B biochar/product | 0 | 0 | 0 | 0 | 0 | 0 | Pass |

Dashboard/Sankey check: 400 kg feedstock → 143 kg biochar → 95 kg applied; 258 kg conversion loss and 48 kg in storage after rounding.

## Exact created-record and document inventory

| Category | Records |
|---|---|
| Organization | `QA UI Stress 20260716-0902`, slug `qa-ui-stress-20260716-0902` |
| Correct Facility A | FAC-26-002 `QAORG A Alpine Pyrolysis 20260716`, ID `71ae921a-57c0-48fa-92de-e919129fbfda`, Switzerland/Europe-Zurich |
| Correct Facility B | FAC-26-003 `QAORG B Coastal Biochar 20260716`, ID `f9295c97-7725-4830-852f-0bcc2ecddcc6`, Tanzania/Africa-Dar es Salaam |
| Synthetic facilities created under pre-existing organization | FAC-26-001 `QA Alpine Pyrolysis 20260716`, ID `1ba08084-d772-4476-bdf4-07ba2efddaaf`; `QA Coastal Biochar 20260716`, ID `2d9b35c8-2a7b-4084-ac15-518d0be64b30` |
| Reactors | R-26-001 `QA-A Reactor Alpha 20260716`; R-26-002 `QA-B Auger Reactor 20260716` |
| Feedstock types | FT-26-010 `QA-A Alpine Orchard Prunings 20260716`; FT-26-011 `QA-B Coastal Coconut Residue 20260716` |
| Suppliers/locations | SUP-26-001 + `QA-A Zurich Source 20260716` (12 km); SUP-26-002 + `QA-B Pwani Coconut Source 20260716` (25 km) |
| Customers/locations | CUS-26-001 + `QA-A Vineyard Plot 20260716` (8 km); CUS-26-002 + `QA-B Cashew Plot 20260716` (18 km) |
| Storage | A: SL-26-001 feedstock, SL-26-002 biochar, SL-26-003 product, SL-26-007 overflow; B: SL-26-004 biochar, SL-26-005 product, SL-26-006 feedstock |
| Feedstock intakes | FS-26-001: 1000 kg wet / 800 dry; FS-26-002: 1500 kg wet / 1050 dry |
| Production | PR-26-001 Complete: 500 kg wet / 400 dry in; 150 kg wet / 142.5 dry out |
| Downstream A | BP-26-001; OR-26-001 100 kg; DL-26-001 100 wet / 95 dry Delivered; AP-26-001 100 wet / 95 dry; CB-26-001 Pending |
| Stock corrections | 401 kg loss accepted; 500 kg wet recovery stock-take restoring 400 kg dry |
| Persisted documents | 0 |
| Upload attempts | `delivery-receipt.pdf` failed; `feedstock-weighbridge-ticket.pdf` failed; `AGENTS.md` rejected as `text/x-markdown` |

## Lifecycle and dependency matrix

| Entity | Create/list/detail | Edit/reload | Cancel/validation | Dependency protection / deletion | Result |
|---|---|---|---|---|---|
| Facility | Pass | Refresh persisted | Required/whitespace/GPS bounds pass | Delete not attempted | Pass/partial |
| Reactor | Pass | Listed by facility | Basic form path pass | Not tested | Partial |
| Storage | Pass | Listed; reconciliation persisted | Escape loses draft | Delete dialog opened/cancelled; final protection not submitted | Fail/partial |
| Supplier/customer + locations | Pass | Listed | Defaults/distances persisted | Cross-facility scope fails | Fail |
| Feedstock type/intake | Pass | Lists and selectors persisted | Extreme/negative checks exercised | Used by production/storage | Partial |
| Production run | Pass | Complete/list/dashboard | Date/time corrections pass | Claimed by CB-26-001 | Pass/partial |
| Biochar product | Pass | BP-26-001 detail/list | Transfer preview pass | Feeds order/traceability | Pass |
| Order | Pass | OR-26-001 fulfilled | Search/filter pass | Dependency fulfillment 1/1 | Pass |
| Delivery | Pass | Upcoming → Delivered persisted | Application disabled while Upcoming | Evidence upload fails | Fail |
| Application | Pass | AP-26-001 listed | GPS auto-filled; method selected | Upcoming delivery correctly blocked | Pass |
| Credit batch | Pass | CB-26-001 Pending; one cert gap | No external submission | Production run claimed once | Pass/partial |

Destructive post-dependency deletion was not submitted: Computer Use deletion requires confirmation immediately before the irreversible click, and no action-time confirmation was available during the autonomous run.

## Document/evidence matrix

| Test | Result |
|---|---|
| Valid PDF, bill of lading | Fail — S3 network error |
| Valid PDF, weigh-scale ticket | Fail — same error on second category; no further hammering |
| Unsupported Markdown | Pass — explicit `Content type text/x-markdown not allowed for bill_of_lading` |
| Failed-upload false record | Pass — reload returned both controls to `No file chosen` |
| Progress/error preservation | Partial — 0% then file size/error retained in panel |
| Retry | Retrying on second category reproduced infrastructure failure |
| Successful persistence/open/download | Untested — no upload succeeded |
| Duplicate filename, empty, oversized, image, CSV | Untested after valid small upload failed; stopped per brief |
| Removal and cross-facility isolation | Untested — no document persisted |
| Readiness change | No successful attachment; delivery already incorrectly said Ready before evidence |

## Tables, filters, and navigation

- Orders: partial code search passed; no-match search produced useful visible empty state; fulfillment filters `No deliveries` and `Fulfilled` passed; clearing restored the row.
- Facility switching: product/order/storage/feedstock lists updated correctly except DEF-001/DEF-003 surfaces.
- Pagination: controls and row-count selectors rendered; only one synthetic row existed on most lists, so page transitions were unavailable.
- Back navigation returned from Deliveries to the filtered Orders route. Forward was disabled after direct-address navigation and was not treated as a product defect.
- Sorting headers were visible but not actionable through the accessible element surface; coordinate clicking became unavailable when Chrome detached.
- Many responsive table clones duplicate hidden empty-state content in the accessibility tree (DEF-007).

## Session and recovery

| Scenario | Result |
|---|---|
| Refresh persisted active facility and created records | Pass |
| Validation failure → correction → resubmit | Pass on facility/inventory forms |
| Cancel/reopen | Pass generally; Escape-specific storage loss is DEF-002 |
| Failed upload → refresh | Pass; no false document record |
| Back navigation | Pass |
| Idle continuation | Pass over the multi-hour run |
| Upcoming dependency gate | Pass; Application disabled until Delivered |
| Logout/back/protected deep link/login redirect | Untested — Chrome became inaccessible after visible responsive-device control detached its window |
| Same draft in two visible tabs | Untested — same Computer Use window blocker |

## Dashboard, maps, and traceability

- Dashboard quantities: 0.4 t dry feedstock processed, 0.1 t dry biochar, 35.6% yield, 0.1 t applied, one production, one application.
- Evidence gaps: four gaps; links targeted Feedstocks, Applications, Credit Batches, and Chain of Custody.
- Map: Facility, supplier/feedstock origin, and application markers rendered; 12 km inbound and 8 km outbound distances agreed with stored locations.
- DAG: FS-26-001, R-26-001, PR-26-001, BP-26-001, OR-26-001, DL-26-001, and AP-26-001 linked in order with human-readable cards.
- Sankey: 400 kg → 143 kg → 143 kg → 95 kg; conversion loss 258 kg; in storage/undelivered 48 kg.
- Production-run filter added the run ID to the visible URL and retained the same lineage.
- Empty lineage state before CB-26-001 was clear and non-erroring.
- Trail-specific separate view was not exposed; the application card/production filter provided the rollback path.
- Facility B had no production lineage, so its traceability view remained an intentional partial/empty state.

## Accessibility and responsive notes

- Required fields, units, bounds, and errors were visibly associated with inputs on facility, inventory, delivery, and application forms.
- Statuses include text (`Upcoming`, `Delivered`, `Ready`, `Pending`) and are not color-only.
- Core icon controls had accessible names such as Reconcile, Edit, Delete, Fit map, Zoom, and Toggle satellite imagery.
- Tab order reached DAG → Map → Sankey, then a focusable graph container/image with no interactive purpose. Focus-return behavior after every overlay was not fully verified.
- Escape handling fails in the storage dropdown (DEF-002).
- Hidden repeated empty states fail the practical screen-reader pass (DEF-007).
- Browser zoom commands and the visible responsive-device shortcut were attempted. The shortcut detached Chrome into an inaccessible window and no authoritative 200%/narrow screenshot could be completed. No scripted resize was substituted.
- This is a practical operator pass, not a WCAG conformance claim.

## Console and failed-request ledger

| Surface | Result |
|---|---|
| Dashboard visible Console | `No errors` |
| Chain of Custody visible Console | `No errors` |
| Dashboard visible Network panel | No visible 4xx/5xx row was exposed during inspection; data rendered after loading |
| Document upload | Two visible failures to reach `noma-staging.s3.fra1.amazonaws.com` |
| Unsupported upload | Visible content-type rejection; no persisted record |

## Five fixes to prioritize

1. Enforce organization/facility pairing server-side and clear foreign active-facility state on organization switch.
2. Enforce or explicitly model supplier/customer facility scope in every list, selector, and mutation.
3. Make inventory loss validation atomic and prohibit any negative derived balance.
4. Restore staging object-storage uploads and align readiness with actual successful evidence attachments.
5. Align lifecycle and quantity semantics: Upcoming vs Delivered, wet vs dry labels, and dashboard feedstock-mix basis.

## Risk and UX conclusions

- Worst security/scoping risk: **DEF-001 — invalid organization/facility pairs do not fail closed.**
- Worst operator-experience gap: **required evidence upload is impossible while the UI can still say a delivery is Ready for certification.**
- Quick UX fixes: stop Escape propagation; label wet/dry bases; hide duplicate accessible empty states; show retry on upload; rename the feedstock-mix basis; include product/value/location in order detail.
- Product decisions: whether suppliers/customers/feedstock types are facility- or organization-global; when delivery mass should leave inventory; which lifecycle states qualify as certification-ready; whether storage transfers are part of the operator model.

## Untested items and exact blockers

- Admin/Member enforcement: no authorized additional accounts or inboxes; invitations prohibited.
- Destructive dependency deletion: action-time Computer Use confirmation required and not available during autonomous execution.
- Successful document persistence/open/download/duplicate/removal/isolation: staging S3 failure prevented the prerequisite successful upload.
- External registry/verifier behavior: explicitly out of scope; no submission made.
- Full second-facility certification lineage: brief said not to repeat the full workflow unless required; isolation was proven with distinct prerequisites/intake and empty downstream lists.
- Logout/back/login, same-draft two-tab saves, authoritative 200% and narrow responsive inspection: visible responsive-device control detached Chrome into an inaccessible window after completed evidence capture; no prohibited fallback was used.

## Computer Use attestation

Every noma-dmrv and GitHub Actions interaction was performed through visible Google Chrome Computer Use. Local CLI use was limited to reading instructions/source filenames, copying Computer Use screenshots into the evidence directory, and writing this report/memory. No application interaction was replaced with an API, browser script, selector engine, direct session manipulation, SQL/ORM/database access, or authentication bypass.
