# UI-only operational stress test — final report

Run date: 2026-07-21
Execution window: approximately 13:44–15:39 CEST, continuing the one-time 02:00 Europe/Zurich goal
Environment: staging
Authenticated coverage: one authorized staging administrative session
Interaction method: visible Computer Use only (`@oai/sky` through the explicitly authorized Node REPL transport)

## Executive summary

The user-run official empty staging reset was visibly confirmed before staging was opened. GitHub Actions database-management run **#178**, manually started on the `staging` branch on 2026-07-20 at 14:59 CEST, completed `reset-empty-staging` successfully in 2m 31s. The other reset/migration jobs were skipped. The workflow was not run again.

The test created one synthetic organization, two materially different facilities, and a complete Facility B operational chain from intake through application. Facility A received its own reactor, three bins, and intake so that active-facility isolation could be checked with non-empty data on both sides. No Facility A transactional record appeared while Facility B was active, or vice versa. Direct navigation to a Facility B URL selected Facility B. Organization-scoped supplier, feedstock-type, and customer records were deliberately visible from both facilities.

The core inventory ledger reconciled at the end of the run:

- Facility A: **450 kg dry feedstock**, **0 kg biochar**, **0 kg product**.
- Facility B: **390 kg dry feedstock**, **50 kg unallocated biochar**, **35 kg product**.

Two release-significant failures were reproduced:

1. An 80 kg order was shown as **Fulfilled** after one 60 kg delivery because fulfillment is derived from delivery record counts/statuses, not delivered mass.
2. Two valid small image uploads in the delivery workflow failed against the object-storage host, including one retry. No document was persisted.

Six additional P2 defects were confirmed around prerequisite quick-add hydration, create-sheet recovery, delivery relationship display, false empty storage states, map configuration, and the table column chooser.

The session ended with a deliberate sign-out. Back navigation correctly stayed fail-closed at login, but the visible credential AutoFill path did not repopulate the login form, so post-sign-out re-entry and remaining authenticated checks were blocked. Multi-role coverage was independently blocked because no additional authorized accounts or test inboxes were supplied.

**Final verdict: High-risk; not operationally cleared.** No facility-scoping leak was reproduced, but incorrect order completion and unavailable evidence uploads can corrupt operational status and prevent a defensible audit trail. Fix and visibly retest F-01 and F-02 before routine staging acceptance or production release of these workflows.

## Severity-sorted confirmed finding ledger

| ID | Severity | Title | Type | Facility / role | Reproducibility |
| --- | --- | --- | --- | --- | --- |
| F-01 | P1 | Under-delivered order is marked fulfilled | Data integrity / functional | Facility B / admin | 1/1 |
| F-02 | P1 | Valid delivery evidence uploads fail at object storage | Reliability / documents | Facility B / admin | 3 failed attempts across 2 fields |
| F-03 | P2 | Quick-added feedstock type does not reliably hydrate its parent selector | Functional / UX | Facilities B and A / admin | 2/2 parent workflows |
| F-04 | P2 | Successful creates can leave stale, navigation-blocking side sheets | Reliability / UX | Facilities B and A / admin | Order 1/1; similar linger observed on reactor and bin |
| F-05 | P2 | Delivery failure-recovery sheet blanks valid relationship labels | Functional / display | Facility B / admin | 1/1 |
| F-06 | P2 | Storage shows a false destructive empty state while loading real bins | Reliability / UX | Facilities A and B / admin | Repeated, approximately 4–7 seconds |
| F-07 | P2 | Application map preview is unavailable in staging | Environment / functional | Facility B / admin | 1/1 |
| F-08 | P2 | Column chooser state disagrees with the rendered table | Functional / accessibility | Facility B / admin | 1/1; refresh restored default |

## Detailed confirmed findings

### F-01 — Under-delivered order is marked fulfilled

| Field | Detail |
| --- | --- |
| Severity | P1 |
| Type | Data integrity / functional |
| Role / facility | Authorized admin / Facility B (`FAC-26-002`) |
| Route / screen | Orders list and `OR-26-001` detail |
| Exact input | Order quantity 80 kg; one linked Delivery `DL-26-001`, status Delivered, 60 kg wet / 54 kg dry |
| Expected | Order remains Partial or otherwise visibly shows 20 kg undelivered. |
| Actual | Order detail shows `Fulfilled` and `Delivered 1 of 1`. |
| Impact | Operators can treat an under-delivered commitment as complete; filters, reporting, downstream decisions, and customer records become materially misleading. |
| Evidence | [Order quantity and fulfillment discrepancy](artifacts/2026-07-21-ui-only-operational-stress/order-quantity-fulfillment-discrepancy-sanitized.jpg) |
| Reproducibility | 1/1 with the only order/delivery pair created in the empty environment |
| Root cause | **Source-confirmed.** `src/data-access/orders.ts:124-149` aggregates total and delivered delivery-row counts and returns `fulfilled` when those counts match. `src/lib/orders/fulfillment.ts:21-34` mirrors the same count-only rule. Neither path compares order quantity to delivered mass. |
| Suggested fix | Define fulfillment from non-archived delivered mass against ordered quantity, with an explicit tolerance and over-delivery rule. Display delivered mass, remaining mass, and delivery count separately. Add partial, exact, over-delivery, archived-delivery, and mixed-status tests. |
| Confidence | High |

Visible Computer Use steps:

1. In Facility B, create `OR-26-001` for 80 kg of `BP-26-001`.
2. Create one linked delivery for 60 kg wet mass and mark it Delivered.
3. Return to Orders and open `OR-26-001`.
4. Compare Quantity `80 kg` with Fulfillment `Fulfilled` and Delivered `1 of 1`.

