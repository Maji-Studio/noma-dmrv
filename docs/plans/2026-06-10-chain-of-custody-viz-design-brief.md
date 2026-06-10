# Design Brief — Chain of Custody & Map Visualization

A spec sheet for generating UI designs. Two linked visualizations of a biochar
carbon-credit traceability chain: **(A)** a lineage graph (DAG) and **(B)** a
geographic map. Both visualize the same underlying record: the journey of carbon
from feedstock → biochar → field application, used for MRV (Monitoring,
Reporting, Verification) on a carbon registry.

---

## Context (for tone & content, not literal copy)

- **Product**: an MRV system for biochar carbon credits. Operators trace each
  batch of carbon from raw feedstock through pyrolysis to the field where biochar
  is applied (where the carbon is durably stored).
- **The "chain of custody" is application-first**: a user picks one *Application*
  (biochar applied to a field) and the UI rolls the lineage *backwards* to the
  originating feedstocks.
- **Aesthetic**: brutalist / industrial — square corners (no border-radius),
  monospaced uppercase labels for headings, hairline borders, restrained color
  used only as semantic accents. Think data-dense control panel, not a
  consumer app. Light background.

---

## Visualization A — Lineage Graph (DAG)

A left-to-right directed graph. **Upstream inputs on the left, final outcome on
the right.** Edges show flow of material. Feedstocks can fan in (multiple) to a
single production run.

### Flow / topology

```
Feedstock(s) ┐
             ├─→ Production Run ─→ Biochar Product ─→ Order ─→ Delivery ─→ Application
Reactor ─────┘
```

- `Reactor` and one-or-more `Feedstock` nodes are sibling upstream inputs that
  both feed `Production Run`.
- `Order` is optional (a delivery may exist without an order).
- If a link is missing mid-chain, render the partial chain + a **warning card**
  explaining where the rollback stopped.

### Node anatomy (every node)

