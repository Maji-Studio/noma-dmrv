# Architecture remediation plan — 2026-07-22

Source: architecture review (2026-07-22) + code verification of all five candidates.
Verified conclusions: evidence-method duplication is real with a **live fail-open
divergence** (null `evidenceMethod`: SQL treats as visual, in-memory skips);
create-with-evidence choreography is duplicated across **six** components; bin-stock
seam mostly exists already (one leak in production-runs); credit-batch collapse and
unified bin-stock seam are **deliberately out of scope** (area churned in #479/#481/#484/#499 —
revisit after it settles).

## Ground rules (every phase)

- Branch off **fresh `staging`** (`git fetch` first); never touch the existing
  `fix/qa-2026-07-21-ux-improvements` WIP. Verify `git branch --show-current` before every commit.
- Implementation: **codex-implementation** (gpt-5.6-sol high); Claude inspects the diff before PR.
- Local gates before PR: `pnpm lint` · `pnpm typecheck` · Vitest (root `tests/` + colocated) ·
  affected Playwright E2E.
- Read first per CLAUDE.md docs index: `docs/architecture.md`, `docs/code-style.md`,
  `docs/testing.md`; `docs/forms.md` for Phase 2/3 schema-adjacent edits.

## Per-phase PR loop (identical for all phases, run sequentially)

1. Branch `refactor/<phase-slug>` off staging.
2. Implement via codex; Claude verifies diff + runs gates.
3. Open PR, base `staging`, title `refactor: <imperative, lowercase>` (< 70 chars).
4. Post **two independent reviews as PR comments**:
   a. `/codex-review` (gpt-5.6-sol) of the PR diff → `gh pr comment`.
   b. **opus-4.8** reviewer agent over the same diff → `gh pr comment`.
5. Remediate per CLAUDE.md: verify every finding against the code first; fix valid ones
   minimally; answer invalid ones with a one-line written reason in the thread. Re-run gates, push.
6. Merge into `staging` once CI is green and all comments are resolved.
7. Next phase branches off the updated staging. No parallel phases.

---

## Phase 1 — Evidence-method rules module (big)

**Branch** `refactor/evidence-method-rules` · **Goal**: one source of truth for the
evidence-gap rule; SQL and in-memory become adapters.

Files: `src/lib/certification/application-evidence.ts` (rule spec lives here),
`src/data-access/application-evidence-sql.ts` (becomes SQL adapter),
`src/fn/certification/application-evidence-readiness.ts` (becomes in-memory adapter),
`tests/application-evidence-gap-sql.test.ts`, `tests/application-evidence-readiness.test.ts`.

Steps:
1. Define a declarative predicate spec for the three matchers (geotagged-photo-for-role,
   unconditional logbook type, conditional PDF + `logbookEvidenceType`) plus the
   `evidenceMethod` dispatch — pure data + pure functions in `lib/` (no db/ctx, per repo convention).
2. Adapter A: compile spec → Drizzle SQL fragments (replaces hand-written `NOT EXISTS`/`CASE`).
3. Adapter B: evaluate spec over `DocumentRow[]` (replaces hand-written TS predicates).
4. **Unify null-`evidenceMethod` semantics: non-boundary ⇒ visual** (matches SQL + DB
   `NOT NULL DEFAULT 'visual'`); delete the in-memory `continue` short-circuit.
5. Tests: contract suite running the SAME fixture matrix through both adapters; keep the
   existing 12-fixture parity test until both adapters pass it, then shrink it to a smoke check.

Acceptance: no behavioral change on DB-reachable rows; the null-`evidenceMethod` divergence is
gone by construction; a rule change now touches exactly one file.
Risk: this is a certification gate — fail-open danger. Mitigation: parity test stays green
throughout; shrink it only in the final commit.

## Phase 2 — `useCreateWithEvidence` hook (big)

**Branch** `refactor/create-with-evidence` · **Goal**: the create → flush → partial-failure →
clear → toast choreography lives once.

Files: new `src/hooks/use-create-with-evidence.ts` (wraps `use-deferred-attachments`);
migrate **six** call sites: `feedstock-list.tsx`, `delivery-list.tsx`,
`production-run-list.tsx`, `application-list.tsx`, `samples/sample-list.tsx`,
`production-runs/production-sample-table.tsx`.

Steps:
1. Extract the shared skeleton: create-mutation → `flush`/`flushMany` → on-fail reopen in edit
   mode + pluralized failure message → on-success `clear()` + close + toast. Include the
   `handleUpdate` unresolved-attachment guard and the `isFlushing`/`unsavedAttachmentCount`/
   discard-confirm logic (copy-pasted today, identical comments).
2. Extension points (must stay caller-side, keep the interface small): multi-id create
   (feedstock `flushMany`), post-flush hook (application's extra `invalidateQueries`;
   production-run's readings-CSV import loop).
3. Migrate the six call sites one commit each; behavior-identical.
4. Tests: hook unit tests for partial-failure/retry/clear paths; E2E smoke of one create-with-
   attachment flow (codex-computer-use) before PR.

Acceptance: no UX change; each list component loses its upload bookkeeping; a new entity screen
adopts the flow by calling one hook.

## Phase 3 — Bundled targeted fixes (one PR, three commits)

**Branch** `refactor/targeted-seam-fixes` · Three independent commits, one review round.

**3a — Production-run stock-lock containment.** Move the two direct `bin-stock-guards`
calls (`assertFeedstockDrawWithinStock` with caller-set `excludeRunId`/`binLockAlreadyHeld`,
`mutations.ts:312-315` and `:712-717`) and the inline "did biochar storage change" lane-derivation
trigger (`:620-639`) into `production-run-stock-locks.ts`, mirroring the four sibling wrappers.
After this, escape flags are set **only** inside `*-stock-locks.ts` files.

**3b — Wizard duplicate lineage walks.** In `certify-context-core.ts`
`loadSelectableBatchesForFacility` (:951-999): load lineage facts once for the batch set, pass
`lineageFactsByBatch` into `getCo2eStoredPreviews`, and thread the per-batch facts into the
`resolveScopeForCreditBatch` fan-out. Target: exactly one `loadCreditBatchLineageFacts` call per
wizard render (today: 2–3). Both files sit at the 1000-line cap — if the change pushes either
over, split first (`docs/organization.md`).

**3c — Production-run outcome rules, single source.** `schemas/production-runs.ts` hand-rolls
the outcome rules (cancellation-reason, dry-mass-balance, missing source bin) that
`assertProductionRunOutcome` also implements. Extract one pure decision function in
`lib/production-runs/lifecycle.ts` returning structured violations; schema `.superRefine` maps
them to field issues, `mutations.ts` maps them to `SafeError`. **Lifecycle stays pure** — no
ctx/tx/persistence (the review's "owns persistence" idea violates the layer rules; rejected).

Acceptance: behavior-identical; `pnpm lint`/`typecheck`/tests green per commit.

## Out of scope (explicit)

- Full credit-batch accounting collapse (review candidate 01) — mid-remediation, high churn.
- Unified bin-stock mutation seam (candidate 03 as written) — seam already exists; 3a closes
  the only real leak.
- Revisit both once the credit-batch area settles; the 1000-line cap will force the
  `credit-batches.ts`/`certify-context-core.ts` split and that is the natural moment.