### F-02 — Valid delivery evidence uploads fail at object storage

| Field | Detail |
| --- | --- |
| Severity | P1 |
| Type | Reliability / documents |
| Role / facility | Authorized admin / Facility B |
| Route / screen | New Delivery → evidence attachments |
| Exact input | Two small sanitized JPEGs selected through the visible file picker: one as bill of lading and one as weigh-scale evidence |
| Expected | Each file uploads, receives a persisted document record, remains visible after save/reopen, and is downloadable. |
| Actual | Both fields showed `Network Error` against `fra1.digitaloceanspaces.com`; retrying one failed again. Save correctly refused unresolved failed attachments. Removing both failed queue items allowed the already-created delivery to be saved without documents. |
| Impact | Delivery evidence cannot be attached, weakening traceability and blocking evidence-complete certification workflows. |
| Evidence | [Delivery upload network failure](artifacts/2026-07-21-ui-only-operational-stress/delivery-evidence-upload-network-failure-sanitized.jpg) |
| Reproducibility | 3 failed attempts: two initial uploads plus one retry |
| Root cause | **Source path confirmed; environment cause not fully confirmed.** `src/hooks/use-file-upload.ts:208-240` requests a presigned upload, performs a browser PUT to the returned object-store URL, then confirms the document. The visible failure occurred at the object-storage host before confirmation. Likely causes include bucket CORS, presigned headers/signature, or staging object-store configuration. |
| Suggested fix | Validate staging bucket CORS and presigned headers from the deployed browser origin, surface request stage/status without sensitive URLs, and add a staging smoke test that uploads then reopens/downloads a small image. |
| Confidence | High on defect; medium on infrastructure cause |

Visible Computer Use steps:

1. Open New Delivery in Facility B and fill the valid `DL-26-001` delivery data.
2. Choose the bill-of-lading field and select a small sanitized JPEG in the visible file picker.
3. Choose the weigh-scale field and select a second small sanitized JPEG.
4. Observe `Network Error` on both upload entries.
5. Use the visible Retry action on one entry; observe the same failure.
6. Attempt Save; observe the explicit requirement to resolve or remove failed attachments.
7. Remove the two failed queue entries and save; reopen the delivery and confirm no document is claimed as attached.

### F-03 — Quick-added feedstock type does not reliably hydrate its parent selector

| Field | Detail |
| --- | --- |
| Severity | P2 |
| Type | Functional / UX |
| Role / facility | Authorized admin / Facilities B and A |
| Route / screen | New Storage Bin → Feedstock Type → Add new feedstock type |
| Exact input | `FT-26-010`, name `qa b woody residue 20260721`, Forestry / Pyrolysis |
| Expected | After successful quick-add, the parent storage form visibly selects the new type and downstream compatible-bin selectors immediately include the saved bin. |
| Actual | The type was created but the parent selector did not reliably display the selection. Exact search later showed `Error loading options`. In the A workflow the compatible intake bin was absent until the value was cleared and the type was explicitly found by scrolling/clicking. |
| Impact | A normal prerequisite chain can appear broken after successful creation, encouraging duplicate master data or blocking intake setup. |
| Evidence | Persisted records are visible in [Facility B bins](artifacts/2026-07-21-ui-only-operational-stress/facility-b-storage-bins-sanitized.jpg) and [Facility A intake](artifacts/2026-07-21-ui-only-operational-stress/facility-a-feedstock-intake-sanitized.jpg); no separate error screenshot retained. |
| Reproducibility | 2/2 parent workflows showed missing or blank hydration behavior |
| Root cause | **Source-suggested, not fully confirmed.** `src/components/forms/entity-select/entity-select.tsx:211-233` derives the label from a separate by-ID/options query, while `handleCreatedEntity` only calls `onChange(entity.id)` and does not seed or invalidate either query cache. `src/hooks/use-entities.ts:20-34` keeps option results fresh for 30 seconds. The separate visible `Error loading options` needs deployed-request diagnosis. |
| Suggested fix | Seed both entity detail and relevant option caches with the returned `EntityOption`, then invalidate option queries after quick-add. Keep the parent selection label directly from the created entity until refetch succeeds. Add a create-in-parent integration test. |
| Confidence | High on visible defect; medium on root cause |

Visible Computer Use steps:

1. In Facility B, open New Storage Bin and choose Add new feedstock type.
2. Create the exact type above and return to the parent form.
3. Observe that the selected label is not reliably displayed.
4. Search the exact new name; observe `Error loading options`.
5. In Facility A, repeat use of the saved type while creating the feedstock bin/intake.
6. Observe the compatible bin is unavailable until the selection is cleared and rebound by scrolling to the type and visibly clicking it.

### F-04 — Successful creates can leave stale, navigation-blocking side sheets

