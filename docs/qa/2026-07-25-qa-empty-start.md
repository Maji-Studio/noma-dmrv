# 2026-07-25 local empty-start certification E2E

Status: **Target Removal blocked by future-dated source data; failure is now mutation-clean**

Environment:

- Noma: `http://localhost:3100`
- Isometric: SANDBOX
- External project: `prj_1K9YJ33RKSBX9FFF` (`Tanzania biochar`)
- Removal template: `rvt_1KS4S43VPSBXA26X`
- Intended external facility: `fcl_1K9YJQNA7SBXAG15`

This was a critical UI-driven operator walkthrough after a local `pnpm db:reset`.
It covered the cold route sweep, a production chain with three applications and
four lab samples, evidence uploads, non-linear edits, reloads, validation
failures, readiness, Removal entry, GHG Statement period selection, and direct
Isometric baseline/final counts.

## Follow-up after fixes

Two defects discovered by this walkthrough were fixed and retested on the same
worktree:

1. Deep-linked feedstock edits now save against the entity shown in the sheet.
   `FS-26-001` persisted `Document` provenance after reload, and `CB-26-001`
   moved to `All checks passed`.
2. Removal submission now rejects a future production end or application date
   during the complete local build preflight, before the protocol audit, submit
   client, Source mirroring, datapoints, GHG entry, or submission-ledger claim.

The corrected focused dashboard E2E passed and proves that the canonical
derived transport leg retains distance `25`, changes from `Manual` to
`Document`, and clears the structural readiness gap.

The original pre-fix submit attempt for Removal
`9138b96b-4098-475a-a782-e459bbd17b8b` was not clean: it mirrored 4 of 11
Sources and posted ordinary datapoints before Isometric rejected the first
future-dated `s_fraction` datapoint. It created no registry Removal ID. A first
guard iteration still appended a read-only `removal:protocol-version-check`
audit event before rejecting. The final sequencing fix was then exercised
through the UI:

| Check | Before final retry | After reload/reopen |
| --- | --- | --- |
| Local status | Rejected | Rejected |
| Registry Removal ID | unset | unset |
| Supporting Sources | 4 of 11 | 4 of 11 |
| Visible sync history | 10 | 10 |
| Database sync-event rows | 15 | 15 |
| Protocol-check rows | 2 | 2 |

The exact operator-facing error is:

> Production run end 2028-01-02T15:00:00.000Z is in the future. Wait until
> production is complete or correct the run end time before submitting.

This is the correct result for `CB-26-001`: its run and three applications are
dated January 2028 while the test date is 2026-07-25. The target Removal cannot
be submitted honestly until those synthetic dates are corrected or occur.

The current Isometric project UI shows 37 GHG Entries and 12 GHG Statements.
The additional visible Removal is `rmv_1KYD8GSQYSBXKWSQ`, dated July 2026 and
linked to `CB-26-002`; it belongs to the separate successful QA chain recorded
in `2026-07-25-staging-e2e-removal-ghg.md`, not this January 2028 target. No
January 2028 `rmv_` exists for `CB-26-001`.

The 12 existing Statements continuously cover through 2027-12-31. Noma
therefore derives 2028-01-01 as the next start. A January 2028 period contains
zero submitted target Removals and is future-dated relative to the test date,
so this reused project offers no period that is simultaneously new, non-future,
and able to contain `CB-26-001`.

Evidence:

- [Feedstock provenance persisted](/private/tmp/codex-computer-use.local-cert-retry.UztXxM/03-feedstock-after-reload-document.png)
- [Credit batch all checks passed](/private/tmp/codex-computer-use.local-cert-retry.UztXxM/04-credit-batch-all-checks-passed.png)
- [Final future-date preflight](/private/tmp/codex-computer-use.local-future-preflight.bzhhhG/followup-2-preflight-error.png)
- [Removal unchanged after retry](/private/tmp/codex-computer-use.local-future-preflight.bzhhhG/followup-3-after-summary.png)
- [No new protocol audit entry](/private/tmp/codex-computer-use.local-future-preflight.bzhhhG/followup-3-after-sync-history-expanded.png)
- [Isometric 37-entry count](/private/tmp/codex-computer-use.local-future-preflight.bzhhhG/step-6-isometric-ghg-entries.png)
- [Isometric 12-statement count](/private/tmp/codex-computer-use.local-future-preflight.bzhhhG/step-6-isometric-ghg-statements.png)

