# Testing

End-to-end testing in noma-dmrv with Playwright. The suite is per-entity specs plus
full-chain smoke tests that exercise the whole traceability chain in one browser session.

Run with `pnpm test:e2e`. Playwright's `webServer` **starts or reuses** the app on port
3100: locally it runs `pnpm dev:manual` and reuses an already-running server
(`reuseExistingServer`); in CI it runs `pnpm build && pnpm start -p 3100`. Don't pre-launch
a second instance — an existing local dev server is picked up automatically.

## Fixtures

Fixtures live in `tests/e2e/fixtures/auth-fixtures.ts`:

- **`adminPage`** — a Playwright page authenticated as the admin user.
- **`seededData`** — the seeded prerequisite entities available to a spec.
- **`cleanupTestData`** — tears down data a spec created.

Seed data comes from `tests/e2e/fixtures/seed-chain-data.ts`, which creates **13
prerequisite entities**. `full-chain-ui.spec.ts` then builds all **8 core entities** in a
single session (the full traceability chain end to end).

## Authentication

Auth uses the **HTTP API**, **not** UI login — the worker fixture in
`tests/e2e/fixtures/auth-fixtures.ts` builds storage states via
`createSignedAuthStorageState`. This avoids the scrypt password-hashing overhead and Better
Auth's sign-in rate limiting. Two requirements follow from that:

- **`DISABLE_RATE_LIMIT=true` must be set in `.env.local`.** Better Auth rate-limits sign-in
  to 10 requests / 15 min; without this toggle the fixtures trip the limiter.
- **The API sign-in must send an `Origin` header** — Better Auth enforces a `trustedOrigins`
  check and rejects the request otherwise.

## Environment & worktrees

`playwright.config` loads **`.env.test`**, which is **untracked** (not in git). When running
E2E from a git worktree, **copy both `.env.test` and `.env.local` into the worktree first** —
otherwise the fixtures fall back to a dead `DATABASE_URL` and every spec fails to connect.

## Timeouts

Global per-test timeout is **60s in CI, 90s locally** (`playwright.config.ts`). First-load
compilation in dev mode can take 10–30s, so a spec's first page navigation is legitimately
slow — the generous timeout absorbs it.

## Common gotchas

- **Duplicate-key errors** — run `pnpm db:reset` first to get a clean database, then re-run
  the suite.
- **EntitySelect dropdown** — the trigger carries `data-testid="entity-select-trigger"`, but
  it is **not scoped per field**. Scope your locator by the parent `FormField` label to
  target the right select.
- **Side sheet** — a side sheet is `[role="dialog"]`; the sheet **closing** is the success
  indicator to assert on.
- **DataTable rows** — a `<tr>` becomes `role="button"` when the table has an `onRowClick`
  handler. Select rows with `getByRole("button")`, **not** `getByRole("row")`.

## `@live` split (Isometric sandbox)

Specs that hit the Isometric sandbox are tagged **`@live`**. They are **excluded from PR CI**
via `--grep-invert` so PR runs stay hermetic (no Isometric credentials are loaded). The
nightly **`e2e-live.yml`** workflow runs the `@live` specs against the sandbox.
