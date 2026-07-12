# Bounded edge-case follow-up after the 12-month Method A/B QA

Prepared and grilled on 2026-07-12. This is the implementation plan for the
next context; the evidence and full findings remain in
[`docs/archive/qa/2026-07-12-final-12-month-followup.md`](../archive/qa/2026-07-12-final-12-month-followup.md).

Status: Phase 1 implemented and verified on
`codex/fix-edge-qa-followups`; Phases 2 and 3 remain deferred as documented.

## Outcome

Land the small, well-understood edge-case fixes found by the reset-database QA
without broadening the uncertain 1000-year unsampled Method-B protocol work.
Keep all certification paths fail-closed and preserve the source-attachment
proof already completed for feedstock, delivery, sample COA, and sample-to-lab
transport evidence.

The next implementation context should complete only Phase 1. Phases 2 and 3
are separately bounded follow-ups, recorded here so the decisions are not lost.

## Starting point and branch safety

- Start from the current `origin/staging`. After fetching on 2026-07-12 it is
  `966e8a0` (`fix: close certification QA safety and evidence gaps (#432)`).
- PR #432 is merged. The present branch `codex/qa-12-month-methods` points to
  its pre-squash head `e4dee0c`; its committed tree is identical to
  `origin/staging`, but the histories differ. Preserve the uncommitted domain
  docs from this plan/grill and move them onto a fresh `codex/` branch based on
  current `origin/staging` before committing implementation work.
- Preserve `output/` as untracked QA output; do not commit it.
- Do not merge or cherry-pick the old branches wholesale:
  - `origin/codex/fix-1000-year-isometric`,
    `origin/codex/e2e-12-month-ghg-qa`,
    `origin/feat/org-scope-domain-data`, and
    `origin/feat/per-org-registry-credentials` contain work already represented
    in merged staging.
  - `fix/detail-route-facility-reconcile` contains useful not-found ideas but
    also a 509-line facility-reconciliation expansion. Inspect it only; make the
    narrow current-staging fix described below.
  - `feat/org-brand-header` is unrelated.

## Decisions already resolved

These are documented in `CONTEXT.md` and ADR 0017:

1. **Method regime is fixed at batch start.** A batch whose production period
   starts before the Method-B unlock remains Method A, even if it is still in
   progress at unlock. Only batches starting after `method_b_unlocked_at` use
   Method B.
2. **Ordinary corrections remain editable until claimed.** The ≥30 baseline
   floor still prevents deleting, moving, or redating evidence in a way that
   invalidates unlock, but unlocking Method B does not otherwise freeze its
   baseline. When any submitted Removal/GHG Entry uses a sample, that exact
   sample version is locked, including a borrowed historical sample whose own
   batch is still draft. Later changes require correction/supersession rather
   than an in-place edit.
3. **Process start is operational time.** `established_at` is the
   operator-entered date the production process actually began operating, not
   database-row creation time. Earlier samples never count toward the baseline
   or eligible pool.

## Phase 1 — implement now: small, straightforward fixes

### 1. Canonical not-found behavior for the three routed detail pages

Affected routes:

- `src/app/(app)/credit-batches/[id]/page.tsx`
- `src/app/(app)/suppliers/[supplierId]/page.tsx`
- `src/app/(app)/customers/[customerId]/page.tsx`

Implementation:

1. Reject malformed UUID route params with `notFound()` before issuing a DB
   query. A local Zod UUID `safeParse` in each server route is sufficient; do
   not introduce a general routing framework.
2. Keep the credit-batch server preflight and add equivalent supplier/customer
   preflights: obtain `requireOrgContext()`, call the existing organization-
   scoped nullable lookup, and call `notFound()` before mounting the client
   detail component when absent.
3. Render a designed, canonical `EmptyState`-based not-found screen with a
   useful link back to the relevant list. Use a tiny shared component only if it
   removes real duplication.
4. Treat a valid-but-missing ID and an ID owned by another organization the
   same: 404 with no existence leak.
5. Do not change global React Query retry behavior. The server preflight stops
   the supplier/customer client hooks from mounting in the missing-record case.

Regression coverage:

- Add `tests/e2e/detail-route-not-found.spec.ts`.
- For credit batches, suppliers, and customers, cover both a malformed
  `__missing__` path and a random valid UUID.
- Assert the canonical not-found copy/back link and absence of a generic error
  boundary. Prove that the route reaches Next's 404 boundary for malformed,
  absent, and foreign-organization IDs. Use the Playwright navigation response
  when reliable; otherwise make the status/boundary assertion in a focused
  route/server test. The 404 acceptance itself is not optional.
