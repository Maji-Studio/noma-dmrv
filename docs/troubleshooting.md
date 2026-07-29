# Troubleshooting Guide

Symptom-to-fix lookup for issues that have actually bitten someone in this repo. Read it when something is broken and you want the known cause before you start bisecting. It is a bug record, not a tutorial — topic-owning docs are linked inline ([forms](./forms.md), [testing](./testing.md), [security](./security.md), [database](./database.md), [design-system](./design-system.md), [auth](./auth.md)) and win on any conflict.

## Development Server Issues

### `pnpm dev` Is Not `next dev`

`pnpm dev` → `pnpm dev:docker` → Docker startup, database wait, migration,
schema verification, then `next dev -p 3100` (see `package.json`).
Consequences:

- Extra args do **not** reach Next. `pnpm dev -- -p 3101` is a no-op; the port is hard-coded in the script.
- `pnpm dev:manual` is the bare `next dev -p 3100` escape hatch.
- `pnpm dev:docker:init` is the reset-and-start variant (runs `db:reset` in between).
- A local "database not running" symptom is usually a stopped container → `pnpm docker:up`, then `pnpm db:wait` (`src/lib/cli/wait-for-db.ts`).
- A migration or schema-verification failure stops startup before the app can
  serve pages against an incompatible database. Use the reported database
  command to repair the schema. If local migration history is inconsistent,
  use `pnpm db:reset` and then `pnpm db:seed`.

### Port 3100 Already in Use

**Symptoms** — `EADDRINUSE: address already in use :::3100`.

**Fix** — `lsof -ti:3100 | xargs kill -9`, or run `pnpm dev:manual` after freeing the port. There is no supported port override.

### Next.js Cache Issues

**Symptoms** — stale UI after git pull/merge; build errors after dependency updates; changes not reflecting; nonsense type errors.

**Fix** — `rm -rf .next` (then, if still broken, `rm -rf .next node_modules .pnpm-store && pnpm install`).

### Hot Reload Not Working

Check no firewall blocks `localhost:3100`; try `WATCHPACK_POLLING=true pnpm dev:manual`; restart the dev server.

## Database Issues

### Pool Configuration (read before diagnosing any connection symptom)

`src/db/index.ts` builds the pool from `getPgPoolConfig(env.DATABASE_URL)` plus:

- `max: env.DB_POOL_MAX ?? 1` — the default is **1**, not a library default of 10. Advice about "reducing the pool" is backwards here; local pool starvation is usually fixed by *raising* `DB_POOL_MAX`.
- `idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS ?? 10_000`
- `connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS ?? 10_000` — so exhaustion surfaces as a **10-second hang**, not an immediate error.

All three are env-driven (`src/config/env.ts`). Never hard-code them in `src/db/index.ts`.

`withDedicatedLockConnection()` (same file) deliberately opens its own `pg.Client` **outside** the shared pool: lock-backed certification work holds the advisory lock while doing heavyweight nested work through the shared pool, so it must not consume a pooled connection. It is a second, invisible connection source when counting `pg_stat_activity` — and "cleaning up" the duplicate connection logic will deadlock certification.

### Connection Pool Exhaustion / "too many clients already"

**Symptoms** — `remaining connection slots are reserved for roles with the SUPERUSER attribute` (SQLSTATE `53300`); `too many clients already`; a ~10s hang before failure; works initially, fails under load.

**Fixes**

1. Count real usage — remember `withDedicatedLockConnection` connections are not pooled:
   ```sql
   SHOW max_connections;
   SELECT count(*) FROM pg_stat_activity;
   ```
2. Tune `DB_POOL_MAX` in the environment (up or down) rather than editing `src/db/index.ts`.
3. For production, front the database with PgBouncer and point `DATABASE_URL` at its port (6432).

### Connection Refused / Connection Timeout

**Symptoms** — `ECONNREFUSED`, `connection timeout`.

**Fixes**

