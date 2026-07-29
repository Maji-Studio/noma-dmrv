# Empty-start production-to-certification QA — 2026-07-15

## Executive summary

Verdict: **Production-blocking** for the tested local staging configuration.

The operator workflow was completed through an eligible, 1000-year credit batch with three independent lab Samples and a locally staged Removal. The final Isometric sandbox submission was attempted twice through the visible UI with live measurement-sample submission enabled. Both attempts failed before any registry write or local `certification_submissions` row was created. The confirmed cause is a connection-pool self-deadlock: the evidence-ledger transaction holds the default pool's only connection and then calls data-access functions through the global pool. The operator sees only “Unable to retire stale certification evidence. Please retry the submission.” after about 10.7 seconds.

The workflow also exposed a high-risk sampling-integrity gap: a Sample dated outside the credit batch's production window was counted toward the three-replicate requirement and made the batch eligible. The date was corrected before the live submission attempt.

The most severe operator-experience gap is that the Removal wizard reports every readiness check as green and invites a sandbox submission, yet the default local/staging DB configuration makes submission structurally impossible and the error does not identify the actionable cause.

### Environment and integrity notes

- Target revision: `origin/staging` at `3653c63239b4efa7a667dd3caac5d29fd2c26b7b`.
- Database: local PostgreSQL, reset from empty with `pnpm db:reset` as explicitly authorized.
- UI: dedicated Google Chrome for Testing, separate from the user's Chrome session.
- Registry: Isometric sandbox project `prj_1K9YJ33RKSBX9FFF` and Removal template `rvt_1KS4S43VPSBXA26X`.
- Submission gates: `ISOMETRIC_ENVIRONMENT=sandbox`; `DURABILITY_MEASUREMENT_SAMPLES_LIVE=true` for the final attempts.
- Important caveat: most entity creation was initially served by the main checkout because an older port-3100 process was discovered to point at that checkout. Both checkouts used the same reset database. The final login, readiness inspection, Removal submission attempts, failure reproduction, and source diagnosis were repeated on the exact `origin/staging` worktree and revision above.
- No source fixes were made. Synthetic records were left in the authorized local database.

## Findings ledger

| ID | Severity | Type | Finding | Status / duplicate |
|---|---|---|---|---|
| F1 | P1 | Reliability / Functional | Removal submission deadlocks with the default one-connection DB pool | New; no matching open issue found |
| F2 | P1 | Data integrity | A Sample outside the credit-batch production window counts toward durability eligibility | New; no matching open issue found |
| F3 | P2 | Reliability / UX | Direct reload/deep link loses the active organization/facility despite a valid `?facility=` | Related to open #253, but same-facility reload loss is not described there |
| F4 | P2 | Data integrity / UX | Reactor nominal throughput entered during creation was not present in the saved row or list total | New observation; reproduction needs one clean repeat |
| F5 | P2 | UX / Data presentation | Supplier list/detail primary “Location” ignores the supplier's created location record | New; source-confirmed presentation mismatch |
| F6 | P2 | Data integrity / UX | Application displayed certification readiness before required application evidence was attached | Related to open #246 |
| F7 | P3 | UX | Dashboard evidence gaps do not make evidence-to-transport attribution discoverable | Observation; may overlap readiness/discoverability issues #246/#265/#380 |

## Review outcomes (2026-07-15 code review)

Each finding was verified against the code (and, for F2, against the authoritative Isometric biochar protocol v1.3 via the registry MCP) before any fix. Remediation branch: `fix/qa-empty-start-remediation`.