- Require deterministic cross-organization coverage: a detail ID owned by a
  second organization must produce the same canonical 404. Use the E2E fixture
  if practical; otherwise add a focused route/server test. Do not rely only on
  the random-missing case, and do not create a broad tenancy harness.

Issue relationship: this is the narrow not-found portion of open #253. Do not
absorb its facility-switch/toast and sheet-reconciliation scope.

### 2. Remove duplicate no-facility empty states

Affected components:

- `src/components/applications/application-list.tsx`
- `src/components/production-processes/production-process-list.tsx`

Implementation:

1. After the hooks are called, return the canonical `PageHeader` plus exactly
   one `SelectFacilityEmptyState` when no facility is selected.
2. Remove the no-facility branches from each `DataTable` empty-state prop; that
   empty state should describe only a selected facility with zero records.
3. Do not refactor `DataTable`. It intentionally has desktop/mobile render
   paths; the page-level facility gate is the correct seam.

Regression coverage:

- Add co-located component tests modeled on
  `src/components/reactors/reactor-list.test.tsx`.
- Assert exactly one select-facility message.
- Assert the create action, data table, and Method-B unlock controls are absent
  without a selected facility.
- Keep the selected-facility empty-record case distinct and unchanged.

### 3. Codify the current Method-B baseline-floor update behavior

Affected test:

- `tests/production-processes.test.ts`

Implementation:

1. Extend the existing Method-B fixture test through the public
   `updateSample` data-access path and import that function in the test.
2. The fixture's facility defaults to 1000-year durability, so first give each
   baseline sample valid 1000-year evidence: `randomReflectanceR0Percent`,
   `sReflectanceFraction`, and one accepted TGA carbon field
   (`reactiveCarbonPercent` or `residualCarbonPercent`). Otherwise the public
   update fails the durability-tier evidence guard before exercising the floor.
3. Move one of the 30 pre-unlock Method-A baseline samples to a named
   `POST_UNLOCK_SAMPLING_TIME` later than `METHOD_B_UNLOCKED_AT`. Assert the
   friendly "reduce the Method B baseline below 30" failure and prove both the
   sampling timestamp and the rest of the row were rolled back.
4. In a separate assertion/test, change ordinary draft evidence such as
   `labName` and a chemistry value while the sample has not been used by a
   submitted Removal. Assert the correction persists.
5. Production code is not expected to change: `updateSample` already uses
   `guardSampleMutation` and the DB baseline-floor trigger. If the regression
   exposes a narrow message/rollback bug, fix only that bug.

This test documents a **count floor**, not immutable history. Do not implement
the new submitted-dependency lock in Phase 1.

### 4. Keep the findings and domain docs accurate

- Update the QA ledger status for each Phase-1 item after verification.
- Do not introduce new domain decisions or ADR scope in Phase 1. Change
  `CONTEXT.md`, ADR 0017, or `docs/open-questions.md` only to correct a concrete
  contradiction found while implementing; use the QA ledger for routine status
  updates.
- Do not claim the 1000-year unsampled route, process-level cadence, temporal
  regime enforcement, or evidence-snapshot enforcement is fixed by these UI
  and regression changes.

## Phase 1 verification

Run targeted checks first:

1. Focused Vitest for the two list component specs and
   `tests/production-processes.test.ts`.
2. The new Chromium `detail-route-not-found.spec.ts`.
3. `pnpm typecheck`.
4. Targeted lint for touched files, then `pnpm lint` if the focused checks are
   clean.
5. `git diff --check` and a deliberate diff review against `origin/staging`.

Then do one reset-database computer-use pass:

1. Read `docs/testing.md`; run `pnpm db:reset` once.
2. Use the `codex-computer-use` skill to open each malformed/missing detail
   route and both no-facility lists.
3. Confirm no generic error boundary, no multi-second missing-record retry, one
   facility prompt per page, and intuitive back navigation.
4. No user login should be needed: local E2E auth uses the seeded authenticated
   fixture. Ask the user only if the local auth seed/session is unavailable.
5. Do not submit another registry Removal or repeat the 63-document upload run.
   The existing QA ledger and focused source tests remain the evidence for
   feedstock, delivery, COA, and sample-transport attachment coverage.

Phase 1 is done when all focused tests, computer-use checks, typecheck/lint, and
diff checks are green, and the findings ledger records the result honestly.

## Phase 2 — separate bounded certification follow-up, no external answer needed

Do not mix this with Phase 1. Open or sharpen dedicated issues before coding.

### A. Authoritative as-of method resolution

