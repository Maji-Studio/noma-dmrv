# Testing

Two test layers: **Vitest** specs in both root `tests/` and colocated
`src/**/*.test.{ts,tsx}` (`pnpm test`), plus **Playwright** E2E in `tests/e2e/`
(`pnpm test:e2e`). Read this before writing either — it carries the naming
contract, env layout, and safety guards that are invisible from the spec files
themselves. Related: [security.md](./security.md) (env inventory),
[database.md](./database.md), [troubleshooting.md](./troubleshooting.md),
[isometric/README.md](./isometric/README.md).

Vitest defaults to the `node` environment. Component tests that need a real DOM
or portals opt in with `// @vitest-environment jsdom` and use
`@testing-library/react`.

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
  configuration.
- `pnpm test:isometric-health` — opts into only
  `tests/isometric-sandbox-health.integration.test.ts`, the read-only sandbox
  checks. Registry writes belong in a separate integration suite, never in the
  health file. Sandbox configuration lives in
  `tests/helpers/isometric-sandbox-env.ts`. Requires sandbox credentials
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

## Static check caches

Static checks cache locally: `pnpm lint` uses content-based `.cache/eslint`,
and `pnpm typecheck` uses `.cache/typecheck.tsbuildinfo`. Delete `.cache/` for
a cold run. After adding, removing, or renaming route files, delete
`.cache/eslint` before linting: `@next/next/no-html-link-for-pages` reads the
route tree, which ESLint's per-file cache cannot detect. CI keys the cache on
the tracked route-file paths as well as dependency and check configuration.

## vitest specs are not all unit tests

