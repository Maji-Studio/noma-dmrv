# Run 2 — staging UX / operator-experience audit — 2026-07-21

## 1. Executive verdict

**Verdict: Usable with material friction.** The populated synthetic chain is durable and
navigable from facility through Credit Batch, and staging correctly prevents an empty GHG
Statement or an unready Removal. All 34 app page modules were visited, the intended legacy
redirects resolved, the exact sandbox project remained unchanged, and the sampled browser
logs contained no warnings or errors.

The experience is not production-ready for certification operators without explanation or
training. `CB-26-001` is simultaneously presented as `3 of 3 usable`, `Eligible`, `0 / 30
eligible samples`, `Pending`, `1 cert gap`, and `2 of 4 cleared`. Some of those states are
technically compatible because the samples are dated in the future, but the UI never names
the different clocks or predicates. The Removal wizard then adds a false instruction to link
the facility and choose a template even though Settings shows the exact project, template,
and external facility. The operator can eventually infer the real telemetry/evidence work,
but cannot trust the first status they see.

No P0 or confirmed P1 was found. Four P2 findings and two meaningful P3 findings are recorded.
The one authorized staging mutation was completed safely: `QA-DELETE-20260721` (`FAC-26-002`)
was created through the UI, archived through the UI, removed from active context, and verified
in the archived view. The populated `FAC-26-001` was previewed only and was not archived.

## 2. Single worst operator-experience gap

**The product uses “eligible” for two incompatible decisions without naming the time rule.**
On the Credit Batch, three future-dated samples are usable for that batch's chemistry and the
surface says `Eligible`. On Production Processes and in the batch editor, the same campaign
says `0 / 30 eligible samples`. The latter intentionally excludes samples whose sampling time
is after “now,” but no UI explains that exclusion.

The failed operator question is: **“Do these three accepted samples count toward Method B, and
if not, why not?”** The unnecessary burden is comparing four surfaces and reverse-engineering
the current date. This belongs in Layer 1: rename the two states (`Batch chemistry complete`
versus `Counts toward Method-B baseline on <date>`), show `3 future-dated — not counted yet`,
and prevent accidental future sampling dates unless the workflow explicitly supports planned
samples.

## 3. Top five fixes, in recommended order

1. **Separate batch usability from Method-B baseline eligibility.** This comes first because
   the current copy can cause an operator to believe compliance progress exists when the
   process counter correctly records zero. Prevent or explicitly label future-dated samples,
   show the exclusion reason, and use distinct terms across batch, editor, and process pages.
2. **Return and render structured facility-setup gaps in the Removal flow.** The current
   boolean collapses an unresolved blueprint/configuration condition into a false link/template
   instruction. Name the exact missing mapping and link directly to the control that fixes it.
3. **Replace the inert `Pending` lifecycle with an operator-owned readiness state.** `Pending`
   is the database default and no normal transition path was found. Use derived states such as
   `Blocked — 1 certification gap`, `Ready to submit`, and `Submitted`, or remove the lifecycle
   badge until transitions exist.
4. **Make facility archive confirmation identity- and risk-proportional.** Name the facility in
   the dialog, keep the excellent dependency counts, use a lightweight confirmation for an
   empty facility, and require a typed code or explicit second step for populated or
   registry-linked facilities.
5. **Split operator configuration from integration diagnostics.** Keep facility, environment,
   project/template/facility link, and the immediate action on the Settings first layer. Move
   credentials health and host allowlists to an admin/diagnostics layer; keep tier-specific
   emission inputs only when they apply.

## 4. Environment, revision, browser, and safety

- Application: `https://staging.noma.maji.studio`.
- Registry: exact Isometric sandbox project `prj_1K9YJ33RKSBX9FFF` only.
- Revision: `f2c55106ecb87e9c583b466353adba2e6f00a6b7` on local branch `staging`.
- Browser: authenticated Google Chrome `150.0.7871.129` through the connected user session.
- Authentication: both required surfaces were confirmed before mutation. An initial isolated
  browser worker could not inherit those sessions; the audit continued in the authenticated
  connected Chrome session, so that tooling-context failure is not the final verdict.
- Empty-state/first-impression review was intentionally out of scope on staging. Partial and
  legitimate zero-child states were reviewed where they occurred.
- **No database command, query, reset, seed, migration, or direct mutation was run.**
- No source code, branch, commit, PR, or issue was created. Only this findings ledger and its
  artifacts were written locally.
