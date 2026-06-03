# Handoff — Certification (Isometric) UI Remodel · after Stage 4

## What this is

Remodelling the noma-dmrv **Certification / Isometric** UI from a phase-grown
set of surfaces into a native, first-class tabbed workspace. Read these first —
this doc does **not** repeat them:

- **Plan:** `~/.claude/plans/i-d-like-to-remodel-scalable-moler.md`
  (8 locked decisions, status model, IA/routes, surfaces, staged rollout, risks).
- **Prior handoff (Stage 3):** `docs/plans/2026-06-03-certification-remodel-stage3-handoff.md`
  — superseded by this file; still the reference for Stages 1–3 detail.
- **Domain truth:** `CONTEXT.md` (glossary) + `docs/adr/0003`–`0006`. **Stack/rules:** `.claude/CLAUDE.md`.
- **Branch:** `chore/refactor-certify-flow` (NB: the Stage-3 doc said
  `feature/isometric-api`; the work actually lives on `chore/refactor-certify-flow`).

Locked corrections already in the plan — **don't re-litigate**: removals have
**no** remote status (lifecycle ends at "Submitted"); GHG remote status comes
from `metadata.remoteStatus`; telemetry is a separate sub-status; the status
model is strictly client-safe (type-only generated imports); Settings splits
admin vs read-only **by data**.

## User directives in force

- **Migrations: don't sweat them — not live yet.** For any schema change, just
  adjust the seed and reseed (`pnpm db:reset` / `tests/e2e/fixtures/seed-chain-data.ts`)
  rather than authoring safe multi-phase migrations. **Stages 1–4 added no schema
  changes**, so nothing to reseed.
- Hand off again at natural milestones (this doc = after Stage 4).

## Progress

- **Stages 1–3: DONE** (status foundation · settings consolidation · tabbed shell
  + Overview queue). See the Stage-3 handoff.