- Local Postgres runs in Docker: `pnpm docker:up` then `pnpm db:wait`. Do this before suspecting the URL.
- **`sslmode` in `DATABASE_URL` is ignored.** `getPgPoolConfig` (`src/lib/pg-pool-config.ts`) strips `sslmode` from the URL before building the pool, because pg 8.18 derives SSL behaviour from the connection string and would override the explicit `ssl` option. Adding `?sslmode=require` has **no effect**.
- SSL is decided by hostname: `localhost` / `127.0.0.1` / `::1` → `ssl: false`; anything else → `ssl: true`, unless `PG_ALLOW_UNVERIFIED_SSL=true` (→ `rejectUnauthorized: false`).
- Then check firewall/security groups and credentials.

### DATABASE_URL Not Found

Ensure `.env.local` exists with `DATABASE_URL` (exact case, no trailing spaces). Standalone scripts need `import "dotenv/config";` at the top.

### Migration Failures / Schema Out of Sync

The repo is **migration-based** — `drizzle/` holds tracked numbered migrations.

```bash
pnpm db:generate      # generate, then review the SQL in drizzle/
pnpm db:migrate       # apply
pnpm db:verify-schema # confirm the live DB matches the schema
pnpm db:reset         # local only — destructive
```

- ❌ Never `pnpm db:push` (or `drizzle-kit push --force`) on a shared environment. See [database.md](./database.md).
- `pnpm db:reset` = `reset-db.ts && pnpm db:migrate && pnpm db:ensure-admin`. It replays tracked migrations and re-creates the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (`requireEnvironmentVariable('ADMIN_PASSWORD')` throws if unset).
- `db:reset` does **not** re-seed demo data — that is the separate `pnpm db:seed`. Resetting and then hunting for "missing" demo rows is a common wasted hour.

### Duplicate Key on `code` Columns

**Symptoms** — `duplicate key value violates unique constraint "facilities_organization_id_code_unique"` (likewise `reactors_organization_id_code_unique`, `storage_locations_organization_id_code_unique`).

**Root Cause** — codes are unique **per organization**, not globally: the constraint is a composite on `(organizationId, code)` (`src/db/schema/facilities.ts`), per [ADR-0010: shared-schema org-column tenancy](./adr/0010-shared-schema-org-column-tenancy.md). A failure means a collision *within one organization* — usually leftover data from an interrupted test run. Do **not** "fix" it by making `code` globally unique; that violates the tenancy model.

**Fix** — `pnpm db:reset` locally, or let the `cleanupTestData` fixture run to completion.

## Authentication Issues

See [auth.md](./auth.md) for the flow and route protection.

### Auth Change Didn't Take Effect (role/permission edits)

Sessions live 7 days with a 24h refresh, and Better Auth is configured with a **5-minute cookie cache** (`session.cookieCache.maxAge`, `src/lib/auth/better-auth.ts`). Role or permission changes are therefore invisible for up to 5 minutes unless the user signs out and back in. This is the most common false "auth is broken" report.

### Rate Limits (429 Too Many Requests)

`rateLimit` in `src/lib/auth/better-auth.ts`: global 100 per 60s, plus custom rules — `/sign-in/email` 10 per 15 min, `/sign-up/email` 3 per hour, `/request-password-reset` 5 per 15 min, `/reset-password` 10 per 15 min.

`DISABLE_RATE_LIMIT=true` in `.env.local` disables all of them at once (restart the server after adding it).

### Email Not Sending

- Verify `RESEND_API_KEY` and that `RESEND_FROM_EMAIL` is verified in the Resend dashboard; check spam and the Resend delivery log.
- For local dev, leave both empty and use the reset/verification URLs logged to the server output. See [mail-setup.md](./mail-setup.md).

### Can't Log In / Session Issues

**Common causes** — `BETTER_AUTH_SECRET` changed (invalidates all sessions); `NEXT_PUBLIC_APP_URL` doesn't match the actual URL; cookies blocked; mixed HTTP/HTTPS.

**Fix** — delete rows from the `session` table (`pnpm db:studio`), regenerate the secret with `openssl rand -base64 32` if needed, restart.