- UI mutations were limited to the authorized `QA-DELETE-20260721` facility create/archive.
  No populated record was edited or archived, and no registry write or submission occurred.
- No credentials, cookies, tokens, authorization headers, signed URLs, contact details, names,
  or email addresses were retained in the report or screenshots.
- Browser diagnostics: zero warning/error console entries on the sampled staging tabs and
  sandbox tab. The connected browser exposed no safe request ledger, so raw HTTP status and
  retry/idempotency claims are not made.
- Keyboard: a representative Credit Batch editor path exposed a visible focus ring and Escape
  closed the panel. Source inspection confirms reduced-motion overrides for the traceability
  flow, dashboard scene, and gate-row animations.
- Responsive limitation: the connected Chrome backend ignored both its requested `390 × 844`
  viewport override and browser zoom shortcuts; it continued to report `2174 × 1035`. Narrow
  app and 200% zoom behavior therefore remain **environment-blocked**, not passed or failed.

## 5. Route and full-chain checklist

### 5.1 Route inventory

All **34/34** `page.tsx` modules under `src/app/(app)` were visited. Important populated
surfaces were allowed 9–15 seconds to settle; the exhaustive reachability pass used a shorter
shell wait and checked the final URL, first heading, and fatal UI state.

| Route/module | Runtime result |
|---|---|
| `/dashboard` | Dashboard loaded; populated attention and activity state settled |
| `/traceability` | Populated Sankey/DAG/map shell loaded; selected batch persisted |
| `/facilities` | Active and archived modes loaded |
| `/feedstocks` | Populated list loaded |
| `/production-runs` | `PR-26-001` loaded Complete |
| `/formulations` | Legitimate empty state loaded |
| `/biochar-products` | Populated list loaded |
| `/reactors` | Populated list loaded |
| `/storage-locations` | Populated list loaded |
| `/energy` | Route loaded without a fatal state |
| `/suppliers` | Populated list loaded |
| `/suppliers/[supplierId]` | Synthetic supplier detail loaded |
| `/customers` | Populated list loaded |
| `/customers/[customerId]` | Synthetic customer detail loaded |
| `/orders` | `OR-26-001` loaded Fulfilled |
| `/deliveries` | `DL-26-001` loaded Delivered and fields complete |
| `/applications` | `AP-26-001` loaded Applied and `Incomplete (1)` |
| `/credit-batches` | `CB-26-001` card loaded with Pending + `1 cert gap` |
| `/credit-batches/[id]` | Detail loaded with checklist and chemistry |
| `/samples` | Three samples loaded; chemistry complete |
| `/certification/removals` | Zero removals; New Removal readiness loaded |
| `/certification/ghg-statements` | Zero statements; safe empty-statement gate loaded |
| `/certification/production-processes` | One Method-A process loaded |
| `/certification/settings` | Linked sandbox configuration loaded |
| `/settings/organization` | Organization settings loaded |
| `/admin` | Admin route loaded for the authorized viewer |
| `/admin/organizations` | Organizations route loaded |
| `/admin/users` | Intentionally redirected to `/settings/organization` |
| `/admin/emission-estimates` | Redirected to facility-scoped Certification Settings |
| `/certification` | Redirected to `/certification/removals` |
| `/chain-of-custody` | Redirected to `/traceability` |
| `/production-runs/[id]` | Redirected to `/production-runs?run=<id>` |
| `/certification/removals/[id]` | Redirected to `/certification/removals?resume=<id>` |
| `/certification/removals/[id]/review` | Same supported resume redirect |

No route displayed a 404 or fatal error. Several data-heavy shells briefly lacked their
settled heading during the short reachability pass, so no empty/data conclusion is drawn from
those transient frames.

### 5.2 Full-chain stage checklist