## First-pass verdict (historical)

Local file storage works, including persistence after close, reload, and
reopen. The certification chain does not complete:

1. The feedstock transport PDF persists, but changing distance provenance from
   `Manual` to `Document` does not persist. This leaves the credit batch with
   one open requirement and disables Removal creation.
2. Production telemetry imports only 14 of 16 valid UTC rows because the run
   window is interpreted in the browser timezone instead of the facility
   timezone.
3. The local database contains two active facilities mapped to the same
   Isometric project and template. Neither has an external facility ID. This is
   unsafe for the intended one-project/one-local-facility Statement path.
4. Attempting to add the intended external facility ID to `FAC-26-001` is
   rejected because prior certifier submissions make the mapping immutable.

No Removal or GHG Statement was created by this first pass. At that checkpoint,
Isometric remained unchanged at 36 GHG entries and 12 Statements. Therefore no
fresh Noma-to-Isometric sequestration, emissions, uncertainty, net, or
allocation reconciliation was possible for `CB-26-001`.

## Facility/reset audit

The supposedly empty UI briefly showed definitive empty states, then loaded
persisted facility data. A post-run read-only database check confirmed:

| Facility | Name | Created (UTC) | Project | Template | External facility |
| --- | --- | --- | --- | --- | --- |
| `FAC-26-001` | QA 2026-07-25 Local Submission Facility | 2026-07-25 12:41:25 | `prj_1K9YJ33RKSBX9FFF` | `rvt_1KS4S43VPSBXA26X` | unset |
| `FAC-26-002` | QA0725B Isolated E2E Facility | 2026-07-25 13:06:15 | `prj_1K9YJ33RKSBX9FFF` | `rvt_1KS4S43VPSBXA26X` | unset |

Both records predate this browser run. The browser chain used `FAC-26-001`;
it did not create `FAC-26-002`. The exact earlier action that created
`FAC-26-002` was not captured, so no cause is asserted.

The current run attempted to map `FAC-26-001` to
`fcl_1K9YJQNA7SBXAG15`. Noma rejected the update with the prior-submissions
immutability guard. Project and template remained saved; external facility
remained unset.

Evidence:

- [Facilities after loading](/private/tmp/codex-computer-use.local-e2e.l30EhO/06-facilities-before-create.png)
- [External-facility mapping blocker](/private/tmp/codex-computer-use.local-e2e.l30EhO/08-mapping-facility-id-blocker.png)

## Route sweep

The browser visited:

`/dashboard`, `/traceability`, `/feedstocks`, `/production-runs`,
`/formulations`, `/biochar-products`, `/reactors`, `/storage-locations`,
`/feedstock-types`, `/energy`, `/suppliers`, `/customers`, `/orders`,
`/deliveries`, `/applications`, `/credit-batches`, `/samples`,
`/certification/settings`, `/certification/removals`,
`/certification/ghg-statements`, `/facilities`, `/settings/organization`,
`/admin`, and `/admin/organizations`.

No route crashed and no browser-surface console failure appeared. Several
routes incorrectly flashed authoritative empty states before replacing them
with loaded data.

## Operator chain

### Production and inventory

- Reactor: `R-26-001`
- Feedstock type: `FT-26-001`, Forestry waste, Pyrolysis, registry-catalogued
- New bins: `SL-26-002`, `SL-26-004`, `SL-26-005`
- Supplier: `SUP-26-001`
- Feedstock receipt: `FS-26-001`
- Production run: `PR-26-001`
- Biochar product: `BP-26-001`
- Customer: `CUS-26-001`
- Order: `OR-26-001`
- Delivery: `DL-26-001`
- Credit batch: `CB-26-001`, sampled Method A, 1,000-year durability

Persisted run values:

