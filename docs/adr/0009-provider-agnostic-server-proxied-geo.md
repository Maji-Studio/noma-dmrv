# Geocoding and routing are provider-agnostic and server-proxied; the basemap is swappable

> **Status: Accepted** (2026-06-10). Records the integration-boundary
> decision behind the map integration
> (`docs/plans/2026-06-10-map-integration.md`). Narrow: it fixes *where the
> geo calls live, who holds the key, and how the provider stays swappable* —
> not the `PositionPicker` UI or distance semantics, which live in the plan.

## Context

The map feature needs three external capabilities: basemap tiles (rendered
client-side by MapLibre GL JS), forward/reverse geocoding, and road-distance
routing. The obvious one-vendor path is Mapbox — maps, geocoding, and
directions under a single SDK and key, with a free tier that easily covers
this project's low volume.

Two facts pushed against taking it bare. First, the routing/geocoding
provider needs an **API key that is a secret**: if MapLibre or a CALC button
calls it directly from the browser, the key leaks in network traffic.
Second, the team explicitly does not want vendor lock-in, and MapLibre (the
open BSD fork of Mapbox GL JS v1) is the renderer either way — Mapbox GL JS
v3 is proprietary.

## Decision

- **Renderer:** MapLibre GL JS, client-side.
- **Basemap:** MapTiler vector tiles + style behind a **single config
  constant** (public, domain-locked key — browser-safe). Swapping to
  Protomaps-on-our-S3 or Mapbox is a config change.
- **Geocoding + routing:** OpenRouteService behind a **server-side
  `src/lib/geo/` client interface**, invoked through `fn/` server actions.
  The secret key never reaches the browser. This mirrors the
  `src/lib/isometric/` server-only client boundary. Outbound calls are
  throttled via the existing `src/lib/rate-limit/` util.
- **Graceful degradation:** the routing key is **optional**. Without it, CALC
  is disabled (explanatory tooltip), the map still renders, and manual
  lat/lng entry still works — same spirit as the Isometric both-or-neither
  env pair.

## Why

- **Key secrecy forces a server proxy.** A routing/geocoding key is a secret;
  a domain-locked tile key is not. Splitting them — tiles client-side, data
  calls server-side — is the only split that keeps the secret off the wire
  while letting MapLibre fetch tiles directly.
- **The interface, not the vendor, is the contract.** With geo calls behind
  `src/lib/geo/` and the basemap behind one constant, switching to Mapbox
  (or self-hosted tiles) is localized, not a rewrite. We get the open default
  now and keep the simpler one-vendor option open.
- **One caveat that shaped the boundary:** Mapbox's TOS **restricts
  persistently caching** Directions/Geocoding results — exactly what the
  Phase 2 viewer's route cache does. ORS (and self-cached results) are
  permissive. So "switch to Mapbox later" is safe for the forms phase but
  would force a rethink of the viewer cache; recording it here stops that
  from being a surprise.

## Consequences

- Dev/CI without a routing key is not broken: the feature degrades instead of
  failing env validation.
- Implementation note (2026-06-13): ORS calls use the HeiGIT unified API
  hosts because `api.openrouteservice.org` is deprecated. Routing uses
  `https://api.heigit.org/openrouteservice`; Pelias geocoding uses
  `https://api.heigit.org/pelias/v1`. The adapter sends a bounded snap radius
  to directions requests so off-road farms/yards can snap to nearby roads
  without allowing unlimited wrong-road matches.
- A routed distance is a *map estimate*, never a measurement — provenance is
  tracked via `distanceSource` (see the plan). The geo client logs entity IDs
  and action only, never addresses or coordinates.
- **Revisit if** volume outgrows the MapTiler/ORS free tiers (→ Protomaps on
  existing S3, or a paid tier), or if the open stack proves fiddly enough to
  justify Mapbox — at which point reopen this ADR and resolve the route-cache
  caveat first.
