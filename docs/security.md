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

## Operational Defaults

- Better Auth rate limits are enabled with stricter rules for auth-sensitive endpoints.
- DB pool limits are centralized in `src/db/index.ts` and configurable via env.

## Secrets Management

Secrets live in **1Password** (vault `Environment Variables`), never in the repo. One item per environment, with fields named exactly like the env vars:

- `noma-dmrv env staging`, `noma-dmrv env production` (and `dev`)

Three consumers read those items:

- **Local dev** — `pnpm env:local` runs `op inject -i .env.tpl -o .env`. `.env.tpl` is tracked and holds `op://Environment Variables/noma-dmrv env staging/<VAR>` references; values resolve at runtime, never committed.
- **Vercel** — `pnpm env:vercel`
  (`scripts/sync-env-to-vercel.ts`) pushes the production item into Vercel
  Production and the staging item into Vercel Preview. Vercel Development is not
  synced.
- **GitHub Actions** — `e2e.yml`, `isometric-health.yml`, and `migrate.yml` resolve `op://` references via `1password/load-secrets-action`, authenticating with a single repo secret **`OP_SERVICE_ACCOUNT_TOKEN`** — a read-only 1Password Service Account scoped to the `Environment Variables` vault. It replaces all per-secret Actions secrets; `CLAUDE_CODE_OAUTH_TOKEN` is the only other one. Staging jobs read the staging item, production jobs the production item. The e2e/health load steps are gated on `OP_SERVICE_ACCOUNT_TOKEN != ''` so fork PRs (which can't read secrets) skip cleanly.

Notes:

- Rotating a secret = edit the 1Password item. No GitHub or Vercel change needed.
- Vercel Production/Preview secrets are synced as sensitive, while
  `NEXT_PUBLIC_*` variables are synced as non-sensitive. Local
  `vercel build --target=preview` cannot reconstruct sensitive values from
  Vercel; use local env injection for local builds.
- Two CI-only fields are **not** in `.env.tpl`, so they aren't pulled locally and must be set directly on the items: `ISOMETRIC_DEMO_PROJECT_ID` (staging) and `ADMIN_PASSWORD` (both items).
- `load-secrets-action` **fails the step** when a referenced `op://` field doesn't exist — it does not skip. Add the field before the workflow runs.

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
