# Database

PostgreSQL + Drizzle ORM for the multi-tenant, facility-scoped MRV domain. Covers the org-scoping contract every query must honour, soft-delete semantics, numeric column families, migration mechanics, and the row-level guards. Read it before adding a table, a column, or any `src/data-access/` function. Table-by-table structure lives in [`schema-overview.md`](./schema-overview.md); layering rules in [`architecture.md`](./architecture.md).

## Org Scoping — the contract

The app **is multi-tenant** ([ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md)):
every MRV/domain table carries `organizationId NOT NULL`. Better Auth
infrastructure (`users`, sessions, accounts, verifications, organizations,
members, invitations) follows its own identity/membership relationships, and
`geo_route_cache` is the explicit organization-neutral cache. These exceptions
are not examples for new domain tables. Domain tenancy is enforced in
`src/data-access/`, not by the route layer.

- Every data-access function takes an `OrgContext`, calls `requireOrgScope(ctx)` (`src/data-access/utils.ts`), and filters `eq(table.organizationId, ctx.organizationId)`. Canonical example: `src/data-access/feedstocks.ts`.
- There is **no `requireAuth()` in this layer** — `requireAuth` is a route guard (`src/lib/auth/server.ts`), called once in `src/app/(app)/layout.tsx`. A data-access function relying on it is an unscoped cross-tenant read.
- `organizationId` is **always stamped server-side** from the session's active organization and **never accepted from client input** or a Zod payload. Taking it as an action parameter is privilege escalation.
- The column is **deliberately denormalized** onto child tables even though it is derivable through the parent facility. Never "simplify" a child query into a join through `facilities` to obtain org — that is the missed-join leak class that already bit `getSupplierOptions`.
- Facility-scoped tables use a **composite foreign key** `(facility_id, organization_id) → (facilities.id, facilities.organization_id)` as the DB-level backstop against pointing at another org's facility. New facility-scoped tables must replicate it, not a plain FK to `facilities.id`.
- `userId` columns are attribution, not a boundary. Do not access the DB from UI or hooks — go through `fn/` then `data-access/`.
- Related helpers in `utils.ts`: `assertSameOrg`, `requireOrgFacility`.

## Row-Level Guards

Frozen/locked rows are protected by dedicated modules in `src/data-access/`, not by DB constraints alone: `bin-stock-guards.ts`, `lock-bin-stocks.ts`, the `*-stock-locks.ts` family (`biochar-product`, `delivery`, `formulation`, `order`, `production-run`), `facility-durability-lock.ts`, `certification-lineage-guards.ts`, `unique-name-guards.ts`. A fresh `db.update()` that skips these silently bypasses the freeze — route mutations through the guarded helpers.

## Numeric Column Families

`src/db/schema/numeric-families.ts` (migration `0066`) exports `massKg`, `tonnes`, `ppm`, `fraction`, `percent` — all exact `numeric(p,s)`.

- **Credit-bearing values** — masses, CO2e, contaminant ppm, ratios, percents — MUST use these helpers. Never `real()`; float rounding drifts verifier-facing figures.
- Telemetry, in-process QC, and lab characterization columns stay `real`.
- Over-precision now fails loudly with a Postgres `numeric field overflow` rather than rounding silently.

## Schema Shape

Source of truth: `src/db/schema/*.ts`, exported through `src/db/schema/index.ts`. Area-by-area breakdown: [`schema-overview.md`](./schema-overview.md). Shared domain enums live in `common.ts`.

Schema defaults and create/update defaults must stay aligned, especially for JSONB columns.

## Local Setup & Commands

| Command | Use | Safety |
|---|---|---|
| `pnpm db:generate` | Generate SQL migrations from Drizzle schema changes. | Safe |
| `pnpm db:migrate` | Apply generated migrations. | Safe after review |
| `pnpm db:studio` | Open Drizzle Studio. | Safe |
| `pnpm db:verify-schema` | Diff the live database against the Drizzle schema. | Safe |
| `pnpm db:push` | Push schema directly. Schema experimentation only — never after a migration has been generated. | Local only |
| `pnpm db:reset` | `reset-db.ts` → `db:migrate` → `db:ensure-admin`. Applies the **full migration chain** (not `push`), so it is the local rehearsal of the CI/production path — a broken migration surfaces here. | Destructive |