| ID | Verdict | Outcome |
|---|---|---|
| F1 | Confirmed | **Fixed** — advisory lock moved to a dedicated connection outside the shared pool (`mirrorDocumentToSourceForUser` opens its own `db.transaction` at `src/fn/certification/sources.ts:543`, so tx-threading alone could not fix this) |
| F2 | Confirmed, but the suggested fix overreaches | **Fixed with protocol correction** — biochar protocol v1.3 §8.3.1 explicitly allows post-production sampling from stored material, so post-window samples must NOT be rejected; they get a warning and are excluded from within-batch temporal-distribution provenance. Pre-window samples (physically impossible) are a hard blocker and rejected at write time |
| F3 | Confirmed mechanism | Deferred — on a direct load with no active organization the org-scoped facilities query returns empty and `facility-provider.tsx:76-82` clears the valid URL facility; entangled with #253 and the multi-tenancy active-org work (#372) |
| F4 | Not reproduced | No change — full mapping chain verified intact (`reactor-form.tsx` `setValueAs: numericValue` → `createReactorFn` → `createReactor` insert); most plausible explanation is the doc's own caveat that early entity creation ran on the older main-checkout process |
| F5 | Confirmed | **Fixed** — list/detail summary now falls back to the default nested supplier location |
| F6 | Confirmed structurally | Deferred to #246 — `deriveEntityCertifyReadiness` has no document/evidence input at all, so the badge cannot see document requirements; needs the unified readiness projection #246 describes |
| F7 | Observation | Deferred — product decision on gap-row attribution, per this doc's own product-decisions list |

### F1 — Removal submission deadlocks with the default one-connection DB pool

- **Severity / type:** P1 · Reliability / Functional
- **Role / facility:** Admin · Noma QA Facility 2026-07-15
- **Route:** `/certification/removals?facility=297aa281-00af-4b8f-9409-35c92ca8595e`
- **Reproduction:** Reset the local DB; create the full eligible chain; link Isometric sandbox; set `DURABILITY_MEASUREMENT_SAMPLES_LIVE=true`; open Removal `d845345e-555f-4ed7-b6cd-e9285c94dedb`; verify all six readiness checks pass; click **Submit Removal**.
- **Input:** One batch (`CB-26-001`), three complete Samples, 0.6 t CO2e UI preview, sandbox registry.
- **Expected:** Evidence ledgers are generated/retired, measurement samples and the Removal are created in Isometric, and the local submission stores remote IDs and `Submitted` status.
- **Actual:** The server action takes 10.7–10.8 seconds, then the wizard shows “Unable to retire stale certification evidence. Please retry the submission.” The Removal stays `Not submitted`. Two attempts produced zero `certification_submissions`, zero generated ledger documents, and no observed Isometric POST. Isometric prerequisite GETs all returned 200.
- **Impact:** Certification cannot complete under the repository's default local/staging DB configuration. GHG Statement and verifier testing are blocked.
- **Evidence:** submission failure screenshot `12-removal-submit-failed.jpeg` (local Computer Use artifact, not checked in); server attempts `56386ce3-7037-40c5-8b7c-292710ca7b4c` and `21e0a06c-faf7-459c-833c-35a1631e2f53`; page-action POSTs returned HTTP 200 after ~10.7 seconds.
- **Reproducibility:** 2/2.
- **Confirmed root cause:** `src/db/index.ts:11-15` defaults `DB_POOL_MAX` to 1. `src/fn/certification/evidence-ledger-core.ts:138-157` holds that connection in a transaction, then `:165-173` calls `listDocumentsByKindForRemoval`, which uses the global `db` at `src/data-access/documents.ts:342-362`. The nested lookup waits for a second connection until `connectionTimeoutMillis` (10 seconds), matching the observed latency. `DB_POOL_MAX` was unset in the tested environment.
- **Suggested fix:** Pass the transaction handle through all ledger data-access operations, or avoid holding a transaction/advisory lock while using the global pool. Add an integration test with `DB_POOL_MAX=1`; preserve the fail-closed retirement behavior, but log the underlying safe error category and return actionable operator copy.
- **Confidence:** High.

### F2 — Out-of-window Sample counts toward durability eligibility

