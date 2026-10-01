# Energy page: list and flow over a period

- **Owner:** Kenji Nguyen
- **Status:** approved, in progress on `feat/energy-list-flow`
- **Last reviewed:** 2026-10-01

## Why

`/energy` shows four all-time totals (grid kWh, genset litres, startup litres,
run count) and a submission preview. It has no period, no credit batch, no
transport, treats missing readings as zero, and cannot answer "how much did this
credit batch, run, delivery or application emit". A prototype round on
2026-10-01 (branch `prototype/energy-variants`, variant G) settled the shape.

## What ships

1. **Per-facility emission factors**: a new org-scoped table
   `facility_emission_factors` (one row per facility): diesel kg CO₂e per litre,
   grid electricity kg CO₂e per kWh, road freight kg CO₂e per tonne-km, plus a
   free-text source note. Edited by org owners and admins in a new
   "Emission factors" section of Certification settings. It works without a
   registry link. Diesel and road freight prefill with the repo's sandbox
   defaults (`scripts/isometric-bootstrap-constants.ts`, 2.68 kg/L and
   0.107 kg/t·km); grid has no default (it is country-specific).
2. **The energy page** (variant G):
   - Toolbar: List | Flow toggle; period select (Last 30 days, Last 90 days,
     Last 12 months, This year, All time; default Last 12 months); credit batch
     select listing only batches in the period, grouped by year.
   - Summary line: estimated total, kg per dry tonne produced, missing readings.
   - **List**: tabs Credit batches, Production runs, Deliveries, Applications;
     ranked table (record, date, est. CO₂e, bar by source); a row expands into
     its per-source activity, estimate and missing readings. **Each record code
     links to its own side sheet** (credit batch, run, delivery, application).
     Top 20 rows, then "Show all".
   - **Flow**: Sankey sources → Production energy / Transport → credit batches
     (five largest named, the rest grouped, plus "Not in a credit batch"), with
     an activity panel in native units. Clicking a batch sets the batch filter.
   - Without factors, every CO₂e figure is replaced by activity units, the list
     ranks by litres of diesel, Flow shows a notice, and a Notice links admins to
     the settings section.
3. **Application deep link**: `/applications?application=<id>` opens the
   application's view sheet, mirroring `?delivery=` on deliveries.
4. **ADR 0031**: noma shows operator-facing CO₂e *estimates* from
   facility-configured factors. Isometric stays the system of record for
   submitted project emissions (ADR 0018 unchanged for submission).

The old submission preview table is dropped; the Removal flow already shows
what is submitted.

## Sources and attribution

Six sources. Activity is what the operator recorded; kg CO₂e = activity ×
factor. A null reading is a **missing reading**, never zero.

| Source | Activity | Factor | Dated by |
| --- | --- | --- | --- |
| Startup diesel | `diesel_operation_liters` | diesel | run start (facility day) |
| Genset diesel | `diesel_genset_liters` | diesel | run start |
| Preprocessing fuel | `preprocessing_fuel_liters` | diesel | run start |
| Grid electricity | `electricity_kwh` | grid × (1 − `low_carbon_percentage`/100) | run start |
| Feedstock transport | feedstock legs, 2 × km × t | road freight | feedstock receipt |
| Biochar delivery | 2 × effective km × delivered wet t | road freight | delivery date |

Round trip ×2 comes from `src/lib/calculations/round-trip.ts`. Runs exclude
cancelled and archived ones, like `getFacilityEnergyTotals`.

Records:

- **Production run**: its four energy sources plus its share of feedstock
  transport (feedstock legs split across runs by wet mass drawn; mirror how
  `enrichWithTransportLegs` maps feedstock legs to runs).
- **Credit batch**: its runs (via `credit_batch_production_runs`) plus the
  biochar delivery transport attributed to it. In the period when its month
  overlaps the period.
- **Delivery**: its own transport plus the production energy of the biochar it
  carried, by dry mass through the product's source allocations to runs.
  A delivery that carried biochar from several batches splits across them.
- **Application**: its share of each credit batch's production energy by the
  allocated dry mass in `credit_batch_applications`, plus its share of its
  delivery's transport by dry mass. Spreading machinery is not recorded.

Anything that cannot be attributed to a batch flows to "Not in a credit batch".
Sample transport is out of scope.

## Layers

- `src/lib/energy/`: pure attribution and Sankey layout (unit tested).
- `src/data-access/energy.ts` + `facility-emission-factors.ts`: org-scoped
  reads (`requireOrgScope`, filter on `organizationId`); one read loads the
  facility's runs, legs, deliveries, applications and allocations for the
  period, the lib does the maths.
- `src/fn/energy.ts`: `withAction`, Zod input `{ facilityId, from, to }`
  (facility-local `YYYY-MM-DD`), returns `ActionResult<EnergyBreakdown>`;
  factor save action guarded for owners and admins.
- `src/hooks/use-energy.ts`: React Query key factory entries.
- `src/components/energy/`: page, toolbar, list, flow; files under 1000 lines.

## Tests

- Unit: attribution (gaps stay null, round trip, low-carbon share, splits sum
  to the source totals), Sankey grouping (cap at five named batches).
- Real-DB: the energy read is org-scoped (a foreign org's facility returns
  nothing) and executes its SQL.
- E2E: the page renders list and flow for a seeded facility; a record link
  opens its sheet.
