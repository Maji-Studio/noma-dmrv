# UI-only operational stress test — staging — 2026-07-16

## Executive summary

The staging run completed a substantial operational path but did **not** complete the authoritative test contract. Google Chrome was operated exclusively through the bundled visible `@oai/sky` Computer Use transport. No application API, scripted selector engine, browser evaluation, database access, authentication bypass, seeded fixture, or source modification was used.

GitHub Actions run `29429035837` was visibly verified successful after the user performed the authorized empty staging reset. One synthetic organization, two correctly scoped facilities, and a Facility A lineage from feedstock intake through credit batch were created. Facility B received distinct prerequisites and feedstock inventory for isolation testing. Two additional synthetic facilities were mistakenly created under the pre-existing organization before the QA organization was selected; this exceeded the authorized two-facility scope. All synthetic staging data was left in place as instructed.

Final verdict: **Production-blocking**.

The blocking risks are:

- organization switching can retain and expose a facility belonging to another organization;
- logout in one tab leaves already-open protected record data visible in another tab until that tab navigates or reloads;
- organization-shared supplier locations can silently reuse a distance that was recorded relative to another facility;
- inventory loss accepts an amount larger than stock and creates a negative balance;
- supported evidence PDFs cannot be uploaded because staging cannot reach its S3 endpoint.

The observed Facility A arithmetic was internally plausible across headline and traceability views: 400 kg dry feedstock processed → 142.5 kg dry biochar → 95 kg dry applied, with an expected 47.5 kg dry finished product remaining. Exact reconciliation against a preserved movement-history ledger was not completed, and the list rounded that expected 47.5 kg to 50 kg. DAG and Sankey screenshots support the lineage; Map and production-run filtering were observed but do not have preserved visual evidence.

The 2026-07-17 visible continuation reverified three production-blocking defects in the deployed staging application: DEF-001 still retained the foreign facility under the QA organization, DEF-004 still accepted a 401 kg loss against 400 kg and displayed -1 kg, and DEF-006 failed on a Feedstock upload as a second entity type. The failed Feedstock draft was cancelled and a visible reload confirmed that no false attachment persisted. DEF-007 also remained reproducible on the Feedstocks no-match state. This means the local remediation merge was not effective in, or was not deployed to, the staging build exercised by this report.

### 2026-07-17 continuation audit

- The full report and evidence set were audited against the authoritative brief. Coverage and evidence gaps in this revision supersede earlier overstatements.
- Read-only source inspection confirmed the causes of DEF-001, DEF-002, DEF-004, DEF-005, DEF-007, and DEF-008; confirmed the likely deployment mechanism for DEF-006; and showed that DEF-003 must be narrowed to facility-relative distance reuse on organization-shared party records.
- Local `staging` includes remediation merge `05272d11`; the deployed UI re-tests above demonstrate that its DEF-001 and DEF-004 remediations were not effective in, or were not deployed to, the tested staging build.
- Full-code, partial-code, name, and no-match Feedstock searches were exercised for Facility A. Facility B showed only FS-26-002 during an independent list check. The no-match accessibility tree repeated its empty state approximately twelve times.
- Exact 200% browser zoom was visibly confirmed. The Feedstock list reflowed into labeled cards, the responsive navigation opened and closed, a detail remained usable, and the create form retained reachable sticky Create/Cancel controls. The blank draft was cancelled without creating a record.
- Logout was confirmed by a visible reload redirect to `/login`. Browser Back and a directly entered protected deep link remained fail-closed. However, an already-open FS-26-001 edit tab retained and displayed the full protected record until that tab was reloaded (DEF-009). Re-login is blocked because the visible 1Password vault is locked; no credential value was retrieved or exposed.

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
| Scope deviation | Two extra synthetic facilities were created under the pre-existing organization before the QA organization was selected |
| Continuation blocker | Re-login and remaining authenticated checks require the 1Password account password before Touch ID can unlock the visible vault; the prompt was cancelled and no credential value was retrieved or exposed |

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
- Evidence: `DEF-001-cross-org-facility-context.jpeg`, `DEF-001-cross-org-facility-list.jpeg`, `2026-07-17-DEF-001-reverified-current-deployment.jpeg`.
- Reproducibility: 2/2 visible organization-entry/switch checks across the original run and 2026-07-17 continuation. On 2026-07-17 the QA organization dashboard loaded with the foreign `QA Coastal Biochar 20260716` facility active, and the facility selector listed it beside the two correct QA facilities.
- Suggested fix: bind active facility to organization membership server-side, clear it on organization change, and fail closed on every route/query when the pair is invalid.
- Likely root cause: at the tested revision, `src/components/navigation/facility-provider.tsx:46-64,84-92,124-146` accepted URL/local-storage facility state without active-organization identity, while `src/hooks/use-facilities.ts:32-38,58-86` omitted organization from facility query keys. Confirmed by the later remediation in `05272d11`.
- Confidence: High.

