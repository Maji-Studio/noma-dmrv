# Energy page: list and flow over a period

- **Owner:** Kenji Nguyen
- **Status:** implemented and archived 2026-10-02 (PR #898)
- **Last reviewed:** 2026-10-02

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

### As implemented against the schema (2026-10-01)

Where the real data model decided a detail the rules above leave open, or
offered a more exact source, the implementation (`src/lib/energy/attribution.ts`)
does this:

- **Delivery production share** comes from the delivery's saved stock
  provenance (`output_stock_allocations` → `output_stock_run_allocations`,
  netted), not from the product's `biochar_product_source_allocations`. The
  product allocations describe the whole product; the stock provenance says
  which runs this truck actually took under FIFO or pro-rata, and is what the
  delivery list and applications already read. Each run's footprint is scaled
  by dry mass taken over the run's dry output.
- **Application production share** is per source run from
  `application_output_allocations`, falling back to its delivery's run mix
  scaled by the dry mass applied when an application has no saved shares.
  `credit_batch_applications` is the batch-level roll-up of the same
  provenance; using it would give an application energy from batch runs its
  biochar never came from. The per-batch split still falls out of each run's
  credit batch. Application transport is its dry mass over the delivery's.
- **Feedstock transport** splits by `production_run_feedstocks.wet_mass_used_kg`
  over the larger of the feedstock's received wet mass and everything drawn
  from it, so shares never exceed the whole. What no run drew stays with the
  feedstock and flows to "Not in a credit batch". A feedstock with no
  transport leg, or a leg without a load mass, is a missing reading.
- **Biochar delivery** uses the delivery's effective distance (override, else
  the customer location's) and its delivered wet mass; either missing is a
  missing reading. In a credit batch's figures it counts by the share of the
  truck's dry mass that came from the batch's runs.
- **Grid**: a null `low_carbon_percentage` counts as no low-carbon share.
- **A run carried by a delivery or application without a dry output** cannot
  be scaled, so each source it would contribute counts as a missing reading
  rather than a guessed share.
- **Missing readings** count once per record and source: per run reading, per
  feedstock, per delivery. The summary's count is the period's flows'
  missing readings (narrowed to the credit batch when one is selected).
- **kg per dry tonne produced** divides the period's estimate by the dry
  output of runs that started in the period.
- **Factors** are all three required on save, so a row is complete or absent;
  grid starts empty.
- **All time** starts at the first recorded day (run, feedstock receipt,
  delivery or application).

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