| Input | Value | Independent check |
| --- | ---: | --- |
| Feedstock receipt wet mass | 12,000 kg | — |
| Receipt moisture | 8% | dry receipt = 11,040 kg |
| Run input wet mass | 5,000 kg | — |
| Run input moisture | 8% | dry input = 4,600 kg |
| Run output wet mass | 1,250 kg | — |
| Run output moisture | 4% | dry output = 1,200 kg |
| Plant/startup diesel | 5 L | persisted |
| Generator diesel | 3 L | persisted |
| Preprocessing fuel | 2 L | generator + preprocessing = 5 L |
| Electricity | 25 kWh | persisted |

The run was saved as Running, changed to Complete, returned to Running with the
end cleared, and saved Complete again. Mass and energy values survived.

The product form silently rejected the exact wet input `1041.6667` because of a
`0.01` step. `1041.67` saved, yielding approximately 1,000.003 kg dry.

### Transport

- Feedstock: `12 t × 42 km × 2 = 1,008 t-km`
- Raw biochar delivery: `0.75 t × 18 km × 2 = 27 t-km`
- Applied fraction: `750 / 1,200 = 0.625`
- Applied-share delivery transport: `27 × 0.625 = 16.875 t-km`
- Sample transport: true zero

Delivery distance provenance successfully persisted as `Document`.
Feedstock distance provenance did not.

### Applications

| Application | Date | Dry mass | Area | Method |
| --- | --- | ---: | ---: | --- |
| `AP-26-001` | 2028-01-08 | 250 kg | 1.10 ha | Manual |
| `AP-26-002` | 2028-01-09 | 300 kg | 1.20 ha | Mechanical |
| `AP-26-003` | 2028-01-10 | 200 kg | 0.80 ha | Manual |

Total applied mass is exactly `250 + 300 + 200 = 750 kg`, matching the
delivery with zero unapplied capacity.

All three boundary-evidence PDFs persisted and all applications became ready.
However, evidence type selected during creation reopened as `Weighbridge`;
reselecting `Affidavit` in edit mode persisted.

### Lab samples

Samples were created in non-linear chemistry order 3, 1, 4, 2:

| Sample | Date | Total C | Organic C | H/C_org | O/C_org | R0 | ≥2% readings | Reactive | Residual |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `SAM-26-001` | Jan 4 | 81.60% | 80.20% | 0.3120 | 0.1000 | 0.89% | 90% | 25% | 75% |
| `SAM-26-002` | Jan 2 | 82.40% | 80.80% | 0.3244 | 0.0900 | 0.94% | 95% | 22% | 78% |
| `SAM-26-003` | Jan 5 | 82.20% | 80.65% | 0.3221 | 0.0920 | 0.93% | 94% | 23% | 77% |
| `SAM-26-004` | Jan 3 | 82.00% | 80.50% | 0.3182 | 0.0950 | 0.91% | 92% | 24% | 76% |

Exact pooled means:

- Organic C: 80.5375%
- H/C_org: 0.319175
- O/C_org: 0.09425
- Total C: 82.05%

`SAM-26-003` organic C was changed from 80.65% to 80.64%, saved, then restored
to 80.65%. Reload confirmed the final value and pooled result. Chemistry became
eligible with four usable samples on four distinct dates.

## Upload results

All nine PDFs were visibly marked
`LOCAL QA SYNTHETIC EVIDENCE - ISOMETRIC SANDBOX ONLY`, rendered to PNG, and
visually inspected before upload.

| File class | Count | Result after reload/reopen |
| --- | ---: | --- |
| Telemetry CSV | 1 | File persisted; 14/16 readings imported |
| Feedstock transport PDF | 1 | File persisted; provenance stayed Manual |
| Delivery transport PDF | 1 | File and Document provenance persisted |
| Application affidavits | 3 | All files persisted |
| Lab reports | 4 | All files persisted |

Local storage returned successful upload responses. This directly differs from
the staging object-storage failure.

## Telemetry defect

CSV interval: `2028-01-02T08:00:00Z` through
`2028-01-02T15:30:00Z`, 16 half-hour rows.

