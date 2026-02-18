Production-Ready Data Entry Routes — Full E2E Workflow

Context

The noma-dmrv app has a complete database schema (40+ tables) for biochar
carbon credit MRV but zero UI for data entry. We need production-ready
routes with full auth under the (app)/ route group to implement the complete
data entry workflow. Playwright e2e tests will validate the entire chain.
Each ticket is independently shippable.

Key decisions:

- Production-ready with auth — Use real (app)/ layout with requireAuth(), no
  throwaway prototype code
- Flat routes — /feedstock, /production-runs, etc. (biochar entities don't
  have projectId)
- Real DB — Validates schema constraints and relations
- Slide-over panels — Detail/edit UI matching Figma designs
- Functional-first — Design system tokens, polish later

---

Ticket 1: Layout, Sidebar & Shared Components

Goal: Integrate the sidebar into the app layout, build reusable data entry
components

Modify:

- src/app/(app)/layout.tsx — Integrate sidebar (currently has TODO comment),
  add flex layout with sidebar + main content area

Create:

- src/components/navigation/app-sidebar.tsx — Full sidebar matching Figma
  structure:
  - Dashboard
  - Production: Feedstock, Production Runs, Biochar Products
  - Infrastructure: Reactors, Storage Locations
  - Parties: Suppliers, Customers
  - Distribution: Orders, Deliveries, Applications
  - Verification: Credit Batches
  - Section headers use title-chapter-title (mono, uppercase)
  - Active state: bg-[var(--clr-dark-purple)] with white text
- src/components/data-entry/slide-over.tsx — Reusable slide-over panel
  (right drawer, uses Base UI Dialog)
- src/components/data-entry/data-table.tsx — Sortable/filterable table with
  pagination
- src/components/data-entry/stat-cards.tsx — Summary stat cards row (Figma
  top section)
- src/components/data-entry/status-badge.tsx — Color-coded status badges
- src/components/data-entry/entity-select.tsx — Dropdown for selecting
  related entities (React Hook Form Controller wrapper)
- src/components/data-entry/index.ts — Barrel export

Playwright setup:

- tests/e2e/helpers/auth.ts — Auth fixture: seed test user, login helper,
  session cookie setup
- tests/e2e/helpers/seed.ts — DB seed helpers for test data
- tests/e2e/layout.spec.ts — Verify sidebar renders, navigation works after
  login

Reuse:

- src/components/navigation/sidebar.tsx — Pattern reference for active state
  styling
- src/components/forms/ — FormField, FormInput, FormTextarea
- src/components/ui/Button/ — Button component with variants

---

Ticket 2: Facilities CRUD

Goal: First entity — all other entities depend on facilities

Create (this pattern repeats for every entity):

- src/schemas/facilities.ts — Zod form + server action schemas
- src/data-access/facilities.ts — CRUD with requireAuth() guard
- src/fn/facilities.ts — Server actions ("use server", returns
  ActionResult<T>)
- src/hooks/use-facilities.ts — React Query hooks (keys: ["facilities",
  ...])
- src/components/facilities/facility-list.tsx — DataTable + StatCards
- src/components/facilities/facility-form.tsx — SlideOver form (React Hook
  Form + Zod)
- src/components/facilities/facility-detail.tsx — SlideOver detail view
- src/components/facilities/index.ts — Barrel export
- src/app/(app)/facilities/page.tsx — Route page

Key fields: code, name, country, location, gpsLatitude, gpsLongitude,
defaultDurabilityOption

DB schema ref: src/db/schema/facilities.ts

Playwright: tests/e2e/facilities.spec.ts — Create, edit, delete, validation
errors

---

Ticket 3: Reactors & Storage Locations

Goal: Infrastructure entities linked to Facilities

Reactors:

- Dropdown: Facility (required)
- Fields: code, identifier, reactorType, type, samplingMethod, capacityKg
- Route: /reactors

Storage Locations:

- Dropdown: Facility (required)
- Fields: code, name, type (feedstock/biochar/product), capacityKg,
  storageMethod
- Route: /storage-locations

