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
  operations; its keys match operation ids. Feedstock and production-run writes use this layer.
- The runner owns the transaction. Data-access ...InTransaction(ctx, tx, ...)
  functions and the helpers they call read and write only through `tx`,
  including reference checks and result enrichment. After-commit hooks run
  after a real commit; dry runs roll back and skip them.
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
It is a preference, not a rule. Use it for new actions. Migrate an existing
direct wrapper only when the change already rewrites that action's error
handling (for example to carry a typed `conflict` to its form); do not sweep
the remaining wrappers, and there is no lint rule for it. Some older entity
modules still call `requireOrgContext()` and format `ActionResult` in their own
try/catch; that is acceptable as long as they route unexpected failures through
the shared safe logging and error conversion helpers rather than returning raw
`error.message`.

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

Vehicles and drivers start at version 1; any future writer must bump `version` with `nextVersion` when changing a surviving row.

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
transport-leg sync, credit-batch auto-attachment and membership sample links, registry submission
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

### Structured logging — `@/lib/log` (server-only)

`logger.info({ userId, removalId }, "msg")`; `logger.child(bindings)` merges
bindings into every record. Import only from `fn/`, `data-access/`, the
isometric client boundary, and `src/db/index.ts` — never a client component.
NDJSON out, level via `LOG_LEVEL`. Redacts
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
  (`Members` · `Defaults` · `API keys`) is org configuration. Every member can view the
  Members roster; only Owners/Admins (and Platform Admins) can mutate membership
  or open Defaults. API keys require a verified Owner/Admin membership; a
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
  `/api/cron/purge-api-records`. Documents are
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

`src/db/schema/*` defines tables and types; `src/data-access/*` owns queries and
permission checks; pooling defaults are centralized in `src/db/pool-config.ts`
(`resolveAppPoolConfig`) and applied by `src/db/index.ts`. See
[database.md](./database.md) and [schema-overview.md](./schema-overview.md).

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
[0008](./adr/0008-submission-ledger-internal-seam.md). Source and sensor
creation POST directly and reconcile through separate state.

**Source-data immutability:** once a Removal, telemetry upload, or GHG Statement
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
`/api/documents/{id}` route and its signed-download flow. Legacy telemetry
import and registry-submission modules remain separate from this operator
workflow.

## Traceability Visualization

Credit-batch anchored lineage at `/traceability` (canonical).
`/chain-of-custody` is a legacy redirect that preserves search params and
forwards — do not add a page there. Deep links: `?batch=<id>` opens the batch
roll-up, `?application=<id>` an application drill-down.

Batch roll-up merges every member application's rollback, dedupes production
runs, and exposes **DAG | Map | Sankey**. Drill-down exposes **Lineage | Map |
Split | Trail**. The Sankey is a dry-mass balance with explicit exits for
ineligible feedstock, conversion loss, and in-storage mass; no net-CO2e figure
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

`.github/workflows/`: `ci.yml` (lint/typecheck/build) · `migrate.yml`
(auto-migrate on schema push to `main`/`staging`; manual reset/seed via
`workflow_dispatch`) · `migration-gate.yml` (blocks schema drift) ·
`enforce-main-source.yml` (branch-protection: `main` only from `staging`) ·
`e2e.yml` and `e2e-live.yml` (Playwright, see [testing.md](./testing.md)) ·
`isometric-health.yml` and `storage-health.yml` (daily read-only pings) ·
`claude.yml` and `.coderabbit.yaml` (AI review).

CI secrets come from 1Password via `1password/load-secrets-action` plus the
`OP_SERVICE_ACCOUNT_TOKEN` repo secret; only `CLAUDE_CODE_OAUTH_TOKEN` remains a
plain Actions secret. See [security.md](./security.md) → Secrets Management.

## Output stock

See [Output stock and completed deliveries](output-stock.md) for physical FIFO,
conserved dry stock, immutable corrections, and saved downstream provenance.

## REST credential boundary

`/api/v1` bypasses session middleware. Private routes authenticate through
`resolveApiContext`. This privileged authentication seam reads the key's hash,
owner and live membership through `data-access/api-credential-auth.ts` before
constructing an `OrgContext`; its cross-organization lookup is explicitly
waived. Membership hooks use the same module to disable affected credentials.
Ordinary credential management keeps the action → data-access → database
flow and never trusts input organization or owner IDs. The plugin retains
hashing and verification responsibility.

