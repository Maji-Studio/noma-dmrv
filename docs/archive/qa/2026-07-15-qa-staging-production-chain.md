# Staging production-chain QA — 2026-07-15

## Executive summary

Verdict: **Production-blocking for certification**, while the local operational chain is usable with caution.

The staging database was reset from empty through the repository's authorized GitHub workflow, then the application was operated through its visible browser UI as a first-time administrator. One synthetic cohort was taken from facility setup through feedstock, production, product, customer, order, delivery, application, a 1000-year credit batch, three lab Samples, and all three Chain of Custody views.

The local mass lineage reconciles: 800 kg dry feedstock entered production, 315 kg dry biochar was produced, 270 kg dry was delivered and applied, and 45 kg dry remains in storage. DAG, Map, and Sankey agree with those quantities.

Certification could not proceed to a Removal/GHG Entry or GHG Statement for two independent staging blockers:

1. The empty reset left the Isometric sandbox integration without organization credentials or a facility project link. The Removals route redirects to Certification Settings, where the UI reports `Credentials: Not configured` and blocks submission.
2. The supporting-document flow fails during the browser-to-storage PUT with `Upload network error`. The tested weighbridge ticket never became attached; the same shared upload path is used by production readings, delivery/application evidence, and lab reports.

No registry write, Removal, GHG Statement, or verifier submission occurred. No source fixes were made.

The worst operator-experience gap is the disagreement between readiness surfaces: feedstock and application rows display **Ready for certification**, and the dashboard says those pipeline stages are **All clear**, while the dashboard simultaneously reports missing feedstock GPS/application evidence and the forms show zero attached evidence. This can send an operator toward certification with an incomplete record.

### Environment and safety

