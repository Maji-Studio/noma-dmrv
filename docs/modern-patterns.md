# Modern Patterns & Library Updates

**Purpose**: This document helps AI assistants (like Claude) understand modern patterns in libraries that may differ from their training data. Use this to avoid deprecated patterns and follow current best practices.

---

## Drizzle ORM (v0.36+)

### ✅ Current Pattern: `pgTable` without callback

Drizzle ORM has deprecated the old `pgTable` signature that used a callback function for extra config.

**OLD (Deprecated)**:
```typescript
import { pgTable, uuid, text } from "drizzle-orm/pg-core";

export const myTable = pgTable("my_table", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
}, (table) => {
  return {
    nameIdx: index("name_idx").on(table.name),
  };
});
```

**NEW (Current)**:
```typescript
import { pgTable, uuid, text, index } from "drizzle-orm/pg-core";

export const myTable = pgTable("my_table", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
});

// Define indexes separately
export const myTableIndexes = {
  nameIdx: index("name_idx").on(myTable.name),
};
```

**When you need constraints** (unique, foreign keys):
```typescript
// ✅ Still valid for constraints
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (table) => ({
    projectUserUnique: unique("project_members_project_user_unique").on(
      table.projectId,
      table.userId
    ),
  })
);
```

**Why**: Drizzle is moving toward a more declarative API. Constraints remain in callback for backward compatibility, but indexes should be defined separately.

---

## Zod (v4)

### ✅ Current Pattern: `z.string().uuid()` with `error` parameter

Zod v4 uses the `error` parameter instead of the deprecated `message` parameter.

**OLD (Zod v3 - Deprecated)**:
```typescript
z.string().uuid({ message: "Invalid UUID format" })
```

**NEW (Zod v4)**:
```typescript
z.string().uuid({ error: "Invalid UUID format" })

// Or use the default message
z.string().uuid()
```

**Examples from this codebase**:
```typescript
// Simple UUID validation
export const deleteProjectSchema = z.object({
  projectId: z.string().uuid(),
});

// With custom error message
export const updateUserSchema = z.object({
  id: z.string().uuid({ error: "Invalid user ID" }),
  name: z.string(),
});
```

**Why**: Zod v4 uses a unified `error` parameter for consistency across all validation methods.

---

## Next.js 15+ (App Router)

### ✅ Current Pattern: Async `params` and `searchParams`

Next.js 15 made route parameters async to support progressive enhancement.

**OLD (Next.js 14)**:
```typescript
export default function Page({ params }: { params: { id: string } }) {
  const { id } = params;
  return <div>{id}</div>;
}
```

**NEW (Next.js 15+)**:
```typescript
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <div>{id}</div>;
}

// For searchParams too
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ query?: string }>;
}) {
  const { query } = await searchParams;
  return <div>{query}</div>;
}
```

**Why**: This allows Next.js to stream the initial HTML before params are resolved, improving performance.

---

## Next.js 16 Caching (Cache Components)

### ✅ Current Pattern: `"use cache"` directive and `connection()` API

Next.js 16 introduces Cache Components as an optional feature (`cacheComponents: true` in `next.config.ts`). This template **does not enable Cache Components by default** to keep behavior predictable and simple.

#### Understanding Cache Components

Cache Components is a Next.js 16 feature that allows granular caching of server components and functions using the `"use cache"` directive.

**When to enable `cacheComponents: true`**:
- You have expensive external API calls that benefit from caching (health checks, public data)
- You understand the caching semantics and are prepared to manage cache invalidation
- You want to reduce load on external services with infrequent updates

