# Credit batches — adversarial E2E QA

**Date:** 2026-07-23

**Target:** `/credit-batches?facility=de000000-0000-4000-a000-000000001000`

**Branch / revision:** `fix/credit-batch-auto-association` / `8c1e63f2`

**Method:** computer-use browser walkthrough, responsive viewport checks, focused source and test tracing

**Data safety:** disposable batches created during the walkthrough were deleted; the facility finished with its original three batches

## Verdict

**Not ready for an operator-facing release without follow-up.**

The core list, create, edit, delete, detail, filtering, routing, and traceability flows are generally usable. The main risk is recovery guidance: a blocked batch can under-report its missing evidence, and its prescribed sample action opens a route that never resolves. Two other messages overstate or misdescribe the system state.

## Findings

### CB-QA-01 — High — Direct create links never resolve

**Area:** Engineering / UX

**Status:** Confirmed
**Issue state:** No exact existing issue found

Opening either of these URLs directly left the page in a loading skeleton for more than eight seconds and never opened the requested form:

- `/credit-batches?facility=de000000-0000-4000-a000-000000001000&create=true`
- `/samples?facility=de000000-0000-4000-a000-000000001000&create=true`

This is particularly damaging on the batch detail page because **Record a lab sample** uses the second URL. The button looks like the corrective action for a blocked batch, but sends the operator to a dead end.

**Expected:** the page loads its facility context and opens the create sheet, or shows an actionable error.

**Root cause:** create intent is client-only. `useOpenCreateIntent` opens the sheet after hydration and immediately replaces the URL (`src/hooks/use-open-create-intent.ts`); `CreditBatchList` supplies it an unstable inline callback. The visible loading text comes from `OrgBrand`, which waits on three client queries without an error-settled/timeout branch (`src/components/navigation/org-brand.tsx`). The browser evidence cannot identify which organization/session request remained pending, but the direct-entry path is coupled to full shell hydration before the create sheet can exist.

**Suggested fix:** pass server-parsed initial create intent into the list, consume the URL parameter only after mount, stabilize the callback, and make organization-brand errors settle instead of loading indefinitely. Add a direct-entry E2E test for both routes.

### CB-QA-02 — High — A blocked batch suppresses its missing sample requirement

**Area:** Domain truth / UX