Expected: all 16 rows inside the 08:00–16:00 facility run.

Actual: 14 rows imported. Dropped:

- `2028-01-02T15:00:00Z`
- `2028-01-02T15:30:00Z`

The run form combines date/time as a browser-local `Date`. In Europe/Zurich,
08:00–16:00 became approximately 07:00Z–15:00Z; the UTC CSV importer then
excluded timestamps at or after the end. The facility timezone
`Africa/Dar_es_Salaam` was not used.

Probable code area:

- `src/lib/date-utils.ts`
- `src/components/production-runs/production-run-form.tsx`
- `src/lib/production-readings/readings-csv.ts`

Evidence: [Telemetry persisted with 14/16 rows](/private/tmp/codex-computer-use.local-e2e.l30EhO/13-run-telemetry-14-of-16.png)

## Readiness, Removal, and Statement

Before evidence, `CB-26-001` had five open groups: chemistry, telemetry,
feedstock transport, delivery transport, and three applications.

After evidence:

- Chemistry: passed
- Telemetry: passed despite the 14/16 defect
- Delivery transport: passed
- Applications: passed
- Feedstock transport: failed, `1 record needs attribution`

The feedstock edit UI visibly showed:

`Saved: Manual · Draft: Document`

after saving, including a safe double-click attempt. No duplicate receipt or
file was created, but no toast or inline error explained the failed provenance
save. Reload kept the PDF and reverted the draft to saved Manual state.

The Removal wizard therefore showed `0 of 1 complete`, kept Continue disabled,
and never reached preview or submission.

The Statement wizard accepted a January 2028 period only after first showing a
stale contradictory validation alert. It derived 2028-01-01 through
2028-01-31, showed zero eligible removals, and kept Next disabled.

Evidence:

- [Readiness before evidence](/private/tmp/codex-computer-use.local-e2e.l30EhO/11-readiness-before-evidence.png)
- [Feedstock saved/draft mismatch](/private/tmp/codex-computer-use.local-e2e.l30EhO/14-feedstock-evidence-provenance-save-blocker.png)
- [Final one-issue readiness state](/private/tmp/codex-computer-use.local-e2e.l30EhO/17-readiness-after-evidence-feedstock-blocked.png)
- [January 2028 Statement with zero removals](/private/tmp/codex-computer-use.local-e2e.l30EhO/18-ghg-statement-jan-2028-zero-removals.png)

## Adversarial checks

- Empty supplier submit: inline required-name error; no invalid row.
- Feedstock moisture 120: rejected; corrected to 8.
- Safe feedstock double-save: no duplicate; provenance still failed.
- Run lifecycle: Running → Complete → Running → Complete; values persisted.
- Telemetry close/reopen/reload: file and 14 readings persisted.
- Applications interleaved with revisit/edit; total stayed 750 kg.
- Slow `AP-26-002` save was allowed to finish; no duplicate.
- Samples created out of date/chemistry order.
- Sample chemistry edited, saved, reverted, and reloaded.
- Browser back/reload used on safe detail flows; records remained accessible.
- Credit-batch preview claimed no matching run, while saved batch contained
  `PR-26-001`.

## Findings

### Resolved — Feedstock evidence provenance could not be saved

Expected: `Document` saves and satisfies readiness.

Actual: PDF persists, saved provenance remains `Manual`, and Removal creation
is blocked.

Root cause: dashboard deep links populated `deepLinkedSideSheet`, while the
update handler returned unless the separate local `sideSheet` held an entity.
The handler now submits the displayed edit entity and clears the deep-link
state after success. Real UI reload and the focused dashboard E2E both pass.

### Resolved — Future-dated Removal data wrote partially before rejection

Expected: invalid future production/application dates fail before any
submission-side mutation.

Actual before the fix: ordinary datapoints and 4 of 11 Sources were created
before Isometric rejected the first future `s_fraction`.

Final behavior: a local actionable validation error occurs before protocol
audit, submit-client construction, evidence mirroring, datapoints, GHG entry,
Removal creation, or submission-ledger claim. Focused orchestration coverage
passes and a final UI retry left all local/external identifiers and counts
unchanged.

