# Issue 756 test plan: conserved dry stock and FIFO

This plan covers the complete operator workflow, persisted history, and downstream
provenance. Use a disposable local PostgreSQL database and the authenticated local
app. Fixtures use E2E-prefixed records in isolated facilities. Do not run browser
teardown alongside database suites: its fixture sweep also removes UI-generated
records belonging to those facilities.

## Reference quantities

Place A with 900 kg dry biochar and 200 kg ingredient solids, then B with 600 kg
dry biochar and 120 kg ingredient solids. Their recorded creation wet masses are
1500 and 1000 kg. The product placement dates, not their source-run ages, determine
FIFO. Frozen ingredient moisture values are 60% for A and 52% for B.

| Measurement | Expected persisted result |
| --- | --- |
| Delivery 2000 kg wet at 30% | A 900 + B 250 = 1150 kg dry; B 350 remains |
| Delivery 2000 kg wet at 20% | 1316.667 kg dry; 183.333 remains |
| Delivery 2500 kg wet at 15% | Reject exact solids shortage before rounding |
| Only A eligible, 1500 kg wet at 15% | Reject shortage; future B is unavailable |
| After the first delivery, loss 120 kg wet at 30% | 70 kg dry loss; 280 remains |
| After the first delivery, count 600 kg wet at 30% | No loss; 350 remains |
| Count above expected solids | Record discrepancy; create no stock |
| Zero count after the first delivery | Remove exactly 350 kg dry; moisture unnecessary |
| Pure 100 kg dry after drying to 100 kg wet at 0% | No loss |
| Half of the first delivery applied | 575 kg dry: A 450 + B 125 |
| Raw layers 760 + 540 kg dry; 1000 kg wet at 8% | 920 kg dry: 760 + 160; 380 remains |

Historical creation records must continue to total 2500 kg wet after every draw.
Before/after wet estimates use one labeled entered-moisture scale. Dry mass stays
visible when moisture is missing; it never becomes an invented wet measurement.

## Automated coverage

1. **Exact planner and schemas.** Run `src/lib/output-stock/planner.test.ts` and
   `src/schemas/output-stock.test.ts`. Check the reference table, physical dates,
   posting ties, invalid inputs, missing moisture, exact shortages, final
   depletion, and per-run sums. Repeated subgram requests cannot fund overdraw.
   Cumulative source entitlements must remain proportional and monotone; a layer
   with zero remaining dry grams can still pass its exact physical residual to
   a later layer. Positive measurements require representable gram precision.
2. **Real writer transactions.** Run `tests/output-stock.integration.test.ts`.
   Use migrated tables and actual product/order/delivery/loss/count writers.
   Verify product and delivery retries create one result, reused keys with changed
   input conflict, stale previews fail, competing delivery/loss commits at most
   once, and a rejected write leaves no partial ledger. Check organization,
   facility, formulation, future-stock, all-matching-bin and empty-order behavior.
   Check immutable intake history, named actors/runs, reversal/replacement links,
   exact wet/run sums, and zero counts. A reduced loss after a late older intake
   restores 90 kg to its original run without debiting the late run. An explicit
   unused delivery correction may allocate a newly known older product. Counts
   with no allocation still protect their observed basis from later correction.
3. **Application and source-update races.** Run
   `tests/output-stock-races.integration.test.ts`. Gate a real application
   transaction before commit, observe the correction waiting on PostgreSQL's
   delivery lock, and prove the correction names the committed application and
   writes no reversal. An allocation-free count must block ordinary production
   output and completion-date edits. Date-only corrected delivery storage uses
   UTC midnight.
4. **Downstream consumers.** Run allocation-math, accounting, lineage, graph,
   trail, application-share, transport, and Sankey suites. TEMP-table PostgreSQL
   tests in `delivery-allocation-provenance.integration.test.ts` exercise query
   semantics separately from actual writer/FK tests. Both A and B must reach
   batch slices, filters, locks, transport evidence, and traceability. Products
   sharing one source run must sum without losing or duplicating mass. Reversals
   net once; partial/final applications close saved truck shares without FIFO
   replay. A zero-dry/nonzero-wet residual remains in shipment and transport
   provenance using frozen source weights.
