# Architecture

Cross-cutting structure of the noma-dmrv app: the layer stack, the tenancy and
auth contracts every server action inherits, and the conventions specific
surfaces (certification, dashboard, traceability) rely on. Read it before adding
a `fn/` action, a `data-access/` query, or a new route group. Form detail lives
in [forms.md](./forms.md); naming and React rules in
[code-style.md](./code-style.md); "why" decisions in [ADRs](./adr/).

## Layers

```text
components (UI)
  -> hooks (React Query)
  -> /api/reads Route Handlers (migrated reads) / fn (everything else)
  -> lib/read-models (reads) / lib/operations (migrated writes)
  -> data-access (org scope + queries)
  -> db (Drizzle schema + connection)
```

- UI never talks directly to `db`; no layer skipping.
- `fn/` is `"use server"`, validates with Zod, returns `ActionResult<T>`.
- Trusted-context implementations (anything taking an already resolved
  `OrgContext`) live in directive-free modules. Migrated writes use
  `src/lib/operations/`; legacy cores remain under fn/**/*-core.ts.
  A `"use server"` file exports only actions that resolve their own context
  from the session (`withAction`); CI enforces this with
  `pnpm check:server-action-exports`.
- `src/lib/operations/` defines each operation as an `id`, an `input` Zod
  schema and an `execute` function. `runOperation` serves transports with
  JSON-normalized results, idempotency and dry run. `runOperationInProcess`
  serves Server Actions with native types, including `Date` and `undefined`.
  The action shape is `withAction((ctx) => runOperationInProcess(op, ctx, input))`.
  `src/lib/operations/registry.ts` is the explicit allowlist of exposed
  operations; its keys match operation ids. Feedstock, production-run, biochar-product and
  output-stock movement, lab sample and order writes use this layer (`make_biochar_product`,
  `update_biochar_product`, `record_output_stock_movement`, `record_lab_sample`,
  `update_lab_sample`, `delete_lab_sample`, `record_order`, `update_order`,
  `delete_order`). Application writes use the registered `record_application`,
  `update_application` and `delete_application` operations. UI product deletes
  stay off the runner. Lost mass form edits run `record_output_stock_movement`
  with the unpublished `requireLatestCorrection` option. Delivery updates run
  the UI-only `update_posted_delivery` operation: the delivery row, stock
  correction and transport legs share its transaction. Both use the shared
  stock writer with a strict latest-entry check. These UI options and the
  delivery operation are not published in REST/MCP. The native correction
  contract stays dependency-based.
- The runner owns the transaction. Data-access ...InTransaction(ctx, tx, ...)
  functions and the helpers they call read and write only through `tx`,
  including reference checks and result enrichment. After-commit hooks run
  after a real commit; dry runs roll back and skip them.
  Before COMMIT, deadlocks, serialization failures and operation lock-timeout aborts retry the whole transaction within the deadline, including dry runs; exhausted attempts return retryable `concurrent_write_retry`.
- Runner activity uses `activity.scope(entityId, scopes)` to record one event per
  distinct batch/run scope in the write transaction. Application updates retain
  scopes for both former and current batches; delete captures scopes before
  removing shares and passes them with the initiating source to document
  retirement. Sources are `form`, `rest`, `mcp` or a trusted `script` override.
  Dry runs and idempotent replays emit no activity.
- `src/lib/read-models/` holds server-only read cores that take an already
  resolved `OrgContext` and return domain data. They are not Server Actions and
  are not exported from a `"use server"` file; the caller authenticates first.
  Today that caller is the `/api/reads/*` adapter; a `fn/` action that needs the
  same read wraps the core in `withAction` rather than duplicating it.
- `data-access/` owns query composition **and** org-scope enforcement. A
  partial update reads `undefined` as omitted, `null` as an explicit clear,
  and `0` as zero; values the server owns (derived masses) and cross-field
  rules are resolved against the locked stored row, never trusted from the
  patch. See [forms.md](./forms.md#the-partial-update-contract-omitted--null--zero).

## Tenancy — the actual authorization model

**Organization, not facility, is the security boundary** (ADR
[0010](./adr/0010-shared-schema-org-column-tenancy.md), and
[organization.md](./organization.md)). Every domain table carries
`organizationId`. Facility scope is a *view* filter; org scope is the *guard*.

- A query filtered only on `facilityId` is a tenancy bug. Filter on
  `organizationId` too, or prove the facility itself was org-checked.
- `requireOrgContext()` (`src/lib/auth/server.ts`) resolves the active
  `OrgContext` = `{ userId, organizationId, orgRole, isPlatformAdmin }`.
- Guards in `src/data-access/utils.ts`, all taking `ctx: OrgContext`:
  `requireOrgScope(ctx)`, `assertSameOrg(ctx, table, id, executor?)`,
  `requireOrgFacility(ctx, facilityId)`. Role floors via `requireOrgRole(ctx, minRole)`.
- **Inside a transaction, pass `tx` as `assertSameOrg`'s `executor`.** Reading
  through the global pool from an open transaction starves the pool under
  parallel load — each waiting tx holds a connection.

## Key Patterns

### `withAction()` — the preferred pattern for new server actions

`src/fn/with-action.ts` is canonical. It calls `requireOrgContext()`, injects
`ctx`, converts distinct `ZodError` issues into readable sentences, and formats
`ActionResult`.
Every server action uses `withAction`; do not hand-roll
`try { requireOrgContext() } catch` in new or existing actions. Pass the entity's
log message and `op` via `log`, the operator-facing fallback via
`fallbackMessage`, and a Zod prefix via `zodErrorPrefix`. Use `mapError` for
`SafeError` subclasses needing a `field` or fixed message. Failures retain the
wrapper's `code`, `issues` and `conflict` fields. Three kinds of catch stay:
actions without an active org (platform admin, invitation bootstrap,
organization switching), because `withAction` always resolves one; inner
catches outside the action's boundary (a best-effort follow-up after a commit,
a rollback or release, or translating a library error into a `SafeError`); and
actions that surface a library's own error message that is not a `SafeError`
(the Better Auth member and invitation actions in `organizations.ts`).
`pnpm check:action-boundaries` enforces this rule and holds the allowlist.

