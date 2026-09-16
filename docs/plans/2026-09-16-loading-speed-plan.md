# Loading speed plan (2026-09-16)

- **Owner**: Kenji Nguyen
- **Status**: in progress. Phase 0 and Phase 1 step 1 done 2026-09-16; database moving to DigitalOcean before Phase 2
- **Last reviewed**: 2026-09-16

Staging pages sit on a skeleton for 11 s warm and 20 s cold. The measured cause is
round-trip count multiplied by cross-region latency, not bundle size or rendering.
This plan finishes the three open performance PRs, then lands the changes that remove
the round trips, in an order where every step is measurable on its own.

## Evidence

Measured on staging on 2026-09-16 with browser resource timing, two runs.

| Phase | Cold (Neon idle) | Warm |
| --- | --- | --- |
| HTML document streamed | 7.9 s | 1.3 s |
| First server action starts | 8.1 s | 1.4 s |
| Last of 8 sequential startup actions finishes | 20.7 s | 11.5 s |
| Dashboard overview action alone | 4.1 s | 4.1 to 5.6 s |

- `x-vercel-id: fra1::iad1` on every response: the function runs in Washington, Neon
  is in Frankfurt. One round trip is roughly 90 to 100 ms.
- `DB_POOL_MAX` defaults to 1 (`src/db/index.ts`), so every `Promise.all` fan-out is
  serialized onto one connection.
- `getDashboardOverview` issues 33 queries with zero credit batches on the facility
  (measured locally with a `pg.Client.query` counter, 58 ms local). Each credit batch
  adds lineage queries. `getOnboardingStatus` issues 8.
- `requireOrgContext` (`src/lib/auth/server.ts`) runs two sequential queries per server
  action (users, members). The user role is already on the cookie-cached session.
  Nothing is deduplicated with React `cache()`.
- The `(app)` layout runs four sequential queries before HTML streams: session user,
  user role, membership, organization defaults.
- The Next client dispatches server actions one at a time, so the shell's eight startup
  reads queue behind each other.
- Neon scale-to-zero after five minutes added roughly 10 s to the cold run.
- No `loading.tsx` exists under `src/app`, so nothing streams before data.
- Hovering the sidebar fired about 60 RSC prefetches at 250 ms each, one per link.

## After Phase 1 (measured 2026-09-16, warm, signed in, staging on DigitalOcean Frankfurt + fra1)

Three hard reloads of the Dashboard with the resource-timing snippet below.
The dashboard now dispatches 10 to 11 startup fetches (the #763 read endpoints
run in parallel with the remaining Server Actions).

| Phase | Run 1 | Run 2 | Run 3 | Baseline (warm) |
| --- | --- | --- | --- | --- |
| HTML document streamed | 0.93 s | 0.34 s | 0.51 s | 1.3 s |
| First startup fetch starts | 1.09 s | 0.38 s | 0.62 s | 1.4 s |
| Last startup fetch finishes | 1.77 s | 1.09 s | 1.63 s | 11.5 s |
| Longest single fetch | 0.26 s | 0.21 s | 0.44 s | 4.1 to 5.6 s |

The longest fetch is now the dashboard overview action at 0.2 to 0.45 s, down
from 4.1 to 5.6 s. Cold start was not measured: DigitalOcean does not scale to
zero. Phases 2 to 4 are still worth doing, but each is now a sub-second win and
should be re-prioritised against the query budget in Phase 3.

## Measurement protocol

Use this before and after every step. Single samples do not rank changes.

1. Open the staging dashboard signed in, hard reload, wait for the KPI tiles.
2. In the console run
   `performance.getEntriesByType('resource').filter(r => r.initiatorType === 'fetch').map(r => [Math.round(r.startTime), Math.round(r.duration), r.name])`
   and record document `responseEnd`, first action start, last action end, and the
   longest single action.
