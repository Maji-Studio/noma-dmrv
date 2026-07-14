# 12-month GHG + Method A/B bug-hunt QA — 2026-07-13

## Scope

This pass focused on operator-visible bugs and demo readiness for a 1000-year
flow: realistic monthly production, delayed laboratory sampling, Method A/B,
transport and laboratory sources, 12 credit batches, 12 Removal/GHG-entry
projections, and 12 monthly GHG-statement projections.

The database was reset before browser work. The cold-start sweep therefore
started with no operational records. A separate local task populated the shared
database after that sweep; this pass did not reset again or mutate those rows.
The populated data was used only for read-only adversarial inspection.

No registry mutation was attempted. The reset reported no configured
organization registry credentials, and the newly installed Isometric MCP was
recognized but failed its authenticated handshake before `how_to` registered.
Isometric's official MCP guidance classifies that state as a broken integration
that needs administrator review. Registry-dependent claims remain unverified.

## Outcome

- Empty start: 24 primary routes rendered without a crash, console warning, or
  console error.
- 12-month lifecycle regression: 1/1 Chromium test passed.
- Source and 1000-year-focused tests: 5 files / 22 tests passed.
- The 12-month fixture models five completed runs per month on days 3, 9, 15,
  21, and 27; samples use distinct dates and 7–9 day analysis delays.
- Method-B behavior passed at 9/30 locked, future evidence excluded at 29/30,
  unlock at 30/30, baseline-floor deletion blocked with a specific explanation,
  and a fresh Method-A process at 0/30 after ending the historical regime.
- The 12 → 12 → 12 statement screen rendered all monthly periods with one
  linked Removal each. This is a local relational/UI projection, not proof of
  12 live registry submissions.
- The shared populated demo dataset is not demo-ready: 2 credit batches,
  0 Removals, 0 GHG Statements, and 35 action-center items to clear.

## Findings ledger

| Area | Severity | Type | Repro | Expected vs. actual | Evidence / overlap | Suggested action |
| --- | --- | --- | --- | --- | --- | --- |
| 1000-year unsampled Method B | P0 | Engineering / protocol-dependent | Unlock Method B and build an unsampled 1000-year batch. | Reduced-frequency Method B needs an agreed, valid submission representation. Actual: the 1000-year builder requires at least three complete replicates before Method A/B routing, so the unsampled path is unreachable. | `src/fn/certification/durability-measurement-samples.ts`; open #417 partially overlaps. | Remain fail-closed. Confirm the intended 1000-year unsampled representation with Isometric before changing code. |
| Historical method classification | P0 → resolved locally | Engineering / auditability | Unlock a process after historical Method-A batches exist, then recompute an older or same-day batch. | A batch retains the regime effective when its production period began: before/on the unlock date is Method A; only later starts are Method B. The loader, readiness/submission cadence, operator summary/drift, and batch-form badge now share that boundary. | Regression coverage in `sampling-requirements.test.ts`, `durability-submission-gates.test.ts`, `production-processes.test.ts`, and `feedstock-process-chip.test.tsx`. | Keep the boundary tests. Separately address back-entered batches attaching to the newest of multiple sequential processes. |
| Method-B baseline provenance | P0 | Engineering / protocol-dependent | Use complete samples clustered on one day or before the process established date. | Only representative, in-process evidence should unlock reduced sampling. Actual: distribution is advisory and the lower-bound contract is not fully enforced. | Prior run plus code recon; no dedicated issue found. | Confirm independence semantics with Isometric; then add a hard lower bound and agreed distribution predicate. |
| Readiness surfaces disagree | P1 | UX / engineering | Open Feedstocks after the shared seed. Six rows have no supplier, all nine show no delivery date, the dashboard reports nine GPS gaps and twelve undocumented distances, yet every row says `Ready for certification`. | List, dashboard, batch health, and final submit should share one readiness result. Actual: a row can be `Ready` while other surfaces show blocking gaps. | Browser-reproduced; open #246 directly overlaps. | Reuse a single readiness result and distinguish operational completeness from registry readiness. |
| Method-A baseline vs. cadence copy | P1 | UX | Inspect the 29/30 Method-A row. | The operator should see one unambiguous next action. Actual: the row simultaneously says `1 more to qualify` and `Sample 2 more`; the latter means batches but does not say so. | `method-b-future-sample-excluded-29-of-30.png`; `production-process-list.tsx`. | Change the cadence pill to explicitly say `2 batches still need samples` (and equivalent singular copy). |
| Baseline deletion interaction | P2 | UX | Delete the thirtieth baseline sample after unlock. | The UI should explain immutability before offering an impossible destructive action. Actual: Delete is enabled, the modal says linked samples cannot be deleted, and only after confirmation does the precise Method-B floor error appear. | `method-b-baseline-delete-explained.png`. | Disable with the specific reason when the client has enough context, while retaining the DB backstop. |
| Empty-state inconsistency | P2 | UX | Visit Formulations, Suppliers, and Customers from a reset database. | Cold-start pages should explain the prerequisite and offer the next action. Actual: these pages show empty table/pagination chrome; Facilities has a proper guided empty state. | Browser cold-start sweep. | Reuse the shared `EmptyState` pattern with an entity-specific primary action. |
| Evidence absent from demo records | P1 | Demo readiness | Open a feedstock, delivery, and sample edit/detail record. | The requested demo should visibly carry BoL/weigh tickets, a COA/lab report, and sample-to-lab evidence. Actual: upload controls are discoverable, but inspected records contain zero files. | Browser-reproduced. The source tests pass; #263/#265 cover list triage gaps and #329 covers lab-report automation. | Attach synthetic, clearly labelled evidence before the demo and verify it appears in the Removal Supporting Sources panel. |
| Monthly statement interpretation | P1 | Product / demo wording | Present the 12-statement fixture as an Isometric result. | The audience should understand what was actually validated. Actual: 12 monthly statements are a local projection; the previously proven live shape is 12 monthly Removals in one annual statement. | Existing 2026-07-12 QA ledger and current screenshot. | Demo the 12 monthly list only as a reporting variant; use the annual statement for the canonical live registry narrative unless Isometric confirms otherwise. |
| Isometric integration unavailable | P1 | Environment | Start the installed MCP and registry submission flow. | `how_to` and authenticated registry operations should be callable. Actual: MCP authentication handshake fails and the reset has no stored registry credentials. | Current runtime; official Isometric MCP setup guidance. | Re-authorize the MCP connection in Team settings / AI Integrations and provision local per-organization sandbox credentials before live QA. |
| Shared local DB collision | P2 | QA reliability | Reset, perform the empty sweep, then observe a separate task seed the same database. | A long-running QA pass needs stable state. Actual: facility/demo rows appeared mid-run. | Browser timeline and shared checkout change. | Give QA its own database name or isolated Docker project; never run destructive reset against a database another task is using. |