- **Fresh clone: run `pnpm dev:docker:init`.** Plain `pnpm dev` starts Docker,
  waits for Postgres, confirms `DATABASE_URL` is local (`pnpm db:assert-local`),
  applies pending migrations, verifies the live schema, and only then starts
  Next.js. It does not seed data or create the initial admin. `dev:docker:init`
  resets the database first so the full migration chain and admin bootstrap run
  before schema verification.
- `pnpm dev:manual` starts Next.js alone; `pnpm docker:up` / `docker:down` / `docker:clean` manage the container; `pnpm db:seed` loads canonical seed data.
- Connection via `DATABASE_URL`. The app pool (`src/db/index.ts`) also reads `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`. CLI scripts build short-lived pools through `src/lib/cli/*` and do not share the app pool.

## Soft Delete — Facility and Storage-Bin Archive

Facilities are never hard-deleted. `archiveFacility`
(`src/data-access/facilities.ts`) stamps `archived_at` on the facility and every
stamped operational descendant in one transaction; `restoreFacility` clears
the stamps. `NULL` = active.

- **The cascade is org-scoped as well as facility-scoped** — every `UPDATE` filters `eq(table.organizationId, ctx.organizationId)` alongside `facilityId`. A new stamped table must carry both predicates.
- **Storage bins may also be archived individually.** This is the safe retirement path for a bin whose operational history prevents hard deletion. Facility archive stamps only rows where `archived_at IS NULL`; facility restore clears only child stamps equal to that facility's archive timestamp, so an individually archived bin stays archived.
- **Every list / picker / options / stats query filters `isNull(table.archivedAt)`.** Detail-by-id reads do **not** — existing references to archived rows must still hydrate. Seed a new read query's conditions array with the `isNull` filter.
- **Grandchildren have no own column** (samples, readings, applications, transport legs, …) — they hide transitively through their archived parent (applications filter via `deliveries.archived_at` in joins).
- **Certifier mirror tables are unstamped for `archived_at`** (`certifier_projects`, `certifier_ghg_statements`, `certifier_removals`) — they mirror registry state and hide transitively. They are **not** unscoped: each carries `organizationId NOT NULL` plus the composite FK to `facilities`, and still requires the org filter. Archiving a facility with registry submissions is allowed with a warning (`getFacilityArchiveImpact.hasRegistrySubmissions`), never blocked.
- **Writes reject archived parents**: child creates/moves check the facility with `isNull(facilities.archivedAt)` and fail with "Facility not found or archived".
- **Codes stay reserved** while archived (uniqueness checks ignore archive state) so restore can't collide.

Stamped tables: `facilities`, `reactors`, `storage_locations`, `feedstock_deliveries`, `feedstocks`, `production_runs`, `biochar_products`, `orders`, `deliveries`, `credit_batches`, `stockpile_events`, `power_procurement_evidence` (migration `drizzle/0041_outgoing_paper_doll.sql`).

## Migrations

Generated SQL lives in `drizzle/`; metadata snapshots in `drizzle/meta/`. **Migration history lives in `drizzle/`; the *why* for schema-shaping changes lives in [`docs/adr/`](./adr/).**

Flow: change schema → `pnpm db:generate` → review the emitted SQL → run targeted tests → `pnpm db:migrate` in shared environments.

### Migration files are immutable once applied