3. Repeat three times warm. Record one cold run only when the step targets cold start.
4. Read `x-vercel-id` on the document response to confirm the function region.
5. Keep `DB_POOL_TELEMETRY` (PR #762) on only during the measurement window.

## Phase 0: finish the open PRs

Done 2026-09-16: #762, #761, #763 merged in that order after two review-suite
rounds each. The #763 read cores live in `src/lib/read-models/`, not `fn/`.
Follow-up: issue #765 (customer side sheet loading state).

Merge order stays #762, then #761, then #763. All six merge permutations produced the
same tree, so the order is operational, not textual.

### PR #762 (pool lifecycle) — revise, review once, merge

- Move the DB-layer logger call to the documented boundary or add a written waiver.
- Point the pool documentation at `src/db/index.ts` and `src/lib/pg-pool-config.ts`.
- Split rollout constants from permanent limits: permanent limits stay in code with
  defaults, the experiment ladder moves to the rollout section of `docs/database.md`.
- Sync with `staging`, rerun the review suite on the new head (two rounds maximum,
  see the review cutoff rule), merge on green CI.
- Do not raise `DB_POOL_MAX` above 1 in this PR. That happens in Phase 3 after the
  connection budget is known.

### PR #761 (detail hydration) — revise, retest, merge

- Fix Supplier Location showing "Not recorded" while locations load. Use the
  `DetailField` empty-situation contract from issue #689; loading is not absence.
- Add a focused test for the loading state.
- After #762 merges, rebase, deploy the preview, repeat supplier and customer
  navigation plus hard reload, and confirm zero duplicate detail POST reads.

### PR #763 (parallel authenticated reads) — revise, retest, merge last

- Null dates must stay null. Remove the coercion to 1970 in the client rehydration.
- Handle non-JSON gateway responses: check `content-type` before parsing, surface a
  transport error, never classify a downstream `SyntaxError` as bad input.
- Move the PR's new read-model module (under `fn/`) to the layer the architecture doc allows. Route handlers
  call `fn/`, `fn/` calls `data-access/`. If a transport-neutral seam is needed it
  lives in `fn/` and is documented in `docs/architecture.md`, not beside it.
- Add route-level tests for each of the five endpoints: 200 shape, 401 signed out,
  403 wrong org, 400 bad params.
- Replace the browser-only concurrency E2E with a server-side barrier test, or state
  in the PR that concurrency is proven only at the browser dispatch layer.
- Rebase after #762, then require a healthy Dashboard and a 200 from
  `/api/reads/credit-batches` on the preview before merging.

Post-merge gate for the combined tree: green CI, healthy staging Dashboard, supplier
and customer reloads without duplicate reads, every new read endpoint returning JSON,
signed-out 401 or 403, a write completing during a server-held read, and no
connection-exhaustion or lock-timeout spike in telemetry.

## Phase 1: infrastructure, no code

These are Vercel and Neon settings. Record the before and after measurement.

1. **Move the Vercel function region to fra1.** Done in #789 via `vercel.json`;
   staging now answers with `x-vercel-id: fra1::…`. Confirm with `x-vercel-id` reading
   `fra1::fra1`. Expected: every round trip drops from about 100 ms to single digits,
   the document time falls below 400 ms, and the overview action falls below 1 s.
2. **Neon scale-to-zero: void.** The Neon project is on the Free plan, where the
   five-minute suspend cannot be changed, and the database is moving to
   DigitalOcean Managed Postgres before Phase 2. Place the cluster in Frankfurt,
   and point `DATABASE_URL` at the direct port or a session-mode pool, never a
   transaction-mode PgBouncer pool (session advisory locks). Original text kept
   for the record: suspend it only for the measurement window. Turn the
   suspend timeout off (or set the minimum compute) while Phases 1 through 3 are being
   measured, so cold-start noise does not mask the code changes. Restore the
   five-minute suspend once Phase 3 is measured. It is not a permanent fix and must
   not become one; note the restore date in `docs/open-questions.md` if it slips.
3. Confirm `DATABASE_URL` has session semantics (direct host, or session-mode
   pool) while session-scoped advisory locks remain in use (PR #762 documents
   why). Re-check after the DigitalOcean cutover.

## Phase 2: per-request auth cost (one PR)

Branch `fix/request-scoped-org-context`. Touches `src/lib/auth/server.ts`,
`src/lib/auth/providers/better-auth-server.ts`, `src/app/(app)/layout.tsx`.

1. Wrap `getBetterAuthSession` in React `cache()` so one request reads the session
   once across proxy, layout, and action.
2. In `getOrgContext`, read `isPlatformAdmin` from `session.user.role` (the
   `additionalFields.role` surfaced in `src/lib/auth/better-auth.ts`) instead of a
   users query. Keep the membership query, wrap `getOrgContext` in `cache()`.
3. In `getUser`, return the session user for the common path. Keep the users query
   only where fresh `emailVerified` is required (`requireVerifiedAuth`), or document
   why the cookie-cached value (5 minutes) is acceptable there too.
4. In the `(app)` layout, run `getOrgContext` and `getOrganizationDefaults` so that
   the defaults query starts as soon as the org id is known and nothing else waits on
   it. The layout should issue at most two round trips.
5. Tests: `tests/with-action.test.ts` and the auth server tests cover the dedupe (one
   session read per request) and the role source. Add a test that a Platform Admin
   without a membership row still gets a context.

Expected: two fewer round trips per server action, two fewer in the layout. With
Phase 1 done this is worth about 20 ms per action; without it, about 200 ms.

## Phase 3: dashboard overview fan-out (one PR)

Branch `refactor/dashboard-overview-query-budget`. Touches
`src/data-access/dashboard-overview.ts`, `dashboard-stations.ts`,
`dashboard-structural-gaps.ts`, `credit-batch-accounting.ts`.

1. Add a query-count test using the local counter pattern (patch
   `pg.Client.prototype.query`, count per call) with a fixture facility that has at
   least three credit batches. Assert the current count first so the refactor is
   measured, then lower the assertion as steps land.
2. Collapse the count-style queries in `dashboard-attention.ts` and
   `dashboard-structural-gaps.ts` into one statement each using conditional
   aggregates (`count(*) filter (where ...)`).
3. Collapse the station queries in `dashboard-stations.ts`: group by station in SQL
   instead of one select per station.
4. Make `getCo2eStoredPreviews` set-based for the dashboard path: one lineage query
   for all batch ids, no per-batch transaction. Keep the existing per-batch path for
   the credit-batch detail page until the set-based version is proven equal on the
   same fixture.
5. Move `getCo2eStoredPreviews` into the initial `Promise.all` once it no longer
   depends on `batchRows`, or fetch batch ids inside it.
6. Target: at most 8 queries for the overview with any number of batches, and at most
   3 for onboarding status.
7. After merge, raise `DB_POOL_MAX` to 3 on staging using the #762 ladder and
   telemetry, then decide on 5 from the checkout-queue metric, not from latency.

## Phase 4: shell streaming and prefetch (one PR)

Branch `fix/app-shell-streaming`. Adds a `loading.tsx` under the `(app)` route group and
touches `src/components/navigation/sidebar-content.tsx`.

1. Add a `loading.tsx` in the `(app)` route group rendering the sidebar frame and a page-level
   skeleton that follows `docs/design-system.md` (no bare text, tokens only).
2. Set `prefetch={false}` on sidebar `Link`s, or keep prefetch only for the three
   most-used destinations. Measure the prefetch burst before and after by counting
   `_rsc` requests after hovering the rail.
3. Confirm with `performance.getEntriesByType('navigation')` that
   `domContentLoaded` no longer waits on the layout queries.

## Phase 5: remaining startup actions (only if still needed)

After Phases 1 through 4, re-measure the eight startup actions. If the shell still
queues more than three sequential actions, extend the #763 read transport to the
remaining ones (org profile, onboarding status, organization list) following the
boundary agreed in Phase 0. Do not start this phase before the measurement.

## Sequence and handoff

1. Phase 0 PRs in order, each merged before the next rebases.
2. Phase 1 settings, measured.
3. Phase 2 PR, measured.
4. Phase 3 PR, measured, then pool ladder.
5. Phase 4 PR, measured.
6. Restore Neon scale-to-zero. Re-measure cold once and record it here.
7. Phase 5 decision.

Each PR: feature branch off `staging`, `pnpm lint`, `pnpm typecheck`, focused Vitest,
`pnpm check:org-scoping`, `pnpm docs:check`, review suite capped at two rounds, merge
on green CI. Every PR description carries the before and after numbers from the
measurement protocol.

## Open questions

- Is a 5-minute cookie-cached `emailVerified` acceptable for `requireVerifiedAuth`, or
  does that path keep its users query? Owner decision, affects Phase 2 step 3.
- Does the set-based CO2e preview replace the per-batch path everywhere, or only on
  the dashboard? Decide after the equality fixture in Phase 3 step 4.