### Password Reset Not Working

Tokens expire after 1 hour. Verify the email was sent, that `NEXT_PUBLIC_APP_URL` matches the real app URL, and clear stale rows from the `verification` table.

### Can't Create Admin User

`ADMIN_EMAIL` and `ADMIN_PASSWORD` must both be set — there is no default password (`src/lib/cli/ensure-admin-core.ts` throws). Emails are matched case-sensitively; restart after changing `ADMIN_EMAIL`.

## Build & Deployment Issues

### Type Errors During Build

`rm -rf .next tsconfig.tsbuildinfo`, then `pnpm typecheck` (the first-class script; not `pnpm tsc --noEmit`).

### Environment Variables Not Working in Production

Client-side vars must start with `NEXT_PUBLIC_`; rebuild after adding any env var; set them in the hosting platform dashboard. `src/config/env.ts` validates the required set.

### Debugging Against the Wrong Environment Assumptions

**Symptoms** — "works in staging but not locally" with no code difference; auth/DB debugging goes in circles and fixes target config that was never wrong.

**Why** — the three 1Password env items (`local` / `staging` / `production`) **intentionally differ**. Local is not a copy of staging. The inventory is owned by [security.md](./security.md).

**Fixes**

- Write down which environment you are in and which values you are assuming, then verify against the matching 1Password item.
- `pnpm env:check` reports drift between templates and 1Password; `pnpm env:local` re-injects `.env.local` from the `local` item.
- The 1Password CLI (`op`) requires interactive desktop approval — agents and sandboxed shells **cannot** sign in. Ask the user to run `op` commands manually.

## Dependency Issues

### pnpm install Fails

`pnpm store prune`; then `rm -rf node_modules .pnpm-store pnpm-lock.yaml && pnpm install`. Never npm/yarn.

### Module Not Found: `Cannot find module '@/...'`

Clear `.next`, check the `@/*` alias in `tsconfig.json`, and restart the TS server (VSCode: Cmd+Shift+P → "Restart TS Server").

## React Query Issues

### Stale Data Showing

- Mutations must invalidate: `queryClient.invalidateQueries({ queryKey: [...] })`, with query keys matching exactly.
- `staleTime` is set once globally to `30_000` in `src/app/providers.tsx`; individual hooks override it (e.g. `src/hooks/use-production-processes.ts` uses `300000`). Check the hook before assuming 30s. `gcTime` is not configured anywhere in this repo.

### Infinite Refetching Loop

Query key is unstable (a new array/object each render), or a refetch trigger is firing. Stabilise the key first; only then reach for `refetchOnWindowFocus: false`.

## Form Validation Issues

[forms.md](./forms.md) owns this topic — schema helpers, Zod 4 string formats, numeric input conventions.

### Number Fields: "expected number, received NaN"

**Symptom** — empty optional number inputs fail with `Invalid input: expected number, received NaN`.

**Root Cause** — `valueAsNumber: true` in `register()` turns `""` into `NaN`, which is type `number` but rejected by `z.number()` and matched by no union branch.

**Fix** — never use `valueAsNumber` (it has zero occurrences in `src/`, keep it that way). Use the preprocess-based helpers in `src/schemas/helpers.ts`, which do the empty-string → `null`/`undefined` conversion in the schema: `optionalNumber`, `optionalPositiveNumber`, `optionalPercent`, `requiredNumber()`, `massKgSchema()` / `requiredPositiveMassKgSchema()` / `optionalMassKgSchema()`, and the raw `toNumberOrNull` / `toNumberOrUndefined` coercers.

### Optional UUID Fields: "Invalid UUID" on Empty Selection

**Symptom** — optional entity selects (linked production run, storage location) report "Invalid UUID" when left empty, because the form defaults them to `""`.

**Fix** — put `emptyToNull` **first** in the union so `""` is consumed before UUID validation runs:

```typescript
// BAD — tries UUID first, fails on "", error leaks to the user
linkedId: z.string().uuid().optional().nullable().or(emptyToNull)

// GOOD — catches "" first, then validates UUID
linkedId: emptyToNull.or(z.string().uuid("Invalid selection")).nullable().optional()
```