- Centralize a pure helper that resolves a credit batch's method from its
  production-period start and the process's `method_b_unlocked_at`.
- Replace reads of the process's current `sampling_method` in readiness,
  removal routing, and submission gates with that helper/fact.
- Cover before, exactly-at, and after-unlock boundaries plus an in-progress
  batch unlocked mid-period. The rule is strict: exact equality remains Method
  A because Method B applies only after unlock. Since batch start is stored as
  a date while unlock is a timestamp, use the repository's canonical date
  normalization and conservatively keep a same-calendar-day batch Method A
  when the stored precision cannot prove it began after unlock. Do not invent a
  facility-timezone conversion in this slice.
- Prefer deriving the regime from immutable timestamps. Add a per-batch column
  only if inspection proves derivation cannot be authoritative or efficient.

### B. Operational lower bound for Method-B evidence

- Apply `sampling_time >= production_processes.established_at` to the baseline
  counter and six-month eligible-pool query, alongside the existing upper
  as-of/unlock bounds.
- Test a back-entered historical process, a sample immediately before the
  operational start, and a sample exactly at the start.
- Decide the edit guard for `established_at` as part of this slice: after Method
  B unlock, changing it can alter qualification and should not silently rewrite
  the baseline.

### C. Submitted dependency lock for borrowed samples

- At unsampled Removal submission, record the contributing eligible sample
  versions as a `Method-B evidence snapshot`. Sample ID alone is insufficient.
  First define version identity from the shared audit version if available;
  otherwise use a canonical evidence-content hash plus the observed
  `updatedAt`, and document the chosen identity.
- Persist the snapshot atomically with the local submission claim before the
  remote side effect; failure to persist it must block submission. Reuse the
  existing submission-claim choreography and never hold a DB transaction open
  across registry HTTP calls.
- Extend the existing certification-lineage guard so an update/delete is
  blocked when any submitted Removal depends on that sample, not only when the
  sample's own credit batch belongs to a submitted artifact.
- Reuse the audit/lock event seam tracked by #200 and #391; do not build a
  parallel generic locking system.
- Keep unclaimed samples editable. Locking all 30 baseline samples at unlock is
  explicitly wrong.
- Corrections/supersession can be a separate workflow, but direct mutation of
  submitted evidence must fail with an actionable message.

## Phase 3 — held for Isometric/protocol answers

These remain fail-closed and should not be guessed:

1. **1000-year `_unsampled` registry contract.** Confirm whether and how the
   submission references/reuses historical eligible samples and which inputs
   the 1000-year unsampled blueprint expects. Do not require three fresh
   replicates for an intentionally unsampled batch, and do not submit a locally
   invented average. Reusing the trailing historical pool is the current
   product hypothesis, not a resolved registry contract.
2. **Process-level Method-B cadence.** The rule is process-history scoped, not
   Removal-member scoped. Settle whether the submission builder loads the
   authoritative batch window or consumes one explicit process cadence fact.
3. **Independent/distributed sampling.** Confirm whether same-day or
   weak-provenance rows are a hard exclusion or an operator warning.
4. **Protocol version pin.** Resolve open #278 and registry template migration
   from biochar 1.2 to 1.3 before encoding further credit-bearing rules.

Relevant open GitHub items verified on 2026-07-12:

- [#417](https://github.com/Maji-Studio/noma-dmrv/issues/417) covers the
  fail-closed empty eligible-pool gate, but not the complete 1000-year
  unsampled representation or cadence fix.
- [#278](https://github.com/Maji-Studio/noma-dmrv/issues/278) owns protocol
  1.2→1.3/template migration.
- [#200](https://github.com/Maji-Studio/noma-dmrv/issues/200) owns progressive
  MRV locking; the borrowed-sample dependency rule refines its event-driven
  lock scope.
- [#391](https://github.com/Maji-Studio/noma-dmrv/issues/391) owns the shared
  lock/unlock audit-event seam.
- [#253](https://github.com/Maji-Studio/noma-dmrv/issues/253) overlaps the
  Phase-1 not-found work; keep its wider facility reconciliation out of scope.

## Stop conditions

Stop and document rather than expanding the patch if:

- a Phase-1 fix requires a schema migration, broad data-table/query-policy
  refactor, or general progressive-lock framework;
- a proposed change weakens Method-A sample requirements or enables the live
  `_unsampled` POST;
- registry behavior cannot be verified without a new Isometric submission;
- an old branch conflicts materially with current staging.

Those are signs the work belongs in Phase 2/3, not reasons to enlarge Phase 1.
