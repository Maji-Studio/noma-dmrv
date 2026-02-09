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
- Project-scoped pages enforce membership in layout and data-access.

## Signup Policy

- `ALLOW_SELF_SIGNUP=false` disables public signup (`emailAndPassword.disableSignUp=true`).
- `ALLOW_SELF_SIGNUP=true` enables public signup.

## Guard Examples

```ts
// project membership guard
await requireProjectMember(projectId, userId);

// admin guard
await requireAdmin();
```

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
- Non-members cannot access project data.
- Signup policy follows `ALLOW_SELF_SIGNUP`.
- Project creation writes owner membership.
