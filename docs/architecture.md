# Architecture

## Design Goals

- Keep the MRV app simple enough to extend quickly.
- Keep data boundaries explicit so it scales without rewrites.
- Enforce security at multiple layers (route + data-access).

## Layers

```text
components (UI)
  -> hooks (React Query)
  -> fn (server actions)
  -> data-access (authz + queries)
  -> db (Drizzle schema + connection)
```

Rules:

- UI never talks directly to `db`.
- Server actions validate with Zod.
- Data-access functions enforce authorization checks.

## Routing Model

- `src/app/(auth)/*`: public auth pages.
- `src/app/(app)/*`: authenticated MRV workspace pages.
- `src/app/(app)/admin/*`: admin-only pages.
- `src/app/api/*`: API routes for auth, local storage, documents, and integration support.

The app workspace is facility-scoped. `src/app/(app)/layout.tsx` enforces authentication and mounts `FacilityProvider`; pages and forms receive the active `facilityId` from context or explicit route/search params. The legacy starter `projects` / `[projectId]` route tree was removed in the 2026-06-08 schema slim-down.

## Auth Architecture

- `proxy.ts` runs request protection and includes API routes (Next.js 16 middleware replacement using Node.js runtime).
- `/api/auth/*` is explicitly allowed through.
- Better Auth config controls signup policy with `ALLOW_SELF_SIGNUP`.
- Data-access checks remain the source of truth for authorization.

### Proxy Middleware (Next.js 16)

This app uses **Next.js 16's `proxy.ts`** instead of traditional `middleware.ts`:

**Why proxy.ts?**
- Runs in **Node.js runtime** (not Edge runtime)
- Allows Better Auth to use Node.js `crypto` module
- Same authentication logic as middleware
- Better compatibility with server-side libraries

**Location**: `src/proxy.ts` (delegates to `updateSession()` in `src/lib/auth/middleware.ts`)

**Route Protection Logic**:
```typescript
// Unauthenticated users → Redirect to /sign-in
// Authenticated users on auth pages → Redirect to app
// Session refresh and cookie management
```

**Matcher Configuration**:
- Runs on all routes EXCEPT:
  - Static assets (`_next`, images, fonts)
  - API routes handled separately

## State and Data Fetching

- React Query provider is mounted once in `src/app/layout.tsx`.
- Feature hooks in `src/hooks/` call server actions and invalidate cache keys.
- Facility-scoped query keys include the active `facilityId` when the resource is facility-specific.

### Caching Strategy

This app uses client-side caching via React Query, not Next.js 16 Cache Components.

**Configuration**: `cacheComponents: false` (default - not set in `next.config.ts`)

**Why React Query over Cache Components:**
- ✅ **Explicit control**: You decide what to cache and for how long
- ✅ **User-specific**: React Query handles per-user cache keys naturally
- ✅ **Invalidation**: Easy to invalidate on mutations with `queryClient.invalidateQueries()`
- ✅ **Optimistic updates**: Built-in support for immediate UI feedback
- ✅ **Security**: No risk of accidentally caching sensitive data server-side

**What is cached:**
- Client-side: React Query handles all data caching
  - Stale time: 30s for current data, 5m for historical
  - Query keys: `["resource", facilityId, ...specifics]` for facility-scoped resources
  - Automatic invalidation on mutations

**What is NOT cached:**
- ❌ Server components (no `"use cache"` directive used)
- ❌ API routes (all dynamic, no prerendering)
- ❌ Auth checks (always fresh for security)

**If you need server-side caching:**
- Consider enabling `cacheComponents: true` in `next.config.ts`
- See `docs/modern-patterns.md` for Next.js 16 Cache Components guide
- Only cache expensive external API calls or admin-only operations
- Never cache user-specific data or auth checks

### API Routes Configuration

All API routes in this app are dynamic by default (not prerendered at build time).

**How API routes stay dynamic:**
1. They call `getUser()` which accesses headers
2. Next.js 16 automatically makes routes dynamic when they access request-specific data
3. No need for `export const dynamic = 'force-dynamic'`

**Standard API route pattern:**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth/server";