| Stage | Current record/state | Result |
|---|---|---|
| Facility | `FAC-26-001`, exact sandbox project/template/facility link | **Pass**; identity and link persist |
| Reactor/storage | One reactor, three storage bins | **Pass** |
| Supplier/feedstock | `SUP-26-001`, `FT-26-001`, `FS-26-001` | **Pass** |
| Production Run | `PR-26-001`, Complete, end `2027-12-02 16:00` | **Pass**; persisted after Run 1 fix/reload |
| Biochar Product | `BP-26-001`, 3,000 kg wet / 2,760 kg dry | **Pass** |
| Order | `OR-26-001`, 2,500 kg, Fulfilled | **Pass** |
| Delivery | `DL-26-001`, 2,500 kg wet / 2,300 kg dry, Delivered | **Pass** |
| Application | `AP-26-001`, 2,300 kg dry, 1.15 ha, Applied | **Partial**; correctly reports missing visual evidence |
| Credit Batch | `CB-26-001`, 2.50 t applied, 5.41 tCO2e preview | **Partial**; one grouped certification issue; status semantics weak |
| Samples | `SAM-26-001`–`003`, three future days | **Partial**; batch chemistry complete, Method-B baseline 0/30 without explanation |
| Removal / GHG Entry | None | **Correctly blocked** by telemetry and application evidence; setup warning is false/generic |
| GHG Statement | None | **Correctly gated**; a 2027-12-31 period has zero submitted removals and Next is disabled |
| Traceability | Full local chain selected under `CB-26-001` | **Pass**; populated lineage remains visible |
| Sandbox registry | 31 pre-existing GHG entries; no current-run code | **Pass, read-only**; no new object or statement |

Persistence/date/number fidelity was confirmed by comparing the settled Run 2 surfaces to
Run 1's post-fix durable records. The Application list and Dashboard both retain the evidence
gap; the Credit Batch retains 2.50 t, 5.41 tCO2e preview, one run, three samples, and the exact
date range.

## 6. Findings ledger

### F1 — P2 Data integrity/certification + UX/IA — “Eligible” hides the future-date exclusion from Method B

- **Routes/records:** `/credit-batches/c705e487-864e-4749-b5fa-77a7e773e0d3`,
  `/credit-batches`, and `/certification/production-processes`, facility
  `40131551-9036-48ea-9064-8ae3fde06793`; `CB-26-001`, `FT-26-001`,
  `SAM-26-001`–`003`.
- **Steps/input:** open the batch after the three 1000-year samples dated `2027-12-02`,
  `2027-12-03`, and `2027-12-04`; then open the editor and Production Processes. Reload the
  process page and repeat.
- **Expected:** either future sampling dates are prevented, or the UI distinguishes batch
  chemistry usability from Method-B baseline eligibility and names why each sample is excluded.
- **Actual:** batch detail says `3 of 3 usable samples`, `3 distinct runs/days`, and `Eligible`.
  The editor and Production Processes say `0/30 eligible samples` and `30 more to qualify`.
  No surface says that the process counter excludes sampling times after the current date.
- **Frequency:** deterministic on **2/2** process loads, including a fresh-tab reload; 3/3
  samples are included on the batch and 0/3 in the process baseline.
- **Impact:** operators can overstate Method-B progress or distrust accepted lab data. A future
  unlock is a compliance decision, so unexplained exclusion is material even though the
  current zero is technically correct.
- **Evidence:** [Production Process 0/30](./artifacts/2026-07-21-staging-ux/06-production-process-sample-count.png)
  and [batch detail](./artifacts/2026-07-21-staging-ux/15-credit-batch-detail-open-issue.png).
- **Source root cause:** the batch aggregate includes linked samples without an “as of now”
  limit, while `getProductionProcesses` passes `new Date()` and the canonical counter applies
  `samplingTime < asOfDate` (`src/data-access/production-processes.ts:194-199`,
  `src/data-access/isometric.ts:25-48`). This explains the observed difference confidently.
- **Known/duplicate:** duplicate of Run 1 continuation F6. Open issue #474 is related to
  sample clustering/readiness but is not an exact duplicate.
- **Operator question:** “Do these accepted samples count toward Method B?”
- **Cognitive burden:** compare batch, editor, process, and calendar date; infer two definitions
  of the same word.
- **Layer/simplification:** **Layer 1.** Rename to `Batch chemistry complete` and `Method-B
  baseline: 0/30`; add `3 future-dated samples start counting on 2 Dec 2027`, with a direct
  view of excluded samples. Prefer blocking accidental future dates.

### F2 — P2 Integration/UX — Removal says to configure a link that Settings proves is configured

- **Route/record:** `/certification/removals?facility=40131551-9036-48ea-9064-8ae3fde06793`,
  New Removal, `CB-26-001`.
- **Steps/input:** open New Removal; wait 11 seconds for the readiness result.
- **Expected:** show only the unresolved setup component and the concrete telemetry/evidence
  gaps, with exact fix destinations.
