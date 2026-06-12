# Chain-of-Custody Views — Credit-Batch Anchor, Sankey, Trail

> **Status: IMPLEMENTED** (2026-06-11, branch `feat/chain-of-custody-views`) —
> shipped per the Phase 3 sketch below; see `docs/chain-of-custody.md` for the
> as-built reference. Originally planned via a grilling session against the Maji
> concept canvas (external design reference, not checked into the repo —
> five chain-of-custody treatments + map styles). Sequenced **after**
> map-integration Phase 2
> (`2026-06-10-map-integration.md`) lands — everything Phase 2 builds
> becomes this plan's drill-down level unchanged. Anchor decision:
> [ADR 0011](../adr/0011-credit-batch-anchored-chain-of-custody.md).
> Canonical terms (**rollback**, **roll-up**, **Trail**, **mass balance**,
> **conversion loss**): CONTEXT.md → Provenance & lineage.

## Goal

Re-anchor the chain-of-custody page on the **credit batch** — the unit
whose provenance verification actually cares about — and add two new
readings of the same lineage: a **mass-balance Sankey** (batch level) and
a **Trail** (application level, dated steps + attesting evidence). The
single application's rollback (today's entire page) becomes the
drill-down.

## Resolved decisions (grilling session 2026-06-11)

1. **Credit batch is the primary anchor; application is the drill-down**
   (ADR 0011). The batch **roll-up** = member applications' rollbacks
   merged, runs deduped, applied-biochar scoped — resolved by reusing the
   certification path (`certify-context-core.ts` →
   `getChainOfCustodyData` per application → `buildMassAccounting`), not
   a new traversal. Production-run (forward) anchor rejected for now.
2. **Readings split by scale.**
   - *Batch level:* **DAG** (merged fan-out, default) · **Map** (Phase 2
     transit map fed N geo payloads) · **Sankey** (mass balance).
   - *Application drill-down:* **DAG · Map · Split** (Phase 2, unchanged)
     + **Trail**.
   - *Skipped:* the radial treatment (same data as the Sankey, less
     precise) and a batch-level Trail (a merged evidence list is noise at
     that scale).
3. **The Sankey is an honest dry-mass balance** — one unit (dry kg) end
   to end: Feedstock → Production runs → Biochar lots → Applied. Every
   loss is an explicit labeled exit, never hidden by normalizing column
   widths (the concept mock draws all columns at width 100 — we don't):
   - **ineligible feedstock** exits column 1 (red — the >25% Isometric
     cap made visible; `creditBatches.ineligibleFeedstockMassKg`);
   - **conversion loss** (pyrolysis syngas/vapour/ash — expected physics,
     not an error) exits after the runs;
   - in-storage / undelivered lot mass exits before "Applied".
   The terminal node is the batch's applied mass; net tCO₂e is a label,
   not a ribbon.
4. **Trail = one merged reading, not two.** The concept's "pipeline"
   (dates) and "attestation ledger" (evidence) are the same vertical step
   list; noma renders one: each custody step with its date and what
   attests it — linked documents (polymorphic `documents` by
   entityType/entityId: weigh tickets, COAs, lab reports, photos),
   production-run samples, mass figures, and `distanceSource` provenance
   on transport legs. Step dates already exist in `ChainOfCustodyData`;
   the evidence join is the new data-access work.
5. **Dual header selector** — the page search accepts a credit batch *or*
   an application (shared `EntitySelect` supports both). Batch →
   roll-up views; application → straight to drill-down. Keeps unbatched
   applications (pre-assembly QA) reachable; `?batch=` / `?application=`
   deep links both work. No synthetic "unbatched" pseudo-batch.
6. **Sequencing** — Phase 2 lands first on its own anchor; this work is
   **Phase 3** on a fresh branch. On ship: update
   `docs/chain-of-custody.md` + the CLAUDE.md Chain of Custody section
   (both still say application-first).

## Concept-canvas treatment mapping

| Concept | Verdict | Where |
|---|---|---|
| 01 Sankey volume flow | Adopted, as honest mass balance | Batch view |
| 02 Node-link network | Covered by merged DAG + transit map | Batch view |
| 03 Pipeline/timeline | Merged into **Trail** | App drill-down |
| 04 Attestation ledger | Merged into **Trail** | App drill-down |
| 05 Radial batch lineage | Skipped (Sankey carries the numbers) | — |
| Map stylings | Already adopted in Phase 2 design reference | Both |

## Phase 3 sketch (layered, after Phase 2 ships)

1. **Data access** — `getCreditBatchChainData(userId, creditBatchId)`:
   member applications via `credit_batch_applications`, each through the
   existing `getChainOfCustodyData`, merged + run-deduped (mirror
   `buildMassAccounting` attribution). Sankey aggregates from the same
   payload (per-step dry-kg sums + the three exit figures). Trail
   evidence resolver: documents + samples + transport-leg provenance for
   one application's lineage entities.
2. **fn / hooks** — standard `ActionResult` wrappers + React Query hooks
   (`use-chain-of-custody.ts` grows batch + trail queries).
3. **Components** — dual selector; batch segment `DAG | Map | Sankey`;
   drill-down segment `DAG | Map | Split | Trail`; Sankey in the Maji
   visual language (square corners, mono-uppercase column heads, token
   colors per `2026-06-10-map-integration.md` → Design reference).
4. **E2E** — batch roll-up render (shared-run dedupe visible), dual
   selector + deep links, Sankey exit labels, Trail evidence rows;
   hermetic per the `@live` split.

## Out of scope (recorded, not built)

- **Facility-wide monitoring dashboard / live map / public showcase**
  (concept canvas "Monitoring Dashboard", "Live MapLibre Map") — future
  direction only; dated entry in `docs/open-questions.md`
  (`coc/facility-dashboard`).
- **Production-run forward trace** ("where did this run's biochar go") —
  rejected anchor, revisit on operator demand (ADR 0011).
- Radial treatment, batch-level Trail (see decisions 2 and 4).
