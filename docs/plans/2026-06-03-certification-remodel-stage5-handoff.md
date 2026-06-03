# Handoff — Certification (Isometric) UI Remodel · after Stage 5

## What this is

Remodelling the noma-dmrv **Certification / Isometric** UI from a phase-grown
set of surfaces into a native, first-class tabbed workspace. Read these first —
this doc does **not** repeat them:

- **Plan:** `~/.claude/plans/i-d-like-to-remodel-scalable-moler.md`
  (8 locked decisions, status model, IA/routes, surfaces, staged rollout, risks).
- **Prior handoffs:** `docs/plans/2026-06-03-certification-remodel-stage3-handoff.md`
  (Stages 1–3) and `…-stage4-handoff.md` (Stage 4 — Removals migration). Both
  superseded by this file; still the reference for earlier-stage detail.
- **Domain truth:** `CONTEXT.md` (glossary) + `docs/adr/0003`–`0006`. **Stack/rules:** `.claude/CLAUDE.md`.
- **Branch:** `chore/refactor-certify-flow`.

Locked corrections already in the plan — **don't re-litigate**: removals have
**no** remote status (lifecycle ends at "Submitted"); GHG remote status comes
from `metadata.remoteStatus`; telemetry is a separate sub-status; the status
model is strictly client-safe (type-only generated imports); Settings splits
admin vs read-only **by data**; **membership is read-only on GHG statements**
(Isometric links removals by date range server-side — ADR 0004).

## User directives in force

- **Migrations: don't sweat them — not live yet.** For any schema change, adjust
  the seed and reseed (`pnpm db:reset` / `tests/e2e/fixtures/seed-chain-data.ts`)
  rather than authoring safe multi-phase migrations. **Stages 1–5 added no schema
  changes**, so nothing to reseed.
- Hand off again at natural milestones (this doc = after Stage 5).
- After Stage 5 + this handoff, **continue into Stage 6** (the last phase).

## Progress

- **Stages 1–4: DONE** (status foundation · settings consolidation · tabbed shell
  + Overview queue · Removals migration). See the Stage-3/4 handoffs.
- **Stage 5 — GHG Statements migration: DONE & verified (this session).**
- **Stage 6 — Bridge + nav + cleanup: DONE & verified (this session).** The
  remodel is now **complete (Stages 1–6)**. See "Stage 6 — what shipped" below;
  it supersedes the "Next" section that follows.
