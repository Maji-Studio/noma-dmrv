# Testing

Two test layers: **Vitest** specs in both root `tests/` and colocated
`src/**/*.test.{ts,tsx}` (`pnpm test`), plus **Playwright** E2E in `tests/e2e/`
(`pnpm test:e2e`). Read this before writing either — it carries the naming
contract, env layout, and safety guards that are invisible from the spec files
themselves. Related: [security.md](./security.md) (env inventory),
[database.md](./database.md), [troubleshooting.md](./troubleshooting.md),
[isometric/README.md](./isometric/README.md).

## Which runner picks up which file

`vitest.config.ts` uses Vitest's normal discovery and excludes `**/e2e/**` and
copied `.claude/worktrees/**`. A Playwright spec outside `tests/e2e/`, or a
Vitest spec inside it, is **silently never run**. Put it in the right
directory.

- `pnpm test` — Vitest, both `tests/**/*.test.{ts,tsx}` and colocated
  `src/**/*.test.{ts,tsx}`. Put cross-module/database contracts in `tests/`;
  put pure module, component, schema, hook, and route-handler tests beside the
  implementation when locality helps (for example
  `src/lib/geojson/normalize.test.ts` and
  `src/app/api/ghg-statement-reports/[reportId]/route.test.ts`).
- `pnpm test:integration` — `RUN_ISOMETRIC_SANDBOX_TESTS=1`, `tests/**/*.integration.test.ts`.
- `pnpm test:e2e` — Playwright. CI gate in `e2e.yml`; nightly `@live` in `e2e-live.yml`.

## vitest specs are not all unit tests

Many root specs require a **running Postgres** (facilities-durability-guard,
credit-batch-validation, sample-code-unique, production-claim-write,
registry-boundary-\*). Colocation does not imply purity; read the test setup and
imports. `tests/setup.ts` applies to every Vitest spec, loads `.env.test`, and
defaults `DATABASE_URL`. Without `pnpm docker:up` database-backed specs fail
with a raw connection error that looks nothing like "you forgot the database".
CI prepares the schema before `vitest run` for exactly this reason.

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
- `global-teardown.ts` aborts against a DB that is neither localhost nor named
  `*_test`/`*_e2e`. It defaults `DATABASE_URL` to `…/app_template_test`, so a misconfigured
  run tears down the *wrong DB name* rather than erroring — set `DATABASE_URL` explicitly.

## Environment

`playwright.config.ts` loads **`.env.test` only, never `.env.local`** — Playwright-side
vars belong in `.env.test`. `.env.test` is untracked; when running from a git worktree,
copy both `.env.test` and `.env.local` in first.

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

- `playwright.config.ts` starts or reuses the app on :3100 — don't pre-launch a second one.
- Local runs use dev mode, where first-hit Turbopack compilation is legitimately slow; the
  generous per-test timeout absorbs it. Don't shorten it to "catch hangs".
- Duplicate-key errors → `pnpm db:reset`, then re-run (and check your naming, above).
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