⚠️ The JSDoc example on `emptyToNull` itself (`src/schemas/helpers.ts`) shows the BAD ordering. **The JSDoc is wrong**; real call sites follow the rule above (e.g. `src/schemas/production-incidents.ts`). Trust the call sites, not the helper's comment.

### Zod v4 `.uuid()` Rejects Non-RFC-4122 IDs

**Symptoms** — EntitySelect fields show "Please select a valid facility/reactor/feedstock" on submit while the UI looks correctly filled; several UUID fields fail at once; error type is `invalid_format`, not `too_small`.

**Root Cause** — Zod v4's `.uuid()` enforces RFC 4122: position 13 must be the version (`1`-`8`) and position 17 the variant (`8`-`b`). Zod v3 only checked the hex shape. Flat sequential IDs like `00000000-0000-0000-0000-000000000160` fail.

**Fix** — `.uuid()` stays in schemas (it is used ~186 times under `src/schemas`); **seed IDs must carry version/variant bits**. Follow the `demoId` helper in `src/db/seed-data.ts` (mirrored in `src/db/seed-certification-evidence.ts`):

```typescript
const demoId = (n: number) => `de000000-0000-4000-a000-${n.toString().padStart(12, '0')}`;
```

Re-seed after changing it (`pnpm db:seed`). There is no relaxed `uuidFormat` helper in this repo — do not import one.

### Zod Validation Not Firing At All

Check the schema is actually wired: `zodResolver(schema)` on the form, and the server action parses its input (`fn/` layer always validates with Zod).

## E2E Testing Issues

[testing.md](./testing.md) owns E2E symptoms — rate limits and `DISABLE_RATE_LIMIT`, HTTP-API auth fixtures, first-load timeouts, and duplicate-key resets. Read it first; only the entries below are unique to this file.

Facts worth pinning because they are frequently misremembered:

- Worker count is **not** fixed: `workers: process.env.CI ? ciWorkers : undefined` — Playwright's default locally. Reason about "parallel workers", never "4 workers".
- Per-test timeout is `process.env.CI ? 60000 : 90000` (`playwright.config.ts`) — 60s in CI, 90s locally.
- The worker auth fixture builds storage states via `createSignedAuthStorageState` (`tests/e2e/fixtures/auth-fixtures.ts`). `createDirectAuthContext` is a thin wrapper over it used by a single spec — do not treat it as the entry point.
- `playwright.config` loads **`.env.test`, which is untracked**. Running E2E from a fresh git worktree without copying in both `.env.test` and `.env.local` makes every spec fail on a dead `DATABASE_URL`. This is the highest-frequency agent-facing E2E failure.

### E2E Schema Drift After Local Schema Changes

**Symptoms** — fixture inserts fail with `column "source_region" of relation "suppliers" does not exist`; passes on one machine, fails immediately on another.

**Fix** — the local database is behind the tracked migrations.

```bash
pnpm db:verify-schema   # confirm the drift first
pnpm db:migrate         # or pnpm db:reset if partially migrated
pnpm test:e2e
```

Never reach for `drizzle-kit push --force` — it bypasses the tracked `drizzle/` migration set.

### Entity Names Collide with the Sidebar FacilitySelector (Strict Mode)

**Symptoms** — `strict mode violation: getByText('…') resolved to 2 elements` (a `<span>` button label and an `<h3>` heading); or a `not.toBeVisible()` assertion times out because the *sidebar* still shows the name after the list updated.

**Root Cause** — the sidebar `FacilitySelector` renders the selected facility's name, and the provider can auto-select a freshly-seeded test facility (fallback is `facilities[0]`, and `E2E …` names sort early).

**Fix** — scope to a role only the card uses, `page.getByRole("heading", { name: facility.name })`, or scope within the card: `page.locator("article").filter({ hasText: facility.code })`.

### DB-State Assertions Right After a UI Signal Are Racy

