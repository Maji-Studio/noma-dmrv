# Staging × Isometric integration verification — 2026-07-21

## 1. Executive verdict

**Verdict: Conditional pass through local credit-batch chemistry; Isometric write-side
remains environment-blocked and unverified.** The 2026-07-21 continuation confirmed that
the reported fix for issue #498 is deployed on the fresh staging bundle. `PR-26-001`
persisted `Running` → `Complete` with `End Date = 2027-12-02` and `End Time = 16:00`, and
the exact values survived reload/reopen. A pre-existing tab reproduced the former error
once before reload, so operators with a stale client bundle may still see the old behavior
until they refresh.

The same synthetic chain then reached `BP-26-001` → `OR-26-001` → `DL-26-001` →
`AP-26-001` → `CB-26-001` and three locally usable 1000-year samples. Traceability
reconciled the full local chain in DAG, map, and Sankey views. Removal readiness correctly
identified the remaining production telemetry and application-photo gaps, but the browser
control environment could not attach files. No Removal/GHG Entry or GHG Statement could
therefore be submitted.

The exact sandbox project remained unchanged: no local code appeared in its GHG-entry
inventory and no new statement appeared on the overview. This run removes the original
application P1 blocker, but it still does **not** establish that Source, Datapoint,
Measurement Sample, GHG Entry, telemetry, or GHG Statement write paths work end to end.
The complete continuation and evidence are in [section 11](#11-continuation--authenticated-staging--sandbox-run).

The local-file-access retry continuation is recorded in
[section 12](#12-upload-continuation-after-chrome-file-access-was-enabled).

## 2. Scope and reconnaissance

- Application: `https://staging.noma.maji.studio`
- Registry target: Isometric **sandbox** project `prj_1K9YJ33RKSBX9FFF` only
- Linked removal template: `rvt_1KS4S43VPSBXA26X` (`Dark Earth Carbon Template`)
- Linked Isometric facility: `fcl_1KST05ZW3SBXZCM7` (`Manfinga Facility`)
- Revision: local `staging` and `origin/staging` both at
  `6c81f29d989c9b11c07cb421f4cbb62841eec158`
- Browser: authenticated connected Chrome session; desktop layout
- Authentication: staging and the exact sandbox project were live before mutation and
  reconfirmed during post-run reconciliation
- Route inventory: 34 page modules found; 28 static runtime routes visited without a
  fatal route error. Redirects observed: `/chain-of-custody` → `/traceability`,
  `/certification` → `/certification/removals`, `/admin/users` → organization settings,
  and `/admin/emission-estimates` → certification settings.
- Safe diagnostics: no console entries were exposed on the sampled staging tabs. The
  connected browser did not expose a request ledger, so raw HTTP status codes are not
  claimed. No credentials, tokens, cookies, authorization headers, or signed URLs were
  captured.
- Safety: no database command, reset, push, source edit, branch, commit, PR, or issue was
  created. Only synthetic records were submitted through the staging UI. Production
  Isometric was never accessed.

The known-good interpretation sheet is
[`00-known-good-inputs.md`](./artifacts/2026-07-21-staging-isometric/00-known-good-inputs.md).
It recommended the implemented 200-year path, but the live staging facility/project link
offered the 1000-year `Dark Earth Carbon Template`; the UI record was therefore created
with the live template's 1000-year durability. This divergence is recorded as an open
integration decision below.

## 3. Integration-point coverage

This table preserves the **initial-run** state at the production-run blocker. The final
continuation state and superseding coverage matrix are in section 11.5.

`PASS (UI)` means the successful read was proven by the authenticated app UI and matched
the sandbox object. It does not claim a captured raw status code. `BLOCKED` means the
production-run lifecycle failure prevented the call from becoming reachable.

| Integration interaction | Expected trigger/result | Result | Registry evidence |
|---|---|---|---|
| `GET /projects` | Facility link selector loads the sandbox project | **PASS (UI)** | Exact project `prj_1K9YJ33RKSBX9FFF`, `Tanzania biochar` |
| `GET /projects/{id}/ghg_entry_templates` | Settings loads the project's removal templates | **PASS (UI)** | Exact template `rvt_1KS4S43VPSBXA26X`, `Dark Earth Carbon Template` |
| External facility mapping read/configuration | Settings retains the telemetry facility | **PASS (UI)** | `fcl_1KST05ZW3SBXZCM7`; registry project remained accessible |
| `GET /feedstock_types` | Feedstock-type Quick Add browses registry catalogue | **PASS (UI)** | `ftt_1K9YJNV5TSBXJV9D`, supplier reference `forest01`, `Forestry waste` |
| `GET /component_blueprints` | Removal readiness resolves required component mappings | **BLOCKED / inconclusive** | No Removal context; wizard also reported setup incomplete despite the visible link |
| `GET /components` / allocation reads | Removal preparation loads template allocations/components | **BLOCKED** | No Credit Batch or Removal |
| `POST /datapoints` | Removal draft sends mapped facts | **BLOCKED** | No GHG Entry created |
| `PATCH /datapoints/{id}` | Retry/amendment updates draft data | **BLOCKED** | No Datapoint ID |
| `GET /datapoints` | Reconcile locally journaled Datapoints | **BLOCKED** | No submission attempt |
| `POST /measurement_samples` | Required batch samples are mirrored | **BLOCKED** | No Credit Batch/Sample |
| `GET /measurement_samples/{id}` or list | Sample reconciliation | **BLOCKED** | No registry Sample ID |
| `POST /sources` | Managed evidence creates an Isometric Source | **NOT TESTED** | File attachment capability unavailable; no Source ID |
| `POST /sources/{id}/signed_upload_url` | Source receives a safe upload URL | **NOT TESTED** | No Source ID; no signed URL captured |
| `PUT <signed upload URL>` | Evidence bytes reach Isometric | **NOT TESTED** | No upload attempted |
| `PATCH /sources/{id}` | Source metadata/finalization | **NOT TESTED** | No Source ID |
| `GET /sources?supplier_reference_id=…` | Orphan/retry reconciliation | **NOT TESTED** | No Source mutation |
| `POST /ghg_entries` | Create the registry GHG Entry (noma Removal) | **BLOCKED** | Zero new entry IDs |
| `GET /ghg_entries/{id}` | Poll/reconcile the entry | **BLOCKED** | Zero new entry IDs |
| `GET /ghg_entries?supplier_reference_id=…` | Idempotent recovery | **BLOCKED** | No attempted supplier reference |
| `POST /ghg_statements` | Create period statement containing submitted removals | **BLOCKED** | Zero new statement IDs |
| `GET /ghg_statements/{id}` | Poll/reconcile statement | **BLOCKED** | Zero new statement IDs |
| `POST /ghg_statements/{id}/submit` | Submit statement to sandbox | **BLOCKED** | No new statement |
| Sensor/file-upload/data-upload submission APIs | Submit production telemetry | **NOT TESTED** | Required readings CSV could not be attached; no sensor/submission IDs |

### Requirements/template findings

- Certification Settings correctly reported **Sandbox · Isometric registry**, the exact
  project/template/facility IDs, configured credentials, and default safe upload and
  redirect allowlists.
- Settings correctly stated that 1000-year durability has no soil-temperature estimate;
  it is measured from random reflectance and TGA non-reactive carbon.
- The live UI did not surface the Isometric protocol/module version, so the repository's
  `versions.json` pin could not be directly matched to a project-side version in this run.
- The Credit Batch form displayed Method A and `0/30` eligible samples toward Method B,
  but no run was eligible because `PR-26-001` remained Running.

## 4. Golden-path and registry reconciliation

### Accepted sandbox objects from this run

| Object | App record | Sandbox registry ID | Result |
|---|---|---|---|
| Removal / GHG Entry | None | None | Not created; upstream P1 blocker |
| GHG Statement | None | None | Not created; no submitted Removal |
| Datapoint | None | None | Not created |
| Measurement Sample | None | None | Not created |
| Source | None | None | Not created |
| Telemetry submission | None | None | Not created |

### Baseline vs post-run sandbox overview

The pre-run and post-run screenshots show the same project state:

- Project status: `DRAFT`
- Validation: `3 in Draft`
- Verification CTA: `Submit a GHG statement to start verification`
- Expected credits: `28.4`; credits issued: `0`
- Eleven pre-existing pending GHG Statement rows remained present
- Newest pre-existing period remained `22 Nov 2026 to 30 Nov 2027`, `Draft`,
  `12` GHG entries, `-3.24 tCO₂e`

Evidence:
[`01-registry-baseline-overview.png`](./artifacts/2026-07-21-staging-isometric/01-registry-baseline-overview.png)
and
[`10-registry-post-run-overview.png`](./artifacts/2026-07-21-staging-isometric/10-registry-post-run-overview.png).

## 5. App ↔ registry mismatch table

No submitted app object existed to compare field-by-field against a new registry object.
The setup/readiness discrepancy below is nevertheless material.

| Surface/field | App-side state | Registry/settings state | Assessment |
|---|---|---|---|
| Facility registry link | Removal wizard: `Link this facility to Isometric and set a removal template` | Certification Settings shows project `prj_1K9YJ33RKSBX9FFF`, template `rvt_1KS4S43VPSBXA26X`, facility `fcl_1KST05ZW3SBXZCM7`; sandbox project opens successfully | **Mismatch / misleading readiness copy** |
| New Removal/GHG Statement counts | App: 0/0 | Sandbox: no new rows relative to baseline | **MATCH** |
| Project/environment target | App: Sandbox | Registry host: `registry.sandbox.isometric.com` | **MATCH** |

## 6. Uploads (known-flaky)

No file was transmitted. The Chrome control environment could not attach local files
because its file-URL permission was disabled. The required permission instruction was
reported during the run. This is an **execution-environment blocker**, not evidence that
the staging upload endpoint passed or failed.

| Upload surface | UI inspection | Transfer/persistence/registry result |
|---|---|---|
| Feedstock transport/evidence | Control present | **NOT TESTED** |
| Production readings CSV | Control present; CSV schema guidance visible | **NOT TESTED** |
| Lab Sample attachment / report | Form requires a Credit Batch first | **BLOCKED**, then file capability unavailable |
| Delivery bill of lading | Control present in Delivery form | **BLOCKED** by missing Order; file capability unavailable |
| Delivery weigh-scale evidence | Control present in Delivery form | **BLOCKED** by missing Order; file capability unavailable |
| Application visual evidence | UI requires all three geotagged roles: stockpile, spreading, incorporation | **BLOCKED** by missing Delivery; file capability unavailable |
| Application boundary/logbook evidence | Alternative evidence method present | **BLOCKED** by missing Delivery; file capability unavailable |
| Removal supporting evidence / Isometric Source mirroring | Not reachable | **BLOCKED** by missing Credit Batch/Removal |

Prior staging ledgers on 2026-07-15 and 2026-07-16 reported real upload network failures.
Those findings were **not reverified** here and should not be inferred from this run's
attachment-tool limitation.

## 7. Initial-run full-chain stage checklist

| Stage | Result | Record/evidence |
|---|---|---|
| Facility | **PASS** | `FAC-26-001`; linked to exact sandbox project/template/facility; [screenshot](./artifacts/2026-07-21-staging-isometric/02-facility-created-and-linked.png) |
| Reactor | **PASS** | `R-26-001`, `QA-REACTOR-20260721`, continuous, 2.5 t/h |
| Supplier + location | **PASS** | `SUP-26-001`; synthetic Tanzania location; 42 km one-way |
| Feedstock type | **PASS** | `FT-26-001`, Forestry waste; registry `ftt_1K9YJNV5TSBXJV9D`; Quick Add was immediately selectable |
| Feedstock intake/storage | **PASS** | `FS-26-001`, 12,000 kg wet, 8%, 11,040 kg dry, allocated to `FB-26-001`; [screenshot](./artifacts/2026-07-21-staging-isometric/03-feedstock-created.png) |
| Production process | **BLOCKED** | App creates it only when a Credit Batch is built |
| Production run | **FAIL (P1)** | `PR-26-001` created Running with complete mass/energy facts, but cannot persist Complete; [evidence](./artifacts/2026-07-21-staging-isometric/04-production-run-completion-blocker.png) |
| Biochar product | **BLOCKED** | Completed-run selector empty; [evidence](./artifacts/2026-07-21-staging-isometric/05-biochar-product-blocked-no-completed-run.png) |
| Customer + location | **PASS** | `CUS-26-001`; synthetic plot/location; 18 km one-way |
| Order | **BLOCKED** | Product selector empty; [evidence](./artifacts/2026-07-21-staging-isometric/06-order-blocked-no-product.png) |
| Delivery | **BLOCKED** | Order selector empty |
| Application | **BLOCKED** | Delivery selector empty |
| Credit Batch | **BLOCKED** | 2027-12-01…03 window reports no matching runs; [evidence](./artifacts/2026-07-21-staging-isometric/07-credit-batch-blocked-no-eligible-run.png) |
| Required Samples | **BLOCKED** | Sample form requires a Credit Batch |
| Removal / GHG Entry | **BLOCKED** | 0 batches ready; [evidence](./artifacts/2026-07-21-staging-isometric/08-removal-empty-state-misreports-link.png) |
| GHG Statement | **BLOCKED** | Empty statement correctly prevented; [evidence](./artifacts/2026-07-21-staging-isometric/09-ghg-statement-blocked-no-removals.png) |

### Validation/adversarial coverage reached before the blocker

- Facility blank-submit required-field validation: passed.
- Customer blank name validation: passed.
- Feedstock moisture `101%`: rejected inline; valid `8%` then persisted.
- GHG Statement blank period end: rejected with `Pick a valid period end date`.
- GHG Statement period `2027-12-31`: correctly showed zero expected removals and disabled
  progression.
- Direct facility routes transiently flashed a select-facility state before resolving.
- Cross-facility/cross-tenant entity-ID probes, submit retry/double-click, mid-submit
  reload/back, and numeric adversarial checks on Credit Batch/Removal/Statement were not
  reachable after the P1 lifecycle failure.

## 8. Findings ledger

### F1 — RESOLVED in continuation (formerly P1 Functional) — Running production run could not be completed

- **Continuation status:** confirmed fixed on a fresh staging bundle, 1/1. The exact
  end date/time persisted after reload and downstream selectors admitted the run. A stale
  pre-reload client still reproduced the former error 1/1; see section 11.2 and artifacts
  `12`–`14`.

- **Route:** `/production-runs?facility=40131551-9036-48ea-9064-8ae3fde06793&run=6c82d52b-e354-49fe-9fb6-3f9db9409f96`
- **Record:** `PR-26-001`; app ID `6c82d52b-e354-49fe-9fb6-3f9db9409f96`
- **Steps/input:** Open the Running run → Edit Production Run → select `Complete` →
  enter `End Date = 2027-12-02`, `End Time = 16:00` → blur the time field → Save.
- **Expected:** the run persists as Complete and becomes selectable by Biochar Product and
  Credit Batch forms. Missing readings may remain a separate certification gap.
- **Actual:** the update returns `A complete run needs an end time`; the entered values
  remain visible, but the stored/list state remains Running. Product and batch selectors
  remain empty.
- **Frequency:** 4/4. A separate first attempt with both fields blank correctly produced
  client validation and is not counted as the defect.
- **Impact:** blocks all product, distribution, batch, sample, Removal, and GHG Statement
  work; prevents every Isometric write-side path in this run.
- **Evidence:** screenshot above plus the
  [sanitized accessibility snapshot](./artifacts/2026-07-21-staging-isometric/11-production-run-completion-dom-evidence.md),
  which records `End Time: 16:00` and the server alert simultaneously. No console error
  was exposed.
- **Suspected root cause:** the three-state end-time construction only includes the value
  when React Hook Form marks either date/time field dirty
  (`src/components/production-runs/production-run-form.tsx:394`), and otherwise sends
  `undefined`. The data-access outcome assertion then sees no persisted end time and
  rejects at `src/data-access/production-runs/mutations.ts:738`. The failure survives
  standard browser `fill` plus blur. This is a strong hypothesis, not a captured payload.
- **Suggested fix:** when status changes to `complete` or `failed`, always combine and send
  the currently displayed end date/time, independent of dirty-field bookkeeping. Add an
  integration regression test for Running → Complete with newly entered end fields and
  verify the list, Biochar Product picker, and Credit Batch picker refresh.
- **Known/duplicate:** no exact duplicate found. A 2026-07-16 ledger says a Complete run
  saved successfully, so this is consistent with a regression in the current edit path.

### F2 — P2 Integration/UX — Removal wizard says the linked facility must be linked

- **Route:** `/certification/removals?facility=40131551-9036-48ea-9064-8ae3fde06793`
- **Steps:** Open New removal; wait through loading.
- **Expected:** with the exact project, default template, and external facility visible in
  Settings, the wizard should omit link/setup guidance or name the actual unresolved
  blueprint/configuration item.
- **Actual:** after loading completes, it still says `Link this facility to Isometric and
  set a removal template before grouping batches`, alongside `No ungrouped credit batches`.
- **Frequency:** 1/1 after 5.5 seconds; not just the initial loading frame.
- **Impact:** an operator is sent to settings that already show the requested link and
  cannot tell whether the real problem is the empty batch list or an unresolved template
  blueprint.
- **Evidence:** `08-removal-empty-state-misreports-link.png`; Settings and registry both
  confirmed the exact project/template/facility IDs.
- **Suspected root cause:** `facilitySetupComplete` also requires zero unresolved blueprint
  keys (`src/fn/certification/certify-context-core.ts:989`), but the false state is reduced
  to a single link/template message (`select-batches-step.tsx:208`).
- **Suggested fix:** return structured setup gaps and render the specific missing mapping,
  template, external facility, or unresolved blueprint keys. Do not render the warning
  while the setup query is loading.
- **Known/duplicate:** a 2026-06-13 ledger documented the same warning as a **transient**
  1–2 second flash. This run extends that known issue: it persisted after data loading.

### F3 — P3 UX — Facility-scoped routes briefly render a false “select facility” state

- **Routes:** facility-scoped production, distribution, verification, and certification
  routes during direct navigation/reload.
- **Actual:** the page can show a definitive select-facility state for roughly 3.5 seconds
  before the already-selected `FAC-26-001` context resolves.
- **Impact:** temporary false blocker and duplicate-selection risk on slow loads.
- **Known/duplicate:** maps to existing issue `#473` / prior QA empty-state flashes.
- **Suggested fix:** retain the selected facility during hydration or render a neutral
  loading skeleton until facility-context resolution completes.

### F4 — P3 UX — Empty prerequisite pickers do not explain the upstream action

- **Routes:** `/biochar-products`, `/orders`, and `/credit-batches`.
- **Actual:** the Biochar Product and Order selectors open empty. Credit Batch at least
  states that no matching runs exist, but it does not link to the Running run or its
  missing transition.
- **Impact:** operators must infer that the run must be Complete before continuing.
- **Evidence:** artifacts `05`, `06`, and `07`.
- **Known/duplicate:** the empty completed-run picker was documented in the 2026-06-13
  operator QA pass.
- **Suggested fix:** render an explicit no-options state with a direct link to the nearest
  incomplete prerequisite and its blocking gaps.

## 9. Synthetic-record inventory after the initial run

No cleanup was performed, as requested. `Not surfaced` means the UUID was not visible on
the operator surface; the stable app code is supplied instead.

| Entity | App code / name | App UUID | Sandbox registry ID |
|---|---|---|---|
| Facility | `FAC-26-001` / QA-20260721 Isometric Integration Facility | `40131551-9036-48ea-9064-8ae3fde06793` | Project `prj_1K9YJ33RKSBX9FFF`; template `rvt_1KS4S43VPSBXA26X`; external facility `fcl_1KST05ZW3SBXZCM7` (pre-existing links, not created) |
| Reactor | `R-26-001` / QA-REACTOR-20260721 | Not surfaced | None |
| Supplier | `SUP-26-001` / QA-20260721 Synthetic Sawmill Supplier | `e70e1587-5cf5-40a5-84e9-083de0c6256b` | None |
| Supplier location | synthetic Moshi/Kilimanjaro location | Not surfaced | None |
| Feedstock type | `FT-26-001` / Forestry waste | Not surfaced | `ftt_1K9YJNV5TSBXJV9D` (pre-existing catalogue item; supplier reference `forest01`) |
| Feedstock bin | `FB-26-001` / QA Feedstock Bin 20260721 | Not surfaced | None |
| Feedstock intake | `FS-26-001` | Not surfaced | None |
| Biochar bin | `BB-26-001` / QA Biochar Bin 20260721 | Not surfaced | None |
| Production run | `PR-26-001` | `6c82d52b-e354-49fe-9fb6-3f9db9409f96` | None |
| Customer | `CUS-26-001` / QA-20260721 Synthetic Farm Customer | `609a0dcb-e772-4aab-9bb5-f084cef40984` | None |
| Customer location | QA-20260721 Application Plot A | Not surfaced | None |

No Production Process, Biochar Product, Order, Delivery, Application, Credit Batch,
Sample, Removal, GHG Entry, GHG Statement, Datapoint, Source, or telemetry submission was
created.

## 10. Known issues and open integration decisions

1. **Keep F1 as a regression test.** The fresh staging bundle passed, but an already-open
   client reproduced the former error until reload.
2. **Durability/template alignment:** the research sheet recommended the implemented
   200-year path, while the live linked staging template/facility flow used 1000-year.
   Decide whether this sandbox project intentionally tests 1000-year and ensure the app
   collects the live blueprint's R₀/TGA requirements consistently.
3. **Protocol version visibility:** Settings exposes template and durability but not the
   live project protocol/module versions. The `versions.json` pin therefore could not be
   independently confirmed in the UI.
4. **Removal setup diagnostics:** distinguish missing mapping/template/external facility
   from unresolved blueprint keys; the current generic warning contradicts Settings.
5. **Uploads:** enable the browser attachment permission and rerun every file surface.
   Separately reverify the prior staging S3/CORS failures; this run provides no new verdict
   on them.
6. **Network evidence:** repeat with a safe request ledger or server-side correlation
   view that exposes method/path/status without headers or signed URLs. This is necessary
   to satisfy the brief's per-call status requirement.
7. **Upload-enabled continuation:** enable the browser file permission, add production
   telemetry and the three required application-photo roles, then resume `CB-26-001` at
   Removal → GHG Entry → GHG Statement with registry reconciliation and safe retry checks.

## Handoff

Issue #498 is verified on a refreshed client. Next, inspect why the Removal setup projection
still emits generic link/template guidance despite the confirmed link and concrete readiness
gaps. Then rerun with upload capability to clear telemetry/application evidence and exercise
Source, Datapoint, Measurement Sample, GHG Entry, telemetry, and GHG Statement paths against
the same sandbox project.

## 11. Continuation — authenticated staging × sandbox run

### 11.1 Continuation scope and safety

- Continued the same authenticated facility and synthetic chain on
  `https://staging.noma.maji.studio`; the only registry UI opened was the exact sandbox
  project `prj_1K9YJ33RKSBX9FFF` on `registry.sandbox.isometric.com`.
- The connected Isometric MCP `how_to` tool was not exposed in the continuation tool
  inventory. Its required initial-run invocation remains documented in
  `00-known-good-inputs.md`. No new direct Isometric API/MCP call was made; registry
  reconciliation was read-only through the already-authenticated sandbox UI.
- No credential, cookie, token, authorization header, signed URL, or upload path was
  captured. The connected browser exposed no request ledger, so no raw HTTP status claim
  is made.
- Browser automation finalized cleanly and released both claimed user tabs. Production
  Isometric was never accessed.

### 11.2 Issue #498 deployment verification

1. The already-open production-run form still returned `A complete run needs an end time`
   with `Complete`, `2027-12-02`, and `16:00` present (**1/1 stale-client attempt**;
   artifact `12`).
2. Reloaded staging, reopened `PR-26-001`, entered End Date `2027-12-02`, End Time `16:00`,
   and selected Complete last. Save succeeded (**1/1 fresh-bundle attempt**) with the toast
   `Production run updated successfully. Still needed to certify: Telemetry readings`
   (artifact `13`).
3. Reloaded again and reopened the record. Status remained Complete and the exact end
   fields remained `2027-12-02` and `16:00` (artifact `14`).
4. The completed run immediately became usable by Biochar Product and, after a separate
   selector-cache delay described in F5, Credit Batch.

**Assessment:** the original F1 is resolved in the deployed fresh bundle. The stale tab is
a deployment/cache transition observation, not a fresh-bundle regression.

### 11.3 Golden-path continuation

| Stage | Input/result | Reload, selector, and validation observations | Evidence |
|---|---|---|---|
| Production run | `PR-26-001` Complete; end `2027-12-02 16:00` | Exact values persisted after reload; telemetry remained a separate certification gap | `12`–`14` |
| Biochar Product | `BP-26-001`; 3,000 kg wet, 2,760 kg dry, 8% moisture | Completed run available; Quick Add created and immediately selected `QA Product Bin 20260721`; source bin correctly could not be reused as destination | `15` |
| Order | `OR-26-001`; 2,500 kg, TZS 2,500,000, loose | Product auto-selected; existing synthetic customer and location resolved | `16` |
| Delivery | `DL-26-001`; Delivered; 2,500 kg wet, 2,300 kg dry; 18 km return trip | Order auto-selected; list reported `Fields complete`; attachment controls left empty | `17` |
| Application | `AP-26-001`; 2027-12-04; 1.15 ha; maize; Mechanical; `-3.3349, 37.3404` | Created through the non-upload path; list reported `Incomplete (1)` because required visual evidence was absent | `18`, `19` |
| Credit Batch | `CB-26-001`; 2027-12-01…05; app ID `c705e487-864e-4749-b5fa-77a7e773e0d3`; Pending | One run, 2.76 t dry product, 2.50 t applied; selector initially returned no runs, then refreshed; only one batch was created | `20` |
| Samples | `SAM-26-001`…`SAM-26-003`; three distinct days; complete 1000-year R₀/TGA inputs | All three created without attachment; batch detail showed 3/3 usable, 3 distinct runs/days, Eligible, preview 5.41 tCO₂e | `21` |
| Production Process | Auto-created for `FT-26-001`; Method A | Showed 0/30 baseline samples because all three samples are future-dated relative to QA date; operator explanation is inadequate (F6) | `23` |
| Removal / GHG Entry | No object created | `CB-26-001` was `Not ready yet`; telemetry plus application stockpile/spreading/incorporation evidence remained; generic setup warning also persisted | `22` |
| GHG Statement | No object created | Period end `2027-12-31` produced Expected contents (0) and disabled Next, correctly preventing an empty statement | `24` |
| Traceability | Full chain selected as `CB-26-001` | DAG displayed `FS-26-001` → `PR-26-001` → `BP-26-001` → `OR-26-001` → `DL-26-001` → `AP-26-001`; map showed supplier/facility/application and 42 km/18 km; Sankey balanced 9,200 kg → 2,760 kg → 2,300 kg applied; batch/view survived reload | `26` |

### 11.4 Final synthetic-record inventory

The initial entities remain in section 9. The continuation added only these staging records;
no corresponding sandbox object was created.

| Entity | App code / name | App UUID | Sandbox registry ID |
|---|---|---|---|
| Biochar product bin | `QA Product Bin 20260721` | Not surfaced | None |
| Biochar Product | `BP-26-001` | Not surfaced | None |
| Order | `OR-26-001` | Not surfaced | None |
| Delivery | `DL-26-001` | Not surfaced | None |
| Application | `AP-26-001` | Not surfaced | None |
| Credit Batch | `CB-26-001` | `c705e487-864e-4749-b5fa-77a7e773e0d3` | None |
| Sample | `SAM-26-001` | Not surfaced | None |
| Sample | `SAM-26-002` | Not surfaced | None |
| Sample | `SAM-26-003` | Not surfaced | None |
| Production Process | Auto-created for `FT-26-001`; Method A | Not surfaced | None |
| Removal / GHG Entry | None | None | None |
| GHG Statement | None | None | None |
| Datapoint / Measurement Sample / Source / telemetry submission | None | None | None |

### 11.5 Final integration coverage

| Interaction | Continuation result | Evidence/limit |
|---|---|---|
| Project/template/facility/feedstock catalogue reads | **PASS (UI), unchanged** | Exact project/template/facility/catalogue IDs continued to resolve |
| Removal readiness/component projection | **PARTIAL (UI)** | Batch and concrete source gaps resolved, but generic link/template warning contradicted Settings |
| Source creation and signed upload flow | **NOT TESTED — environment** | Native chooser could not be controlled; no file or signed URL was transmitted |
| Telemetry submission | **NOT TESTED — environment** | Required CSV could not be attached |
| Datapoint create/update/reconcile | **BLOCKED before registry mutation** | Removal not ready |
| Measurement Sample create/reconcile | **BLOCKED before registry mutation** | Three app samples exist, but no Removal submission triggered mirroring |
| GHG Entry create/poll/reconcile | **BLOCKED before registry mutation** | Telemetry and application-photo gaps |
| GHG Statement create/poll/submit | **CORRECTLY GATED / no write** | No submitted Removal; empty statement disabled |
| Sandbox overview and GHG-entry inventory | **PASS (read-only UI reconciliation)** | Overview unchanged; 31 pre-existing GHG entries; no `CB-26-001` or `PR-26-001` row (`25`) |

### 11.6 Continuation findings

#### F5 — P2 UX/readiness — Credit Batch completed-run selector can serve a stale empty result

- **Route:** `/credit-batches?facility=40131551-9036-48ea-9064-8ae3fde06793`
- **Steps/input:** immediately after completing `PR-26-001`, open New Credit Batch; select
  the sole `FT-26-001` option; use `2027-12-02…04`, then `2027-12-01…05`; wait and reopen
  the feedstock picker.
- **Expected:** the newly completed, same-facility, same-feedstock run appears immediately,
  or the empty state offers an explicit refresh.
- **Actual:** the form continued to say no matching runs. The first Create click did not
  create a batch; the form then refreshed to `1 selected` with `PR-26-001`, after which a
  second click created exactly one `CB-26-001`.
- **Frequency:** 1/1 continuation sequence.
- **Impact:** false ineligibility, ambiguous no-op submit, and duplicate-click risk.
- **Evidence:** artifact `20` confirms the eventual single batch. Read-only source tracing
  found a 30-second selector `staleTime` (`src/hooks/use-credit-batches.ts:16,103`) and no
  invalidation of `creditBatches/productionRunOptions` after production-run mutation
  (`src/hooks/use-production-runs.ts:334`). A successful cached empty state has no refresh
  action (`src/components/credit-batches/credit-batch-form.tsx:160,195-200`).

#### F6 — P2 UX/data-validity — Batch calls future samples usable/Eligible while process shows 0/30 without explanation

- **Routes:** `/samples`, `/credit-batches`, and `/certification/production-processes`, all
  scoped to facility `40131551-9036-48ea-9064-8ae3fde06793`.
- **Steps/input:** create three complete 1000-year samples for `CB-26-001` on
  `2027-12-02`, `2027-12-03`, and `2027-12-04`; open batch detail and Production Processes.
- **Expected:** either prevent/explain future sampling dates, or clearly explain that
  batch durability eligibility and the Method-B pre-unlock baseline use different clocks
  and predicates.
- **Actual:** batch detail reported `3 of 3 usable`, `3 distinct runs/days`, and Eligible;
  the process row reported `0 / 30 eligible samples` and `30 more to qualify` with no
  exclusion reason. Newly created samples cannot select a production run, so the phrase
  `distinct runs/days` is also ambiguous for these batch-only rows.
- **Frequency:** 3/3 samples counted by batch and 0/3 by process, deterministic on reload.
- **Impact:** an operator can believe samples are accepted toward Method B when none count;
  future-dated data can appear certification-ready in one surface.
- **Evidence:** artifacts `21` and `23`. Source tracing confirms batch rollup has no
  as-of-now filter, while the production-process counter applies `samplingTime < new Date()`
  (`src/data-access/production-processes.ts:194-199`; `src/data-access/isometric.ts:31-38`).

#### F7 — Potential P1 compliance/integrity — Method-B counter lacks the accepted lower bound at process establishment

- **Route/surface:** Production Processes unlock/readiness; read-only implementation review
  prompted by the 0/30 discrepancy. This risk was **not runtime-exploited**.
- **Steps/input:** compare ADR 0017's accepted baseline rule with the TypeScript counter and
  database unlock guard.
- **Expected:** only samples with `sampling_time >= production_process.established_at` and
  before the unlock/as-of instant count toward the 30-sample baseline.
- **Actual:** both counter paths enforce only the upper time bound; neither includes the
  establishment lower bound. Sample creation prevents dates before batch start, not before
  process establishment.
- **Frequency:** deterministic in the inspected implementation; no staging mutation was
  performed to demonstrate an invalid unlock.
- **Impact:** pre-establishment batch samples may count toward Method-B unlock, creating a
  compliance and over-crediting risk if such records exist.
- **Evidence:** `docs/adr/0017-method-b-unlock-registry-computes-noma-gates-and-previews.md:28-31,65-72`;
  `src/data-access/isometric.ts:25-52`; `drizzle/0060_process_method_b_minimum_samples_guard.sql:44-67`;
  deferred follow-up `docs/plans/2026-07-12-method-b-edge-case-followup.md:220-229`.

#### F2 continuation — P2 Integration/UX — Generic setup warning persists beside concrete readiness gaps

- **Route:** `/certification/removals?facility=40131551-9036-48ea-9064-8ae3fde06793`
- **Steps/input:** open New Removal after `CB-26-001` and three samples exist; wait more
  than three seconds.
- **Expected:** show the configured link and only actionable source-data gaps.
- **Actual:** the page still says to link the facility and set a template, while also
  showing `CB-26-001` as Not ready yet with telemetry and application-photo gaps.
- **Frequency:** 1/1 continuation attempt; extends the initial F2.
- **Impact:** contradictory remediation sends operators to already-complete Settings.
- **Evidence:** artifact `22`; exact sandbox link and Settings were reconfirmed.

#### F3 continuation — P3 UX — Facility context false-empty state remains slow

- **Routes:** direct/reloaded facility-scoped routes.
- **Steps/input:** navigate directly with the facility query parameter and wait for context.
- **Expected:** retained facility or neutral loading state.
- **Actual:** a false select-facility/empty state preceded the correct facility for up to
  approximately 5.7 seconds.
- **Frequency:** observed repeatedly during continuation navigation.
- **Impact:** temporary false blocker and unnecessary retry/selection risk.
- **Evidence:** timing observations during production-run and traceability reloads; known
  issue #473 remains applicable.

### 11.7 Correct gates, transients, and environment limits

- Product, Order, and Delivery downstream selectors refreshed successfully; the Samples
  batch selector took about 1.5 seconds before `CB-26-001` appeared. Traceability retained
  the selected batch and Sankey view after reload.
- Empty GHG Statement prevention was correct: zero expected contents kept Next disabled.
- Removal correctly kept `CB-26-001` out of the ready set while telemetry and application
  evidence were missing. No unsafe bypass was attempted.
- A single file-chooser attempt timed out because the browser extension lacked file-URL
  access. It also dismissed/reset the unsaved application panel. A plainly marked
  `SYNTHETIC QA EVIDENCE — NOT REAL` fixture was created as artifact `18`, but no byte was
  transmitted. This is an environment limitation, not an app upload verdict.
- The final sampled staging and sandbox browser logs contained zero warning/error entries.
  The browser exposed no safe request ledger, so method/path/status and retry semantics for
  external writes remain unverified.
- The sandbox GHG-entry page showed 31 pre-existing rows and no `CB-26-001` or
  `PR-26-001`; the overview/statement state remained unchanged. Evidence is artifact `25`.
- All meaningful non-upload paths were exhausted. Source, Datapoint, Measurement Sample,
  GHG Entry, telemetry, and GHG Statement write/idempotency paths remain untested until
  attachment capability is available and readiness can be cleared.

## 12. Upload continuation after Chrome file access was enabled

### 12.1 Verdict and scope

**Verdict: environment-blocked again; no app or sandbox mutation occurred.** The user
enabled Chrome file-URL access and authorized this continuation. Four QA-only fixtures
were prepared, but the connected Chrome control still failed to expose a file chooser
from either the actual production file input or the visible button. Consequently the
telemetry and application-evidence prerequisites could not be cleared, and Removal/GHG
Entry plus GHG Statement creation remained correctly gated.

No record was reset or recreated. `CB-26-001`, `PR-26-001`, `AP-26-001`, and
`SAM-26-001`–`003` were re-used. No database, source, branch, commit, PR, or issue action
was performed. Production Isometric was never accessed.

The connected Isometric `how_to` capability was unavailable in this session. No new
Isometric API/MCP interpretation call was made; reconciliation was restricted to the
authenticated UI for sandbox project `prj_1K9YJ33RKSBX9FFF`.

### 12.2 QA-only fixtures

| Fixture | Purpose | Result |
|---|---|---|
| `qa-only-synthetic-pr-26-001-readings.csv` | Canonical telemetry; 16 rows, `2027-12-02T08:00:00Z`–`15:30:00Z`, entirely inside the `08:00`–`16:00` run window | Created locally; not attached |
| `qa-only-synthetic-application-stockpile-not-field-proof.png` | Stockpile role | Created locally; large synthetic/not-proof labels; not attached |
| `qa-only-synthetic-application-spreading-not-field-proof.png` | Spreading role | Created locally; visually distinct; not attached |
| `qa-only-synthetic-application-incorporation-not-field-proof.png` | Incorporation role | Created locally; visually distinct; not attached |

No upload metadata field was reachable because no chooser returned. The filenames carry
the synthetic designation unambiguously.

### 12.3 Upload and persistence matrix

| Displayed filename | Role | Upload outcome | Save/reload persistence |
|---|---|---|---|
| None displayed | Production readings | **FAIL / environment**, chooser timeout 2/2 across the actual input and visible button | Not testable; reopening showed `0 files` and no readings |
| None displayed | Stockpile | **BLOCKED by same chooser mechanism**; control loaded at `0 files` | Not testable |
| None displayed | Spreading | **BLOCKED by same chooser mechanism**; control loaded at `0 files` | Not testable |
| None displayed | Incorporation | **BLOCKED by same chooser mechanism**; control loaded at `0 files` | Not testable |

Sanitized runtime failure: `file chooser event timed out`. No credential-bearing or signed
URL material was captured. The browser did not expose a network ledger, so no HTTP status
is claimed. Console warnings/errors were `0` on both sampled staging and sandbox tabs.

### 12.4 Readiness, samples, and idempotency

- `PR-26-001` remained Complete but `Incomplete (1)` for telemetry.
- `AP-26-001` remained Applied, Visual proof, `Incomplete (1)`, with all three evidence
  roles at `0 files`.
- `CB-26-001` remained Pending with one grouped source-data issue. Its expanded message
  still named telemetry plus stockpile, spreading, and incorporation photos.
- `SAM-26-001`–`003` remained present, `3 of 3 usable`, three distinct days, Eligible;
  no sample was recreated.
- Reload/direct-navigation briefly showed a false `No credit batches yet` state before the
  one existing batch resolved, extending F3's stale/transient-state evidence.
- Removal wizard settled at `0 of 1 batches ready`, `0 selected`; Continue stayed disabled.
- GHG Statement period end `2027-12-31` settled at Expected contents `(0)`; Next stayed
  disabled. No empty statement or duplicate was created.

### 12.5 Sandbox reconciliation

Authenticated read-only UI reconciliation on only `prj_1K9YJ33RKSBX9FFF` found:

- 31 pre-existing GHG entries (`Showing 10 of 31`), unchanged from the prior baseline.
- 11 pre-existing GHG Statements (`Showing 10 of 11`), unchanged; newest period remained
  `22 Nov 2026 to 30 Nov 2027`, Draft, 12 GHG entries, `-3.24 tCO₂e`.
- No app Removal, GHG Statement, Datapoint, Measurement Sample, Source, or telemetry
  submission existed to reconcile to a new sandbox ID.

### 12.6 Continuation finding F8 — P2 environment/automation — file chooser still unavailable after permission enablement

- **Routes:** `/production-runs?facility=40131551-9036-48ea-9064-8ae3fde06793&run=6c82d52b-e354-49fe-9fb6-3f9db9409f96`; `/applications?facility=40131551-9036-48ea-9064-8ae3fde06793` editing `AP-26-001`.
- **Steps/input:** confirm the production editor has one file input; arm the chooser wait;
  click the input and select the synthetic CSV path. Reconnect, reopen, then repeat via
  the visible `Choose File` button.
- **Expected:** chooser returns, local filename appears, upload/import succeeds or returns
  an app/network error that can be evaluated, and the file/readings persist after save and
  reload.
- **Actual:** browser control timed out before exposing the chooser on both paths (2/2),
  reset control, and returned to unchanged staging state. No byte was selected/transmitted.
- **Frequency:** 2/2 production attempts; application controls use the same mechanism and
  were not repeatedly triggered after deterministic failure.
- **Impact:** blocks local attachment verification and every downstream Isometric write
  path in this chain. This remains an execution-environment finding, not proof of an app
  upload endpoint defect.
- **Evidence:** artifacts `28`, `30`, `31`, and `34`.

### 12.7 Evidence

- `28-application-evidence-controls-upload-blocked.png`
- `29-credit-batch-readiness-and-samples.png`
- `30-removal-still-blocked-after-upload-attempts.png`
- `31-ghg-statement-still-gated-zero-removals.png`
- `32-sandbox-ghg-entry-inventory-unchanged-31.png`
- `33-sandbox-ghg-statements-unchanged-11.png`
- `34-upload-runtime-and-reconciliation.md`

## 13. Method-B, forced-upload, Removal, and GHG stress continuation

### 13.1 Verdict and safety

**Verdict: Method B can be unlocked with a maximally clustered 30-sample baseline;
post-unlock sample edit/delete invariants are enforced, but the distribution gate is not.
Staging uploads are now confirmed to reach the app's upload attempt and fail at the
DigitalOcean Spaces network step. Removal and GHG submission remain safely gated.**

This continuation reused `FAC-26-001` and the existing synthetic chain. It first fetched
`origin/staging`; local `staging` and `origin/staging` were both at
`f2c55106ecb87e9c583b466353adba2e6f00a6b7`. All mutations were synthetic staging UI
records. No database command, reset, source edit, branch, commit, push, PR, issue, Removal,
GHG Entry, GHG Statement, Datapoint, Measurement Sample, Source, or telemetry submission
was created. Production Isometric was not accessed.

The native macOS chooser was successfully controlled in this pass, superseding F8's
environment-only conclusion. The app accepted the local file selection far enough to
attempt upload, then showed a concrete storage-host network error. No credential, cookie,
authorization header, signed URL, or token was captured.

### 13.2 Method-B runtime matrix

An isolated reactor and run were created so the boundary test did not alter the original
future-dated production run:

- Reactor `R-26-002`, identifier `MB-QA-260721-REACTOR`, Batch, throughput 0.1.
- Production run `PR-26-002`, `2026-07-21`, 100 kg wet feedstock at 8% moisture,
  30 kg wet output, transitioned Draft -> Running -> Complete with end time `15:00`.
- Credit batch `CB-26-002`, UUID `216a0635-864f-4298-b70e-32adb23a5f93`, period
  `2026-07-21`.
- Samples `SAM-26-004` through `SAM-26-033`: all 30 belong to the same batch/run/day and
  use the exact same timestamp, `2026-07-21 14:00`. Each has complete 1000-year chemistry:
  total C 82%, organic C 80%, H 2.4%, O 1%, R0 mean 2.5, R0 >=2 fraction 95%, 100
  measurements, 10% reactive and 90% residual carbon.

| Boundary/action | Expected | Observed | Result |
|---|---|---|---|
| 10/30 samples | Locked | `20 more to qualify`; unlock disabled | **PASS** |
| 29/30 samples | Locked | `1 more to qualify`; unlock disabled | **PASS** |
| 30/30 samples, all clustered | Distribution should block unlock | `Eligible to unlock Method B`; unlock enabled | **FAIL — #474** |
| Batch detail at 30/30 | Eligibility should agree with distribution warning | `30 of 3 usable samples`, `Clustered on one run/day`, and `Eligible` appear together | **FAIL — #474** |
| Empty sampling-plan reference | Validation should block | Specific inline validation | **PASS** |
| Declared baseline size 29 | Validation should block | `Must be at least 30` | **PASS** |
| Declared baseline size 31 with 30 samples | Server should reject with actionable error | Server rejected, but dialog rendered only `An unexpected error occurred` | **FAIL — F10** |
| Valid declaration size 30 | Unlock and persist declarations | Unlock succeeded; plan reference and per-batch moisture pathway persisted after reload | **PASS** |
| Post-unlock edit that future-dates one baseline sample | Preserve >=30 pre-unlock samples | Specific baseline-invariant alert; save rejected | **PASS** |
| Post-unlock delete of one baseline sample | Preserve >=30 pre-unlock samples | Optimistic loading briefly hid the row, then deletion was rejected and the sample remained | **PASS** |

After reload the process remained `Method B`, with one active process, zero eligible-but-
locked processes, established/unlocked on Jul 21, 2026, and an unsampled preview of 80.00%
pooled from the 30 samples. The cadence display reported `1/1 batches (>=1 per 10)` because
the future `CB-26-001` falls after unlock. The same-day `CB-26-002` remained on its original
Method-A side of the transition: Removal readiness required only a period-matching
application, not post-unlock telemetry/evidence requirements.

### 13.3 Upload continuation — issue #453 reverified

The macOS chooser successfully handed both fixtures to the staging application:

| Surface | Fixture | Observed result |
|---|---|---|
| `AP-26-001` stockpile evidence | `qa-only-synthetic-application-stockpile-not-field-proof.png` | `Upload network error — could not reach fra1.digitaloceanspaces.com. Check your connection and retry.` |
| `PR-26-001` telemetry | `qa-only-synthetic-pr-26-001-readings.csv` | Same storage-host network error |

A read-only host check to `https://fra1.digitaloceanspaces.com/` returned HTTP 200 from
the QA machine. That does not prove the browser's signed upload request is valid, but it
rules out a simple host-wide outage from the test machine. The evidence supports a staging
browser upload path, storage configuration, signed-request, or CORS failure. Existing
issue **#453** remains the correct duplicate. No uploaded file or reading persisted.

### 13.4 Removal and GHG reconciliation

- Removals remained `0`; GHG Statements remained `0`.
- `CB-26-002` was `Not ready yet` with one actionable issue: no application falls within
  its Jul 21 crediting period.
- Future `CB-26-001` was `Not ready yet` with telemetry plus stockpile, spreading, and
  incorporation evidence missing.
- The wizard still displayed `Link this facility to Isometric and set a removal template`
  while Certification Settings, after full loading, simultaneously showed:
  project `Tanzania biochar`, default removal template `Dark Earth Carbon Template`, a
  linked telemetry facility, Sandbox, and configured credentials. This reconfirms F2 as a
  false setup warning, not a transient link state.
- A blank GHG period end correctly produced `Pick a valid period end date`. Period end
  `2026-07-21` showed zero removals and kept progression disabled. No empty statement was
  created.
- The external project link opened an Isometric sign-in page in this fresh Chrome tab.
  The prior authenticated 31-entry/11-statement baseline therefore could not be
  independently recounted in this continuation. No NOMA submission action was reachable
  or triggered.

### 13.5 New and deduplicated findings

#### F9 — P1 compliance/integrity — maximally clustered samples can unlock Method B

- **Runtime reproduction:** 30/30 samples from one batch, one run, one day, and one exact
  timestamp enabled and completed Method-B unlock.
- **Contradiction:** the batch UI simultaneously warned `Clustered on one run/day` and
  labeled the pool `Eligible`.
- **Impact:** chemistry-complete duplicates or non-independent samples can satisfy the
  compliance transition while failing the intended sampling-distribution control.
- **Frequency:** deterministic at the 29/30 and 30/30 boundary, 1/1 full run.
- **Duplicate:** open issue **#474**, `fix: durability eligible chip must reflect sampling
  distribution, not just chemistry`.
- **Related:** open issue **#417** covers the fail-closed Method-B routing/cadence gap.

#### F10 — P2 UX/diagnostics — unlock dialog discards the actionable server error

- **Steps:** with 30 eligible samples, enter agreed baseline size `31` and otherwise valid
  declarations; submit unlock.
- **Expected:** surface that only 30 of 31 declared samples are eligible.
- **Actual:** the server rejects correctly, but the dialog renders only
  `An unexpected error occurred`.
- **Impact:** an operator cannot distinguish a fixable declaration mismatch from an outage
  and is encouraged to retry blindly.
- **Frequency:** 1/1. Empty-plan and below-30 client validation remained specific.
- **Duplicate search:** no matching open or closed issue found by current backlog search.

#### F2 reverified — P2 Integration/UX — linked facility is still reported unlinked

- **Frequency:** reproduced again after two credit batches existed and after the settings
  mapping fully loaded.
- **Impact:** remediation points to settings that already contain the requested project,
  template, external facility, environment, and credentials.
- **Duplicate search:** no exact issue found. Keep F2 in this ledger until filed.

#### Observation — in-app browser organization switching did not activate the selected org

The in-app browser redirected after selecting Dark Earth Carbon but retained the previous
organization context in two attempts. The controlled Chrome session switched and operated
correctly. Treat this as browser-session-specific and not a confirmed application defect
until reproduced in a normal user browser.

### 13.6 Final continuation inventory and evidence

| Entity | Result |
|---|---|
| Reactor | `R-26-002` created |
| Production run | `PR-26-002` created and Complete |
| Credit batch | `CB-26-002`, `216a0635-864f-4298-b70e-32adb23a5f93` |
| Samples | `SAM-26-004`–`SAM-26-033`; all retained after guard tests |
| Production process | One process, Method B Active |
| Removal / GHG Entry / GHG Statement | None created |
| Isometric Source / Datapoint / Measurement Sample / telemetry submission | None created |

Runtime screenshots captured during the pass include the 29/30 boundary, clustered 30/30
eligibility, the contradictory batch status, both upload network failures, and the false
Removal setup warning. The authoritative text evidence and final safety audit are recorded
in `artifacts/2026-07-21-staging-isometric/method-b-stress-continuation-report.md`.
