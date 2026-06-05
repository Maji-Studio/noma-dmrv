# Isometric Docs Change Log — Archive (2026-06 Certification Remodel)

> Archived from `docs/isometric/changes.md` on 2026-06-04 to keep the active
> Isometric changelog focused on evergreen integration notes.

## 2026-06-04 (consolidate the certify-flow review findings)

Refactor-only — no schema/migration/behaviour change; the existing certify
suites (`isometric-certify-context`, `certification-mass-accounting`,
`readiness`, `status`) stay green. Resolves four review findings on the
post-remodel certify flow; no new public surface beyond the helpers below.

- **Facility facts loaded once per Overview, not per removal.** The Overview
  work queue (`fn/certification/overview.ts`) was rebuilding the full submit
  context per row, re-pulling the facility-level Isometric project / template /
  blueprint data each time. `buildRemovalContext` now takes a
  `FacilityCertifierFacts` (the facility-scoped half) resolved once via the new
  `loadFacilityCertifierFacts`; the queue loads it a single time and both it and
  the submit path (`loadRemovalSubmissionContext`) feed through the same
  composer. Closes `open-questions.md` → `perf/overview-facility-refetch`.

- **One mass-accounting walk.** `buildAttribution` (per-run applied fraction,
  was inline in `certify-context.ts`) and `buildRunSummary` (Review aggregate)
  duplicated the same lineage→kg conversion. Merged into `buildMassAccounting`
  in the renamed `src/lib/certification/mass-accounting.ts` (was
  `run-summary.ts`; test renamed to match), returning
  `{ attributionByRunId, runSummary }` from one pass — so the Review summary and
  the submit payload share a numerator/denominator and cannot drift (ADR 0003).

- **One readiness-facts projection.** The context → `RemovalReadinessFacts`
  mapping that lived inline in both the Overview loader and the Review
  pre-flight is now the single `toRemovalReadinessFacts`
  (`src/lib/certification/readiness-facts.ts`). The regroup-blocking status list
  is no longer mirrored client-side: the canonical `BLOCKING_SUBMISSION_STATUSES`
  now lives in the client-safe `lib/certification/status.ts`, imported by both
  the server guards (`data-access/certification.ts`, `certifier-removals.ts`) and
  the client gate `canRegroupRemoval`.

- **Docs hygiene.** The dated certification-remodel (Stages 3–5) + E2E handoff
  notes moved from `docs/plans/` to `docs/archive/` — session state, not
  evergreen (CLAUDE.md Documentation Standards).

## 2026-06-03 (resolve the three certification-remodel deferrals)

Closes the remaining post-remodel deferrals (was `open-questions.md` →
`certification/review-step-run-aggregation`, `…/bridge-linked-statement-status`,
`…/orphaned-creditbatch-submit-action`; all three entries removed). UI + a lean
context-field addition + dead-code removal — no schema/migration change.

- **Review step now shows run aggregation.** A focused `runSummary` (run count,
  total biochar output, applied dry kg) is added to the lean `RemovalCertifyContext`
  and projected from the heavy `RemovalSubmissionContext` via the new pure,
  unit-tested `buildRunSummary` (`src/lib/certification/run-summary.ts`,
  `tests/certification-run-summary.test.ts`). `review-step.tsx` renders it as a
  three-cell table; `appliedDryKg / totalBiocharOutputKg` is the overall
  attribution the submit pipeline scopes by per run (ADR 0003). The heavy
  `runs` array is still NOT shipped to the client — only the summary.

- **Demoted Certify bridge inlines the linked GHG Statement's status.**
  `RemovalCertifyContext.linkedGhgStatement` ({ id, derived `DerivedStatus` })
  is resolved up-front in `buildRemovalContext` from
  `certifierRemovals.ghgStatementId` and the statement's own latest submission
  (`deriveSubmissionStatus(…, "ghgStatement")`, the same
  `metadata.remoteStatus` overlay the GHG list reads). `certify-panel.tsx`
  renders it as a separate, clearly-labelled line that deep-links to
  `/certification/ghg-statements?statement=<id>`. P1-b preserved: the removal's
  own status and the statement's verifier status are distinct rows — the
  verifier lifecycle is never attributed to the removal. Computed up-front so
  every early-return path of the loader carries the real value (the Stage-6
  regression surface the plan flagged).

- **Deleted the orphaned `submitCreditBatchRemoval` action** (caller-less since
  the Stage-6 panel demotion): removed from
  `fn/certification/removal-grouping.ts` + its `fn/certification/index.ts`
  barrel export, and the now-unused `submitCreditBatchSchema` /
  `SubmitCreditBatchInput` from `schemas/certification.ts`.

- **Verification:** `pnpm typecheck` exit 0; `eslint` (changed files) 0 errors;
  `pnpm vitest run` → 377 passed / 5 skipped (48 files; +6 new run-summary tests).
