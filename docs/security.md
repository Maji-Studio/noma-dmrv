# Security Best Practices

What this covers: the security invariants an implementer must not violate — org
tenancy scoping, error/log handling, env validation and fail-closed gates, and
secrets management. Read it before touching `data-access/`, `src/config/env.ts`,
or anything that reads a 1Password item. Route protection, guards and signup
policy live in [auth.md](./auth.md); the tenancy rationale in
[ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md).

## Non-Negotiables

1. Never commit secrets — document env var **names** only, never values, in code,
   comments, docs or tests.
2. Validate user input with Zod (see [forms.md](./forms.md)).
3. Enforce authorization in the data-access layer — every function calls an auth
   guard and scopes by organization.
4. Never log PII (emails, names, tokens) — log stable IDs. The server logger
   redacts as a backstop, not a license ([architecture.md](./architecture.md)).
5. Prefer the Drizzle query builder over raw SQL.

## Tenancy — the #1 invariant

Multi-tenancy **is implemented**. Every domain table carries
`organizationId NOT NULL`, enforced across ~211 `src/data-access/` functions.
Organization is the tenant boundary; facilities are org-owned and facility
context scopes workflows *within* an org.

- **`organizationId` is always stamped server-side from the session's active
  organization — never accepted from client input and never present in a Zod
  form/payload schema.** Adding it to a schema is the default mistake.
- Guards and helpers: `requireOrgScope`, `assertSameOrg`, `requireOrgFacility`
  (`src/data-access/utils.ts`); `requireOrgContext`, `requireOrgRole`,
  `requirePlatformAdmin` (`src/lib/auth/server.ts`). Full guard surface —
  including `requireAuth` / `requireVerifiedAuth` / `requireAdmin` /
  `requireAdminAction` — is documented in [auth.md](./auth.md).
- **Platform Admins bypass org-membership checks entirely** (`requireOrgRole`
  returns early when `ctx.isPlatformAdmin`). Org isolation is policy toward other
  organizations, not toward the platform — the platform-admin path is not a leak.
- The org column is deliberately denormalized so the enforcement point is a
  uniform, greppable `WHERE organizationId = ctx.orgId`. **New data-access
  functions must follow that uniform pattern, not derive org through a join
  chain** — that missed-join leak class has already occurred once
  (`getSupplierOptions`). See [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md)
  and [organization.md](./organization.md).
- `assertSameOrg` callers inside a transaction MUST pass their `tx` as
  `executor`, or the pool starves under parallel load.
- Coverage: `tests/e2e/org-isolation.spec.ts`,
  `tests/e2e/organization-settings.spec.ts`.

## Server-Action Error Handling

Raw Drizzle/Postgres error text (SQL plus bound parameter values) must never
reach the client — bound values are arbitrary user-entered data and can
themselves be PII. `fn/` catch blocks route unexpected errors through
`toLoggedActionError` (`src/fn/action-errors.ts`): the real error is logged
server-side, and the client only ever receives a `SafeError`, a Zod validation
message, or a generic fallback. `sanitizeErrorMessage` (`src/lib/log`) redacts
everything from a query's `params:` marker onward before logging, so bound values
never land in server logs either — only the parameterized SQL shape.

Mass-input schemas use the shared caps in `src/schemas/helpers.ts`
(`MASS_INPUT_MAX_*`) so overflows are rejected by Zod before surfacing as raw DB
errors; integer/count fields use `PG_INTEGER_MAX` where they map to Postgres
integer columns.

## Environment Variables

**Canonical list: the `envSchema` object in `src/config/env.ts`.** Templates:
`.env.local.tpl` (local 1Password item) and `.env.tpl` (staging item → Vercel
sync). The app refuses to boot on an invalid or missing required var.

Non-obvious semantics only:

- **Both-or-neither pairs** (`superRefine`): `RESEND_API_KEY` +
  `RESEND_FROM_EMAIL`; `ISOMETRIC_ACCESS_TOKEN` + `ISOMETRIC_CLIENT_SECRET`
  (seed/CI-only, not runtime app credentials).
- **`CREDENTIALS_ENCRYPTION_KEY`** — a hard boot requirement in production (see
  CI carve-out below). Server-only 32-byte hex/base64 key.
