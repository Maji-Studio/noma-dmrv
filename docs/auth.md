# Authentication

This template uses Better Auth with email/password, email verification, password reset, and role-based access controls.

## Import Patterns

```typescript
// Client Components
import { useAuth } from "@/lib/auth/providers/better-auth-client";

// Server Components / Server Actions
import { requireAuth, requireAdmin, getUser } from "@/lib/auth/server";

// Proxy (Next.js 16)
import { updateSession } from "@/lib/auth/middleware";
```

## Next.js 16 Proxy

**Important:** Next.js 16 uses `proxy.ts` (not `middleware.ts`). The proxy runs in Node.js runtime to support database access and Better Auth's cryptographic operations.

- **File:** `proxy.ts` (project root)
- **Function:** `export default async function proxy(request: NextRequest)`
- **Matcher:** Excludes `_next`, `api/`, static images, and `favicon.ico`

## Current Behavior

- `ALLOW_SELF_SIGNUP=false` (default) disables public email signup.
- `ALLOW_SELF_SIGNUP=true` enables public signup.
- Email verification is required before login is considered valid.
- Auth emails use Resend when configured; if `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are unset, reset/verification links are logged to server console for local development.
- Admin-only routes are protected with `requireAdmin()`.
- Project routes are protected with membership checks in `src/app/(app)/[projectId]/layout.tsx`.

## Route Access

| Route Pattern | Access | Enforced By |
|---|---|---|
| `/login`, `/forgot-password`, `/reset-password`, `/set-password` | Public | Proxy redirects authenticated users |
| `/verify-email`, `/verify-email/callback` | Public | Proxy allows |
| `/unauthorized` | Public | Proxy allows |
| `/api/auth/*` | Public | Better Auth handlers |
| `/projects` | Authenticated | Proxy redirects unauthenticated |
| `/:projectId/*` | Authenticated + project member | Layout calls `requireProjectMember()` |
| `/admin/*` | Admin only | Layout calls `requireAdmin()` |

## Key Files

- `proxy.ts`: Next.js 16 proxy that runs auth checks on all requests (Node.js runtime)
- `src/lib/auth/middleware.ts`: `updateSession()` function called by proxy for route protection
- `src/lib/auth/better-auth.ts`: Better Auth config (signup policy, email, session, rate limits)
- `src/lib/auth/server.ts`: Server helpers (`requireAuth`, `requireVerifiedAuth`, `requireAdmin`)
- `src/lib/auth/providers/better-auth-client.ts`: Client auth hooks (`useAuth`)
- `src/lib/auth/providers/better-auth-server.ts`: Server-side Better Auth utilities

## Roles

### App-level role (`users.role`)

- `admin`
- `user`

### Project-level role (`project_members.role`)

- `owner`
- `admin`
- `member`
- `viewer`

## Guard Patterns

**Layouts (Server Components):**
```typescript
// Admin layout
await requireAdmin(); // Redirects to /login or /unauthorized

// App layout
await requireAuth(); // Redirects to /login

// Project layout
const user = await requireAuth();
await requireProjectMember(projectId, user.id); // Throws if not member
```

**Data Access Layer:**
```typescript
// Always check auth in data-access functions
export async function getItems(userId: string, projectId: string) {
  await requireProjectMember(projectId, userId);
  return db.query.items.findMany(...);
}
```

**Server Actions:**
```typescript
// Validate input, check auth, call data-access
export async function createItemFn(data: CreateItemInput) {
  const validated = createItemSchema.parse(data);
  const user = await requireAuth();
  return await createItem(user.id, projectId, validated);
}
```

## Switching Auth Providers

The auth layer uses Better Auth directly, but you can abstract it further:

1. Create a provider interface in `src/lib/auth/types.ts`
2. Move Better Auth code to `providers/better-auth/`
3. Update imports in `server.ts` and `client.ts` to use the interface
4. Swap providers by changing the implementation without touching components

## Notes

- `ADMIN_PASSWORD` env var is required by `pnpm db:reset` / `ensure-admin.ts` (no default password)
- `/admin/users` is intentionally a scaffold route in this template
- Invite UI/workflow can be built on top of the existing auth and mail plumbing
- Next.js 16 proxy runs in Node.js runtime (not Edge) to support database operations