Many root specs require a **running Postgres** (facilities-durability-guard,
credit-batch-validation, sample-code-unique, production-claim-write,
registry-boundary-\*). Colocation does not imply purity; read the test setup and
imports. `tests/setup.ts` applies to every Vitest spec, loads `.env.test`, and
defaults `DATABASE_URL`. Without `pnpm docker:up` database-backed specs fail
with a raw connection error that looks nothing like "you forgot the database".
CI runs Vitest in two file shards, each with its own Postgres service,
schema migrations and disposable MinIO service. See [storage.md](./storage.md#testing)
for the `MINIO_TEST_*` suite and local configuration.

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

`pnpm eval:mcp` runs two feedstock intake requests, two chained production-run
requests, two lab sample requests (three replicates; a replicate without organic
carbon), a named sub-bin loss request, three delivery requests and a bill-of-lading upload through headless
Claude Code and the local MCP server. It needs Docker with the test database schema ready,
the worktree's `.env.test`, and a logged-in Claude Code subscription. It refuses
non-test databases, creates a fresh organization and API key per case, and scores
the stored rows, bin stock, audit transport and tool-call count. Case 2 follows
the published schema: ask for moisture when required, otherwise log without it.
The chained case without draw mass requires a mass request in the final answer and
either no run or a running run without draws. Any saved draw fails. The complete
chain requires R1 running today in the facility zone, a 1500 kg wet draw from B2
and the resulting stock. Required run references and start time come from the
published contract and grounding tools.

`delivery-complete` requires exactly one delivery of 2400 kg wet at 31% moisture,
yesterday at 14:00 in the facility zone, from the requested order and product bin,
with no distance override and at most 10 tool calls. `delivery-missing-moisture`
requires no saved changes and a final request for moisture; a dry run is allowed.
`delivery-split-bin` seeds two products with different placement times and moistures.
It requires no committed delivery and a request for moisture readings, either as a
delivery clarification or after a completed stock read followed by a dry run.
The preview alone cannot pass. Historical
moisture estimates can inform a preview but cannot supply missing operator readings
for a commit, even if the server refuses it. Each case has its own organization and cleanup.

`delivery-bol-upload` seeds delivery DL-X on an unsubmitted lineage and generates a
small valid PDF at an absolute temporary path. Its prompt asks the agent to attach
that file as a bill of lading. Its fixture directory is the process working
directory and is also passed with `--add-dir`. The MCP config is passed by an
absolute file path from a separate private temporary directory. Other cases
keep their own temporary working directories. Only this case enables and allows
plain `Bash`, so compound shell commands work in `dontAsk` mode.
The agent can read the file's size and
SHA-256, request an upload through MCP, PUT the file with its shell, then confirm
through MCP. The eval server always uses
`STORAGE_PROVIDER=local-fs` with a scratch root under the run directory and the
eval server's own URL for signed PUTs. No bucket credentials are needed.

Every evaluated Claude session receives only an allowlisted environment:
`PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM`,
and the optional subscription settings `CLAUDE_CONFIG_DIR` and
`CLAUDE_CODE_OAUTH_TOKEN`. Subscription login remains available through its home
or config directory. Database URLs, app and storage secrets, API credentials and
shell startup overrides are excluded. The app server and fixture harness retain
their own environment; cases reach app data through their scoped MCP credential.
Non-upload cases have no built-in tools. The upload session can reach its
fixture directory and the eval server URL, with no repository secrets in its
environment. It still runs as the local user: its working directory and
`--add-dir` do not restrict shell filesystem or network access. Bash retains
the local user's permissions to reach other files and network endpoints,
including repository files, subscription config and the temporary MCP credential
config. This is a local check, not a sandbox.

The upload passes with exactly one uploaded `bill_of_lading` document on DL-X,
the fixture's SHA-256, no pending or failed leftovers, no edits to the delivery
and no other committed API writes. Byte payloads in any MCP argument fail even
when the call is refused, including JSON byte arrays with more than eight entries
or a `%PDF` prefix. The budget is six MCP calls: `Transcript.calls` retains
only `mcp__noma__*` tool uses; Bash calls and their result flags are retained in
`Transcript.shellCalls` and do not count. Raw stream-json records both kinds.
Signed local storage URLs and storage keys are redacted from saved artifacts.

This is a local check before merge, not a CI gate. Paste its Markdown table into
the PR. Transcripts, the dev server log, Markdown and JSON scores are saved in
the printed temporary run directory with keys redacted. Fixture organizations
are removed on exit along with the upload PDF and scratch storage;
`pnpm eval:mcp --keep` retains them and prints their ids.
`EVAL_MCP_MODEL` selects a model. Port, timeouts, budget and Claude flags live in
`scripts/eval-mcp/config.ts`.

## API schema fuzzing

`pnpm api:fuzz` runs Schemathesis 4.29.3 against every operation in the freshly
generated v1 OpenAPI document. It runs examples, coverage, fuzzing (25 examples
per operation), and inferred stateful links (10 scenarios, at most 5 steps).
[API fuzz CI](../.github/workflows/api-fuzz.yml) runs on PRs touching
`src/lib/api/**`, `src/lib/operations/**`, `src/lib/representations/**`,
`src/app/api/**`, `src/proxy.ts`, `src/config/env.ts`, `openapi/**`, or the harness
files (the workflow, `scripts/api-fuzz/**` and `schemathesis.toml`). It uses
CI Postgres and `pnpm build` plus `pnpm start`, limits the fuzz step to five
minutes, and uploads `api-fuzz-report/junit.xml` even after test failures.

Locally, install `uv` and prepare an empty, migrated local database whose name
contains a `test` or `e2e` segment. Export `DATABASE_URL` and the app environment
before seeding; the seed does not load env files. Use the workflow's hermetic
env block for production-build parity. The seed creates a verified Owner, the
intake prerequisites, a driver, vehicle, supplier location, committed feedstock
intake, a reactor and a closed production run through the operation runner (the run
draws from its own second bin, so the feedstock cases keep their stock). For
biochar it adds a completed run with output in a biochar bin, a product bin, a Pure
and a blended formulation, one product placed from that stock and one loss, all
through the operations. It also creates a customer and location with one-way
distance, two large orders and a 0.1 kg delivery on the product bin through the
runner. The second order stays delivery-free for DELETE. The private fixture
exports the delivery id, code and ETag alongside the order fields. Each seeded
delivery, feedstock and lab sample also has one uploaded document and one pending
document. Real upload writers create both, and the uploaded fixture is promoted
from physical local-fs bytes. Export `STORAGE_PROVIDER=local-fs` and
`STORAGE_LOCAL_FS_ROOT=.storage-api-fuzz` for both seed and server. The fixture
includes document ids, owner ids, ETags and the pending representation.
Bin and formulation names are unique per facility. The key
has all current scopes, including delete.
Its private JSON file contains the key and fixture ids; never upload that file.

```bash
fixture_dir=$(mktemp -d)
pnpm tsx scripts/api-fuzz/seed.ts "$fixture_dir/fixture.json"
export API_FUZZ_FIXTURE="$fixture_dir/fixture.json"
export API_FUZZ_KEY=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).key' "$fixture_dir/fixture.json")
# Build and start the app separately with the same DATABASE_URL and auth secret.
API_FUZZ_BASE_URL=http://127.0.0.1:3100/api/v1 pnpm api:fuzz
```

The hooks give the product and stock-movement operations seeded examples: a dry-run
product create on the seeded bins, a product PATCH with its ETag, and a dry-run loss
on the biochar bin. Creates carry `Idempotency-Key`; PATCH uses `If-Match`.
Delivery examples read the seeded row, dry-run a 0.1 kg create with a past instant
and measured moisture, and dry-run a metadata-only PATCH with its ETag. These
examples must return 2xx and leave stock and order balance available for repeats.
Document examples list, read and request uploads on those owners, repeat-confirm
the uploaded fixtures, and expect a content redirect only for fixtures with
physical objects. The harness does not follow those redirects or PUT bytes.
A separately named pending-confirm example requires retryable 409 `conflict`
and rereads the document to verify its representation and ETag are unchanged.
Upload requests use fresh keys and commit pending rows because they have no dry
run. `hooks.test.py` checks the hook behavior offline; run it with `uvx --from "schemathesis==4.29.3" python scripts/api-fuzz/hooks.test.py`.

Fuzzing writes and deletes data, so use only a throwaway fixture organization.
For a production bundle, `API_FUZZ_DISABLE_RATE_LIMIT=true` bypasses only API
token buckets and is refused unless `CI=true` (or `1`),
`NOMA_HERMETIC_CI=true`, and `NEXT_PUBLIC_APP_URL` is an HTTP(S) loopback URL.
Authentication, scopes, and the write kill switch still apply. Keep this flag
out of deployment environments.

Reproduce a run with the same Schemathesis version, generated schema, and
starting fixture state: `pnpm api:fuzz --seed 20261009` (the checked-in seed).
Set `API_FUZZ_BASE_URL`, `API_FUZZ_KEY` and `API_FUZZ_FIXTURE` as above.
The runner exports fixture ids and codes from that private file. Configured
by-id parameters become deterministic examples only; coverage and fuzzing still
generate random ids. PATCH and DELETE seeded examples use dry runs. POST also
has a seeded dry-run example: the published intake body is rebound to fixture
references and the UTC fixture facility date, with a fresh Idempotency-Key. The
production run create example is the published body rebound to the fixture facility,
reactor and run bin, starting one hour ago after the seeded run's window. Every seeded
positive JSON example (by-id and create) must answer 2xx (`seeded_example_success`); the
statuses allowed for generated cases never excuse it.
Examples do not suppress phase-specific missing-data warnings when generated
references repeatedly return 404 in coverage or fuzzing. Positive
list requests omit opaque cursors because their binding cannot be generated from
JSON Schema; negative cursor probes remain enabled. Cursor unit tests cover
valid continuations and organization/resource/filter mismatches.
The hooks treat 414 and 431 as pre-application transport refusals. Other status
codes still undergo contract checks, and 400 is not allowed globally for positive
requests. Deliberate missing or invalid authentication probes may return 401;
a request carrying the configured fixture key that returns 401 fails a dedicated
check. TRACE is omitted from unsupported-method probes because `next start` rejects
it before app dispatch. QUERY is also omitted because the HTTP parser returns
an empty 400 on both `next start` and Vercel. Other methods remain checked.
Positive writes (POST, PATCH and DELETE) accept 422 for cross-field domain
refusals that JSON Schema cannot express; positive reads still reject 422. The JUnit failure and terminal
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
  `isLocalHost` in `tests/helpers/throwaway-database.ts`). Locally
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
step needs only the registry credential pair and `ISOMETRIC_ENVIRONMENT`, because
`client-env.ts` and the logger do not load app config. Registry credentials remain
mandatory.

The always-run step summary reports setup and check outcomes with repair commands.
Any required setup or check that fails or is skipped prevents a green result.
These are sandbox/read-only signals, not production readiness or write-path coverage.

Run the hermetic selection regression with
`pnpm test run tests/isometric-health-selection.test.ts`.
It also runs in normal Vitest CI. It collects the real health command with Vitest
and verifies only the health file is selected, a collection-only write sentinel
is excluded, and missing opted-in credentials fail closed.
Collection uses an isolated config and a dotenv stub; no test bodies execute, no
local env files are read, and placeholders are never sent to the API. A sentinel
integration suite catches accidental broadening without loading database tests.