### DEF-003 — Shared supplier distance is reused across facilities

- Severity / type: **P1 — Data integrity**
- Role / context: staging owner; active Facility B `QAORG B Coastal Biochar 20260716`.
- Routes: `/suppliers`, `/customers`, and `/feedstocks` creation with `?facility=f9295c97-7725-4830-852f-0bcc2ecddcc6`.
- Reproduction:
  1. Create different A/B suppliers and customers.
  2. Switch to Facility B.
  3. Open supplier/customer lists and a new feedstock draft.
  4. Select Facility A's supplier in the Facility B draft.
- Input: Facility A supplier `SUP-26-001` with 12 km stored distance.
- Expected: organization-shared suppliers/locations are labeled as shared, and any default transport distance is facility-relative or requires explicit confirmation for the active facility.
- Actual: the Facility A supplier was selectable in Facility B and silently auto-filled the 12 km distance stored relative to Facility A.
- Impact: cross-facility transport attribution and emissions can be silently wrong.
- Evidence: `DEF-003-cross-facility-supplier-selectable.jpeg`. The cropped supplier/customer list images do not independently prove active-facility context and are supporting context only.
- Reproducibility: dependency selection 1/1.
- Suggested fix: model facility-relative supplier-location distances explicitly, or require recalculation/confirmation whenever a shared party is used from another facility. Label suppliers/customers as organization-shared in lists and forms.
- Likely root cause: suppliers/customers intentionally have no `facilityId` (`src/db/schema/parties.ts:10-37,63-87`), and list reads are organization-scoped (`src/data-access/suppliers.ts:126-143`, `src/data-access/customers.ts:76-93`). A single stored default distance (`src/db/schema/parties.ts:28-32,173-177`) is applied by `src/components/feedstocks/feedstock-form.tsx:143-179,207-220` regardless of the active facility.
- Confidence: High for distance reuse; organization-shared party visibility is by design, not a confirmed security leak.

### DEF-004 — Excessive loss creates negative inventory

- Severity / type: **P1 — Data integrity**
- Role / context: staging owner; Facility A.
- Route: Storage Locations → Reconcile `SL-26-001` → Record Loss.
- Reproduction:
  1. Start with 400 kg dry derived stock.
  2. Enter loss `401` kg and a clearly labelled synthetic QA reason.
  3. Submit once.
  4. Recover with a visible stock-take restoring 400 kg dry, then repeat the same 401 kg boundary attempt on 2026-07-17.
- Expected: reject a loss greater than available stock without creating a movement.
- Actual: submission succeeded and the summary displayed `FEEDSTOCK ON HAND -1 kg`.
- Impact: physical inventory, mass balance, dashboard, and certification inputs can become impossible.
- Recovery: after each reproduction, a visible 500 kg wet stock-take (400 kg dry at 20% moisture) restored the bin to 400 kg dry. The final displayed balance was 400 kg.
- Evidence: `DEF-004-negative-inventory-loss.jpeg`, `2026-07-17-DEF-004-reverified-negative-inventory.jpeg`.
- Reproducibility: 2/2 exact boundary attempts across the original run and 2026-07-17 continuation.
- Suggested fix: validate loss against current derived stock atomically in the data-access transaction; return a field-level error and preserve the draft.
- Likely root cause: at the tested revision, `src/schemas/bin-movements.ts:115-124` required only a positive loss, `src/fn/bin-movements.ts:111-126` converted it to a negative delta, and `src/data-access/bin-movements.ts:180-188` inserted it without deriving available stock. Confirmed by the later atomic overdraw guard.
- Confidence: High.