- **Actual:** the first warning says `Link this facility to Isometric and set a removal
  template`. In the same session Settings showed project `prj_1K9YJ33RKSBX9FFF`, template
  `rvt_1KS4S43VPSBXA26X`, and external facility `fcl_1KST05ZW3SBXZCM7`. The batch beneath the
  warning correctly identifies telemetry and three application-photo requirements.
- **Frequency:** **1/1** in Run 2 after settling; also reproduced in both phases of Run 1.
- **Impact:** the operator is sent to an already-complete page and may unlink/relink a correct
  integration instead of resolving the actual blueprint or source-data gap.
- **Evidence:** [Removal readiness](./artifacts/2026-07-21-staging-ux/04-removal-readiness-mismatch.png)
  and [linked Settings](./artifacts/2026-07-21-staging-ux/07-certification-settings-overloaded.png).
- **Source root cause:** `facilitySetupComplete` also requires zero unresolved blueprint keys
  (`src/fn/certification/certify-context-core.ts:989-993`), but every false case is rendered as
  the same link/template message (`src/components/certification/new-removal-dialog/select-batches-step.tsx:208-229`).
- **Known/duplicate:** confirmed duplicate of Run 1 F2. Issue #291 is related to blueprint-
  specific fields; issue #380 is related to Removal/GHG copy and actions.
- **Operator question:** “What exact setup item is still missing?”
- **Cognitive burden:** inspect IDs in Settings and decide whether the warning or settings card
  is authoritative.
- **Layer/simplification:** **Layer 1** for the exact missing item and action; **Layer 3** for
  blueprint key/diagnostic detail. Remove the generic warning when project/template are linked.

### F3 — P2 UX/IA — `Pending` is an inert lifecycle badge competing with real readiness

- **Routes/record:** Dashboard, `/credit-batches`, batch detail, batch editor, and traceability;
  `CB-26-001`.
- **Steps/input:** compare the badge on each settled surface with the certification readiness
  and available actions.
- **Expected:** a status names an operator-relevant lifecycle state and changes as the batch
  moves from incomplete to ready to submitted/issued.
- **Actual:** every surface says `Pending`, while the useful state is `1 cert gap` / `2 of 4
  cleared`. The editor has no status control and source search found no normal Credit Batch
  transition path. The list filter nevertheless advertises Draft, Pending, Verified, Issued,
  and Rejected.
- **Frequency:** observed on **5/5** surfaces for the one populated batch.
- **Impact:** the most visually prominent status does not answer whether the operator can act.
  Operators must learn to ignore it and find a secondary readiness signal.
- **Evidence:** [Credit Batch card](./artifacts/2026-07-21-staging-ux/03-credit-batch-card-one-cert-gap.png),
  [detail](./artifacts/2026-07-21-staging-ux/15-credit-batch-detail-open-issue.png), and
  [Dashboard](./artifacts/2026-07-21-staging-ux/14-dashboard-readiness.png).
- **Source root cause:** the schema defaults every batch to `pending`
  (`src/db/schema/credits.ts:49-54`); the enum exposes five lifecycle values
  (`src/db/schema/common.ts:37-43`), but no Credit Batch status mutation was found.
- **Known/duplicate:** no exact known issue found.
- **Operator question:** “Is this batch blocked, ready for submission, or waiting on the
  registry?”
- **Cognitive burden:** reconcile a static lifecycle badge with a separate dynamic gate.
- **Layer/simplification:** **Layer 1.** Replace `Pending` with the readiness-derived phrase or
  remove it. Keep `Submitted/Accepted/Rejected` only when an actual registry lifecycle exists.

### F4 — P2 UX/safety — Facility archive confirmation omits identity and does not scale with risk

- **Route/records:** `/facilities`; populated `FAC-26-001` preview and empty `FAC-26-002`
  (`QA-DELETE-20260721`) confirmation.
- **Steps/input:** open Actions → Archive for the populated facility but do not confirm; create
  the authorized empty facility, open its Archive dialog, then confirm.
- **Expected:** name the facility and use confirmation proportional to dependency/external risk.
- **Actual:** both dialogs are titled only `Archive Facility` and use the same single Archive
  button. The populated preview accurately lists 1 reactor, 3 storage bins, 1 feedstock batch,
  1 run, 1 product, 1 order, 1 delivery, 1 application, 1 Credit Batch, and 3 samples, but the
  dialog itself never repeats `FAC-26-001` or the facility name. The action is correctly
  described as reversible and no external write occurs.