`GET /api/v1/me` uses `lib/read-models/api-me.ts` → `data-access/api-me.ts`;
route handlers do not import the database. The shared REST problem builder
lives at `lib/api/problem.ts`. See [auth.md](./auth.md#api-credentials) for
credential and denial contracts.

### Operation effects and API bookkeeping

`src/lib/operations/runner.ts:Operation` optionally supplies `describe(input,
output)`, which returns `src/lib/operation-effect.ts:OperationEffect`: outcome
code (`created`, `updated`, `deleted`), entity type and ids, versions before and
after, and changed field names. It contains no field values. The runner returns
this transport-neutral effect alongside data.

Dry-run stock writes also return `stockEffects` beside `data`. The runner supplies
an optional `OperationScope.snapshotStock` observer, passed to transaction writers.
Writers declare the affected old and new bins after their normal locks and before
the first mutation. The runner reads the balances again after execution, inside
the same transaction, and returns one before/after/delta entry per changed bin.
Real writes and the UI have no observer and pay no snapshot reads. Feedstock
wet kilograms use the existing stock derivation; dry kilograms are its
intake-moisture estimate, nullable when unavailable. Output bins use the guard's
all-layer dry balance (null for unresolved layers) and leave wet kilograms null. This contract replaces the
feedstock-create additions-only `preview` and is shared by create, PATCH and
DELETE in REST and MCP. Future output-stock operations can pass the same observer.

Production-run operation inputs accept offset date-time strings or facility-local
`{ date, time }` objects. Local times resolve through the transaction's effective
facility, including a new facility on update. Native Dates are an in-process
convenience and do not appear as a third published shape. UI actions validate
the form contract before passing only operation fields to the runner.

The `audit` run option supplies request id, credential id and optional OAuth
client id for API writes only. Audited operations must implement `describe`.
`src/data-access/api-audit-events.ts:writeApiAuditEvent` records the effect and
resolved organization/user inside the operation's transaction. UI writes do
not pass `audit`; dry runs and idempotent replays add no audit row.

Stored outcome v2 is `{ kind: "success", data, effect? }` in
`api_idempotency_records`, with schema version 2. Effects retain outcome code,
entity ids and versions for adapters; data is JSON-normalized and a void result
is stored as `null`. Only committed successes are retained. Older schema
versions answer `replay_unavailable`. The claim path deletes expired records
lazily before reclaiming their keys.

`src/lib/api/guards.ts:preAuthGuard` charges the pre-authentication IP limit
first. Routes then resolve the credential with `resolveApiContext` (including
organization API access), and call `src/lib/api/guards.ts:postAuthGuard`: the
write kill switch precedes credential and organization limits, charged in that
order with separate read/write budgets. Dry runs count as writes. PostgreSQL
token buckets are debited outside the operation transaction; rollback never
refunds them. Limits come from `src/config/api-rate-limits.ts:API_RATE_LIMITS`.

`GET /api/cron/purge-api-records` verifies a bearer `CRON_SECRET`, then purges
expired idempotency records and idle rate-limit buckets in bounded batches.
`vercel.json` schedules it daily at 03:00 UTC on Production deployments only.
Staging is Preview and relies on lazy claim expiry; see
[security.md](./security.md#environment-variables).

### Feedstock REST adapter

`lib/api/route.ts` records the deadline, runs `preAuthGuard`, resolves the
credential, checks role/scope through `admitApiRequest`, then runs
`postAuthGuard` before the handler. GET and HEAD use read budgets (including
`/api/v1/me`); all other methods, including dry runs, use write budgets. Guard
denials return directly. Admitted responses, including problems, carry the
returned rate-limit headers alongside private response headers. Domain
failures use the server-action conversion with REST's value-free logger;
unexpected errors never expose their messages or causes.

Feedstock reads and stale-write re-reads use `lib/read-models/api-feedstocks.ts`,
which calls `data-access/api-feedstocks.ts`. Read models accept an organization
context, parsed filters, a limit and a decoded cursor position, and return
representations plus the next position. REST and MCP share parsed-input readers in `lib/api/*-queries.ts` and cursor encoding and decoding;
`lib/read-models/api-list.ts` owns page slicing for feedstock and lookup reads. The list orders by
`(createdAt, id)` descending and keeps PostgreSQL microseconds in the cursor;
cursors bind the resource, organization and filters, but not page size. The
representation deliberately contains only feedstock-owned fields and reference
ids, without joined transport data or entity names. Supplier-location and driver
ids are not feedstock columns. Percent values use 0–100. Business dates use
`YYYY-MM-DD`; creation/update instants use UTC RFC 3339.

`POST /api/v1/feedstocks` records an intake that may split across bins, so
`data` is always an array of the created feedstock representations, including
for one allocation. The REST adapter caps each intake at 200 allocations.
`Location` and `ETag` identify the first returned feedstock;
each array member also has its own id and version. GET detail and PATCH return
one object. All mutation responses map the runner's JSON outcome, keeping
create and PATCH replay bodies identical to the original response.

PATCH passes partial input to the operation, which resolves omitted fields
against the locked row. The body cannot supply `feedstockId` or
`expectedVersion`; these come from the path and strong If-Match tag. Revision
and target checks run in the operation's execute phase, after the runner's
idempotency replay, so a committed retry remains recoverable after later edits
or deletion. Version/revision conflicts return the current representation.

A create dry run returns `preview` alongside `data`: one entry per allocation,
with wet/dry kilograms and the stock contribution. These are additions, not
projected bin balances; only complete intake rows contribute to the wet stock
lane. DELETE dry runs return the representation that would be removed, and
run the same locked deletion guards before rolling back. Bodyless DELETE is
accepted; supplied bodies use the bounded JSON reader and must be empty objects.
Stock-lane refusals return `insufficient_stock` with the bin and blockers plus
`errors[].meta`: `storageLocationId`, `availableWetKg`, `requestedWetKg` and
`unit: "kg"`. For post-write integrity, available mass is the proposed intake
supply plus positive net movements; requested mass is existing consumption plus
negative net movements. The operator message remains unchanged.

### Intake lookup REST adapters

Facilities, suppliers, feedstock types, storage locations, vehicles and drivers
expose read-only list and id-or-code routes through `lib/api/route.ts` and their
resource scopes. `lib/api/*-queries.ts` validates strict query schemas and calls
`lib/read-models/api-*.ts`, including the supplier-location list. The read models
map explicit output schemas in `lib/representations/`; organization predicates
and facility-filter checks remain in `data-access/api-*.ts`.

`lib/api/lookup-query.ts` shares the feedstock cursor contract: newest-first
`(createdAt, id)` ordering, PostgreSQL microseconds, organization/resource/filter
binding, configured page limits, and no totals. Lookup search is a literal,
case-insensitive prefix on code or name; `code` is exact. Only storage locations
have a facility filter. Each lookup table reserves codes per organization, so
facility-level code ambiguity is not possible with the current constraints.

Lists exclude archived rows where supported; detail reads return them with
`archivedAt`. Facilities, suppliers, feedstock types, storage locations, vehicles
and drivers return row versions and strong version/revision ETags on detail reads.
Vehicles and drivers have no archive column and return `archivedAt: null`.
Output projections exclude contact fields and driver license numbers. Facilities expose `timeZone`, storage
locations expose the material lane, capacity in kilograms and feedstock-type
restriction, and vehicles expose their stored identifier/plate and vehicle type.

`GET /api/v1/suppliers/{id}/locations` accepts a supplier UUID only, checks the
parent's organization before querying its children, and paginates locations with
name search and coordinates in decimal degrees. Its cursor also binds the
supplier ID; a missing or foreign supplier returns 404, including when it has
no locations. Supplier locations have no code or archive column.

### Public API contract

`src/lib/api/openapi/document.ts:buildOpenApiDocument` builds OpenAPI 3.1 with
relative `/api/v1` servers and stable operation ids. Operation bodies use only
`src/lib/operations/json-schema.ts:toOperationJsonSchema`; output representations
use Zod's output JSON Schema conversion. Strict query schemas live in
`src/lib/api/query-schemas.ts` and `src/lib/api/query.ts`. The `resourceQueries`
map is shared by resource adapters and the document generator. Descriptions belong in
Zod schemas. Transport headers and possible statuses are declared in the generator.
The generator imports no runtime credentials, environment or database modules.

`GET /api/v1/openapi.json` and `GET /api/v1/llms.txt` are public, bypass credential
resolution and rate-limit guards, and cache publicly for 300 seconds. OpenAPI
serialization is cached lazily per module instance; the agent guide is a
module-level string. Each origin response carries a fresh `X-Request-Id`. The short
agent guide covers discovery, units, local business dates and safe retry behavior.
The rendered reference remains deferred in
[open-questions.md](./open-questions.md).

Run `pnpm openapi:generate` after a contract change and include `openapi/v1.json`
in its PR. The colocated generator test compares the exact stable, pretty-printed
snapshot with code (compact leaf schemas keep the generated file below the line cap),
checks route coverage and validates the OpenAPI structure.

`pnpm openapi:client-check` generates TypeScript API types from `openapi/v1.json`
with `openapi-typescript` into a temporary directory outside the repository,
then checks that file with the repository's TypeScript compiler using
`tsc --noEmit --strict`. The temporary directory is removed on success or failure;
the generated client is not committed. CI runs this check in `quality-static`
on every PR and push, including the first release without a base snapshot.

The CI `openapi-breaking` job compares the PR base SHA snapshot with the head
using checksum-verified oasdiff v1.32.1 and `breaking --fail-on ERR`. A base without
the snapshot is the first release and passes with an explicit notice.

Prefer additive changes in v1; incompatible versions use v2 with Deprecation and
Sunset headers. For an accepted deliberate break or contract correction, regenerate
the snapshot and add the specific method/path and exact change description from
`oasdiff breaking <base> openapi/v1.json --format singleline` to
`openapi/accepted-breaking-changes.txt` in the same PR. CI passes that file to
`--err-ignore`; do not blanket-ignore a check or endpoint. Explain the client
impact in the PR and remove stale entries after the change reaches the base.
The [oasdiff ignore-file format](https://github.com/oasdiff/oasdiff/blob/v1.32.1/docs/BREAKING-CHANGES.md#ignoring-specific-breaking-changes)
requires the method/path (or `components`) and change description on each line.

### MCP tools on API keys

`src/app/api/mcp/route.ts` serves stateless JSON-RPC POSTs through the pinned
`mcp-handler` and MCP server SDK. GET and DELETE return 405. Origin validation
runs first; requests without Origin pass. The shared `lib/api/route.ts`
admission wrapper starts the deadline before authentication, assigns a request
id and applies the same API-key resolver and rate-limit buckets as REST.
After authentication, the preparation hook bounds the body to `API_BODY_MAX_BYTES`
and returns HTTP 413 `payload_too_large` if it exceeds that limit. JSON-RPC
batch arrays return HTTP 400 `batch_not_supported`. Both refusals use
`application/problem+json` and precede authenticated rate limiting and dispatch.
`lib/mcp/server.ts` classifies calls to write tools as writes, including dry runs;
other admitted MCP requests count as reads.

`src/lib/mcp/tools/read-tools.ts` defines whoami, the intake find tools and
get_feedstock. Each request captures its resolved context in a fresh server.
`src/lib/mcp/tools/write-tools.ts` adds log_feedstock_delivery, update_feedstock
and delete_feedstock through the same operation runner as REST. Each write needs
one requestKey reused on retry; dryRun previews may omit it. Updates and deletes
take expectedVersion from get_feedstock. Audit rows record transport `mcp`.
Only tools authorized by `hasRoleAndScope` are registered or callable. Tool
schemas reuse REST query schemas and transport-neutral `lib/representations/`
output envelopes. Numeric limits accept JSON numbers as well as REST strings.
HTTP-only ETag builders live in `lib/api/representation-etags.ts`.

The SDK publishes schemas through `toToolSchema`. A low-level tools/call
handler owns argument parsing so validation failures remain structured.
Success structuredContent uses the matching REST response envelope. Expected
failures use the REST problem code and JSON Pointer errors, named `issues` in
MCP, without HTTP metadata. MCP `invalid_query` results include Zod issues
as JSON Pointer `issues`; REST query failures return an empty `errors` array.
Each output schema is a success/error union with `type: "object"` at its root.
Unexpected failures are generic JSON-RPC internal errors, logged with
request id and tool name without raw input. The tool dispatcher checks the
request deadline before each tool. `API_WRITES_DISABLED` returns an in-MCP
`isError` result with code `api_writes_disabled`; reads keep working. No sessions
are exposed. Initialize returns short server instructions built from the domain
section shared with `llms.txt`, plus MCP grounding and retry guidance.
