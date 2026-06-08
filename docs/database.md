# Database

PostgreSQL database with Drizzle ORM for the facility-scoped MRV domain.

## Safety Rules

Use `pnpm` only.

| Command | Use | Safety |
|---|---|---|
| `pnpm db:generate` | Generate SQL migrations from Drizzle schema changes. | Safe |
| `pnpm db:migrate` | Apply generated migrations. | Safe after review |
| `pnpm db:studio` | Open Drizzle Studio. | Safe |
| `pnpm db:verify-schema` | Verify generated schema metadata. | Safe |
| `pnpm db:push` | Push schema directly. | Local development only |
| `pnpm db:reset` | Drop tables, push schema, ensure admin user. | Destructive |

Migration flow: change schema, run `pnpm db:generate`, review SQL, run targeted tests, then apply with `pnpm db:migrate` in shared environments.

## Local Setup

`pnpm dev` starts the local database through Docker when needed, waits for it, prepares the schema, and starts the Next.js dev server on port 3100.

Manual controls:

```bash
pnpm docker:up
pnpm dev:manual
pnpm db:reset
pnpm db:seed
pnpm db:studio
```

Database connection is configured with `DATABASE_URL`. The main app pool in `src/db/index.ts` also reads:

- `DB_POOL_MAX`
- `DB_POOL_IDLE_TIMEOUT_MS`
- `DB_POOL_CONNECTION_TIMEOUT_MS`

CLI and maintenance scripts build short-lived pools through `src/lib/cli/*` helpers and do not share the main app pool.

## Current Shape

Source of truth: `src/db/schema/*.ts`, exported through `src/db/schema/index.ts`.

| Area | Files | Notes |
|---|---|---|
| Auth | `auth.ts` | Better Auth tables: users, sessions, accounts, verification values. |
| Facilities | `facilities.ts`, `storage-inventory.ts` | Facilities, reactors, storage locations, and inventory snapshots. |
| Parties | `parties.ts` | Suppliers, customers, locations, drivers, operators. |
| Feedstock | `feedstock.ts` | Feedstock deliveries, feedstock types, feedstock batches. |
| Production | `production.ts` | Runs, readings, samples, incidents, run/feedstock junctions. |
| Products | `products.ts` | Formulations, formulation ingredients, biochar products. |
| Logistics | `logistics.ts` | Vehicles, orders, deliveries, transport legs. |
| Application | `application.ts` | Soil applications and soil temperature measurements. |
| Credits | `credits.ts` | Credit batches and credit-batch/application joins. |
| Documentation | `documentation.ts` | Evidence documents and storage metadata. |
| Certification | `certification.ts` | Certifier linkage, removals, GHG statements, submissions, document uploads, sync events, sensors, project-emission journal rows. |
| Compliance | `compliance.ts` | Stockpile events and power-procurement evidence. |
| Shared enums | `common.ts` | Domain enums used by the schema files above. |

After the 2026-06-08 schema slim-down the app has 45 table exports across 14 schema files. Removed protocol-stub tables and the legacy starter `projects` / `items` cluster are documented in `docs/open-questions.md`.

## Access Model

The app is currently single-org and facility-scoped:

- Authenticated users share the same operational MRV records.
- `userId` columns are attribution fields, not tenant boundaries.
- Data-access functions still call auth guards, usually `requireAuth()`.
- Facility scoping is a product/workflow boundary, carried through selected facility context and explicit `facilityId` filters.
- Do not add direct DB access in UI or hooks; go through `fn/` and `data-access/`.

If multi-tenant facility ownership is introduced, every list/query/ensure helper in `src/data-access/` must be revisited with tenant or membership filters.

## Layering

```text
components/      UI and forms
  -> hooks/      React Query cache and mutations
  -> fn/         server actions, Zod validation, orchestration
  -> data-access/ auth-guarded queries and mutations
  -> db/         Drizzle connection and schema
```

Rules:

- Server actions return `ActionResult<T>`.
- Server actions validate inputs with schemas from `src/schemas/`.
- Data-access functions enforce authentication and authorization.
- Query helpers live in `src/data-access/`; do not compose application queries in components.
- Schema defaults and create/update defaults must stay aligned, especially for JSONB columns.

## Common Query Pattern

```ts
// src/data-access/feedstocks.ts
export async function listFeedstocksForFacility(
  userId: string,
  facilityId: string
) {
  await requireAuth();

  return db.query.feedstocks.findMany({
    where: eq(feedstocks.facilityId, facilityId),
    orderBy: desc(feedstocks.createdAt),
  });
}
```

Prefer explicit facility filters for operational records. For global option lists, document why the query is intentionally unscoped.

## Migrations

Generated SQL lives in `drizzle/`; metadata snapshots live in `drizzle/meta/`.

Recent notable migrations:

| Migration | Notes |
|---|---|
| `0033_brief_frank_castle` | Certification workflow refinements around facility registry configuration and CO2e storage. |
| `0034_peaceful_firebird` | Certifier-readiness support and transport-leg constraints. |
| `0035_deterministic_product_bin_formulation` | Data ownership and credit-batch handling updates. |
| `0036_cultured_rattler` | UX-review schema constraints and indexes. |
| `0037_sour_lethal_legion` | Schema slim-down: dropped unused protocol-stub tables plus legacy starter project/item tables. |

When a migration is destructive, document the rationale in the related feature doc or `docs/open-questions.md` if the dropped surface may return later.

## Certification Tables

`src/db/schema/certification.ts` is provider-neutral. Isometric-specific code lives under `src/lib/isometric/`.

| Table | Purpose |
|---|---|
| `certifier_projects` | Maps a local facility to an external certifier project/template and holds facility-level emission-estimate config. |
| `certifier_sensors` | Maps reactor measurement properties to external sensor IDs for telemetry uploads. |
| `certifier_project_emissions` | Facility reporting-period LCA journal rows used to reconcile Isometric Project Components. |
| `certifier_ghg_statements` | Period-anchored GHG Statement artifacts. |
| `certifier_removals` | Local Removal submission units; one Removal can group multiple credit batches. |
| `certification_submissions` | Versioned lock and idempotency ledger for outbound submissions. |
| `certifier_document_uploads` | Local document to provider-uploaded evidence mapping. |
| `certifier_sync_events` | Append-only outbound/inbound integration event log. |

`certifier_sources` was removed in `0037`; submission source references are derived at submit time unless a future source-management feature reintroduces local source rows.

## Sampling Method Enforcement

Sampling method is stored on `reactors.sampling_method`.

Method B guardrails:

1. A reactor needs at least 30 prior samples before switching to `method_b`.
2. Credit batches linked to Method B reactors need sampled-run cadence of at least 1 sampled run per 10 runs.

Enforcement is layered through UI checks, server/data-access validation, and DB trigger guardrails.

## Verification Checklist

Before merging schema-affecting work:

1. Run `pnpm db:generate` and review the SQL.
2. Run targeted unit tests for touched calculations or schemas.
3. Run `pnpm typecheck`.
4. Run `pnpm lint`.
5. For certification changes, run the relevant Isometric unit tests and update `docs/isometric/changes.md`.
