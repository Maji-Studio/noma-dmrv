# Testing

Two test layers: **Vitest** specs in both root `tests/` and colocated
`src/**/*.test.{ts,tsx}` (`pnpm test`), plus **Playwright** E2E in `tests/e2e/`
(`pnpm test:e2e`). Read this before writing either — it carries the naming
contract, env layout, and safety guards that are invisible from the spec files
themselves. Related: [security.md](./security.md) (env inventory),
[database.md](./database.md), [troubleshooting.md](./troubleshooting.md),
[isometric/README.md](./isometric/README.md).

## Which runner picks up which file

`vitest.config.ts` uses Vitest's normal discovery and excludes `**/e2e/**`,
`**/tests/visual/**` and copied `.claude/worktrees/**`. `playwright.config.ts`
collects only `tests/e2e/`; `playwright.visual.config.ts` collects only
`tests/visual/`. A Playwright spec outside those two folders, or a Vitest spec
inside them, is **silently never run**. Put it in the right directory.

- `pnpm test` — Vitest, both `tests/**/*.test.{ts,tsx}` and colocated
  `src/**/*.test.{ts,tsx}`. Put cross-module/database contracts in `tests/`;
  put pure module, component, schema, hook, and route-handler tests beside the
  implementation when locality helps (for example
  `src/lib/geojson/normalize.test.ts` and
  `src/app/api/ghg-statement-reports/[reportId]/route.test.ts`).
- `pnpm test:integration` — `RUN_ISOMETRIC_SANDBOX_TESTS=1` plus the substring
  filter `.integration.test.ts`, which selects every `*.integration.test.ts`
  spec wherever it lives, including database suites. Provision their dependencies
  before running it: external integration tests do not universally self-skip.
  The Isometric suite fails closed if explicitly opted in without complete sandbox
  configuration; telemetry writes are enabled when its facility ID is also set.
- `pnpm test:isometric-health` — opts into only
  `tests/isometric-sandbox-health.integration.test.ts`, the read-only sandbox
  checks. Write paths live in `tests/isometric-sandbox.integration.test.ts`,
  which this command never collects; add a registry write there, never to the
  health file. Both share `tests/helpers/isometric-sandbox-env.ts`. Requires sandbox credentials
  (`ISOMETRIC_CLIENT_SECRET`, `ISOMETRIC_ACCESS_TOKEN`),
  `ISOMETRIC_ENVIRONMENT=sandbox`, and `ISOMETRIC_DEMO_PROJECT_ID`. No DB required.
- `pnpm test:e2e` — Playwright. CI gate in `e2e.yml`; nightly `@live` in `e2e-live.yml`.
- `pnpm exec playwright test -c playwright.visual.config.ts` — the opt-in form
  capture harness in `tests/visual/` (skipped unless `FORM_CAPTURE=1`; Vitest
  excludes the folder). It needs a running, seeded dev server and does not use
  the E2E user fixtures: it signs in as the existing local admin
  (`ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.local`, overridable with
  `FORM_CAPTURE_EMAIL` / `FORM_CAPTURE_PASSWORD`), which creates one session
  row that sign-out deletes, and writes no entity rows. The other
  `FORM_CAPTURE_*` knobs (label, output dir, family, surfaces, viewports,
  facility) and the output are documented at the top of
  `tests/visual/form-capture.spec.ts`. `tests/visual/site-capture.spec.ts`
  (`SITE_CAPTURE=1`) does the same for the marketing site's pages, with no sign-in.

## vitest specs are not all unit tests

Many root specs require a **running Postgres** (facilities-durability-guard,
credit-batch-validation, sample-code-unique, production-claim-write,
registry-boundary-\*). Colocation does not imply purity; read the test setup and
imports. `tests/setup.ts` applies to every Vitest spec, loads `.env.test`, and
defaults `DATABASE_URL`. Without `pnpm docker:up` database-backed specs fail
with a raw connection error that looks nothing like "you forgot the database".
CI prepares the schema before `vitest run` for exactly this reason.

### Vitest only runs against a throwaway database

Some root suites truncate organizations. `tests/setup.ts` therefore refuses to
start unless the effective database is on localhost, its name has a `test`
or `e2e` segment, and no `host`/`database` query parameter overrides the URL (`noma_dmrv_test`, `noma_dmrv_wt_<worktree>_test`); the rule
lives in `tests/helpers/throwaway-database.ts`. `noma_dmrv_dev` is always
refused.

Vitest reads `TEST_DATABASE_URL` before `DATABASE_URL`. Keep both in
`.env.test`: Playwright reads only `DATABASE_URL`, which must stay the database
of the dev server its fixtures seed. One-time local setup:

```bash
docker exec noma-dmrv-postgres psql -U postgres -c "CREATE DATABASE noma_dmrv_test"
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/noma_dmrv_test pnpm db:migrate
echo "TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/noma_dmrv_test" >> .env.test
```

Re-run the migrate line after pulling new migrations. A worktree made with
`scripts/worktree.sh` gets its own test database.

## Agent evaluation

`pnpm eval:mcp` runs two feedstock intake requests through headless Claude Code
and the local MCP server. It needs Docker with the test database schema ready,
the worktree's `.env.test`, and a logged-in Claude Code subscription. It refuses
non-test databases, creates a fresh organization and API key per case, and scores
the stored rows, bin stock, audit transport and tool-call count. Case 2 follows
the published schema: ask for moisture when required, otherwise log without it.

This is a local check before merge, not a CI gate. Paste its Markdown table into
the PR. Transcripts, the dev server log, Markdown and JSON scores are saved in
the printed temporary run directory with keys redacted. Fixture organizations
are removed on exit; `pnpm eval:mcp --keep` retains them and prints their ids.
`EVAL_MCP_MODEL` selects a model. Port, timeouts, budget and Claude flags live in
`scripts/eval-mcp/config.ts`.

## API schema fuzzing

`pnpm api:fuzz` runs Schemathesis 4.29.3 against every operation in the freshly
generated v1 OpenAPI document. It runs examples, coverage, fuzzing (25 examples
per operation), and inferred stateful links (10 scenarios, at most 5 steps).
[API fuzz CI](../.github/workflows/api-fuzz.yml) runs on PRs touching
`src/lib/api/**`, `src/app/api/**`, `openapi/**`, or the harness files. It uses
CI Postgres and `pnpm build` plus `pnpm start`, limits the fuzz step to five
minutes, and uploads `api-fuzz-report/junit.xml` even after test failures.

Locally, install `uv` and prepare an empty, migrated local database whose name
contains a `test` or `e2e` segment. Export `DATABASE_URL` and the app environment
before seeding; the seed does not load env files. Use the workflow's hermetic
env block for production-build parity. The seed creates a verified Owner, the
intake prerequisites, and a key with all current scopes, including delete.
Its private JSON file contains the key and fixture ids; never upload that file.

```bash
fixture_dir=$(mktemp -d)
pnpm tsx scripts/api-fuzz/seed.ts "$fixture_dir/fixture.json"
export API_FUZZ_KEY=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).key' "$fixture_dir/fixture.json")
# Build and start the app separately with the same DATABASE_URL and auth secret.
API_FUZZ_BASE_URL=http://127.0.0.1:3100/api/v1 pnpm api:fuzz
```

Fuzzing writes and deletes data, so use only a throwaway fixture organization.
For a production bundle, `API_FUZZ_DISABLE_RATE_LIMIT=true` bypasses only API
token buckets and is refused unless `CI=true` (or `1`),
`NOMA_HERMETIC_CI=true`, and `NEXT_PUBLIC_APP_URL` is an HTTP(S) loopback URL.
Authentication, scopes, and the write kill switch still apply. Keep this flag
out of deployment environments.

Reproduce a run with the same Schemathesis version, generated schema, and
starting fixture state: `pnpm api:fuzz --seed 20261009` (the checked-in seed).
Set `API_FUZZ_BASE_URL` and `API_FUZZ_KEY` as above. The JUnit failure and terminal
output include a minimized request; replace its sanitized bearer header with
the private fixture key to replay it. After mutations, restore the starting
throwaway fixture state before comparing runs. Fresh fixtures have new ids,
so rebind ids in a saved request when using a new seed fixture.

## Worktrees

Parallel sessions each work in their own worktree, one writer per worktree.
`scripts/worktree.sh` sets one up so it shares nothing with the main checkout:

```bash
scripts/worktree.sh new <name> <type/branch>   # .claude/worktrees/<name>, cut from origin/staging
scripts/worktree.sh status                      # owners, ports, servers, PR state, unmanaged leftovers
scripts/worktree.sh teardown <name>             # only what `new` recorded for <name>
```

`new` creates `noma_dmrv_wt_<name>_dev` (dev server and Playwright fixtures) and
`noma_dmrv_wt_<name>_test` (Vitest), refuses names with a `test`, `e2e` or `dev`
segment, claims a free port from 3101, writes both into
copies of `.env.local` and `.env.test`, installs, resets the dev DB and migrates
the test DB. It cuts the branch with `--no-track`, so a bare `git push` never
targets `staging`. It does not seed; run `pnpm db:seed` there if you need data.

