# Chain of Custody

The chain-of-custody page is **credit-batch anchored** (ADR 0011,
`docs/plans/2026-06-11-chain-of-custody-views.md`): the credit batch — the
unit whose provenance verification actually cares about — is the primary
anchor, and the single application's rollback is the drill-down.

```text
Feedstock(s) + Reactor -> Production Run -> Biochar Product -> Order -> Delivery -> Application
                                                                        (× N members) -> Credit Batch
```

If a link is missing, the page still renders the available lineage and shows a
warning card explaining where the rollback stops (batch roll-up prefixes each
warning with the member application's code).

## Anchors and readings

The header carries a **credit batch selector** (shared `EntitySelect`) plus a
**production-run filter** (`RunFilterSelect`) whose options are derived from
the loaded batch's lineages — the runs below the batch, never an unscoped
fetch. The run filter narrows the roll-up (DAG, Map, and a client-side
recomputed Sankey — batch-level facts like ineligible mass and net tCO₂e
don't decompose per run, so the filtered Sankey omits them) and deep-links as
`?run=`. The application drill-down opens by clicking an application card in
the batch DAG or via the `?application=` deep link (so unbatched applications
— pre-assembly QA — stay reachable). With both `?batch=` and `?application=`
present the page is a drill-down inside the batch context and a "Batch
roll-up" button leads back.

- **Credit batch (roll-up)** — view segment `DAG | Map | Sankey`:
  - **DAG** — the member applications' rollbacks merged into one fan-out;
    nodes/edges dedupe by id so a shared production run appears once.
    Application cards drill down instead of navigating.
  - **Map** — the Phase 2 Carbon Transit map fed the merged geo payload
    (nodes/legs deduped the same way).
  - **Sankey** — an honest dry-mass balance, one unit (dry kg) end to end:
    Feedstock → Production runs → Biochar lots → Applied. Every loss is an
    explicit labeled exit, never hidden by normalizing column widths:
    *ineligible feedstock* exits column 1 (red — the >25% Isometric cap made
    visible, `creditBatches.ineligibleFeedstockMassKg`); *conversion loss*
    (pyrolysis syngas/vapour/ash — expected physics) exits at the runs;
    *not bagged into lots* covers output that never reached a lot;
    *in storage / undelivered* exits before "Applied". The terminal node is
    the batch's applied mass; net tCO₂e is a label, not a ribbon.
    Inconsistent residuals clamp to zero and surface as warnings.
    The diagram sits on a React Flow canvas (same zoom/pan/controls chrome as
    the DAG); clicking a column or exit opens an info tooltip (mass, share of
    intake, record count) with a "See details" link through to the backing
    entity route — the Sankey doubles as navigation.
- **Application (drill-down)** — view segment `Lineage | Map | Split | Trail`
  (the Phase 2 page unchanged, plus the Trail):
  - **Trail** — one merged reading of the concept canvas's "pipeline" and
    "attestation ledger": each custody step with its date, mass figure, and
    what attests it — linked documents (polymorphic `documents`: weigh
    tickets, COAs, lab reports, photos), production-run samples, and
    transport-leg `distanceSource` provenance (with leg-attached documents
    nested).

## Architecture

| Layer | File | Purpose |
|-------|------|---------|
| Data Access | `src/data-access/chain-of-custody.ts` | Resolves upstream lineage for one application |
| Data Access | `src/data-access/chain-of-custody-batch.ts` | Batch roll-up: member lineages + merged geo payload + Sankey aggregates |
| Data Access | `src/data-access/chain-of-custody-trail.ts` | Trail evidence joins (documents / samples / leg provenance) keyed by DAG node id |
| Pure lib | `src/lib/chain-of-custody/sankey.ts` | `buildBatchSankey` — dedupe + mass-balance aggregation (unit-tested) |
| Server Action | `src/fn/chain-of-custody.ts` | Validates ids; application, batch, batch-geo, and trail actions |
| React Query Hook | `src/hooks/use-chain-of-custody.ts` | Caches by application / batch id (`trail`, `batch`, `batch-geo` keys) |
| Selector Search | `src/data-access/entities/` | `application` + `creditBatch` support in the shared `EntitySelect` |
| Components | `src/components/chain-of-custody/` | Page, batch selector + run filter (`run-filter-select.tsx`), DAG (`use-chain-graph.ts` incl. `useBatchChainGraph`), `sankey/`, `trail/`, `map/` |
| Route | `src/app/(app)/chain-of-custody/page.tsx` | Page entry point |

## Graph Behavior

- Card hierarchy is **date-first**: the event date is the card's primary line,
  the record code is secondary, then a headline mass stat ("960 kg biochar
  out"), then detail lines. Dateless records (reactors) fall back to the code.
- **Edges are labeled with the mass moving along them** (kg between records,
  t dry into the application), so hand-offs read directly off the graph.
  Per-step CO₂e isn't recorded along the lineage — net removal lives on the
  Sankey's header label.
- `Feedstock` nodes show feedstock type, supplier, inbound delivery, and consumed mass.
- `Production Run` shows feedstock-in and biochar-out dry mass.
- `Biochar Product` shows the unsold remainder ("N kg in storage") when its
  mass exceeds the rollback's ordered quantity.
- `Reactor` is shown as a sibling upstream input into the production run.
- Batch DAG: same node vocabulary; shared upstream entities dedupe by node id.
- MiniMap nodes are tinted by their group accent (nodes carry
  `initialWidth`/`initialHeight` so the MiniMap can size them — React Flow
  never writes `measured` back onto user nodes).

## Carbon Viewer — "Geography: carbon in transit"

The map view (both anchors) renders the Carbon Transit panel. The DAG stays
the *logical lineage* tool; the MapLibre map is the *geography* tool.

- **Geo payload** — `src/data-access/chain-of-custody-geo.ts` reuses the same
  lineage resolution and returns per node `lat`/`lng` with a position source
  (`own` GPS → inbound-leg origin for feedstocks → facility-inherited →
  none), plus the chain's transport legs with endpoint identity, stored
  `distanceKm`, `distanceSource`, and `isDerived`. The batch variant
  (`getCreditBatchChainGeoData`) merges the member payloads, deduped by id.
- **Markers** — facility (purple punched square), feedstock origins (orange
  squares), application field (pink diamond). Records without coordinates
  inherit the facility marker and are listed in the **Not geolocated** rail
  (chip box in split view).
- **Route lines** — real road polylines from OpenRouteService, fetched at
  viewer time and cached in `geo_route_cache` (read-through in
  `src/data-access/geo-route-cache.ts`, keyed by rounded endpoints +
  profile). Legs without resolvable geometry draw a dashed bowed arc. The
  polyline is illustrative — distance chips always show the leg's *stored*
  `distanceKm`, never the polyline length.
- **Cross-linking** — split-view DAG card clicks locate the record on the map
  (links are disabled there); marker / rail / chip clicks ring-highlight the
  DAG card.
- **Degradation** — no `NEXT_PUBLIC_MAPTILER_KEY` or no WebGL context → an
  explicit "map unavailable" notice with the rails still rendered; no
  ORS key → all legs draw as dashed arcs.

Map components live in `src/components/chain-of-custody/map/`; the shared
brand-recolored basemap treatment is `src/components/map/` (also used by
`PositionPicker`).

## Testing

Test files: `tests/e2e/chain-of-custody.spec.ts`,
`tests/e2e/carbon-viewer.spec.ts`,
`src/components/chain-of-custody/map/viewer-utils.test.ts` (vitest), and
`src/lib/chain-of-custody/sankey.test.ts` (vitest).

Coverage includes:

- Batch-selector empty state before an anchor is selected (run filter hidden)
- Selecting a credit batch through the shared entity selector; narrowing by
  production run via the derived run filter (`?run=` URL persistence + clear)
- Opening the page directly with `application` / `batch` query parameters
- Rendering the rollback graph through feedstock and reactor nodes
- Batch roll-up render with shared-run dedupe (one run node, N applications)
- Drill-down from a batch DAG application card and back to the roll-up
- Sankey exit labels and masses (ineligible / conversion loss / in storage)
- Trail steps with attesting documents and production-run samples
- Verifying node link targets
- View segment toggling + URL persistence (lineage / map / split / trail; dag / map / sankey)
- Transport-legs and not-geolocated rails, legend, nothing-to-plot state
- Split-view cross-link highlighting (chips → DAG, cards locate not navigate)
- Leg endpoint resolution, arc fallback, and chip staggering (unit)
- Sankey dedupe, allocation fallback, residual clamping + warnings (unit)
