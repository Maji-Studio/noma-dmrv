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
- Connection via `DATABASE_URL`. `src/db/index.ts` builds the app pool from `getPgPoolConfig` (`src/lib/pg-pool-config.ts`, connection string and SSL) and `resolveAppPoolConfig` (`src/db/pool-config.ts`, which owns every `DEFAULT_DB_POOL_*` constant and `MAX_VERCEL_DB_POOL_MAX`). Five environment variables feed it: `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`, `DB_POOL_LOCK_TIMEOUT_MS`, and `DB_POOL_TELEMETRY`. CLI scripts build short-lived pools through `src/lib/cli/*` and do not share the app pool.
- The module-scope pool is registered with Vercel's [`attachDatabasePool`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#database-connection-pool-management), which keeps a Fluid Compute instance alive until `pg` releases its idle clients. The idle default is 5 seconds. `DB_POOL_MAX` defaults to 1 until the database connection budget is known, and a Vercel deployment fails closed above `MAX_VERCEL_DB_POOL_MAX` because per-instance pools multiply.
- Pooled statements wait at most 1 second for a conflicting database lock by default, configurable with the positive `DB_POOL_LOCK_TIMEOUT_MS`. Keep it below the pool connection-acquisition timeout. PostgreSQL reports `55P03` on a lock timeout; the waiting transaction rolls back and can be retried after the conflicting operation finishes. This prevents a waiting writer from occupying the only pooled connection during registry cleanup. Dedicated certification lock connections do not inherit this setting: an active registry DELETE retains its fence until the protected callback finishes. This is a lock-acquisition timeout, not a statement or remote-request deadline.

### Mafinga demo seed

`pnpm db:seed` creates the September 2026 Mafinga demo through the same server
actions and Zod schemas as the forms, so every seeded row is one the UI would
have accepted. Run `pnpm db:ensure-admin` first if the bootstrap admin or
organization is missing. The entry is `src/db/seed-data.ts`; the steps live in
`src/db/seed/`. An existing Mafinga facility makes a repeat run exit without
adding rows. A failed step aborts with its action error and leaves earlier steps
in place, so a partial run also counts as "existing"; reset the development
database before retrying.

The demo covers infrastructure, suppliers, a customer, feedstock deliveries,
completed production runs with imported CSV readings, a sampled credit batch
with lab samples, BCF products, an order, and a delivery. It creates no
application and no registry submission.

Registry setup is driven by environment variables:

- `ISOMETRIC_CLIENT_SECRET` + `ISOMETRIC_ACCESS_TOKEN`: stored encrypted with
  `CREDENTIALS_ENCRYPTION_KEY` as the organization's credentials, then the
  forestry feedstock type is imported from the registry catalogue. Absent, the
  seed skips registry setup and creates the feedstock type locally.
- `ISOMETRIC_DEMO_PROJECT_ID` (optional): pins the project when the credentials
  can see more than one. With exactly one visible project the seed uses it.
- `ISOMETRIC_DEMO_FACILITY_ID` (optional): the `fcl_` ID from Certify that the
  mapping form requires. Absent, credentials are stored but the facility mapping
  is skipped; finish it in Certification Settings.

The seed only reads from the registry (projects, catalogue, templates). It never
creates registry business records.

The CLI uses `runWithOrgContext` (`src/lib/auth/server.ts`) to call real actions
without a request session. The seam is forbidden in request code and rejects
production use unless `ALLOW_DEV_BOOTSTRAP=1`. The manually confirmed staging
reset-and-seed job sets that flag, loads the registry trio and the storage
settings from the staging 1Password item, and passes the two optional IDs from
GitHub repository variables. The PR migration gate seeds without credentials.

### Pool sizing and compute placement

`DB_POOL_MAX` is a per-environment deployment decision, never a default to
raise on intuition. Before raising it, obtain `SHOW max_connections`,
reserved/admin headroom, current peak connections, the provider/pooler mode,
and the maximum number of active Vercel instances. Budget for both the shared
pools and the dedicated certification lock connections:

```text
(active function instances × DB_POOL_MAX)
  + simultaneous dedicated lock operations
  + migrations, administration, and other consumers
  < usable database connections
```

