# Database

PostgreSQL + Drizzle ORM for the multi-tenant, facility-scoped MRV domain. Covers the org-scoping contract every query must honour, soft-delete semantics, numeric column families, migration mechanics, and the row-level guards. Read it before adding a table, a column, or any `src/data-access/` function. Table-by-table structure lives in [`schema-overview.md`](./schema-overview.md); layering rules in [`architecture.md`](./architecture.md).

## Org Scoping — the contract

The app **is multi-tenant** ([ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md)):
every MRV/domain table carries `organizationId NOT NULL`. Better Auth
infrastructure (`users`, sessions, accounts, verifications, organizations,
members, invitations) follows its own identity/membership relationships.
`api_keys.reference_id` is the plugin's organization id; its management table
`api_key_owners` carries `organization_id` and an independent integer `version`.
`geo_route_cache` is the explicit organization-neutral cache. These exceptions
are not examples for new domain tables. Domain tenancy is enforced in
`src/data-access/`, not by the route layer.

- Every data-access function takes an `OrgContext`, calls `requireOrgScope(ctx)` (`src/data-access/utils.ts`), and filters `eq(table.organizationId, ctx.organizationId)`. Canonical example: `src/data-access/feedstocks.ts`.
- There is **no `requireAuth()` in this layer** — `requireAuth` is a route guard (`src/lib/auth/server.ts`), called once in `src/app/(app)/layout.tsx`. A data-access function relying on it is an unscoped cross-tenant read.
- `organizationId` is **always stamped server-side** from the session's active organization and **never accepted from client input** or a Zod payload. Taking it as an action parameter is privilege escalation.
- The column is **deliberately denormalized** onto child tables even though it is derivable through the parent facility. Never "simplify" a child query into a join through `facilities` to obtain org — that is the missed-join leak class that already bit `getSupplierOptions`.
- Facility-scoped tables use a **composite foreign key** `(facility_id, organization_id) → (facilities.id, facilities.organization_id)` as the DB-level backstop against pointing at another org's facility. New facility-scoped tables must replicate it, not a plain FK to `facilities.id`. `activity_events.facility_id` is a deliberate exception documented in [ADR 0033](./adr/0033-activity-events-facility-without-fk.md).
- `userId` columns are attribution, not a boundary. Do not access the DB from UI or hooks — go through `fn/` then `data-access/`.
- Related helpers in `utils.ts`: `assertSameOrg`, `requireOrgFacility`.

## API infrastructure tables

`src/db/schema/api.ts` also defines:

- `api_rate_limit_buckets`: system seam keyed by IP hash, credential or
  organization and access type. It intentionally has no `organization_id`;
  request guards debit it outside business transactions.
- `organization_api_access`: one Platform Admin policy row per organization,
  with enabled state and change attribution. A missing row means enabled.
  Credential resolution and cross-organization administration are explicit
  privileged seams, marked `// org-scope-ok:` in data-access. Owners/Admins
  without Platform Admin access cannot administer this policy.

The purge helpers are system seams that delete expired idempotency records and
idle buckets across organizations. These waivers do not relax ordinary
org-scoped reads.

## Activity events

`activity_events` is append-only by convention: its data-access module exports
no update or delete. There is no append-only trigger because it would prevent
E2E teardown. Writes use the caller's transaction and reads enforce org scope.
The organization FK cascades like sibling tables because no organization-delete
path exists and test fixtures delete organizations. The nullable `facility_id`
has no FK under the exception documented in [ADR 0033](./adr/0033-activity-events-facility-without-fk.md). Entity, credit-batch, production-run and
actor references have no FKs, so history survives record
deletion as tombstones. `changed_fields` lists real changes, sorted by name.
`changes` stores old and new JSON scalars for allowlisted numbers, dates,
choices, short labels, places and linked record IDs. Notes, reasons, document
file details, boundaries and lists record names only. Bookkeeping is ignored.
The exhaustive policy and semantic comparison live in `src/lib/activity-changes.ts`
and `src/lib/activity-field-policy.ts`. Unknown fields default to name only.
Values are internal, retained forever, with no backfill. A GPS coordinate change
also captures its unchanged partner in `changes`, without adding it to
`changed_fields`. Reads send `changes` and `changeLabels` only for updated events.
Link labels resolve from current org-scoped records as `{ label, deleted, type }`.
A deleted target has `label: null` and `deleted: true`; `type` is its activity
entity type, or null when the target type cannot be resolved. A null link stays null.
Read records include `facilityTimezone`, the current facility's IANA time zone or
null when unavailable, for displaying captured instants on the facility clock.
API writes are audited
only here: an API audit row has `source in ('rest','mcp') and operation_id is not null`
and carries operation, credential and request IDs, versions, field names and allowlisted values.
Nested document, membership, transport-leg and document-retirement rows from
the same API call carry only actor and source attribution, without operation,
credential or request IDs. Nullable `operation_id`, `version_before` and
`version_after` also record described form and script runner writes.
`oauth_client_id` is reserved and null until OAuth grants ship.

