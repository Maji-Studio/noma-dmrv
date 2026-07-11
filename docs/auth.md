# Authentication

noma-dmrv uses Better Auth with email/password, email verification, password reset, admin roles, and invite-first signup defaults.

## Import Patterns

```ts
// Client Components
import { useAuth } from "@/lib/auth/providers/better-auth-client";

// Server Components / Server Actions
import { getUser, requireAdmin, requireAuth } from "@/lib/auth/server";

// Next.js 16 proxy
import { updateSession } from "@/lib/auth/middleware";
```

## Next.js 16 Proxy

Next.js 16 uses `proxy.ts` instead of traditional middleware. The proxy runs in the Node.js runtime so Better Auth can use Node crypto and the app can share server-side auth helpers.

Key files:

- `proxy.ts`: request-level protection and redirects.
- `src/lib/auth/middleware.ts`: `updateSession()` used by the proxy.
- `src/lib/auth/better-auth.ts`: Better Auth config, signup policy, email, sessions, rate limits.
- `src/lib/auth/server.ts`: server helpers (`getUser`, `requireAuth`, `requireVerifiedAuth`, `requireAdmin`).
- `src/lib/auth/providers/better-auth-client.ts`: client hook (`useAuth`).

## Current Behavior

- `ALLOW_SELF_SIGNUP=false` disables public email signup by default (admin-invite only).
- `ALLOW_SELF_SIGNUP=true` enables public signup.
- `ADMIN_EMAIL` designates the admin user — the account seeded/promoted to the `admin` role.
- Sessions use Better Auth session cookies, wired through the `nextCookies` plugin.
- Email verification is required before login is considered valid.
- Auth emails use Resend when configured.
- If `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are unset, reset/verification links are logged locally for development.
- Admin-only routes call `requireAdmin()`.
- Authenticated app routes call `requireAuth()` through the app layout and data-access layer.

## Route Access

| Route Pattern | Access | Enforced By |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password`, `/set-password` | Public | Proxy redirects authenticated users |
| `/verify-email`, `/verify-email/callback` | Public | Proxy allows |
| `/unauthorized` | Public | Proxy allows |
| `/api/auth/*` | Public | Better Auth handlers |
| `/(app)/*` | Authenticated | App layout + proxy |
| `/admin/*` | Admin only | Admin layout calls `requireAdmin()` |
| Protected API routes | Authenticated or admin, route-specific | Route handler and data-access guards |

## Roles

App-level role is stored on `users.role`.

- `admin`: admin routes and user-management surfaces.
- `user`: normal authenticated app access.

The legacy starter `project_members.role` model has been removed. Do not reintroduce project membership checks unless a real multi-tenant facility ownership model is designed.

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
export async function listFacilities(userId: string) {
  await requireAuth();
  return db.query.facilities.findMany();
}
```

Server actions:

```ts
export async function createFacilityAction(input: CreateFacilityInput) {
  return withAction(async (userId) => {
    const data = createFacilitySchema.parse(input);
    return createFacility(userId, data);
  });
}
```

## Tenancy And Data Ownership

Multi-tenancy is being introduced in phases (plan: `docs/plans/2026-06-11-multi-tenancy.md`, ADR 0010).

**PR 1 — organization foundation (shipped):**

- Better Auth **organization plugin** is enabled: `organizations`, `members`, `invitations` tables (`src/db/schema/auth.ts`) and `session.activeOrganizationId`.
- **Organization / Platform Admin / Member** naming is binding (CONTEXT.md) — never "client"/"tenant" in code.
- Org context guards live in `src/lib/auth/server.ts`:
  - `getOrgContext()` / `requireOrgContext()` → `OrgContext { userId, organizationId, orgRole, isPlatformAdmin }`. `requireOrgContext()` throws `SafeError` (never redirects) so action wrappers surface it cleanly.
  - `requireOrgRole(ctx, "owner"|"admin"|"member")` — Owner ⊃ Admin ⊃ Member; Platform Admins always pass.
  - `requirePlatformAdmin()` — global `admin` role; org lifecycle + cross-org tools.
- On sign-in a session hook auto-selects the active org when the user has exactly one membership. Platform Admins (no memberships) pick an org in the switcher.
- Org switching: members go through the plugin's `setActiveOrganization`; a Platform Admin entering a non-member org writes `session.activeOrganizationId` directly and clears the cached session snapshot (`setActiveOrganizationAction`).
- Member management (`src/fn/organizations.ts`) delegates to the plugin (which enforces org-role authz server-side) behind a coarse `requireOrgRole` pre-gate. Invitations surface a **copyable accept link** in the UI (`/settings/organization`); email delivery via Resend is best-effort (console-link fallback in dev, no PII logged).
- **Isolation gate:** creating a second organization is blocked server-side until PR 2 (`createOrganizationAction`), because domain data is still shared.

**Still shared until PR 2:** domain tables have no `organizationId` yet, so every authenticated user still reads the same facilities/suppliers/runs/etc. `userId` columns remain attribution only. PR 2 adds `organizationId NOT NULL` to every domain table and the data-access scoping sweep; do not rely on org isolation of domain data before then.

## Notes

- `ADMIN_PASSWORD` is required by `pnpm db:reset` / `ensure-admin.ts`.
- `/admin/users` is intentionally still a scaffold for invite/user-management workflow work.
- Do not log PII from auth flows; log stable IDs such as `userId`.