- **Severity / type:** P1 · Data integrity
- **Role / facility:** Admin · Noma QA Facility 2026-07-15
- **Route:** credit-batch durability panel and Removal readiness wizard
- **Reproduction:** Create `CB-26-001` with production window 2026-06-02 through 2026-06-08. Add two in-window Samples. Add `SAM-26-003` with a 2026-07-15 sampling timestamp while still assigning it to the batch. Reopen the batch/removal readiness.
- **Input:** Three complete H/C_org + O/C_org chemistry rows; third timestamp outside the production window.
- **Expected:** The third Sample is rejected, excluded from eligible replicates, or shown as an explicit blocker requiring correction.
- **Actual:** UI reported `3 of 3 usable`, three distinct runs/days, and `Eligible`. After capturing the defect, `SAM-26-003` was corrected to 2026-06-07 before submission.
- **Impact:** An operator can certify a batch using laboratory evidence that is temporally unrelated to the batch, weakening lineage and registry evidence integrity.
- **Evidence:** out-of-window eligibility screenshot `09-out-of-window-sample-counts-eligible.jpeg` (local Computer Use artifact, not checked in).
- **Reproducibility:** 1/1.
- **Confirmed root cause:** `src/fn/certification/durability-readiness.ts:67-80` forwards every batch Sample's chemistry and timestamp without comparing it to the batch window. `src/lib/certification/durability-submission-gates.ts:138-180` evaluates chemistry completeness and provenance distribution, but has no production-window check.
- **Suggested fix:** Validate `samplingTime` against the credit batch and/or linked production-run window at create/update and again in the fail-closed submission gate. Show the offending Sample code and allowed date range.
- **Confidence:** High.

### F3 — Direct reload/deep link loses active organization and facility

- **Severity / type:** P2 · Reliability / UX
- **Role / facility:** Admin · Noma QA Facility 2026-07-15
- **Route:** Reproduced on `/certification/removals` and `/certification/ghg-statements` with a valid `?facility=` query.
- **Reproduction:** Sign in, select Dark Earth Carbon and Noma QA Facility, confirm the routed page displays facility records, then load the same full URL directly or hard-refresh it.
- **Expected:** Organization, facility selector, navigation, and facility records survive refresh.
- **Actual:** The server-rendered page showed generic `User`, omitted organization/facility switchers, and rendered “Select a facility” even though the URL still held the valid facility UUID. Clicking Dashboard internally caused the previous organization/facility to reappear.
- **Impact:** Deep links and refreshes look like missing data, interrupt certification, and can make operators distrust active context.
- **Evidence:** deep-link context-loss screenshot `13-deep-link-loses-facility-context.jpeg` (local Computer Use artifact, not checked in).
- **Reproducibility:** Consistent across multiple direct loads during the final staging pass.
- **Likely root cause:** Client-only resolution in `src/components/navigation/facility-provider.tsx:46-150` depends on an organization-scoped facilities query; when the session's active organization is absent on the direct-load path, the valid URL selection is discarded. Related active-organization resolution is client-side in `src/components/navigation/org-switcher.tsx:34-74`.
- **Suggested fix:** Persist/set the active organization during login/organization entry, resolve the route's facility server-side before rendering a facility-empty state, and add refresh/deep-link E2E coverage. Coordinate with #253's query-sheet reconciliation behavior.
- **Confidence:** Medium-high.

### F4 — Reactor nominal throughput did not persist

- **Severity / type:** P2 · Data integrity / UX
- **Role / facility:** Admin · Noma QA Facility 2026-07-15
- **Route:** Reactor create form and `/reactors`
- **Reproduction:** Create reactor `R-26-001`, entering `1.5` in **Nominal Throughput (tph)**, then reopen/list it.
- **Expected:** Detail and list show 1.5 tph; combined throughput is 1.5 tph.
- **Actual:** List showed combined nominal throughput of 0 tph; the persisted `reactors.nominal_throughput_tph` value was `NULL` in the final read-only reconciliation.
- **Impact:** Capacity planning data can be silently lost after a successful create.
- **Evidence:** reactor list screenshot `03-reactor-list-throughput.png` (local Computer Use artifact, not checked in).
- **Reproducibility:** One observed create; repeat before treating as release-blocking.
- **Source note:** The intended mapping exists (`src/components/reactors/reactor-form.tsx:102-107`, `src/fn/reactors.ts:201-208`, `src/data-access/reactors.ts:314-325`), so the exact loss point was not confirmed.
- **Suggested fix:** Add a browser-level create/reopen test for optional numeric fields and include saved throughput in the success/detail view.
- **Confidence:** Medium.

### F5 — Supplier location presentation ignores nested supplier locations