5. **Existing workflows.** Update old fixtures to required formulation, placement,
   completed delivery and saved provenance contracts. Preserve unrelated order,
   source, metadata, transport, evidence, certification, and feedstock guards.
   Assertions about removed reservations or upcoming deliveries become assertions
   of the new intended behavior. Never suppress type errors or weaken retained
   business assertions simply to obtain a green run.

## Browser walkthrough

Run `pnpm exec playwright test tests/e2e/output-bin-fifo.spec.ts --project=chromium`.
Use actual authenticated server actions and persist the result before asserting
its stock/provenance. The spec and shared browser fixture must cover:

- An order with no current stock; formulation selection and every matching bin
  beyond the old 20-result boundary.
- The A/B shortage with the form still visible, then the 2000 kg/30% preview,
  common-scale before/after cards, both batch/source breakdowns, and persisted
  1150 kg dry delivery leaving 350 kg dry.
- Half application with required area/location evidence and both saved shares.
- No-loss count, measured loss, linked correction, and exact zero count.
- Pure biochar product creation with required formulation and physical placement.
- More info history, keyboard focus/Escape/return focus, and historical creation
  wet mass remaining unchanged. Capture screenshots of meaningful final states.

After Playwright passes, independently inspect its saved browser screenshots and
record additional findings. The four Chromium flows exercise the actual browser;
component tests alone do not establish browser completion.

## Execution ledger

- Baseline lint/typecheck passed before implementation (8 existing lint warnings).
- Planner: 28/28 passed, including cumulative-rounding regressions. Separately,
  exhaustive 7424 small cumulative source allocations conserved totals, stayed
  within caps, and never decreased an entitlement.
- Planner plus operation schemas: 38/38 passed.
- Real writer suite: 8/8 passed after actual migration, including tiny
  wet-residual consumer provenance. Actual transaction race/source-update suite:
  2/2 passed. Combined latest run: 10/10 across the two files.
- UI component suite: 58 tests across 14 files passed at integration.
- Consumer focused suites: 47 passed; allocation helper 7/7 and session-local
  PostgreSQL query suite 7/7 passed at consumer handoff. These are not a substitute
  for combined-table transaction/FK or browser checks.
- Migration 0115: generated and reviewed; composite unique constraints ordered
  before referencing FKs. Existing disposable data required reset due missing
  formulations. Full reset/migration chain and schema verification passed:
  65 tables, 35 enums, 89 checks. No production backfill was added.
- Organization-scope and spacing checks passed on integrated source.
- Four Chromium workflows passed in 17.8 seconds, including original-measurement
  reversal history (120 kg wet / -70 kg dry): Pure product/drying; stockless order and all
  24 matching bins; shortage, spanning delivery, half application and keyboard
  history; no-loss count, loss, linked correction and zero count. The larger
  numerical matrix is covered by planner/DB tests, not all repeated through UI.
- Root independently inspected browser screenshots in
  `/tmp/noma-756-browser/`: `delivery-preview.png`, `application-shares.png`,
  `correction-blocker.png`, `loss-history.png`, and `pure-drying.png`.
- Browser global cleanup covers new allocation tables, allocation-free counts,
  and the full descendant closure of E2E fixtures. Independent standalone cleanup
  committed successfully; failures now fail the runner instead of hiding rollback.
- Final full Vitest: **487 files passed; 3750 tests passed**, 2 files / 16 tests
  skipped and 4 existing TODOs. No new output-stock test skipped. The opt-in
  external registry suites were not enabled. Log: `/tmp/noma-756-final-tests.log`.
- Final lint: passed with the same 8 baseline warnings and no errors. Typecheck,
  organization scope, spacing scale, UX copy, documentation references, and
  `git diff --check` passed.
- Production build passed with `CI=true NOMA_HERMETIC_CI=true pnpm build`, the
  repository's hermetic local-storage configuration. Plain production settings
  correctly reject the development `local-fs` storage provider. The existing
  dynamic-file trace warning for the local storage route remains.
- Verification logs: `/tmp/noma-756-final-{tests,lint,typecheck,build,org,spacing,copy,docs}.log`.
  Browser workflow and cleanup logs: `/tmp/noma-756-browser/{e2e,cleanup}.log`.
- No external registry sandbox or production deployment was exercised.