**Symptoms** — the UI confirmed the action (card gone, toast shown) but an immediate direct-DB read from the spec sees the old state (e.g. a freshly-stamped column still `NULL`). Passes on re-run; flaky overall.

**Root Cause** — the spec's DB read uses its own `pg` Pool, a separate connection from the app's. "UI looks done" does not guarantee the spec's next statement observes the committed write.

**Fix** — wrap direct-DB assertions in `expect.poll`:

```ts
await expect
  .poll(async () => (await readStamps()).archivedAt !== null, { timeout: 15000 })
  .toBe(true);
```

See `tests/e2e/facility-archive.spec.ts` for the pattern in context.

## UI & Styling Issues

### Never Hand-Roll a Dialog

Compose `src/components/ui/modal/` (centered dialogs) or `SlideOverPanel`. Both are built on Base UI `Dialog`; there is no raw `<dialog>` / `showModal()` anywhere in `src/` and no global `dialog` CSS to inherit. See [design-system.md](./design-system.md) → Modal Component.

Modal dev-warns when rendered without `ariaLabelledBy` or `ariaLabel` — pass one.

### Dialog Opens with Stale Form State

**Symptom** — opening a dialog shows the previous open's values, error state, or wizard step.

**Why it normally works** — Base UI portals unmount children while closed, so each open starts fresh. State that lives *outside* the modal (RHF form instance, mutation state, step counter) does not reset on its own — reset it in `onOpen`:

```tsx
<Modal
  isOpen={isOpen}
  onClose={onClose}
  onOpen={() => {
    reset(defaultValues);
    mutation.reset();
    setStep(1);
  }}
  ariaLabelledBy="my-dialog-title"
>
  …
</Modal>
```

⚠️ `onOpen` is fired by a manual `useEffect` + `wasOpen` ref in `modal.tsx`, **not** by Base UI, because `onOpenChange` fires only for user-driven changes and never for the controlled `open` prop. "Simplifying" that effect into `onOpenChange` silently breaks every form-reset-on-open.

## Performance Issues

### Slow Page Loads

Check for N+1 queries in `data-access/`; add indexes for frequently queried columns; tune React Query `staleTime`; add `loading.tsx` for instant loading states; `dynamic(() => import('./HeavyComponent'))` for heavy client components.

## Date/Time Issues

### Date Fields Off by One Day

**Symptoms** — the date picker defaults to yesterday; a production run date is one day behind. Only in timezones offset from UTC.

**Root Cause** — `new Date().toISOString().split("T")[0]` converts to UTC first, so 11 PM local on Mar 3 at UTC-5 becomes Mar 4 UTC (and 1 AM Mar 4 at UTC+9 becomes Mar 3 UTC).

**Fix** — use `formatLocalDate` / `formatLocalDateTime` from `@/lib/date-utils`:

```typescript
// BAD — shifts date in non-UTC timezones
date: new Date().toISOString().split("T")[0]

// GOOD — uses local timezone
date: formatLocalDate(new Date())
```

## Common Error Messages

### "Hydration failed"

Server HTML doesn't match client HTML. Check for browser-only APIs during render (`localStorage`, `window`), non-deterministic values in JSX (dates, `Math.random`), and move client-only work behind an effect. `suppressHydrationWarning` is a last resort.

### "Cannot access X before initialization"

Circular import or hoisting. Break the cycle — usually by moving shared types into their own file.

## Related Documentation

- Architecture & patterns → [architecture.md](./architecture.md) · Code style → [code-style.md](./code-style.md)
- Database → [database.md](./database.md), [schema-overview.md](./schema-overview.md) · ADRs → [docs/adr/](./adr/)
- Auth → [auth.md](./auth.md) · Env & secrets → [security.md](./security.md)
- Forms → [forms.md](./forms.md) · Design system → [design-system.md](./design-system.md)
- Testing → [testing.md](./testing.md) · Storage → [storage.md](./storage.md)
- Next.js 16 caching → [modern-patterns.md](./modern-patterns.md) · Deferred work → [open-questions.md](./open-questions.md)
