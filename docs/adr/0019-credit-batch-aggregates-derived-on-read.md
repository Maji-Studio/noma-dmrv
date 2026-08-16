# Credit-batch aggregates are derived on read, not stored

Status: accepted (2026-07-03)

## Context

`credit_batches` stored six aggregate columns — `weightTons`,
`totalCo2eStoredTons`, `totalCo2eEmissionsTons`, `totalCo2eCounterfactualTons`,
`totalFeedstockMassKg`, and `ineligibleFeedstockMassKg` — as a write-time
summary over the batch's member applications and run-feedstock lineage. The
2026-05-21 architecture audit flagged this as a correctness risk (tracked in
`docs/open-questions.md` as "`creditBatches` aggregate-drift"): nothing kept
the stored totals in sync when a member application was corrected or deleted,
so a carbon-credit headline number could silently go stale. ADR 0014 already
established credit-batch membership as the derivation basis for applications
and coverage; ADR 0018 separately took emissions/counterfactual figures off
noma's books entirely (registry-owned, no local copy). Neither ADR decided
whether the *remaining* mass/CO₂e-stored totals should be stored or derived.

## Decision

Drop all six stored aggregate columns and the CHECK constraints tied to them
(migration `0067`), delete the `refreshCreditBatchSummaries` write-back sync
that tried to keep them current, and compute every aggregate at read time
from source data instead:

- **Applied weight** — a per-read roll-up of member applications'
  `biocharAppliedTons` (`BatchApplicationRollup` helpers), threaded onto
  `CreditBatchWithRelations` and the credit-batch wizard's `SelectableBatch`.
- **CO₂e stored** — reads the existing preview engine
  (`buildCo2eStoredPreview` / `getCo2eStoredPreviews` in
  `src/data-access/credit-batch-accounting.ts`); the wizard and the dashboard
  KPI both fan out through it instead of reading a stored column.
- **Ineligible feedstock mass** — derived in `src/lib/chain-of-custody/sankey.ts`
  from lineage allocations whose feedstock is flagged
  `eligibilityStatus = 'ineligible'`, clamped to never exceed the column it
  exits from.
- **Emissions / counterfactual** — per ADR 0018, these were already
  registry-owned; the breakdown functions now pass explicit nulls instead of
  reading a dropped column.

## Consequences

- There is exactly one source of truth per figure — every consumer (wizard,
  dashboard, batch detail, Sankey) reads from the same derivation function, so
  the numbers cannot diverge the way a stored copy could.
- Read-time fan-out replaces an O(1) column read; this is deferred as
  acceptable because credit-batch reads are low-volume relative to writes
  (revisit if profiling says otherwise).
- Deleting an application can no longer leave the batch's headline totals
  stale, because there is nothing left to leave stale.
- Form/update Zod schemas and seed data stop carrying the six fields.

## Amendment: Removal-owned application slices

Removal membership is now frozen at the application-by-credit-batch grain.
`credit_batch_applications` therefore stores each slice's allocated wet and dry
mass once the slice is assigned to a Removal. This is a deliberate snapshot,
not a live credit-batch aggregate: it preserves exactly what an earlier Removal
submitted while later applied mass can enter a later Removal.

Unassigned slices remain a projection of live application and product
provenance. Their reconciliation runs when an Application is created or its
delivery/applied mass changes, when credit-batch run membership changes, and
immediately before unassigned slices are assigned to a Removal. Product source
allocations are written before any downstream Application exists and are
immutable after creation; the legacy linked-production-run update path also
reconciles any downstream unassigned slices.