```typescript
export async function createItem(input: CreateItem) {
  return withAction(async (ctx) => {
    const data = createItemSchema.parse(input);
    return createItemRecord(ctx, data); // data-access re-checks org scope
  });
}
```

Rate limiting is opt-in per action: `withAction(fn, { rateLimit: { key, max,
windowMs } })`, checked after auth so it keys on the resolved `userId`. It
applies to expensive or abuse-prone actions: certification submits and geo
geocode/route are the current users.

Two more options exist for migrating the legacy wrappers without changing what
they log or return. `log: { message, context }` replaces the generic
"server action failed" log line, so an entity module keeps its own message and
`op` context. `mapError(error)` runs after the Zod, `DomainError` and conflict
branches and before the logged fallback. A `DomainError` is always formatted
by `toActionFailure`; `mapError` never sees it. Return a failure result for
another safe error the action answers itself (a field error, a conflict of its
own; the returned shape is preserved in the action's result type), or `undefined` to fall
through. A mapped result bypasses `toActionError` and is not logged, so map
only error classes that extend `SafeError`, whose messages are written for
the operator; anything else must fall through to the logged fallback.

### `SafeError` vs `Error`

`src/lib/errors.ts`. Only `SafeError` messages reach the operator verbatim;
`toActionError` replaces anything else with the fallback. Throw `SafeError` for
intentional business-rule messages, plain `Error` for genuine failures — a
detail-rich plain `Error` is silently swallowed, and a leaky `SafeError` is a
disclosure bug.

### `ActionResult` — every server function returns this

`src/types/actions.ts`. The failure branch keeps readable `error` text and
adds an optional stable `code` plus `issues` with field paths, issue codes,
messages and safe constraint metadata. Domain errors keep their domain code;
Zod failures use `validation_failed`. A stale conflict uses `stale_version`,
and other typed conflicts use `conflict`. Legacy safe errors and unexpected
failures can still omit `code` and `issues`.

The failure branch may carry `conflict?: ConflictRef` so a form can deep-link
the operator to the blocking record instead of only showing text, and `blockers?: ConflictRef[]` next to it
for the further records that also stand in the way, in the order the operator
should clear them. `ConflictRef` (`src/lib/conflict-ref.ts`) is
`{ entity, id, code }`. `code` is what the operator reads for that record,
branded through `conflictCode()`, which proves only that it is not blank; the
type does not prove it is a stored record code. The convention is the record's
human code, and `conflict` points at a record that has one (the bin, not the
movement). Known exceptions: a bin movement rides as a `blocker` under its
history-row label, and the stale-version sentinel
`stale-version`. A record without a code of its own is reported as the coded
parent the operator manages it from: a feedstock-type delete blocked by a
production process names its facility, one blocked by a formulation
ingredient names its formulation. Mutation hooks re-throw a
failure through `throwActionError` (`src/lib/stale-version.ts`): a stale save
becomes `StaleVersionError`, any other conflict becomes `ConflictError` with
its blockers. Forms are expected to honor both; the first list consumer is
the feedstock edit sheet, which shows the runs and products a negative-stock
refusal named.

The success branch may carry `warning?: string`: the write committed and a
non-fatal follow-up did not (a preference that was not stored, an enrichment
read that failed). A writer that enriches its result with a separate read
passes its `tx` to that read (`Executor` in `src/data-access/utils.ts`) so a
failed read rolls the write back rather than describing a saved row as
missing; `warning` is for the reads that genuinely cannot join the
transaction. Never use it to describe a rollback. Copy vocabulary:
[ux-writing.md](./ux-writing.md).

### Expected-version checks on edit forms

`src/data-access/row-version.ts` owns the integer row-version pattern.
Call `assertRowVersion` immediately after the org-scoped `FOR UPDATE` read,
and include `nextVersion` in every writer's `.set()` so the version increments
in the same statement as the change. Sibling and cascade writes bump every
affected row too, including facility archive and restore. Ordinary UI updates
and deletes must send the `expectedVersion` loaded when the operator opened
the record. Feedstocks, facilities, reactors, storage bins, suppliers and their
locations, customers and their locations, formulations, feedstock types,
facility emission factors, production runs, production incidents, in-process
measurements (`productionSamples`), biochar products, lab samples, orders,
deliveries, transport legs, applications, and credit batches use integer row
versions. Inserts start at version 1. Stock loss, count, and correction commands
send the product versions from their preview; posting checks the affected
products and returns their incremented rows. Delivery creation deliberately
consumes current stock under bin locks and bumps its affected products as an
internal side effect. Facility archive and restore bump descendant runs and
products without child preconditions.

Vehicles, drivers and operators use integer row versions for edits and deletes (`src/data-access/vehicles.ts`, `drivers.ts`, `operators.ts`).

Successful saves and corrections merge returned versions into every list cache
that supplies edit sheets before invalidation. Stale deletes refresh the list
and explain that the record was not deleted.

A mismatch throws `DomainError` with `code: "stale_version"` and a conflict
reference to the edited record using the `stale-version` sentinel. The hook
re-throws it as `StaleVersionError` through `src/lib/stale-version.ts`. The
form shows `STALE_VERSION_MESSAGE` while keeping the operator's draft.

The emission-factors upsert instead requires `expectedVersion: number | null`.
Its form sends `null` when it loaded no row, so a row saved since (or a
concurrent first save, serialized by the facility row lock) is refused as stale.
A numeric version must match the locked factors row.

Internal current-state commands bump without child preconditions: derived
transport-leg sync, credit-batch auto-attachment, registry submission
state, removal deletion, claim reservations, delivery stock-posting side effects,
and facility archive/restore cascades.

### Facility context

Invariants (implementation: `src/hooks/use-facility-context.ts`): the active
facility persists via `?facility=<id>` + localStorage through `nuqs`; sidebar
hrefs carry it; **forms never ask the user to pick a facility** — they read it
from context.

### Quick-Add and cascading selects

Quick-Add lets a form create a missing prerequisite without leaving the page:
schemas in `src/schemas/quick-add.ts` (minimal fields only); after create call
`seedEntityCache()` from `@/components/forms/entity-select/cache-utils` to
populate the dropdown; `useOpenCreateIntent()` opens create dialogs from
`?create=true` deep links. `FormEntitySelect` auto-clears when parent values
change via `dependsOn` (backed by the standalone `useClearOnDependencyChange`).
See [forms.md](./forms.md).

The vehicle, driver and operator quick-add dialogs also edit: pass the loaded
record (`vehicle`, `driver`, `operator`), or render `EntityEditDialog` with
`{ entityType, entityId, isOpen, onClose }` to load it by id. A save seeds the picker's entity cache
with the new name. Deletes refuse while any record references the row and name
where it is used (`src/data-access/fleet-usage.ts`). A vehicle's type and model year are
copied onto each feedstock intake's derived transport leg as evidence. Edits to
either field refresh only unsubmitted legs in the same transaction. Submitted
legs keep their snapshot. Delivery references are not included in the vehicle
edit lookup.

### Structured logging — `@/lib/log` (server-only)

`logger.info({ userId, removalId }, "msg")`; `logger.child(bindings)` merges
bindings into every record. Import only from `fn/`, `data-access/`, the
isometric client boundary, and `src/db/index.ts` — never a client component.
NDJSON out, level via `LOG_LEVEL`, validated by the logger itself without loading
app configuration. Redacts
`email`/`token`/`secret`/`authorization` keys at any depth — a backstop, not a
license to log PII. The in-house implementation replaces pino because of a
Turbopack/Vercel runtime bug.

**Waiver — `src/db/index.ts`.** The connection pool is the bottom layer and is
constructed at module scope, so there is no layer above it to inject a logger
from; pool telemetry has to be wired up where the pool is built. That module
calls `logger.child` during module evaluation, so a test that mocks
`@/lib/log` and transitively imports `@/db` must give the mock a `child` that
returns a logger. The rest of `src/db/` receives its logger as an argument
(`createObservedPool`, `createObservedClient`) and never imports `@/lib/log` at
runtime.

## Routing & Auth

- `src/app/(auth)/*` public · `src/app/(app)/*` authenticated workspace ·
  `src/app/(app)/admin/*` admin-only · `src/app/api/*` API routes.
- `src/app/(app)/layout.tsx` enforces auth and mounts `FacilityProvider`.
- **Three configuration surfaces, deliberately not one.** `/settings`
  (`Members` · `Defaults` · `Vehicles and crew` · `API keys`) is org configuration. Every member can view the
  Members roster; only Owners/Admins (and Platform Admins) can mutate membership
  or open Defaults. Every member can edit and delete vehicles, drivers and
  operators in Vehicles and crew, as every member can create them from a picker. API keys require a verified Owner/Admin membership; a
  Platform Admin without that membership cannot manage keys.
  `/certification/settings` is registry configuration and
  stays there by ADR
  [0007](./adr/0007-certification-workspace-consolidation.md). `/admin` is
  cross-tenant platform administration (`users.role === "admin"`) and is now
  only the organization directory — `/admin` itself redirects to
  `/admin/organizations`. Both settings surfaces render the shared
  `SettingsRail`; `/settings` selects by route, `/certification/settings` by
  `?section=`.
- `src/proxy.ts` → `updateSession()` in `src/lib/auth/middleware.ts`. Node
  runtime (not Edge) so Better Auth can use `crypto`. The matcher covers
  everything except static assets — **including `/api`**; `/api/auth/*` is
  explicitly allowed through.
- The proxy lets exact `/api/mcp`, `/api/v1`, and `/api/v1/*` through before
  session lookup. MCP and private REST routes resolve bearer API keys with `resolveApiContext`;
  `/api/v1x`, `/api/mcpx` and `/api/mcp/tools` stay behind the session, covered by
  `tests/middleware.test.ts`.
- Data-access org checks remain the source of truth for authorization; the proxy
  is routing, not authz. See [auth.md](./auth.md).
- Nine API route families: `/api/auth/[...all]`,
  `/api/storage-local/[...key]`, `/api/documents/[id]`,
  `/api/ghg-statement-reports/[reportId]`,
  `/api/certification/submissions`, private `/api/reads/*`, bearer-authenticated `/api/v1/*`,
  authenticated `/api/mcp`, and secret-authenticated
  `/api/cron/*` routes: `purge-api-records` and `sweep-document-uploads`.
  Both crons run only on Vercel Production; the site deployment answers 404 to
  both routes. Documents are
  normally resolved through `getOrgContext()`. The report route is the one
  deliberate public bearer-capability seam: middleware lets it through, then
  the route verifies a per-report token against the stored digest and redirects
  to a freshly signed
  private-object URL. Its cross-org lookup is marked
  `// org-scope-ok: verifier capability-token lookup intentionally crosses organizations.`
  Do not generalize that waiver to other reads; see [auth.md](./auth.md) and
  [storage.md](./storage.md).

## State and Data Fetching

- React Query provider mounted once in `src/app/layout.tsx`.
- **Always check `src/hooks/` first** — every entity has a hook file. Never write
  an inline `useQuery` when a hook already covers the server action.
- Query keys come from typed factories per hook (e.g.
  `facilityKeys.detailWithRelations(facilityId)`), not hand-built arrays.
- `src/app/providers.tsx` sets global query defaults:
  `staleTime: 30_000` and `refetchOnWindowFocus: false`. Hooks override
  `staleTime` deliberately where the data needs a different freshness window
  (including `0`, 5s–5m, and `Infinity`). Read the neighbouring hook and match
  its intent instead of repeating the global values mechanically.
- Invalidate related keys after every mutation.
- A Server Component that has already authorized and loaded a record seeds the
  client cache with `createServerHydrationState`
  (`src/lib/react-query/server-hydration.ts`) and renders the page inside
  React Query's `HydrationBoundary`, so the first client render reuses that
  read instead of refetching it. It builds a fresh `QueryClient` per call, so
  records can never cross requests or organizations, and stamps every seeded
  key with one request-local `updatedAt` so they age together. Seed the keys
  the page's own hooks use, imported from the plain `src/hooks/*-query-keys.ts`
  module rather than the `"use client"` hook file. The supplier and customer
  detail routes are the reference.
- No `"use cache"`, no Cache Components — React Query owns all caching. See
  [modern-patterns.md](./modern-patterns.md).

### Hook ActionResult unwrapping

Hooks unwrap an `ActionResult` with `unwrap()` from `src/hooks/types.ts`.
The only exception is a hook that reads `field`, `conflict` or `warning`, or
returns something other than `result.data`; typed errors go through
`throwActionError`. `pnpm check:action-boundaries` enforces this rule.

### Authenticated read transport

Client React Query reads use ordinary `fetch` against small resource-specific
handlers under `/api/reads/*` when that read has been migrated. This avoids the
browser's one-at-a-time Server Function dispatch queue while preserving the
existing query keys, freshness policy, and mutation invalidation. Server
Actions remain the write transport. Do not replace a read with client-side
`Promise.all` around Server Actions; those calls still share the Server
Function queue.

The seam has two parts. A read core in `src/lib/read-models/` validates its
input, checks facility inputs with `requireOrgFacility`, and calls the
org-scoped data-access functions for a caller-supplied `OrgContext`. The HTTP
adapter `src/app/api/reads/read-response.ts` resolves the context once per
request with `resolveOrgContext()` and formats failures with the same
`toActionFailure` helper `withAction` uses, so an HTTP read and a Server Action
answer with the same `ActionResult` envelope, `conflict` included. Route
handlers stay thin: they name the read, its log context, and its fallback
message. A migrated read has no Server Action wrapper left; adding one back
means wrapping the same core in `withAction`, never a second copy of the query.

Status mapping belongs to the adapter alone: a denied org context answers 401
when there is no session and 403 when the caller has no usable organization
(see [auth.md](./auth.md)), rejected input and org-scoped lookups answer 400, a
conflict answers 409, and an unexpected failure answers 500. Request bodies are
capped; resolving the context happens inside the same try/catch, so a database
failure there is logged and answered rather than escaping the handler.
Responses carry `Cache-Control: private, no-store`; the React Query function
passes its abort signal to `fetch`.

JSON is a deliberate transport contract: database `Date` values cross as ISO
strings. The typed client adapter in `src/lib/read-api/client.ts` rehydrates the
declared date fields before returning existing domain types to hooks; a null or
absent timestamp stays null rather than becoming the epoch, and each decoder
declares its timestamp columns through `dateFields<T>()`, which fails the build
if the domain type gains one. Calendar date fields such as a credit batch's
`startDate` and `endDate` remain strings. The adapter parses a response body
only when it is JSON, so a gateway error page becomes a formatted transport
failure instead of a raw parser message; a proxy's own error text never reaches
the operator, and a 401 sends them to sign in the way any navigation would.

## next.config.ts — three load-bearing settings

- `reactCompiler: true` — this is what makes the "no manual memo" rule in
  [code-style.md](./code-style.md) load-bearing rather than stylistic.
- `logging: { serverFunctions: false }` — deliberate. Some server actions accept
  write-only credentials as arguments and Next's dev logger would serialize
  them. Re-enabling leaks secrets into local logs.
- `outputFileTracingIncludes` broadly includes the evidence-ledger TTFs because
  `src/lib/certification/evidence-ledger/fonts.ts` reads them via a runtime
  `process.cwd()` path the static tracer cannot follow. Narrowing this glob
  lets the Removal submit successfully in production but without its
  evidence-ledger Source — silent compliance-evidence loss that is harder to
  detect than a submission failure.

The same file also contains an optional CI performance setting:
`experimental.turbopackFileSystemCacheForBuild` follows the dedicated
`NOMA_TURBOPACK_BUILD_CACHE=true` marker. Next 16 keeps its production compiler
cache opt-in, so PR builds persist `.next/cache/turbopack` while base-branch,
local, and deployed builds remain on the stable default.

## Database Boundaries

Supplier and customer creates lock all named facilities `FOR SHARE` in id order,
then insert the party, ordered locations and pairs inside the `withAutoCodes`
savepoint and read back through `tx`. Last explicit default wins, otherwise the
first location wins; pair filling on a new party has no references to fill.
Metadata edits take `NO KEY UPDATE`, code edits take `UPDATE`, then check the
version and code/name constraints. Deletes take the party `UPDATE`, check all
intakes/orders including archived rows, lock children in id order, check each
customer location's orders and storage-site mappings, then delete children and
the party atomically. Intake writes take facility `SHARE`, then supplier `KEY SHARE`, before their row;
orders take customer then location `KEY SHARE`. Deletes never lock references,
facilities, formulations or certification artifacts. Pair saves can take facility
and downstream locks; creates only fill new, unreferenced parents, while party
updates/deletes never request those locks. Registration takes the location FK
lock without a later parent lock. These paths introduce no reverse edge against
facility archive or formulation writes.

Formulation creates lock referenced feedstock types `FOR SHARE` in id order,
then insert the parent and lines inside the `withAutoCodes` BCF savepoint and
read back through `tx`. Updates lock the formulation `FOR UPDATE`, check its
version, lock incoming types `FOR SHARE` in id order (retained archived types
pass), then existing lines `FOR UPDATE` in id order; plain snapshot/product
reference reads and the merged integer-millionths total precede the
`withUniqueCodeGuard` write. Deletes lock the formulation `FOR UPDATE`, check
its version and read product, bin and order references (archived included)
without locks before cascading deletion. Bin create, update and quick-add hold
the formulation `FOR SHARE` after their facility/bin locks; product creation
reads recipe lines after its formulation share lock. Feedstock-type usage edits
hold the type `FOR UPDATE` and read formulation usage without locking parents.
Formulation writers request no facility, bin, product or order locks, so these
paths do not reverse product/order writers or the facility archive cascade.

Application writers share `src/data-access/application-write-scope.ts`: unlocked
discovery, sorted lineage artifacts, facilities `FOR SHARE`, production runs `FOR SHARE`, credit batches `FOR SHARE`, deliveries
`FOR UPDATE`, then the application `FOR UPDATE` and its version check. They
revalidate lineage, parent identity and discovered sets before locking application
slices `FOR UPDATE` and writing shares, slices or document retirement. Changed
sets return retryable `conflict`; no newly discovered lock is taken late. The
client retries changed-set conflicts. The runner retries deadlocks (40P01),
serialization failures (40001) and lock timeouts (55P03), and owns after-commit
storage draining.

Explicit credit-batch membership create, update and delete discover the batch,
current/prospective runs and certification artifacts unlocked, then lock sorted
artifacts, sorted facilities `FOR SHARE`, sorted runs `FOR UPDATE` on create or
membership refresh, the target production-process advisory scope, and the batch
`FOR UPDATE` with its version
check (insert on create). Both artifact helpers use
`acquireCertificationArtifactLocksSorted` and its global key ordering; create
has no existing certification lineage to guard. Runs stay before process scope
because production-run auto-attachment already holds its run when requesting
that scope. Other process-scope holders never request runs or artifacts.
Facility shares serialize archive and Removal create before child locks and FK
checks. Membership revalidates artifacts, member sets and cohort before writing
links or reconciling slices; changed artifacts or current membership return a
typed conflict with the existing refresh-and-retry copy. After process scope,
newly matching unassigned runs use `SKIP LOCKED`: they cannot wait, have no batch
artifacts, and their facility is already share-locked. A missed row returns a
typed conflict. Scalar edits and delete take no run locks; batch `FOR UPDATE`
still serializes with applications' batch `FOR SHARE` before slice writes.
Applications and membership serialize at artifacts or runs before
batch/application locks and implicit slice FK checks, closing cycles C1 and C2.
Two residual orders remain: membership refresh takes artifacts before runs,
while production-run writers take runs first; membership takes artifacts before
process scope, while run auto-attachment takes scope before batch artifacts.
All three membership writers use `src/lib/db/transaction-retry.ts`
(`retryTransaction`, `isRetryableTransactionError`, `nextRetryDelayOrThrow`),
shared with the runner, for 40P01, 40001 and 55P03. Production-run writers retain
the runner's retry and deadline handling. Exhausted attempts return `concurrent_write_retry`.

`src/db/schema/*` defines tables and types; `src/data-access/*` owns queries and
permission checks; pooling defaults are centralized in `src/db/pool-config.ts`
(`resolveAppPoolConfig`) and applied by `src/db/index.ts`. See
[database.md](./database.md) and [schema-overview.md](./schema-overview.md).

Document writes discover the owner's lineage target and ancestors unlocked,
then lock sorted certification artifacts, ancestors `FOR SHARE`, the owner
`FOR SHARE`, the mirror advisory lock (delete only), and the document
`FOR UPDATE`. They revalidate parent identity, archive state and lineage after
locking; a changed parent returns retryable `conflict`, and no new artifact is
locked after a row. Sample ancestors are their credit batch or legacy run;
applications use their delivery; internal children use their archive-bearing
parent. Archive's `NO KEY UPDATE` conflicts with `FOR SHARE`. Parent retirement
uses owner, mirror, document order; Source mirroring never locks an owner.
Sample and delivery writers use artifacts before rows. Existing feedstock, order and production-run inversions remain subject to the runner's bounded
retry. Application writers now use the runner and the artifacts-first sequence
above, closing their document-write inversion. Membership refresh also takes
artifacts before runs. The remaining production-run and membership cycles are
tracked in the [lock-order follow-up](./open-questions-architecture.md#run-writers-feedstock-edits-and-output-postings-lock-in-different-orders-datalock-order-opened-2026-10-09).

Upload promotion, leases and the privileged expiry sweep are described in
[Object storage](./storage.md#abandoned-uploads-and-cleanup).

## Computed Method-B Eligibility (Isometric)

`production_processes` stores the process epoch and the all-or-none prerequisite
record; it does not store a sampling regime or an unlock. Each credit batch
stores its immutable `sampled`/`unsampled` choice. A process is find-or-created
per `(facility, feedstock)` when a credit batch is created.

For a newly created batch, unsampled processing is allowed only when the
organization and facility are connected to Isometric, all three prerequisites
are recorded, and the live eligible-sample count since the current process epoch
meets the agreed baseline (minimum 30). See ADR
[0016](./adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)
and [0022](./adr/0022-method-b-is-computed-eligibility-not-stored-unlock.md).

## Certify Integration (Isometric)

Outbound integration submitting MRV data to Isometric's Certify API. Schema is
provider-agnostic (`certifier_*` tables) so another registry could be hosted
later; Isometric-specific HTTP, transformers, and typings live under
`src/lib/isometric/`.

```text
components/certification/  →  hooks/use-certification.ts  →  fn/certification/
  →  data-access/certification.ts  →  lib/isometric/  →  db/schema/certification.ts
```

Removal and GHG Statement writes add one transport seam between hooks and the
orchestrator: `POST /api/certification/submissions` validates the organization
context, Admin role, complete request body, and per-user submit limit before it
opens an NDJSON response. Once admitted, it calls the same `fn/certification/`
cores and streams orchestration checkpoints plus the final result. The route
sends a transport-only ping every 15 seconds; clients ignore pings and treat 60
seconds without any stream data as a stalled connection. A client disconnect
stops response writes and the route does not deliberately cancel the core, but
this is not a detached background-job guarantee: the serverless runtime may end
execution after the response is gone. Refreshing or retrying relies on the
submission ledger's idempotent reconciliation.

`submitGhgStatementToVerifier` remains as a non-streaming compatibility/fallback wrapper
for direct server consumers and backend tests. It delegates to the same core.
Its Admin guard and submit rate-limit key must stay synchronized with the streaming route; new UI callers
use the streaming route.

The one non-obvious rule: **`lib/isometric/` is pure** — no DB, no auth, no
`ActionResult`.

Application orchestration resolves the client through
`resolveIsometricClient(ctx)` in `src/data-access/certifier-credentials.ts`.
The resolver enforces `requireOrgScope`, decrypts credentials filtered on the
context's organization, and passes them to the pure `createIsometricClient` HTTP
factory. A missing row keeps the client's existing `not_configured` error.
Only Platform Admin credential verification can select another organization,
through `verifyIsometricCredentialsForOrganization` with an
explicit privilege check and `// org-scope-ok:` waiver. Scripts and dedicated
health checks use `client-env.ts`; the HTTP library never imports data-access.

**Idempotency:** Removal and GHG-Statement submission POSTs run through
`certification_submissions` as both lock and ledger — `lockedAt` blocks
concurrent in-flight retries, `payloadHash` (canonical-JSON sha256) identifies
replayable submissions, `version` tracks supersedes. The retry-decision gate is centralized in
`src/lib/isometric/utils/submission-claim.ts` (`decideSubmissionClaim`) and
applied identically by `submitRemoval` (one row per Removal, keyed
`localEntityType:'removal'`) and `submitGhgStatementToVerifier` (one row per GHG
Statement). Every submission HTTP attempt appends to `certifier_sync_events`
(append-only audit; never used for state). See ADR
[0003](./adr/0003-removal-as-submission-unit.md) and
[0008](./adr/0008-submission-ledger-internal-seam.md). Source
creation POST directly and reconcile through separate state.

**Source-data immutability:** once a Removal or GHG Statement
has a blocking ledger row (`draft`, `submitted`, `accepted`), its upstream
operational records are locked at the data-access boundary. The guard validates
the Removal's captured application-slice set against the reachable source
records before every mutation; it does not recompute submitted membership from
mutable current lineage. It blocks edits/deletes to production runs, samples,
applications, deliveries, orders, biochar products, feedstocks, and credit-batch
grouping records. Corrections are new submission versions or
correction-workflow records, never in-place edits.

**Workspace:** `/certification` (ADR
[0007](./adr/0007-certification-workspace-consolidation.md)) is a first-class
sidebar group with three concrete routes — Removals · GHG Statements ·
Settings. Root `/certification` redirects to Removals preserving `?facility=`.
Removals has list, side-sheet (`?removal=`), detail
(`/removals/[removalId]`) and review (`/[removalId]/review`) surfaces; new
Removals are created through the New-Removal wizard. Settings holds the
facility↔project link and emission/LCA config.

**`CertificationRegistryGuard`** (`src/components/certification/`) gates the
operational `/certification/*` routes on the facility having a registry link;
Settings stays open. It is mounted in the certification layout. **New
operational certification routes must sit inside that guard.**

**Generated GHG Statement report:** an Owner/Admin prepares a versioned PDF from
live Isometric statement and GHG Entry facts, reviews it through the normal
org-scoped document route, then approves it. Submission rotates a random
per-report verifier token, stores only its SHA-256 digest, and sends Isometric
the public capability URL. Prepared/approved/submitted versions are retained;
regeneration creates a new row and object rather than overwriting earlier
evidence. The verifier URL is a narrow exception to normal session auth, not a
weaker authentication mode for Certification generally. The submit dialog also
retains a mutually exclusive explicit external-report URL fallback; it does not
create a generated report row or use this capability route.

Credit-batch detail and health surfaces show readiness/membership/blockers but
never submit — submission is consolidated in the workspace. Phase status and
deferred work: [isometric/integration-plan.md](./isometric/integration-plan.md)
and [open-questions.md](./open-questions.md). Registry facts are authoritative
only from the Isometric MCP — see [isometric/README.md](./isometric/README.md).

Removal membership is persisted at the application-by-credit-batch slice. An
assigned slice freezes allocated wet mass, allocated dry mass, and its owning
Removal. Unassigned slices have no owning Removal and remain available for a
later one without changing an earlier Removal. Noma submits those frozen
accounting inputs; Isometric owns the project-emissions calculation and net
result.

## Dashboard

Facility-scoped operations dashboard at `/dashboard`
(`src/app/(app)/dashboard/page.tsx` → `DashboardView`).

- Fresh organizations first see the computed setup guide (or the member
  setup-in-progress state); it collapses to a strip and disappears as setup
  records are created. Setup steps are derived, not saved checklist state.
- The current Flow Hero body is a four-stat KPI band, the traceability hero
  (`Overview` · `Flow` · `Needs attention`), then Attention, Recent activity,
  and Certification panels. Week/month/all only changes the range-scoped KPI
  and mass-flow values.
- One `getDashboardOverview` action supplies the page. Its aggregate lives in
  `src/data-access/dashboard-overview.ts`, with shared predicates/loaders in
  `dashboard-attention.ts`, `dashboard-stations.ts`, and
  `dashboard-structural-gaps.ts`.
- **Attention items** are computed from existing MRV records only. They have no
  independent lifecycle, assignee, or completion state; they disappear when the
  underlying record is fixed (see `GLOSSARY.md`).
- Dashboard queries follow the standard layer flow and are org- and
  facility-scoped at the data-access layer.

## Production Run Extensions

The production-run detail page hosts a readings-file evidence surface plus two
child entities: **Samples** (in-process measurements with file upload) and
**Incidents** (severity + corrective actions).

`ProductionReadingsDocuments` stores the operator's original CSV unchanged as
`documents.entity_type='production_run'`, `document_type='sensor_data'` via the
normal presigned flow ([storage.md](./storage.md)).
The operator UI does not inspect the CSV or import row-level
`production_run_readings`. Stored files remain openable through the authorized
`/api/documents/{id}` route and its signed-download flow. The legacy row importer remains separate from this operator workflow.
There is no reactor time-series upload ([ADR 0006](./adr/0006-data-upload-submission-idempotency.md)).

## Traceability Visualization

Credit-batch anchored lineage at `/traceability` (canonical).
`/chain-of-custody` is a legacy redirect that preserves search params and
forwards — do not add a page there. Deep links: `?batch=<id>` opens the batch
roll-up, `?application=<id>` an application drill-down.

Batch roll-up merges every member application's rollback, dedupes production
runs, and exposes **DAG | Map | Sankey**. Drill-down exposes **Lineage | Map |
Split | Trail**. The Sankey is a dry-mass balance with explicit exits for
conversion loss and in-storage mass; no net-CO2e figure
(registry-owned, ADR [0018](./adr/0018-isometric-owns-project-emissions.md)).
Anchor model: ADR
[0011](./adr/0011-credit-batch-anchored-chain-of-custody.md).

- **Components**: `src/components/chain-of-custody/` — graph logic in
  `use-chain-graph.ts` / `chain-node.tsx` / `chain-edge.tsx`, plus `map/`,
  `sankey/`, `trail/`, `chain-constants.ts`.
- **Data**: `src/data-access/chain-of-custody{,-batch,-trail}.ts`.
- **Layout**: dagre LR layout on a React Flow canvas with minimap, hover focus,
  and record-opening side sheets.
- **Scope**: selectors and resolved anchors are filtered against the active
  facility so stale or foreign deep links cannot render another facility's
  provenance. Full detail in [traceability.md](./traceability.md).

## Shared Utilities

Import from these instead of re-declaring locally:
`src/data-access/utils.ts` (org guards) · `src/fn/with-action.ts` ·
`src/lib/errors.ts` · `src/hooks/types.ts` · `src/schemas/helpers.ts` (Zod
helpers and numeric/mass/ratio constants — see [forms.md](./forms.md)) ·
`src/components/forms/entity-select/cache-utils.ts` · `src/types/actions.ts`.

## CI/CD

`.github/workflows/`: `ci.yml` (lint/typecheck/build, Vitest in two shards) ·
`migrate.yml`
(auto-migrate on schema push to `main`/`staging`; manual reset/seed via
`workflow_dispatch`) · `migration-gate.yml` (validates migration, seed and bootstrap
paths against empty databases and checks schema drift) ·
`enforce-main-source.yml` (branch-protection: `main` only from `staging`) ·
`e2e.yml` and `e2e-live.yml` (Playwright, see [testing.md](./testing.md)) ·
`isometric-health.yml` and `storage-health.yml` (daily health checks; storage
writes and deletes a probe object, and its opt-in `repair_cors` dispatch updates
bucket CORS settings) ·
`claude.yml` and `.coderabbit.yaml` (AI review).

`ci.yml`, `e2e.yml` and `migration-gate.yml` also run on `merge_group`, so
`staging` can use a GitHub merge queue that tests each PR on top of the current
queue before it lands. `openapi-breaking` runs on PRs only.

`ci.yml` restores ESLint's content cache (`.cache/eslint`) and TypeScript's
incremental state (`.cache/typecheck.tsbuildinfo`). Cache keys include OS,
Node major, dependencies/check configuration, the tracked route-file paths,
and commit SHA; restore prefixes retain all but SHA. Route paths invalidate
the filesystem-dependent Next link rule. ESLint caches per file, so adding
type-aware or cross-file rules requires dropping the cache or widening its
key. See [testing.md](./testing.md) for local cache cleanup.

CI secrets come from 1Password via `1password/load-secrets-action` plus the
`OP_SERVICE_ACCOUNT_TOKEN` repo secret; only `CLAUDE_CODE_OAUTH_TOKEN` remains a
plain Actions secret. See [security.md](./security.md) → Secrets Management.

### Health failure response

The Maji product owner owns triage of `storage-health.yml`, `isometric-health.yml` and
`e2e-live.yml` for Maji, coordinating with DEC operators when needed. The owner
must watch repository issues in GitHub and keep issue notifications enabled.
If response ownership changes, update this section and hand over issue watching.

Failed or cancelled scheduled runs, including timeouts and a manual cancel of a
scheduled run, call the reusable `health-failure-notify.yml` workflow, which runs
`scripts/notify-health-failure.mjs` with the runner's preinstalled Node and `gh`.
Manually dispatched runs notify only on failure with `force_failure=true`; other
dispatched runs stay quiet whether they fail or are cancelled.
The monitored destination is a `ci-health` issue created by `github-actions[bot]`
with the exact stable title `CI health failure: <workflow filename>`.
The notifier ensures the label exists. Keep that label and title unchanged. An open
match gets a comment; otherwise the most recently closed match is reopened and
commented on, or an issue is created. Notification jobs serialize by workflow
to avoid concurrent issue creation. Only these jobs have `issues: write`.
No extra secret is required. Successful runs stay quiet and never close issues.
Pull requests never send notifications.

Issue bodies and failure comments contain only workflow, environment, run URL
(including rerun attempt), and UTC failure time recorded by the notifier. Storage
checks use staging; Isometric health uses staging credentials against the sandbox;
live E2E uses an ephemeral CI database against the sandbox. No credentials, PII,
or log excerpts belong in the notification.

1. Open the linked run and inspect the failed step. For storage, check the
   staging bucket credentials, endpoint, permissions and CORS using
   [storage.md](./storage.md#testing). For Isometric, follow the run's health
   summary and [testing.md](./testing.md#isometric-health-workflow). For live E2E,
   inspect the restricted Playwright artifacts and sandbox availability.
2. Record the diagnosis and response owner in the issue without copying secrets,
   PII or raw logs. Repair the cause, then rerun or dispatch the affected workflow
   with `force_failure=false` and confirm the real checks pass.
3. Close the issue manually after recovery. A later failure reopens it. If the
   notification job itself fails, check its token permissions and GitHub API
   availability, then rerun the failed job.

To verify delivery, dispatch any of the three workflows with `force_failure=true`
(leave storage's `repair_cors=false`). This skips the real health job and fails a
small probe with no secrets, database work or Playwright. Confirm that the failure issue appears
with all four fields; dispatch again to verify a comment on the same issue.
Close that issue and dispatch again to verify reopening. Finally dispatch with
`force_failure=false`, confirm recovery, and close the issue manually.

## Output stock

See [Output stock and completed deliveries](output-stock.md) for physical FIFO,
conserved dry stock, immutable corrections, and saved downstream provenance.

## REST and MCP API

The REST and MCP data-entry API shares scoped readers and operation writers with
the app. See [REST and MCP data-entry API](./api.md) for credential boundaries,
routes, scopes, idempotency, If-Match and MCP tools.
