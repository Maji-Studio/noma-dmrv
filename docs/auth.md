# Authentication

Better Auth (email/password, email verification, password reset, invite-first signup) plus the org-scoping layer built on the Better Auth organization plugin. Read this before touching a guard, a server action's auth line, the proxy, or anything that reads `activeOrganizationId`. This doc owns the guard vocabulary — [architecture.md](./architecture.md) defers to it. Env vars and signup policy: [security.md](./security.md). Auth email delivery: [mail-setup.md](./mail-setup.md). Tenancy rationale: [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md).

Guards live in `src/lib/auth/server.ts`; the client hook `useAuth` is exported from `src/lib/auth/client.ts` (**not** from `providers/better-auth-client.ts`, which exports only `authClient`, types, and raw helpers).

## The redirect-vs-throw invariant

`requireAuth()` / `requireVerifiedAuth()` / `requireAdmin()` call `redirect()`, which throws a `NEXT_REDIRECT` control-flow signal. `withAction` catches it after the callback stops and converts it into a generic action failure, so the user sees a confusing error instead of a redirect and the redirecting guard silently does not do its job. A hand-written catch that continues execution would be a real auth bypass.

- Layouts and pages → `requireAuth()`, `requireVerifiedAuth()`, `requireAdmin()` (redirecting).
- Server actions and anything inside try/catch → `requireOrgContext()`, `requireAdminAction()` / `requirePlatformAdmin()` (throw `SafeError`). `requirePlatformAdmin` is an alias for `requireAdminAction`.

`requireAdmin` and `requirePlatformAdmin` are **not** interchangeable.

## Next.js 16 proxy

Next.js 16 uses `src/proxy.ts` (Node runtime, so Better Auth can use Node crypto) instead of `middleware.ts`. It delegates to `updateSession()` in `src/lib/auth/middleware.ts`, which is the authority on route access:

- `PUBLIC_ROUTES` — reachable signed out. Includes `/schema` and `/api/storage-local` alongside the auth pages. Matching is prefix-based (`pathname === route || pathname.startsWith(route + "/")`), so every descendant is public too.
- `AUTH_ROUTES` — only `/login` and `/forgot-password`; authenticated users are redirected to `/dashboard`. `/reset-password` and `/set-password` are public but **not** auth routes, deliberately: a signed-in user must be able to follow an invite's set-password link.
- Unverified sessions are redirected to `/verify-email` (403 JSON for `/api/*`). `requireAuth()` does **not** check `emailVerified` — the `(app)` layout calls bare `requireAuth()`, so verification enforcement there comes entirely from the proxy. Use `requireVerifiedAuth()` where the page itself must guarantee it.
- `/admin/*` is gated by the admin layout's `requireAdmin()`.

## Roles and active organization

`users.role` distinguishes a global Platform Admin (`admin`) from a normal user (`user`). Organization membership lives in `members` with the hierarchy Owner ⊃ Admin ⊃ Member. See [organization.md](./organization.md).

- **Session cookie cache is on with `maxAge: 5 * 60`.** Changes to cached session fields — notably an org switch's `activeOrganizationId` — can take up to 5 minutes to show up. `getOrgContext()` re-reads membership on every call, so revocations are immediate. `getUser()` deliberately re-reads `users.role` from the DB, so `requireAdmin` is not subject to this lag.
- **`getOrgContext()` returns `null`, it does not throw,** when an `activeOrganizationId` is set but the user is neither a member nor a Platform Admin. Do not read `null` as "signed out".
- **`OrgContext.orgRole` is `null` for a Platform Admin acting inside an org they don't belong to.** Never compare or rank `ctx.orgRole` directly — that wrongly denies Platform Admins. Use `requireOrgRole(ctx, minRole)`, which short-circuits on `isPlatformAdmin` first.
- **How `activeOrganizationId` gets set:** every successful explicit switch persists `users.lastActiveOrganizationId`. On session creation, the hook restores that organization only after revalidating current access. If it is missing or stale, ordinary users receive their first membership ordered by membership creation time then id; Platform Admins receive the first organization ordered by organization creation time then id. Users with no accessible organizations remain without an active org. The saved id is a preference, never an authorization grant.
- **`allowUserToCreateOrganization: false`** — orgs are created only through the Platform-Admin-guarded server action, which makes the *selected* user the Owner, not the acting admin. `afterCreateOrganization` seeds starter types via `seedOrgDefaults` and deliberately swallows failures rather than wedging the create.
- **`users.role` is declared `input: false`** on the Better Auth additionalField, so it can never be set through self-service signup. Role is assigned only by the admin-bootstrap CLI (`src/lib/cli/ensure-admin-core.ts`) or a Platform Admin path.

## Server actions

`withAction` resolves `requireOrgContext()` for you and hands the callback `ctx`. Do not call it again by hand. Nearly all exported server actions end in `Fn` (e.g. `createFacilityFn`); `src/fn/organizations.ts` uses the `Action` suffix.

```ts
export async function getProductionProcessSummariesByFacilityFn(facilityId: string) {
  return withAction(async (ctx) => {
    await requireOrgFacility(ctx, facilityId);
    return getProductionProcessSummariesByFacility(ctx, facilityId);
  });
}
```

`requireOrgRole(ctx, …)` is for admin-gated org/certification operations only — CRUD actions do not assert `"member"`, since any resolvable `OrgContext` is already at least a member or a Platform Admin.

## Tenancy in data-access

Data-access functions take an `OrgContext` and call `requireOrgScope(ctx)` — they never call `requireAuth()`. Auth is resolved once, above, by `requireOrgContext()`.

- **`requireOrgScope(ctx)` is not the tenancy filter.** It only asserts `userId`/`organizationId` are non-empty strings. Isolation comes from the explicit `eq(table.organizationId, ctx.organizationId)` in every WHERE clause. Calling `requireOrgScope` and forgetting the WHERE clause is exactly the leak class [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md) describes.
- **`assertSameOrg()` must be passed the current `tx` as its `executor`** when called inside a transaction — reading through the global pool from inside a transaction starves the pool under parallel load. See `src/data-access/utils.ts`.
- `organizationId` is never accepted from form data; cross-org IDs resolve as absent rather than disclosing another org's data.

Registry credentials are owned per organization and managed by its Owners and Admins (and by Platform Admins), gated on the server-computed `viewerCanManage` rather than on `users.role`. Ordinary members use them through scoped certification flows but cannot read or replace the stored secrets.

## Rate limiting

Two distinct limiters — a real trip hazard:

1. Better Auth's limiter (`src/lib/auth/better-auth.ts`) is on unless `DISABLE_RATE_LIMIT === "true"` (how E2E disables it — see [testing.md](./testing.md)), with tightened custom rules on `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.
2. `withAction` has an opt-in per-user in-memory limiter (`options.rateLimit`) for expensive actions only.

## Invitations

Organization Admins and Owners invite from organization settings; Better Auth enforces invitation and membership changes server-side. Re-inviting the same email cancels the stale pending invite. Email delivery is best-effort — the inviter always gets a copyable accept link. `/admin/users` redirects to `/settings/organization`.