**Never edit a migration file after it has been applied to any database** (staging, production, or a teammate's). `drizzle-kit migrate` tracks applied migrations by journal order/timestamp, not file content, so an edited migration is silently skipped on databases that ran the original — CI reports success while the new DDL never executes, and the drift only surfaces in `db:verify-schema`. Need more changes? Generate a new migration. To repair drift that already happened, write a new migration with guarded DDL (`IF NOT EXISTS` / existence checks) so it no-ops where the objects exist.

### Constraint-repair pattern

Migrations adding `ADD CONSTRAINT`, `CREATE UNIQUE INDEX`, or `SET NOT NULL` to an existing table must repair conflicting rows **in the same migration** before enforcing the rule. Reference: `drizzle/0079_volatile_plazm.sql` — add the column nullable, `UPDATE` existing rows, then `SET NOT NULL`. Likewise backfill or deduplicate before adding constraints or unique indexes.

When a migration is destructive, document the rationale in the related feature doc or [`open-questions.md`](./open-questions.md) if the dropped surface may return.

### CI (`.github/workflows/migrate.yml`)

- Schema-affecting pushes to `staging` or `main` run `pnpm db:migrate` against the matching database, then `pnpm db:verify-schema`, which fails the run on drift.
- Destructive operations (reset + seed staging, reset staging empty, reset production) are never automatic — manual `workflow_dispatch` with a typed confirmation phrase only.
- Credentials come from 1Password via `load-secrets-action` (see [`security.md`](./security.md)).

### PR migration gate (`.github/workflows/migration-gate.yml`)

Builds the PR base-branch schema in a throwaway database, seeds it from `src/db/seed-data.ts`, applies the merge candidate's new migrations, and verifies the result. It catches data-versus-constraint conflicts reproducible from the canonical seed; it cannot prove compatibility with every row in staging or production.

A `staging` → `main` PR labelled `first-production-deployment` adds a second job, `fresh-database-gate`: full chain against an empty database, production bootstrap run twice to prove idempotence, then schema verify. It is **additive to the seeded gate, never a substitute**; both are required.

## Certification Tables

`src/db/schema/certification.ts` is provider-neutral; Isometric-specific code
lives under `src/lib/isometric/`. Tables: `certifier_credentials` (registry
credentials — handle as secrets, data-access in
`src/data-access/certifier-credentials.ts`),
`certifier_organization_settings` (organization/provider policy, including
Source visibility), `certifier_projects`, `certifier_sensors`,
`certifier_ghg_statements`, `certifier_ghg_statement_reports`,
`certifier_removals`, `certification_submissions`,
`certifier_document_uploads`, `certifier_sync_events`. Purpose per table:
[`schema-overview.md`](./schema-overview.md); submission-unit rationale:
[ADR 0003](./adr/0003-removal-as-submission-unit.md), [ADR
0008](./adr/0008-submission-ledger-internal-seam.md).

`certifier_ghg_statement_reports` is the immutable-version record for the PDF
sent with a GHG Statement verifier submission. Every preparation gets a
positive version, frozen live input/model, source fingerprint, content
checksum, private `documents` row, and a per-report verifier-token digest.
Lifecycle is monotonic `prepared → approved → submitted`; database checks keep
approval/submission actor timestamps coherent, while unique constraints prevent
duplicate statement versions, preparation idempotency keys, or document reuse.
Regeneration inserts a new row/object rather than updating a prior version's
content.

Normal report listing, review, approval, and submission reads are org-scoped.
The public verifier download lookup is the one deliberate exception:
`getVerifierReportDocument(reportId)` crosses organizations under the exact
`// org-scope-ok:` waiver, then authorizes with the bearer token digest and
private-document state. It must not be copied into ordinary data access.

`certification_submissions` is the **freeze point** for certification source data. A blocking ledger status (`draft`, `submitted`, `accepted`) on a Removal, telemetry upload, or GHG Statement prevents in-place mutation of upstream production runs, lab samples, deliveries, biochar products, and feedstocks reached through current credit-batch lineage. The guard lives in data-access (`certification-lineage-guards.ts`) so stale UI membership cannot bypass it.

## Method-B storage boundary

`production_processes` stores only an epoch plus the all-or-none Method-B
prerequisites. `credit_batches.sampling` stores the immutable per-batch
`sampled`/`unsampled` choice. Eligibility is computed in the data-access layer
from eligible samples since the current epoch; it is not persisted or enforced
by a database trigger. See [ADR 0022](./adr/0022-method-b-is-computed-eligibility-not-stored-unlock.md).

## Before Merging Schema Work

1. Run `pnpm db:generate` and review the emitted SQL before committing.
2. For certification changes, update `docs/isometric/changes.md`.