- **Severity / type:** P2 · UX / Data presentation
- **Role / facility:** Admin · Noma QA Facility 2026-07-15
- **Route:** `/suppliers` and supplier detail
- **Reproduction:** Create `SUP-26-001` with a nested/default supplier location and GPS; return to the list/detail summary.
- **Expected:** Primary/default location appears in the Location column/summary.
- **Actual:** The supplier had a valid nested location, but the list displayed `—` for Location.
- **Impact:** Operators cannot confirm the feedstock source from the main supplier view and may recreate locations or assume GPS is missing.
- **Evidence:** supplier-location screenshot `04-supplier-location-missing-in-list.png` (local Computer Use artifact, not checked in).
- **Reproducibility:** 1/1.
- **Confirmed root cause:** `src/components/suppliers/supplier-list.tsx:52-63` and `supplier-detail.tsx:142-147` render legacy `supplier.location`, while actual locations are separate `supplier_locations` records displayed later in the detail page.
- **Suggested fix:** Return/render the default nested location in supplier summaries, or relabel the legacy field so the two concepts are not conflated.
- **Confidence:** High.

### F6 — Application readiness preceded required evidence

- **Severity / type:** P2 · Data integrity / UX
- **Role / facility:** Admin · Noma QA Facility 2026-07-15
- **Route:** `/applications`
- **Reproduction:** Create `AP-26-001` with application facts but before uploading an application logbook; compare list readiness with the edit form's evidence requirement.
- **Expected:** Certification readiness remains blocked until required application evidence exists.
- **Actual:** List showed `Ready for certification`; edit form showed zero files and required at least one application logbook. The synthetic application logbook was attached before proceeding.
- **Impact:** Readiness badges can overstate evidence completeness and encourage a premature Removal attempt.
- **Evidence:** The post-attachment chain is in the artifact inventory; this mismatch aligns with open issue #246.
- **Reproducibility:** 1/1.
- **Suggested fix:** Make list, detail, and submit gate consume one readiness projection that includes document requirements; link the badge to missing evidence.
- **Confidence:** Medium-high.

### F7 — Evidence-gap attribution is not discoverable

- **Severity / type:** P3 · UX
- **Role / facility:** Admin · Noma QA Facility 2026-07-15
- **Route:** Dashboard and Chain of Custody
- **Reproduction:** Complete the feedstock and delivery/application chain and attach a feedstock weigh ticket and biochar delivery note; inspect Dashboard evidence gaps.
- **Expected:** The UI identifies which transport leg lacks which accepted document type and how to link an existing document.
- **Actual:** Dashboard reported `Feedstock GPS missing 1` and `Distances not document-backed 2` without explaining why the nested supplier GPS or attached transport-supporting documents did not satisfy the gaps.
- **Impact:** Operators cannot confidently close certification evidence gaps without source-code knowledge.
- **Evidence:** The dashboard state was observed during the final pass; document attachment evidence is in screenshots 06 and the artifact inventory.
- **Reproducibility:** 1/1.
- **Suggested fix:** Make each gap row name the entity/leg, accepted evidence types, current linked document, and a direct remediation action.
- **Confidence:** Medium; requirements may intentionally demand a different linkage/document type.

## Stage checklist

| Stage | Result | Evidence / notes |
|---|---|---|
| Empty DB and login | Pass | Empty dashboard captured; admin login restored after reset |
| Organization and facility | Pass | Dark Earth Carbon; Noma QA Facility; facility GPS and 1000-year tier |
| Isometric settings | Pass | Sandbox project/template resolved; prerequisite GETs 200 |
| Reactor and storage | Partial | Reactor and three storage locations created; throughput persistence finding F4 |
| Supplier/location/feedstock | Partial | Records and weigh ticket created; supplier summary finding F5 |
| Production process | Pass | One Method A process linked to the credit batch |
| Production run | Pass | Completed run with mass, energy, five imported readings, and document |
| Product/formulation | Pass / N/A | Pure biochar product created; formulation not applicable |
| Customer/order/delivery/application | Partial | Full chain and documents created; premature application readiness F6 |
| Credit batch | Pass | One feedstock/process/run; 2026-06-02 to 2026-06-08; 0.25 t product attribution |
| Lab characterization | Partial | Three CoAs, valid averages and eligibility after correction; F2 allowed invalid initial date |
| Removal readiness | Pass | One-Sample gate correctly blocked; three-Sample state showed all six checks green |
| Removal submission | Fail | F1; zero remote/local submission rows |
| GHG Statement | Blocked | UI had zero statements; requires submitted Removal; no verifier action attempted |
| Traceability | Partial | Lists/details and dashboard map inspected; DAG/Map/Sankey/trail were not exhaustively reconciled after the terminal failure |
| Refresh/deep-link persistence | Fail | F3 |
| Cross-facility scoping | Not run | Only one facility was authorized/created in this pass; open #253 covers related behavior |
| Narrow viewport/accessibility | Not completed | No full keyboard/screen-reader/narrow-layout audit |