export async function GET() {
  // Auth check makes this route dynamic automatically
  const user = await getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rest of handler...
}
```

**If you enable Cache Components (`cacheComponents: true`):**
- Use `connection()` from `next/server` at the start of handlers
- See `docs/modern-patterns.md` for detailed examples

**Routes are automatically dynamic when they:**
- ✅ Call `getUser()` or `requireAuth()` (accesses headers)
- ✅ Access `request.headers`, `request.nextUrl.searchParams`
- ✅ Use `headers()`, `cookies()`, `draftMode()` from `next/headers`
- ✅ Call `await connection()` explicitly

## Database Boundaries

- `src/db/schema/*` defines tables and types.
- `src/data-access/*` owns query composition and permission checks.
- Connection pooling defaults are centralized in `src/db/index.ts` with optional env tuning.

## Sampling Method Enforcement (Isometric)

**ADR 0016 (Phase 1, 2026-06-19):** the sampling regime moved **off `reactors`**
onto the new `production_processes` entity, keyed `(facility, feedstock)` and
spanning reactors per Biochar Protocol §8.3.1. `reactors.sampling_method` and its
Method-B baseline DB trigger (migration `0052`) were **dropped** (migration
`0057`). The credit batch is now the protocol production batch (one feedstock,
≤ 1 month under Isometric); lab samples attach per credit batch.

- Sampling regime stored on `production_processes.sampling_method` (default
  `method_a`); a process is find-or-created per `(facility, feedstock)` when a
  credit batch is created.
- DEC runs Method A everywhere. **All Method-B compute is deferred to ADR 0017**
  (live per-process eligibility, the ≥30-sample baseline, the super-admin unlock);
  only the inert `production_processes.method_b_unlocked_at` seam is laid.

Method B requires (enforced once ADR 0017 lands):

1. At least 30 prior Method-A samples in the process before unlocking `method_b`.
2. Credit batches in the process must satisfy sampled-batch cadence ≥ 1 per 10.

> **Transitional (Phase 1):** the reactor-list Method-B/cadence surface is
> removed. The legacy reactor-grain helper remains only behind submission gates
> until ADR 0017 re-keys Method B to the process/credit-batch grain.

Enforcement is intentionally layered:

1. UI gating (disable/hide Method B when ineligible).
2. Server validation in action/data-access layer.
3. DB trigger guardrails for any direct/bypass writes (process-grain trigger
   ships with the ADR 0017 unlock; the reactor-grain `0052` trigger was dropped).

## Certify Integration (Isometric)

Outbound integration that submits MRV data to Isometric's Certify API
and surfaces protocol/template metadata back into noma. Provider-agnostic
schema (`certifier_*` tables) means the same persistence layer can host
other registries later; Isometric-specific HTTP, transformers, and
typings live under `src/lib/isometric/`.

**Layered structure:**

```text
components/certification/   # UI: Certify panel, GHG statements page
       ↓
hooks/use-certification.ts  # React Query hooks
       ↓
fn/certification/           # Server actions (split module):
                            #   facility-mapping, certify-context,
                            #   submit-removal, ghg-statements, overview,
                            #   sources, health, shared, index
       ↓
data-access/certification.ts # Auth-guarded DB ops on certifier_* tables
       ↓
lib/isometric/              # Pure HTTP client + transformers + utils
                            #   (no DB, no auth, no ActionResult)
       ↓
db/schema/certification.ts  # certifier_projects, certifier_sensors,
                            #   certifier_project_emissions,
                            #   certifier_ghg_statements, certifier_removals,
                            #   certification_submissions,
                            #   certifier_document_uploads,
                            #   certifier_sync_events
```

**Idempotency:** every outbound POST runs through
`certification_submissions` as both lock and ledger — `lockedAt` blocks
concurrent in-flight retries, `payloadHash` (canonical-JSON sha256)
identifies replayable submissions, `version` tracks supersedes. The
retry-decision gate is centralized in
`src/lib/isometric/utils/submission-claim.ts` (`decideSubmissionClaim`)
and applied identically by `submitRemoval` (one ledger row per Removal,
keyed `localEntityType:'removal'`, `localEntityId: certifierRemovals.id`
— a facility-scoped row aggregating its member credit batches) and
`submitGhgStatementToVerifier` (one ledger row per GHG Statement, keyed
`localEntityType:'ghgStatement'`). Every HTTP attempt also appends a row
to `certifier_sync_events` (append-only audit log; never used for
state). See ADR 0003 for the Removal submission model.

**Source-data immutability:** once a Removal, telemetry upload, or GHG
Statement has a blocking submission ledger row (`draft`, `submitted`, or
`accepted`), its upstream operational records are locked at the data-access
boundary. The guard re-derives membership from the current credit-batch
lineage before every mutation and blocks edits/deletes to production runs,
samples, applications, deliveries, orders, biochar products, feedstocks, and
credit-batch grouping records that would desync live MRV views from an
immutable certification payload snapshot. Corrections must be represented as
correction workflow records or a new submission version, not as in-place edits
to locked source data.

**UI surfaces:**

- Credit-batch detail and health surfaces show readiness, membership, and
  blocker context. They do not submit directly; submission is consolidated
  into the Certification workspace.
- `/certification` route group (`src/app/(app)/certification/`) — a
  first-class certification **workspace** (ADR 0007), reached from its own
  titled **Certification** group in the sidebar with three concrete routes:
  Removals · GHG Statements · Settings. The root `/certification` route is a
  compatibility redirect to Removals, preserving `?facility=`. Removals and GHG
  Statements are DataTables with read-only side-sheets (`?removal=` /
  `?statement=`). New removals are created through the New-Removal wizard:
  select ready ungrouped batches, review registry requirements, then submit.
  Settings consolidates the facility↔project link and emission/LCA config (the
  old `/admin/emission-estimates` redirects here). Provider-neutral by design —
  Verra / Gold Standard / CSI surfaces may be added as sibling routes later;
  today every surface is Isometric-specific.
- Facility list side sheet — facility ↔ Isometric project mapping
  (`src/components/certification/facility-certifier-section.tsx`).

**Phase status and deferred work** — see
`docs/isometric/integration-plan.md`. Current notable deferrals:
source-upload presigned-URL flow (Phase 3.5), webhook ingestion,
PATCH-vs-supersede for Removals, and external amendment claiming.

## Dashboard

Facility-scoped operations dashboard at `/dashboard`.

- **Route**: `src/app/(app)/dashboard/page.tsx` -> `DashboardView`.
- **Data**: `src/data-access/dashboard-overview.ts` is the one aggregate read
  for the selected facility. It returns the KPI strip, 12-bucket sparkline
  series, range deltas, feedstock mix, custody-flow ribbon, attention queue,
  live "Now" signals, MRV pipeline, evidence health, and map preview points.
- **Operations half**: `src/data-access/dashboard-operations.ts` is
  range-independent and answers "where does this facility stand right now":
  running/completed runs, in-flight registry/verifier submissions, structural
  evidence gaps, and plottable facility/application/feedstock sites.
- **Attention items**: computed from existing MRV records only. They have no
  independent lifecycle, assignee, or completion state; they disappear when the
  underlying record is fixed (see `CONTEXT.md`).
- **Boundary**: dashboard queries still follow the standard
  UI -> hooks -> fn -> data-access -> db flow and are facility-scoped at the
  data-access layer.

## Production Run Readings Import

Production-run telemetry is document-backed and can be entered manually or
imported from reactor-day CSV files.

- **Upload**: `ProductionReadingsDocuments` stores files as
  `documents.entity_type='production_run'` and `document_type='sensor_data'`
  through the normal presigned storage flow.
- **Preview/import**: `src/fn/production-run-reading-imports.ts` reads the
  uploaded object, validates CSV format, extracts reactor/date from the
  filename, checks overlap with the selected run window in the facility
  timezone, and asks the operator to confirm column mapping when needed.
- **Persistence**: confirmed imports replace readings only inside the
  file-day/run-window overlap and write rows to `production_run_readings`.
  Accepted header mappings are stored on the reactor specifications under
  `reactorDayCsvMapping`.
- **Performance note**: readings can become high-cardinality. The current UI
  caps table height, but server-side pagination/virtualization remains tracked
  in `docs/open-questions.md`.

## Chain of Custody Visualization

Credit-batch anchored lineage view at `/chain-of-custody`, with dual
deep-link selectors:

- `?batch=<id>` opens the batch roll-up.
- `?application=<id>` opens an application drill-down.

Batch roll-up merges every member application's rollback, dedupes production
runs, and exposes **DAG | Map | Sankey**. Application drill-down exposes
**Lineage | Map | Split | Trail**. The Sankey is a dry-mass balance with
explicit exits for ineligible feedstock, conversion loss, and in-storage mass;
net CO2e is a label, not a ribbon width.

- **Components**: `src/components/chain-of-custody/` (page, graph, map,
  sankey, trail, constants).
- **Data**:
  `src/data-access/chain-of-custody.ts`,
  `src/data-access/chain-of-custody-batch.ts`, and
  `src/data-access/chain-of-custody-trail.ts`.
- **Layout**: dagre LR graph layout with React Flow canvas controls, minimap,
  hover focus, and record-opening side sheets.
- **Node types**: Feedstock, Reactor, Production Run, Biochar Product, Order,
  Delivery, Application. Accent groups are Production, Infrastructure, and
  Distribution.
- **Facility scope**: selectors and resolved anchors are filtered against the
  active facility so stale or foreign deep links cannot render another
  facility's provenance.

## Facility Context

Global facility selection system that scopes all pages and forms to a single facility.

**Components:**

| File | Purpose |
|------|---------|
| `src/hooks/use-facility-context.ts` | `FacilityContext` + `useFacilityContext()` hook |
| `src/components/navigation/facility-provider.tsx` | `FacilityProvider` — wraps `(app)` layout |
| `src/components/navigation/facility-selector.tsx` | Sidebar dropdown for switching facilities |

**How it works:**
- `FacilityProvider` is mounted in `src/app/(app)/layout.tsx`
- Selected facility persists via URL query param (`?facility=<id>`) + localStorage
- Uses `nuqs` (`useQueryState`) for URL state management
- `NuqsAdapter` is mounted in `src/app/providers.tsx`
- Sidebar nav links append `?facility=<facilityId>` to all hrefs
- Forms receive `facilityId` from context instead of asking the user to select it

**Usage:**
```typescript
import { useFacilityContext } from "@/hooks/use-facility-context";

const { facilityId, selectedFacility, facilities, setFacilityId } = useFacilityContext();
```

## What Is Intentionally Scaffolded

- Admin user invitation UI (`/admin/users`) is a scaffold.

These are intentionally marked so future work can extend them without hidden assumptions.

## Caching Best Practices

**General Rules:**
1. **Default to React Query** for data fetching - it's simpler and more predictable
2. **Keep server components uncached** - let Next.js optimize naturally
3. **Only cache expensive operations** - external API health checks, admin-only data
4. **Never cache auth checks** - security requires fresh validation
5. **Test cache behavior** - ensure invalidation works correctly

**When React Query is enough (most cases):**
- ✅ User-facing CRUD operations
- ✅ Frequently changing data
- ✅ User-specific data that varies per user
- ✅ Data that needs optimistic updates

**When to consider Cache Components:**
- ✅ Expensive external API calls (health checks, public data)
- ✅ Infrequently changing data
- ✅ Admin-only system operations
- ✅ Reduce load on external services

**Key Takeaway**: noma-dmrv prioritizes simplicity and security over aggressive caching. React Query is sufficient for most app data. Only enable Cache Components if you have a specific need and understand the tradeoffs.

## Shared Utilities

Cross-cutting code is extracted to shared modules to avoid duplication:

| Module | Purpose |
|--------|---------|
| `src/data-access/utils.ts` | `requireAuth()` — auth guard used by all data-access files |
| `src/hooks/types.ts` | `MutationCallbacks`, `OptimisticUpdateOptions` — shared React Query mutation types |
| `src/schemas/helpers.ts` | `emptyToNull`, `optionalNumber`, `optionalPercent`, `latitudeSchema`, `longitudeSchema`, `gpsCoordinatesSchema` — reusable Zod schemas |
| `src/components/forms/entity-select/cache-utils.ts` | `seedEntityCache()` — populates React Query cache after quick-add dialogs |
| `src/types/actions.ts` | `ActionResult<T>` — standard server action return type |

When adding new entities, import from these shared modules instead of re-declaring locally.