`ACTIVITY_ENTITY_TYPES` in `src/db/schema/common.ts` allows only canonical
snake_case names: `removal`, `ghg_statement`, `production_run`, `biochar_product`,
`lab_sample`, `order`, `delivery`, `application`, `credit_batch`, `document`,
`transport_leg`, `feedstock`, and `bin_movement`. The pure
`toActivityEntityType` mapper in `src/lib/activity-entity-type.ts` preserves these
names and maps existing runner/certification spellings (`productionRun`,
`biocharProduct`, `labSample`, `binMovement`, `ghgStatement`) to them; unknown
values throw. Document owner normalization lives in the same module, preserves
valid document-only owner types (including `ghg_statement_report`), and rejects
unknown owners.
`occurred_at` and `registry_at` use millisecond precision to match JavaScript
`Date`; `occurred_at` defaults to insert time (`clock_timestamp()`), and reads
order by `occurred_at` then unique `sequence`, newest first.

The operation runner appends activity in its write transaction using metadata
from `describe()` and before/after snapshots captured under each writer's own
locks. Effect metadata, including the effect stored in idempotency outcomes,
contains field names only; captured values live only in `activity_events.changes`.
An unchanged form save still records an event with no changed fields. Vehicle
snapshot refreshes and production-claim reservations skip empty updates.
This covers feedstock intake, production runs, products, stock movements, lab
samples, orders, deliveries, applications, app/API document requests and
confirmations, and app document deletes. App document visibility and evidence classification edits
also use the runner. No-op descriptions, repeated confirmations, dry runs and idempotent
replays add no events. The runner computes one source for both its own event and
nested writers: audited transport, then the trusted `script` override, then `form`.
Runner-reached transactional and cascade writers require an explicit source.

Application operations call `activity.scope(entityId, scopes)` in
`src/lib/operations/activity-links.ts`. The runner emits one event per distinct
batch/run scope, including both former and current batches when an application
moves. Delete captures scopes before removing shares and passes them with the
initiating source to document retirement. Credit-batch, membership and
transport-leg writers append activity directly in their write transaction.
Membership changes emit a batch update per changed run and a run update with
the former batch ID on detach, so each event retains its run scope.
Automatic cohort attachment uses `system` with no actor; derived transport writes
retain the initiating actor, including document retirements when a derived leg
is cleared. Identical derived syncs still upsert and bump the leg version without
emitting activity. Vehicle snapshot refreshes record derived leg updates with
source `system`; facility archive/restore records each affected batch update.
Application scopes exclude shares with zero wet and dry mass. Delivery and order
scopes use net saved provenance, excluding fully reversed shares and deliveries
without allocation layers. If saved delivery provenance raises `SafeError`, direct
activity records one unscoped event so invalid lineage cannot block a write or the
failed-upload sweep. Unexpected errors still propagate.

Removal slice assignment/release and production-claim reservation/release record
one batch update per affected batch by diffing the batch row in the write transaction.
`productionEmissionsClaimReservedBySubmissionId` and
`productionEmissionsClaimedByRemovalId` capture link values; `removalAssignment`
records its name only. Resumes and no-op system refreshes record nothing.
Removal deletion combines these changes into one event per batch; local draft
discard records the released slice assignments.

Legacy certification reports and evidence ledgers use `insertDocument` and
`deleteDocumentRow`, which record directly. Parent deletion uses
`retireDocumentsForEntities` to record each retired document with captured owner
links and the initiating source. These child events accompany the runner's parent
event. Runner document operations use separate transactional writers and record
only through `describe()`, so each document action has one recording path.
Failed-upload retention deletes also use `deleteDocumentRow`, with source `system`
and no actor. Lease renewal, promotion cleanup metadata and pending-upload expiry
are internal upload bookkeeping and do not emit activity.

