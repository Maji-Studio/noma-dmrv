# Current Schema Overview

Map of the Drizzle schema: where each area lives, and the invariants that are
*not* visible from reading a single table definition. Read it before adding a
table, a column, or a cross-entity query. The code is the source of truth:
`src/db/schema/index.ts` exports the area files below; `common.ts` and
`numeric-families.ts` supply shared types rather than tables. Operations,
migrations, and soft-delete semantics live in [`database.md`](./database.md).

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
| Certifier credentials, organization settings, projects, sensors, GHG statements, generated statement reports, removals, submissions, uploads, sync events | `src/db/schema/certification.ts` |
| Registry production-batch identities (Isometric `ptb_…` per credit batch) | `src/db/schema/certifier-production-batches.ts` |
| Stockpile events, power procurement evidence | `src/db/schema/compliance.ts` |
| Biochar storage inventory | `src/db/schema/storage-inventory.ts` |
| Bin movements (ledger) | `src/db/schema/bin-movements.ts` |
| Documents (polymorphic evidence store) | `src/db/schema/documentation.ts` |
| Organization operating defaults | `src/db/schema/settings.ts` |
| Route cache | `src/db/schema/geo.ts` |
| Shared enums / shared numeric column types | `src/db/schema/common.ts` · `src/db/schema/numeric-families.ts` |

## Invariants and traps

- **Multi-tenancy.** Every MRV/domain table carries a NOT NULL
  `organization_id` → `organizations.id`, and cross-entity FKs on the guarded
  paths are **composite** on `(id, organization_id)` (e.g.
  `credit_batch_production_runs` → `credit_batches(id, organization_id)`).
  Better Auth infrastructure in `auth.ts` uses its own user/session/account/org
  relationships, and `geo_route_cache` is intentionally organization-neutral.
  Those are explicit infrastructure exceptions; a new domain table or join
  that omits organization scope is wrong. See [ADR
  0010](./adr/0010-shared-schema-org-column-tenancy.md) and
  [`organization.md`](./organization.md).