- Start the dev server with the one-line command `new` prints, in your own
  terminal: background commands from an agent stop after two hours. Don't use
  `pnpm dev` in a worktree; it runs `docker compose up` and binds :3100. When
  pasting into zsh, drop the `!` that the Claude Code prompt uses for shell
  commands: a leading `!` in zsh is history expansion or negation.
- Playwright reads the worktree's `NEXT_PUBLIC_APP_URL`, so it reuses or starts
  the worktree's own server.
- `teardown` runs from outside the worktree and refuses while it has uncommitted
  changes. A worktree another session (or you, from a terminal) created needs
  `--force`, after checking with its owner. It stops only processes running
  inside the worktree, drops only databases `new` recorded as created, and
  deletes the branch only if it is merged.
- `status` lists worktrees and `noma_dmrv_*` databases the script did not
  create. Another session may own them: ask before removing anything.

## E2E data naming is a hard contract

`tests/e2e/global-teardown.ts` sweeps **by prefix only**. Anything a spec creates outside
these patterns leaks into the dev database forever and resurfaces later as a duplicate-key
failure:

| column           | required prefix                          |
| ---------------- | ---------------------------------------- |
| `code`           | `E2E-…`                                  |
| `name`           | `E2E …` / `UI …` / `Chain …`             |
| user `id`        | `e2e-…`                                  |
| user `email`     | `…@e2e.local`                            |
| project `name`   | `E2E Test Project…`                      |

Never name a fixture entity `Test Facility 1`. Check `global-teardown.ts` before adding a
spec that creates a table it doesn't yet sweep.

## Safety guards (don't "fix" them)

- `playwright.config.ts` **throws** unless `NEXT_PUBLIC_APP_URL` resolves to
  localhost/127.0.0.1 — deliberate, so E2E can never point at staging or production.
- `global-teardown.ts` aborts against any DB that is not on a local host (the shared
  `isLocalDatabaseHost` in `tests/helpers/throwaway-database.ts`). Locally
  it sweeps the dev DB the server uses, by prefix only. It defaults `DATABASE_URL` to
  `…/app_template_test`, so a misconfigured run tears down the *wrong DB name* rather than
  erroring — set `DATABASE_URL` explicitly.
- `tests/setup.ts` refuses any Vitest database that is not a local throwaway (above).

## Environment

