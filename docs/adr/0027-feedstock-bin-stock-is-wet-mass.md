# Feedstock bin stock is wet mass

> **Current status: Accepted and implemented** (reviewed 2026-08-10).

Feedstock logistics use wet/as-received kilograms as their native stock
currency. A feedstock bin's balance is complete wet intake minus non-cancelled
production-run wet withdrawals minus wet formulation-ingredient withdrawals,
plus signed wet reconciliation and loss movements. Availability guards and
transactional allocation use that same balance.

A production run separately derives `feedstockMassDryKg` from its wet
withdrawal and measured run moisture. That dry value belongs to processing,
mass-balance, and certification calculations. It is not a bin balance and does
not constrain a physical withdrawal.

## Decision

- `production_run_feedstocks.wet_mass_used_kg` records each run's wet allocation
  to an intake batch.
- Reconciliations, counts, and losses in the feedstock lane are wet kilograms.
  Moisture may be retained as snapshot metadata but does not convert the signed
  movement.
- Storage selectors, summaries, and overdraw messages use authoritative wet
  stock. A dry estimate may be displayed only when clearly marked non-binding.
- Biochar and finished-product stock semantics are unchanged.

## Consequences

An intake-derived dry estimate can be lower than a later run's dry mass because
the run uses its own measured moisture. That difference is expected and cannot
cause an overdraw. Certification aggregation continues to sum the dry mass
stored on production runs, while lineage and traceability show wet allocations.

The decision intentionally has no compatibility alias or data backfill. There
is no production database, so the schema rename is applied directly through the
next development migration.
