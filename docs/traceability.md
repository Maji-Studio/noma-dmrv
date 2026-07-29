# Traceability

How the Traceability page resolves and renders chain-of-custody: the credit-batch
roll-up, the single-application drill-down, and the DAG / Map / Sankey / Trail
readings. Read this before touching anything under
`src/data-access/chain-of-custody*`, `src/lib/chain-of-custody/`, or
`src/components/chain-of-custody/`. For "why credit-batch anchored" see
[ADR 0011](adr/0011-credit-batch-anchored-chain-of-custody.md).

## Chain and membership

```text
Feedstock(s) + Reactor -> Production Run -> Biochar Product -> Order -> Delivery -> Application
                            ^ (× N members)
                        Credit Batch
```

**Credit-batch membership is by production run** (`credit_batch_production_runs`),
never by application — a credit batch is a production cohort
([ADR 0014](adr/0014-credit-batch-as-production-cohort.md),
[ADR 0016](adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)).
Applications are derived *downstream* from the member runs. Querying
application → batch directly gives the wrong set.

If a link is missing the page still renders the available lineage and shows a
warning card explaining where the rollback stops.

## Invariants

- **All credit-batch lineage reads go through `loadCreditBatchLineageFacts`**
  (`src/data-access/credit-batch-lineage-facts.ts`) — three set-based queries
  regardless of batch/application count, shared by `chain-of-custody-batch.ts`,
  `chain-of-custody.ts`, `credit-batches.ts`, `credit-batch-previews.ts`,
  `credit-batch-production-runs.ts`, and `fn/certification/certify-context-core.ts`.
  A new per-batch resolver reintroduces N+1 and desyncs the page from certification.
- These data-access modules guard with `requireOrgScope(ctx)` (org-scoped tenancy,
  [ADR 0010](adr/0010-shared-schema-org-column-tenancy.md)) — **not** the route-level
  `requireAuth()` — and **every** join predicate, leftJoins
  included, additionally carries `eq(<table>.organizationId, ctx.organizationId)`.
  Omitting the per-join org predicate is the default mistake here.
- Production-run dates come from `productionRunDateExpr()`
  (`src/data-access/production-runs/date-expr.ts`), not a raw column. New lineage
  queries that skip it sort and display inconsistently with the rest of the app.
- `src/lib/chain-of-custody/sankey.ts` must stay pure and dependency-light — no
  data-access, no `"use server"` imports — so it stays unit-testable. Its narrow
  structural params exist for that reason; widening them to DA row types breaks
  the contract.
- `buildBatchSankey` mirrors `buildMassAccounting`'s walk but keeps **full** run
  masses rather than attribution fractions — the exits, not fractions, account for
  mass that never reached this batch's applications. Not interchangeable.

## Anchors and readings

Header: **credit batch selection cards** plus a **production-run filter** whose
options derive from the loaded batch's lineages, never an unscoped fetch. The run
filter narrows the whole roll-up (DAG, Map, and a client-side recomputed Sankey —
every figure derives from the filtered lineages) and deep-links as `?run=`.

Batch selection is remembered per facility in localStorage under
`noma:traceability:selected-credit-batch:<facilityId>` (`creditBatchStorageKey`),
with resolution precedence `url → application → remembered → first → none`
(`CreditBatchSelectionSource`, `use-credit-batch-card-selection.ts`). Stale
remembered ids fall through; standalone `?application=` deep links stay
application-only. With both `?batch=` and `?application=` the page is a drill-down
inside batch context, with a "Batch roll-up" button back.

- **Credit batch (roll-up)** — segments `DAG | Map | Sankey`:
  - **DAG** — member runs' lineages merged into one fan-out; nodes/edges dedupe by
    id so a shared production run appears once. Application cards drill down
    instead of navigating.
  - **Map** — the merged geo payload (nodes/legs deduped the same way).
  - **Sankey** — honest dry-mass balance, dry kg end to end, every loss an explicit
    labeled exit; no net-tCO₂e, since project emissions/counterfactual are
    registry-owned ([ADR 0018](adr/0018-isometric-owns-project-emissions.md)). Exit
    taxonomy and residual clamping: the header of
    `src/lib/chain-of-custody/sankey.ts`. Rendered on a React Flow canvas; clicking
    a column or exit opens a tooltip with a "See details" link to the backing
    entity route — the Sankey doubles as navigation.
- **Application (drill-down)** — segments `Lineage | Map | Split | Trail`:
  - **Trail** — each custody step with its date, mass figure, and what attests it:
    linked documents (polymorphic `documents` — weigh tickets, COAs, lab reports,
    photos), production-run samples, and transport-leg `distanceSource` provenance
    (leg-attached documents nested).

## Architecture