**When NOT to enable it**:
- For typical CRUD apps where user-facing data should always be fresh
- When you're unsure about caching behavior
- For most template use cases (this template's default)

#### The `"use cache"` Directive

When Cache Components is enabled, you can cache specific functions:

```typescript
"use cache"; // Must be first line in file

import { fetchExternalApi } from "@/lib/api";

export async function checkServiceHealth() {
  // This function's result will be cached
  const result = await fetchExternalApi("/health");
  return result;
}
```

**CRITICAL: Only use `"use cache"` for functions that:**
1. Access external APIs (not user-specific data)
2. Are expensive to compute
3. Have infrequent updates
4. Are admin-only or system-level operations

**NEVER use `"use cache"` for:**
- ❌ Auth checks (`requireAuth()`, `getUser()`) - Must run on every request for security
- ❌ User-specific data - Always needs to be fresh
- ❌ CRUD operations - Data changes frequently
- ❌ API routes - Use `connection()` instead (see below)

#### API Routes with Cache Components

When `cacheComponents: true` is enabled, you **MUST NOT** use `export const dynamic = 'force-dynamic'` as it's incompatible with Cache Components.

**❌ OLD (Next.js 15 - Incompatible with Cache Components)**:
```typescript
export const dynamic = 'force-dynamic'; // DON'T use this!

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  // ...
}
```

---

## E2E Security Tests (Playwright)

- `tests/e2e/security.spec.ts` focuses on unauthenticated access checks and safe rendering.
- Role-based and cross-user authorization tests are skipped until auth fixtures exist.
- `/unauthorized` accepts an optional `reason` query param for safe, escaped display used by the XSS test.

**✅ NEW (Next.js 16 with Cache Components)**:
```typescript
import { NextRequest, NextResponse, connection } from "next/server";

export async function GET(request: NextRequest) {
  await connection(); // Opt out of prerendering - signals dynamic route

  const authHeader = request.headers.get("authorization");
  // ...
}
```

**What `connection()` does**:
- Signals that this route needs access to the incoming request's connection information
- Forces the route to be dynamic (not prerendered at build time)
- Must be called **before** accessing request headers, cookies, or params
- Prevents Next.js from trying to cache the route at build time

**Routes are automatically dynamic when they**:
- ✅ Call `await connection()` at the start of the handler
- ✅ Access `request.headers`, `request.nextUrl.searchParams`
- ✅ Use `headers()`, `cookies()`, `draftMode()` from `next/headers`
- ✅ Call `getUser()`, `requireAuth()` (which access headers internally)

#### This Template's Approach (Default)

**Configuration**: `cacheComponents: false` (default - not set in `next.config.ts`)

This template **does NOT enable Cache Components** because:
- ✅ **Simplicity**: No need to understand cache semantics for typical CRUD apps
- ✅ **Predictability**: All data fetching uses client-side React Query with explicit caching
- ✅ **Security**: Auth checks always run fresh, no risk of caching sensitive data
- ✅ **Flexibility**: React Query provides better cache control for user-facing data

**If you want to enable Cache Components**:
1. Add `cacheComponents: true` to `next.config.ts`
2. Update API routes to use `connection()` instead of `dynamic = 'force-dynamic'`
3. Carefully decide which functions should use `"use cache"`
4. Test thoroughly to ensure auth and user data are never cached

#### Example: Enabling Cache Components

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  reactCompiler: true,
  cacheComponents: true, // Enable Cache Components
};

// src/lib/health-check/external-service.ts
"use cache"; // Cache this function's results

export async function checkExternalServiceHealth() {
  // Expensive external API call - safe to cache
  const response = await fetch("https://external-api.com/health");
  return response.json();
}

// src/app/api/projects/route.ts
import { connection } from "next/server";

export async function GET(request: NextRequest) {
  await connection(); // Required with cacheComponents: true

  const user = await getUser(); // Auth runs fresh every time
  // ... rest of handler
}
```

**Key Takeaway**: This template prioritizes simplicity. Cache Components is **opt-in** for advanced use cases.

---

## React Hook Form (v7.51+)

### ✅ Current Pattern: Type-safe form state

Modern React Hook Form with TypeScript requires proper type inference.

**Example from this codebase**:
```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { projectFormSchema, type ProjectFormData } from "@/schemas/projects";

const {
  register,
  handleSubmit,
  formState: { errors, isSubmitting },
  setError,
} = useForm<ProjectFormData>({
  resolver: zodResolver(projectFormSchema),
  defaultValues: {
    name: "",
    description: "",
  },
});