| Field | Detail |
| --- | --- |
| Severity | P2 |
| Type | Reliability / UX |
| Role / facility | Authorized admin / Facilities B and A |
| Route / screen | Orders; similar post-submit behavior on Reactors and Storage |
| Exact input | Valid create submissions, notably `OR-26-001` |
| Expected | On success, the create sheet closes, the new row appears once, and navigation/reload does not warn about unsaved text. |
| Actual | The order persisted and success was visible, but the page remained dimmed by the stale draft sheet. Navigation was blocked. Refresh triggered Safari's unsaved-text warning; discarding the stale page state showed the single persisted order. Reactor and storage creates also displayed success while the create form lingered before eventually clearing. |
| Impact | Operators may submit duplicates, abandon successful records, or lose confidence in whether a transaction committed. |
| Evidence | No dedicated screenshot retained; persistence was confirmed in the Orders list and downstream Delivery selector. |
| Reproducibility | Order 1/1; similar transient behavior observed on reactor and bin creates |
| Root cause | Not confirmed. The handlers call `closeSideSheet()` or `setSideSheet(null)` after awaited mutations (`src/components/orders/order-list.tsx:197-205`, `src/components/reactors/reactor-list.tsx:155-163`, `src/components/storage-locations/storage-location-list.tsx:244-252`), so deployed rendering/navigation state requires instrumentation. |
| Suggested fix | Add an explicit committed/success state, close/reset the form atomically after mutation resolution, ensure dirty-form guards are cleared on success, and disable repeat submit while closing/refetching. |
| Confidence | Medium-high |

Visible Computer Use steps:

1. Submit the valid order form for `OR-26-001`.
2. Observe success while the dimmed create surface remains.
3. Try to navigate away; observe the stale layer blocks ordinary interaction.
4. Refresh; observe Safari's entered-text warning.
5. Choose to discard the page draft state; confirm exactly one order exists.

### F-05 — Delivery failure-recovery sheet blanks valid relationship labels

| Field | Detail |
| --- | --- |
| Severity | P2 |
| Type | Functional / display |
| Role / facility | Authorized admin / Facility B |
| Route / screen | Delivery create failure-recovery/detail sheet for `DL-26-001` |
| Exact input | Valid linked order, customer, facility, and product; failed evidence uploads |
| Expected | The created delivery's recovery/detail sheet retains and displays its saved relationships. |
| Actual | Order, Customer, Facility, and Product displayed as em dashes even though the edit selector retained `OR-26-001` and the refreshed list later showed the relationship. |
| Impact | Operators cannot reliably verify what a partially recovered delivery is linked to and may edit the wrong relationship. |
| Evidence | The blank relation state was observed alongside [the upload failure](artifacts/2026-07-21-ui-only-operational-stress/delivery-evidence-upload-network-failure-sanitized.jpg). |
| Reproducibility | 1/1 failed-upload recovery |
| Root cause | **Source-confirmed.** After create, `src/components/deliveries/delivery-list.tsx:221-249` constructs `createdDelivery` with `orderCode`, `facilityName`, `customerName`, and `biocharProductCode` explicitly set to `null`; on attachment failure it puts that object into edit mode. The sheet renders those flattened fields at lines 465-493 instead of refetching the relation-rich row. |
| Suggested fix | Fetch `useDeliveryWithRelations(created.id)` before entering recovery mode, or preserve relation labels from submitted selections. Never replace known relation data with null placeholders after a successful create. |
| Confidence | High |

Visible Computer Use steps:

1. Create the valid linked delivery with evidence files queued.
2. Let both uploads fail.
3. Observe the app switches to the created delivery's recovery/edit state.
4. Inspect Details and Mass: relationship labels are em dashes.
5. Open the order selector/list later and confirm the saved link exists.

### F-06 — Storage shows a false destructive empty state while loading real bins

| Field | Detail |
| --- | --- |
| Severity | P2 |
| Type | Reliability / UX |
| Role / facility | Authorized admin / Facilities A and B |
| Route / screen | Storage after facility switch or direct navigation |
| Exact input | Switch between populated Facility A and Facility B, then open Storage |
| Expected | A loading skeleton/status persists until the selected facility's bins resolve. |
| Actual | The page shows `0 bins` and `No storage bins yet` for approximately 4–7 seconds before replacing it with the real three-bin inventory. No loading explanation accompanies the empty state. |
| Impact | Operators may create duplicate bins or conclude inventory was lost immediately after a facility switch. |
| Evidence | Final states: [Facility A storage](artifacts/2026-07-21-ui-only-operational-stress/facility-a-isolated-storage-sanitized.jpg) and [Facility B reconciled storage](artifacts/2026-07-21-ui-only-operational-stress/facility-b-post-reconciliation-inventory-sanitized.jpg). No false-empty screenshot retained. |
| Reproducibility | Repeated on both populated facilities and direct navigation |
| Root cause | **Source-confirmed.** `storageLocationsData?.items ?? []` produces an empty array while the query is pending (`src/components/storage-locations/storage-location-list.tsx:219-229`), and lines 432-450 render the empty state solely from `storageLocations.length === 0`, without checking `isLoading`. Stat cards receive the loading flag, but the primary content does not. |
| Suggested fix | Gate the empty state behind `!isLoading`; render lane/list skeletons while pending and retain prior facility data only if clearly labeled. Add a delayed-query facility-switch test. |
| Confidence | High |

Visible Computer Use steps:

1. With Facility B active, open its populated Storage page.
2. Switch to Facility A and navigate to Storage.
3. Observe `0 bins` / `No storage bins yet` before the three real bins appear.
4. Switch back to Facility B and repeat.

### F-07 — Application map preview is unavailable in staging