## Evidence

- `test-results/production-process-method--f6025-nthly-statement-projections-chromium/method-b-future-sample-excluded-29-of-30.png`
- `test-results/production-process-method--f6025-nthly-statement-projections-chromium/method-b-baseline-delete-explained.png`
- `test-results/production-process-method--f6025-nthly-statement-projections-chromium/twelve-monthly-ghg-statements.png`
- `/tmp/noma-qa-2026-07-13/01-dashboard-empty.png`
- `/tmp/noma-qa-2026-07-13/02-chain-empty.png`
- `/tmp/noma-qa-2026-07-13/03-facilities-empty.png`
- `/tmp/noma-qa-2026-07-13/04-certification-settings-empty.png`
- `/tmp/noma-qa-2026-07-13/05-samples-empty.png`
- `/tmp/noma-qa-2026-07-13/06-delivery-evidence-empty.png`
- `/tmp/noma-qa-2026-07-13/07-feedstocks-ready-missing-dates.png`
- `/tmp/noma-qa-2026-07-13/08-dashboard-35-to-clear.png`

## Verification commands

```text
pnpm test:e2e tests/e2e/production-process-method-b-lifecycle.spec.ts --project=chromium
pnpm test --run src/fn/certification/durability-measurement-samples.test.ts src/components/certification/sources-panel.test.tsx tests/isometric-transport-leg-sources.test.ts tests/isometric-sources-mirror-flow.test.ts tests/sample-1000-year-schema.test.ts
pnpm exec vitest run src/components/credit-batches/feedstock-process-chip.test.tsx src/lib/certification/sampling-requirements.test.ts src/lib/certification/durability-submission-gates.test.ts tests/production-processes.test.ts src/fn/certification/durability-measurement-samples.test.ts src/lib/certification/durability-batch-summary.test.ts src/lib/certification/evidence-ledger/durability-build-model.test.ts src/lib/isometric/utils/durability-aggregation.test.ts src/components/production-processes/production-process-list.test.tsx tests/facilities-durability-guard.test.ts
pnpm typecheck
```

A touched-file lint also passed; the exact invocation was not retained. The
executable commands above passed (108 focused tests plus the 1-test Chromium
lifecycle E2E).
Browser console warnings/errors after the cold sweep: 0.

## Next bug-hunt scenarios

1. Run the same flow in an isolated QA database so 12-month records can remain
   visible for manual browser inspection after fixture creation.
2. At 30/30, correct chemistry without reducing eligibility, then redate the
   same sample below the established-date bound; verify ordinary correction is
   allowed but qualification-breaking edits roll back.
3. Back-enter a batch dated before a newer production process was established;
   verify it attaches to the correct historical process rather than the newest
   `(facility, feedstock)` process.
4. Remove one evidence file at a time and compare feedstock/delivery/sample
   badges, credit-batch health, Removal selection, and final submission.
5. Exercise two feedstocks in the same month to prove two independent credit
   batches and prevent accidental cross-feedstock aggregation (#325).
6. Test rejected/returned GHG statements and resubmission copy; ensure
   `submitted`, `in registry`, and `verified` never collapse into one status.
7. Test timezone edges at month end for run, sampling, application, Removal,
   and statement boundaries using the facility timezone.
8. Stress pagination with more than 50 samples and filter by missing evidence,
   chemistry, batch, and Method-B eligibility (#263/#265).
