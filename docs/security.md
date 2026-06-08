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

## Minimal Security Test Checklist

- Unauthorized API requests are blocked.
- Signup policy follows `ALLOW_SELF_SIGNUP`.
- Admin routes reject non-admin users.
- Data-access functions do not leak unauthenticated data.
- Logs contain stable IDs, not emails, names, tokens, or secrets.