| Field | Detail |
| --- | --- |
| Severity | P2 |
| Type | Environment / functional |
| Role / facility | Authorized admin / Facility B |
| Route / screen | New Application position picker |
| Exact input | Manual coordinates and address fields for `AP-26-001` |
| Expected | A visible map preview supports coordinate confirmation and practical boundary/location QA. |
| Actual | The picker displayed `Map preview unavailable`. Manual coordinates, address data, and reverse-geocoding-related fields remained usable. |
| Impact | Operators cannot visually catch sign, hemisphere, or location mistakes; this run itself persisted Facility B with positive latitude although the synthetic scenario intended a southern location. |
| Evidence | Visible Computer Use observation; no dedicated screenshot retained. |
| Reproducibility | 1/1 application position picker |
| Root cause | **Source-confirmed configuration gate.** `src/components/forms/position-picker/position-picker.tsx:183-207` renders the map only when `NEXT_PUBLIC_MAPTILER_KEY` is present and otherwise displays the exact unavailable message. |
| Suggested fix | Configure and validate the public MapTiler key in staging, add a deployment smoke check, and retain an explicit coordinate/hemisphere confirmation even when the map is available. |
| Confidence | High |

Visible Computer Use steps:

1. In Facility B, create Application `AP-26-001`.
2. Navigate to the location/position fields.
3. Enter valid coordinates and inspect the preview area.
4. Observe `Map preview unavailable` while manual coordinates remain accepted.

### F-08 — Column chooser state disagrees with the rendered table

| Field | Detail |
| --- | --- |
| Severity | P2 |
| Type | Functional / accessibility |
| Role / facility | Authorized admin / Facility B |
| Route / screen | Reactors → Columns |
| Exact input | Toggle `FacilityName` in the column chooser |
| Expected | The checkbox and table column remain synchronized; a second toggle restores the column. |
| Actual | The Facility column disappeared, but `FacilityName` remained visibly checked and exposed as checked in accessibility state. Clicking again did not restore it. Refresh restored the default column set. |
| Impact | Operators cannot tell which columns are active and may omit context from reviews or exports until they refresh. |
| Evidence | [Column visibility desynchronization](artifacts/2026-07-21-ui-only-operational-stress/table-column-visibility-desync-sanitized.jpg) |
| Reproducibility | 1/1; refresh restored default |
| Root cause | Not confirmed. The control uses a custom visible span plus a screen-reader-only native checkbox (`src/components/ui/data-table/index.tsx:687-709`). State is routed through a callback closed over `columnVisibility` (`:289-296`). The deployed desynchronization needs a focused component reproduction. |
| Suggested fix | Use the native checkbox as the visible control or a tested accessible checkbox primitive, and update visibility with functional state based on the latest table state. Add click and keyboard toggle tests that assert both header visibility and checked state. |
| Confidence | High on visible defect; medium-low on cause |

Visible Computer Use steps:

1. Open the populated Facility B Reactors list.
2. Open Columns.
3. Click `FacilityName` once.
4. Observe the Facility column disappear while the chooser remains checked.
5. Click it again; observe the column does not return.
6. Refresh and confirm the default Facility column returns.

## Observations and hypotheses — not confirmed defects

| ID | Classification | Observation / hypothesis |
| --- | --- | --- |
| OBS-01 | Positive control | No cross-facility transactional leak was reproduced. A/B storage, feedstock, reactors, dashboards, and direct routes stayed aligned with the active facility after loading. |
| OBS-02 | Domain behavior | Supplier, feedstock type, and customer are organization-shared surfaces; their visibility from both facilities was treated as expected, not leakage. |
| OBS-03 | Operator-content risk | Feedstock on hand is explicitly dry mass, while biochar/product cards use wet transaction mass without equally prominent basis labels. The final ledger reconciles, but mixed bases make manual reconciliation error-prone. |
| OBS-04 | Dependency UX | Opening delete on a linked Facility B feedstock bin showed an irreversible confirmation but did not enumerate blocking dependencies. It was cancelled; server-side rejection was not exercised because synthetic data was to remain in place. |
| OBS-05 | Certification guard | Certification routes failed closed to Settings because registry/project credentials were absent. No external registry submission was attempted. |
| OBS-06 | Traceability prerequisite | Traceability showed `No credit batches`; DAG, Map, Sankey, and trail views could not be meaningfully exercised without repeating the full certification workflow, which the brief prohibited unless needed. |
| OBS-07 | Accessibility | Keyboard entry, Enter, Escape, and Tab worked on representative native fields. Custom entity-selector options were difficult to distinguish in Safari accessibility output and required visible coordinate selection for reliable completion. A dedicated screen-reader audit was not performed, so this remains an observation. |
| OBS-08 | Dashboard rounding | Facility B dashboard rounded 400 kg processed to 0.4 t, 135 kg produced to 0.1 t, and a 36 kg application to 0.0 t. Counts matched the chain after loading. |
| HYP-01 | Residual security risk | Owner/Admin/Member authorization boundaries and two-tab stale-session behavior remain unverified; no breach was observed, but only one administrative account was available. |

## Section checklist

