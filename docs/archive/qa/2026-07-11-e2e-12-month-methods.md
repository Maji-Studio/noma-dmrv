# 12-month GHG + Method A/B E2E — 2026-07-11

## Objective

Start from a reset local database and exercise at least 12 monthly 1000-year
credit batches through final GHG entries and GHG Statements. Verify source
coverage for samples and transport legs, then test Method A and Method B with
special attention to the unlock and return-to-Method-A workflow.

This ledger is updated as the run proceeds. Synthetic QA data is not evidence
of protocol compliance or genuine operational activity.

## Environment and starting state

- Branch: `codex/e2e-12-month-ghg-qa`, based on `origin/staging` after merged
  PR #427 (`fix: verify 1000-year Isometric submissions`).
- Open PRs #428 and #429 were reviewed and deliberately not merged because they
  are unrelated, high-risk organization/auth changes.
- Local Postgres was reset with `pnpm db:reset`; only the required admin,
  teammate, and organization bootstrap records remained.
- Facility durability target: 1000 years.
- Isometric sandbox durability measurement submission was enabled only in the
  gitignored local test environment.
- Direct Codex computer use could not attach to a browser backend. The required
  fallback in-app browser and a real local Chrome/Playwright session were used
  for the serial operator walkthrough.

## Cold-start sweep

All 32 routes under `src/app/(app)` were visited after the reset. Core list and
certification routes rendered designed no-facility guidance without alerts.

## Findings