Each node is a card, ~260px wide, ≥132px tall, with:
- A **3px colored left border** (the accent — see color groups below).
- **Header row**: small icon + an UPPERCASE mono type label (e.g. "PRODUCTION
  RUN") on the left; a **status pill** on the right (outlined, uppercase).
- **Code** as the prominent line (e.g. `PR-0042`) — this is the entity's
  human-readable ID.
- **Detail lines**: 1–4 small secondary-text rows (the fields below).
- Hover state: border darkens, subtle background shift. Whole card is a link.

### Color groups (semantic, by lifecycle stage)

| Group | Color accent | Node types |
|---|---|---|
| **Production** | orange | Feedstock, Production Run, Biochar Product |
| **Infrastructure** | purple | Reactor |
| **Distribution** | rose | Order, Delivery, Application |

Connection handles / edges: purple.

### Per-node-type icon + fields to display

| Node | Icon | Code example | Detail lines to show |
|---|---|---|---|
| **Feedstock** | leaf | `FS-1180` | feedstock type · supplier · inbound delivery code · mass used (kg) of total dry mass (kg) |
| **Reactor** | flask | `R-001` | identifier ("Unit 3") · reactor type ("continuous pyrolysis") |
| **Production Run** | factory | `PR-0042` | run date · feedstock dry mass (kg) in → biochar dry mass (kg) out |
| **Biochar Product** | cube | `BP-0207` | production date · mass (kg) |
| **Order** | shopping-cart | `ORD-0090` | order date · quantity (kg) |
| **Delivery** | truck | `DEL-0311` | delivery date · dry mass (kg) |
| **Application** | map-pin | `APP-0125` | application date · field identifier · biochar applied (dry tons) |

### Status pill values (color-coded)

- **Green** (success): applied, delivered, complete, ready, processed
- **Purple** (in-progress): running, upcoming, ordered
- **Orange** (waiting): pending, scheduled
- **Gray** (inactive): draft, missing_data
- **Red** (problem): rejected, void

### Chrome / controls around the graph

- **Header**: an Application search/selector ("Trace an application…") — picking
  one drives the whole graph. Show the resolved facility name + code next to it.
- Pan/zoom canvas, a **minimap**, zoom controls.
- **Empty state** before an application is picked.
- **Warning card** when the chain is incomplete (e.g. "Biochar product is not yet
  linked to a production run — feedstock rollback stops here.").

---

## Visualization B — Map

The same lineage, plotted geographically. The story the map tells: **carbon
physically travels** from supplier sites → the facility (where it's pyrolyzed)
→ the field where it's applied and stored. Transport distance matters because it
drives transport emissions in the carbon accounting.

### What carries coordinates (GPS lat/lng exists on these)

- **Facility** (the pyrolysis plant — the hub)
- **Supplier** (feedstock origin)
- **Feedstock Delivery** (pickup/origin point)
- **Application** (the field — final carbon storage location)
- **Transport legs** have origin + destination GPS and a `distanceKm`

### Map requirements

- **Markers** differentiated by role, reusing the lineage color groups:
  - Facility = central hub marker (purple/infrastructure, larger/distinct).
  - Supplier / feedstock origin = orange (production).
  - Application field = rose (distribution / end of chain).
- **Flow lines** connecting markers along the chain (supplier → facility →
  field), ideally directional (arrow or animated dash). Label each leg with its
  distance (km).
- **Marker pop/hover card** mirroring the lineage node: code, type label, key
  detail lines, status pill.
- **Legend** for the three role colors.
- A facility may have **many suppliers fanning in** and **many applications
  fanning out** — design for one-to-many on both ends.
- Some records have **null coordinates** — show an "ungeolocated" affordance
  (e.g. a side list of records that can't be placed on the map), don't drop them
  silently.
- Optional: clicking a map marker highlights the corresponding node in the
  lineage graph (the two views are linked).

---

## Mock data (one complete chain — use verbatim)

```json
{
  "facility": {
    "code": "FAC-001",
    "name": "Råö Biochar Works",
    "country": "SE",
    "gps": { "lat": 57.3925, "lng": 11.9145 }
  },
  "application": {
    "code": "APP-0125",
    "status": "applied",
    "applicationDate": "2026-05-18",
    "fieldIdentifier": "North Parcel 7",
    "biocharAppliedDryTons": 4.2,
    "gps": { "lat": 57.6731, "lng": 12.1100 }
  },
  "delivery": {
    "code": "DEL-0311",
    "status": "delivered",
    "deliveryDate": "2026-05-10",
    "massDryKg": 4200
  },
  "order": {
    "code": "ORD-0090",
    "orderDate": "2026-04-28",
    "quantityKg": 4200
  },
  "biocharProduct": {
    "code": "BP-0207",
    "status": "ready",
    "productionDate": "2026-04-15",
    "massKg": 5300
  },
  "productionRun": {
    "code": "PR-0042",
    "status": "complete",
    "date": "2026-04-15",
    "feedstockMassDryKg": 18600,
    "biocharDryMassKg": 5300
  },
  "reactor": {
    "code": "R-001",
    "identifier": "Unit 3",
    "reactorType": "continuous pyrolysis"
  },
  "feedstocks": [
    {
      "code": "FS-1180",
      "status": "processed",
      "feedstockTypeName": "Spruce sawmill residue",
      "supplierName": "Götaland Sawmills AB",
      "feedstockDeliveryCode": "FD-0455",
      "massDryKg": 12000,
      "massUsedKg": 11200,
      "gps": { "lat": 57.7089, "lng": 11.9746 }
    },
    {
      "code": "FS-1181",
      "status": "processed",
      "feedstockTypeName": "Orchard prunings",
      "supplierName": "Väst Agri Cooperative",
      "feedstockDeliveryCode": "FD-0456",
      "massDryKg": 8000,
      "massUsedKg": 7400,
      "gps": { "lat": 57.1853, "lng": 12.3402 }
    }
  ],
  "transportLegs": [
    { "from": "Götaland Sawmills AB", "to": "Råö Biochar Works", "distanceKm": 41 },
    { "from": "Väst Agri Cooperative", "to": "Råö Biochar Works", "distanceKm": 58 },
    { "from": "Råö Biochar Works", "to": "North Parcel 7", "distanceKm": 32 }
  ],
  "warnings": []
}
```

> Mass story to make legible across both views: **20,000 kg feedstock dry mass in
> → 5,300 kg biochar out → 4,200 kg delivered & applied to one field.** Two
> suppliers fan into one production run; one reactor; one field at the end.

---

## Deliverables wanted from Claude design

1. The **lineage graph** layout (node cards + edges + header/controls + warning
   + empty states).
2. The **map view** (markers + flow lines + legend + popups + ungeolocated list).
3. Show how the two **link/toggle** (tabs or side-by-side).
4. Match the brutalist/industrial aesthetic described above.