## Created-record inventory

All records below are synthetic and exist only in the authorized local reset database.

| Entity | Identifier / value |
|---|---|
| Organization | Dark Earth Carbon |
| Facility | Noma QA Facility 2026-07-15 (`FAC-26-001`) |
| Certification mapping | Isometric project `prj_1K9YJ33RKSBX9FFF`; template `rvt_1KS4S43VPSBXA26X` |
| Production process | 1 Method A process (`d02de29c-c2ed-47f8-ad49-a2024351b960`) |
| Reactor | `R-26-001` / Noma QA Kiln 01 |
| Storage | `FB-26-001`, `SL-26-001`, `SL-26-002` |
| Supplier + source | `SUP-26-001` plus one nested/default supplier location |
| Feedstock type | `FT-26-001` / Forestry waste |
| Feedstock | `FS-26-001` |
| Production run | `PR-26-001` |
| Biochar product | `BP-26-001` |
| Customer + field | `CUS-26-001`; Noma QA Field 01 |
| Order / delivery / application | `OR-26-001`; `DL-26-001`; `AP-26-001` |
| Credit batch | `CB-26-001` (`fb3920f0-85b3-4b67-8a64-5c477ef0756a`) |
| Samples | `SAM-26-001`, `SAM-26-002`, `SAM-26-003` |
| Local Removal | `d845345e-555f-4ed7-b6cd-e9285c94dedb`, `Not submitted` |
| Transport legs | 2 |
| Documents in DB | 7 (three CoAs plus workflow supporting evidence/readings) |
| External Removal / GHG Statement | None created |

## Supporting-artifact inventory

Artifacts were captured to the local Computer Use output directory during this run and are not checked into the repository. Filenames below are the originals for cross-reference.

- `pdf/synthetic-feedstock-weigh-ticket.pdf`
- `pdf/synthetic-biochar-delivery-note.pdf`
- `pdf/synthetic-application-logbook.pdf`
- `pdf/synthetic-coa-001.pdf`, `synthetic-coa-002.pdf`, `synthetic-coa-003.pdf`
- `qa-readings-valid.csv`, `qa-readings-invalid.csv`
- Screenshots `00` through `13` under `output/screenshots/`

## Reconciliation

