# Authentication

Better Auth 1.7.7 (email/password, email verification, password reset, invite-first signup) plus the org-scoping layer built on the Better Auth organization plugin. Read this before touching a guard, a server action's auth line, the proxy, or anything that reads `activeOrganizationId`. This doc owns the guard vocabulary — [architecture.md](./architecture.md) defers to it. Env vars and signup policy: [security.md](./security.md). Auth email delivery: [mail-setup.md](./mail-setup.md). Tenancy rationale: [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md).

Guards live in `src/lib/auth/server.ts`; the client hook `useAuth` is exported from `src/lib/auth/client.ts` (**not** from `providers/better-auth-client.ts`, which exports only `authClient`, types, and raw helpers).

## The redirect-vs-throw invariant

`requireAuth()` / `requireVerifiedAuth()` / `requireAdmin()` call `redirect()`, which throws a `NEXT_REDIRECT` control-flow signal. `withAction` catches it after the callback stops and converts it into a generic action failure, so the user sees a confusing error instead of a redirect and the redirecting guard silently does not do its job. A hand-written catch that continues execution would be a real auth bypass.

- Layouts and pages → `requireAuth()`, `requireVerifiedAuth()`, `requireAdmin()` (redirecting).
- Server actions and anything inside try/catch → `requireOrgContext()`, `requireAdminAction()` / `requirePlatformAdmin()` (throw `SafeError`). `requirePlatformAdmin` is an alias for `requireAdminAction`.

`requireAdmin` and `requirePlatformAdmin` are **not** interchangeable.

## Next.js 16 proxy

Next.js 16 uses `src/proxy.ts` (Node runtime, so Better Auth can use Node crypto) instead of `middleware.ts`. It delegates to `updateSession()` in `src/lib/auth/middleware.ts`, which is the authority on route access:

- `PUBLIC_ROUTES` — reachable signed out. Includes `/schema`,
  `/api/storage-local`, and `/api/ghg-statement-reports` alongside the auth
  pages, including `/accept-invitation`. The invitation page and bootstrap action
  enforce token validity, expiry, existing-account routing, and signed-in email
  ownership. Matching is prefix-based
  (`pathname === route || pathname.startsWith(route + "/")`), so every
  descendant is public too.