Reuse: src/data-access/isometric.ts — getMethodBEligibilityByReactor() for
sampling method validation

Playwright: tests/e2e/infrastructure.spec.ts

---

Ticket 4: Suppliers, Customers & Supporting Entities

Goal: Party entities needed for deliveries and orders

Suppliers: code, name, location, contactName, contactPhone, contactEmail →
/suppliers

Customers: code, name, type, contact fields → /customers

- Nested: Customer Locations (sub-table in detail view)

Drivers: code, name, licenseNumber, contactPhone (quick-add dialog, no
dedicated route)
Vehicles: code, name, vehicleType, fuelType, fuelConsumptionLPerKm
(quick-add dialog)
Feedstock Types: code, name, category (quick-add dialog)

Small entities use a shared "quick-add" dialog pattern for inline creation
from other forms.

Playwright: tests/e2e/parties.spec.ts

---

Ticket 5: Feedstock Deliveries (Core Workflow Start)

Goal: First production entity — closest Figma match

Form sections (Figma node 180:9303):

1.  Delivery Information — collectionDate, deliveryDate, facility, supplier,
    driver, vehicleType, fuelConsumed, distance
2.  Feedstock Details — feedstockType, weightKg, moisturePercent,
    storageLocation
3.  Documentation — notes, photo upload placeholder

List page (Figma node 180:9163):

- StatCards: Incoming count, Type count, Total weight, Avg Moisture
- DataTable: ID, Date, Type, Supplier, Weight, Moisture, Storage, Status
- Header filters: Facility, Reactor, Date range

Detail panel (Figma node 180:9333):

- Delivery Info, Feedstock Details, Documentation sections
- Edit / Export buttons at bottom

Route: /feedstock

Playwright: tests/e2e/feedstock-deliveries.spec.ts — Full CRUD + filters

---

Ticket 6: Production Runs

Goal: Link feedstocks to pyrolysis runs

Form sections:

1.  Overview — code, date, facility, reactor, operator, status
2.  Feedstock Inputs — Multi-select feedstocks with mass_used_kg (M:M via
    production_run_feedstocks)
3.  Processing Parameters — feedingRateKgHr, residenceTimeMinutes, startTime,
    endTime
4.  Energy Inputs — dieselOperationLiters, electricityKwh, lpgKg,
    naturalGasM3
5.  Output — biocharOutputKg, storage location

Route: /production-runs

Playwright: tests/e2e/production-runs.spec.ts

---

Ticket 7: Samples

Goal: Lab sample tracking linked to production runs

Form sections (use Base UI Accordion for collapse):

1.  Sample Info — code, samplingTime, production run
2.  Carbon Analysis — totalCarbonPercent, organicCarbonPercent,
    inorganicCarbonPercent
3.  Elemental — H, N, O, S percentages
4.  Proximate — ash, volatile matter, moisture
5.  Physical — bulkDensity, pH, surfaceArea
6.  Stability — hToCOrgRatio (calculated)
7.  1000-Year Durability (conditional) — R₀ reflectance, TGA non-reactive
    carbon

Route: /samples

Reuse: src/schemas/isometric.ts — sampleConditionSchema

Playwright: tests/e2e/samples.spec.ts

---

Ticket 8: Biochar Products & Formulations

Goal: Finished product batches

Formulations (simple CRUD): code, name, biocharRatio, compostRatio →
/formulations

Biochar Products: facility, formulation, productionRun, storageLocation,
code, productionDate, status, massKg → /biochar-products

Playwright: tests/e2e/products.spec.ts

---

Ticket 9: Orders & Deliveries

Goal: Distribution workflow

Orders: facility, customer, customerLocation, biocharProduct, code,
orderDate, quantityKg, packaging, status → /orders

Deliveries: order (required), biocharProduct, driver, vehicle, code,
deliveryDate, deliveredWetMassKg, massDryKg, moistureContentPercent →
/deliveries

- Validation: massDryKg <= deliveredWetMassKg

Reuse: src/schemas/isometric.ts — deliveryDryMassSchema

Playwright: tests/e2e/distribution.spec.ts

