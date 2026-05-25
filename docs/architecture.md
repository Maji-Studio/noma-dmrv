# Architecture

## Design Goals

- Keep the template simple enough to extend quickly.
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
- `src/app/(app)/projects`: authenticated project list/CRUD.
- `src/app/(app)/[projectId]/*`: project-scoped pages.
- `src/app/(app)/admin/*`: admin-only pages.

Project-scoped routes use `src/app/(app)/[projectId]/layout.tsx` to enforce project membership once at layout level.

## Auth Architecture

- `proxy.ts` runs request protection and includes API routes (Next.js 16 middleware replacement using Node.js runtime).
- `/api/auth/*` is explicitly allowed through.
- Better Auth config controls signup policy with `ALLOW_SELF_SIGNUP`.
- Data-access checks remain the source of truth for authorization.

### Proxy Middleware (Next.js 16)

This template uses **Next.js 16's `proxy.ts`** instead of traditional `middleware.ts`:

**Why proxy.ts?**
- Runs in **Node.js runtime** (not Edge runtime)
- Allows Better Auth to use Node.js `crypto` module
- Same authentication logic as middleware
- Better compatibility with server-side libraries

**Location**: `/proxy.ts` (project root)

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
- Feature hooks (`use-items`, `use-projects`) call server actions and invalidate cache keys.

### Caching Strategy

**This template uses client-side caching via React Query, NOT Next.js 16 Cache Components.**

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
  - Query keys: `["resource", projectId, ...specifics]`
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

All API routes in this template are **dynamic** by default (not prerendered at build time).

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

Sampling method is selected at `reactors` and enforced with reactor-scoped eligibility checks.

- Process key used today: `reactor_id` (not `production_run_id`)
- Method A/B selection stored on reactor: `reactors.sampling_method` (default `method_a`)

Method B requires:

1. At least 30 prior samples for that reactor before switching reactor method to `method_b`.
2. Credit-batch reporting periods linked to Method B reactors must satisfy sampled-run cadence >= 1 per 10 runs.

Enforcement is intentionally layered:

1. UI gating (disable/hide Method B when reactor is ineligible).
2. Server validation in action/data-access layer.
3. DB trigger guardrails for any direct/bypass writes.

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
                            #   submit-credit-batch, ghg-statements,
                            #   shared, index
       ↓
data-access/certification.ts # Auth-guarded DB ops on certifier_* tables
       ↓
lib/isometric/              # Pure HTTP client + transformers + utils
                            #   (no DB, no auth, no ActionResult)
       ↓
db/schema/certification.ts  # certifier_projects, certifier_ghg_statements,
                            #   certifier_removals, certifier_sources,
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

**UI surfaces:**

- Credit-batch side sheet — Certify panel mounted via the
  `viewModeChildren` slot on `EntitySideSheet`
  (`src/components/credit-batches/credit-batch-list.tsx`). Surfaces the
  removal-scoped (facility-level) submission state: the credit batch's
  removal membership, the `submitRemoval` action, and submission history
  tied to the removal. The GHG Statement lifecycle (create, submit,
  status) is decoupled and lives on the Certification route group below
  — not here.
- `/certification` route group (`src/app/(app)/certification/`) — the
  standalone certification surface added in Phase 4.5. Tile hub
  (`page.tsx`) linking to `removals/` (per-facility Removals hub) and
  `ghg-statements/` (period-anchored GHG Statements hub: create draft,
  preview predicted removals, submit/resubmit to verifier, refresh
  remote status). Provider-neutral by design — Verra / Gold Standard /
  CSI surfaces may be added later; today every tile is
  Isometric-specific.
- Facility list side sheet — facility ↔ Isometric project mapping
  (`src/components/certification/facility-certifier-section.tsx`).

**Phase status and deferred work** — see
`docs/isometric/integration-plan.md`. Current notable deferrals:
source-upload presigned-URL flow (Phase 3.5), webhook ingestion,
PATCH-vs-supersede for Removals, and external amendment claiming.

## Chain of Custody Visualization

Application-first lineage graph that traces the upstream rollback path from a selected application back to its originating feedstock batches.

- **Route**: `/chain-of-custody?application=<id>`
- **Components**: `src/components/chain-of-custody/` (constants, node, page, hook)
- **Data**: `src/data-access/chain-of-custody.ts` resolves the upstream lineage for one application
- **Layout**: dagre auto-layout (LR direction), 7 node types
- **Node types**: Feedstock (orange), Reactor (purple), Production Run (orange), Biochar Product (orange), Order (rose), Delivery (rose), Application (rose)
- **Selection**: Users search for an application via the shared `EntitySelect`; facility is resolved from the selected application
- **Lineage**: Supports multiple feedstocks branching into the same production run; shows a warning card when upstream links are missing

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
- Project settings page is a scaffold.

These are intentionally marked so template consumers can extend without hidden assumptions.

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

**Key Takeaway**: This template prioritizes **simplicity and security** over aggressive caching. React Query is sufficient for 95% of use cases. Only enable Cache Components if you have a specific need and understand the tradeoffs.

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
