# Handoff — Certification workspace E2E suite

## Focus for the next session

Write the **optional E2E suite** the remodel deferred (plan Verification §4):
**tab navigation · Settings round-trip · removal guided-Review happy path** for
the Certification (Isometric) workspace. Playwright, under `tests/e2e/`.

Read these first — this doc does not repeat them:
- **Remodel state + the just-resolved deferrals:** `docs/archive/2026-06-03-certification-remodel-stage5-handoff.md`
  (Stages 1–6 = the whole remodel, DONE & committed at `638391b`).
- **Plan (Verification §4 = the E2E scope):** `~/.claude/plans/i-d-like-to-remodel-scalable-moler.md`.
- **Domain truth:** `CONTEXT.md` + `docs/adr/0003`–`0007`. **Stack/rules:** `.claude/CLAUDE.md`.
- **E2E conventions in memory:** `memory/e2e-testing.md` (+ the E2E section of `MEMORY.md`).

Branch: `chore/refactor-certify-flow`. Today: 2026-06-04.

## Repo state — READ BEFORE COMMITTING

- Remodel (Stages 1–6) is **committed** (`638391b` and earlier). Branch is 177
  ahead of the merge-base; `main` is only 8 commits ahead (CI/migration plumbing,
  no feature conflict). **No PR yet.**
- **Uncommitted working tree** carries the 3 resolved post-remodel deferrals
  (this session). All verified green but **not committed** — see the changelog
  entry just written: `docs/isometric/changes.md` (top entry, 2026-06-04). In
  brief: `runSummary` on `RemovalCertifyContext` + Review-step table; linked-GHG
  -statement status on the bridge (`certify-panel.tsx`); orphaned
  `submitCreditBatchRemoval` deleted; new pure lib `src/lib/certification/run-summary.ts`
  + `tests/certification-run-summary.test.ts`. `pnpm typecheck` 0, eslint 0,
  `pnpm vitest run` 377 pass / 5 skip (48 files). The deferral entries were
  removed from `docs/open-questions.md`.
- **Decision pending for next session:** commit the deferral work first (its own
  commit), then add the E2E suite as a separate commit — or fold together. The
  E2E changes touch only `tests/e2e/` so they're cleanly separable.

## The E2E harness (how these tests actually run)

- Fixtures: `tests/e2e/fixtures/auth-fixtures.ts` → `adminPage`, `seededData`,
  `cleanupTestData`. Auth is **HTTP-API sign-in** (no UI login). Requires
  `DISABLE_RATE_LIMIT=true` in `.env.local` and an `Origin` header (already
  handled in the fixture). Global timeout 60s (first-page dev compile is slow).
- Seed: `tests/e2e/fixtures/seed-chain-data.ts` seeds 13 chain entities +
  helpers `seedCreditBatch(facilityId, runId)`, `createTestFacility`,
  `deleteTestFacility`. **The default seed does NOT create a `certifier_projects`
  mapping** — facilities start unlinked.
- Run: dev server on :3100 must be up; `pnpm test:e2e`. If duplicate-key errors,
  `pnpm db:reset` first.
- Side sheets are `[role="dialog"]`; closing one is the success signal.

## Certification workspace map (already explored)

Routes (`src/app/(app)/certification/`): `page.tsx` (Overview) ·
`removals/page.tsx` · `removals/[removalId]/page.tsx` ·
`removals/[removalId]/review/page.tsx` · `ghg-statements/page.tsx` ·
`settings/page.tsx`. Shell: `layout.tsx` renders
`@/components/certification/certification-tab-bar.tsx` (**read it for the exact
tab labels/hrefs** — that's the tab-nav target). Facility scoping is `?facility=<id>`.

Key surfaces for assertions: `ghg-statements-list.tsx` (`?statement=<id>` opens
the detail sheet), `removal-review/` (the guided StepFlow: Assemble → Review →
Pre-flight; `?step=` deep-links), `certify-panel.tsx` (the demoted bridge in the
credit-batch side sheet), Settings = `FacilityCertifierSection`.

## Per-scenario guidance + the load-bearing gotcha

**THE GOTCHA — Isometric creds gate the linked/Review states.**
`loadFacilityCertifierMapping` / `buildRemovalContext` always call `listProjects`
+ `listRemovalTemplates(externalProjectId)`. Without sandbox creds these return
`[]` (via `safeListIfConfigured`), so a linked facility / resolvable template
**cannot** be produced. The established pattern (copy it):
`tests/e2e/facility-certifier-mapping.spec.ts` —
  - `loadEnv({ path: ".env.local", override: false })` then
    `const SANDBOX_PROJECT_ID = process.env.ISOMETRIC_DEMO_PROJECT_ID;`
  - `test.skip(!SANDBOX_PROJECT_ID, "…")` so CI (no creds) skips cleanly.
  - **Pre-seed `certifier_projects` directly via Drizzle** (`createDbConnection`
    from `fixtures/db`) using the real sandbox `externalProjectId` + a default
    removal template id — do NOT drive the link dialog (that needs live API too).
  - **This machine HAS** `.env.local` with `ISOMETRIC_ACCESS_TOKEN`,
    `ISOMETRIC_CLIENT_SECRET`, `ISOMETRIC_DEMO_PROJECT_ID`, `ISOMETRIC_ENVIRONMENT`
    — so the live-sandbox path runs locally; it just skips on CI.

1. **Tab navigation** — NO creds needed. From `/certification?facility=<id>`,
   click each tab in `certification-tab-bar.tsx`, assert URL + a heading per tab
   (Overview / Removals / GHG Statements / Settings). Prefer `getByRole`.
2. **Settings round-trip** — needs the seeded mapping (gotcha above). Assert the
   Settings page renders the linked project + lets an admin change a setting
   (e.g. default template / emission config) and persists on reload. The
   mapping-creation + unlink-guard behaviour is ALREADY covered by
   `facility-certifier-mapping.spec.ts` — don't duplicate; focus on the
   tabbed-Settings surface (`FacilityCertifierSection`) round-trip.
3. **Removal Review happy path** — needs mapping + a credit batch grouped into a
   removal with submittable runs (`seedCreditBatch` + group it; the chain seed
   provides applications/runs). Drive `/certification/removals` → open the
   removal → its Review route; step Assemble → Review → Pre-flight and assert the
   Review step now shows the **run-summary table** (this session's `runSummary`:
   "Production runs / Biochar output / Applied") and transport coverage. Decide
   how far to push submit: a real submit writes to the Isometric sandbox — either
   stop at Pre-flight (assert ready/blocked state) or gate an actual submit behind
   the sandbox skip. Existing `tests/e2e/certification-submit.spec.ts` only covers
   the **not-linked** state and stays no-network — mirror its DB-assertion style.

## Suggested skills / process

- **`agentsystem-core:add-e2e-test`** — purpose-built for this; it detects the
  Playwright setup and inherits config/fixtures. Feed it this doc's scope.
- Verify the existing suite still passes after the deferral changes —
  `certification-submit.spec.ts` asserts the not-linked bridge has no "view in
  certification" link; this session's `certify-panel.tsx` edits only add the
  linked-statement row (renders only when grouped+linked), so it should be safe,
  but confirm.
- After writing: `pnpm test:e2e tests/e2e/<new>.spec.ts` (dev server up). Then
  `/code-review` before any PR.