| Section | Status | Evidence / blocker |
| --- | --- | --- |
| Governing instructions and prior memory | Pass | Complete brief, `AGENTS.md`, `.claude/CLAUDE.md`, QA skill, Computer Use skill, and automation memory were read before action. |
| Existing empty reset confirmation | Pass | GitHub Actions run #178 visibly successful; reset was not rerun. |
| Staging login | Pass initially; recovery blocked | Authorized admin login succeeded without exposing credentials. Deliberate sign-out later worked; visible AutoFill did not permit re-entry. |
| A. Empty-state onboarding | Pass with findings | One organization and two distinct facilities created; whitespace and coordinate-range validation exercised; draft cancel discarded changes. |
| B. Active-facility context and isolation | Pass with loading defect | Populated A/B records remained isolated; direct B URL selected B; F-06 affects transient trust. Two-tab check untested. |
| C. Roles and permissions | Blocked | Only one authorized administrative account and no test inboxes; no invitations or email sent. |
| D. Storage and inventory integrity | Pass for tested chain | A/B final ledgers reconcile. No transfer UI was found; overdraw, concurrent edits, and exact/over-delivery variants untested. |
| E. Lifecycle and dependency protection | Partial | Representative creates/details/status changes and cancel paths worked. Linked-bin delete was cancelled; destructive dependency rejection and archive/restore matrix remain untested. |
| F. Documents and evidence | Fail | F-02. Two valid delivery evidence fields failed; second entity-type upload not reached after sign-out. |
| G. Tables, filters, and navigation | Partial / fail | Exact and no-match order searches worked after loading; clear restored. F-06 and F-08 confirmed. |
| H. Session and recovery | Partial | Sign-out and back-navigation fail-closed passed. Re-login recovery blocked by visible AutoFill; concurrent tabs and expiry untested. |
| I. Dashboards, maps, and traceability | Partial / fail | A/B dashboards isolated; time/flow toggles worked. F-07; traceability blocked by no credit batch. |
| J. Accessibility and responsive behavior | Partial | Substantial keyboard use and two-step zoom-out/in with reset completed without observed clipping. Exact 200% across list/form/detail, small/mobile viewport, focus-return, and screen reader remain untested. |

## Two-facility isolation matrix

| Check | Facility A | Facility B | Cross-facility result | Status |
| --- | --- | --- | --- | --- |
| Active selector | Selected A and loaded A data | Selected B and loaded B data | Active context followed visible selection | Pass after loading |
| Facility identity | `FAC-26-001`, Switzerland, Europe/Zurich | `FAC-26-002`, Tanzania, Africa/Dar es Salaam | Names/codes distinct | Pass |
| Reactors | `R-26-002` continuous, 1.2 tph | `R-26-001` batch, 2.5 tph | No opposite reactor shown | Pass |
| Storage bins | `SL-26-004`–`006` | `SL-26-001`–`003` | Three bins per facility; no mixing | Pass with F-06 transient false empty |
| Feedstock intake | `FS-26-002`, 450 kg dry | `FS-26-001`, 800 kg dry opening | No opposite intake shown | Pass |
| Production/product/order/delivery/application | None | One of each, `PR/BP/OR/DL/AP-26-001` | A dashboard remained zero for these stages | Pass |
| Shared masters | Same supplier/type/customer visible | Same supplier/type/customer visible | Organization-scoped by design | Pass / expected sharing |
| Create-form ambient context | A records persisted to A | B records persisted to B | No visible facility misassignment | Pass |
| Dependency selectors | A reactor/bin choices stayed A-scoped | B reactor/bin choices stayed B-scoped | No cross-facility option observed | Pass with F-03 quick-add issue |
| Deep link | Not separately exercised | Direct B route selected B | No stale A content after load | Pass |
| Dashboard | 1 intake, 0 later stages | Populated chain metrics | Counts remained isolated | Pass |
| Two-tab context | Untested | Untested | Re-login blocker prevented completion | Blocked |
| Traceability views | No credit batch | No credit batch | No lineage surface to compare | Blocked by prerequisite |
| Documents | No upload attempted | Two failed uploads | Persistence/isolation cannot be judged | Fail / F-02 |

## Role-permission matrix

The product exposes Owner, Admin, and Member membership roles. Platform administration is documented separately. Role switching was not simulated.

| Role/session | View | Create | Edit/status | Delete/archive | Members/settings | Documents | Inventory | Certification | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Provided administrative session | Pass | Pass | Pass for representative operational flows | Confirmation opened/cancelled only | Settings visible; no member mutation | Upload attempted, failed F-02 | Intake/run/product/delivery/reconcile pass | Guarded; no submission | Partial |
| Owner | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | No separately authorized account |
| Admin (separate account) | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | No separately authorized account |
| Member | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | No account/test inbox; invitation prohibited |
| Platform Admin | Untested | Untested | Untested | Untested | Untested | Untested | Untested | Untested | No authorized platform session |

Worst residual authorization risk: facility isolation passed for the administrative session, but least-privilege Member/Admin/Owner boundaries and stale two-tab context remain unverified.

## Storage and inventory reconciliation

### Facility A

| Lane | Opening | Additions | Consumption / allocation | Delivery | Adjustments | Displayed ending | Reconciled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Feedstock dry mass | 0 kg | +450 kg (`FS-26-002`) | 0 kg | 0 kg | 0 kg | 450 kg | Yes |
| Biochar transaction mass | 0 kg | 0 kg | 0 kg | 0 kg | 0 kg | 0 kg | Yes |
| Product transaction mass | 0 kg | 0 kg | 0 kg | 0 kg | 0 kg | 0 kg | Yes |

### Facility B

| Lane | Opening | Additions | Consumption / allocation | Delivery | Adjustments | Displayed ending | Reconciled |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Feedstock dry mass | 0 kg | +800 kg (`FS-26-001`) | −400 kg (`PR-26-001`) | 0 kg | −10 kg stocktake | 390 kg | Yes |
| Biochar wet transaction mass | 0 kg | +150 kg (`PR-26-001`, 135 kg dry) | −100 kg to `BP-26-001` (90 kg dry) | 0 kg | 0 kg | 50 kg | Yes |
| Product wet transaction mass | 0 kg | +100 kg (`BP-26-001`) | 0 kg | −60 kg (`DL-26-001`, 54 kg dry) | −5 kg loss | 35 kg | Yes |

Facility B adjustment details:

- Feedstock stocktake: counted 487.5 kg wet at 20% moisture = 390 kg dry; adjustment −10 kg dry; reason `qa synthetic feedstock count b`.
- Product loss: −5 kg; reason `qa synthetic packaging loss b`.
- Application `AP-26-001` records 40 kg wet / 36 kg dry applied from the delivered material and does not subtract product inventory a second time. The UI separately displayed `Applied 36 kg · 1 application`.

Evidence: [Facility A isolated storage](artifacts/2026-07-21-ui-only-operational-stress/facility-a-isolated-storage-sanitized.jpg), [Facility B final reconciliation](artifacts/2026-07-21-ui-only-operational-stress/facility-b-final-inventory-reconciliation-sanitized.jpg), and [Facility B post-reconciliation inventory](artifacts/2026-07-21-ui-only-operational-stress/facility-b-post-reconciliation-inventory-sanitized.jpg).

Transfer coverage: no facility-to-facility or bin-to-bin transfer workflow was available in the visible UI. Loss and stocktake were the only visible movement actions used. Transfer accounting is therefore untested, not passed.

## Exact created-record and document inventory

All records are synthetic and clearly labelled for staging. They were left in place as instructed.

| Category | Exact records |
| --- | --- |
| Organization | 1 — `QA SANDBOX STAGING 20260721 1344` |
| Facilities | 2 — `FAC-26-001` / `QA SANDBOX STAGING 20260721 FACILITY A` (`adf13db2-cf8b-4e85-8e80-d6f83039247c`); `FAC-26-002` / `qa sandbox staging 20260721 facility b` (`efa2bef1-74b8-4543-82ef-5f1ac083323f`) |
| Reactors | 2 — `R-26-001` / `qa b batch reactor 01`, Batch, 2.5 tph; `R-26-002` / `qa a continuous reactor 01`, Continuous, 1.2 tph |
| Storage bins | 6 — B: `SL-26-001` feedstock 1,500 kg, `SL-26-002` biochar 750 kg, `SL-26-003` pure product 500 kg; A: `SL-26-004` feedstock 900 kg, `SL-26-005` biochar 400 kg, `SL-26-006` product 300 kg |
| Supplier | 1 shared — `SUP-26-001` / `qa shared biomass supplier 20260721`, Tanzania / Arusha, 12.5 km; one supplier location |
| Feedstock type | 1 shared — `FT-26-010` / `qa b woody residue 20260721`, Forestry / Pyrolysis |
| Feedstock intakes | 2 — `FS-26-001`, 1,000 kg wet / 800 kg dry, Facility B; `FS-26-002`, 600 kg wet / 450 kg dry, Facility A |
| Customer | 1 shared — `CUS-26-001` / `qa b soil customer 20260721`; one default location `qa b field plot 01`, Tanzania / Arusha, 25 km |
| Production runs | 1 — `PR-26-001`, 500 kg wet / 400 kg dry consumed, 150 kg wet / 135 kg dry output; Running → Complete, 2026-07-21 14:42–16:00 |
| Biochar products | 1 — `BP-26-001`, source 150 kg, product 100 kg wet / 90 kg dry, pure, density 350 kg/m³ |
| Orders | 1 — `OR-26-001`, 80 kg, loose, value 1,600 TZS |
| Deliveries | 1 — `DL-26-001`, Delivered, 60 kg wet / 54 kg dry, 25 km return trip |
| Applications | 1 — `AP-26-001`, Applied, 40 kg wet / 36 kg dry, 1.2 ha, maize, Mechanical, Inventory source |
| Inventory movements | 2 — product loss −5 kg; feedstock stocktake −10 kg dry |
| Persisted documents | 0 |
| Draft upload attempts | 2 distinct images in two Delivery evidence fields; 3 failed upload requests including retry; failed queue entries removed before final save |
| Invitations / external emails | 0 |
| Registry submissions | 0 |

Additional exact facility configuration:

- Facility A: Switzerland; Europe/Zurich; locality `Zurich QA Sandbox`; address `QA Bern Operations Site`; GPS 47.3769, 8.5417; 1,000-year durability.
- Facility B: Tanzania; Africa/Dar es Salaam; locality `qa arusha sandbox`; address `qa staging plot b`; persisted GPS **+3.3869**, 36.68299; 1,000-year durability. The positive latitude is retained here because it is the exact persisted value and illustrates F-07's visual-verification risk.

## Lifecycle and dependency matrix

| Entity | Create / validation | Detail / edit | Cancel / recovery | Dependency protection | Result |
| --- | --- | --- | --- | --- | --- |
| Organization | Created | Settings visible | Not repeated | Destructive path untested | Partial pass |
| Facility | Two created; whitespace-only name and lat 91/lon 181 rejected | Detail/list persisted | Draft cancel discarded | Archive/delete with dependencies untested | Pass for create/validation |
| Reactor | A/B created with distinct type/capacity | List/detail persisted | Post-create linger observed | Linked-run delete not executed | Pass with F-04 observation |
| Storage location | Six created; capacities/types persisted | Detail and reconcile actions worked | Delete dialog cancelled | Linked-bin server rejection untested | Pass with F-03/F-06 |
| Supplier/location | One shared supplier/location created | Visible from both facilities as shared master | No destructive action | Dependency protection untested | Pass for create/scope |
| Feedstock type | Quick-added and persisted | Visible by later scroll/select | Parent hydration unreliable | Delete protection untested | Fail F-03 |
| Feedstock intake | A/B created; wet/dry math persisted | Lists/storage updated | No destructive action | Linked production protection untested | Pass for tested path |
| Customer/location | One shared customer/default location created | Order/application selectors used it | No destructive action | Dependency protection untested | Pass for tested path |
| Production run | Created Running, completed with timestamps | 400 kg dry consumed / 135 kg dry produced | No destructive action | Incomplete certification warning visible | Pass for tested status path |
| Biochar product | Created from run and allocated to bin | Storage updated | No destructive action | Linked delivery protection untested | Pass for tested path |
| Order | Created and persisted once | Detail opened; mass/status conflict | Stale draft required refresh discard | Linked-delivery delete protection untested | Fail F-01/F-04 |
| Delivery | Created with linked records | Relations blanked in failure recovery; list later correct | Failed attachments removed safely | Delete protection untested | Fail F-02/F-05 |
| Application | Created Applied with location/boundary metadata | Count/dashboard updated | No destructive action | Delete protection untested | Pass with F-07 |