### DEF-006 — Supported evidence uploads cannot reach staging storage

- Severity / type: **P1 — Reliability**
- Role / context: staging owner; Facility A delivery `DL-26-001` and Feedstock `FS-26-001`.
- Routes: delivery detail → Transport Evidence; Feedstock edit → Transport Evidence.
- Reproduction:
  1. On the Delivery entity, use the visible file picker for `delivery-receipt.pdf` as bill of lading.
  2. Repeat once on the Delivery entity with `feedstock-weighbridge-ticket.pdf` as weigh-scale ticket.
  3. On 2026-07-17, use the visible file picker for `weighbridge-ticket-QA-20260717.pdf` as bill of lading on Feedstock `FS-26-001`.
- Expected: both small supported PDFs upload, persist, and become source candidates.
- Actual: all three attempts fail with `Upload network error — could not reach noma-staging.s3.fra1.amazonaws.com`.
- Impact: required certification evidence cannot be attached; downstream readiness cannot be trusted.
- Recovery: the failed Feedstock draft was cancelled; after a visible reload and reopen, the detail reported `No transport evidence attached.`
- Evidence: `DEF-006-document-upload-network-error.jpeg`, `2026-07-17-DEF-006-feedstock-upload-failure.jpeg`; visible UI error reproduced on two attachment categories across two entity types.
- Reproducibility: 3/3 supported PDF attempts; Delivery 2/2 and Feedstock 1/1.
- Suggested fix: restore staging object-storage reachability/CORS/signing configuration and add a retry action with retained file metadata.
- Likely root cause: `STORAGE_ENDPOINT` was optional and lacked a region/endpoint consistency guard; `src/lib/storage/index.ts:11-30` passed it through and `src/lib/storage/s3-compatible.ts:36-64` allowed the AWS SDK to derive the observed `noma-staging.s3.fra1.amazonaws.com` hostname. Deployment configuration itself was not inspected.
- Confidence: High.

### DEF-009 — Logout does not invalidate an already-open protected tab

- Severity / type: **P2 — Security/session scoping** (downgraded from P1: only a stale already-rendered view was demonstrated; reload, Back, and deep-link all failed closed to `/login`, and no post-logout authorization failure was shown — matches the P2 classification of duplicate `B-001` in `2026-07-17-qa-parallel-facility-b.md`)
- Role / context: staging owner; two visible Chrome tabs in the same profile.
- Routes: Tab A on protected Feedstock `FS-26-001` detail/edit; Tab B on the Facility A Feedstocks list and then `/login`.
- Reproduction:
  1. Leave the protected FS-26-001 edit view open in Tab A.
  2. In Tab B, activate the visible Sign out control.
  3. Reload Tab B and confirm it redirects to `/login?from=%2Ffeedstocks`.
  4. Switch back to Tab A without reloading it.
- Expected: logout immediately invalidates or masks every already-open protected view across tabs.
- Actual: Tab A continued to expose the full FS-26-001 edit view, including supplier, material, storage, notes, upload controls, and Save/Cancel actions, until Tab A navigated or reloaded.
- Impact: a user can log out yet leave sensitive operational records visibly exposed in another tab. No post-logout mutation was submitted, so post-logout write enforcement remains untested.
- Recovery/protections that passed: reloading Tab A redirected to `/login`; browser Back remained at a login redirect; visibly entering the protected Feedstock deep link while signed out also redirected to `/login`.
- Evidence: `2026-07-17-DEF-009-cross-tab-logout-stale-protected-view.txt`. The Computer Use screenshot captured during tab activation was blank and was rejected rather than preserved as misleading evidence.
- Reproducibility: 1/1 two-tab logout sequence.
- Suggested fix: broadcast logout/session invalidation across tabs, clear protected query/client caches, and immediately replace protected routes with a non-sensitive loading/login state. Keep server-side mutation authorization fail-closed independently.
- Likely root cause: cross-tab client session/cache invalidation is absent or delayed. This mechanism is a hypothesis; source confirmation was not performed.
- Confidence: High for stale visibility and reload protection; untested for post-logout writes.

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
- Likely root cause: at the tested revision, `src/components/forms/entity-select/entity-select.tsx:344-348` called `preventDefault()` on Escape but did not stop propagation to the containing sheet. Confirmed by the later fix in `ae75be10`/`4172eca0`.
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
- Likely root cause: at the tested revision, `src/data-access/deliveries.ts:441-450` aggregated all statuses, `src/components/deliveries/delivery-list.tsx:409-417` always used a delivered-mass label, and `src/lib/certification/entity-readiness.ts:26-29` omitted the delivery lifecycle gate.
- Confidence: High.