| Layer | File | Purpose |
|-------|------|---------|
| Data Access | `src/data-access/credit-batch-lineage-facts.ts` | Shared set-based loader; every batch lineage read goes through it |
| Data Access | `src/data-access/chain-of-custody.ts` | Upstream lineage for one application |
| Data Access | `src/data-access/chain-of-custody-batch.ts` | Batch roll-up — projects from facts (`projectChainOfCustodyFromBatchFacts`), does not resolve lineage itself |
| Data Access | `src/data-access/chain-of-custody-geo.ts` | Geo payload (node coordinates + transport legs) |
| Data Access | `src/data-access/chain-of-custody-trail.ts` | Trail evidence joins keyed by DAG node id |
| Pure lib | `src/lib/chain-of-custody/sankey.ts` | `buildBatchSankey` — dedupe + mass-balance aggregation |
| Server Action | `src/fn/chain-of-custody.ts` | Validates ids; application, batch, batch-geo, trail actions |
| React Query Hook | `src/hooks/use-chain-of-custody.ts` | Caches by application / batch id |
| Batch List | `src/hooks/use-credit-batches.ts` | Facility-scoped, newest-first cards query |
| Components | `src/components/chain-of-custody/` | Page, selector, run filter, DAG, `sankey/`, `trail/`, `map/` |
| Route | `src/app/(app)/traceability/page.tsx` | Canonical entry; legacy `/chain-of-custody` redirects here with query string intact |

## Graph behavior

Nodes are auto-laid-out with **Dagre left-to-right** (`@dagrejs/dagre` in
`use-chain-graph.ts`) on a React Flow canvas. Card styling, accents, canvas wash
and grid constants live in `src/components/chain-of-custody/chain-constants.ts`;
token and contrast rules are owned by [docs/design-system.md](design-system.md).

- **Edges carry the mass moving along them** and the mass chip hides below
  `EDGE_LABEL_MIN_ZOOM` — zoomed out the flow reads as shape, quantities arrive as
  you move in. Per-step CO₂e is never shown (ADR 0018).
- **Focus** is cross-surface (bar ⇄ map ⇄ DAG selection *and* DAG hover): the
  focused node's full connected lineage — ancestors + descendants via
  `reachableNodeIds` — stays full strength, everything else dims.
- `Biochar Product` shows the unsold remainder ("N kg in storage") when its mass
  exceeds the rollback's ordered quantity.
- MiniMap gotcha: nodes must carry `initialWidth`/`initialHeight` so the MiniMap
  can size them — React Flow never writes `measured` back onto user nodes.

## Carbon Viewer — "Geography: carbon in transit"

The map view (both anchors) renders the Carbon Transit panel. The DAG is the
*logical lineage* tool; the MapLibre map is the *geography* tool.

- **Two layouts, one fetch** — `view="map"` pairs the custody stages rail
  (`custody-stages-rail.tsx`: three milestones — feedstock in / pyrolysis /
  application out — on a dashed thread, transport legs as sub-rows, a "Not on
  the map" cluster for anything unplottable) with the map, and docks a clicked
  record's details over the map's left edge (`record-detail-panel.tsx`, closed
  only by its own X). `view="split"` is the compact half beside the DAG and
  keeps the legend plus the collapsed not-geolocated chip box.
- **Geo payload** — `chain-of-custody-geo.ts` reuses the same lineage resolution;
  node position source falls back `own` GPS → inbound-leg origin (feedstocks) →
  facility-inherited → none.
- **Route lines** — road polylines from OpenRouteService, cached read-through in
  `geo_route_cache` (`src/data-access/geo-route-cache.ts`, keyed by rounded
  endpoints + profile); see
  [ADR 0009](adr/0009-provider-agnostic-server-proxied-geo.md). Legs without
  geometry draw a dashed bowed arc. **The polyline is illustrative — distance chips
  always show the leg's stored `distanceKm`, never the polyline length.**
- **Cross-linking** — split-view DAG card clicks locate the record on the map (links
  disabled there); marker / rail / chip clicks ring-highlight the DAG card.
- **Degradation** depends on two independent env vars, both declared in
  `src/config/env.ts` (see [docs/security.md](security.md)): no
  `NEXT_PUBLIC_MAPTILER_KEY` → blank style over a sea-tinted dotted field, markers
  and legs still plotted (the satellite raster is key-independent, so SAT keeps
  working) with a "basemap unavailable" note; no `OPENROUTESERVICE_API_KEY` → all
  legs draw as dashed arcs and address search is disabled. No WebGL context → an
  explicit "map unavailable" notice with the rails still rendered.

Map components live in `src/components/chain-of-custody/map/`; the shared
brand-recolored basemap treatment is `src/components/map/` (also used by
`PositionPicker`).

## Testing

See [docs/testing.md](testing.md) for fixtures and E2E conventions. Suites:

- `tests/e2e/traceability.spec.ts`, `tests/e2e/carbon-viewer.spec.ts`
- `src/lib/chain-of-custody/sankey.test.ts`
- `src/components/chain-of-custody/use-chain-graph.test.ts`
- `src/components/chain-of-custody/use-credit-batch-card-selection.test.ts`
- `src/components/chain-of-custody/map/viewer-utils.test.ts`