Duplicate identifiers were not broadly testable because operational codes are auto-generated. No destructive confirmation was accepted, consistent with the instruction to preserve synthetic data. Dependency rejection and archive/restore behavior remain untested rather than inferred from read-only source.

## Tables, filters, navigation, and state

- Orders exact-code search returned `OR-26-001` after a loading skeleton.
- A no-match query took roughly three seconds and then showed `No orders found`; Clear restored the row.
- Facility isolation through sidebar selection and direct B URL worked after data loaded.
- Dashboard Month/Week and Overview/Flow toggles rendered and preserved Facility B metrics.
- Table column visibility failed as F-08.
- Storage navigation transiently lied about emptiness as F-06.
- No pagination boundary could be exercised with the intentionally small dataset.
- Back navigation after sign-out stayed on login and did not reveal authenticated content.

## Console and failed-request summary

| Surface | Result |
| --- | --- |
| Visible upload errors | Three `Network Error` outcomes against `fra1.digitaloceanspaces.com` across two Delivery evidence fields |
| Application-visible server errors | Feedstock-type exact search showed `Error loading options` once after quick-add |
| Map runtime/configuration | Explicit `Map preview unavailable`; source confirms missing public map-key branch |
| Browser console | Not inspected before the deliberate sign-out; re-login was blocked. This is untested, not clean. |
| Generic page/server crashes | None observed during the authenticated chain |
| Authentication leakage | None observed; back navigation after sign-out remained fail-closed |

No direct request, API, browser-script, or database inspection was used. The failed-request information above came only from visible application UI.

## Five highest-priority fixes

1. **Make order fulfillment mass-aware.** Derive status from delivered mass against ordered quantity with explicit tolerance, partial, and over-delivery semantics; display count separately.
2. **Repair and smoke-test staging evidence uploads.** Validate presigned PUT headers, object-store CORS, confirmation, persistence, reopen, and download from the deployed browser origin.
3. **Make quick-add atomic in parent selectors.** Seed detail/options caches with the returned entity and prove downstream compatibility selectors update immediately.
4. **Never render an empty storage state while loading.** Gate empty state on query completion and retain an honest loading presentation across facility switches.
5. **Unify side-sheet success/failure hydration.** Clear dirty guards after successful creates and refetch relation-rich records before showing recovery/edit state.

Map configuration and column-toggle accessibility should follow immediately; both are bounded fixes but rank below the data-integrity and evidence failures.

## Worst risks and operator gap

- **Worst security/scoping risk:** no confirmed leak. The largest residual risk is unverified least-privilege behavior for Member/Admin/Owner plus two-tab stale-context behavior. Facility A/B isolation passed for the one administrative session.
- **Worst operator-experience gap:** prerequisite creation is not trustworthy in context. A feedstock type can be successfully created yet remain blank/erroring in the parent selector, forcing clearing, scrolling, and coordinate selection before the downstream bin/intake chain works.
- **Worst confirmed operational risk:** F-01 allows an incomplete physical commitment to be declared fulfilled.
- **Worst evidence risk:** F-02 leaves valid delivery evidence unattached and blocks an auditable certification trail.

## Quick fixes versus product decisions

Likely bounded fixes:

- gate Storage empty state on `!isLoading`;
- hydrate relation labels after Delivery create/failure;
- configure the staging map key and add a smoke check;
- replace the custom column pseudo-checkbox with a synchronized accessible checkbox;
- seed/invalidate entity-selector caches after quick-add;
- clear form dirty state atomically when a create commits.

Product decisions required:

- whether order fulfillment uses wet mass, dry mass, or a product-specific basis;
- tolerance and over-delivery rules, including archived/cancelled deliveries;
- whether storage cards must standardize on dry mass or display both wet and dry mass prominently;
- which roles may create, reconcile, delete/archive, manage documents, and certify;
- whether transfers are a required first-class movement before operational rollout.

## Untested scope and exact blockers