### DEF-007 — Empty-state content is repeated in the accessibility tree

- Severity / type: **P2 — Accessibility**
- Role / context: staging owner; Orders, Biochar Products, and Feedstocks tables.
- Reproduction: search for `NO-MATCH-20260716`/`NO-MATCH-20260717` or open an empty product list and inspect keyboard/accessible content through Computer Use.
- Expected: one concise empty-state announcement.
- Actual: the same `No orders found` / `No biochar products yet` block appeared roughly nine times in the original run; on 2026-07-17 the Feedstocks no-match state repeated `No feedstocks yet` approximately twelve times.
- Impact: screen-reader navigation is noisy and misleading even though the visual UI shows one state.
- Evidence: `2026-07-17-DEF-007-accessibility-tree.txt`; a visual screenshot cannot show hidden duplicate nodes.
- Reproducibility: 3 surfaces across two run dates.
- Suggested fix: remove hidden responsive/table clones from the accessibility tree with correct conditional rendering or `aria-hidden`.
- Likely root cause: at the tested revision, `src/components/ui/data-table/index.tsx:461-468,532-535` rendered the empty message in both desktop and mobile markup. The current implementation computes one shared empty state.
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
- Likely root cause: `src/data-access/dashboard-overview.ts:458-480` derives the KPI from production consumption, while `:296-312,567-606` derives the mix from intake mass; the tested `src/components/dashboard/feedstock-mix.tsx:57` labeled that intake value as processed.
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
| A — Empty-state onboarding | Partial | Reset success was visibly verified but no reset/empty-state screenshot was preserved; organization/facilities were created; login empty/malformed/nonexistent-account validation and forgot-password validation passed without email; successful re-login, duplicate identifier, full cancel/reopen, and complete back/forward persistence remain incomplete |
| B — Active-facility isolation | Fail/Partial | DEF-001 reverified on current deployment; organization-shared party distance reuse in DEF-003; A and B Feedstock lists showed only their own synthetic intake; exhaustive two-tab/deep-link/selector/list isolation matrix was not completed |
| C — Roles and permissions | Partial | Owner UI and Owner/Admin/Member choices inspected; no authorized secondary accounts or test inboxes, so enforcement matrix could not be executed |
| D — Storage and inventory | Fail/Partial | DEF-004 reverified 2/2 and recovered to 400 kg; headline arithmetic observed after recovery, but exact movement-history reconciliation, transfer boundaries, stale-tab save, and over-consumption cases were not completed |
| E — Lifecycle and dependencies | Partial | Upcoming delivery correctly blocked from Application; product/order/delivery/application/credit batch chain created; destructive dependency delete not submitted because Computer Use requires action-time deletion confirmation |
| F — Documents/evidence | Fail | Three supported PDF attempts failed at S3 across Delivery and Feedstock entities; unsupported Markdown rejected; visible cancel/reload proved no false attachment |
| G — Tables, filters, navigation | Partial | Order partial/no-match search, status filters, clearing, empty state, pagination controls, and back navigation tested; Feedstock full/partial/name/no-match searches passed; the required script across every substantial list was not completed |
| H — Session and recovery | Fail/Partial | Logout, browser Back, and signed-out protected deep-link redirect were tested; reload/deep-link checks failed closed, but another open protected tab retained record data until reload (DEF-009). Re-login is blocked by the locked visible password vault; same-draft two-tab save remains untested |
| I — Dashboard, maps, traceability | Partial/Fail | DAG/Sankey preserved; Map was observed without evidence; exact dashboard/list reconciliation, warning destinations, node links, and independent Facility B map/traceability checks were incomplete; DEF-008 |
| J — Accessibility/responsive | Fail/Partial | Labels/errors/units, dropdown keyboard behavior, focus sequence, Escape, and hidden duplicate nodes checked; exact 200% list/detail/form and responsive navigation passed with preserved evidence, but the independent narrow-window resize was not completed |

