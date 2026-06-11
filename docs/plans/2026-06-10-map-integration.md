# Map Integration — Address / Point / Lat-Lng Input, Auto-Distance, Carbon Viewer

> **Status: Planned** (2026-06-10). Output of a grilling session against the
> existing geographic substrate (GPS columns on 9+ entities, three distance
> fields, the polymorphic `transport_legs` table, GPS Zod helpers). Decision
> rationale for the provider boundary lives in
> [ADR 0009](../adr/0009-provider-agnostic-server-proxied-geo.md).

## Goal

Let an operator set a geographic position three interchangeable ways — type
an address, click/drag a point on a map, or enter lat/lng — with a map
**preview to confirm**, and have the resulting coordinates land in the form.
Auto-compute road distance between two points via a **CALC** button next to
the distance field. Later, a geographic **carbon-in-transit viewer** that
draws the routes between chain-of-custody points.

## Resolved decisions

1. **Routed distance is an *estimate*, not a measurement.** An
   OpenRouteService road distance is modeled from a road graph — a
   *suggested default*, always operator-editable, in the same
   measured-vs-derived family as an *emission estimate*. Document-backed
   distances (bill of lading, weigh ticket) remain the authoritative form.
   We submit distance-based to Isometric regardless (the only method
   implemented).
2. **Distance provenance is tracked** via a `distanceSource` enum
   (`map_estimate` | `manual` | `document`) on **every surface where a
   distance can be written**: `suppliers.distanceToFacilityKm`,
   `supplier_locations.distanceFromFacilityKm`,
   `customer_locations.distanceFromFacilityKm`,
   `deliveries.distanceKmOverride`, and `transport_legs.distanceKm`. The
   feedstock form's `transportDistanceKm` is transient (not a column — it
   flows into `syncFeedstockTransportLeg`); its provenance is captured on
   the derived leg at sync time. A derived leg **inherits the source of
   whichever distance won** the priority resolution (decision 3), not a
   blanket supplier/customer default. A CALC'd value → `map_estimate`; a
   hand-typed override → `manual`. Orthogonal to a leg's `isDerived` flag.
3. **The transport leg is downstream plumbing — and Phase 1 absorbs the
   deferred distance-priority rule.** Derivation today reads only the
   supplier-level distance (`data-access/feedstocks.ts`,
   `syncFeedstockTransportLeg`) and the customer-location distance
   (`data-access/transport-legs.ts`, `syncBiocharProductTransportLeg`),
   ignoring the per-location and per-delivery values — exactly the gap
   recorded in `docs/open-questions.md` →
   `parties/distance-derivation` (2026-06-10). Phase 1 resolves it with
   **source-aware priority resolution**:
   - *Feedstock side:* feedstock-form `transportDistanceKm` override →
     supplier location (default) `distanceFromFacilityKm` → supplier-level
     `distanceToFacilityKm`.
   - *Distribution side:* `deliveries.distanceKmOverride` → destination
     customer location (default) `distanceFromFacilityKm`.

   The derived `transport_legs.distanceKm` (Isometric Transportation v1.1
   Eq. 3 carrier) inherits distance **and** `distanceSource` from the
   winning level. This touches credit math, so it gets its own review +
   e2e coverage inside Phase 1; on completion, remove the open-questions
   entry and record the decision per docs standards. CALC's primary home
   is the **supplier**, **supplier-location**, and **customer-location**
   forms; the leg's own origin/destination pickers + CALC are the
   secondary case (biochar/sample legs with no anchor, multi-hop routes,
   explicit overrides).
4. **Provider stack is deliberately swappable** (ADR 0009): MapLibre GL JS
   renderer, MapTiler basemap behind one config constant, OpenRouteService
   geocoding/routing behind a server-side `src/lib/geo/` interface. Mapbox is
   a documented escape hatch — but its TOS restricts persistently caching
   Directions/Geocoding results, which would force a rethink of the viewer's
   route cache.
5. **Graceful degradation — both geo keys are `optional()` in the env
   schema.** `src/config/env.ts` parses at import time, so a *required*
   key would break every command (build, db scripts, e2e) in any
   environment not yet updated; neither key may ever hard-fail
   validation. Degradation is gated where the feature renders, not at
   parse time:
   - No `OPENROUTESERVICE_API_KEY` → CALC + address search disabled
     (explanatory tooltip); map preview and manual lat/lng still work.
   - No `NEXT_PUBLIC_MAPTILER_KEY` → no basemap; `PositionPicker` falls
     back to manual lat/lng inputs with a "map preview unavailable"
     notice. Nothing else in the app is affected.