| Scope | Why untested / incomplete |
| --- | --- |
| Owner/Admin/Member permission matrix | Only one authorized administrative account; no test inboxes; invitations prohibited. |
| Two-tab facility and stale-session behavior | Deliberate sign-out ended the authenticated session; visible AutoFill did not permit re-entry. |
| Session expiry and re-login recovery | Natural expiry was impractical; post-sign-out re-login blocked by credential AutoFill. |
| Second entity-type upload | Two fields on Delivery were attempted, but the required cross-entity reproduction was not reached before sign-out. |
| Document persistence/download/delete/versioning | No upload succeeded. |
| Transfer accounting | No visible transfer workflow was found. |
| Partial/exact/over-delivery variants and inventory overdraw | Only one 80 kg order / 60 kg delivery case; no destructive or deliberately invalid stock mutation was submitted. |
| Concurrent edits / optimistic conflicts | Requires a second authenticated tab/session. |
| Full delete/archive/restore dependency matrix | Synthetic data had to remain; linked-bin delete was cancelled at confirmation. |
| Credit-batch DAG/Map/Sankey/trail | No credit batch; repeating the full production-to-certification workflow was excluded unless required. |
| External certification/registry | Explicitly prohibited; configuration also failed closed. |
| Exact 200% zoom on list/form/detail and mobile responsive widths | Two browser zoom-out and zoom-in steps plus reset were checked without observed clipping, but exact 200% and mobile viewport coverage were not completed before sign-out. |
| Dedicated screen-reader and focus-return audit | Practical keyboard/AX inspection was performed, but no dedicated assistive-technology session. |
| Browser console | Not opened before sign-out; visible UI errors are reported above. |

### Authentication recovery blocker

After the deliberate sign-out, Safari returned to `/login?from=%2Fcustomers`. Browser back remained fail-closed at login. The visible AutoFill surface exposed only `Passwords…` and did not fill the authorized credential. Submitting empty fields showed normal email/password validation. No credentials were read from files, commands, environment variables, browser storage, APIs, or source, and no bypass was attempted. Credential-manager screenshots were not retained because they could expose account information.

## Evidence index

- [Reset success](artifacts/2026-07-21-ui-only-operational-stress/reset-empty-staging-success-sanitized.jpg)
- [Visible reset transcription](artifacts/2026-07-21-ui-only-operational-stress/reset-empty-staging-visible-evidence.txt)
- [Two facilities persisted](artifacts/2026-07-21-ui-only-operational-stress/two-facilities-persisted-sanitized.jpg)
- [Facility B bins](artifacts/2026-07-21-ui-only-operational-stress/facility-b-storage-bins-sanitized.jpg)
- [Facility B intake](artifacts/2026-07-21-ui-only-operational-stress/facility-b-feedstock-intake-sanitized.jpg)
- [Facility B completed production run](artifacts/2026-07-21-ui-only-operational-stress/facility-b-completed-production-run-sanitized.jpg)
- [Facility B production-run list](artifacts/2026-07-21-ui-only-operational-stress/facility-b-completed-production-run-list-sanitized.jpg)
- [Delivery upload failure](artifacts/2026-07-21-ui-only-operational-stress/delivery-evidence-upload-network-failure-sanitized.jpg)
- [Facility B final reconciliation](artifacts/2026-07-21-ui-only-operational-stress/facility-b-final-inventory-reconciliation-sanitized.jpg)
- [Facility B post-reconciliation inventory](artifacts/2026-07-21-ui-only-operational-stress/facility-b-post-reconciliation-inventory-sanitized.jpg)
- [Facility A intake](artifacts/2026-07-21-ui-only-operational-stress/facility-a-feedstock-intake-sanitized.jpg)
- [Facility A isolated storage](artifacts/2026-07-21-ui-only-operational-stress/facility-a-isolated-storage-sanitized.jpg)
- [Facility B populated dashboard](artifacts/2026-07-21-ui-only-operational-stress/facility-b-populated-dashboard-sanitized.jpg)
- [Order fulfillment discrepancy](artifacts/2026-07-21-ui-only-operational-stress/order-quantity-fulfillment-discrepancy-sanitized.jpg)
- [Column visibility desynchronization](artifacts/2026-07-21-ui-only-operational-stress/table-column-visibility-desync-sanitized.jpg)

All retained screenshots are cropped/sanitized and contain synthetic staging data only. No credential or personal account surface was retained.

## Computer Use and safety attestation

- Every noma-dmrv and GitHub Actions interaction used visible Computer Use.
- The only transport was the installed bundled `@oai/sky` runtime through the explicitly authorized Node REPL wrapper.
- Accessibility indices, visible keyboard input, scrolling, and coordinate clicks were used only as allowed by the transport amendment.
- No Playwright, Selenium, Puppeteer, Cypress, browser JavaScript evaluation, DOM scripting/inspection, direct HTTP/API calls, `curl`/`fetch`, database/ORM/SQL access, fixture seeding, session/cookie/storage manipulation, or authentication bypass was used.
- Source/CLI inspection was read-only and occurred only after visible reproduction to confirm or narrow root causes.
- No source code was modified or fixed.
- Only this report and sanitized evidence artifacts were created.
- No credentials, secrets, account identifiers, email addresses, tokens, `.env` content, or PII were included in retained evidence or this report.
- No invitation, external email, registry submission, or production action occurred.
- Synthetic staging data remains in place as instructed.

## Final risk verdict

**High-risk — release-blocking for workflows that rely on accurate order completion or delivery evidence.**

The tested administrative facility boundary behaved correctly, and the core physical chain can be completed with workarounds. However, F-01 can certify operational completion without the required mass, and F-02 prevents persistence of the evidence needed to defend delivery and certification claims. The remaining P2 defects further weaken operator trust during prerequisite creation, loading, recovery, mapping, and table configuration.

Minimum exit criteria for a retest:

1. F-01 uses mass-aware fulfillment and passes partial/exact/over-delivery cases.
2. F-02 passes upload, reopen, download, and a second entity type in staging.
3. F-03, F-05, and F-06 pass fresh-empty and facility-switch scenarios.
4. A separately authorized Member plus Owner/Admin session completes the permission matrix.
5. Two-tab context, exact 200% zoom, responsive form/list/detail, and document isolation are visibly verified.