## Two-facility isolation matrix

| Surface | Facility A | Facility B | Cross-exposure | Verdict |
|---|---|---|---|---|
| Header/active context | Correct after explicit selection | Correct after explicit selection | Foreign old-organization facility persisted through organization switch | Fail — DEF-001 |
| Feedstock intakes | FS-26-001 only | FS-26-002 only | None observed | Pass |
| Reactors | R-26-001 | R-26-002 | None observed | Pass |
| Storage | A bins/stores | B bins/stores | None observed | Pass |
| Biochar products | BP-26-001 | Empty | None observed | Pass |
| Orders | OR-26-001 | Empty | None observed | Pass |
| Suppliers/customers | Organization-shared records visible | Organization-shared records visible | Sharing is by design, but scope is not explicit | Observation |
| Feedstock types | A and B visible in both | A and B visible in both | Scope appears organization-global but is not explained | Observation |
| Dependency selectors | A production/product/bin dependencies appeared scoped | Shared supplier selectable in B | Facility A-relative 12 km default silently reused in B | Fail — DEF-003 |
| Dashboard/map/traceability | Complete A lineage | B prerequisites/intake only | No A products/orders appeared in B lists | Partial pass |
| Refresh/deep links | A direct URL intermittently reloaded into `Select a facility` until A was reselected | B direct URLs showed B context in the original run | Invalid organization/facility pair did not fail closed | Fail — DEF-001; refresh-context observation |

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
| A feedstock dry | 0 | +800 intake | -400 production | Original: -401 excessive loss, +401 recovery stock-take; continuation: -401 excessive loss, +401 recovery stock-take | 400 | 400 kg | Reconciled after both DEF-004 recoveries |
| A unallocated biochar dry | 0 | +142.5 production | -142.5 product transfer | 0 | 0 | 0 kg | Pass |
| A finished product dry | 0 | +142.5 product | -95 delivered | 0 | 47.5 | 50 kg | Partial — likely whole-kg display rounding, but exact detail/movement history was not preserved |
| B feedstock dry | 0 | +1050 intake | 0 | 0 | 1050 | 1.1 t on list | Partial — likely one-decimal tonne rounding, but exact detail/movement history was not preserved |
| B biochar/product | 0 | 0 | 0 | 0 | 0 | 0 | Pass |

Dashboard/Sankey check: 400 kg feedstock → 143 kg biochar → 95 kg applied; 258 kg conversion loss and 48 kg in storage after rounding. A movement-by-movement ledger with IDs, timestamps, reasons, source/destination, and pre/post balances was not captured, so this is not an exact reconciliation under the brief.

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
| Stock corrections | Original: 401 kg loss accepted, then 500 kg wet recovery stock-take restoring 400 kg dry. 2026-07-17: second 401 kg loss accepted, then second 500 kg wet recovery stock-take restoring 400 kg dry |
| Persisted documents | 0 |
| Upload attempts | Delivery: `delivery-receipt.pdf` failed and `feedstock-weighbridge-ticket.pdf` failed. Feedstock: `weighbridge-ticket-QA-20260717.pdf` failed. `AGENTS.md` was rejected as `text/x-markdown` |

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

Destructive post-dependency deletion was not submitted. The Computer Use safety policy requires confirmation immediately before an irreversible delete even when the broader QA activity was pre-authorized, and no action-time confirmation was available. Disposable pre-dependency lifecycle deletion and safe visible dependency-error paths otherwise remained incompletely tested.

## Document/evidence matrix

