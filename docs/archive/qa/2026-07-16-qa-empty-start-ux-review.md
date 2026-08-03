# Draft: Empty-start UX QA review — 2026-07-16

## Scope and environment

This is a local findings ledger. Nothing was submitted to an external registry, verifier, issue tracker, or production service.

- Repository: `noma-dmrv`
- Branch: `staging`
- Run began at: `622e8bbe4a66363e2db3139f28f2af18019a6564`
- Run paused for a user-requested pull and resumed at: `05272d11571ada982a950363d948c1ababfed1d3`
- Final reviewed revision: `05272d11571ada982a950363d948c1ababfed1d3`
- App: `http://localhost:3100`
- Browser: local Chrome, desktop plus a 390 × 844 responsive viewport
- Database: sanitized local development database. **The database was already reset by the user before this QA run; the QA worker did not reset it.**
- Authentication: local admin session; no credentials are recorded here.

The review resumed records preserved from the pre-pull pass, completed a synthetic UI-only chain, exercised common edits, filters, status transitions, validation and facility switching, inspected console output, and tested an explicit reversible facility archive path.

## Coverage matrix

Legend: ✓ exercised; P partial; — not applicable or not exercised; B blocked by the no-external-services boundary.

| Route / entity | Create | View / list | Edit | Adversarial | Responsive | Delete / archive | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/dashboard` | — | ✓ | — | P | P | — | Empty-state sweep; no guided first-chain onboarding. |
| `/facilities` | ✓ | ✓ | P | ✓ | P | ✓ | Two facilities; blank required-form check; empty secondary archived and restored. |
| `/reactors` | ✓ | ✓ | P | P | P | — | One reactor; nominal throughput persisted; facility false-empty/context check. |
| `/suppliers` and supplier detail | ✓ | ✓ | P | ✓ | P | — | Required fields, invalid GPS, location, cross-facility visibility. |
| `/customers` and customer detail | ✓ | ✓ | ✓ | ✓ | P | — | Location edited from 22 km to 23 km and verified after refresh; cross-facility visibility. |
| `/feedstocks` / feedstock type / intake | ✓ | ✓ | P | ✓ | P | — | Required allocation, >100% moisture and over-allocation checked. |
| `/storage-locations` | ✓ | ✓ | P | ✓ | P | — | Feedstock, raw-biochar and product bins; negative capacity rejected. |
| `/production-runs` | ✓ | ✓ | P | ✓ | P | — | Complete status, missing end-time, zero feed rate and missing telemetry gates. |
| `/biochar-products` | ✓ | ✓ | P | ✓ | P | — | Pure product and product-bin allocation. |
| `/orders` | ✓ | ✓ | P | P | P | — | Product/customer/location selection and persisted quantity. |
| `/deliveries` | ✓ | ✓ | P | P | P | — | Transitioned to Delivered; dry-mass calculation and certification state inspected. |
| `/applications` | ✓ | ✓ | P | ✓ | P | — | Over-allocation rejected; missing-evidence readiness tested. |
| `/credit-batches` and detail | ✓ | ✓ | P | ✓ | P | — | Status filter and clear action, checklist, batch statistics and direct detail navigation. |
| `/samples` | ✓ | ✓ | P | ✓ | ✓ | — | Three samples; invalid percentage acceptance; mobile stacked-card rendering. |
| `/chain-of-custody` | — | ✓ | — | P | ✓ | — | Batch selector, DAG, Map and Sankey; mobile canvas reviewed. |
| `/certification/settings` | — | ✓ | — | P | P | — | Unlinked sandbox state and registry gate inspected. |
| `/certification/removals` | B | B | B | B | — | — | Direct navigation redirects to certification settings until a project is linked. |
| `/certification/ghg-statements` | B | B | B | B | — | — | Same registry-link redirect; no external link was created. |
| Empty/static route sweep (27 routes) | — | ✓ | — | P | P | — | Parent pass covered empty/static pages before chain creation. |

## Synthetic chain summary

All names and identifiers below are deliberately fictional.

| Stage | Stable synthetic identifier |
| --- | --- |
| Primary facility | `FAC-26-001` — QA Ember Vale Primary |
| Secondary facility | `FAC-26-002` — QA Frost Hollow Secondary |
| Reactor | `R-26-001` — QA-RX-EMBER-01 |
| Supplier / source | `SUP-26-001` — QA Cedar Loop Biomass / QA Cedar Loop Yard |
| Feedstock type | `FT-26-001` — QA Cedar Residue (pyrolysis) |
| Feedstock intake | `FS-26-001` — 5,000 kg wet / 3,750 kg dry |
| Feedstock bin | `FB-26-001` — QA Cedar Intake Bin |
| Production run | `PR-26-001` — 800 kg dry feedstock to 285 kg dry biochar |
| Raw-biochar bin | `BB-26-001` — QA Ember Biochar Bin |
| Biochar product | `BP-26-001` — 300 kg wet / 285 kg dry |
| Product bin | QA Pure Product Bin |
| Customer / site | `CUS-26-001` — QA Silver Meadow Buyer / QA Silver Meadow Plot |
| Order | `OR-26-001` — 250 kg |
| Delivery | `DL-26-001` — Delivered, 250 kg wet / 237.5 kg dry |
| Application | `AP-26-001` — Applied, field `QA-SM-PLOT-01` |
| Credit batch | `CB-26-001` — Pending, 1000-year durability |
| Samples | `SAM-26-001`, `SAM-26-002`, `SAM-26-003` |
| Removal / GHG statement | Not created; blocked by the required external project link |

The production process was created/selected implicitly by the Credit Batch flow. Two samples are chemistry-complete. The deliberately adversarial first sample is incomplete and invalid, so the batch correctly reports only two usable samples; the three-row minimum exists but certification readiness was intentionally not forced.

## Findings

### High — QA-01: Lab sample accepts Total Carbon above 100% and includes it in batch statistics

- Route: `/samples`; `/credit-batches/3667d9d3-7565-43bd-9da4-53cd0a389409`
- Reproduction:
  1. Create a sample for `CB-26-001`.
  2. Enter Total Carbon `101`, Organic Carbon `75`, and otherwise plausible 1000-year durability values.
  3. Submit the form and open the sample list and batch detail.
- Expected: percentage fields are constrained to a scientifically valid range (at minimum 0–100), submission is rejected, and invalid chemistry is excluded from aggregate statistics.
- Actual: `SAM-26-001` saves with Total C `101.0`. The samples page reports average carbon `86.7%`, and batch detail includes the 101% row in the submitted mean/standard-deviation panel. The only reported sample gap is missing H:Corg.
- Impact: invalid lab chemistry can pollute certification calculations and operator decisions while presenting as a normal saved record.
- Evidence: `docs/qa/artifacts/2026-07-16-local-ux-review/03-sample-101-percent-accepted.png`
- Known-issue mapping: none identified.

### High — QA-02: Application is labelled ready without its selected visual-proof evidence

- Route: `/applications?facility=920a427d-5c1b-4c9d-ab3e-dcc390b864ac`
- Reproduction:
  1. Create `AP-26-001` from delivered `DL-26-001`.
  2. Leave evidence method at Visual proof.
  3. Upload no stockpile, spreading, or incorporation images.
  4. Save and inspect the Applications list, then inspect `CB-26-001`'s checklist.
- Expected: the application remains not ready and identifies the three missing evidence items consistently.
- Actual: the Applications list shows `Applied` and `Ready`. The Credit Batch checklist later says the application is missing geotagged stockpile and other visual-proof photos.
- Impact: operators can trust a green readiness signal that directly contradicts downstream certification gating.
- Evidence: `docs/qa/artifacts/2026-07-16-local-ux-review/02-application-ready-without-evidence.png`
- Known-issue mapping: #246 (readiness inconsistencies).

### High — QA-03: Shared supplier/customer records remain actionable in the wrong facility context

- Route: `/suppliers?facility=a94fe573-7a56-4a89-8fb9-38e9216af88b`; `/customers?facility=a94fe573-7a56-4a89-8fb9-38e9216af88b`; customer detail
- Reproduction:
  1. Create `SUP-26-001` and `CUS-26-001` while `FAC-26-001` is selected.
  2. Switch to empty `FAC-26-002`.
  3. Open Suppliers and Customers.
  4. Open `CUS-26-001` and edit its location distance.
- Expected: ownership/sharing scope is explicit and unsafe cross-facility mutations are prevented or clearly framed.
- Actual: both primary-chain records appear as the only records under the secondary facility and remain fully editable. The detail view does not identify an owning or shared facility. The location edit saved from the secondary context.
- Impact: an operator can mistake globally shared counterparties for facility-owned data and change records used by another facility's chain.
- Evidence: `docs/qa/artifacts/2026-07-16-local-ux-review/06-cross-facility-customer-visible.png`
- Known-issue mapping: #456 (cross-facility supplier/customer).

### Medium — QA-04: Facility selection, sidebar targets and loaded data can disagree after direct/detail navigation

- Route: facility-scoped sidebar routes, especially `/reactors`, `/customers/[id]`, `/credit-batches`
- Reproduction:
  1. Switch between `FAC-26-001` and `FAC-26-002`.
  2. Open a shared customer detail and refresh.
  3. Return to the primary facility and inspect/navigate the sidebar.
- Expected: the selected facility, every facility-scoped link and the loaded list use the same facility id immediately.
- Actual: the selector can show the primary facility while some sidebar targets retain the secondary id and others omit the facility parameter. The earlier sweep also produced a temporary no-reactors state despite the preserved primary reactor, resolving after context/reload.
- Impact: false-empty pages and accidental navigation into the wrong facility reduce trust and increase cross-facility entry risk.
- Evidence: `docs/qa/artifacts/2026-07-16-local-ux-review/03-reactors-filter-false-empty.png`; `docs/qa/artifacts/2026-07-16-local-ux-review/00-empty-dashboard.png`
- Known-issue mapping: #253 / #372 (facility context).

### Medium — QA-05: Chain-of-custody DAG is effectively off-canvas at 390 px

- Route: `/chain-of-custody?facility=920a427d-5c1b-4c9d-ab3e-dcc390b864ac&batch=3667d9d3-7565-43bd-9da4-53cd0a389409`
- Reproduction:
  1. Select `CB-26-001` in desktop DAG view.
  2. Change the responsive viewport to 390 × 844.
- Expected: the selected chain remains readable or provides a mobile-specific fit/list fallback.
- Actual: controls and facility label are cramped; the main canvas appears empty at the initial position, with the graph represented only by tiny marks in the minimap at the bottom.
- Impact: mobile operators cannot review the custody chain without discovering and manipulating a precision canvas.
- Evidence: `docs/qa/artifacts/2026-07-16-local-ux-review/07-mobile-chain-of-custody.png`
- Known-issue mapping: #308 (chain-of-custody map/view UX), responsive variant.

### Low — QA-06: Empty-start guidance is inconsistent across core lists

- Route: `/dashboard`, `/suppliers`, `/customers`, `/formulations`, `/reactors`
- Reproduction:
  1. Open the app immediately after the user-provided empty reset.
  2. Visit the dashboard and core lists before creating records.
- Expected: empty pages explain prerequisites and provide a coherent next action through the Facility → Reactor → material-flow chain.
- Actual: the dashboard provides little guided sequence; Suppliers, Customers and Formulations initially resemble unexplained empty table skeletons. Reactors provides the stronger pattern: explicit “No reactors yet” copy and a New Reactor action.
- Impact: first-time operators must infer entity order and may interpret a true empty state as loading or broken data.
- Evidence: `docs/qa/artifacts/2026-07-16-local-ux-review/01-suppliers-empty-table.png`. The captured `00-empty-dashboard.png` rendered effectively blank and does not document the dashboard state; the dashboard portion of this finding rests on the reviewer's session notes only.
- Known-issue mapping: #262 (onboarding) for the dashboard/sequence; no exact mapping for the table presentation.

### Low — QA-07: Samples uses the legacy `NOMA dMRV` browser title

- Route: `/samples`
- Reproduction: open Lab Samples and compare the browser title with the rest of the Maji dMRV app.
- Expected: product title is consistent.
- Actual: the page title is `Lab Samples | NOMA dMRV`; other reviewed pages use `Maji dMRV`.
- Impact: minor branding inconsistency and confusing history/tab labeling.
- Evidence: `docs/qa/artifacts/2026-07-16-local-ux-review/03-sample-101-percent-accepted.png`
- Known-issue mapping: #248 (date formatting/title consistency).

## Passing observations

- The UI supported a coherent Facility → Reactor → Feedstock → Production Run → Biochar Product → Order → Delivery → Application → Credit Batch chain without direct database manipulation.
- Required supplier name, invalid latitude above 90, moisture above 100%, negative bin capacity, zero feed rate, missing run completion time, intake over-allocation and application over-allocation all produced visible validation or gating messages.
- A Complete production run without telemetry saved as an operational record but remained explicitly incomplete for certification with a Telemetry readings gap.
- Intake allocation and storage movements reconciled: 5,000 kg wet intake, 1,000 kg wet consumed, and 3,000 kg wet remaining in the feedstock bin.
- Delivery transitioned to Delivered and Application consumed the available 250 kg without allowing a 300 kg draft.
- The customer location edit from 22 km to 23 km survived navigation and a full browser refresh.
- Credit Batch's Verified filter produced a clear filtered-empty message plus a Clear action; the unfiltered batch returned. The known #399/#400 false-empty behavior was not reproduced in this case.
- Dates and sample times displayed as entered during this same-timezone session; known #46 and #455 were not reproduced.
- Desktop Chain of Custody rendered the complete lineage in DAG, Map and Sankey modes. The map showed supplier, facility and application markers and stored transport distances. Evidence: `04-chain-of-custody-dag.png`, `05-chain-of-custody-map.png`.
- At 390 px, the Lab Samples page reflowed rows into readable labeled cards and retained its filters; the table/cards continue below the fold. Evidence: `08-mobile-samples-table.png`.
- The secondary facility archive dialog stated: “Nothing is deleted — you can restore it any time from the archived view” and “This facility has no attached data.” Archive removed it from active lists, the archived view exposed Restore, and restore succeeded.
- Chrome DevTools Console showed five development/info messages, **no errors and no warnings** at the end of the walkthrough.
- Escape/cancel behavior was exercised on blank/invalid forms without creating duplicate facilities or suppliers.

## Blocked or untested areas

- Removal and GHG Statement creation/view/edit/status flows were not exercised. Both routes redirected to facility certification settings because `FAC-26-001` has no linked Isometric project. Linking was intentionally not attempted because this mission prohibited external registry/verifier interaction. This also prevented a fully completed certification chain. Known Removal/GHG issues #380, #263 and #250 were therefore not re-verified.
- No registry submission, verifier submission, external project linking, or external document upload occurred.
- Real telemetry/readings upload and the passing completion state were not tested; the missing-telemetry gate was tested.
- Application photo/file upload was not tested; absence and readiness behavior were tested.
- Only one production run/day was created, so the independent ≥3 usable-sample condition across distinct points/days was not achieved. Three sample rows exist; two are usable.
- Production Process was auto-created/selected by the Credit Batch flow but its separate edit and Method-B unlock contracts were not exercised.
- Dependent-record facility archive behavior was not tested on the primary facility. Only the explicitly recoverable empty secondary facility was archived and restored.
- Formulation creation and blend-stock flows remained outside the completed pure-biochar tracer bullet.
- Narrow viewport coverage focused on Chain of Custody and Lab Samples; every form/dialog was not exhaustively repeated at mobile width.

## Screenshot index

| File | Contents |
| --- | --- |
| `00-empty-dashboard.png` | Empty-start dashboard |
| `01-suppliers-empty-table.png` | Empty Suppliers table presentation |
| `02-primary-facility-created.png` | Preserved primary facility after creation |
| `03-reactors-filter-false-empty.png` | Reactor false-empty/context state from the initial pass |
| `02-application-ready-without-evidence.png` | Application Ready badge with no visual-proof files |
| `03-sample-101-percent-accepted.png` | Saved 101% Total Carbon sample in the list |
| `04-chain-of-custody-dag.png` | Completed synthetic lineage in desktop DAG mode |
| `05-chain-of-custody-map.png` | Supplier/facility/application map and distances |
| `06-cross-facility-customer-visible.png` | Primary customer visible while secondary facility is selected |
| `07-mobile-chain-of-custody.png` | 390 px DAG off-canvas state |
| `08-mobile-samples-table.png` | 390 px Lab Samples responsive layout |

## Readiness verdict

**Not ready for an unattended empty-start certification rehearsal.** The local operational tracer bullet is workable through Credit Batch and the desktop lineage views are useful, but certification readiness signals are not trustworthy (QA-01 and QA-02), facility scope can be misleading (QA-03 and QA-04), and the Removal/GHG tail could not be exercised without an external project link. Resolve the high-severity data-integrity/readiness findings and rerun with an approved sandbox project plus real telemetry/evidence before treating the full workflow as staging-ready.
