# Entity pass matrix — QA-B `d3f5`

Legend: **Pass** verified; **Fail** confirmed defect; **Partial** core path verified but one requested dimension was not completed; **Not run** deliberately left untouched to preserve concurrent isolation.

| Entity | QA-B record(s) | Create / save | List / detail | Downstream / context | Date / mode / controls | Result |
|---|---|---|---|---|---|---|
| Organization | E2E QA-B Organization 20260720-d3f5 | Created through admin UI; slug conflict appeared after record existed | Selected exact org in sidebar | Facility creation inherited org | Concurrent create feedback ambiguous | Partial |
| Facility | `FAC-26-001` | Whitespace rejected; valid Switzerland/Europe-Zurich facility saved | List and sidebar selection verified | Inherited by every QA-B operational record | View context survived normal routes; one transient dashboard miss recovered on reload | Pass with environment observation |
| Reactor | `R-26-001` | Negative throughput rejected; 1.5 t/h saved | List and run selector verified | Runs inherited facility/reactor | Status/list colors visually distinct; sorting not exhaustively exercised | Pass |
| Supplier + location | `SUP-26-001` + E2E QA-B Supplier Location 20260720-d3f5 | Negative distance rejected; 30 km location saved | Supplier list verified | Immediately selectable in intake; derived 30 km leg in Map/Trail | Existing-location edit affordance was not exposed in the sheet | Partial |
| Vehicle quick-add | E2E QA-B Vehicle 20260720-d3f5 | Created inside intake | N/A | Selected immediately after quick-add | No standalone detail pass | Pass for quick-add |
| Feedstock type quick-add | E2E QA-B Feedstock Type 20260720-d3f5 | Created inside intake | Reused by batches | Selected immediately | Used by both credit batches | Pass |
| Feedstock bin quick-add | `FB-26-001` | Created inside intake | Visible in storage/run selectors | Selected immediately | Stock availability later reported accurately | Pass |
| Feedstock Delivery + Feedstock | `FS-26-001` | Moisture 101 rejected; create documents saved; 2,100 kg allocation over 2,000 kg delivery wrongly saved | List, DAG, Map, Trail, dashboard verified | Available in source-bin allocations and lineage | Jul 14 remained Jul 14; mass integrity failed | **Fail** — QA-B-D3F5-002 |
| Production Run | `PR-26-001..004` | Draft/running/complete/failed/cancelled exercised; overdraw, overlap, missing end/reason blocked | List and read-only detail verified | PR-001/002 selectable in batches; PR-001 in full lineage | Jul 15/16/17/18 preserved; view had Edit/Close only | Partial: telemetry import and plausibility defects |
| Output bin quick-add | `BB-26-001` | Created in run form | Visible in later run selectors | Selected immediately | Stock destination reused | Pass |
| Sample | `SAM-26-001..003` | 101% carbon and pH 15 rejected; three independent 1000-year samples saved | List showed all three and correct durability | All linked to `CB-26-001`; batch auto-selected on repeat create | Jul 15 sampling times persisted; contradictory chemistry accepted | **Fail** — QA-B-D3F5-003 |
| Biochar Product | `BP-26-001` | Created from `PR-26-001`; product bin quick-added and auto-selected | List showed 150 kg wet / 142.5 kg dry | Immediately selectable by order; lineage and stock showed 50 kg remaining | Jul 15 preserved | Pass |
| Customer + location | `CUS-26-001` + E2E QA-B Customer Location 20260720-d3f5 | Created through one sheet | List and view/edit mode verified | Location enabled immediately after customer selection; 20 km leg in Map/Trail | Existing location could not be edited in exposed customer sheet | Partial |
| Order | `OR-26-001` | 100 kg loose order saved | List/status “No deliveries” verified | Product/customer/location selectors correct; later changed to fulfilled by delivery | Jul 17 remained Jul 17 | Pass |
| Delivery | `DL-26-001` | Delivered 100 kg wet / 95 kg dry with bill of lading | List showed Delivered / Fields complete | Order, customer and application selector verified; Trail retained file | Jul 18 remained Jul 18 | Pass |
| Application | `AP-26-001` | 80 kg wet / 76 kg dry, manual, visual proof, three documents | List, view and edit verified | Appeared in batch, DAG, Sankey, Trail and dashboard | Jul 19 preserved; read-only had no file inputs; delete/re-add evidence refreshed live | Pass; legitimate geotag gap remained |
| Credit Batch | `CB-26-001`, `CB-26-002` | >1-month window rejected; both one-day batches saved | Cards showed one run, pending and one cert gap | CB-001 full chain; CB-002 empty application state | Jul 15/16 windows preserved; radio selection and Trail state survived reload | Pass |

## List-control coverage

- Search, status/customer/batch filters, rows-per-page controls, and “Page 1 of 1” pagination rendered on the relevant lists.
- The created records appeared in their lists without reload after saves.
- Search/sort combinations were not repeated for every entity because all QA-B lists were single-page and the shared development server was recompiling under two concurrent QA threads. No pagination or sorting defect was asserted.
- Status labels observed: Draft, Running, Complete, Failed, Cancelled, Pending, Delivered and Applied; visual treatments were distinct in screenshots. Formal contrast measurement was not run.

## Isolation

- Every selected record name was exact-matched to QA-B `d3f5` or was a QA-B code generated by the application.
- No QA-A or QA-C entity was selected, edited, deleted, archived or cleaned up.
- No facility selector exposed a QA-A/C record during the captured exact-selection interactions; organization-global scoping issue #456 remains a code/recon concern rather than a newly reproduced selector defect in this pass.