- **Frequency:** identity omitted in **2/2** dialogs; same confirmation in **2/2**.
- **Impact:** in a multi-facility operation, a menu/context slip can hide an entire populated
  site. Recovery exists, so this is P2 rather than P1.
- **Evidence:** [populated preview](./artifacts/2026-07-21-staging-ux/08-populated-facility-archive-preview.png),
  [empty preview](./artifacts/2026-07-21-staging-ux/09-empty-facility-archive-preview.png), and
  [archived result](./artifacts/2026-07-21-staging-ux/10-archived-facility-view.png).
- **Source root cause:** the dialog receives only an ID and renders a static title/copy; the
  confirm button is unchanged by impact (`src/components/facilities/archive-facility-dialog.tsx:67-87,138-154`).
  Submitted registry objects produce a warning but do not block the same action
  (`:122-134`).
- **Known/duplicate:** no exact known issue found.
- **Operator question:** “Which site am I archiving, and why is this confirmation safe for
  these dependent and externally linked records?”
- **Cognitive burden:** look behind the modal to re-identify the card and personally judge ten
  categories of impact.
- **Layer/simplification:** **Layer 1.** Title with code + name, summarize `13 dependent records`,
  disclose the category inventory in Layer 2, and require typed code/admin-governed confirmation
  for populated or submitted lineages.

### F5 — P3 UX/IA — Certification Settings mixes operator action with integration diagnostics

- **Route/record:** `/certification/settings?facility=40131551-9036-48ea-9064-8ae3fde06793`,
  `FAC-26-001`.
- **Steps:** open Settings as the facility operator and identify the next action after the
  Removal warning.
- **Expected:** the linked project/template/facility and any unresolved action dominate; health
  diagnostics are available to an administrator on demand.
- **Actual:** the page correctly identifies the facility, sandbox environment, link, and Edit/
  Unlink actions. It then gives first-layer space to credentials state, upload-host allowlist,
  and document-redirect allowlist—none actionable here—while the unresolved blueprint reason
  that triggered the Removal warning is absent.
- **Frequency:** observed once on the settled page.
- **Impact:** low immediate risk, but the operator sees healthy technical signals and still
  cannot discover why Removal reports setup incomplete.
- **Evidence:** [Settings](./artifacts/2026-07-21-staging-ux/07-certification-settings-overloaded.png).
- **Source root cause:** `CertificationHealthPanel` is mounted as a first-class settings section
  for every admin (`src/components/certification/certification-settings.tsx:167-175`).
- **Known/duplicate:** #291 is related; no exact IA issue found.
- **Operator question:** “What must I configure now?”
- **Cognitive burden:** scan environment, credentials, and allowlists even though all are
  read-only and healthy.
- **Layer/simplification:** keep connection/action in **Layer 1**; tier-specific estimate in
  **Layer 2**; health/allowlists in **Layer 3**. Add the concrete setup gap to Layer 1.

### F6 — P3 Functional/UX — Archived-country filter excludes the country visible in the archived list

- **Route/record:** `/facilities`, Archived mode; `FAC-26-002`, Switzerland.
- **Steps/input:** archive `QA-DELETE-20260721`, open Archived, inspect the country selector.
- **Expected:** a filter on the archived collection offers `Switzerland`, the country of the
  visible archived record.
- **Actual:** the only country option is `Tanzania`, which belongs to the active facility;
  `Switzerland` is absent while the Switzerland card is visible.
- **Frequency:** observed once immediately after archive and query invalidation.
- **Impact:** archived facilities cannot be filtered by a country that exists only in the
  archived set.
- **Evidence:** [Archived view](./artifacts/2026-07-21-staging-ux/10-archived-facility-view.png)
  plus the retained accessibility snapshot observation.
- **Source root cause:** the shared countries query explicitly filters to `archivedAt IS NULL`
  (`src/data-access/facilities.ts:819-828`) while the same options are rendered in both list
  modes (`src/components/facilities/facility-list.tsx:331-345`).
- **Known/duplicate:** no known duplicate found.
- **Operator question:** “Why can I see an archived Swiss site but not filter for Switzerland?”
- **Cognitive burden:** assume the filter is stale or incomplete.
- **Layer/simplification:** **Layer 1.** Derive country options from the selected active/archive
  collection, or hide the filter when it cannot represent that collection.