- **Numeric columns are shared families**, not raw `numeric(p,s)`: use `massKg`, `tonnes`, `ppm`, `fraction`, `percent` from `src/db/schema/numeric-families.ts`. Never hand-roll precision.
- **`bin_movements` is append-only.** Rows are never UPDATEd or DELETEd — correct a mistake with a compensating signed movement. Movements never mutate `biochar_storage_inventory`; derived stock overlays their signed sum. See [ADR 0012](./adr/0012-bin-capability-from-held-feedstock-type.md).
- **A production run belongs to at most one credit batch** — `credit_batch_production_runs` has composite PK `(credit_batch_id, production_run_id)` plus a unique on `production_run_id` alone. See [ADR 0014](./adr/0014-credit-batch-as-production-cohort.md), [ADR 0020](./adr/0020-production-emissions-front-loaded-per-credit-batch.md).
- **Some rules live only in raw SQL**, not in Drizzle. Read the migration chain when a schema invariant is unclear; the current Method-B model deliberately has no sample-floor trigger because eligibility is a live read.
- **`samples.credit_batch_id` and `samples.production_run_id` are both nullable.** Credit-batch attachment is the intended route ([ADR 0016](./adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)), but nothing in the schema requires either — validate in `fn/`.
- **`credit_batches` stores no aggregate totals** — applied weight, CO2e stored, and ineligible-biomass fraction are derived on read ([ADR 0019](./adr/0019-credit-batch-aggregates-derived-on-read.md)); project emissions are registry-owned ([ADR 0018](./adr/0018-isometric-owns-project-emissions.md)); durability tier is inherited from the facility, not stored per batch ([ADR 0021](./adr/0021-durability-tier-is-facility-scoped.md)).
- **`production_processes` owns the process epoch and Method-B prerequisites**, keyed `(facility, feedstock)`; `credit_batches.sampling` owns the immutable per-batch choice. Eligibility is computed, never stored. See [ADR 0022](./adr/0022-method-b-is-computed-eligibility-not-stored-unlock.md).
- **`certifier_credentials` holds provider auth** (encrypted access token + client secret, unique per `(organization_id, provider)`) — separate from `certifier_projects`, which only maps facilities to provider project IDs plus emission-estimate config ([ADR 0015](./adr/0015-energy-single-combined-measurement-point.md)). Submission-unit shape: [ADR 0003](./adr/0003-removal-as-submission-unit.md), [ADR 0004](./adr/0004-ghg-statement-as-independent-artifact.md), [ADR 0008](./adr/0008-submission-ledger-internal-seam.md).
- **`certifier_production_batches` mirrors the registry's Production Batch id for a credit batch** (`external_production_batch_id` = `ptb_…`, one row per `(provider, credit_batch_id)`, provider pinned to `isometric`). The credit batch IS the protocol production batch ([ADR 0016](./adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)), so the row is written before its MeasurementSamples POST and is the idempotency journal for them: present ⇒ reuse the `ptb_…`, absent ⇒ reconcile by the `nm-ptb-…` supplier reference before POSTing. It also mirrors the registered `mass_kg` (total dry biochar, `M_biochar (DM)` — NOT the attribution-scaled GHG-entry `product_mass`), window, and payload hash so drift is detectable without a registry round-trip.
- **A registry GHG statement's local identity is per `(provider, organization, facility, remote id)`**, because one Isometric project may be shared by several facilities (`certifier_projects` has no `external_project_id` unique). So the same registry statement can hold one `certifier_ghg_statements` row per facility, and `cert_submissions_external_unique` is partial — it excludes `submission_type = 'ghg_statement'`, which uses `cert_submissions_ghg_statement_external_unique` instead. ADR 0004's one-statement-per-`(provider, facility, period)` constraint is unaffected. See [ADR 0023](./adr/0023-registry-ghg-statement-identity-is-org-and-facility-scoped.md).
- **`certifier_ghg_statement_reports` is an immutable version stream per GHG
  Statement.** Each prepared row owns one private `documents` row, frozen
  inputs/model, source fingerprint, content checksum, preparation idempotency
  key, and the digest of its current verifier bearer token. Lifecycle is
  `prepared → approved → submitted`; approval and submission add actors/times
  but never replace the PDF/model. A changed live statement is handled by
  preparing a new version. The public report route may look up a row across
  organizations only under its explicit `// org-scope-ok:` capability waiver;
  all management paths remain org-scoped.
- **`certifier_organization_settings` holds provider policy above the facility scope.** Its Source visibility value is unique per `(organization_id, provider)`, defaults to private when the row is absent, and applies only to newly mirrored registry Sources.
- **`organization_settings` holds operating defaults that seed forms, never protocol constants.** One row per organization (unique on `organization_id`); every column is NOT NULL with a default mirroring the literal it replaced, and the read falls back to `DEFAULT_ORGANIZATION_SETTINGS` (`src/config/organization-settings.ts`) when no row exists, so consumers never see null. Changing a default never rewrites a saved record. Protocol-derived thresholds stay constants — a settings row that could move the H:C eligibility ceiling or the Method-B sample floor would let an operator weaken a certification gate from a form.
- **Soft delete** via nullable `archived_at` on `facilities` and its operational descendants — see [`database.md`](./database.md) → "Soft Delete — Facility Archive".
- **All domain enums** are in `src/db/schema/common.ts` — read the file, not a sample.

## Related references

- Chain-of-custody traversal: [`traceability.md`](./traceability.md) · [ADR 0011](./adr/0011-credit-batch-anchored-chain-of-custody.md)
- Layering rules for queries on these tables: [`architecture.md`](./architecture.md)
- Isometric requirement mapping: [`isometric/schema-mapping.md`](./isometric/schema-mapping.md) · conditional fields: [`isometric/condition-registry.md`](./isometric/condition-registry.md)