### P1 — Browser timezone truncates valid UTC telemetry

Expected: 16/16 rows.

Actual: 14/16; the last two valid UTC readings are dropped.

### P1 — Reset/test isolation is not clean

Expected: empty local schema for a fresh chain.

Actual: two active facilities and prior certification state survive/appear
after reset; both facilities map to the same external project/template.

### P1 — External facility mapping is unavailable for the intended QA facility

Expected: set `fcl_1K9YJQNA7SBXAG15`.

Actual: prior-submission guard blocks the update and leaves the external
facility ID unset.

### P2 — Application evidence type does not persist on creation

Expected: selected `Affidavit` reopens as `Affidavit`.

Actual: it reopens as `Weighbridge` until edited again.

### P2 — Statement date validation is stale on first action

Expected: 2028-01-31 validates immediately after 2027-12-31.

Actual: first action says it is not later; second action advances.

### P2 — Credit-batch preview disagrees with saved membership

Expected: preview and saved batch show the same eligible run count.

Actual: preview says no run; saved batch contains one.

### P2 — Definitive empty states flash before data loads

Expected: neutral loading state.

Actual: authoritative “No … yet” states briefly appear despite existing data.

### P2 — Biochar product precision failure is silent

Expected: exact value saves or a clear validation error.

Actual: `1041.6667` does not save; `1041.67` saves without explaining the
precision constraint.

## Isometric reconciliation

| Metric | Baseline | Final |
| --- | ---: | ---: |
| GHG entries | 36 | 37 |
| GHG Statements | 12 | 12 |

Latest observed pre-existing Statement:
`ggs_1KY2PNSW4SBX2Z5P`, 2027-12-01 through 2027-12-31, zero entries.

No new `rmv_` or `ggs_` ID exists for `CB-26-001`. The 37th entry is the
separate July 2026 `CB-26-002` QA Removal
`rmv_1KYD8GSQYSBXKWSQ`; its reconciliation is recorded in
`2026-07-25-staging-e2e-removal-ghg.md`. No external emissions, removal,
uncertainty, net, risk, supplier allocation, or buffer allocation figures are
available for this January 2028 target. The independent Noma input arithmetic
is correct, but this target's actual Removal and Statement numbers remain
untested.

Evidence:

- [Initial statements](/private/tmp/codex-computer-use.local-e2e.l30EhO/02-isometric-baseline-statements.png)
- [Final 12 Statements](/private/tmp/codex-computer-use.local-e2e.l30EhO/19-isometric-final-statements-12.png)
- [Final 36 GHG entries](/private/tmp/codex-computer-use.local-e2e.l30EhO/20-isometric-final-ghg-entries-36.png)

## Mutation ledger

Local Noma created or modified:

- New operational records from `FS-26-001` through `CB-26-001`
- Three applications and four samples
- Ten evidence uploads
- Run and sample back-and-forth edits described above

No invalid test value remained saved.

External Isometric mutations:

- Projects: none
- Facilities: none
- Templates: none
- GHG entries/Removals: partial Sources/datapoints from the pre-fix rejected
  target attempt; no target `rmv_` ID. The separate `CB-26-002` run added one
  successful Removal.
- GHG Statements: none

Repository changes:

- Deep-linked feedstock update fix and focused dashboard E2E regression
- Future-date Removal preflight, sequencing fix, and focused unit/orchestration
  regressions
- This QA ledger

Full browser-worker report:
[detailed-report.md](/private/tmp/codex-computer-use.local-e2e.l30EhO/detailed-report.md)

## Release position

**Still production-blocking for this exact target and Statement path.**

Feedstock provenance and mutation-clean future-date rejection are fixed. The
remaining blockers are the January 2028 synthetic dates, telemetry timezone
handling, and the reused project's continuous Statement coverage through
2027-12-31. Correct the target dates through the operator workflow and rerun the
complete Removal; then use a project/period whose next Statement window is
non-future and contains that submitted Removal before treating its Noma and
Isometric figures as verified.