## 7. Design debt by focused surface

| Surface | Keep on first layer | Move to inspect/details | Move to advanced/admin | Remove or rewrite | Missing direct action |
|---|---|---|---|---|---|
| Credit Batch list/card | Code, date range, applied weight, CO2e explicitly labelled preview, meaningful readiness, gap count | Feedstock/process, run membership, detailed chemistry, calculation lineage | Registry payload/IDs and reconciliation diagnostics | Rewrite/remove inert `Pending`; distinguish chemistry from Method-B eligibility | Make `1 cert gap` a direct link to the checklist/exact source record |
| Credit Batch detail/editor | Identity, readiness, exact blocking issue, applied/unclaimed mass, primary resolve action | Member runs, sample table, calculations, notes, registry/accounting | Submission payload and integration journal | Rewrite `Eligible`; explain future-date exclusion; avoid a false `Finish facility setup` label | Direct links for telemetry and each Application evidence role, not one generic production-runs link |
| Removal / GHG Entry | Ready/not-ready batches, exact blockers, selected total, submission consequence | Batch composition, CO2e calculation/evidence summary | Blueprint keys, mappings, Datapoint/Source diagnostics | Remove false link/template warning; distinguish local preview from registry result | Link each missing field to its exact edit/upload control |
| GHG Statement | Period end, included submitted Removals, count/value, irreversible/reversible consequence | Included/rem excluded list and registry-calculated totals | Payload, polling, journal diagnostics | Current zero-content copy is good; retain the disabled Next behavior | When Removals exist, offer direct view/fix for open objects outside the period |
| Certification Settings | Facility identity, sandbox/production warning, project/template/facility link, one primary Edit action | Applicable tier-specific estimate configuration | Credentials status, upload/redirect allowlists, health diagnostics | Rewrite the page around “Connect this facility for certification”; do not repeat healthy environment facts | Surface the structured setup gap that sent the operator here |

The best existing pattern is the Credit Batch checklist: it states the grouped issue, exposes
the missing source facts, and has a review action. The main correction is to propagate that
specificity upward rather than adding more cards or explanations.

## 8. Facility archive behavior and recommended safe contract

### Observed behavior

- The product implements a **reversible soft archive**, not a permanent delete.
- Empty `FAC-26-002` preview: `This facility has no attached data`, followed by 13 checked
  zero-count categories. Confirming archive succeeded.
- Populated `FAC-26-001` preview: 13 categories were checked; ten had data and three were
  explicitly zero. The populated facility was not confirmed.
- After archiving the active empty facility, context moved automatically to valid
  `FAC-26-001`; active counts returned to one; the archived facility was absent from active
  lists and present in Archived with a Restore action available through its menu.
- Source inspection shows child records are soft-archived atomically and the operation does
  not mutate Isometric. Submitted Removal/GHG presence triggers only a warning that external
  registry state is unchanged.
- The live dialogs did not name the target facility. No submitted registry object existed in
  this facility, so the submitted-lineage warning and restore reconciliation were not runtime
  tested.

### Recommended contract

1. Call the operation **Archive facility** everywhere; reserve Delete for a separately governed
   permanent-retention policy.
2. Always repeat facility code and name in the title and confirmation sentence.
3. Show a compact total plus meaningful categories. Keep zero categories behind `What was
   checked?`; keep non-zero counts visible.
4. Empty, unlinked facility: one confirm click is proportionate. Populated facility: typed code
   or explicit second step. Submitted/external lineage: admin-only governed path with reason,
   audit event, external IDs/statuses, and acknowledgement that registry objects remain.
5. Never cascade an external registry deletion. Preserve immutable local submission snapshots,
   journal IDs, and the mapping needed to reconcile or restore.
6. Execute the local soft archive atomically with organization scope; on any failure, keep all
   records active. Invalidate all affected lists/stats only after commit.
7. Move active context to a valid facility (or a neutral selector) and make Restore describe
   exactly which locally archived descendants return. The current fallback behavior passes.

## 9. Cross-surface readiness consistency matrix

