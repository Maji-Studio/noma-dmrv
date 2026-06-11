# Chain of custody is credit-batch-anchored; the application is the drill-down

> **Status: Accepted** (2026-06-11). Reverses the application-first anchor
> recorded in `docs/chain-of-custody.md` (itself a deliberate redesign).
> Feature shape lives in `docs/plans/2026-06-11-chain-of-custody-views.md`;
> this ADR fixes only *what the page is anchored on and why*.

## Context

The chain-of-custody page was application-first: pick one application, see
its upstream **rollback** to feedstock batches. That anchor makes every
graph a near-linear path, but it answers only the operator's QA question
("is this application's lineage intact?"). The MRV-meaningful question —
"what feeds this credit?" — lives one level up, at the **credit batch**,
whose lineage is a fan-out across many applications sharing production
runs. A 2026-06-11 ideation session (Maji concept canvas: Sankey,
network, pipeline, ledger, radial treatments) forced the anchor question.

## Decision

The page anchors on a **credit batch** and renders its **roll-up**: every
member application's rollback merged, runs deduped, applied-biochar
scoped — the exact aggregation the certification layer already performs
(`fn/certification/certify-context-core.ts` maps `applicationIds` through
`getChainOfCustodyData`, then `buildMassAccounting`). The single
application becomes the **drill-down** scope, preserving today's views
unchanged; a dual header selector (batch *or* application) keeps
unbatched applications reachable.

## Considered options

- **Production-run anchor** — the operator's unit of work, traced
  *forward* to every application its biochar reached. Rejected for now: it
  needs a new forward resolver, and the batch anchor serves verification —
  the page's primary audience. Revisit if operators ask "where did this
  run go?" often enough.
- **Keep application-first, batch view on the batch detail page** —
  rejected: splits the lineage feature across surfaces and leaves the
  page answering the lesser question.

## Consequences

- The batch roll-up reuses the proven certification resolver rather than
  growing a second lineage traversal — one source of truth for "which
  runs feed this batch."
- Views split by scale: batch level gets aggregate readings (merged DAG,
  transit map, **mass balance** Sankey); application level keeps the
  linear readings (DAG, map, split, **Trail**). See CONTEXT.md →
  Provenance & lineage for the canonical terms.
- The application-first sections of `docs/chain-of-custody.md` and
  CLAUDE.md must be updated when the re-anchor ships (Phase 3), not
  before — Phase 2 (transit map) lands on the old anchor first.
