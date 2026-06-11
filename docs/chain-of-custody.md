# Chain of Custody

The chain-of-custody page is now application-first.

Users select a single application and the page renders the upstream rollback path to the originating feedstock batches:

```text
Feedstock(s) + Reactor -> Production Run -> Biochar Product -> Order -> Delivery -> Application
```

If a link is missing, the page still renders the available lineage and shows a warning card explaining where the rollback stops.

## What The Page Does

- Lets the user search for an application directly from the page header.
- Resolves the facility from the selected application instead of requiring a facility-first graph.
- Renders one React Flow lineage graph for that application.
- Supports multiple feedstocks branching into the same production run.
- Keeps node links back to the relevant entity index pages.

## Architecture

| Layer | File | Purpose |
|-------|------|---------|
| Data Access | `src/data-access/chain-of-custody.ts` | Resolves upstream lineage for one application |
| Server Action | `src/fn/chain-of-custody.ts` | Validates the application id and returns lineage data |
| React Query Hook | `src/hooks/use-chain-of-custody.ts` | Caches lineage responses by application id |
| Selector Search | `src/data-access/entities.ts` | Adds `application` support to the shared `EntitySelect` |
| Components | `src/components/chain-of-custody/` | Application selector, lineage nodes, graph layout |
| Route | `src/app/(app)/chain-of-custody/page.tsx` | Page entry point |

## Graph Behavior

- `Feedstock` nodes show feedstock type, supplier, inbound delivery, and consumed mass.
- `Production Run` shows run date plus feedstock and biochar dry mass.
- `Biochar Product`, `Order`, `Delivery`, and `Application` show record-level details rather than aggregate counts.
- `Reactor` is shown as a sibling upstream input into the production run.

## Carbon Viewer — "Geography: carbon in transit"

The page has a Lineage / Map / Split view segment (persisted in `?view=`,
lineage is the default). The DAG stays the *logical lineage* tool; the
MapLibre map is the *geography* tool (plan decision 6,
`docs/plans/2026-06-10-map-integration.md`).

- **Geo payload** — `src/data-access/chain-of-custody-geo.ts` reuses the same
  lineage resolution and returns per node `lat`/`lng` with a position source
  (`own` GPS → inbound-leg origin for feedstocks → facility-inherited →
  none), plus the chain's transport legs with endpoint identity, stored
  `distanceKm`, `distanceSource`, and `isDerived`.
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
`tests/e2e/carbon-viewer.spec.ts`, and
`src/components/chain-of-custody/map/viewer-utils.test.ts` (vitest).

Coverage includes:

- Empty state before an application is selected
- Selecting an application through the shared entity selector
- Opening the page directly with an `application` query parameter
- Rendering the rollback graph through feedstock and reactor nodes
- Verifying node link targets
- View segment toggling + URL persistence (lineage / map / split)
- Transport-legs and not-geolocated rails, legend, nothing-to-plot state
- Split-view cross-link highlighting (chips → DAG, cards locate not navigate)
- Leg endpoint resolution, arc fallback, and chip staggering (unit)
