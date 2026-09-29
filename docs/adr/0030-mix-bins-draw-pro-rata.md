# Mix bins draw every batch pro-rata

**Status: Accepted** (2026-09-28; not implemented). [Plan](../plans/2026-09-28-split-and-mix-bins.md). Builds on [ADR 0029](./0029-output-bin-stock-is-dry-biochar-drawn-fifo.md).

Some yards keep biochar or product as one well-mixed pile rather than separate bays. FIFO attribution is wrong for such a pile: a loader takes material from every batch at once. An output bin can therefore be set to **Mix**, and a mix bin conserves the same dry biochar per layer as ADR 0029 but draws it differently.

## Decision

- Stock mode is a property of the output bin, chosen at creation (default Split). Split to Mix is a timed merge event that changes no posted allocation. Mix to Split requires an empty bin, because a mixed pile can't be separated back into batches.
- Every removal from a mix bin (delivery, loss, count difference, product-creation draw) takes each eligible layer in proportion to its remaining solids at the removal's time. Allocations, run shares, gram closure and saved-history rules are ADR 0029's.
- The pile has one estimated moisture. A measured reading sets it: wet estimate = solids ÷ (1 − reading). An addition adds its own recorded wet mass and solids. A pro-rata removal leaves it unchanged. Dry biochar never moves with moisture.
- Every removal carries a measured moisture reading (required, never prefilled). The estimate is shown as a hint and triggers an advisory warning beyond a configured gap.
- Event order within a day matters, so output stock events carry date and time. An entry timed before an already-posted removal leaves that removal's saved shares unchanged; the operator is warned which removals were calculated without it.
- The UI shows the pile as one box; batch shares stay in the ledger and in Detailed views.

## Consequences

Provenance stays exact per production run, so deliveries, applications and credit batches need no change. The dry total of every removal comes from its own weight and reading. Pro-rata only decides which batches it is attributed to, which is why a backdated entry can be left unreplayed.

Registry basis (pinned v1.1): the protocol allows C_biochar "for either a blend of biochars (Storage Batch), or for individual Production Batches", and the Agricultural Soils module requires projects to "demonstrate the degree of homogeneity within a single Storage or Production Batch". The PDD must describe the mixing practice, how homogeneity is shown, pro-rata attribution, and the moisture-reading method before mix-bin removals support credits. This is an internal method, not a claim of registry approval.
