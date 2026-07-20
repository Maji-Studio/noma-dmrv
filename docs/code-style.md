# Code Style

Conventions for writing code in noma-dmrv: naming, the auth/org-scoping seam, React
Compiler rules, and the local gates to run before committing. Read this before writing
code. Topic-owning docs are linked inline — follow the link rather than trusting a
paraphrase here.

Related: [architecture.md](./architecture.md) (layers, `ActionResult`) ·
[design-system.md](./design-system.md) (tokens, page shell, a11y) ·
[forms.md](./forms.md) (form/schema patterns) · [database.md](./database.md) (schema
conventions) · [testing.md](./testing.md) (E2E) · [../TEMPLATE_USAGE.md](../TEMPLATE_USAGE.md)
(worked CRUD example).

## Naming & files

- All files **kebab-case** — `item-form.tsx`, `use-items.ts`.
- Component exports are **PascalCase**; hook and plain-function exports are **camelCase**.
- **1000-line cap** per file. It is an ESLint `max-lines` **warn**, not an error — it will
  not fail a build, so splitting is a review expectation you must honour yourself. Exempt
  and never to be "fixed" by splitting: `src/lib/isometric/generated/**` and
  `src/db/seed-data.ts` (see `eslint.config.mjs`).
- Feature folders under `src/components/<feature>/` are **flat** with a barrel `index.ts`
  — no `components/` / `dialogs/` / `hooks/` subfolders, even for large features
  (`src/components/credit-batches/` is the reference).
- UI primitives live under lowercase `@/components/ui/*`.
- **Colocated unit tests:** `*.test.ts` / `*.test.tsx` sit beside the code they test under
  `src/` (vitest, `environment: "node"`, see `vitest.config.ts`). Add one by default for
  schemas and pure logic — E2E is not a substitute.

## Auth & org scoping — the most violated convention here

Three distinct seams; do not collapse them.

1. `requireAuth()` (`@/lib/auth/server`) guards **routes only**, once, in
   `src/app/(app)/layout.tsx`. Never call it in `data-access/`.
2. `fn/` calls `requireOrgContext()` (`@/lib/auth/server`) to obtain `ctx: OrgContext`.
3. `data-access/` receives `ctx` as its **first parameter** and calls `requireOrgScope(ctx)`
   — it never derives auth itself. Cross-entity writes also use `assertSameOrg` /
   `requireOrgFacility`. All three live in `src/data-access/utils.ts`.

Reference: `src/fn/facilities.ts` → `src/data-access/facilities.ts`.

**Org-scoping invariant:** `pnpm check:org-scoping` statically scans `src/data-access/` and
`src/fn/` and fails any `db`/`tx` select/insert/update/delete chain touching a domain table
without `organizationId`. Exempt tables: users, sessions, accounts, verifications,
organizations, members, invitations, geoRouteCache. The **only** waiver is a
`// org-scope-ok: <reason>` comment — the reason text is required; a bare marker does not
match. You will trip this on queries joined off an already-scoped parent. Why:
[adr/0010-shared-schema-org-column-tenancy.md](./adr/0010-shared-schema-org-column-tenancy.md).

## Style

- **TypeScript strict** — avoid `any`; prefer `z.infer<typeof schema>` over hand-written types.
- **Zod 4.** Numeric/GPS inputs go through `@/schemas/helpers` (`optionalNumber`,
  `requiredNumber`, `optionalPercent`, `gpsPairSuperRefine`, `MASS_INPUT_MAX_KG`). Never
  `valueAsNumber` — see [forms.md](./forms.md).
- **No magic numbers** — named constants at the top of the file or in `@/config`. Use
  design-system tokens, never hardcoded visual values.
- No bespoke page layouts: every routed page follows the Canonical Page Shell, and every
  empty / "select a facility" state uses `EmptyState`, never bare text →
  [design-system.md](./design-system.md).
- Sheet and read-only form structure → [forms.md](./forms.md).
- Accessibility (touch targets, contrast, ARIA) → [design-system.md](./design-system.md).
- JSONB column defaults → [database.md](./database.md).

## React (this project uses the React Compiler)

- The compiler auto-memoizes — **do not add `useMemo`, `useCallback`, or `React.memo`**
  unless profiling demands it.
- **Avoid `useEffect`** — prefer React Query, server actions, or derived state. Reach for it
  only for external-system sync, subscriptions, or imperative DOM work.

## Adding a feature

Build bottom-up through the layers ([architecture.md](./architecture.md)); the worked,
copy-pasteable walkthrough is [../TEMPLATE_USAGE.md](../TEMPLATE_USAGE.md) and the
**reference entity is `facilities`**. Two facts neither owner states:

- Entities use **flat routes under `(app)`** (`/facilities`, `/reactors`, …); the legacy
  `[projectId]` route tree was removed.
- Route params are **async** (Next.js 16).

## Before you commit

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm check:org-scoping` (and `pnpm test:e2e`
when the change has a UI flow).