**Status:** Confirmed
**Issue state:** New edge case; related to closed issue [#375](https://github.com/Maji-Studio/noma-dmrv/issues/375)

Batch `CB-26-003` has no production runs and no usable lab samples. Its summary says there is **1 issue open** and lists only **Linked production data**. The lab panel on the same page correctly says that at least three samples from distinct run days are required.

This makes readiness guidance incomplete: an operator can resolve the only advertised issue and still be blocked.

**Root cause:**

- `buildCo2eStoredPreview` returns early when there are no applications, before sample checks run (`src/data-access/credit-batch-previews.ts`).
- `toBatchHealthFacts` removes `applicationIds` from carbon gaps (`src/lib/certification/batch-health-facts.ts`).
- `buildRemovalContext` also short-circuits the no-application state without durability sample blockers (`src/fn/certification/certify-context-core.ts`).
- The behavior is explicitly encoded in `tests/e2e/certification-new-removal-wizard.spec.ts`, which expects only the production-data issue for an incomplete runless batch.

**Expected:** readiness lists both independent gaps: linked production data and the three-sample/distinct-run-day requirement.

**Suggested fix:** calculate sample completeness independently from applications, update the E2E expectation, and test the combined no-production/no-samples state.

### CB-QA-03 — Medium — The sample recovery link loses batch context

**Area:** UX

**Status:** Confirmed
**Issue state:** No exact existing issue found

**Record a lab sample** links only to the facility-level samples page. It does not include the credit batch being repaired. Even after the direct-create loading defect is fixed, the operator would have to rediscover and select the batch.

**Root cause:** the detail link in `src/components/credit-batches/credit-batch-durability-panel.tsx` omits a credit-batch parameter, while `src/components/samples/sample-list.tsx` does not pass one into create intent.

**Expected:** the link opens a sample form with the current batch preselected and visible.

### CB-QA-04 — Medium — Delete confirmation describes an obsolete relationship

**Area:** Domain truth / UX

**Status:** Confirmed
**Issue state:** No exact existing issue found

The confirmation says applications remain, become unlinked, and can be manually re-linked to another batch. Current batch membership is production-run based and auto-derived, so this instruction is not an action the operator can perform.

**Root cause:** stale literal copy in `src/components/credit-batches/credit-batch-list.tsx`. The delete path clears sample and production-run membership in `src/data-access/credit-batches.ts`; no success-path regression test covers the displayed consequence.

**Expected:** confirmation describes the actual effect on production runs, samples, and derived certification data, without promising manual application re-linking.

### CB-QA-05 — Medium — “Ready to certify” conflicts with a disabled removal flow

**Area:** UX / Product limitation

**Status:** Known deferred limitation
**Related:** [#246](https://github.com/Maji-Studio/noma-dmrv/issues/246), [#291](https://github.com/Maji-Studio/noma-dmrv/issues/291), [#380](https://github.com/Maji-Studio/noma-dmrv/issues/380), `docs/open-questions.md`

In **New Removal**, two cards say **Ready to certify**, but selecting one still leaves **Continue** disabled because facility setup is incomplete. The warning exposes the raw key `biochar_sequestration_1000_year` and offers no action.

Batch-local readiness intentionally excludes facility setup, so the underlying separation is not itself a defect. The visible wording is the problem: “Ready to certify” overstates the end-to-end state.

**Expected:** distinguish **Batch data ready** from overall certification readiness, translate blueprint keys to operator language, and provide a link to the required setup.

## Passed coverage

| Case | Result | Notes |
|---|---|---|
| Facility-scoped list and summaries | Pass | Three original batches, stored CO₂e total, and pending-input signal rendered |
| Feedstock filtering | Pass | Single and multi-feedstock selections behaved as OR filters |
| Readiness filtering | Pass | Combined correctly with feedstock filters; clear/reset worked |
| Required create fields | Pass | Missing feedstock blocked submission with an inline message |
| Process-method constraints | Pass | Method A selected; unavailable Method B visibly disabled |
| Calendar-month rule | Pass | More-than-one-month and reversed ranges produced specific errors |
| Same-day batch | Pass | Created successfully |
| Double submission | Pass | Rapid repeat activation created one batch |
| Long notes | Pass | 2,000 characters saved and rendered without layout breakage |
| Empty matching-runs state | Pass | Create form clearly said no completed runs matched |
| Edit, cancel, and save | Pass | Cancel preserved state; save updated; sampling immutability was explicit |
| Delete mechanics | Pass | Cancel preserved; disposable batch deletion succeeded; original count restored |
| Ready detail | Pass | CO₂e, durability, runs, samples, and readiness were coherent for `CB-26-001` |
| Production-run recovery link | Pass | Opened the exact referenced run sheet |
| Application review link | Pass | Preserved facility context |
| Missing/malformed batch routing | Pass | Custom not-found state shown |
| Missing/wrong facility routing | Pass | Canonical facility restored; unrelated query parameters preserved |
| Traceability DAG, map, Sankey, percentage toggle | Pass | Views rendered and retained context |
| Traceability mass anomaly | Pass | Negative in-storage result was accompanied by a visible mass-exceeds-output warning |
| Legacy chain-of-custody route | Pass | Redirected to traceability while preserving parameters |
| Removals and GHG empty states | Pass | Purpose and next action were understandable |
| Failure mode | Pass | No application 4xx/5xx or hydration error was observed during the walkthrough |

## Blocked or unsafe-to-claim coverage

| Case | Status | Reason |
|---|---|---|
| Native date filtering | Blocked | Computer-use changed the visible native date value without reliably delivering the framework event; an apparent no-filter result is not trustworthy |
| GHG reporting-period advancement | Blocked | Same native-date automation desynchronization; schema and existing E2E use valid `YYYY-MM-DD` strings |
| Overlapping/assigned-run reassignment | Partially blocked | Reliable construction of the target month was prevented by native-date event desynchronization |
| Facility switch | Blocked | Only one accessible facility was available |
| Pagination/high-volume behavior | Not run | Only three records existed; bulk seeding would have expanded test scope and data risk |
| Concurrent edits | Not run | Would require a second authenticated operator/session |
| Submitted/certified immutability | Not run | No disposable submitted lineage was available; mutating real certification data was out of scope |

Native date behavior should be rechecked manually before opening a defect. Source tracing found a type-consistent React Hook Form + Zod path, and the expected derived UI never appeared after the automated input—evidence that the application had not received the value.

## Operator clarity assessment

The browsing and happy-path creation experience is mostly clear: batch cards expose readiness, the form explains validation failures, unavailable options are visibly disabled, and healthy detail pages explain why a batch is ready.

Clarity drops sharply when the operator must repair a blocked state. The sample action dead-ends and lacks batch context, the readiness count omits a second required input, the removal wizard mixes batch-local and global readiness without naming the distinction, and the delete dialog explains an obsolete manual workflow.

## Test cleanup and limitations

- All disposable batches created by this run were deleted.
- Final facility state: three original batches.
- No production code or GitHub issue state was changed.
- Browser video/GIF capture was unavailable in the fallback computer-use path; still screenshots were retained locally and are not committed.
- One development-only Turbopack `Performance.measure` warning appeared after malformed-route testing. It was not accompanied by an application failure and is not recorded as a product defect.
