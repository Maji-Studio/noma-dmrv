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
  -> lib/read-models (transport-neutral read orchestration)
  -> data-access (org scope + queries)
  -> db (Drizzle schema + connection)
```

- UI never talks directly to `db`; no layer skipping.
- `fn/` is `"use server"`, validates with Zod, returns `ActionResult<T>`.
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

### `withAction()` — the preferred pattern for new and changed server actions

`src/fn/with-action.ts` is canonical. It calls `requireOrgContext()`, injects
`ctx`, converts distinct `ZodError` issues into readable sentences, and formats
`ActionResult`.
Use it for new actions and migrate a legacy direct wrapper when materially
changing that action. Some older entity modules still call
`requireOrgContext()` and format `ActionResult` in their own try/catch; their
presence is compatibility debt, not a pattern to copy. Until migrated, those
wrappers must keep routing unexpected failures through the shared safe logging
and error conversion helpers rather than returning raw `error.message`.

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
`op` context. `mapError(error)` runs after the Zod and conflict branches and
before the logged fallback: return a failure result for a domain error the
action answers itself (a field error, a conflict of its own; the returned
shape is preserved in the action's result type), or `undefined` to fall
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

`src/types/actions.ts`. The failure branch may carry
`conflict?: { entity, id, code }` so a form can deep-link the operator to the
blocking record instead of only showing text. Forms are expected to honor it.

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
  (`Members` · `Defaults`) is org configuration. Every member can view the
  Members roster; only Owners/Admins (and Platform Admins) can mutate membership
  or open Defaults. `/certification/settings` is registry configuration and
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
- Data-access org checks remain the source of truth for authorization; the proxy
  is routing, not authz. See [auth.md](./auth.md).
- Six API route families: `/api/auth/[...all]`,
  `/api/storage-local/[...key]`, `/api/documents/[id]`,
  `/api/ghg-statement-reports/[reportId]`, and
  `/api/certification/submissions`, plus private `/api/reads/*`. Documents are
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
  underlying record is fixed (see `CONTEXT.md`).
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
