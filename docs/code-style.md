# Code Style

Conventions for writing code in noma-dmrv. These are hard rules unless noted
otherwise — CI, review, and the file-size cap all enforce parts of them.

Related docs: `docs/design-system.md` (tokens, Canonical Page Shell), `docs/forms.md`
(form/schema patterns), `docs/architecture.md` (layered flow), `TEMPLATE_USAGE.md`
(worked CRUD example).

## Naming & files

- All files **kebab-case** — `item-form.tsx`, `use-items.ts`.
- Component exports are **PascalCase**; hook and plain-function exports are **camelCase**.
- **1000-line hard cap** per file — split anything approaching it into modular files.
  Use a barrel `index.ts` to re-export from a folder.
- **Flat vs. subfolder rule:** a simple feature (< 500 lines, < 3 components) lives in a
  flat folder; a complex feature splits into `components/`, `dialogs/`, `hooks/` subfolders.
- UI primitives live under lowercase `@/components/ui/*` — e.g. `@/components/ui/button`
  exports both `Button` and `buttonVariants`.

## Style

- **TypeScript strict** — avoid `any`; prefer `z.infer<typeof schema>` over hand-written
  types.
- **No magic numbers** — hoist them to named constants at the top of the file or into
  `@/config`. Use design-system tokens (see `docs/design-system.md`), never hardcoded
  visual values.
- **Every routed page follows the Canonical Page Shell** (`docs/design-system.md` →
  Canonical Page Shell): `container-max page-shell` → `PageHeader` (area eyebrow, title,
  one-line subtitle) → iconed `StatCard` KPI strip (`gap-24`) → content. Use `EmptyState`
  for all empty and "select a facility" states — never bare text.
- **Sheet forms:** sections via `FormSection`, CTA via `FormActions`, `space-y-20` at the
  top level (see `docs/forms.md`). Read-only sheets mirror the same structure with
  `DetailSection`.
- **JSONB columns:** keep create and update defaults identical, and match the schema's
  `.default()`.

## React (this project uses the React Compiler)

- The React Compiler auto-memoizes components, values, and callbacks — **do not add
  `useMemo`, `useCallback`, or `React.memo`** unless profiling demands it.
- **Avoid `useEffect`** — prefer React Query, server actions, or derived state. Reach for
  `useEffect` only for external-system sync, subscriptions, or imperative DOM work.

## Accessibility

- 44×44px minimum touch targets.
- 4.5:1 minimum contrast.
- Full keyboard navigation.
- ARIA labels wherever visual context alone is insufficient.

## Adding a feature — checklist

Build in dependency order, bottom of the layered architecture up (see
`docs/architecture.md`). `TEMPLATE_USAGE.md` walks each step with copy-pasteable code; the
**reference entity is `facilities`** (schemas / data-access / fn / hooks / components /
route / spec).

1. **Zod schemas** (`src/schemas/`) — form + action schemas, `export type X = z.infer<…>`;
   share a base schema between the form and update variants; use `@/schemas/helpers`.
2. **DB schema** (`src/db/schema/`) — define the table, export its types, add it to
   `schema/index.ts`, then `pnpm db:generate`.
3. **Data access** (`src/data-access/`) — CRUD functions, each calling `requireAuth()`.
4. **Server actions** (`src/fn/`) — `"use server"`, validate input with Zod, return
   `ActionResult<T>`.
5. **Hooks** (`src/hooks/`) — query + mutation hooks with invalidation.
6. **Components** (`src/components/your-feature/`) — React Hook Form forms, design tokens,
   barrel export.
7. **Route** — entities use flat routes under `(app)` (`/facilities`, `/reactors`, …);
   the legacy `[projectId]` route tree was removed. Route params are async (Next.js 16).
8. **E2E** (`tests/e2e/your-feature.spec.ts`) — use the `adminPage` + `seededData` fixtures
   (see `docs/testing.md`).