| Measure / date | Source records | Downstream value | Result |
|---|---|---|---|
| Feedstock intake | `FS-26-001`: 1,000 kg wet; 800 kg dry; 20% moisture; 2026-06-01 | Run consumed 500 kg wet / 400 kg dry | Consistent; half of intake consumed |
| Production window | `PR-26-001`: 2026-06-02 06:00 to 2026-06-08 16:00 local entry | `CB-26-001`: 2026-06-02 through 2026-06-08 | Consistent at date level |
| Biochar production | Run: 300 kg wet/dry; 0% moisture | `BP-26-001`: 300 kg | Consistent |
| Energy | 5 kWh electricity; 1 L operation diesel; 2 L genset; 1 L preprocessing fuel | Removal preview readiness passed | Values persisted; registry payload not created due F1 |
| Delivery/application | Delivery 250 kg dry on 2026-06-12; application 0.250 t dry on 2026-06-13 | Credit-batch preview attributed 0.25 t | Consistent |
| Sample dates | 2026-06-03, 2026-06-05, 2026-06-07 after correction | Three distinct days | Consistent after correcting F2 test input |
| Total carbon | 80.0%, 81.0%, 79.5% | Mean 80.1667%; sample SD 0.7638% | Reconciled |
| Organic carbon | 80.0%, 80.5%, 79.5% | Mean 80.0000%; sample SD 0.5000% | Reconciled |
| H/C_org | 0.2979, 0.3034, 0.2923 | Mean 0.297867; sample SD 0.005550 | Eligible |
| O/C_org | 0.0563, 0.0578, 0.0548 | Mean 0.056300; sample SD 0.001500 | Eligible |
| Random reflectance R0 | 2.50, 2.60, 2.55 | Mean 2.55; sample SD 0.05 | Reconciled |
| Stored-carbon preview | 0.25 t dry application | UI preview approximately 0.57 t CO2e | Plausible; remote payload unavailable due F1 |
| Removal reporting window / ID | Local values remain unset until submit | No remote ID; no submitted/locked timestamp | Correct fail-closed result for F1 |
| GHG Statement | Requires a submitted Removal | Zero statements | Blocked as expected downstream of F1 |

## Console and network observations

- Isometric `GET /projects`, `GET /projects/{id}/ghg_entry_templates`, and `GET /component_blueprints` repeatedly returned 200 on the exact staging build.
- Both Removal server-action requests returned page-level HTTP 200 after 10.7–10.8 seconds, but the application result was an error. No registry POST was logged.
- No `certification_submissions`, generated evidence-ledger document, external Removal ID, or GHG Statement row existed after the attempts.
- The browser console was not independently exported in this Computer Use setup. No visible browser crash or Next.js error overlay appeared.
- The failure is therefore an internal pool-acquisition timeout carried inside a successful server-action HTTP response, not an HTTP-level Isometric failure.

## Five fixes to prioritize

1. Remove the evidence-ledger pool self-deadlock and add `DB_POOL_MAX=1` integration coverage.
2. Gate Sample timestamps against the credit-batch/production-run window per biochar protocol v1.3 §8.3.1: reject pre-window samples (physically impossible) at write and submit time, but keep post-window stored-material samples usable with a warning and exclude their day from within-batch temporal-distribution provenance rather than hard-rejecting them.
3. Persist and server-resolve active organization/facility context across direct loads and refreshes.
4. Unify list/detail/submit readiness so evidence requirements cannot disagree.
5. Make supplier/default-location and transport-evidence relationships visible in primary operator views.

## Quick UX wins vs product decisions

Quick wins:

- Include the failed evidence-ledger stage and retry guidance in the Removal error.
- Link each dashboard evidence gap to the exact leg/entity and accepted evidence type.
- Render the default nested supplier location in the supplier list.
- Display persisted nominal throughput on the reactor success/detail state.
- Explain that the default 30-day dashboard period excludes this June cohort when viewed on July 15.

Product/design decisions:

- Sample-vs-window policy is resolved (§8.3.1): pre-window samples are rejected and post-window stored-material samples are permitted with a warning; the remaining decision is what registry-facing note, if any, should accompany a warned post-window sample.
- Complete #253's facility-reconciliation policy for query-param sheets and same-facility refreshes.
- Decide which documents satisfy “distance document-backed” and whether entity attachments automatically bind to transport legs.
- Decide whether application list readiness is operational readiness or certification readiness; label and gate accordingly.

## Incomplete adversarial coverage

The terminal Removal failure prevented remote-ID/status reconciliation, GHG Statement creation/submission, verifier lifecycle/history checks, and post-submission immutability testing. This pass also did not complete destructive parent-delete tests, second-facility scoping, repeated ordinary draft double-clicks, oversized/unsupported uploads, exhaustive extreme numeric cases, a narrow-viewport audit, or a full keyboard/screen-reader audit. The invalid readings CSV was prepared but should not be treated as a completed negative-import result in this ledger.

No GitHub issues were opened automatically. F1 and F2 are new, obvious engineering fixes; F3 should be reconciled with #253; F6 should be added to #246. Per the QA workflow, product/design-decision issue bodies should be shown to the user before filing.