// Server errors
const onSubmit = async (data: ProjectFormData) => {
  const result = await createProject(data);
  if (!result.success) {
    setError("root.serverError", {
      type: "manual",
      message: result.error,
    });
  }
};
```

**Key points**:
- Always use `zodResolver` for Zod schemas
- Export and import types from schemas: `type ProjectFormData = z.infer<typeof projectFormSchema>`
- Server errors use `root.serverError` field
- Use `setError` for dynamic validation errors

---

## Better Auth (Latest)

### ✅ Current Pattern: Next.js 16 `proxy.ts` → `updateSession()`

Next.js 16 replaces the traditional `middleware.ts` with a Node.js-runtime
`proxy.ts`. The entry file is thin and delegates to `updateSession()`, which
resolves the session through Better Auth's server API (`auth.api.getSession`).
The `nextCookies()` plugin handles cookie serialization in the Better Auth
config (`src/lib/auth/better-auth.ts`).

**Example from this codebase** (`src/proxy.ts`):
```typescript
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/middleware";

export default async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg)$).*)"],
};
```

`updateSession()` (`src/lib/auth/middleware.ts`) does the session lookup and
route protection:
```typescript
export async function updateSession(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  const isAuthenticated = !!session?.user;
  // redirect unauthenticated users → /login, authenticated users off auth pages, etc.
}
```

**Why**: a Node.js-runtime proxy lets Better Auth use the Node `crypto` module
and other server-side libraries that the Edge runtime can't. See
[`docs/auth.md`](./auth.md) for the full route-protection logic and the
public-route list.

---

## React 19 Patterns

### ✅ Current Pattern: Avoid `useEffect` for data fetching

React 19 and modern patterns prefer React Query and server actions over `useEffect`.

**❌ OLD (Avoid)**:
```typescript
const [items, setItems] = useState([]);

useEffect(() => {
  fetch('/api/items').then(res => res.json()).then(setItems);
}, []);
```

**✅ NEW (Current)**:
```typescript
import { useItems } from "@/hooks/use-items";

const { data: items, isLoading } = useItems(projectId);
```

**When `useEffect` IS appropriate**:
- Synchronizing with external (non-React) systems
- Setting up event listeners or subscriptions
- Imperative DOM manipulation (rare)

**NOT for**:
- Data fetching (use React Query)
- Derived state (calculate directly)
- Event handlers (use event props)

---

## TypeScript 5.5+ Patterns

### ✅ Current Pattern: `satisfies` operator for type narrowing

TypeScript 5.5+ prefers `satisfies` for type-safe object literals.

**Example**:
```typescript
// ✅ Type-safe with autocomplete
const config = {
  api: "/api/v1",
  timeout: 5000,
  retries: 3,
} satisfies Config;

// TypeScript knows exact literal types
config.api // string literal "/api/v1", not just string
```

**Why**: `satisfies` provides type checking without widening types, giving better autocomplete.

---

## Environment Variables with Zod

### ✅ Current Pattern: Centralized validation in `env.ts`

**Example from this codebase** (`src/config/env.ts`):
```typescript
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string(),
  ADMIN_EMAIL: z.string().email(),
  ALLOW_SELF_SIGNUP: z.enum(["true", "false"]),
});

export const env = envSchema.parse(process.env);
```

**Key points**:
- Single source of truth for all env vars
- Fails fast on startup if invalid
- Type-safe access: `env.DATABASE_URL`
- Never use `process.env` directly in code

---

## Common Deprecations to Watch

### Drizzle ORM
- ❌ `pgTable` with callback → ✅ Define indexes separately
- ❌ `.where()` → ✅ Use `db.select().from().where()`

### Zod
- ❌ `z.string().uuid({ message: "..." })` (v3) → ✅ `z.string().uuid({ error: "..." })` (v4)
- ❌ `z.string().email({ message: "..." })` (v3) → ✅ `z.string().email({ error: "..." })` (v4)

### Next.js
- ❌ Sync `params` → ✅ Async `params` with `await`
- ❌ `next/image` `layout` prop → ✅ Use `fill` with container
- ❌ `getServerSideProps` → ✅ Server Components with async/await

### React
- ❌ `useEffect` for data → ✅ React Query
- ❌ `useEffect` for derived state → ✅ Calculate directly
- ❌ Manual memoization → ✅ Trust React Compiler

---

## When to Update This File

Add to this document when:
1. You encounter TypeScript deprecation warnings
2. Library APIs change in breaking ways
3. Next.js releases major version updates
4. Claude suggests outdated patterns

This keeps the codebase modern and helps future AI assistance stay current.
