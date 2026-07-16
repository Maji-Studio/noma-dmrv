# Security Best Practices

## Non-Negotiables

1. Never commit secrets.
2. Validate user input with Zod.
3. Enforce authorization in data-access layer.
4. Avoid logging PII (email, names, tokens).
5. Prefer Drizzle query builder over raw SQL.

## Auth and Authorization Model

- Route-level protection runs through `proxy.ts` + `src/lib/auth/middleware.ts`.
- `/api/auth/*` is publicly reachable for Better Auth endpoints.
- Protected API routes return `401`/`403` JSON when unauthorized.
- App pages require authentication through the app layout and data-access guards.
- Admin pages require `requireAdmin()`.
- Facility context scopes workflows, but it is not a tenant boundary today.

## Signup Policy

- `ALLOW_SELF_SIGNUP=false` disables public signup (`emailAndPassword.disableSignUp=true`).
- `ALLOW_SELF_SIGNUP=true` enables public signup.

## Guard Examples

```ts
// authenticated app access
await requireAuth();

// admin guard
await requireAdmin();
```

## Data Ownership Posture

noma-dmrv is currently single-org / shared-data. Authenticated users share the operational MRV records, and `userId` columns are attribution fields rather than ownership boundaries.

Before introducing multi-tenant facility ownership, add membership/tenant filters to `src/data-access/` list/query/ensure helpers and cover them with tests.

## Logging Rules

Safe to log:

- user IDs
- request IDs
- function names
- sanitized error messages

Never log:

- emails
- password/token values
- API keys/secrets

## Server-Action Error Handling

Raw Drizzle/Postgres error text (SQL plus bound parameter values) must never
reach the client — bound values are arbitrary user-entered data (names,
addresses, …) and can themselves be PII. `fn/` catch blocks route unexpected
errors through `toLoggedActionError` (`src/fn/action-errors.ts`): the real
error is logged server-side via the structured logger, and the client only
ever receives a `SafeError` or Zod validation message, or a generic fallback
otherwise. `sanitizeErrorMessage` (`src/lib/log`) additionally redacts
everything from a query's `params:` marker onward before logging, so bound
values never land in server logs either — only the parameterized SQL shape
is kept for debuggability. Mass-input schemas use the shared caps in
`src/schemas/helpers` (`MASS_INPUT_MAX_*`) so mass overflows are rejected by Zod
before they can surface as raw DB errors; integer/count fields use
`PG_INTEGER_MAX` where they map to Postgres integer columns.

## Operational Defaults

- Better Auth rate limits are enabled with stricter rules for auth-sensitive endpoints.
- DB pool limits are centralized in `src/db/index.ts` and configurable via env.

## Environment Variables

All env vars are validated with **Zod in `src/config/env.ts`**; a `superRefine`
block enforces cross-field rules (e.g. Isometric token+secret are both-or-neither,
`local-fs` / `stub` are rejected in production). The app refuses to boot on an
invalid or missing-required var.

**Document NAMES only, never values** — here, in code, in comments, or in tests.

Inventory by group (app-validated in `src/config/env.ts`):