- **Nothing committed** (user hasn't asked). Working tree carries Stages 1–6.

## Stage 5 — what shipped (all additive; mirrors the Stage-4 Removals shape)

### Statements DataTable
- **`src/components/certification/ghg-statements-list.tsx`** (NEW) —
  `GhgStatementsList`: app-native DataTable (cf. `removals-list`). Columns
  Reporting period / Linked removals / Registry record / Status. Status from
  **`deriveSubmissionStatus(latest, isLockedInFlight, "ghgStatement")`** fed by
  the persisted **`metadata.remoteStatus`** overlay — **NOT** a per-row
  `useGhgStatementState` live fetch (P2-a, N+1). Rows from
  `useGhgStatementsForFacility`; `isProduction`/`isLinked` from
  `useFacilityCertifierMapping` (same dual-read the old hub did). **`?statement=<id>`**
  (nuqs, shallow/replace) opens the detail sheet. "New GHG Statement" opens the
  create drawer, gated on `isLinked === true`; not-linked / mapping-failed notice
  preserved (now points at Settings → Registry connection).
- **`src/app/(app)/certification/ghg-statements/page.tsx`** (REWRITE) →
  `<GhgStatementsList/>`.

### Read-only side-sheet
- **`src/components/certification/ghg-statement-detail-sheet.tsx`** (NEW) —
  `GhgStatementDetailSheet` on `SlideOverPanel` (like `RemovalDetailSheet`).
  Header/status/period/registry render instantly from the passed
  `GhgStatementListItem`; a split-out `DetailState` owns the heavier
  `useGhgStatementState` fetch (verifier status, linked removals, sync events) —
  runs only while one statement is selected, never per row. **Membership is
  read-only** (ADR 0004 — no assign/detach UI). Actions: **Refresh status**
  (`useRefreshGhgStatementStatus`) + **Submit/Resubmit to verifier** (reuses the
  kept `GhgStatementSubmitDialog`, mode via `chooseGhgSubmitMode`).

### Period-first create drawer
- **`src/components/certification/ghg-statement-create-drawer.tsx`** (NEW) —
  `GhgStatementCreateDrawer`: the old 3-step Modal stepper upgraded to the shared
  **`StepFlow` (`orientation="vertical"`)** inside a `SlideOverPanel` (size
  `wide`). Same period-first flow (pick `end_on` → preview predicted removals by
  `completedOn` → confirm + production gate → result panel with Isometric's
  reconciled `removal_ids` + drift warnings). Mounts only while open (rendered
  conditionally), so RHF + mutation start fresh each time — no Modal-style
  `onOpen` reset. Reuses `useCreateGhgStatement`, `useOpenRemovalsForFacility`,
  `createGhgStatementSchema`, `ProductionConfirmation`, `EnvBanner`.

### Barrel + deletions
- **`src/components/certification/index.ts`** (MOD) — exports `GhgStatementsList`,
  `GhgStatementDetailSheet`, `GhgStatementCreateDrawer`; **kept**
  `GhgStatementSubmitDialog`; **removed** `GhgStatementsHub` +
  `GhgStatementCreateDialog`.
- **`ghg-statements-hub.tsx`** + **`ghg-statement-create-dialog.tsx`** (DELETED) —
  superseded. No remaining refs (grep-clean across `src/` + `tests/`).

### Verification (end of Stage 5)
- `pnpm typecheck` → **exit 0**.
- `pnpm exec eslint <changed files>` → **0 errors** (1 benign React-Compiler
  warning on RHF `watch()` — identical to the pattern the old create-dialog used).
- `pnpm vitest run` → **371 passed / 5 pre-existing skips (47 files)** — unchanged
  from Stage 4; Stage 5 is UI over already-tested classifiers/mutations
  (`deriveStatementStatus` was unit-tested in Stage 1), so no new pure logic.
- `pnpm build` not re-run — same pre-existing `STORAGE_PROVIDER=local-fs`
  page-data stop applies (unrelated; see Stage-4 handoff).

## Deferred / known gaps (don't treat as bugs)
- **Review-step run aggregation** — still open (`docs/open-questions.md`
  → `certification/review-step-run-aggregation`). Unchanged by Stage 5.
- **certify-panel.tsx inline blocker dup** — still present; **deleted in Stage 6**
  (see below). Not touched in Stage 5.

## Stage 6 — what shipped (the bridge + nav + cleanup; ADR 0007)

- **Credit-batch Certify panel demoted to a read-only bridge**
  (`certify-panel.tsx`, REWRITE 448→~210 lines). Shows the removal's **own
  local** status only (P1-b — never a verifier status), project, member batches
  read-only, and a primary **"Open in Certification →"** deep-link (the removal's
  Review flow when grouped, else the Removals tab). **Deleted the inline blocker
  dup** (`analyzeCoverage` / `deriveBlocker` / `templateResolved` / `submitReady`
  / coverage notices) — canonical in `readiness.ts`. Dropped the in-panel Submit
  + `SourcesPanel` (sources live in the Review Evidence step now). Mount in
  `credit-batch-list.tsx` (`viewModeChildren`) unchanged — regression-safe.
- **Retired `useSubmitCreditBatchRemoval`** + its import (`use-certification.ts`);
  the `submitCreditBatchRemoval` action is left orphaned (flagged in
  open-questions → `certification/orphaned-creditbatch-submit-action`).
- **Sidebar single Certification entry** (`app-sidebar.tsx`) — the two items
  collapse to one titleless `/certification` entry (icon `SealCheck`, new
  `SECTION_ACCENTS.certification` = `--clr-pink`); dropped the unused
  `ClipboardText` import. The tab bar handles sub-nav.
- **Facility side-sheet certifier block → read-only summary**
  (`facility-certifier-summary.tsx`, NEW; swapped into `facility-list.tsx`).
  Uses the DB-only `useFacilityCertifierSummary` (never the management payload) —
  project / protocol / default-template ids + "Manage in Certification →
  Settings ↗". `FacilityCertifierSection` stays the Settings management home.
- **Sharpened Overview deep-links** (`certification-overview.tsx`): ready removals
  → `?removal=` sheet (one-click submit there); non-config blockers → the Review
  `?step=preflight`; config blockers → Settings; statements → `?statement=` sheet.
- **Docs:** `docs/adr/0007-certification-workspace-consolidation.md` (NEW —
  records the single submit entry point, panel demotion reversing ADR 0003's
  dual-entry, tabbed workspace, side-sheet + Review route, shared status model).
  Sharpened `CONTEXT.md` submit-target distinction (Removal → registry, ends at
  *Submitted*; GHG Statement → verifier, with the remote lifecycle). Swept the
  two user-facing `/admin/emission-estimates` drift-panel links → Settings
  (`project-emissions-drift-panel.tsx`); the route redirect already landed in
  Stage 2. Stage-6 deferrals logged in `docs/open-questions.md`.
  - **NB (one stray nit):** updating the `docs/adr/0001`–`0006` range in
    `.claude/CLAUDE.md` to `0001`–`0007` was **blocked** (self-modification of
    the agent startup config). Bump it manually if desired — cosmetic only.

### Verification (end of Stage 6)
- `pnpm typecheck` → **exit 0**.
- `pnpm exec eslint <changed files>` → **0 errors** (same lone benign
  React-Compiler RHF-`watch()` warning from Stage 5's create drawer).
- `pnpm vitest run` → **371 passed / 5 skips (47 files)** — unchanged; Stage 6 is
  UI demotion + nav + docs, no new pure logic.
- Grep-clean: no dangling refs to `GhgStatementsHub` / `GhgStatementCreateDialog`
  / `useSubmitCreditBatchRemoval`; `FacilityCertifierSection` gone from the
  facility sheet (still the Settings home).

### Remaining (not Stage work — your call)
- **Nothing committed.** Working tree carries Stages 1–6 on
  `chore/refactor-certify-flow`. Commit / open a PR when ready
  (`/code-review` + `pr-review-toolkit:review-pr` first).
- Two logged deferrals: `certification/bridge-linked-statement-status` (inline
  the linked GHG Statement status in the bridge) and
  `certification/orphaned-creditbatch-submit-action` (delete the orphaned action).
- Optional E2E: tab nav + settings round-trip + removal Review happy path
  (plan Verification §4).

---

## (Superseded) Next: Stage 6 — Bridge + nav + cleanup (the last phase)

_Done — kept below as the original plan for reference._

Per the plan's rollout (decision 8 + Risks):
1. **Credit-batch Certify panel → read-only bridge.** Demote `certify-panel.tsx`:
   copy uses the **removal's own local** status only ("Part of Removal … ·
   Submitted") and *separately* the linked statement's status when one exists
   ("GHG Statement: Awaiting verifier") — **never** attribute a verifier status to
   the removal (P1-b). Add **"Open in Certification →"** deep-link. **Delete the
   inline blocker dup** (`analyzeCoverage` / `deriveBlocker` / `templateResolved`
   / `submitReady`) — now canonical in `lib/certification/readiness.ts` +
   `deriveRemovalReadiness`. **Regression-check** the credit-batch side-sheet
   (`credit-batch-list.tsx` mounts `CertifyPanel` in `viewModeChildren`).
2. **Sidebar single Certification entry** — `app-sidebar.tsx`: collapse the two
   Certification items into one `/certification` entry (icon `SealCheck`, give
   Certification its own accent `--clr-pink` instead of reusing `verification`);
   the tab bar handles sub-nav.
3. **Facility side-sheet certifier block** → read-only summary + "Manage in
   Certification → Settings" link (`facility-list.tsx:~406-408`).
4. **Sharpen Overview deep-links** — `certification-overview.tsx`
   (`removalAttention` / `blockedHref`) should point at the `?removal=` sheet /
   the review route, not the old hub. Statement attention rows → `?statement=`.
5. **Docs:** write **`docs/adr/0007-certification-workspace-consolidation.md`**
   (single-entry submission + panel demotion — reverses ADR 0003's dual-entry —
   tabbed workspace, side-sheet quick-view + guided review route, shared status
   model). Sharpen `CONTEXT.md` submit-target distinction (Removal → registry;
   GHG Statement → verifier). Redirect/refresh stale `/admin/emission-estimates`
   refs (the redirect to Settings → Emissions landed in Stage 2 — just sweep
   stragglers).
6. Remove any remaining dead wrappers surfaced along the way.

## Suggested skills / process for the next session
- **`frontend-design`** — for the demoted panel + facility summary block (stay
  within brutalist tokens; the Stage-4/5 lists + sheets + drawers are the native
  references now).
- After Stage 6: `pnpm typecheck` · `pnpm lint` · `pnpm vitest run`. Add Vitest
  for any new pure logic (none expected — Stage 6 is mostly UI demotion + nav).
- Before any PR: `/code-review` + `pr-review-toolkit:review-pr`.