| Area | Severity | Type | Repro | Expected vs. actual | Root cause | Decision / suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| Credit-batch missing-ID route | P2 | Engineering | After empty reset, visit `/credit-batches/__missing__`. | Expected a 404/not-found surface. Actual: application error boundary and a failed UUID query. | `getCreditBatchById` receives an unchecked dynamic segment before the page can call `notFound()`. | Bounded but outside the requested GHG/Method scope; retain for later if core flow does not expose higher-priority defects. |
| Customer missing-ID route | P2 | UX / Engineering | After empty reset, visit `/customers/__missing__`. | Expected not-found or empty detail. Actual: indefinite `Loading customer details...`. | Client detail surface does not settle the missing/no-facility state. | Document; avoid broad detail-page refactor during this run. |
| Supplier missing-ID route | P2 | UX / Engineering | After empty reset, visit `/suppliers/__missing__`. | Expected not-found or empty detail. Actual: indefinite `Loading supplier details...`. | Client detail surface does not settle the missing/no-facility state. | Document; avoid broad detail-page refactor during this run. |
| Product wet-mass auto-fill | P2 | UX / Engineering | In Create Biochar Product, select a production run with 150 kg output, fill the other required fields, and submit. | Expected the visible auto-filled 150 kg to satisfy the required field. Actual: the form reports Wet Mass as required until the operator manually re-enters `150`. | The derived display value and React Hook Form validation state are not synchronized. | Bounded candidate fix after the certification-critical path is complete. |
| Feedstock transport source coverage | P1 | Certification / UX | Create a feedstock intake from a supplier location with a stored 50 km return trip, then inspect the intake and its derived transport leg. | Expected an evidence/source attachment control for the transport distance. Actual: the transport leg is derived and read-only, with no upload or source-link control. | Derived transport legs do not expose evidence management in the feedstock workflow. | Confirm whether a shared transport-evidence surface exists elsewhere; otherwise treat as a certification blocker and avoid inventing a large new document model in this run. |
| Delivery transport source coverage | P1 | Certification / UX | Create a delivered order with the destination's stored 40 km return trip. | Expected an evidence/source attachment control for the outbound transport distance. Actual: the distance and trip type are editable, but there is no evidence upload or source-link control. | Delivery transport input has no evidence field or post-save evidence surface in the operator flow. | Certification blocker unless an existing shared source surface can be exposed with a bounded change. |
| Application evidence readiness | P0 | Certification / Engineering | Create a Visual proof or Boundary records application, but do not upload any post-save evidence. | Expected Not ready with missing stockpile/spreading/incorporation photos or boundary/logbook documents. Actual: every application immediately shows `Ready for certification`. | Readiness does not enforce the evidence contract described by the form. | Diagnose and fix if the invariant can be enforced in the existing readiness module without a broad redesign; add a regression test. |
| Future samples advertise an impossible Method-B unlock | P0 | Certification / Engineering | Attach 30 complete samples dated after the current time to the process, open Production Processes, then submit the enabled Unlock action. | Expected the summary and transaction to use the same as-of boundary. Actual: the UI showed 30/30 and enabled Unlock, while the mutation re-counted 0/30 and failed with a generic error. | The summary called the canonical counter without `asOfDate`; the unlock transaction correctly passed its unlock timestamp. | **Fixed in this branch:** the summary now counts as of `new Date()`. Added a regression with a year-2999 sample; focused tests pass. |
| Method-B baseline accepts clustered, pre-production rows | P0 | Protocol integrity | Add 30 complete samples on the same day to one December 2027 credit batch, but timestamp them July 2026 before the production run. | Expected rejection or exclusion because the samples precede production and do not represent distributed baseline replicates. Actual: the form warns `Clustered on one run/day`, still labels them `Eligible`, counts 30/30, and successfully unlocks Method B. | The baseline is a raw row count scoped only by process and as-of time; it has no lower temporal bound, distinct-day/run requirement, or anti-duplication rule. | Existing architectural issue; requires protocol/product decisions, so document rather than overengineer during this run. Never treat these synthetic attack rows as valid evidence. |
| Sample evidence readiness | P0 | Certification / Engineering | Save a chemically complete 1000-year sample with no lab report and no sample-to-lab transport leg. | Expected Not ready until required source evidence is attached. Actual: the sample table and detail panel show `Ready for certification`; evidence and transport are only available after reopening Edit. | Readiness covers chemistry but not the source contract exposed by the editor. | Diagnose alongside application evidence readiness; likely a shared readiness/source invariant rather than two UI-only fixes. |
| Sample list pagination | P2 | UX / Engineering | Create 60 samples with the 20-row page size selected. | Expected three pages or a 60-row selectable page size. Actual: only 20 rows render while the footer says `Page 1 of 1`; exact search can still retrieve hidden records. | Total/page metadata is inconsistent with the paginated query. | Bounded follow-up after certification blockers. |
| Method-B batch incorrectly requires three durability replicates | P0 | Certification / Engineering | Unlock Method B, keep the plan active and on cadence with `Moisture measured every batch`, then attempt a removal containing an otherwise complete but unsampled credit batch. | Expected Method B to apply its declared reduced-frequency plan. Actual: removal readiness blocks on `Complete 1000-year sample replicates (3 required)`. | The removal-readiness path still applies Method-A per-batch replicate requirements after Method B is active. | Already represented by open issue #417. Three samples were added to the twelfth batch only to let this synthetic walkthrough continue. |
| Application list readiness disagrees with removal readiness | P0 | Certification / UX | Create an application with Visual proof, add three role photos lacking GPS/timestamp metadata, and compare the application list with removal readiness. | Expected one consistent result. Actual: the list says `Ready for certification`, while removal readiness correctly rejects the photos; Boundary records with GIS reference plus logbook are accepted. | The list badge uses a shallower evidence predicate than final removal readiness. | User direction is GIS-only for now, so all 12 records were changed to Boundary records. Keep the strict removal check and make the list reuse it. |
| Automatic Isometric evidence ledger silently fails | P1 | Certification / Operations | Submit a removal whose local production, sample, application, and transport evidence is complete. | Expected the generated evidence ledger to be attached, or submission to stop with an actionable error. Actual: logs report `evidence ledger generation failed; submitting without it`, and submission continues. | Best-effort ledger generation suppresses the underlying failure and exposes only an error name. | Preserve successful removal submission, but surface the actionable error and make missing exported evidence visible before submission. Manual source mirroring proved remote attachment itself works. |
| Successful remote source sync can lose its local audit event | P1 | Auditability / Engineering | Manually mirror the month-eight supporting documents to Isometric. | Expected each successful remote source creation to have a local `certifier_sync_events` record. Actual: all 11 remote sources succeeded, while local sync-event inserts emitted warnings. | The remote side effect and local audit write are not atomic, and the warning lacks enough context for recovery. | Add an idempotent reconciliation path; do not retry remote creation blindly. |
| Source mirroring is serial and slow | P2 | Operations / UX | Mirror 11 supporting documents for one removal. | Expected visible background progress or parallel bounded work. Actual: documents are uploaded serially at roughly 11 seconds each, making a complete monthly evidence set take about two minutes. | The source-sync loop is synchronous and serial. | Do not optimize during this correctness run; consider a bounded background queue with per-document status. |

