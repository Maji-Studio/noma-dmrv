# Data Integrity / Authorization QA Pass - 2026-06-14

Browser-based QA against local `http://localhost:3100` on branch
`fix/visual-improvements-details`, focused on data integrity, authorization, and unsafe
state transitions. I read `./.claude/CLAUDE.md` and `docs/security.md` first.

I used an authenticated app session and disposable records tagged `BQAf88ddd`. Actual
operator actions were performed through the browser UI; direct database setup was limited
to disposable fixture creation/cleanup. Notes use stable IDs/codes where practical.

## Existing Work / Not Duplicated

I treated the following as already covered by open issues or the active PR:

- PR #258: certification lineage guards, order customer/location guard, credit-batch
  facility canonicalization, action-error sanitization, and related E2E repair.
- #245: zero-removal GHG statement policy.
- #246: certification readiness badge semantics.
- #247: removal draft behavior when emission estimates are missing.
- #251: raw SQL/params leaking through server-action errors.
- #252: human-entered identifier/name uniqueness policy.
- #253: active-facility mismatch on detail routes.
- #254: production-run `Complete` precondition/state-machine decision.
- #255: slide-over drawer close/success lifecycle.
- #256: nested/duplicate action buttons in clickable table rows.

## Findings

Severity: P0 = critical security/data loss, P1 = high, P2 = medium, P3 = low.

### P2 - Duplicate production runs can be created for the same natural event

GitHub: #259

An operator can create multiple draft production runs with the same facility, reactor,
production date, and start time. Each row gets a distinct generated code, but the
operational event is otherwise identical.

Repro:

1. Open `/production-runs?facility=b9c1525d-9f18-46ca-8485-925abbbc5563`.
2. Click **New Production Run**.
3. Select reactor `E2E-RCT-BQAf88ddd`.
4. Set date `2026-06-14` and start time `08:00`.
5. Click **Create Production Run**.
6. Repeat steps 1-5 with the same facility, reactor, date, and start time.

Actual:

- Both creates succeeded.
- The list showed `PR-26-004` and `PR-26-005`, both draft rows for
  `E2E-RCT-BQAf88ddd` on `Jun 14, 2026`, each with `0` feedstock and incomplete
  certifier status.

Expected:

The product needs a decision on whether production-run creation should have a hard
natural-key uniqueness constraint, a soft duplicate warning, an idempotency key, or no
guard. Without a guard, accidental retries or two-session submits can double-represent
the same production event and later double-count into stock, chain-of-custody, credit
batches, and certification calculations.

### P2 - Production-run detail links point to a nonexistent route

Direct navigation to a real production-run ID returns the bare Next.js 404, with no app
chrome and no recovery path:

1. Create or identify production run `PR-26-004`
   (`cafb3b4e-fa3c-485d-b49f-c9724fcb86e2`).
2. Open `/production-runs/cafb3b4e-fa3c-485d-b49f-c9724fcb86e2?facility=b9c1525d-9f18-46ca-8485-925abbbc5563`.
3. Observe a bare **404 / This page could not be found** page.

This is not only a bogus-ID case. Source inspection shows in-app surfaces generate the
same nonexistent URL:

- `src/components/production-runs/production-run-list.tsx` row action:
  `Open details -> /production-runs/${id}`.
- `src/data-access/dashboard-overview.ts` record-check flags:
  `/production-runs/${id}?facility=...`.
- `src/data-access/dashboard-operations.ts` Now-panel production links:
  `/production-runs/${id}?facility=...`.

Expected:

Either add a real production-run detail route, or route these actions to the existing
list/sheet pattern, for example `/production-runs?facility=<id>&run=<id>`. The operator
should not be sent from a valid row/action to a bare framework 404.

## Passing Checks

- **Credit-batch wrong-facility detail URL canonicalizes.** Opening
  `/credit-batches/3a815678-ae37-4c3f-b689-299c9996b954?facility=b53bcfb0-abaa-4bd9-9292-f3614d573ffb`
  redirected to the credit batch's own facility:
  `?facility=b9c1525d-9f18-46ca-8485-925abbbc5563`, and rendered
  `E2E-CB-BQAf88ddd`.
- **GHG statements route blocks missing registry prerequisites.** Opening
  `/certification/ghg-statements?facility=b9c1525d-9f18-46ca-8485-925abbbc5563`
  for a facility with no Isometric project link redirected to
  `/certification/settings?...`, showed the missing-link message, and did not expose
  **New GHG Statement**.
- **Chain-of-custody clears a foreign batch query param.** Opening
  `/chain-of-custody?facility=b53bcfb0-abaa-4bd9-9292-f3614d573ffb&batch=3a815678-ae37-4c3f-b689-299c9996b954`
  removed the `batch=` parameter and showed the select-a-credit-batch empty state.