- `AUTH_ROUTES` — only `/login` and `/forgot-password`; authenticated users are redirected to `/dashboard`. `/reset-password` and `/set-password` are public but **not** auth routes, deliberately: a signed-in user must be able to follow an invite's set-password link.
- Unverified sessions are redirected to `/verify-email` (403 JSON for `/api/*`). `requireAuth()` does **not** check `emailVerified` — the `(app)` layout calls bare `requireAuth()`, so verification enforcement there comes entirely from the proxy. Use `requireVerifiedAuth()` where the page itself must guarantee it.
- `/admin/*` is gated by the admin layout's `requireAdmin()`.
- The proxy lets exact `/api/mcp`, `/api/v1`, and `/api/v1/*` through before session lookup. MCP and private REST routes resolve bearer API keys with `resolveApiContext`. MCP validates Origin before admission, uses the shared pre-auth and authenticated read/write rate limits, and lists only tools allowed by the credential scopes. `/api/v1x`, `/api/mcpx` and `/api/mcp/tools` stay behind the session, covered by `tests/middleware.test.ts`. See [MCP tools](./architecture.md#mcp-tools-on-api-keys) for write tools, requestKey, dryRun, server instructions and the in-MCP `api_writes_disabled` result.

### Public verifier report capability

`GET /api/ghg-statement-reports/[reportId]?token=…` is intentionally public at
the middleware layer because an external verifier may not have a noma account.
It does **not** make the report public by id:

- the report id selects one `certifier_ghg_statement_reports` row and the token
  is checked against that row's stored SHA-256 digest with a timing-safe
  comparison;
- plaintext tokens are returned only when a new verifier URL is issued;
  reissuing rotates the digest and revokes the previous URL;
- missing rows, bad ids/tokens, and incomplete uploads fail without disclosing
  another organization (the route uses 404 for capability failures);
- a valid capability receives a 302 to a freshly signed private-storage URL,
  with `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`.

The lookup in `src/data-access/ghg-statement-reports.ts` deliberately lacks an
`OrgContext` and carries the exact `// org-scope-ok:` waiver because the
unguessable bearer token is the authorization boundary. This is the only
cross-org verifier seam; every authenticated workspace and document read keeps
normal organization scoping.

## Roles and active organization

`users.role` distinguishes a global Platform Admin (`admin`) from a normal user (`user`). Organization membership lives in `members` with the hierarchy Owner ⊃ Admin ⊃ Member. See [organization.md](./organization.md).

- **Session cookie cache is on with `maxAge: 5 * 60`.** Changes to cached session fields — notably an org switch's `activeOrganizationId` — can take up to 5 minutes to show up. `getOrgContext()` re-reads membership on every call, so revocations are immediate. `getUser()` deliberately re-reads `users.role` from the DB, so `requireAdmin` is not subject to this lag.
- **`getOrgContext()` returns `null`, it does not throw,** when an `activeOrganizationId` is set but the user is neither a member nor a Platform Admin. Do not read `null` as "signed out".
- **`resolveOrgContext()` is the same resolution with the reason attached** — `{ ok: true, ctx }`, or `{ ok: false, denial }` where `denial` is `"unauthenticated"` (no session) or `"no-organization"` (signed in, but no active organization or not a member of it). `getOrgContext()` and `requireOrgContext()` are thin wrappers over it and discard the reason. Only an HTTP transport needs it: the private read handlers (`src/app/api/reads/read-response.ts`) answer **401** for `"unauthenticated"` and **403** for `"no-organization"`, because a signed-out caller can fix it by signing in and a wrongly-scoped one cannot. Server actions have no status code to choose and keep using `requireOrgContext()`. Both denials are authorization answers, never a 400.
- **`OrgContext.orgRole` is `null` for a Platform Admin acting inside an org they don't belong to.** Never compare or rank `ctx.orgRole` directly — that wrongly denies Platform Admins. Use `requireOrgRole(ctx, minRole)`, which short-circuits on `isPlatformAdmin` first.
- **How `activeOrganizationId` gets set:** every successful explicit switch persists `users.lastActiveOrganizationId`. On session creation, the hook restores that organization only after revalidating current access. If it is missing or stale, ordinary users receive their first membership ordered by membership creation time then id; Platform Admins receive the first organization ordered by organization creation time then id. Users with no accessible organizations remain without an active org. The saved id is a preference, never an authorization grant.
- **`allowUserToCreateOrganization: false`** — orgs are created only through the Platform-Admin-guarded server action, which makes the *selected* user the Owner, not the acting admin. `afterCreateOrganization` seeds starter types via `seedOrgDefaults` and deliberately swallows failures rather than wedging the create.
- **The CLI org-context seam is `runWithCliOrgContext` (`src/lib/cli/org-context.ts`).** A CLI (today the Mafinga seed) has no session, so it runs server actions inside an org context written to an `AsyncLocalStorage` that `resolveOrgContext()` reads first. The seam accepts identity IDs only and verifies them itself: the user must hold `users.role = 'admin'` and the organization must exist, and the context it builds is always Owner plus Platform Admin. It refuses to run when `NODE_ENV=production` without `ALLOW_DEV_BOOTSTRAP=1`. The storage lives in `src/lib/auth/cli-org-context-store.ts` and only that CLI module may write to it, so `src/lib/auth/server.ts` exports the read side alone. **Request code must never import either module**: a request resolves its context from the session.
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

Never export a function that takes `ctx: OrgContext` from a `"use server"` file: Next.js makes every export a public action, and a caller-supplied context defeats every guard below it (`requireOrgScope` only checks for non-empty strings; `requireOrgRole` trusts `ctx.isPlatformAdmin`). Trusted-context code lives in directive-free modules; `pnpm check:server-action-exports` enforces it (see [code-style.md](./code-style.md)).

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

## Better Auth schema and credential identity

The Drizzle adapter validates the configured schema at startup and before
requests; keep that validation enabled. Auth table names and
application-specific constraints live in `src/db/schema/auth.ts`.
The account token fields are `accessTokenExpiresAt`, `refreshTokenExpiresAt`
and `scope`.
Drizzle relations describe the auth tables, but native joins remain disabled.

Better Auth signs in only with a credential account whose `account_id`
equals the user id (`accountId === userId`). Every credential creation path
writes this identity: the account-create hook sets it for Better Auth,
including the atomic invitation bootstrap, once the generated user ID is
available; the admin CLI, seeds and direct test fixtures write it directly.

A database whose credential accounts predate this rule must be reset and
reseeded: `pnpm db:reset` then `pnpm db:seed` locally, the
`reset-seed-staging` workflow for staging.

## API credentials

`@better-auth/api-key` 1.7.7 stores hashed, organization-bound credentials in
`api_keys`; `api_key_owners` binds each to its creating user and issuance
membership independently of client-editable metadata. The adapter maps the plugin's `apikey` model to
`apiKeys`. Keys use `noma_live_` when `env.NODE_ENV` is `production` and
`noma_test_` otherwise. Prefixes label the runtime; authorization never depends
on a prefix. Production-mode staging builds also use the live prefix.

Credential management goes through `src/fn/api-keys.ts` (`withAction`, strict
Zod schemas) into `src/data-access/api-keys.ts`. Every management action checks
live, verified Owner/Admin membership. Unlike normal organization actions, a
Platform Admin has **no membership override** here. The organization comes
from the resolved context, never the payload. Creation requires an explicit
`expiresIn` in seconds, at most 365 days; the plugin's defensive default is
90 days. The exported config constants are also available to the management
UI. Updates accept only name and scopes. Revocation disables the key and
records the reason, and no application action can re-enable it. Only creation
returns plaintext. Lists select safe fields explicitly and never return the
key hash or plugin metadata.

The Better Auth `hooks.before` rejects all HTTP `/api/auth/api-key/*` calls,
including create, update, delete, get and list. Only header-free, server-side
`auth.api` calls are allowed. API-key session emulation and the plugin's own
per-key rate limiter are disabled. Last-used timestamps still update during
verification. REST rate budgets belong to the REST transport.

The plugin's organization access control adds `apiKey` management permissions
to Owner/Admin while preserving the existing organization permissions.
`afterRemoveMember` and `afterUpdateMemberRole` disable the affected user's
keys in that organization and record `credential_owner_removed`; promotion or
re-admission does not restore those credentials. Platform Admin membership overrides disable keys in their existing database
transaction as well. Deleting a membership through any path, including self-service
leave and direct deletion, sets the owner's stored membership reference to null.
The resolver requires the live membership ID to match the issuance membership ID;
re-admission cannot restore old keys. Management lists report these keys as disabled,
even when no hook recorded revocation. The resolver also checks the live role,
including when a membership was changed outside these guarded paths.
Disabled keys are kept until they expire; the plugin's key maintenance then
deletes expired keys (decided 2026-10-07). Missing owner records fail closed, including interrupted
issuance and deleted users.

### API key settings

Manage credentials at `/settings/api-keys` in the settings console. Live
organization Owners and Admins can create keys, edit names and permissions,
and revoke keys. Members and Platform Admins without that membership role
see an explanation without management controls. Creation shows the plaintext
once with a copy button; closing the dialog clears it. Revoked keys remain
listed as Disabled until expiry and subsequent plugin maintenance. Edits and
revokes require the loaded `api_key_owners.version`; stale submissions refresh
the list and keep the edit draft. Last-used bookkeeping does not advance that
management version.

### API request context

`resolveApiContext(request)` returns `{ ok: true, ctx: ApiContext }` or
`{ ok: false, denial: ApiContextDenial }`, following the session resolver's
result vocabulary. `ApiContext` extends `OrgContext`: `userId` is the key owner,
`organizationId` is the key organization, `orgRole` is the live membership,
and `isPlatformAdmin` is always false. It also carries `principal`,
`credentialId`, enumerated `scopes`, and safe credential metadata.

Only one `Authorization: Bearer <key>` is accepted. Duplicate Authorization
values and bearer plus `x-api-key` are refused. `x-api-key` alone is unsupported:
`verifyApiKey` accepts a key directly and does not need that header. Cookies
are ignored when a bearer exists, and cookies alone cannot authenticate.
Malformed or invalid bearers never fall back to a session.

The resolver checks the stored hash and live owner state, verifies through
`auth.api.verifyApiKey`, then re-reads credential and membership state before
returning authority. If the plugin refuses a credential that the stored-state
recheck still finds valid, the resolver throws and the route returns a sanitized
500; a confirmed credential denial remains a 401. Membership removal/demotion has a specific denial even
when its hook has disabled the key. The v1 vocabulary is `feedstocks:read`,
`feedstocks:write`, `feedstocks:delete`, and read-only `facilities`, `suppliers`,
`feedstock-types`, `storage-locations`, `vehicles`, and `drivers`. Plugin
permissions are `{ entity: [action] }`; wildcards grant nothing. `hasScope`
checks the credential alone, and `hasRoleAndScope` intersects Owner/Admin with
the requested scope. Operation/domain guards must still enforce the remaining
operation permission.

The proxy passes `/api/v1` and `/api/v1/*` through **before session lookup**,
including requests carrying unverified cookies. `/api/v1x` stays protected.
The existing exact `/api/mcp` exception is unchanged. Every private REST route
must call the API resolver itself; no cookie-based route guard applies there.

`GET /api/v1/openapi.json` and `GET /api/v1/llms.txt` are public discovery routes.
They do not call `resolveApiContext` or the rate-limit guards and cache publicly
for 300 seconds. The proxy passes both exact paths before session lookup.

`GET /api/v1/me` accepts any authenticated key, including an empty scope set.
It returns organization, active facilities with `timeZone` and facility-local
`today` (`YYYY-MM-DD`), role, scopes, and credential id/name/expiry. A read model
calls an organization-scoped data-access read. Expiry is an ISO UTC instant.

### REST denials and errors

`src/lib/api/problem.ts` builds RFC 9457 responses with `code`, `retryable`,
and pointer-based `errors`, sanitizes 500 bodies, and maps `ActionFailure`
codes for REST callers. Success and failure responses carry `X-Request-Id`
and `Cache-Control: private, no-store`.

| Denial | HTTP status |
| --- | --- |
| `credential_missing`, `credential_malformed`, `credential_ambiguous` | 401 |
| `credential_header_unsupported`, `cookie_session_unsupported` | 401 |
| `credential_invalid`, `credential_expired`, `credential_disabled`, `credential_revoked` | 401 |
| `credential_owner_removed`, `credential_owner_unverified` | 401 |
| `missing_scope`, `insufficient_role`, `api_access_disabled` | 403 |

Every 401 includes `WWW-Authenticate: Bearer`. Unknown or purged credentials
return `credential_invalid`; expired credentials still present in storage
return `credential_expired`. Owner demotion uses `credential_owner_removed`
as required by the credential lifecycle contract, rather than the operation's
403 `insufficient_role` refusal.

Organization API access is checked by `resolveApiContext` on every private API request.
Disabled access returns 403 `api_access_disabled`; a missing
`organization_api_access` row means enabled. Only Platform Admins can view the
cross-organization state and toggle it at `/admin/organizations`, through
`src/fn/organization-api-access.ts:setOrganizationApiAccessFn` and its guarded
data-access seam. Turning it off requires confirmation: every API key in that
organization stops working until access is restored, without revoking the
keys. Organization Owners/Admins without Platform Admin access cannot toggle
it. Restoring access still requires each credential to pass its normal checks.
