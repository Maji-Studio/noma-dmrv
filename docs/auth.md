# Authentication

noma-dmrv uses Better Auth with email/password, email verification, password reset, admin roles, and invite-first signup defaults.

## Import Patterns

```ts
// Client Components
import { useAuth } from "@/lib/auth/providers/better-auth-client";

// Server Components / Server Actions
import {
  getUser,
  requireAuth,
  requireOrgContext,
  requireOrgRole,
  requirePlatformAdmin,
} from "@/lib/auth/server";

// Next.js 16 proxy
import { updateSession } from "@/lib/auth/middleware";
```

## Next.js 16 Proxy

Next.js 16 uses `proxy.ts` instead of traditional middleware. The proxy runs in the Node.js runtime so Better Auth can use Node crypto and the app can share server-side auth helpers.

Key files:

- `proxy.ts`: request-level protection and redirects.
- `src/lib/auth/middleware.ts`: `updateSession()` used by the proxy.
- `src/lib/auth/better-auth.ts`: Better Auth config, signup policy, email, sessions, rate limits.
- `src/lib/auth/server.ts`: authentication, active-organization context, and role guards.
- `src/lib/auth/providers/better-auth-client.ts`: client hook (`useAuth`).

## Current Behavior

- `ALLOW_SELF_SIGNUP=false` disables public email signup by default (admin-invite only).
- `ALLOW_SELF_SIGNUP=true` enables public signup.
- `ADMIN_EMAIL` designates the admin user — the account seeded/promoted to the `admin` role.
- Sessions use Better Auth session cookies, wired through the `nextCookies` plugin.
- Each session may carry `activeOrganizationId`; org-scoped actions require it.
- Email verification is required before login is considered valid.
- Auth emails use Resend when configured.
- If `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are unset, reset/verification links are logged locally for development.
- Platform Admin routes call `requireAdmin()` or `requirePlatformAdmin()`.
- Authenticated app routes call `requireAuth()` through the app layout and data-access layer.

## Route Access

| Route Pattern | Access | Enforced By |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password`, `/set-password` | Public | Proxy redirects authenticated users |
| `/verify-email`, `/verify-email/callback` | Public | Proxy allows |
| `/unauthorized` | Public | Proxy allows |
| `/api/auth/*` | Public | Better Auth handlers |
| `/(app)/*` | Authenticated; domain actions also require an active organization | App layout + org-scoped server actions |
| `/admin/*` | Admin only | Admin layout calls `requireAdmin()` |
| Protected API routes | Authenticated or admin, route-specific | Route handler and data-access guards |

## Roles And Active Organization

`users.role` distinguishes a global Platform Admin (`admin`) from a normal user
(`user`). Organization membership lives in `members` with the hierarchy Owner ⊃
Admin ⊃ Member.

The session's `activeOrganizationId` selects the workspace for every domain
operation. A user with exactly one membership gets it selected at sign-in;
members can switch only among their organizations. A Platform Admin does not
need membership and enters any organization through the admin organization
switcher. That override is intentional administrative authority, not membership.

## Guard Patterns

Layouts:

```ts
// App layout
await requireAuth();

// Admin layout
await requireAdmin();
```

Data-access:

```ts
export async function listFacilities(ctx: OrgContext) {
  requireOrgScope(ctx);
  return db
    .select()
    .from(facilities)
    .where(eq(facilities.organizationId, ctx.organizationId));
}
```

Server actions:

```ts
export async function createFacilityAction(input: CreateFacilityInput) {
  return withAction(async () => {
    const ctx = await requireOrgContext();
    requireOrgRole(ctx, "member");
    const data = createFacilitySchema.parse(input);
    return createFacility(ctx, data);
  });
}
```

Use `requirePlatformAdmin()` for cross-organization lifecycle operations. It
throws a safe action error, while layout-only admin pages may redirect through
`requireAdmin()`.

## Tenancy And Data Ownership

Better Auth owns `organizations`, `members`, `invitations`, and the session's
active organization. `requireOrgContext()` resolves an `OrgContext` containing
`userId`, `organizationId`, `orgRole`, and `isPlatformAdmin`; it rejects a
missing or unauthorized active organization. `requireOrgRole()` applies the
Owner/Admin/Member hierarchy and accepts the Platform Admin override.

Every domain table carries `organizationId NOT NULL`. Data-access functions
filter reads, updates, and deletes by `ctx.organizationId`, and stamp inserts
from the same context. `organizationId` is never accepted from form data or
other client input. Cross-organization record IDs therefore resolve as absent
instead of disclosing another organization's data.

Organization Admins and Owners invite members from organization settings.
Better Auth enforces invitation and membership changes server-side; invitees
accept the generated link, then their membership controls available orgs and
role. Email delivery is best-effort, with a copyable accept link available to
the inviter. Auth flows must not log names or email addresses; use stable IDs.

Registry credentials are owned per organization and managed only by Platform
Admins; organization members can use them through scoped certification flows
but cannot read or replace the stored secrets.

## Notes

- `ADMIN_PASSWORD` is required by `pnpm db:reset` / `ensure-admin.ts`.
- `/admin/users` redirects to `/settings/organization`, the existing member and
  invitation management surface for the active organization.
- Do not log PII from auth flows; log stable IDs such as `userId`.