6. **Two complementary, linked views.** The existing `@xyflow/react` + Dagre
   DAG stays the *logical lineage* tool; the new MapLibre view is the
   *geography* tool. They share lineage *resolution logic*, but the current
   `ChainOfCustodyData` payload carries **no coordinates, transport legs,
   or endpoint identities** — Phase 2 therefore defines an explicit **geo
   payload contract** (see Phase 2) rather than assuming the existing
   payload suffices. Clicking a lineage node highlights it on the map.
7. **Road geometry is computed + cached at viewer-time** (Phase 2 only).
   Phase 1 stores no geometry. The polyline is *illustrative*; the carbon
   number stays the leg's stored `distanceKm`. Legs missing an endpoint fall
   back to a straight dashed line.

## Naming

- **`PositionPicker`** — the reusable control. Avoids collision with the
  `customer_locations` / `supplier_locations` *entities* ("Location" is
  taken). Captures a *Position* (lat/lng + optional resolved-address label).
  Owns lat/lng **only** — it never overwrites the entity's `address` field
  (forward-geocode *from* an address is a read; reverse-geocode is shown as a
  read-only confirmation label, not written back).

---

## Design reference — Carbon Viewer concept build (2026-06-11)

The approved visual direction for all map surfaces is the **"Geography —
carbon in transit"** panel in the Maji concept build
([claude.ai design share](https://claude.ai/design/p/8a4ac6b1-acb1-448a-8b35-18dd6bc9f65d),
exported locally to `~/Downloads/Maji noma dMRV/` — key files:
`Noma Carbon Viewer.html`, `cv-map.js`, `carbon-viewer.css`, `theme.css`).
This section distills it so the doc stands alone if the export disappears.

### Token mapping (concept → project `globals.css`)

Every concept color already exists as a project token — **use the tokens,
never the hex values**:

| Concept | Hex (light) | Project token | Used for |
|---|---|---|---|
| `--acc-prod` | `#FF8359` | `--clr-orange` | supplier markers, inbound legs |
| `--acc-infra` | `#480B73` | `--clr-purple` | facility marker |
| `--acc-dist` | `#A6216E` | `--clr-pink` | field markers, outbound legs |
| `--st-bad` | `#E54552` | `--clr-red` | broken-chain warning |
| `--ink` | `#0F021A` | `--clr-dark-purple` | borders, dash overlay, text |
| map land | `#FFFFFF` | paper/white | basemap landmass |
| map bg | `#FBF2ED` | (orange-tint paper) | basemap sea/background |

Note: the concept uses `--clr-pink` (#A6216E) for distribution accents on
light backgrounds — darker than the `--clr-rose` (#FFB2D2) the existing CoC
DAG uses (`chain-constants.ts`) — because rose fails contrast on white. On
the map, follow the concept: **pink on light, rose reserved for dark/sat**.

### Basemap treatment

- MapLibre GL with a **brand-recolored minimal basemap**: white land on the
  orange-tinted paper field, hairline plum country boundaries
  (`rgba(15,2,26,0.3)`) — all place labels and graticules hidden. The map
  reads as a diagram, not a road map.
- **SAT toggle**: Esri World Imagery raster, desaturated
  (`raster-saturation: -0.4`), label/halo colors flip to white-on-plum.

### Markers (DOM markers, not symbol layers)

- Supplier = **12px square** (orange) · application field = **12px diamond**
  (rotated square, pink) · facility = **18px square with punched-out
  center** (purple). Square corners everywhere — brutalist.
- Hover/highlight: 1.5px accent **outline ring** (26px), soft pulse when
  cross-link-highlighted.
- Each marker carries a side label: mono uppercase 10px entity code +
  8.5px sub (place name), with a **paper text-shadow halo** for legibility
  over the basemap.

### Route arcs ("carbon in transit")

- Legs are **gently bowed quadratic-bezier arcs** (not straight lines):
  suppliers fan **into** the facility, facility fans **out** to fields.
- Two line layers: a colored base line (inbound = orange, outbound = pink,
  1.6px @ 0.85 opacity) **plus an animated marching-ants dash overlay** in
  ink that conveys flow direction (dasharray cycled on an interval).
- **Distance chips at the arc apex** (mono `41 KM`, paper halo), staggered
  along neighbouring arcs so they don't collide.

### Panel chrome & overlays

- The map sits in a standard `panel`: 1.5px ink hairline border, square
  corners, mono-uppercase `panel-title` head ("Geography — carbon in
  transit") with a right-aligned hint label.
- **Zoom control**: vertical stack of 36px square buttons (`+ − fit SAT`),
  hairline-bordered, hover inverts to ink-on-paper. Top-left on the map.
- **Legend** (bottom-left) and **side rails** (right, map view only): boxes
  of `rgba(255,255,255,0.94)` + `backdrop-filter: blur(8px)`, hairline
  border. Legend rows are mono-uppercase 9.5px with a 9px color swatch that
  mirrors the marker shape (square for supplier/facility, rotated-diamond
  for field): "Supplier · feedstock origin" / "Facility · pyrolysis hub" /
  "Application field · stored". Rails: a **Transport legs** list (per-leg dot · `from → to` ·
  kind sublabel · km; footer: "Distance drives transport emissions in the
  carbon accounting") and a **Not geolocated** list ("`<TYPE>` · no GPS —
  inherits facility"). In split view these collapse to a chip box.
- **Popups are the node card restyled**: 246px, 1.5px ink border + 3px
  accent left border, translucent blurred bg, header (icon + mono type +
  outlined status pill), large mono code, label/value rows. MapLibre popup
  chrome (tip/radius/shadow) fully stripped. Hover opens, click pins.
- **Warning banner** (broken chain): 1.5px *dashed* red border, mono
  uppercase red text, e.g. "Feedstock origins unknown — … upstream legs
  cannot be plotted."
- **Empty state**: centered thin-weight (~100) headline ("Nothing to
  plot.") + mono-uppercase sub + small CTA.
- **Cross-linking** (matches decision 6): DAG card click → map marker
  highlight + ease-to (ungeolocated nodes resolve to the facility marker);
  marker click → DAG highlight; view segment Lineage / Map / Split.

### Applies to Phase 1 too

`PositionPicker`'s map preview uses the same recolored-basemap treatment,
square marker, hairline panel chrome, and mono-uppercase microcopy — it
should look like a small crop of the Carbon Viewer map.

---

## Phase 1 — `PositionPicker` + CALC (the 90%, ships independently)

Follows the standard layered checklist (schemas → db → data-access → fn →
hooks → components → route → e2e).

1. **Env** (`src/config/env.ts`, Zod; document names only):
   - `OPENROUTESERVICE_API_KEY` — **optional, secret** (server-only).
   - `NEXT_PUBLIC_MAPTILER_KEY` — **optional**, public, domain-locked
     (browser-safe).
   - Both `optional()` — env parses at import time; a missing geo key must
     never fail validation (decision 5). Sourced from 1Password like every
     other env.
2. **Schema** (`src/db/schema/`) — add `distanceSource` enum column to
   `suppliers`, `supplier_locations`, `customer_locations`, `deliveries`
   (qualifies `distanceKmOverride`), and `transport_legs`. **Reseed, not
   migrate** (pre-production). Export types; add nothing to `address`
   handling.
3. **`src/lib/geo/`** — server-side client behind an interface:
   `geocode(address)`, `reverseGeocode(lat, lng)`, `routeDistanceKm(a, b)`.
   ORS adapter. Instrumented with `@/lib/log`; logs entity IDs + action,
   **never the address string or coordinates** (PII). Throttled via
   `src/lib/rate-limit/`.
4. **`src/fn/geo/`** — `"use server"` actions wrapping the client, Zod-
   validated, `ActionResult<T>`, auth-guarded.
5. **`src/hooks/use-geo.ts`** — React Query wrappers (geocode search, route
   distance). One hook file, per project convention.
6. **`src/components/forms/position-picker/`** — three converging input
   modes over a MapLibre preview: address search → geocode, map click/drag
   marker, manual lat/lng. Read-only resolved-address confirmation label.
   Outputs lat/lng. Reuses `latitudeSchema`/`longitudeSchema` from
   `@/schemas/helpers`. Design tokens; 44×44 touch targets; keyboard nav.
   Map source = the swappable config constant.
7. **Distance + CALC split field** — number input with an inline CALC
   button. Enabled only when **both endpoints have coords AND a key is
   configured**; otherwise disabled with a tooltip naming what's missing.
   Success → fills the distance, sets `distanceSource = map_estimate`, stays
   editable (override flips source to `manual`). CALC endpoint resolution:
   - Supplier form → supplier point ↔ **selected facility** (facility
     context) → `distanceToFacilityKm`.
   - Supplier-location form → location point ↔ **selected facility** →
     `distanceFromFacilityKm`.
   - Customer-location form → **selected facility** ↔ location point →
     `distanceFromFacilityKm`.
   - Delivery form (override field) → facility ↔ **resolved destination**
     (delivery's own `customerLocationId`, else the order's) →
     `distanceKmOverride`.
   - Transport-leg form → leg `origin` ↔ leg `destination` → `distanceKm`.
8. **Wire in:**
   - *Tier 1:* facility form (`PositionPicker`), supplier form
     (`PositionPicker` + CALC), supplier-location form (`PositionPicker` +
     CALC), customer-location form (`PositionPicker` + CALC).
   - *Tier 2:* transport-leg form (2× `PositionPicker` + CALC); delivery
     form (CALC on the override field, no picker — endpoints come from the
     facility + resolved location); plain `PositionPicker` (no CALC) on
     feedstock, feedstock-delivery, application, soil-temp measurement.
9. **Derive path — source-aware priority resolution** (decision 3).
   Update `syncFeedstockTransportLeg` and `syncBiocharProductTransportLeg`
   (+ `deriveTransportLeg` / `aggregateDistributionLegs`) to resolve
   distance in priority order — feedstock: form override → supplier
   location (default) → supplier-level; distribution: delivery override →
   customer-location default — and to copy the **winning level's**
   `distanceSource` onto the derived leg, so an inherited map estimate is
   not silently downgraded to `manual` and a CALC'd per-location or
   per-delivery distance is never ignored. For the aggregated biochar leg
   (mass-weighted across deliveries), the leg's source is the *weakest*
   contributing source (`manual` if any input is `manual`, else
   `map_estimate`; `document` only if all are `document`). Credit-math
   change → dedicated review + e2e. Resolves the
   `parties/distance-derivation` open-questions entry (remove it; record
   the decision).
10. **E2E** (`tests/e2e/position-picker.spec.ts`) — address geocode, map
    click, manual entry, CALC fill + override; no-key disabled state; and
    the derivation priority order (override beats location beats
    supplier-level, source inherited). **Deterministic by construction —
    no live ORS/MapTiler dependency in PR CI** (which is hermetic, per the
    `@live` split): the `src/lib/geo/` interface gets a **stub adapter**
    (fixed geocode/route fixtures) selected via env (e.g.
    `GEO_PROVIDER=stub` in `.env.test`); basemap tile requests are
    route-stubbed in Playwright (or the no-key fallback path is exercised
    instead). Any spec needing real ORS/MapTiler is tagged `@live` and
    runs only in the nightly workflow.

## Phase 2 — "Carbon in Transit" geographic viewer (later)

- **Explicit geo payload contract.** The existing `ChainOfCustodyData`
  (`data-access/chain-of-custody.ts`) returns no coordinates, transport
  legs, endpoint resolution, or route identifiers — it cannot feed a map
  as-is. Add a geo-extended resolver (extend the interfaces, or a sibling
  `getChainOfCustodyGeoData` reusing the same lineage resolution) that
  returns per node: `lat`/`lng` (own GPS or facility-inherited, with an
  `inheritedFromFacility` flag), plus the chain's `transport_legs` with
  origin/destination endpoint identity, `distanceKm`, `distanceSource`,
  and `isDerived`. Points come from the GPS coords Phase 1 captures.
- **Real road polylines** via ORS, computed at viewer-time and **cached**
  (keyed by origin + destination + routing profile — a small route-cache
  table or the runtime cache). Straight dashed fallback per-leg when an
  endpoint is missing.
- **"Not geolocated → inherits facility"** resolution rule: chain nodes
  without their own GPS (reactor, production run, biochar product, order,
  delivery) resolve to their facility's coordinates, surfaced in a dedicated
  panel. Per the Carbon Viewer concept build (see Design reference above).
- **Transport-legs total** panel (sum + per-leg breakdown, inbound/outbound).
- **Linked selection** with the DAG (click a lineage card → highlight on the
  map).
- Route-geometry caching is introduced **only in this phase** — Phase 1
  persists none.

## Cross-cutting

- **Layering** — never skip layers; `fn/` validates with Zod and returns
  `ActionResult<T>`; geo data-access/client calls are auth-guarded.
- **PII** — the geo client logs entity IDs + action, never addresses or
  coordinates. The logger redaction is a backstop, not a license.
- **No magic numbers** — rate limits, default map center/zoom, ORS profile
  (`driving-car`), tile/style URLs → constants in `@/config`.
- **React Compiler** — no manual `useMemo`/`useCallback`; avoid `useEffect`
  (MapLibre instance lifecycle is the legitimate imperative-DOM exception).

## Out of scope (recorded, not built now)

- Capturing route geometry at CALC time / storing it on the leg.
- Reverse-geocoding writing back into the `address` field.
- Multi-facility supplier distances (stored value stays "to *this*
  facility").
- Mapbox migration (escape hatch only; revisit route caching under its TOS).