| Surface | State shown for the current chain | Assessment |
|---|---|---|
| Dashboard | `1 pending`; three blocking flags; Application missing evidence | Application evidence is consistent; `Pending` is underspecified (F3) |
| Application list | `AP-26-001` Applied, `Incomplete (1)` | Correctly exposes evidence incompleteness; issue #246 behavior is present in this scenario |
| Credit Batch card | `Pending`, `1 cert gap`, 2.50 t, 5.41 tCO2e | Gap count matches detail/Removal; status semantics fail (F3) |
| Credit Batch detail | `2 of 4 cleared`, `1 issue open`, 3/3 usable, `Eligible`, Finish setup | Concrete source gaps are good; setup and eligibility language conflict (F1/F2) |
| Credit Batch editor | Method A, `0/30 eligible samples`, one selected run | Counter matches Production Processes, contradicts unexplained batch `Eligible` (F1) |
| Production Processes | Method A, `0/30`, 30 more to qualify | Technically consistent with future-date filter; missing exclusion explanation (F1) |
| Removal wizard | 0/1 ready, one grouped issue, plus link/template warning | Concrete issue matches batch; setup warning contradicts Settings (F2) |
| GHG Statement | Zero statements; 2027-12-31 expected contents 0; Next disabled | Correct and consistent with no submitted Removal |
| Certification Settings | Exact project/template/external facility linked; sandbox | Contradicts generic Removal link/template warning (F2) |
| Traceability | `CB-26-001` Pending with full local chain | Local lineage is present; repeats inert status (F3) |
| Sandbox registry | Showing 10 of 31 pre-existing GHG entries; no `CB-26-001` or `PR-26-001` | Correctly consistent with zero local submissions |

The grouped `1 cert gap` is consistently used across card, detail, and Removal even though it
contains multiple missing fields. The gap itself is not a count inconsistency. The two real
cross-surface inconsistencies are captured as F1 and F2; the shared but unhelpful lifecycle
label is F3.

## 10. Adversarial, accessibility, and recovery checks

| Check | Result |
|---|---|
| Facility blank submit | Pass: name, country, and timezone errors shown; entries retained |
| Whitespace-only facility name | Pass: treated as missing |
| GPS latitude `-91`, longitude `181` | Pass: exact bounds errors; no facility created |
| GHG Statement blank period | Pass: `Pick a valid period end date` |
| GHG Statement period `2027-12-31` with zero submitted Removals | Pass: contents 0 explained and Next disabled |
| Reload Production Processes | Pass for persistence; 0/30 remained deterministic, exposing F1 |
| Archive empty active facility | Pass: reversible, fallback context valid, archived view durable |
| Populated facility destructive preview | Pass for impact inventory; confirmation safety finding F4; not confirmed |
| Keyboard focus | Pass on representative editor control; visible multi-pixel focus ring |
| Escape recovery | Pass: closed Credit Batch editor without saving |
| Console warnings/errors | None in sampled staging, fresh staging, or sandbox tabs |
| Back/reload/retry/double-click on registry submission | Not reachable: readiness correctly prevented submission |
| File uploads | Not retested: browser attachment capability remained unavailable; no product verdict |
| Direct cross-facility entity ID | Not meaningfully testable: the only extra facility was empty and then archived |
| Narrow viewport / 200% zoom | Environment-blocked; connected Chrome ignored both controls |

No data-loss recovery problem was observed. Validation retained the entered facility fields,
and cancel/Escape exited without mutation.

## 11. Artifact index

All screenshots are cropped or scoped to avoid account/contact information.

