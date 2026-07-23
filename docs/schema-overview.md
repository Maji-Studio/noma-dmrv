# Current Schema Overview

Map of the Drizzle schema: where each area lives, and the invariants that are *not* visible from reading a single table definition. Read it before adding a table, a column, or a cross-entity query. The code is the source of truth — `src/db/schema/*.ts` (52 `pgTable` exports across 16 table-bearing files). Operations, migrations, and soft-delete semantics live in [`database.md`](./database.md).

## Area → file index

| Area | File |
|---|---|
| Auth, orgs, members, invitations | `src/db/schema/auth.ts` |
| Facilities, reactors, storage locations | `src/db/schema/facilities.ts` |
| Suppliers, customers, their locations, drivers, operators | `src/db/schema/parties.ts` |
| Feedstock deliveries, types, feedstocks | `src/db/schema/feedstock.ts` |
| Production runs, readings, samples, production samples, incidents, run↔feedstock junction | `src/db/schema/production.ts` |
| Production processes (epochs + Method-B prerequisites) | `src/db/schema/production-processes.ts` |
| Formulations, ingredients, biochar products | `src/db/schema/products.ts` |
| Vehicles, orders, deliveries, transport legs | `src/db/schema/logistics.ts` |
| Applications, soil temperature measurements | `src/db/schema/application.ts` |
| Credit batches + application/production-run membership | `src/db/schema/credits.ts` |
| Certifier credentials, projects, sensors, GHG statements, removals, submissions, uploads, sync events | `src/db/schema/certification.ts` |
| Stockpile events, power procurement evidence | `src/db/schema/compliance.ts` |
| Biochar storage inventory | `src/db/schema/storage-inventory.ts` |
| Bin movements (ledger) | `src/db/schema/bin-movements.ts` |
| Documents (polymorphic evidence store) | `src/db/schema/documentation.ts` |
| Route cache | `src/db/schema/geo.ts` |
| Shared enums / shared numeric column types | `src/db/schema/common.ts` · `src/db/schema/numeric-families.ts` |

## Invariants and traps

- **Multi-tenancy.** Every table except `geo_route_cache` carries a NOT NULL `organization_id` → `organizations.id`, and cross-entity FKs are **composite** on `(id, organization_id)` (e.g. `credit_batch_production_runs` → `credit_batches(id, organization_id)`). A new table or join that omits either is wrong. See [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md) and [`organization.md`](./organization.md).
- **Numeric columns are shared families**, not raw `numeric(p,s)`: use `massKg`, `tonnes`, `ppm`, `fraction`, `percent` from `src/db/schema/numeric-families.ts`. Never hand-roll precision.
- **`bin_movements` is append-only.** Rows are never UPDATEd or DELETEd — correct a mistake with a compensating signed movement. Movements never mutate `biochar_storage_inventory`; derived stock overlays their signed sum. See [ADR 0012](./adr/0012-bin-capability-from-held-feedstock-type.md).
- **A production run belongs to at most one credit batch** — `credit_batch_production_runs` has composite PK `(credit_batch_id, production_run_id)` plus a unique on `production_run_id` alone. See [ADR 0014](./adr/0014-credit-batch-as-production-cohort.md), [ADR 0020](./adr/0020-production-emissions-front-loaded-per-credit-batch.md).
- **Some rules live only in raw SQL**, not in Drizzle. Read the migration chain when a schema invariant is unclear; the current Method-B model deliberately has no sample-floor trigger because eligibility is a live read.
- **`samples.credit_batch_id` and `samples.production_run_id` are both nullable.** Credit-batch attachment is the intended route ([ADR 0016](./adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)), but nothing in the schema requires either — validate in `fn/`.
- **`credit_batches` stores no aggregate totals** — applied weight, CO2e stored, and ineligible-biomass fraction are derived on read ([ADR 0019](./adr/0019-credit-batch-aggregates-derived-on-read.md)); project emissions are registry-owned ([ADR 0018](./adr/0018-isometric-owns-project-emissions.md)); durability tier is inherited from the facility, not stored per batch ([ADR 0021](./adr/0021-durability-tier-is-facility-scoped.md)).
- **`production_processes` owns the process epoch and Method-B prerequisites**, keyed `(facility, feedstock)`; `credit_batches.sampling` owns the immutable per-batch choice. Eligibility is computed, never stored. See [ADR 0022](./adr/0022-method-b-is-computed-eligibility-not-stored-unlock.md).
- **`certifier_credentials` holds provider auth** (encrypted access token + client secret, unique per `(organization_id, provider)`) — separate from `certifier_projects`, which only maps facilities to provider project IDs plus emission-estimate config ([ADR 0015](./adr/0015-energy-single-combined-measurement-point.md)). Submission-unit shape: [ADR 0003](./adr/0003-removal-as-submission-unit.md), [ADR 0004](./adr/0004-ghg-statement-as-independent-artifact.md), [ADR 0008](./adr/0008-submission-ledger-internal-seam.md).
- **Soft delete** via nullable `archived_at` on `facilities` and its operational descendants — see [`database.md`](./database.md) → "Soft Delete — Facility Archive".
- **All domain enums** are in `src/db/schema/common.ts` — read the file, not a sample.

## Related references

- Chain-of-custody traversal: [`traceability.md`](./traceability.md) · [ADR 0011](./adr/0011-credit-batch-anchored-chain-of-custody.md)
- Layering rules for queries on these tables: [`architecture.md`](./architecture.md)
- Isometric requirement mapping: [`isometric/schema-mapping.md`](./isometric/schema-mapping.md) · conditional fields: [`isometric/condition-registry.md`](./isometric/condition-registry.md)
