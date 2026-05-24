# Credit batch = GHG Statement (superseded)

> **Status: Superseded by ADR 0003 on 2026-05-22.** Recorded here only so
> cross-references from 0003, 0004, and `docs/open-questions.md` resolve.
> No code path implements this model today.

## Context

For two weeks in May 2026 the integration mapped:

- One production run → one Isometric **Removal**.
- One credit batch → one **GHG Statement**, via a two-phase
  `submitCreditBatch` that POSTed a Removal first and then attached it to
  a GHG Statement.
- A per-credit-batch ledger key
  (`localEntityType:'creditBatch','ghgPeriod'`) drove idempotency.

This model shipped briefly between 2026-05-21 and 2026-05-22 and was
never deployed beyond sandbox.

## Why it was superseded

- **Wrong submission grain.** A production run's biochar is split across
  deliveries and applications, so a run is not 1:1 with a removable
  quantity. Run-as-Removal over-counted by assuming the whole output
  was applied. **ADR 0003** moved the submission unit to the Removal,
  aggregating the applied-mass-scoped union of runs reached through a
  credit batch's application lineage, with `N credit batches → 1
  Removal`.
- **False equivalence statement ≡ batch.** A GHG Statement is an
  arbitrary supplier-chosen reporting period, not a synonym for a
  credit batch. **ADR 0004** decoupled the GHG Statement into its own
  period-anchored artifact (`certifierGhgStatements`).

## Cutover stance

Sandbox-only data; clean cutover. Migration `0021` drops
`certifier_ghg_periods`. Any non-sandbox `certification_submissions`
rows with `localEntityType IN ('creditBatch','ghgPeriod')` must be
purged or remapped before deploy — see **Pre-deploy gates** in
`docs/isometric/integration-plan.md`.
