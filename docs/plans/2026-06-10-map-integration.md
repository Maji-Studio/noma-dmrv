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
   (`map_estimate` | `manual` | `document`) wherever a distance can be
   written — `suppliers`, `customer_locations`, `transport_legs` — and is
   **inherited by a derived leg** from its supplier/customer default. A
   CALC'd value → `map_estimate`; a hand-typed override → `manual`.
   Orthogonal to a leg's `isDerived` flag.
3. **The transport leg is downstream plumbing.** The operator-facing
   distances are `suppliers.distanceToFacilityKm` and
   `customer_locations.distanceFromFacilityKm`; the derived
   `transport_legs.distanceKm` (Isometric Transportation v1.1 Eq. 3 carrier)
   inherits distance **and** source automatically. CALC's primary home is
   therefore the **supplier** and **customer-location** forms; the leg's own
   origin/destination pickers + CALC are the secondary case (biochar/sample
   legs with no anchor, multi-hop routes, explicit overrides).
4. **Provider stack is deliberately swappable** (ADR 0009): MapLibre GL JS
   renderer, MapTiler basemap behind one config constant, OpenRouteService
   geocoding/routing behind a server-side `src/lib/geo/` interface. Mapbox is
   a documented escape hatch — but its TOS restricts persistently caching
   Directions/Geocoding results, which would force a rethink of the viewer's
   route cache.
5. **Graceful degradation:** no routing key → CALC disabled (explanatory
   tooltip), map still renders, manual lat/lng entry still works.
6. **Two complementary, linked views.** The existing `@xyflow/react` + Dagre
   DAG stays the *logical lineage* tool; the new MapLibre view is the
   *geography* tool. Both read the same `data-access/chain-of-custody.ts`
   resolver. Clicking a lineage node highlights it on the map.
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

## Phase 1 — `PositionPicker` + CALC (the 90%, ships independently)

Follows the standard layered checklist (schemas → db → data-access → fn →
hooks → components → route → e2e).

1. **Env** (`src/config/env.ts`, Zod; document names only):
   - `OPENROUTESERVICE_API_KEY` — **optional, secret** (server-only).
   - `NEXT_PUBLIC_MAPTILER_KEY` — public, domain-locked (browser-safe).
   - Sourced from 1Password like every other env.
2. **Schema** (`src/db/schema/`) — add `distanceSource` enum column to
   `suppliers`, `customer_locations`, `transport_legs`. **Reseed, not
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
   - Customer-location form → **selected facility** ↔ location point →
     `distanceFromFacilityKm`.
   - Transport-leg form → leg `origin` ↔ leg `destination` → `distanceKm`.
8. **Wire in:**
   - *Tier 1:* facility form (`PositionPicker`), supplier form
     (`PositionPicker` + CALC), customer-location form (`PositionPicker` +
     CALC).
   - *Tier 2:* transport-leg form (2× `PositionPicker` + CALC); plain
     `PositionPicker` (no CALC) on feedstock, feedstock-delivery,
     application, soil-temp measurement.
9. **Derive path** — copy `distanceSource` alongside the distance into
   auto-derived legs so an inherited map estimate is not silently downgraded
   to `manual`.
10. **E2E** (`tests/e2e/position-picker.spec.ts`) — address geocode, map
    click, manual entry, CALC fill + override; no-key disabled state.

## Phase 2 — "Carbon in Transit" geographic viewer (later)

- New MapLibre route reading the **existing** chain-of-custody resolver.
  Points from the GPS coords Phase 1 captures.
- **Real road polylines** via ORS, computed at viewer-time and **cached**
  (keyed by origin + destination + routing profile — a small route-cache
  table or the runtime cache). Straight dashed fallback per-leg when an
  endpoint is missing.
- **"Not geolocated → inherits facility"** resolution rule: chain nodes
  without their own GPS (reactor, production run, biochar product, order,
  delivery) resolve to their facility's coordinates, surfaced in a dedicated
  panel. Per the agreed mockup.
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