- Target: `https://staging.noma.maji.studio/`
- Role: Admin
- Organization: Dark Earth Carbon
- Facility: `FAC-26-001` — QA Zurich Biochar Facility 2026-07-15
- Registry environment shown by the UI: Isometric sandbox
- Reset: GitHub Actions run [29419015472](https://github.com/Maji-Studio/noma-dmrv/actions/runs/29419015472), action `reset-empty-staging`; completed successfully with schema verification
- Test data: synthetic staging-only measurements and documents, visibly marked as QA fixtures
- Source inspection: read-only only
- Source changes/fixes: none
- Credentials and secrets: omitted from this report

## Findings ledger

| ID | Severity | Type | Finding | Reproducibility |
|---|---|---|---|---|
| S1 | P1 | Reliability / Functional | Supporting-document upload fails with `Upload network error` | 1/1 attempted file; shared path affects all document slots |
| S2 | P2 | Functional / UX | Production-run facility link opens a nonexistent route and returns 404 | 1/1 |
| S3 | P2 | Data integrity / UX | Sample form accepts Surface Area, but the saved record always displays `—` | 1/1; source-confirmed |
| S4 | P2 | Data integrity / UX | Application and feedstock readiness overstate completeness without required evidence | Consistent; known structural issue / duplicate of prior F6 and #246 |
| S5 | P2 | UX / Reliability | Dashboard readiness messages contradict one another and the entity forms | 1/1; consequence of S4 plus separate dashboard projections |
| S6 | P2 | Reliability / UX | Newly created feedstock storage bin is absent after a success toast until reload | 1/1 |
| S7 | P3 | UX | Credit-batch editor says both `1 selected` and `No runs ... fall within the production window` | 1/1 |
| B1 | Blocker | Environment | Isometric credentials and facility project link are absent after the authorized empty reset | Consistent |

### S1 — Supporting-document upload fails with a network error

- **Severity / type:** P1 · Reliability / Functional
- **Role / facility:** Admin · FAC-26-001
- **Route/screen:** `/feedstocks`, feedstock detail, Transport evidence
- **Steps:** Open `FS-26-001`; choose the synthetic PDF `feedstock-weighbridge-ticket.pdf`; wait for the upload result.
- **Input:** 2.4 KB non-sensitive synthetic PDF marked as a staging QA fixture.
- **Expected:** The PUT completes, the upload is confirmed, the file appears in the evidence list, and the record's evidence/readiness refreshes.
- **Actual:** The file row ends in `Upload network error`; reopening shows no attached evidence. The record remains usable, but its document is absent.
- **Impact:** Production readings, feedstock transport evidence, delivery evidence, application logbooks, and lab reports cannot be proven through the normal workflow. That prevents a defensible Removal package even if registry credentials are restored.
- **Evidence:** [07-feedstock-evidence-upload-network-error.png](./artifacts/2026-07-15-staging/07-feedstock-evidence-upload-network-error.png)
- **Console/network:** No console warning/error was captured in the separate in-app browser. The visible error is emitted by the XHR `onerror` branch; the failing request's URL/status was not available from the browser harness.
- **Likely cause:** The application successfully reaches the presign step and fails during the client PUT. `src/hooks/use-file-upload.ts:74-81` maps a non-HTTP XHR failure to this exact message. A storage endpoint/CORS configuration problem is the leading hypothesis, but is not source-confirmed without the failed request details.
- **Suggested fix:** Inspect the staging storage bucket/endpoint CORS and presigned URL origin; capture and surface the destination host and safe failure category; add a staging smoke test that uploads and confirms a small PDF and CSV.
- **Confidence:** High that the upload path is broken; medium on the environmental cause.

### S2 — Production-run facility link returns 404

- **Severity / type:** P2 · Functional / UX
- **Role / facility:** Admin · FAC-26-001
- **Route/screen:** `/production-runs`
- **Steps:** Locate `PR-26-001`; click the Facility value `QA Zurich Biochar Facility 2026-07-15`.
- **Input:** Existing, authorized facility link rendered by the table.
- **Expected:** The facility detail/settings screen opens.
- **Actual:** Browser navigates to `/facilities/3cae7289-a51b-4ded-8e1b-e9c85340bd6d` and renders `404 — This page could not be found.`
- **Impact:** An ordinary table link is a dead end and drops the operator out of the application shell.
- **Evidence:** [08-production-run-facility-link-404.png](./artifacts/2026-07-15-staging/08-production-run-facility-link-404.png)
- **Root cause:** Source-confirmed at `src/components/production-runs/production-run-list.tsx:107-113`: it builds `/facilities/${facilityId}`, but the route inventory contains no corresponding facility detail page.
- **Suggested fix:** Link to `/facilities?facility=<id>` or add the intended detail route. Add a route-level link test.
- **Confidence:** High.

### S3 — Sample Surface Area is accepted and silently discarded

- **Severity / type:** P2 · Data integrity / UX
- **Role / facility:** Admin · FAC-26-001
- **Route/screen:** `/samples`, Create/Edit Sample
- **Steps:** Create `SAM-26-001`; enter `100` in **Surface Area (m²/g)**; save; reopen after a hard navigation.
- **Input:** 100 m²/g.
- **Expected:** Detail shows `100 m²/g` and edit mode reloads the saved value.
- **Actual:** Save succeeds, but detail shows `Surface Area —`.
- **Impact:** An operator can believe a laboratory property was recorded when the system has dropped it. The same issue applies structurally to the exposed Volatile Matter field.
- **Evidence:** The detail state is visible in [10-lab-analysis-date-dropped-after-success.png](./artifacts/2026-07-15-staging/10-lab-analysis-date-dropped-after-success.png); the Surface Area row is `—`.
- **Root cause:** Source-confirmed. `src/data-access/samples.ts:299-304` and `:399-403` hard-code `volatileMatterPercent` and `surfaceAreaM2PerG` to `null` because they are absent from the current DB schema. The form nevertheless renders and submits both fields.
- **Suggested fix:** Either add and map the columns end-to-end, or remove/disable the fields with explicit “not stored yet” copy. Never return success for discarded inputs.
- **Confidence:** High.

### S4 — Entity readiness ignores required evidence

- **Severity / type:** P2 · Data integrity / UX
- **Role / facility:** Admin · FAC-26-001
- **Route/screen:** `/feedstocks`, `/applications`
- **Steps:** Create a local, unregistered feedstock type and intake without an attached weighbridge ticket; create a boundary-record application with a GIS reference but no uploaded logbook; inspect list badges and edit forms.
- **Input:** `FS-26-001`; `AP-26-001`; zero confirmed documents.
- **Expected:** Both rows remain incomplete, naming the missing registry/evidence requirements.
- **Actual:** Both rows display **Ready for certification**. Application edit explicitly says `0 files` and requires a GIS reference plus at least one logbook document. The feedstock upload itself failed.
- **Impact:** Operators can mistake data-entry completeness for certification evidence completeness and attempt a Removal prematurely.
- **Evidence:** [12-application-ready-zero-files.png](./artifacts/2026-07-15-staging/12-application-ready-zero-files.png), [07-feedstock-evidence-upload-network-error.png](./artifacts/2026-07-15-staging/07-feedstock-evidence-upload-network-error.png)
- **Root cause:** Source-confirmed structurally. `src/components/applications/application-list.tsx:144-149` calls `deriveEntityCertifyReadiness` with the application row only. `src/lib/certification/entity-readiness.ts:129-161` checks lifecycle, telemetry for production runs, and registered fields, but has no document input. This is the same class as prior QA F6 and open readiness unification work (#246); the current local branch already contains related credit-batch improvements that are not deployed to staging.
- **Suggested fix:** Drive list, detail, dashboard, and Removal gates from one server-derived readiness projection that includes documents, transport provenance, registry mapping, and accepted evidence types.
- **Confidence:** High.

### S5 — Dashboard readiness contradicts itself

- **Severity / type:** P2 · UX / Reliability
- **Role / facility:** Admin · FAC-26-001
- **Route/screen:** `/dashboard`
- **Steps:** Complete the local chain without successful uploads; reopen Dashboard.
- **Expected:** One coherent account of what is complete, what is blocked, and the next action.
- **Actual:** The Action center shows `Production PR-26-001 — Needs fixing` beside `Every record check passes`; it reports four evidence gaps, including one application evidence gap, while Pipeline says Applications are `All clear`. Feedstock is `All clear` while `Feedstock GPS missing 1` is open. Products show one item needing attention without an explanation in the pipeline row.
- **Impact:** The main operator landing page cannot be trusted as a readiness guide.
- **Evidence:** [11-dashboard-readiness-contradictions.png](./artifacts/2026-07-15-staging/11-dashboard-readiness-contradictions.png)
- **Likely cause:** Multiple projections with different grains and requirements are rendered together; S4 explains the document-blind entity badges. Exact dashboard aggregation paths were not exhaustively diagnosed.
- **Suggested fix:** Reuse a single readiness model, distinguish “record fields complete” from “certification evidence complete,” and make every non-green state link to a specific remediation.
- **Confidence:** High on the UI contradiction; medium on the complete root cause.

### S6 — Storage creation success precedes list persistence

- **Severity / type:** P2 · Reliability / UX
- **Role / facility:** Admin · FAC-26-001
- **Route/screen:** `/storage-locations`
- **Steps:** Create `QA Feedstock Bin`; observe the success toast and list count; wait; hard reload.
- **Input:** Feedstock bin, 2,500 kg capacity, `QA Forestry Residues`.
- **Expected:** The new row and count appear as soon as success is shown and the bin is immediately selectable.
- **Actual:** Success is shown while the list remains at two bins and omits the new record; a hard reload shows the persisted third bin.
- **Impact:** Operators may repeat creation and risk duplicates, or assume the save failed.
- **Evidence:** [06-storage-success-stale-list.png](./artifacts/2026-07-15-staging/06-storage-success-stale-list.png)
- **Source note:** `src/hooks/use-storage-locations.ts:186-203` starts invalidations but does not await them or insert the new item into list caches. This explains a visible race, though the unusually long stale state was not instrumented.
- **Suggested fix:** Await/refetch the active list before closing/showing success, or merge the returned row into matching list caches. Disable duplicate save while reconciliation completes.
- **Confidence:** Medium-high.

### S7 — Credit-batch run copy is internally contradictory

- **Severity / type:** P3 · UX
- **Role / facility:** Admin · FAC-26-001
- **Route/screen:** `/credit-batches`, Edit `CB-26-001`
- **Steps:** Create a batch with `PR-26-001`; reopen Edit.
- **Expected:** The selected run is shown, with a separate empty message only for additional eligible runs.
- **Actual:** The same section shows `1 selected` and `No runs of this feedstock type fall within the production window.`
- **Impact:** The operator cannot tell whether the selected run is still valid or has fallen out of scope.
- **Evidence:** Browser DOM capture during the run; no dedicated screenshot.
- **Suggested fix:** Change the empty copy to `No additional eligible runs` when selected membership is non-empty, and show the selected run inline.
- **Confidence:** High on the copy; medium on intended selection semantics.

### B1 — Isometric integration is not configured after reset

- **Classification:** Environment blocker, not counted as an application defect.
- **Role / facility:** Admin · FAC-26-001
- **Route:** `/certification/settings`
- **Actual:** Sandbox environment; `Credentials: Not configured`; no project link. The Credit Batch has one certification gap (`No certifier`). `/certification/removals?facility=...` redirects to Settings.
- **Impact:** No Removal can be created or submitted, and therefore no GHG Statement or verifier submission can exist.
- **Evidence:** [03-isometric-credentials-not-configured.png](./artifacts/2026-07-15-staging/03-isometric-credentials-not-configured.png)
- **Reset observation:** The authorized empty-reset workflow loads database/admin secrets but not the Isometric access token/client secret, so the integration was not reconstructed.
- **Required remediation:** Configure the staging organization credentials through the authorized admin UI/secrets process, then link FAC-26-001 to the correct sandbox project and template. Credential retrieval/transmission was not implicitly authorized and was not attempted.

## Stage checklist

| Stage | Result | Notes |
|---|---|---|
| Reset, login, empty state | Pass | Authorized GitHub reset completed; empty dashboard captured |
| Organization/facility/context | Pass | Facility created with Zurich GPS, Europe/Zurich, 1000-year durability |
| Facility validation | Pass | Required fields and latitude 91 rejected inline; entered data preserved |
| Isometric settings | Blocked | B1: credentials not configured; no project link |
| Reactor | Pass | `R-26-001`, rotary kiln, 0.5 tph; empty/negative validation exercised |
| Storage | Partial | Three bins persisted; S6 stale success/list state |
| Supplier and source location | Pass | Default location, GPS, and distance created |
| Feedstock type | Partial | Local General type created; UI warned it cannot pass Isometric verification |
| Feedstock intake | Partial | Mass/allocation correct; S1 prevented evidence attachment; readiness overstated |
| Production process | Derived | Batch reports Method A; no separate operator record was required in this deployed flow |
| Production run | Partial | Complete mass/energy run; readings remain absent because upload path was not usable |
| Biochar product | Pass | Pure product created from run into product bin |
| Customer/location | Pass | Customer plus GPS-pinned default destination |
| Order | Pass | 300 kg order created and searchable |
| Delivery | Partial | 300 kg wet / 270 kg dry delivered; document slot present, upload path blocked |
| Application | Partial | 300 kg wet / 270 kg dry applied; GIS reference saved; no logbook attachment; S4 |
| Credit batch | Pass locally | One feedstock, one-day window, one run, one application, Method A |
| Lab Samples | Partial | Three chemistry-complete 1000-year Samples; clustered-run/day warning shown; zero lab reports attached |
| Removal/GHG Entry | Blocked | B1 redirects Removals to Settings; no local Removal created |
| GHG Statement | Blocked | Requires a submitted Removal |
| Registry/verifier submission | Blocked | No project/credentials and no complete evidence package |
| Chain DAG | Pass | Full local entity chain visible |
| Chain Map | Pass | Supplier 28 km, facility, application 35 km shown |
| Chain Sankey | Pass | 800 → 315 → 270 kg dry with 485 kg conversion loss and 45 kg storage remainder |
| Search/filter | Pass | Production search no-match/match and Complete status filter behaved correctly |
| Invalid facility scope | Pass | Random valid UUID produced Select-a-facility state and exposed no records |
| Refresh/reopen persistence | Pass with caveat | Core records and quantities survived direct navigation; native date-input automation was not treated as a product finding |
| Two-facility switching/deep-link | Not run | User authorized creation of one facility only |
| Oversized/unsupported upload | Not run | Small valid upload already failed at the base path |
| Narrow viewport/screen reader | Not completed | Normal laptop viewport and accessible-name navigation only |

## Created-record inventory

All records are synthetic staging QA data.

| Entity | Identifier / value |
|---|---|
| Organization | Dark Earth Carbon |
| Facility | `FAC-26-001` — QA Zurich Biochar Facility 2026-07-15 |
| Reactor | `R-26-001` — QA-RK-01 |
| Storage bins | `SL-26-001` QA Biochar Bin; `SL-26-002` QA Product Bin; `SL-26-003` QA Feedstock Bin |
| Supplier | `SUP-26-001` — QA Alpine Biomass Cooperative |
| Supplier location | QA Winterthur Source Yard; 28 km one-way |
| Feedstock type | `FT-26-001` — QA Forestry Residues; local General/Forestry/Pyrolysis |
| Feedstock | `FS-26-001` |
| Production run | `PR-26-001` |
| Biochar product | `BP-26-001` — Pure biochar |
| Customer | `CUS-26-001` — QA Regenerative Farm 2026-07-15 |
| Customer/application location | QA Zurich Application Plot; 35 km one-way |
| Order | `OR-26-001` |
| Delivery | `DL-26-001` |
| Application | `AP-26-001` — QA-PLOT-001 |
| Credit batch | `CB-26-001` |
| Samples | `SAM-26-001`, `SAM-26-002`, `SAM-26-003` |
| Confirmed attached documents | 0; one feedstock upload failed before confirmation |
| Removal / GHG Entry | None |
| GHG Statement | None |
| External registry artifacts | None |

## Supporting-artifact inventory

Created locally under `output/pdf/staging-qa-2026-07-15/`:

- `feedstock-weighbridge-ticket.pdf`
- `delivery-receipt.pdf`
- `application-affidavit.pdf`
- `lab-report-1.pdf`
- `lab-report-2.pdf`
- `lab-report-3.pdf`
- `reactor-readings.csv`
- `reactor-readings-current.csv`

Every PDF is marked `STAGING QA TEST FIXTURE - NOT VALID OPERATIONAL EVIDENCE`.

Screenshots are under `docs/qa/artifacts/2026-07-15-staging/`.

## Reconciliation

| Measure/date | Source | Downstream | Result |
|---|---|---|---|
| Feedstock intake | FS-26-001: 1,500 kg wet, 20% moisture, 1,200 kg dry | Chain shows 1,200 kg total dry and 800 kg used | Consistent; 400 kg dry remains unconsumed |
| Run window | PR-26-001: 2026-07-15 15:58–16:05 Europe/Zurich | CB-26-001: 2026-07-15 through 2026-07-15 | Consistent at date level |
| Feedstock used | Run: 1,000 kg wet, 20%, 800 kg dry | Dashboard: 0.8 t processed | Consistent |
| Biochar output | Run: 350 kg wet, 10%, 315 kg dry | BP-26-001: 350 kg wet / 315 kg dry | Consistent |
| Yield | 315 / 800 kg dry | Dashboard/Sankey: 39.4% | Consistent |
| Product disposition | 350 kg wet product | 300 kg wet delivered + 50 kg wet stored | Consistent |
| Dry disposition | 315 kg dry product | 270 kg dry applied + 45 kg dry stored | Consistent |
| Order/delivery/application | Order 300 kg; delivery 300 kg wet / 270 kg dry; application 300 kg wet / 270 kg dry | Chain and dashboard: 0.3 t displayed | Mass lineage consistent; dashboard/card rounding does not distinguish wet from dry |
| Energy | 5 L startup/plant diesel; 0 L genset; 0 L preprocess; 120 kWh electricity | Credit-batch input summary | Values persisted |
| Sample total C | 75%, 75%, 75% | Mean 75%; sample SD 0 | Reconciled |
| Sample organic C | 72%, 71%, 73% | Mean 72%; sample SD 1.0 percentage point | Reconciled |
| H:Corg | 0.463, 0.487, 0.490 | All below 0.5 | Eligible |
| Oxygen inputs | 6.0%, 6.3%, 6.1% | Derived O:Corg remains below 0.2 | Eligible |
| R₀ reflectance | 2.1%, 2.1%, 2.1%; 90% readings ≥2%; n=100 each | 1000-year on all Samples | Consistent |
| TGA residual carbon | 68%, 68%, 68% | 1000-year durability fields complete | Consistent |
| Sample timing | 16:16, 16:16, 16:18 on 2026-07-15 | UI: `3 of 3 usable`, `Clustered on one run/day`, `Eligible` | Warning is accurate; post-production sampling can represent stored material |
| Removal/GHG Statement | No facility certifier project | None | Blocked as expected by B1 |

## Console and network observations

- In-app browser error/warn log export: no entries.
- Visible failed upload: `Upload network error` during the presigned storage PUT path.
- No Next.js error overlay or browser crash occurred.
- Isometric health screen: Sandbox; credentials not configured.
- No registry POST or verifier action was possible or attempted.
- Exact failed storage request URL/status was not exposed by the browser harness; S1's environmental cause remains a hypothesis.

## Five fixes to prioritize

1. Restore and continuously smoke-test staging object storage uploads for one PDF and one CSV.
2. Unify entity, dashboard, credit-batch, and Removal readiness around one evidence-aware projection.
3. Fix the production-run facility link so it cannot route to a nonexistent page.
4. Remove or persist Sample fields that are currently accepted and silently discarded.
5. Make create success transactional from the operator's perspective: update/refetch the active list before closing and announcing success.

## Quick UX wins vs product decisions

Quick wins:

- Change the credit-batch empty copy to `No additional eligible runs` when a run is already selected.
- Link every dashboard gap to the exact entity, missing artifact, accepted evidence type, and remediation action.
- Label dashboard masses explicitly as wet or dry instead of rounding both to `0.3 t`.
- Replace raw `Upload network error` with an actionable storage failure message and a retry that preserves the chosen file.
- Hide dead facility links until a valid destination exists.

Product/design decisions:

- Decide whether local/unregistered feedstock types should ever appear ready on operational lists.
- Decide which readiness level each screen represents: record completeness, evidence completeness, registry-mapping completeness, or final submit readiness.
- Decide whether unsupported laboratory properties should be removed or added to the canonical schema.
- Decide whether an empty-reset workflow should also reconstruct staging sandbox integration mappings, or explicitly document them as a post-reset runbook step.

## Uncompleted steps and exact blockers

- **Readings and supporting documents:** blocked by S1; no legitimate UI workaround was used.
- **Removal/GHG Entry creation:** blocked by B1; the app redirects the Removals hub to Settings until the facility is linked.
- **Registry submission:** blocked by both B1 and the incomplete evidence package caused by S1.
- **GHG Statement and verifier status:** requires a submitted Removal.
- **Two-facility switching/cross-facility deep link:** only one facility was authorized for creation. A fake UUID was tested and failed closed.
- **Oversized/unsupported upload:** not meaningful while a small valid file cannot traverse the base upload path.
- **Narrow viewport/full accessibility audit:** outside the completed timebox; accessible names and keyboard-focusable controls were used during browser operation.

## Final verdict

**Production-blocking** for the requested production-to-certification workflow on staging.

The local operational lineage is coherent and traceable through a complete application and three eligible 1000-year Samples. However, evidence cannot be attached, readiness displays overstate completeness, and the staging Isometric integration is absent after reset. Until uploads and integration configuration are restored and the readiness projections agree, this workflow should not be treated as safe for routine certification or verifier submission.