| Artifact | Caption |
|---|---|
| [`01-authenticated-staging-traceability.png`](./artifacts/2026-07-21-staging-ux/01-authenticated-staging-traceability.png) | Authenticated populated staging chain at start |
| [`02-authenticated-sandbox-ghg-entries.png`](./artifacts/2026-07-21-staging-ux/02-authenticated-sandbox-ghg-entries.png) | Authenticated exact sandbox GHG-entry baseline |
| [`03-credit-batch-card-one-cert-gap.png`](./artifacts/2026-07-21-staging-ux/03-credit-batch-card-one-cert-gap.png) | Card shows Pending plus one certification gap |
| [`04-removal-readiness-mismatch.png`](./artifacts/2026-07-21-staging-ux/04-removal-readiness-mismatch.png) | False setup warning beside the real source-data issue |
| [`05-ghg-statements-correct-empty-state.png`](./artifacts/2026-07-21-staging-ux/05-ghg-statements-correct-empty-state.png) | Correct zero-statement page |
| [`06-production-process-sample-count.png`](./artifacts/2026-07-21-staging-ux/06-production-process-sample-count.png) | Method A process reports 0/30 |
| [`07-certification-settings-overloaded.png`](./artifacts/2026-07-21-staging-ux/07-certification-settings-overloaded.png) | Linked sandbox Settings plus first-layer diagnostics |
| [`08-populated-facility-archive-preview.png`](./artifacts/2026-07-21-staging-ux/08-populated-facility-archive-preview.png) | Populated impact preview; not confirmed |
| [`09-empty-facility-archive-preview.png`](./artifacts/2026-07-21-staging-ux/09-empty-facility-archive-preview.png) | Authorized empty-facility confirmation |
| [`10-archived-facility-view.png`](./artifacts/2026-07-21-staging-ux/10-archived-facility-view.png) | Archived `FAC-26-002` and filter inconsistency |
| [`13-sandbox-ghg-entries-unchanged.png`](./artifacts/2026-07-21-staging-ux/13-sandbox-ghg-entries-unchanged.png) | Post-run sandbox inventory remains pre-existing only |
| [`14-dashboard-readiness.png`](./artifacts/2026-07-21-staging-ux/14-dashboard-readiness.png) | Dashboard attention, activity, and Pending batch |
| [`15-credit-batch-detail-open-issue.png`](./artifacts/2026-07-21-staging-ux/15-credit-batch-detail-open-issue.png) | Batch chemistry and certification checklist together |
| [`worker-summary.md`](./artifacts/2026-07-21-staging-ux/worker-summary.md) | Compact coverage/mutation/result summary |

The retained prompt files document the isolated-worker and authenticated-browser handoff; they
contain no credentials. No failed responsive screenshot is retained because the requested
viewport/zoom was not actually applied.

## 12. Known issues, duplicates, and open product decisions

### Known/duplicate mapping

| Issue/ledger | Run 2 disposition |
|---|---|
| Run 1 F6 / issue #474 related | F1 reproduced. Exact future-date wording gap is a Run 1 duplicate; #474 is related, not exact |
| Run 1 F2 / issues #291 and #380 related | F2 reproduced; generic setup warning persists |
| #246 Application evidence readiness | Current scenario shows `Incomplete (1)` on list and a Dashboard flag; no regression here |
| #263 Removal/GHG list metadata | No local Removal/GHG row exists; not runtime-assessable |
| #265 Sample list/batch signals | Three samples and chemistry signals are visible; Method-B time semantics remain F1 |
| #417 Method-B estimate | Not exercised because process is Method A and 0/30 as of now |
| #453 staging upload | Not reproduced; attachment environment prevented a valid app verdict |
| #256 row keyboard/ARIA | Representative focus and Escape passed; full row-keyboard scope not claimed |
| Closed #473 facility hydration | No settled direct route lost facility context; transient shells were not treated as a regression |
| Closed #245 zero-removal statement | Verified: zero contents prevents progression |
| Closed #250 submitted vocabulary | No submitted object existed; not regression-tested |
| Closed #498 production-run end time | Run 1 fresh-bundle continuation verified the fix; current Complete record persists |

### Open product decisions

1. Are future sampling dates legitimate planned records? If yes, when do they become batch-
   usable and Method-B eligible, and what exact labels distinguish those clocks? If no, block
   future dates at entry.
2. Who owns the Credit Batch lifecycle: local certification readiness, Isometric submission,
   verification, issuance, or a combination? Define transitions before displaying/filtering
   Draft/Verified/Issued/Rejected.
3. Should unresolved blueprint keys be operator-fixable in ordinary Settings or only visible
   as an admin diagnostic with a support escalation?
4. For a facility with submitted registry lineage, should local archive be blocked or allowed
   only through a governed admin workflow? In either case, external state must remain immutable
   and reconcilable.
5. Should one grouped `cert gap` represent multiple missing fields? The current count is
   consistent, but wording should say `1 gap group · 4 missing fields` if both numbers matter.

## Handoff

Product/design should simplify the first certification decision: give Credit Batch one
meaningful readiness state, distinguish batch chemistry from Method-B time eligibility, and
make every setup warning name the exact missing thing. Engineering should diagnose the
future-date/readiness presentation as F1, replace the Removal setup boolean with structured
gaps (F2), define or remove the inert Credit Batch lifecycle (F3), and harden archive
confirmation/governance (F4). F5 and F6 are contained follow-ups. No fix was implemented and
no issue was filed.
