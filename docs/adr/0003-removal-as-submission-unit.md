# The Isometric Removal is the submission unit; GHG Statements are decoupled

> **Status: Accepted, delivered** (2026-05-22). Supersedes
> [ADR 0002](./0002-credit-batch-as-ghg-statement.md) (the short-lived
> "credit batch = GHG Statement" model). The "GHG Statements are
> decoupled and dormant" clause below was lifted by
> [ADR 0004](./0004-ghg-statement-as-independent-artifact.md) — the
> GHG Statement is now a live, independent artifact.

## Context

The prior model mapped one production run → one Isometric **Removal** and
one credit batch → one **GHG Statement**, with a two-phase
`submitCreditBatch`. Two things changed that:

1. Stakeholder review (and verification against Isometric's docs) clarified
   that a **GHG Statement is an arbitrary reporting period** — the supplier
   chooses its start/end dates — not a synonym for a credit batch. It is
   better modelled later as an independent artifact.
2. A **production run is the wrong submission grain**: its biochar is split
   across deliveries and applications, so a run is not 1:1 with a removable
   quantity, and run-as-Removal over-counted (it assumed a run's whole
   output was applied).

## Decision

- The Isometric **Removal is the submission unit**, represented locally by
  a new `certifierRemovals` row (facility-scoped).
- **N credit batches map into one Removal.** Default is 1:1 per month — a
  removal is created lazily for a credit batch on first submit; multiple
  credit batches can be grouped into one removal via the Removals hub.
  `creditBatches` gains a nullable `removalId` FK.
- A Removal aggregates the **deduped union of production runs** reached
  through its member credit batches' application lineage.
- **Applied-biochar scoping — linear mass allocation.** A Removal counts
  only biochar that got applied to soil. Each run is weighted by
  `appliedDryKg / runTotalBiocharOutput`; a partially-applied run
  contributes proportionally (equivalent to an Isometric attribution
  factor).
- **GHG Statements are decoupled and dormant.** The submit flow produces
  only Removals. `src/fn/certification/ghg-statements.ts` is kept un-wired
  for a future, independent GHG-statement feature.
- The removal ledger row is keyed
  `(provider, 'removal', 'removal', certifierRemovals.id)`. The
  `payloadHash` covers the source run set + resolved inputs, **not** the
  member-batch id set — a pure-membership change must not POST a duplicate
  Isometric Removal (the supplier ref carries the version).

## Why

A run-as-Removal mapping over-counted and forced a rigid run↔removal
cardinality. A credit-batch-driven Removal with applied-mass allocation
matches what the registry actually credits: durably-stored, applied
biochar. Decoupling the GHG Statement removes a false equivalence
(statement ≡ batch) and lets the statement be modelled properly later as
an arbitrary reporting period.

## Consequences

- `submitCreditBatch`'s two-phase orchestration is gone; submission is a
  single `submitRemoval`. The credit-batch side-sheet Certify panel and a
  new `/certification` Removals hub drive it.
- Grouping (`assignCreditBatchToRemoval`) is blocked when either the source
  or target removal has a non-terminal ledger row — re-grouping a mid-flight
  removal would change what a live Isometric Removal represents.
- Pooling transport legs across member batches raises the chance
  `aggregateTransportLegs` blocks on mixed methods/factors — correct
  Isometric Transportation v1.1 §5 behaviour, surfaced in the UI before
  submit.
- Old per-run / per-batch ledger rows from the ADR 0002 model are abandoned
  (sandbox-only data; clean cutover, same stance as 0002).
- Migration `0022` is additive — `certifier_removals` table +
  `credit_batches.removal_id` column.
- The supplier-reference scheme is re-keyed run→removal (`nm-pr-` →
  `nm-rmv-`).