- **Stage 4 — Removals migration: DONE & verified (this session).**
- **Stages 5–6: PENDING, not started.**
- **Nothing committed** (user hasn't asked). Working tree carries Stages 1–4.

## Stage 4 — what shipped (all additive; old routes still resolve)

Build order followed the Stage-3 handoff's plan for Stage 4.

### Data layer
- **`src/fn/certification/certify-context.ts`** (MOD) — added
  **`hasSubmittableRuns: boolean`** to `RemovalCertifyContext` (threaded through
  `buildRemovalContext`'s `base`/final returns + `projectUiContext`); lets the
  client-side pre-flight classifier see the same "is there anything to submit"
  fact the server Overview loader does, without shipping the heavy `runs` array.
  Added **`loadRemovalCertifyContext(removalId)`** action (mirrors
  `loadCertifyContextForCreditBatch`, resolves scope from the removal). Exported
  from `fn/certification/index.ts`.
- **`src/hooks/use-certification.ts`** (MOD) — **`useRemovalCertifyContext`** +
  key `certificationKeys.certifyContextForRemoval` (lock-in-flight refetch, like
  the credit-batch variant).
- **`tests/isometric-submit-removal.test.ts`** (MOD) — fixture gained
  `hasSubmittableRuns: true` (the only spot constructing a `RemovalSubmissionContext`).

### Pure logic (the single source for blocker/regroup decisions)
- **`src/lib/certification/readiness.ts`** (MOD) — extracted shared helpers
  (`templateBlockerReason`, `templateResolvesCleanly`, `transportGapReasons`) so
  `deriveRemovalReadiness`'s output is **byte-identical** (the 19 prior cases
  still pass). Added **`buildRemovalPreflightChecklist(facts) → PreflightCheck[]`**
  (the canonical pre-flight) and **`canRegroupRemoval({local, lockInFlight})`**
  (mirrors the server's `BLOCKING_SUBMISSION_STATUSES = draft/submitted/accepted`,
  declared locally for client-safety).
- **`src/lib/certification/readiness.test.ts`** (MOD) — +12 Vitest cases (31 total
  in this file).

### Shared primitive
- **`src/components/ui/step-flow/index.tsx`** (NEW) — `StepFlow`: dumb stepped-flow
  chrome (numbered rail, visited-step nav, content slot, footer slot,
  horizontal/vertical). Exported from `@/components/ui`. Used full-width by the
  removal Review flow now; **reuse it as the drawer chrome for GHG create in Stage 5.**

### Removals workspace tab
- **`src/components/certification/removals-list.tsx`** (NEW) — `RemovalsList`:
  app-native DataTable (cf. `production-runs`) — columns Removal (id+window) /
  Credit batches / Status (from `deriveRemovalStatus`) / Readiness hint. Rows from
  **`useCertificationOverview`** (the shared classifier — never recompute). Below
  the table: ungrouped-batch grouping section via the lighter
  `useRemovalsForFacility` + existing mutations. **`?removal=<id>`** (nuqs
  `useQueryState`, shallow/replace) opens the detail sheet.
- **`src/components/certification/removal-detail-sheet.tsx`** (NEW) —
  `RemovalDetailSheet` on `SlideOverPanel` (not `EntitySideSheet` — it's read-only
  with bespoke actions). Summary + readiness reasons; footer = **one-click Submit
  when ready & 1:1** (production-gated via `SubmitConfirmDialog`), else **Review &
  submit** → review route; "Evidence & sources →" link to `?step=evidence`.
- **`src/app/(app)/certification/removals/page.tsx`** (REWRITE) → `<RemovalsList/>`.
- **`src/components/certification/removals-hub.tsx`** (DELETED) — replaced;
  `RemovalsHub` barrel export removed. `useRemovalsForFacility` /
  `loadRemovalsForFacility` are still live (used by the ungrouped section).

### Guided Review flow
- **`src/components/certification/removal-review/`** (NEW folder):
  - `index.tsx` — `RemovalReview` orchestrator: `useRemovalCertifyContext` →
    `buildFacts` → `deriveRemovalReadiness` + `buildRemovalPreflightChecklist`;
    `StepFlow` with Back/Next footer (only forward gate: Assemble needs ≥1 member;
    Submit gates on the verdict). Step deep-linked via **nuqs `?step=`**
    (`parseAsStringEnum`). Rail is fully navigable (`furthest = last`).
  - `assemble-step.tsx` — member list + detach/attach (ungrouped pool via
    `useRemovalsForFacility`); **frozen when `!canRegroupRemoval`** (ADR 0003).
  - `review-step.tsx` — project / template (`display_name`) / member batches /
    transport coverage. (Run aggregation deferred — see below.)
  - `evidence-step.tsx` — mounts `SourcesPanel` + `TelemetryPanel` (absorbs the
    old detail page; telemetry stays its **own** status block, ADR 0006).
  - `preflight-step.tsx` — renders `buildRemovalPreflightChecklist` as a
    met/unmet/skipped checklist + the verdict headline.
  - `submit-step.tsx` — single-phase `useSubmitRemoval`, production-gated;
    blocked → "Back to Pre-flight", success → registry record + "Back to Removals".
- **`src/app/(app)/certification/removals/[removalId]/review/page.tsx`** (NEW) →
  `<RemovalReview/>` (async params).
- **`src/app/(app)/certification/removals/[removalId]/page.tsx`** (REPLACED) —
  now `redirect()`s old Sources links to `…/review?step=evidence`, preserving
  `?facility=`.

### Verification (end of Stage 4)
- `pnpm typecheck` → **exit 0**.
- `pnpm exec eslint <changed files>` → **0**.
- `pnpm vitest run` → **371 passed / 5 pre-existing skips (47 files)** — +12 from
  readiness.test.ts.
- `pnpm build` → compiles + produces server chunks, then fails at **page-data
  collection** on the **pre-existing** `STORAGE_PROVIDER=local-fs` safeguard (via
  `/api/storage-local/[...key]`) — unrelated; any build with the dev `.env.local`
  hits it. Set production-shaped storage env for a clean run.

## Deferred / known gaps (don't treat as bugs)
- **Review-step run aggregation** — logged in `docs/open-questions.md`
  → `certification/review-step-run-aggregation`. The Review step shows
  composition + coverage, not the per-run applied-mass table (that data is only
  on the server-internal `RemovalSubmissionContext`). Resolve alongside
  `perf/overview-facility-refetch` (both touch `buildRemovalContext`).
- **certify-panel.tsx duplication is intentionally still there.** The inline
  blocker copy (`analyzeCoverage`, `deriveBlocker`, `templateResolved`,
  `submitReady`) is now superseded by `buildRemovalPreflightChecklist` /
  `deriveRemovalReadiness` (the canonical pre-flight), but the panel is **demoted
  to a read-only bridge in Stage 6** — refactoring it now would be throwaway work
  that risks the credit-batch sheet. Delete the dup as part of Stage 6.

## Next: Stage 5 — GHG Statements migration

Per the plan's rollout (mirror the Stage-4 Removals shape):
1. **Statements DataTable** — rewrite `ghg-statements/page.tsx` (currently
   `GhgStatementsHub`). Status badge from `deriveSubmissionStatus(..., "ghgStatement")`
   fed by `metadata.remoteStatus` — **NOT** a per-row `useGhgStatementState` live
   fetch (P2-a, N+1). Columns: period, status, linked-removal count.
2. **Side-sheet** via `?statement=<id>` (nuqs) — read-only; **membership is
   read-only** (ADR 0004 — never expose removal→statement assignment).
3. **Create upgraded to a `StepFlow` drawer** — reuse the new `StepFlow`
   (`orientation="vertical"`) inside a `SlideOverPanel`. Keep period-first
   (pick `end_on` → preview predicted removals by `completedOn` → confirm →
   reconcile `removal_ids`, surfacing drift). One statement per period (idempotent).
4. Submit-to-verifier (report URL → `AWAITING_VERIFICATION`) stays a separate
   guided action; status refresh updates the remote overlay.
- Reuse: `useGhgStatementsForFacility`, `useCreateGhgStatement`,
  `useSubmitGhgStatementToVerifier`, `useRefreshGhgStatementStatus`,
  `useOpenRemovalsForFacility` (stepper preview). Existing dialogs to fold in:
  `ghg-statement-create-dialog.tsx`, `ghg-statement-submit-dialog.tsx`,
  `ghg-statements-hub.tsx`.

## Then Stage 6 — Bridge + nav + cleanup
- **Credit-batch certify panel → read-only bridge** + "Open in Certification →"
  (reverses ADR 0003 dual-entry → **write ADR 0007**). Demote `certify-panel.tsx`;
  delete its inline blocker dup (now canonical in `readiness.ts`). Regression-check
  the credit-batch side-sheet (`credit-batch-list.tsx` mounts `CertifyPanel` in
  `viewModeChildren`).
- **Sidebar single Certification entry** (`app-sidebar.tsx`, accent `--clr-pink`).
- **Facility side-sheet certifier block** → read-only summary + "Manage in
  Certification → Settings" (`facility-list.tsx:~406-408`).
- **Sharpen Overview deep-links** (`certification-overview.tsx`
  `removalAttention`/`blockedHref`) to point at the `?removal=` sheet / review
  route instead of the hub.
- Remove any remaining dead wrappers; update `CONTEXT.md` submit-target
  distinction; sync stale `/admin/emission-estimates` refs.

## Suggested skills / process for the next session
- **`frontend-design`** — for the GHG DataTable + `?statement=` side-sheet +
  the `StepFlow` create drawer (stay within brutalist tokens; the Stage-4
  `removals-list.tsx` / `removal-detail-sheet.tsx` / `removal-review/` are the
  native references now).
- After each stage: `pnpm typecheck` · `pnpm lint` · `pnpm vitest run`. Add Vitest
  for any new pure logic.
- Before any PR: `/code-review` + `pr-review-toolkit:review-pr`.