- **Core:** `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_SECRET` (32+ chars),
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ADMIN_EMAIL`, `ALLOW_SELF_SIGNUP`,
  `NODE_ENV`
- **Logging / DB pool:** `LOG_LEVEL`, `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`,
  `DB_POOL_CONNECTION_TIMEOUT_MS`
- **Storage:** `STORAGE_PROVIDER` (`s3-compatible` required in prod),
  `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`,
  `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_SIGNING_SECRET`,
  `STORAGE_LOCAL_FS_ROOT`
- **Isometric:** `ISOMETRIC_ACCESS_TOKEN` + `ISOMETRIC_CLIENT_SECRET`
  (both-or-neither; seed and dedicated CI health inputs only),
  `CREDENTIALS_ENCRYPTION_KEY` (optional at boot; required when storing or
  reading per-organization registry credentials),
  `ISOMETRIC_ENVIRONMENT`, `ISOMETRIC_UPLOAD_HOST_ALLOWLIST`,
  `ISOMETRIC_STORAGE_REDIRECT_HOSTS` (document-redirect allowlist),
  `DURABILITY_MEASUREMENT_SAMPLES_LIVE` (sandbox-only opt-in; rejected in
  production)
- **Geo / maps** (all optional — graceful degradation): `OPENROUTESERVICE_API_KEY`
  (server-only geocode/routing), `NEXT_PUBLIC_MAPTILER_KEY` (public,
  domain-locked basemap key), `GEO_PROVIDER` (`ors` default; `stub` = hermetic
  test fixtures, rejected in prod)

Not validated by `env.ts` — read directly from `process.env` by scripts/tests:

- `ADMIN_PASSWORD` — consumed only by the admin-bootstrap CLI
  (`src/lib/cli/ensure-admin.ts`), never by the running app.
- `DISABLE_RATE_LIMIT` — test-only toggle read in `src/lib/auth/better-auth.ts`;
  required for E2E fixtures (see `docs/testing.md`).
- `ISOMETRIC_DEMO_PROJECT_ID` — CI/staging smoke-test target.

### The three environment items intentionally differ

The `local`, `staging`, and `production` 1Password items are **not** copies of
each other. `local` has its own `DATABASE_URL` (Docker Postgres),
`NEXT_PUBLIC_APP_URL` (`localhost:3100`), dev admin credentials, and test
toggles (`DISABLE_RATE_LIMIT`).

Before debugging any env/auth issue, **state your assumptions about local vs.
deployed config and confirm them against the right item.** The `op` CLI needs
interactive desktop approval — a sandboxed shell can't reproduce 1Password auth,
so ask the user to run `op` commands themselves (`! op …`) rather than
diagnosing around a sign-in you can't perform.

### Storage endpoint gotcha — non-AWS regions need `STORAGE_ENDPOINT`

With `STORAGE_ENDPOINT` unset, the AWS SDK derives the host from
`STORAGE_REGION` on `amazonaws.com`. A DigitalOcean Spaces region (`fra1`,
`nyc3`, …) then mints presigned URLs against a hostname that does not exist
(`bucket.s3.fra1.amazonaws.com` → `ENOTFOUND`) — every upload fails at the
browser PUT. `src/config/env.ts` fails env parse when a known DO region is
configured without an endpoint, so a misconfigured deploy refuses to boot
instead of silently minting phantom URLs.

Fixing an affected environment: add `STORAGE_ENDPOINT`
(e.g. `https://fra1.digitaloceanspaces.com`) to the environment's 1Password
item, sync it to the deploy platform, and add the field to
`.github/workflows/storage-health.yml` and `.env.tpl` so the smoke test and
drift check cover it. Do the env fix **before** deploying, or the parse
guard will fail the app closed at boot. `pnpm storage:smoke` (run with the
target environment's storage vars via `op run`) verifies the full presigned
round-trip; it does not exercise browser CORS.

## Secrets Management

Secrets live in **1Password** (vault `Environment Variables`), never in the repo. One item per environment, with fields named exactly like the env vars:

- `noma-dmrv env staging`, `noma-dmrv env production`, `noma-dmrv env local`

Three consumers read those items:

- **Local dev** — `pnpm env:local` (`scripts/env-local-inject.ts`) injects `.env.local.tpl` into `.env.local` via `op inject`. `.env.local.tpl` is tracked and holds `op://Environment Variables/noma-dmrv env local/<VAR>` references (machine-local values: localhost DB/app URLs, dev admin credentials, test toggles, geo keys); the injected `.env.local` is gitignored. `.env.tpl` is the separate, deployment-facing template — it references the staging item and feeds only the Vercel sync, never a local file.
- **Vercel** — `pnpm env:vercel`
  (`scripts/sync-env-to-vercel.ts`) pushes the production item into Vercel
  Production and the staging item into Vercel Preview. Vercel Development is not
  synced.
- **GitHub Actions** — `e2e.yml`, `isometric-health.yml`, and `migrate.yml` resolve `op://` references via `1password/load-secrets-action`, authenticating with a single repo secret **`OP_SERVICE_ACCOUNT_TOKEN`** — a read-only 1Password Service Account scoped to the `Environment Variables` vault. It replaces all per-secret Actions secrets; `CLAUDE_CODE_OAUTH_TOKEN` is the only other one. Staging jobs read the staging item, production jobs the production item. The e2e/health load steps are gated on `OP_SERVICE_ACCOUNT_TOKEN != ''` so fork PRs (which can't read secrets) skip cleanly.

### Per-organization Isometric credentials

Runtime registry credentials are stored per organization in
`certifier_credentials`. The access token and client secret are encrypted at
rest with AES-256-GCM using `CREDENTIALS_ENCRYPTION_KEY`; only masked status
(configured, access-token last four characters, and update time) may cross a
server-action boundary. Platform Admins manage these write-only values from the
organization admin area. Certification readiness and live submission fail
closed when the active organization has no credential row.

`CREDENTIALS_ENCRYPTION_KEY` is a server-only 32-byte hex or base64 key sourced
from 1Password. It has been added to both `noma-dmrv env staging` and
`noma-dmrv env production` and synced to Vercel. Keep the same key while
stored rows exist; rotating it requires re-encrypting or replacing every
organization's credentials.

`ISOMETRIC_ACCESS_TOKEN` and `ISOMETRIC_CLIENT_SECRET` are no longer runtime app
credentials. They remain seed/CI-only: `db:ensure-admin` uses the pair to seed
the default organization's encrypted row when all three values (including the
encryption key) are present. The read-only `isometric-health.yml` workflow uses
its dedicated pair directly through `getIsometricClientFromEnv`; it has no app
database and intentionally receives no `CREDENTIALS_ENCRYPTION_KEY`.

The production bootstrap is a **manual, one-off job**, not part of the automatic
deployment path. Pushes to `main` run `migrate-production`, which loads only
`DATABASE_URL` — schema migrations never depend on the admin/registry fields, so
a renamed 1Password field cannot block them. To initialize a fresh production
database, dispatch `migrate.yml` on `main` with action `bootstrap-production` and
the confirmation phrase `BOOTSTRAP PRODUCTION`. That job loads the admin and
Isometric bootstrap fields and runs `db:ensure-admin` with `NODE_ENV=production`,
creating the Platform Admin, the default organization, and the encrypted
per-organization registry credentials, while explicitly skipping the shared
local/test teammate.

The bootstrap is idempotent and never clobbers live state: in production it
leaves an existing admin credential account's password untouched and inserts
registry credentials only when none exist, so operator rotations survive. It
fails loudly instead of silently degrading — a missing or blank
`ISOMETRIC_ACCESS_TOKEN`, `ISOMETRIC_CLIENT_SECRET`, or
`CREDENTIALS_ENCRYPTION_KEY` throws rather than exiting 0 with no credential row.
The Platform Admin must use the organization invitation flow to add the first
real Owner.

Notes:

- Rotating a secret = edit the 1Password item. No GitHub or Vercel change needed.
- Vercel Production/Preview secrets are synced as sensitive, while
  `NEXT_PUBLIC_*` variables are synced as non-sensitive. Local
  `vercel build --target=preview` cannot reconstruct sensitive values from
  Vercel; use local env injection for local builds.
- Two CI-only fields are **not** in `.env.tpl`, so they aren't pulled locally and must be set directly on the items: `ISOMETRIC_DEMO_PROJECT_ID` (staging) and `ADMIN_PASSWORD` (both items).
- **Optional vars may be missing from an item.** Both sync scripts pre-check the item's field names and skip template refs with no matching field (per-var warning) instead of letting `op inject` hard-fail. They abort only when a **required** field is missing — `REQUIRED_LOCAL_VARS` / `REQUIRED_DEPLOYED_VARS` in `scripts/env-tpl-utils.ts`, the vars `src/config/env.ts` cannot boot without. `pnpm env:check` reports the same split (missing-optional is advisory; missing-required exits 1).
- `load-secrets-action` **fails the step** when a referenced `op://` field doesn't exist — it does not skip. Add the field before the workflow runs.

### Post-reset staging runbook — restore the Isometric integration

Both staging reset actions in `migrate.yml` (`reset-seed-staging` and
`reset-empty-staging`) load only `DATABASE_URL` + `ADMIN_EMAIL`/`ADMIN_PASSWORD`
— deliberately not the Isometric trio — so `db:ensure-admin` skips the
credential-row seed. After every staging reset the app therefore has **no
organization registry credentials and no facility→project link**: Certification
Settings shows `Credentials: Not configured` and the Removals hub redirects to
Settings (fail-closed, working as designed; observed in
`docs/qa/2026-07-15-qa-staging-production-chain.md`, B1).

Manual restore steps (Platform Admin, staging UI):

1. **Credentials** — organization admin area → enter the sandbox access token
   and client secret from the `noma-dmrv env staging` 1Password item
   (`ISOMETRIC_ACCESS_TOKEN` / `ISOMETRIC_CLIENT_SECRET` fields). The deployed
   env must already have `CREDENTIALS_ENCRYPTION_KEY` (it does; see above).
2. **Project link** — Certification Settings → link the facility to the
   sandbox project (`ISOMETRIC_DEMO_PROJECT_ID` field on the staging item) and
   its removal template.
3. **Verify** — Certification Settings health shows the credential as
   configured and the Removals hub loads without redirecting.

Automating this in the reset workflows was considered and deliberately not
built (decision 2026-07-15): the manual step keeps sandbox tokens out of the
reset path and forces an explicit check that staging points at the intended
sandbox project after a wipe.

### Never expose real keys

- Never put real keys in code, comments, or docs — use the placeholder
  `<REDACTED_API_KEY>` when an example needs one.
- **If a key leaks:** rotate it immediately (edit the 1Password item), then
  scrub it from git history with `git-filter-repo`.
- Review PR diffs for accidental secret exposure before merging.

## Dependency Supply Chain

Two layers of protection against compromised npm packages (configured 2026-06-11):

**Release-age cooldown** — `pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` (3 days, in minutes). The resolver ignores versions published less than 3 days ago, so `pnpm update`/`pnpm install` never picks up a freshly published (potentially compromised) release. Most registry compromises are detected and yanked within hours. No workflow change: run `pnpm update` whenever — it just sees a 3-day-delayed registry.

**Build-script gating** — `allowBuilds` in `pnpm-workspace.yaml` allowlists the only packages permitted to run install scripts (the most common malware payload vector). New packages needing build scripts must be added there deliberately.

**Dependabot (security-only)** — Dependabot alerts + security updates are enabled on the repo. `.github/dependabot.yml` sets `open-pull-requests-limit: 0`, which disables routine version-bump PRs; only security-fix PRs are opened. Severity filtering (e.g. critical-only) is done via auto-triage rules in repo Settings → Advanced Security → Dependabot, not in `dependabot.yml`.

Handling a security PR that needs code changes:

- CI green → merge as-is.
- CI red → `gh pr checkout <n>`, fix the code, push to the same branch (Dependabot stops rebasing once you push). Bump + adaptation merge together.
- Major migration → close the Dependabot PR and do it as normal feature work; Dependabot auto-closes once the lockfile is no longer vulnerable.

If a patched version is younger than the 3-day cooldown, add a temporary per-package exception instead of lowering the global setting:

```yaml
minimumReleaseAgeExclude:
  - vulnerable-pkg # remove after updating
```

## Minimal Security Test Checklist

- Unauthorized API requests are blocked.
- Signup policy follows `ALLOW_SELF_SIGNUP`.
- Admin routes reject non-admin users.
- Data-access functions do not leak unauthenticated data.
- Logs contain stable IDs, not emails, names, tokens, or secrets.
