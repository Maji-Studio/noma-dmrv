# Remaining Tickets (7–12) — Data Entry Routes

Tickets 1–6 are complete. This file tracks the remaining work.

---

## Ticket 7: Samples

Goal: Lab sample tracking linked to production runs

Form sections (use Base UI Accordion for collapse):

1. Sample Info — code, samplingTime, production run
2. Carbon Analysis — totalCarbonPercent, organicCarbonPercent, inorganicCarbonPercent
3. Elemental — H, N, O, S percentages
4. Proximate — ash, volatile matter, moisture
5. Physical — bulkDensity, pH, surfaceArea
6. Stability — hToCOrgRatio (calculated)
7. 1000-Year Durability (conditional) — R₀ reflectance, TGA non-reactive carbon

Route: /samples

Reuse: src/schemas/isometric.ts — sampleConditionSchema

Playwright: tests/e2e/samples.spec.ts

---

## Ticket 8: Biochar Products & Formulations

Goal: Finished product batches

Formulations (simple CRUD): code, name, biocharRatio, compostRatio → /formulations

Biochar Products: facility, formulation, productionRun, storageLocation, code, productionDate, status, massKg → /biochar-products

Playwright: tests/e2e/products.spec.ts

---

## Ticket 9: Orders & Deliveries

Goal: Distribution workflow

Orders: facility, customer, customerLocation, biocharProduct, code, orderDate, quantityKg, packaging, status → /orders

Deliveries: order (required), biocharProduct, driver, vehicle, code, deliveryDate, deliveredWetMassKg, massDryKg, moistureContentPercent → /deliveries

- Validation: massDryKg <= deliveredWetMassKg

Reuse: src/schemas/isometric.ts — deliveryDryMassSchema

Playwright: tests/e2e/distribution.spec.ts

---

## Ticket 10: Applications

Goal: Field application records for credit verification

Form sections:

1. Application Details — code, applicationDate, delivery, biocharAppliedTons, biocharAppliedDryTons
2. Field Details — fieldSizeHa, fieldIdentifier, cropType, GPS coordinates
3. Soil Temperature — soilTemperatureSource (enum toggle), soilTemperatureC
4. Truck Weighing — truckMassOnArrivalKg, truckMassOnDepartureKg

Route: /applications

Playwright: tests/e2e/applications.spec.ts

---

## Ticket 11: Credit Batches

Goal: Carbon credit aggregation with conditional durability validation

Form sections:

1. Overview — code, facility, startDate, endDate, certifier, status
2. Applications — Multi-select (M:M via credit_batch_applications)
3. Durability — Toggle 200-year vs 1000-year:
   - 200-year → requires hToCorgRatio
   - 1000-year → requires R₀ reflectance + non-reactive carbon
4. GHG Accounting — CO2e stored/emissions/counterfactual, buffer pool %
5. Verification — registry, weight, value, currency

Route: /credit-batches

Reuse: src/schemas/isometric.ts — creditBatchConditionSchema, src/fn/isometric.ts — validateCreditBatchFn()

Playwright: tests/e2e/credit-batches.spec.ts

---

## Ticket 12: Full E2E Integration Test & Polish

Goal: Complete traceability chain test + UX refinements

Create:

- tests/e2e/full-workflow.spec.ts — Single test creating the full chain:
  a. Facility → Reactor → Storage Location
  b. Supplier → Feedstock Type → Feedstock Delivery
  c. Production Run (linking feedstocks) → Sample
  d. Formulation → Biochar Product
  e. Customer → Order → Delivery
  f. Application → Credit Batch
- src/db/seed-data.ts — Realistic seed script for demos

Polish:

- Toast notifications (success/error)
- Delete confirmation dialogs
- "View Related" links between entities
- Loading skeletons for tables

Playwright: Full chain test (~60-90s)

---

## File Structure Per Entity

```
src/schemas/{entity}.ts          — Zod form + action schemas
src/data-access/{entity}.ts      — CRUD queries + requireAuth()
src/fn/{entity}.ts               — "use server" actions → ActionResult<T>
src/hooks/use-{entity}.ts        — React Query hooks
src/components/{entity}/
  {entity}-list.tsx              — DataTable + StatCards
  {entity}-form.tsx              — SlideOver form
  {entity}-detail.tsx            — SlideOver detail
  index.ts                       — Barrel export
src/app/(app)/{entity}/page.tsx  — Route page
tests/e2e/{entity}.spec.ts      — Playwright CRUD tests
```