- **`BETTER_AUTH_SECRET`** and **`STORAGE_SIGNING_SECRET`** — min length 32. In
  dev/test the local-fs provider falls back to an **ephemeral random signing
  secret** with a warning, so locally-signed URLs silently break across restarts.
- **`STORAGE_PREFIX`** — path-traversal validator: no leading `/`, no `//`, no
  `..` or `.` segments, no trailing `/`, restricted charset.
- **`STORAGE_ENDPOINT`** — DigitalOcean Spaces regions require it; env parse
  fails closed rather than minting phantom `amazonaws.com` URLs. See
  [storage.md](./storage.md).
- **`DURABILITY_MEASUREMENT_SAMPLES_LIVE`** — sandbox-only; rejected otherwise.
- **`GEO_PROVIDER`** — `ors` default, `stub` = hermetic test fixtures. See
  [ADR 0009](./adr/0009-provider-agnostic-server-proxied-geo.md).

Read directly from `process.env`, **not** validated by `env.ts`:

- `ADMIN_PASSWORD` — consumed only by the admin-bootstrap CLI
  (`src/lib/cli/ensure-admin.ts`), never by the running app.
- `DB_RESET_ALLOW_REMOTE` — consumed only by the database-reset CLI. Only the
  literal string `"true"` permits a remote reset; the manually confirmed staging
  and production reset jobs load it from their matching 1Password item.
- `DISABLE_RATE_LIMIT` — rate limiting is **opt-out** via a bare
  `process.env.DISABLE_RATE_LIMIT !== "true"` read
  (`src/lib/auth/better-auth.ts`). A typo fails safe (limits stay ON), but only
  the literal string `"true"` disables them; E2E fixtures depend on that exact
  literal ([testing.md](./testing.md)).
- `ISOMETRIC_DEMO_PROJECT_ID` — CI/staging smoke-test target.

Both `ADMIN_PASSWORD` and `ISOMETRIC_DEMO_PROJECT_ID` **are** pulled locally via
`.env.local.tpl`; they are absent from the deployment-facing `.env.tpl` only and
must be set directly on the staging/production items.

### CI carve-out on the production fail-closed gates

All three production gates — `GEO_PROVIDER=stub`, non-`s3-compatible` storage,
and missing `CREDENTIALS_ENCRYPTION_KEY` — are **skipped when `CI` is truthy**,
because hermetic e2e builds a production bundle on purpose. CI local-fs storage
is additionally only allowed against a localhost `NEXT_PUBLIC_APP_URL`. Real
deployments never run with `CI` set, so the safeguards hold where they matter.

### The three environment items intentionally differ

The `local`, `staging`, and `production` 1Password items are **not** copies of
each other. `local` has its own `DATABASE_URL` (Docker Postgres),
`NEXT_PUBLIC_APP_URL` (`localhost:3100`), dev admin credentials, and test
toggles.

**The `op` CLI needs interactive desktop approval — a sandboxed shell cannot
reproduce 1Password auth.** Ask the user to run `op` commands themselves
(`! op …`) rather than diagnosing around a sign-in you can't perform. Before
debugging any env/auth issue, state your assumptions about local vs. deployed
config and confirm them against the right item.

## Secrets Management

Secrets live in **1Password** (vault `Environment Variables`), never in the repo.
One item per environment — `noma-dmrv env {local,staging,production}` — with
fields named exactly like the env vars. Three consumers:

- **Local dev** — `pnpm env:local` (`scripts/env-local-inject.ts`) injects
  `.env.local.tpl` into the gitignored `.env.local` via `op inject`.
- **Vercel** — `pnpm env:vercel` (`scripts/sync-env-to-vercel.ts`) pushes the
  production item to Vercel Production and staging to Vercel Preview. Vercel
  Development is not synced.
- **GitHub Actions** — `e2e-live.yml`, `isometric-health.yml`,
  `storage-health.yml` and `migrate.yml` resolve `op://` references via
  `1password/load-secrets-action`, authenticating with the single repo secret
  **`OP_SERVICE_ACCOUNT_TOKEN`** (read-only Service Account scoped to that
  vault). `CLAUDE_CODE_OAUTH_TOKEN` is the only other repo secret. Load steps are
  gated on `OP_SERVICE_ACCOUNT_TOKEN != ''` so fork PRs skip cleanly. Plain
  `e2e.yml` uses no 1Password secrets at all.

Notes:

