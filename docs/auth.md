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

- `ALLOW_SELF_SIGNUP=false` disables public email signup by default.
- `ALLOW_SELF_SIGNUP=true` enables public signup.
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

The biochar MRV domain is single-org / shared-data today:

- Every authenticated user can read and operate on the same facilities, suppliers, runs, products, logistics records, applications, and credit batches.
- `userId` columns are attribution only.
- Data-access guards verify authentication and relevant record existence; they are not per-user ownership checks.
- Facility context scopes workflows and UI, not authorization.

If multi-tenancy is introduced, revisit every `src/data-access/` list/query/ensure helper and add tenant/facility membership constraints before onboarding a second operator group.

## Notes

- `ADMIN_PASSWORD` is required by `pnpm db:reset` / `ensure-admin.ts`.
- `/admin/users` is intentionally still a scaffold for invite/user-management workflow work.
- Do not log PII from auth flows; log stable IDs such as `userId`.