`playwright.config.ts` loads **`.env.test` only, never `.env.local`** — Playwright-side
vars belong in `.env.test`. `.env.test` is untracked; a worktree made with
`scripts/worktree.sh` gets both files (see [Worktrees](#worktrees)).

- `DISABLE_RATE_LIMIT=true` is an **app-server** var (read by `src/lib/auth/better-auth.ts`),
  so locally it lives in `.env.local` where `pnpm dev:manual` sees it; CI sets it as a
  workflow env. See [security.md](./security.md).
- `GEO_PROVIDER=stub` is an **app-server** var too (read via `src/config/env.ts` by
  `src/lib/geo/index.ts`). It is in `.env.test`, but **`.env.test` only reaches
  the server when Playwright spawns the `webServer` itself**.
  `reuseExistingServer` adopts a hand-started `pnpm dev`, which reads
  `.env.local`; set `GEO_PROVIDER=stub` there for fixture-based geo assertions,
  or start the manual server as:

  ```bash
  DISABLE_RATE_LIMIT=true GEO_PROVIDER=stub pnpm dev
  ```

  Without the stub, geo uses OpenRouteService when configured or is disabled
  when no ORS key exists, so the fixture-exact assertions in
  `position-picker.spec.ts` fail. CI sets the provider in the workflow. See
  [adr/0009-provider-agnostic-server-proxied-geo.md](./adr/0009-provider-agnostic-server-proxied-geo.md).

## Fixtures and conventions

Fixture set: `tests/e2e/fixtures/auth-fixtures.ts` (typed `AuthFixtures` — role-scoped
pages and contexts for admin/operator/labTechnician/viewer, plus `seededData`,
`seedTestData`, `cleanupTestData`). Import barrel: `tests/e2e/fixtures/index.ts`.

- **Always import `test`/`expect` from `./fixtures`**, never from `@playwright/test` —
  otherwise none of the auth fixtures exist and you get `adminPage is not defined`.
- Auth goes over the **HTTP API**, not UI login (worker-scoped storage states via
  `createSignedAuthStorageState`); the sign-in request must send an `Origin` header or
  Better Auth's `trustedOrigins` check rejects it.
- `seed-chain-data.ts` seeds the prerequisite chain (shared across specs);
  `full-chain-ui.spec.ts` builds the core entities through the UI in one session.
- Use `selectEntity()` / `selectFirstEntity()` from `page-helpers.ts` for EntitySelect —
  the trigger `data-testid` is not per-field and these do the xpath-ancestor scoping for
  you. Don't hand-roll the locator.

## Parallelism

`fullyParallel: false` serializes tests only within a single file. Locally,
`workers` is unset (Playwright's default); CI runs **4 shards × 2 workers with 1
retry**. Specs must not assume ordering across files, workers, or shards.

## Gotchas

- `playwright.config.ts` starts or reuses the app on the port in `NEXT_PUBLIC_APP_URL`
  (:3100 in the main checkout) — don't pre-launch a second one.
- Local runs use dev mode, where first-hit Turbopack compilation is legitimately slow; the
  generous per-test timeout absorbs it. Don't shorten it to "catch hangs".
- Duplicate-key errors → check your naming (above) first. To reset, name the target:
  `pnpm db:reset` wipes whatever `DATABASE_URL` in `.env.local` points at, which in the
  main checkout is the live dev database. For a Vitest-only problem reset the test DB instead:
  `DATABASE_URL=<TEST_DATABASE_URL> pnpm db:reset`.
- A side sheet is `[role="dialog"]`; assert on the sheet **closing** as the success signal.
- A DataTable `<tr>` becomes `role="button"` when `onRowClick` is set — select with
  `getByRole("button")`, not `getByRole("row")`.
- **Wait for hydration before touching a control on a server-rendered form.** Forms are
  server-rendered, so the inputs exist in the HTML before React attaches to them, and
  react-hook-form only records a value once its `onChange` listener is live. A `fill()` or
  `selectOption()` that lands in that window is visible in the DOM but absent from form
  state, so submitting stores the *old* value — and the success toast still fires, so the
  spec fails somewhere later with no hint of the cause. Element visibility is not a
  hydration signal. Gate on something only the hydrated client can render; the usual choice
  is the sidebar facility name, which `FacilityProvider` resolves client-side:
  ```ts
  await expect(
    page.locator("aside").getByText(seededData.facility.name, { exact: false }),
  ).toBeVisible();
  ```
  A form that sits behind a loading skeleton until a query resolves hides this by accident.
  Do not rely on that — a later change that seeds the query (server-side `initialData`, say)
  removes the skeleton and the spec starts failing for reasons that look unrelated.

## `@live` split (Isometric sandbox)

Tagging is Playwright's describe option — `test.describe("…", { tag: "@live" }, …)`. A
comment-only `// @live` marker will **not** be excluded by `--grep-invert`.

- PR CI runs `--grep-invert "@live"` so it stays hermetic; `e2e-live.yml` runs the tagged
  specs nightly against the sandbox.
- `@live` specs load `.env.local` by hand (see `certification-workspace.spec.ts`,
  `facility-certifier-mapping.spec.ts`) to pick up `ISOMETRIC_DEMO_PROJECT_ID` without
  duplicating it into `.env.test`. This is the usual cause of a failing local `@live` run.
- **Convention:** whenever a live half exists, keep a hermetic UI+DB counterpart in PR CI
  (`durability-readiness.spec.ts` documents itself as deliberately not `@live`).
  Don't push all new certification coverage behind the nightly.

## Isometric health workflow

`isometric-health.yml` runs API read health, live template input coverage via
`pnpm isometric:coverage-check -- --source=fixture`, and public OpenAPI drift
independently after setup. Fixture source selects local project/template IDs and
sandbox period-input exceptions; it still fetches live templates. It does not
check Project Components. OpenAPI checking does not require sandbox credentials
and still runs if credential loading or another health check fails. The coverage
step supplies inert app-environment placeholders because the shared client/logger
validate those settings at import time; it never connects to that database or
starts an authentication server. Registry credentials remain mandatory.

The always-run step summary reports setup and check outcomes with repair commands.
Any required setup or check that fails or is skipped prevents a green result.
These are sandbox/read-only signals, not production readiness or write-path coverage.

Run the hermetic selection regression with
`pnpm test run tests/isometric-health-selection.test.ts`.
It also runs in normal Vitest CI. It collects the real health command with Vitest, enables telemetry using placeholders,
and verifies only the health file is selected (the write-path file sits beside it
and must stay out), and missing opted-in credentials fail closed.
Collection uses an isolated config and a dotenv stub; no test bodies execute, no
local env files are read, and placeholders are never sent to the API. A sentinel
integration suite catches accidental broadening without loading database tests.
