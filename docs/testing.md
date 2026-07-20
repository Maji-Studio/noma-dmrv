# Testing

Two test layers: **vitest** specs in `tests/*.test.ts` (`pnpm test`) and **Playwright**
E2E in `tests/e2e/` (`pnpm test:e2e`). Read this before writing either — it carries the
naming contract, env layout, and safety guards that are invisible from the spec files
themselves. Related: [security.md](./security.md) (env inventory),
[database.md](./database.md), [troubleshooting.md](./troubleshooting.md),
[isometric/README.md](./isometric/README.md).

## Which runner picks up which file

`vitest.config.ts` excludes `**/e2e/**`. A Playwright spec outside `tests/e2e/`, or a
vitest spec inside it, is **silently never run**. Put it in the right directory.

- `pnpm test` — vitest, `tests/*.test.ts`. CI gate in `.github/workflows/ci.yml`.
- `pnpm test:integration` — `RUN_ISOMETRIC_SANDBOX_TESTS=1`, `tests/**/*.integration.test.ts`.
- `pnpm test:e2e` — Playwright. CI gate in `e2e.yml`; nightly `@live` in `e2e-live.yml`.

## vitest specs are not all unit tests

Many require a **running Postgres** (facilities-durability-guard, credit-batch-validation,
sample-code-unique, production-claim-write, registry-boundary-\*). `tests/setup.ts` loads
`.env.test` and defaults `DATABASE_URL`. Without `pnpm docker:up` these fail with a raw
connection error that looks nothing like "you forgot the database". CI runs
`pnpm drizzle-kit push --force` before `vitest run` for exactly this reason.

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
- `GEO_PROVIDER=stub` in `.env.test` — position-picker and carbon-viewer specs depend on
  the stub geo actions (`.env.tpl` notes stub is rejected in prod). See
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

`fullyParallel: false`, workers default to 1 locally; CI runs **4 shards × 2 workers with
1 retry**. Specs may assume serial execution *within* a shard but must not assume any
global ordering across shards.

## Gotchas

- `playwright.config.ts` starts or reuses the app on :3100 — don't pre-launch a second one.
- Local runs use dev mode, where first-hit Turbopack compilation is legitimately slow; the
  generous per-test timeout absorbs it. Don't shorten it to "catch hangs".
- Duplicate-key errors → `pnpm db:reset`, then re-run (and check your naming, above).
- A side sheet is `[role="dialog"]`; assert on the sheet **closing** as the success signal.
- A DataTable `<tr>` becomes `role="button"` when `onRowClick` is set — select with
  `getByRole("button")`, not `getByRole("row")`.

## `@live` split (Isometric sandbox)

Tagging is Playwright's describe option — `test.describe("…", { tag: "@live" }, …)`. A
comment-only `// @live` marker will **not** be excluded by `--grep-invert`.

- PR CI runs `--grep-invert "@live"` so it stays hermetic; `e2e-live.yml` runs the tagged
  specs nightly against the sandbox.
- `@live` specs load `.env.local` by hand (see `certification-workspace.spec.ts`,
  `facility-certifier-mapping.spec.ts`) to pick up `ISOMETRIC_DEMO_PROJECT_ID` without
  duplicating it into `.env.test`. This is the usual cause of a failing local `@live` run.
- **Convention:** whenever a live half exists, keep a hermetic UI+DB counterpart in PR CI
  (`durability-readiness.spec.ts`, `production-processes.spec.ts` document themselves as
  deliberately not `@live`). Don't push all new certification coverage behind the nightly.