---

Ticket 10: Applications

Goal: Field application records for credit verification

Form sections:

1.  Application Details — code, applicationDate, delivery,
    biocharAppliedTons, biocharAppliedDryTons
2.  Field Details — fieldSizeHa, fieldIdentifier, cropType, GPS coordinates
3.  Soil Temperature — soilTemperatureSource (enum toggle), soilTemperatureC
4.  Truck Weighing — truckMassOnArrivalKg, truckMassOnDepartureKg

Route: /applications

Playwright: tests/e2e/applications.spec.ts

---

Ticket 11: Credit Batches

Goal: Carbon credit aggregation with conditional durability validation

Form sections:

1.  Overview — code, facility, startDate, endDate, certifier, status
2.  Applications — Multi-select (M:M via credit_batch_applications)
3.  Durability — Toggle 200-year vs 1000-year:

- 200-year → requires hToCorgRatio
- 1000-year → requires R₀ reflectance + non-reactive carbon

4.  GHG Accounting — CO2e stored/emissions/counterfactual, buffer pool %
5.  Verification — registry, weight, value, currency

Route: /credit-batches

Reuse: src/schemas/isometric.ts — creditBatchConditionSchema,
src/fn/isometric.ts — validateCreditBatchFn()

Playwright: tests/e2e/credit-batches.spec.ts

---

Ticket 12: Full E2E Integration Test & Polish

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

File Structure Per Entity

src/schemas/{entity}.ts — Zod form + action schemas
src/data-access/{entity}.ts — CRUD queries + requireAuth()
src/fn/{entity}.ts — "use server" actions →
ActionResult<T>
src/hooks/use-{entity}.ts — React Query hooks
src/components/{entity}/
{entity}-list.tsx — DataTable + StatCards
{entity}-form.tsx — SlideOver form
{entity}-detail.tsx — SlideOver detail
index.ts — Barrel export
src/app/(app)/{entity}/page.tsx — Route page
tests/e2e/{entity}.spec.ts — Playwright CRUD tests

Design System Quick Reference

- Spacing: gap-16 (16px), p-24, space-y-24 — 1px scale
- Typography: body-medium (16px), title-heading-2 (32px), label-button (14px
  mono uppercase), title-chapter-title (14px mono uppercase)
- Colors: var(--color-text-primary), var(--color-border-primary),
  var(--clr-dark-purple)
- No border-radius (brutalist) except cards --radius-8
- Icons: @phosphor-icons/react/dist/ssr, weight="bold", size=20
- Buttons: Use Button component from src/components/ui/Button/
- Forms: React Hook Form + Zod, use FormField/FormInput/FormTextarea from
  src/components/forms/

Key Existing Files to Reuse

File: src/db/schema/
Purpose: All table definitions (DO NOT modify)
────────────────────────────────────────
File: src/schemas/isometric.ts
Purpose: Conditional validation schemas
────────────────────────────────────────
File: src/fn/isometric.ts
Purpose: Validation server actions
────────────────────────────────────────
File: src/data-access/isometric.ts
Purpose: Method B eligibility query
────────────────────────────────────────
File: src/components/items/
Purpose: CRUD pattern reference
────────────────────────────────────────
File: src/components/forms/
Purpose: FormField, FormInput, FormTextarea
────────────────────────────────────────
File: src/components/ui/Button/
Purpose: Button with variants
────────────────────────────────────────
File: src/components/navigation/sidebar.tsx
Purpose: Sidebar pattern reference
────────────────────────────────────────
File: src/lib/auth/server.ts
Purpose: requireAuth() function
────────────────────────────────────────
File: src/lib/utils.ts
Purpose: cn() utility
────────────────────────────────────────
File: playwright.config.ts
Purpose: Test config (base URL :3100)

Verification

1.  pnpm dev → Login → Verify sidebar navigation and all routes load
2.  Per ticket: Create/Read/Update/Delete through the UI, verify DB writes
3.  pnpm exec playwright test tests/e2e/ — Run all e2e tests
4.  Final: full-workflow.spec.ts verifies complete traceability chain