- **Stale dependency submit fails cleanly.** A production-run create form selected
  reactor `QA-RCT-STALE2-BQAf88ddd`; another browser page deleted that reactor through
  the UI; submitting the stale form kept the drawer open, showed `Reactor not found`,
  and did not leak SQL or provider internals.
- **Active facility switches after facility create.** Creating `QA Created Facility
  BQAf88ddd` rewrote `?facility=` to the new facility ID and the sidebar switched to the
  new facility, so immediate child-record creation is no longer scoped to the previous
  facility.

## GHG Scope Note

I did not create or submit a new external GHG statement during this pass. The disposable
facility correctly blocked GHG statement creation until a registry project is linked.
The remaining GHG policy questions encountered in this lane are already covered by #245
and PR #258's source-data immutability work.

## Follow-up QA - Parallel Edits / Stale State

Follow-up browser QA on 2026-06-14 focused on stale UI state, direct navigation, repeated
or interrupted actions, GHG surface regressions, and commit hygiene. Parallel edits landed
while this pass was running; unrelated staged/unstaged documentation changes and
`tests/e2e/_mobile-audit.spec.ts` were not touched.

### Fixed

- **Login pre-hydration credential leak.** The server-rendered login form had no
  `method`, so a submit before client hydration fell back to native `GET` and placed
  credentials in the URL query. Fixed by setting `method="post"` on `LoginForm`.
  Browser verification confirmed authenticated login on `localhost` reached
  `/dashboard?...` with no `email` or `password` query params.
- **Production-run detail links no longer 404.** Row actions and dashboard production
  links now use `/production-runs?facility=<id>&run=<id>`. The legacy
  `/production-runs/<id>` route redirects into that URL shape.
- **Production-run stale direct links recover safely.** The list opens `?run=<id>` in
  the existing side sheet, preserves it across refresh, supports view -> edit -> back to
  view, clears it on close, and clears invalid or wrong-facility IDs with a single toast
  instead of a bare 404 or error boundary.
- **Archived production runs are hidden from direct detail fetches.** `getProductionRunById`
  now matches list semantics by excluding archived rows.

### Browser Checks

- Legacy URL `/production-runs/ea8a663a-de78-42a1-b612-51c5397782b2?facility=170b41a0-75c6-4d24-9be9-62dd27b53bdd`
  redirected to `/production-runs?facility=170b41a0-75c6-4d24-9be9-62dd27b53bdd&run=ea8a663a-de78-42a1-b612-51c5397782b2`
  and opened side-sheet `PR-26-003`.
- Refresh preserved the `PR-26-003` side sheet; **Edit Production Run** opened edit mode;
  **Back to view** returned to read-only mode.
- Closing the side sheet removed `run=` from the URL.
- A wrong-facility link cleared `run=` and showed `Linked production run is not in the
  selected facility` without an error boundary.
- A missing-run link cleared `run=` and showed `Linked production run could not be
  opened` once, without retry/toast loops.
- `/certification/ghg-statements?facility=f346545f-ac5e-4642-95f1-9110458012f1`
  loaded without an error; **New GHG Statement** opened the wizard and **Cancel** closed
  it. No external GHG statement was created or submitted.

### Deferred / Not Reopened

- Duplicate production-run natural-key policy remains a product/domain decision tracked
  in #259.
- Full external GHG generation after source data is edited/deleted/incomplete was not
  repeated in this follow-up because it would create/submit registry artifacts. The
  source-data immutability lane remains covered by PR #258 and the existing GHG policy
  issues (#245-#247).
- Existing lint warnings from React Compiler/RHF/TanStack patterns remain outside this
  pass; no new lint errors were introduced.

### Verification

- `pnpm test tests/production-run-feedstock-type-gate.test.ts`
- `pnpm test tests/production-run-feedstock-type-gate.test.ts tests/applications-schema.test.ts tests/applications-mutations.test.ts`
- `pnpm typecheck`
- `pnpm lint` (passes with the existing 20 warnings)
- Browser verification on local `http://localhost:3100` for login, production-run direct
  links/stale links, and the GHG statement create surface.

## Test Residue

Disposable records were created under tag `BQAf88ddd`, including:

- facility `E2E-FAC-BQAf88ddd`
- second facility `QA-FAC-OTHER-BQAf88ddd`
- credit batch `E2E-CB-BQAf88ddd`
- production runs `PR-26-004` and `PR-26-005`
- facility `QA Created Facility BQAf88ddd`

Cleanup completed after the pass. Verification found no remaining facilities, reactors,
or auth user rows tagged `BQAf88ddd`; the duplicate production runs were removed with
the seeded facility cleanup.