Direct and runner document events keep only the document ID, applicable batch/run IDs and a
`document:<document_type>:<owner_type>:<owner_uuid>` reason code containing
controlled type keys and the owning record ID. Both paths use the shared
`documentActivityReasonCode` helper for every owner type, including document
creation, updates and deletion. Events never copy filenames,
URLs, storage keys or descriptions. Parent deletes capture ownership before
removing the rows needed to resolve it.

`src/data-access/activity-coverage.test.ts` discovers modules throughout
`src/data-access/` that write the covered tables and fails on unlisted modules or
unclassified write exports. Its inventory distinguishes `direct` recording,
`runner` coverage with operation IDs, and reasoned `exempt` entries. Certification status
transitions use `certification-status-activity.ts`. Reference data, energy,
readings and incidents are outside this activity scope.

The batch activity list and summary share one membership predicate: an explicit
link to the requested batch, or a null batch link with a current member-run link
or current member record identity. An explicit link to another batch never matches,
including copies of fanned-out edits and membership events. Member identities
come from `loadCreditBatchRollups` (including
run forwards), lab samples, owned documents and transport legs. Removal and GHG
Statement identities follow the application slice tables; multi-run stock movements
follow saved output allocations. These identity matches
recover best-effort links, including events written before membership existed;
explicit batch links preserve detach and deletion history. One event-page query
uses bound ID arrays and OR predicates, so overlapping matches do not duplicate
rows. Pages order by descending millisecond timestamp and sequence, with a
validated opaque cursor. Record labels and actor names resolve in batches at
read time; missing records are tombstones, unknown types have generic labels,
and documents never expose filenames. The summary counts every matching event by
entity type and action and resolves the latest event with the same labels and actors.
The list optionally filters by action and entity type (the summary never does), and
each record also resolves the facility it belongs to now (a document takes its
owner's), so links follow records that moved; ids that are not UUIDs read as
missing. The UI built on these reads: [traceability.md](./traceability.md).

## Row-Level Guards

Frozen/locked rows are protected by dedicated modules in `src/data-access/`, not by DB constraints alone: `bin-stock-guards.ts`, `lock-bin-stocks.ts`, the `*-stock-locks.ts` family (`biochar-product`, `delivery`, `formulation`, `order`, `production-run`), `facility-durability-lock.ts`, `certification-lineage-guards.ts`, `unique-name-guards.ts`. A fresh `db.update()` that skips these silently bypasses the freeze — route mutations through the guarded helpers.

API production-run reads select the run and its explicit draws in one statement,
so their row version and draw masses share a statement snapshot. The public run
representation carries reference IDs; clients resolve codes and facility zones
through lookups. Its strong ETag covers the run version and representation
revision. Feedstock edits change bin stock and their own version, but do not
rewrite the run's measured moisture, draws or batch allocations and do not bump
the run version. A change to the run itself bumps its version.

Application writers use `src/data-access/application-write-scope.ts`: unlocked
discovery, sorted lineage artifacts, facilities `FOR SHARE`, runs `FOR SHARE`,
batches `FOR SHARE`, deliveries `FOR UPDATE`, application `FOR UPDATE` with its
version check, revalidation, then application slices `FOR UPDATE` and writes.
Changed lineage, parent or discovered sets return retryable `conflict` to the
client; no new locks are taken late. Explicit credit-batch membership takes
artifacts before facilities and runs, then process scope and batch. Scalar
edits and delete take no member run locks; late auto-membership acquisition is
non-blocking `SKIP LOCKED` and refuses a missed row. See
[Database boundaries](./architecture.md#database-boundaries) for the full order.
`src/lib/db/transaction-retry.ts` shares the runner's bounded retry policy with
all three membership transactions. It retries 40P01, 40001 and 55P03; production
run writers still take runs before artifacts. The residual order is tracked in
`data/production-run-artifact-order` and `data/lock-order`.

## Numeric Column Families

`src/db/schema/numeric-families.ts` (migration `0066`) exports `massKg`, `tonnes`, `ppm`, `fraction`, `percent`, and `emissionFactor` (kg CO₂e per activity unit, migration `0120`), all exact `numeric(p,s)`.

- **Credit-bearing values** — masses, CO2e, contaminant ppm, ratios, percents — MUST use these helpers. Never `real()`; float rounding drifts verifier-facing figures.
- Telemetry, in-process QC, and lab characterization columns stay `real`.
- Over-precision now fails loudly with a Postgres `numeric field overflow` rather than rounding silently.

## Schema Shape

Facilities and supplier/customer locations store required GPS coordinates and
an explicitly supplied country, with no country default. Customer location
names are required. Suppliers store neither GPS nor transport distance; these
belong to supplier locations. Tightening these constraints requires valid rows
in development/staging before migration; there is no automatic backfill.

Source of truth: `src/db/schema/*.ts`, exported through `src/db/schema/index.ts`. Area-by-area breakdown: [`schema-overview.md`](./schema-overview.md). Shared domain enums live in `common.ts`.

Schema defaults and create/update defaults must stay aligned, especially for JSONB columns.

Deliveries inherit their destination from `orders.customer_location_id`. Drawn
products resolve through `output_stock_allocations`; deliveries have no destination
override or direct product column. The nullable driver and vehicle references remain.

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
- Connection via `DATABASE_URL`. `src/db/index.ts` builds the app pool from `getPgPoolConfig` (`src/lib/pg-pool-config.ts`, connection string and SSL) and `resolveAppPoolConfig` (`src/db/pool-config.ts`, which owns every `DEFAULT_DB_POOL_*` constant and `MAX_VERCEL_DB_POOL_MAX`). Four environment variables feed it: `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`, and `DB_POOL_LOCK_TIMEOUT_MS`. CLI scripts build short-lived pools through `src/lib/cli/*` and do not share the app pool. The Mafinga seed (`src/lib/cli/seed/`) is the one exception: it calls the real server actions, so it uses the app pool they use.
- The module-scope pool is registered with Vercel's [`attachDatabasePool`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#database-connection-pool-management), which keeps a Fluid Compute instance alive until `pg` releases its idle clients. The idle default is 5 seconds. `DB_POOL_MAX` defaults to 1, and each environment sets its own value from measurement (see [Pool sizing and compute placement](#pool-sizing-and-compute-placement)); a Vercel deployment fails closed above `MAX_VERCEL_DB_POOL_MAX` because per-instance pools multiply.
- Pooled statements wait at most 1 second for a conflicting database lock by default, configurable with the positive `DB_POOL_LOCK_TIMEOUT_MS`. Keep it below the pool connection-acquisition timeout. PostgreSQL reports `55P03` on a lock timeout; the waiting transaction rolls back and can be retried after the conflicting operation finishes. This prevents a waiting writer from occupying the only pooled connection during registry cleanup. Dedicated certification lock connections do not inherit this setting: an active registry DELETE retains its fence until the protected callback finishes. This is a lock-acquisition timeout, not a statement or remote-request deadline.

### Mafinga demo seed

`pnpm db:seed` creates the September 2026 Mafinga demo through the same server
actions and Zod schemas as the forms, so every seeded row is one the UI would
have accepted. Run `pnpm db:ensure-admin` first if the bootstrap admin or
organization is missing. The entry is `src/db/seed-data.ts`; the steps live in
`src/lib/cli/seed/`, because they call server actions and `src/db/` must not
import `src/fn/`. A repeat run matches the Mafinga facility by its code or its
seeded name, then checks the completion marker (the delivery the seed creates
last). A complete dataset exits without adding rows. A failed step aborts with
its action error and leaves earlier steps in place, and a rerun refuses that
partial dataset instead of duplicating it: run `pnpm db:reset` before
reseeding.

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

The CLI uses `runWithCliOrgContext` (`src/lib/cli/org-context.ts`) to call real
actions without a request session. The seam verifies the Platform Admin and the
organization, is forbidden in request code, and rejects production use unless
`ALLOW_DEV_BOOTSTRAP=1` ([auth.md](./auth.md)). The manually confirmed staging
reset-and-seed job sets that flag, loads the registry trio and the storage
settings from the staging 1Password item, and passes the two optional IDs from
GitHub repository variables. The PR migration gate seeds without credentials.

The seed runs real server actions, so its import graph reaches
`src/config/env.ts`, which validates at module load and requires
`NEXT_PUBLIC_APP_URL` alongside `DATABASE_URL`, `BETTER_AUTH_SECRET`, and
`NODE_ENV`. The staging job sets a loopback placeholder for the app URL (the
seed never serves HTTP) and runs `pnpm db:seed:preflight` (`src/lib/cli/seed-preflight.ts`) before
`pnpm db:reset`, so an incomplete environment fails with staging data intact
instead of after the wipe.

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

Raise the value one step at a time (1, then 3, then 5), never as an unbounded
increase. At each step, run the same workload with `LOG_LEVEL=trace` for a
bounded window and decide from the checkout-queue telemetry, not from page
latency: on `database connection acquired`, the acquisition `durationMs` is the
primary signal, and `waitingBefore > 0` shows a deeper queue behind that checkout
(it counts only the checkouts already waiting ahead of it, so a single waiter at a
time still reads 0). Watch the database-side active and idle connection peaks and
SQLSTATE `53300` at every step. Take the next step only when the budget above
supports it and checkouts still queue at the current one.

Pool size and compute region are separate changes; never move both in one
deployment. The [Vercel Function
region](https://vercel.com/docs/functions/configuring-functions/region) is pinned
in `vercel.json` (`regions`) and must match the database's actual region; change
both together when the database moves.

The application needs session semantics for
`withDedicatedSessionAdvisoryLock`. A direct connection or a session-pooling
proxy is compatible; a transaction-pooling proxy must not be assumed compatible
with session advisory locks.

Pool timing records (`mod: db-pool`) are emitted at `trace`, so `LOG_LEVEL=trace`
is the measurement window: set it for a bounded period and put it back
afterwards. The records are privacy-safe — duration, success, pool totals, idle
count, and queue count, and never SQL, parameters, hostnames, database names,
or user data. At any level, connection failures, checkout failures, and
idle-client errors are logged at warn; query timings and query failures only
appear at trace.

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
- **Lab sample writes** reject an archived credit batch (create, update, move; reads and delete still work). They read the batch after locking it, in the order certification artifacts, credit batches by id, sample (`src/data-access/samples/write-scope.ts`). `archiveFacility` locks the facility's credit batches in id order before its bulk update so it cannot deadlock against a sample move.
- **Codes stay reserved** while archived (uniqueness checks ignore archive state) so restore can't collide.

Stamped tables: `facilities`, `reactors`, `storage_locations`, `feedstocks`, `production_runs`, `biochar_products`, `orders`, `deliveries`, `credit_batches`, `stockpile_events`, `power_procurement_evidence` (archive stamps introduced in `drizzle/0041_outgoing_paper_doll.sql`).

## Migrations

Generated SQL lives in `drizzle/`; metadata snapshots in `drizzle/meta/`. **Migration history lives in `drizzle/`; the *why* for schema-shaping changes lives in [`docs/adr/`](./adr/).**

Flow: change schema → `pnpm db:generate` → review the emitted SQL → run targeted tests → `pnpm db:migrate` in shared environments.

### Your migration number is taken after merging staging

1. Merge `origin/staging`, then replace your metadata with its: `rm -rf drizzle/meta && git checkout origin/staging -- drizzle/meta`. A plain checkout keeps your branch-only snapshots, and `db:generate` would diff against them.
2. Delete your own `NNNN_*.sql`, then rerun `pnpm db:generate --name <same name>`.
3. Re-apply any hand-written SQL you added to the generated file.
4. Reset your worktree DBs, then migrate. A plain migrate skips staging's migration when its `when` is older than the one you already applied. Before pushing, `git status --short drizzle/` should show only your new migration files and metadata changes.
5. Never rename the file and edit the journal by hand: Drizzle skips migrations whose `when` is older than the last applied one. `pnpm check:migrations` catches this.

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

The independent `fresh-database-gate` also runs on every PR, merge-queue group and manual run. It applies the full chain to another empty database, runs production-mode bootstrap twice to prove idempotence, and verifies the schema. Neither job substitutes schema push for migrations; promotion labels do not bypass either job.

## Certification Tables

`src/db/schema/certification.ts` is provider-neutral; Isometric-specific code
lives under `src/lib/isometric/`. Tables: `certifier_credentials` (registry
credentials — handle as secrets, data-access in
`src/data-access/certifier-credentials.ts`),
`certifier_organization_settings` (organization/provider policy, including
Source visibility), `certifier_projects`,
`certifier_ghg_statements`, `certifier_ghg_statement_reports`,
`certifier_removals`, `certification_submissions`,
`certifier_document_uploads`, `certifier_sync_events`,
`certifier_production_batches`, `certifier_storage_locations`,
`certifier_biochar_applications`, and `removal_template_observations`. The last
four live in separate schema modules named after their tables. They are
Isometric-specific registry journals and template observations that use provider
payload types; `certification.ts` remains the provider-neutral
submission and configuration boundary. Purpose per table:
[`schema-overview.md`](./schema-overview.md); submission-unit rationale:
[ADR 0003](./adr/0003-removal-as-submission-unit.md), [ADR
0008](./adr/0008-submission-ledger-internal-seam.md).

`removal_template_observations` stores normalized Isometric templates, enriched
input metadata, fingerprints and versioned component-ID line contracts. Reviews
require Owner/Admin permission; compilation requires complete enrichment and
valid contracts. See [ADR 0032](./adr/0032-per-batch-emissions-entries-bound-to-template-lines.md).

`credit_batches.removal_template_id` pins the facility default at creation.
Moving a batch to another facility copies the target facility's default and
records the pin change in activity. Other pin changes use the audited Switch
template action. Removals compile against their member batches' pins, never the
current default. Pre-existing rows receive
no backfill under the pre-production policy; local resets are supported and any
shared staging reset requires notifying the user first.

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

## Record locks

The converted certification-lineage and dependency guards use the record-lock policy in [ADR 0035](./adr/0035-record-locks-follow-dependencies-and-registry-lineage.md). `src/lib/record-lock.ts` contains the client-safe per-kind predicates returning `level`, `heldBy`, `freeFields` and `howToFree`. Open has no consumers; In use has numeric consumers; Sent takes precedence and has no free fields. Data-access resolves organization-scoped facts rather than trusting screen membership.

`record-lock-lineage.ts` reads every relevant `certification_submissions` row, including older versions and historical statement membership. Registry creation (`draft`), submitted or accepted rows, possible remote effects, unknown statuses and in-flight work hold Sent. A known failed attempt with no remote effects does not. A failed v2 cannot release a submitted v1.

A covering statement must be read fresh from Certify to reopen: FAILED_VERIFICATION, or DRAFT with earlier verifier-submission evidence (`submitted_at`, retained in metadata). This includes submissions made in Certify itself when REST or saved metadata retains a submission timestamp. Historical Certify submissions with a null REST timestamp and no saved evidence remain locked: this integration has no GraphQL history reader. Every other covering statement must also be known and safe, and nothing may be in flight. Failed reads keep the lock. Writers re-read under sorted certification artifact locks and refuse lineage expansion after locking; advisory reads cannot authorize a write. Every attempt with remote effects must have a known external identity covered by the fresh statement and predate its return evidence. REST exposes no return timestamp, so its verifier-submission time is used as a conservative lower bound; attempts after that bound remain locked. Resubmission therefore locks the lineage again.

Numeric consumers remain In use after reopening. Output entries share the correction dependency resolver between browser and server; unrelated intake does not lock them. Feedstock retains ADR 0027 wet-lane checks, so an intake edit may still proceed if all withdrawals fit. These rules need no schema migration. Free-field declarations describe current accepted updates, subject to field validation, membership and stock-sufficiency checks. They do not authorize bypassing those guards. Independent master-data, document, Removal lifecycle and deletion guards remain; see [record-lock follow-ups](./open-questions.md#record-lock-follow-ups) for free-field and deletion changes.

## Method-B storage boundary

`production_processes` stores only an epoch plus the all-or-none Method-B
prerequisites. `credit_batches.sampling` stores the immutable per-batch
`sampled`/`unsampled` choice. Eligibility is computed in the data-access layer
from eligible samples since the current epoch; it is not persisted or enforced
by a database trigger. See [ADR 0022](./adr/0022-method-b-is-computed-eligibility-not-stored-unlock.md).

## Before Merging Schema Work

1. Run `pnpm db:generate` and review the emitted SQL before committing.
2. For certification changes, update `docs/isometric/changes.md`.
