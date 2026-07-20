# Modern Patterns & Library Updates

Where this repo's library versions diverge from what an LLM is likely to have
memorised. Read it before writing schema, route, or config code with a library
listed below — the training-data pattern is often the deprecated one. It carries
**only** version-drift facts; the repo's own conventions live in the owning docs
([code-style.md](./code-style.md), [forms.md](./forms.md),
[database.md](./database.md), [auth.md](./auth.md), [security.md](./security.md)),
which win on any conflict.

Pinned versions: `drizzle-orm ^0.45.1` · `zod ^4.3.6` · `next 16.2.6` ·
`react-hook-form ^7.71.1`. Check `package.json` before trusting anything here.

---

## Drizzle ORM (0.45+)

The extra-config callback returns an **array**, and indexes are declared inside
it — not exported separately. All 47 table definitions in `src/db/schema/` use
this form.

```typescript
export const certifierProjects = pgTable(
  "certifier_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id").notNull(),
  },
  (table) => [
    index("certifier_projects_organization_id_idx").on(table.organizationId),
    unique("certifier_projects_id_organization_id_unique").on(
      table.id,
      table.organizationId
    ),
  ]
);
```

Deprecated: the **object**-returning callback (`(table) => ({ nameIdx: … })`).
Also wrong — and a silent failure — is declaring indexes in a separate exported
object (`export const myTableIndexes = { … }`): `drizzle-kit generate` never
sees them, so the migration is emitted without the index and nothing errors.

Copy an existing table from `src/db/schema/`. Column types are constrained
further by the numeric families rule in [database.md](./database.md).

---

## Zod 4

Top-level string formats replace the chained methods, and the error key is
`error`, not `message`:

```typescript
z.uuid({ error: "Invalid user ID" });   // not z.string().uuid({ message })
```

The full migration table (`z.email`, `z.url`, `z.iso.datetime`, …), the
in-repo exceptions, and the numeric-coercion helpers are owned by
[forms.md](./forms.md) — read it before writing a schema.

One thing to know before you "fix" anything: `z.string().uuid()` is still the
majority idiom here (~103 call sites vs ~13 of `z.uuid()`). It is deprecated but
functional. Prefer `z.uuid()` in new code; **do not mass-migrate** the existing
ones.

---

## Next.js 16

### Async `params` and `searchParams`

Route params are Promises and must be awaited:

```typescript
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
}
```

### Cache Components are NOT enabled

`next.config.ts` does not set `cacheComponents`, and `"use cache"` appears zero
times in `src/`. Do not add the directive — without the flag it does nothing,
and enabling the flag is a config decision, not a local one.

Consequently `connection()` is not required in API routes, and
`export const dynamic = "force-dynamic"` remains valid. Server-side caching is
deliberately absent: freshness is handled client-side by React Query, whose
conventions ([architecture.md](./architecture.md)) are per-hook, not global.

### `proxy.ts`, not `middleware.ts`

Next 16 replaces `middleware.ts` with a Node-runtime `src/proxy.ts`, which lets
Better Auth reach the Node `crypto` module. The entry file is thin and delegates
to `updateSession()`. Route protection, the matcher's exact scope, and the
public-route list are owned by [auth.md](./auth.md).

---

## React 19

Trust the React Compiler (`reactCompiler: true`): no manual `useMemo`,
`useCallback`, or `React.memo`. Do not use `useEffect` for data fetching or
derived state — React Query and direct calculation respectively. Full rules:
[code-style.md](./code-style.md).

---

## TypeScript 5.5+

Prefer `satisfies` over a type annotation for object literals — it type-checks
without widening, so literal types survive for autocomplete:

```typescript
const config = { api: "/api/v1", timeout: 5000 } satisfies Config;
```

---

## Keeping this file honest

Add an entry when a library upgrade changes a pattern an LLM would otherwise
reproduce from memory. Every entry must cite the in-repo call sites that prove
it, because an unverified entry here is worse than no entry — it is the shape of
advice agents follow without checking. Anything that is a repo convention rather
than a version fact belongs in the owning doc instead.