| Test | Result |
|---|---|
| Valid PDF, bill of lading | Fail — S3 network error on Delivery and again on Feedstock as the required second entity type |
| Valid PDF, weigh-scale ticket | Fail — same error on the Delivery entity's second attachment category; no further storage hammering |
| Unsupported Markdown | Pass — explicit `Content type text/x-markdown not allowed for bill_of_lading` |
| Failed-upload false record | Pass — original Delivery reload returned both controls to `No file chosen`; the Feedstock draft was cancelled and a visible reload/reopen reported `No transport evidence attached` |
| Progress/error preservation | Partial — 0% then file size/error retained in panel |
| Retry | Untested — no explicit visible Retry control was exercised; a second attachment category was a second upload attempt, not a retry action |
| Successful persistence/open/download | Untested — no upload succeeded |
| Duplicate filename, empty, oversized, image, CSV | Untested after valid small upload failed; stopped per brief |
| Removal and cross-facility isolation | Untested — no document persisted |
| Readiness change | No successful attachment; delivery already incorrectly said Ready before evidence |

## Tables, filters, and navigation

- Orders: partial code search passed; no-match search produced useful visible empty state; fulfillment filters `No deliveries` and `Fulfilled` passed; clearing restored the row.
- Feedstocks on Facility A: exact code `FS-26-001`, partial code `26-00`, and name `Alpine Orchard` each returned the correct row; `NO-MATCH-20260717` returned no row. Facility B independently showed only FS-26-002.
- Facility switching: product/order/storage/feedstock lists updated correctly except DEF-001/DEF-003 surfaces.
- Pagination: controls and row-count selectors rendered; only one synthetic row existed on most lists, so page transitions were unavailable.
- Back navigation returned from Deliveries to the filtered Orders route. Forward was disabled after direct-address navigation and was not treated as a product defect.
- Sorting headers were visible but not actionable through the original accessible element surface; the required sort script was not re-executed across every list during the continuation.
- Many responsive table clones duplicate hidden empty-state content in the accessibility tree (DEF-007).

## Session and recovery

| Scenario | Result |
|---|---|
| Refresh persisted created records; active-facility context | Partial — created records persisted, but a 2026-07-17 direct Facility A reload temporarily rendered `Select a facility` until A was reselected despite the Facility A query parameter |
| Validation failure → correction → resubmit | Pass on facility/inventory forms |
| Cancel/reopen | Pass generally; Escape-specific storage loss is DEF-002 |
| Failed upload → refresh | Pass; no false document record |
| Back navigation | Pass |
| Idle continuation | Pass over the multi-hour run |
| Upcoming dependency gate | Pass; Application disabled until Delivered |
| Logout | Fail/Partial — logout succeeded, but another already-open protected FS-26-001 edit tab retained visible record data until reload (DEF-009) |
| Browser Back after logout | Pass — protected route history redirected to login; no protected data reappeared |
| Protected deep link while signed out | Pass — visibly entering the FS-26-001 deep link redirected to `/login?from=%2Ffeedstocks` |
| Login validation | Pass — empty submit, malformed email/short password, and syntactically valid nonexistent credentials produced field-level/browser validation and a generic `Invalid email or password.` response without account enumeration |
| Forgot-password validation | Pass/partial — route, empty/malformed validation, and Back to login passed; no valid address was submitted and no reset email was sent |
| Login redirect and re-login | Partial/blocked — redirect passed; Google Password Manager had no staging entry, and 1Password required the account password before Touch ID. The prompt was cancelled; no credential value was retrieved or exposed. Evidence: `2026-07-17-login-recovery-validation.txt` |
| Same draft in two visible tabs | Untested — two visible app tabs were opened for the session setup, but the concurrent save scenario was not attempted before logout |

## Dashboard, maps, and traceability

- Dashboard quantities observed: 0.4 t dry feedstock processed, 0.1 t dry biochar, 35.6% yield, 0.1 t applied, one production, one application. Exact count reconciliation against every list was not completed.
- Evidence gaps: four gaps; links targeted Feedstocks, Applications, Credit Batches, and Chain of Custody.
- Map: Facility, supplier/feedstock origin, and application markers were observed with 12 km inbound and 8 km outbound distances; no preserved map screenshot supports this observation.
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
- Exact browser zoom was visibly confirmed at 200%. The Feedstock list reflowed into labeled cards, the responsive navigation opened and closed, the detail remained readable, and the create form retained reachable sticky Create/Cancel controls; the blank draft was cancelled. Evidence: `2026-07-17-200pct-feedstock-list.jpeg` and `2026-07-17-200pct-feedstock-form.jpeg`.
- A separate narrow-window resize was not completed after the earlier responsive-device shortcut detached Chrome. No scripted resize was substituted.
- This is a practical operator pass, not a WCAG conformance claim.