- Rotating a secret = edit the 1Password item. No GitHub or Vercel change needed.
- Vercel Production/Preview secrets sync as sensitive; `NEXT_PUBLIC_*` as
  non-sensitive. Local `vercel build --target=preview` cannot reconstruct
  sensitive values — use local env injection for local builds.
- **Optional vars may be missing from an item.** Both sync scripts skip template
  refs with no matching field (per-var warning) and abort only on a missing
  **required** field (`REQUIRED_LOCAL_VARS` / `REQUIRED_DEPLOYED_VARS` in
  `scripts/env-tpl-utils.ts`). `pnpm env:check` reports the same split.
- `load-secrets-action` **fails the step** when a referenced `op://` field does
  not exist — it does not skip. Add the field before the workflow runs.
- Never put real keys in code, comments, or docs — use `<REDACTED_API_KEY>` in
  examples. If a key leaks: rotate it in 1Password immediately, then scrub git
  history with `git-filter-repo`.

### Per-organization Isometric credentials

Runtime registry credentials are stored per organization in
`certifier_credentials`, encrypted at rest with AES-256-GCM using
`CREDENTIALS_ENCRYPTION_KEY`. Only masked status (configured, access-token last
four, update time) may cross a server-action boundary. Platform Admins manage
these write-only values from the organization admin area. Certification readiness
and live submission **fail closed** when the active organization has no
credential row. Keep the same key while stored rows exist — rotating it requires
re-encrypting or replacing every organization's credentials.

`ISOMETRIC_ACCESS_TOKEN` / `ISOMETRIC_CLIENT_SECRET` are seed/CI-only:
`db:ensure-admin` seeds the default organization's encrypted row when all three
values are present, and `isometric-health.yml` uses its dedicated pair through
`getIsometricClientFromEnv` (no app database, no encryption key by design). See
[isometric/README.md](./isometric/README.md).

### Database dispatch actions (`migrate.yml`)

Pushes to `main` run `migrate-production`, which loads only `DATABASE_URL` — a
renamed 1Password field cannot block schema migrations. Everything destructive is
a manual `workflow_dispatch` with a typed confirmation phrase:

| action | confirmation |
| --- | --- |
| `reset-seed-staging` | `RESET AND SEED STAGING` |
| `reset-empty-staging` | `RESET STAGING (EMPTY)` |
| `bootstrap-production` | `BOOTSTRAP PRODUCTION` |
| `reset-production` | `RESET PRODUCTION` + `authorized` checkbox |

`reset-production` wipes production and is the most dangerous operation in the
repo — it requires the explicit `authorized` approval checkbox in addition to the
phrase.

`bootstrap-production` runs `db:ensure-admin` with `NODE_ENV=production`, creating
the Platform Admin, the default organization and encrypted registry credentials,
skipping the shared local/test teammate. It is idempotent and never clobbers live
state (existing admin password untouched; credentials inserted only when none
exist) and fails loudly rather than exiting 0 without a credential row. The
Platform Admin must use the organization invitation flow to add the first real
Owner.

**Staging resets deliberately do not load the Isometric trio**, so after a reset
the org has no registry credentials and no facility→project link: Certification
Settings shows `Credentials: Not configured` and the Removals hub fails closed by
redirecting to Settings. Restore manually via the organization admin area
(credentials from the staging item) and Certification Settings (project link).

## Operational Defaults

- Better Auth rate limits are on by default, stricter for auth-sensitive
  endpoints.
- DB pool limits are centralized in `src/db/index.ts`, configurable via env.

## Dependency Supply Chain

- **Release-age cooldown** — `minimumReleaseAge` in `pnpm-workspace.yaml` makes
  the resolver ignore freshly published versions, so `pnpm update`/`install`
  cannot pick up a just-compromised release. Use a per-package
  `minimumReleaseAgeExclude` entry if a security patch is younger than the
  cooldown; never lower the global setting.
- **Build-script gating** — `allowBuilds` in `pnpm-workspace.yaml` allowlists the
  only packages permitted to run install scripts.
- **Dependabot (security-only)** — `.github/dependabot.yml` sets
  `open-pull-requests-limit: 0`, disabling routine version bumps; only
  security-fix PRs open. Severity filtering lives in repo Settings → Advanced
  Security auto-triage rules, not in `dependabot.yml`.