## Operator progress

- Created through the real UI: one 1000-year facility, one supplier, one
  reactor, one certified feedstock intake, feedstock/biochar/product bins, one
  customer and field, 12 monthly production runs, 12 pure-biochar products,
  12 monthly orders, 12 delivered transport legs, and 12 field applications.
- Created 12 monthly credit batches on one Forestry-waste production process.
  The Method-A lock was confirmed disabled at 29/30 and enabled at 30/30.
  Method B then unlocked successfully after the as-of mismatch fix. The unlock
  declaration stores baseline `30`, sampling plan `QA Annual Sampling Plan v1
  §6.2`, and `Moisture measured every batch`.
- The Method-B detail and `Start a new production process` confirmation clearly
  explain that returning to Method A is a new campaign whose baseline restarts
  at zero while the old process retains history. After the annual statement was
  created, the action was completed: the new Method-A process is locked at
  `0/30`, while the historical Method-B process and declaration remain visible.
- Seven Visual-proof applications were first used for a negative metadata test:
  three role photos without GPS/timestamp metadata were correctly blocked by
  removal readiness. Following the user's GIS-only direction, all 12
  applications were changed to Boundary records with a GIS reference and PDF
  application logbook.
- Submitted 12 monthly removals, one credit batch each, covering December 2026
  through November 2027. Their Isometric IDs are listed below.
- Created annual GHG Statement `ggs_1KX9BFSBSSBX4RGS` (version 1), reporting
  `2026-11-22` through `2027-11-30`, linked to all 12 removals. It is stored in
  the registry but intentionally not submitted to a verifier. Isometric reports
  3.281 tCO2e verified versus 2.954 tCO2e of application inputs and zero stated
  uncertainty.

## Evidence inventory

| Evidence surface | Coverage | Result |
| --- | --- | --- |
| Production readings | 12/12 production runs | Each run has four imported readings. The first four also retain one intentionally failed out-of-window import, followed by the valid import. |
| Sample lab reports | 63/63 samples | Attached through the sample editor. |
| Sample-to-lab transport | 63/63 samples | Each has a transport leg, bill of lading, and weigh-scale document. |
| Field application proof | 12/12 applications | GIS/boundary reference plus PDF application logbook; accepted by removal readiness. |
| Feedstock and delivery transport | 0/24 derived legs have a dedicated upload control | Distances exist, but the operator flow exposes no source-attachment surface; recorded as a P1 finding above. |
| Isometric source mirroring | 11/11 documents for month eight; other months local-only | Manual mirroring succeeded but is too slow for a 12-month serial run and exposed audit-event warnings. Automatic evidence-ledger generation failed best-effort for removals. |

## Registry outputs

| Month | Removal ID |
| --- | --- |
| 2026-12 | `rmv_1KX9AVZK9SBXE82G` |
| 2027-01 | `rmv_1KX9AY43VSBXF2CH` |
| 2027-02 | `rmv_1KX9AYPVCSBXFWPJ` |
| 2027-03 | `rmv_1KX9AZ8N6SBXGQ0K` |
| 2027-04 | `rmv_1KX9AZVC8SBXHHAM` |
| 2027-05 | `rmv_1KX9B0E7VSBXJBMN` |
| 2027-06 | `rmv_1KX9B10YGSBXK5YP` |
| 2027-07 | `rmv_1KX9B91BDSBXG9Y6` |
| 2027-08 | `rmv_1KX9BCAK2SBXH487` |
| 2027-09 | `rmv_1KX9BCWD8SBXHYJ8` |
| 2027-10 | `rmv_1KX9BDFJXSBXQZHQ` |
| 2027-11 | `rmv_1KX9BE32FSBXRSVR` |

Annual statement:
`https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/ghg-statement/ggs_1KX9BFSBSSBX4RGS`

## Existing issue cross-reference

- #417 covers the Method-B removal-readiness mismatch reproduced here.
- #420 tracks transport-evidence integrity and is relevant to the feedstock and
  delivery source gaps.
- #200 and #391 cover lock/audit-history concerns around method transitions.
- #400 is relevant to cohort/schema-bound errors.
- #325 covers concurrent same-month batch behavior.

No unrelated open branch was merged. PR #427 was already present in the tested
base and directly improved 1000-year Isometric verification; open PRs #428 and
#429 did not address this flow.