## Console and failed-request ledger

| Surface | Result |
|---|---|
| Dashboard visible Console | `No errors` |
| Chain of Custody visible Console | `No errors` |
| Dashboard visible Network panel | No visible 4xx/5xx row was exposed during inspection; data rendered after loading |
| Document upload | Three visible failures to reach `noma-staging.s3.fra1.amazonaws.com` across Delivery and Feedstock entities |
| Unsupported upload | Visible content-type rejection; no persisted record |

## Five fixes to prioritize

1. Enforce organization/facility pairing server-side, clear foreign active-facility state on organization switch, and broadcast logout/cache invalidation across every open tab.
2. Model supplier/customer default distances relative to the active facility, or require explicit route confirmation when organization-shared parties are reused.
3. Make inventory loss validation atomic and prohibit any negative derived balance.
4. Restore staging object-storage uploads and align readiness with actual successful evidence attachments.
5. Align lifecycle and quantity semantics: Upcoming vs Delivered, wet vs dry labels, and dashboard feedstock-mix basis.

## Risk and UX conclusions

- Worst security/scoping risks: **DEF-001 — invalid organization/facility pairs do not fail closed**, and **DEF-009 — logout leaves protected data visible in another open tab until reload.**
- Worst operator-experience gap: **required evidence upload is impossible while the UI can still say a delivery is Ready for certification.**
- Quick UX fixes: stop Escape propagation; label wet/dry bases; hide duplicate accessible empty states; show retry on upload; rename the feedstock-mix basis; include product/value/location in order detail.
- Product decisions: whether suppliers/customers/feedstock types are facility- or organization-global; when delivery mass should leave inventory; which lifecycle states qualify as certification-ready; whether storage transfers are part of the operator model.

## Untested items and exact blockers

- Admin/Member enforcement: no authorized additional accounts or inboxes; invitations prohibited.
- Destructive dependency deletion: action-time Computer Use confirmation required and not available during autonomous execution.
- Successful document persistence/open/download/duplicate/removal/isolation: staging S3 failure prevented the prerequisite successful upload.
- External registry/verifier behavior: explicitly out of scope; no submission made.
- Full second-facility certification lineage: brief said not to repeat the full workflow unless required; isolation was proven with distinct prerequisites/intake and empty downstream lists.
- Re-login: logout, Back, protected deep-link redirect, login validation, and forgot-password validation were tested. Google Password Manager had no staging entry, and the visible 1Password authorization prompt requires the account password before Touch ID; it was cancelled without retrieving or exposing any secret. Successful re-login and same-draft two-tab saves remain untested.
- Independent narrow-window resize remains untested. Exact 200% list/detail/form and responsive navigation checks now pass with preserved evidence.
- Full onboarding validation/persistence, exhaustive A/B switching/deep-link/two-tab isolation, exact movement history and transfer boundaries, complete lifecycle matrix, full every-list filter/sort/state script, warning-link verification, independent B maps/traceability, and the remaining adversarial inputs remain incomplete.
- DEF-006 second entity type is complete: one Feedstock PDF attempt reproduced the same S3 failure after the two Delivery attempts, then the failed draft was cancelled and verified absent after reload.
- Evidence limitations: DEF-002 has no preserved screenshot because the unsafe capture was discarded; DEF-007 now has a text artifact but no visual image can prove hidden nodes; DEF-008's cited dashboard image does not show the disputed Feedstock Mix; console and Network observations have no preserved panel capture.

## Computer Use attestation

Every noma-dmrv and GitHub Actions interaction was performed through visible Google Chrome Computer Use. Local CLI use was limited to reading instructions/source filenames, copying Computer Use screenshots into the evidence directory, and writing this report/memory. No application interaction was replaced with an API, browser script, selector engine, direct session manipulation, SQL/ORM/database access, or authentication bypass.
