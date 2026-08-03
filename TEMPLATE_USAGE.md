# Adding a Feature

Use this checklist when adding an entity or extending a CRUD workflow in
noma-dmrv. The current feedstock-type feature is the compact reference:

- schema/table: `src/db/schema/feedstock.ts`
- validation: `src/schemas/feedstock-types.ts`
- data access: `src/data-access/feedstock-types.ts`
- server actions: `src/fn/feedstock-types.ts`
- React Query: `src/hooks/use-feedstock-types.ts`
- UI: `src/components/feedstock-types/`
- route: `src/app/(app)/feedstock-types/page.tsx`
- focused tests: `src/components/feedstock-types/*.test.{ts,tsx}`

Copy its layer boundaries, not its registry-specific behavior.

## 1. Define the domain and persistence boundary

Confirm the term and entity grain in `CONTEXT.md`. Read
[`docs/organization.md`](docs/organization.md) before choosing paths and
[`docs/database.md`](docs/database.md) plus
[`docs/schema-overview.md`](docs/schema-overview.md) before changing schema.

Every normal domain table is organization-scoped:

- add `organizationId NOT NULL`, stamped from `OrgContext`, never from client
  input;
- add the org-aware uniqueness, indexes, and composite foreign keys required by
  its parents;
- use shared numeric families and existing enums/helpers;
- generate migrations with `pnpm db:generate`, review the SQL, and never edit an
  already-applied migration.

Auth infrastructure and the geo route cache are explicit exceptions. A new
domain entity is not.

## 2. Add Zod schemas

Put form and action schemas in `src/schemas/<feature>.ts`. Infer TypeScript
types from the schemas. The form schema describes UI fields; create/update
schemas add ids or server-only shape and are parsed again in the server action.

Use React Hook Form with `zodResolver`. Reuse numeric, date-only, GPS, mass, and
empty-value helpers from `src/schemas/helpers.ts`; never use
`valueAsNumber`. Read [`docs/forms.md`](docs/forms.md) before implementing the
form, especially for organization-default hydration, cross-field
revalidation, dates, and file evidence.

## 3. Implement data access first

Data access owns both authorization and database queries. Every normal exported
function takes `ctx: OrgContext` first:

```ts
export async function listWidgets(ctx: OrgContext) {
  requireOrgScope(ctx);
  return db
    .select()
    .from(widgets)
    .where(eq(widgets.organizationId, ctx.organizationId));
}
```

`requireOrgScope(ctx)` validates the context; the explicit
`organizationId = ctx.organizationId` predicate is what isolates tenants. Add
that predicate to relevant joins too. Use `assertSameOrg` for referenced ids
and pass the current transaction as its executor. Use
`requireOrgFacility` when a facility-owned workflow must be checked, and
`requireOrgRole` only for a real Owner/Admin policy floor. Facility is a
workflow boundary inside the Organization security boundary.

Return cross-org ids as absent; do not reveal their existence. Throw
`SafeError` for intentional operator-facing business rules and
`ActionConflictError` when the UI should link to a blocking record. Never return
raw database errors.

## 4. Wrap actions with `withAction()`

New and materially changed actions use `src/fn/with-action.ts`. It resolves
`OrgContext`, formats `ActionResult<T>`, handles Zod failures/conflicts, logs
unexpected errors safely, and can opt into per-user rate limiting:

```ts
"use server";

export async function createWidgetFn(
  input: unknown,
): Promise<ActionResult<Widget>> {
  return withAction(async (ctx) => {
    const data = createWidgetSchema.parse(input);
    return createWidget(ctx, data);
  });
}
```

Do not call `requireOrgContext()` again inside the callback and do not hand-roll
`try/catch`. Some legacy entity actions still use direct wrappers; migrate the
action when changing it rather than copying that pattern. Never send raw
`error.message` to the client.

## 5. Add a query-key factory and hooks

Keep all keys for the feature in one typed factory and derive detail/list keys
from its root:

```ts
export const widgetKeys = {
  all: ["widgets"] as const,
  lists: () => [...widgetKeys.all, "list"] as const,
  list: (facilityId: string) =>
    [...widgetKeys.lists(), facilityId] as const,
  details: () => [...widgetKeys.all, "detail"] as const,
  detail: (id: string) => [...widgetKeys.details(), id] as const,
};
```

Hooks call `fn/` actions, unwrap `ActionResult`, and invalidate every affected
factory root after mutations. Include `facilityId` and other filters in keys;
never use an inline query if an existing hook already owns the data. Global
query defaults live in `src/app/providers.tsx`; override freshness only when
the feature needs different behavior.

## 6. Build the UI in existing primitives

Follow the feature-folder and page-shell conventions in
[`docs/organization.md`](docs/organization.md) and
[`docs/design-system.md`](docs/design-system.md). Forms use the shared
`FormField`, inputs/selects, `FormSection`/`FormSpine` when appropriate, and one
`FormActions` footer for action errors and CTAs. Use `EmptyState`, side sheets,
dialogs, entity selects, quick-add, and file upload primitives instead of
reimplementing them.

Facility-scoped forms read the active facility from context; they do not ask
the operator to select it again. Organization operating defaults must be
available before RHF mounts and only seed create mode.

## 7. Test the production path

Add focused coverage proportional to risk:

- colocated `src/**/*.test.{ts,tsx}` for pure modules, schemas, hooks,
  components, and route handlers;
- root `tests/**/*.test.{ts,tsx}` for cross-module, database, authorization,
  concurrency, and accounting contracts;
- `tests/e2e/` for a user-visible workflow that needs browser/database proof.

At minimum, cover Zod boundaries, organization isolation, role/facility gates,
mutation invalidation or resulting UI state, and conflict/error behavior.
Follow [`docs/testing.md`](docs/testing.md) for database setup, fixtures, and
E2E naming/cleanup.

Run targeted tests first, then the relevant broader gates:

```bash
pnpm test <path-or-pattern>
pnpm lint
pnpm typecheck
```

Run `pnpm db:generate`/migration verification for schema work and
`pnpm test:e2e` when the browser flow changed.

## 8. Route documentation to its owner

Update only evergreen sources:

- domain terms and entity grain → `CONTEXT.md`
- layers, actions, query keys, routing → `docs/architecture.md`
- guards and active organization → `docs/auth.md`
- schema/query invariants → `docs/database.md` and
  `docs/schema-overview.md`
- form behavior → `docs/forms.md`
- tests → `docs/testing.md`
- object storage/evidence → `docs/storage.md`
- durable decisions → `docs/adr/`
- deferred decisions → `docs/open-questions.md`
- dated implementation notes → `docs/archive/` (or a scoped plan under
  `docs/plans/`)

Update the owning doc in the same change when the feature changes a standard.
Do not duplicate a rule into several guides unless each surface needs a concise
cross-reference.