Pool size and compute region are separate changes; never move both in one
deployment. Confirm the database's actual region before changing the [Vercel
Function region](https://vercel.com/docs/functions/configuring-functions/region).

The application needs session semantics for
`withDedicatedSessionAdvisoryLock`. A direct connection or a session-pooling
proxy is compatible; a transaction-pooling proxy must not be assumed compatible
with session advisory locks.

`DB_POOL_TELEMETRY=true` is a measurement tool, not a monitoring setting: enable
it for a bounded window and turn it off afterwards. Its records are
privacy-safe — duration, success, pool totals, idle count, and queue count, and
never SQL, parameters, hostnames, database names, or user data. With the flag
off, connection failures, checkout failures, and idle-client errors are still
logged at warn; query timings and query failures are not.

### Rollout — pool-size measurement

Dated rollout content, not an evergreen rule. Delete this section once the
connection budget is measured and `DB_POOL_MAX` is settled per environment.

The 2026-09 plan raises `DB_POOL_MAX` on staging one step at a time: 1, then 3,
then 5. Never an unbounded increase, and never together with a region move. At each
step, compare checkout wait and query duration distributions under the same
workload, and watch database-side active/idle connection peaks and SQLSTATE
`53300`. Move from 3 to 5 only when the measured connection budget supports it
and acquisition still queues at 3. Decide from the checkout-queue metric, not
from page latency.

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

### Development reset policy

No production database exists yet. Keep the full migration chain usable for development and tests; required columns and destructive schema changes may require resetting a development database. Do not add production-data backfills or transitional compatibility solely to preserve obsolete demo rows. Notify the user before a change requires resetting shared staging, and use the existing manual reset workflow for that environment.

Document destructive changes and their reset requirement in the related feature documentation. Existing migration history remains immutable once applied in a shared environment.

### CI (`.github/workflows/migrate.yml`)

- Schema-affecting pushes to `staging` or `main` run `pnpm db:migrate` against the matching database, then `pnpm db:verify-schema`, which fails the run on drift.
- Destructive operations (reset + seed staging, reset staging empty, reset production) are never automatic — manual `workflow_dispatch` with a typed confirmation phrase only.
- Credentials come from 1Password via `load-secrets-action` (see [`security.md`](./security.md)).

### PR migration gate (`.github/workflows/migration-gate.yml`)

The development gate applies the merge candidate's complete migration chain to an empty, disposable database, bootstraps its admin and organization, seeds current development data, and verifies the schema. It tests the supported reset-and-seed development path without requiring upgrades of obsolete demo rows.

The independent `fresh-database-gate` also runs on every matching PR or manual run. It applies the full chain to another empty database, runs production-mode bootstrap twice to prove idempotence, and verifies the schema. Neither job substitutes schema push for migrations; promotion labels do not bypass either job.

## Certification Tables

`src/db/schema/certification.ts` is provider-neutral; Isometric-specific code
lives under `src/lib/isometric/`. Tables: `certifier_credentials` (registry
credentials — handle as secrets, data-access in
`src/data-access/certifier-credentials.ts`),
`certifier_organization_settings` (organization/provider policy, including
Source visibility), `certifier_projects`, `certifier_sensors`,
`certifier_ghg_statements`, `certifier_ghg_statement_reports`,
`certifier_removals`, `certification_submissions`,
`certifier_document_uploads`, `certifier_sync_events`,
`certifier_production_batches`, `certifier_storage_locations`, and
`certifier_biochar_applications`. The last three live in separate schema
modules named after their tables. They are Isometric-specific registry journals
and use provider payload types; `certification.ts` remains the provider-neutral
submission and configuration boundary. Purpose per table:
[`schema-overview.md`](./schema-overview.md); submission-unit rationale:
[ADR 0003](./adr/0003-removal-as-submission-unit.md), [ADR
0008](./adr/0008-submission-ledger-internal-seam.md).

`certifier_biochar_applications` is an organization-scoped idempotency journal,
not a second source of application facts. Every row links its Application and
credit-batch slice to an immutable Removal submission through same-organization
composite foreign keys; exact payload/hash and registry identities remain on
the journal. The versioned row grain, supersession ownership, and exact retry
semantics are documented in [`schema-overview.md`](./schema-overview.md).

`certifier_ghg_statement_reports` is the immutable-version record for the PDF
sent with a GHG Statement verifier submission. Every preparation gets a
positive version, frozen live input/model, source fingerprint, content
checksum, private `documents` row, and a per-report verifier-token digest.
Verifier resubmission keeps that active digest while a separately committed
pending digest is valid during the provider call; success promotes pending to
active, while confirmed non-applied failure clears pending only.
An ambiguous provider outcome never clears the pending digest from one read.
Recovery promotes a matching URL observed on either fresh read, or restages
only after the pending digest has aged and two delayed, fingerprint-stable
`DRAFT` reads show no matching capability or submission markers. This keeps a
stale registry read from invalidating a URL that the verifier may already hold.
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

`certification_submissions` is the **freeze point** for certification source data. A blocking ledger status (`draft`, `submitted`, `accepted`) on a Removal, telemetry upload, or GHG Statement prevents in-place mutation of production runs, lab samples, deliveries, biochar products, and feedstocks captured by that Removal's immutable application-by-credit-batch slices. New downstream physical records may descend from a certified production run without making the captured upstream records editable. The guard lives in data-access (`certification-lineage-guards.ts`) so stale UI membership cannot bypass it.

## Method-B storage boundary

`production_processes` stores only an epoch plus the all-or-none Method-B
prerequisites. `credit_batches.sampling` stores the immutable per-batch
`sampled`/`unsampled` choice. Eligibility is computed in the data-access layer
from eligible samples since the current epoch; it is not persisted or enforced
by a database trigger. See [ADR 0022](./adr/0022-method-b-is-computed-eligibility-not-stored-unlock.md).

## Before Merging Schema Work

1. Run `pnpm db:generate` and review the emitted SQL before committing.
2. For certification changes, update `docs/isometric/changes.md`.
