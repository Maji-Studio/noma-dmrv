# Current Schema Overview

Source of truth: `src/db/schema/*.ts` (Drizzle schema files).

Current shape: 48 table exports across 15 table-bearing schema files.

**Facility archive (soft delete):** `facilities` and the 11 operational facility-scoped tables (`reactors`, `storage_locations`, `feedstock_deliveries`, `feedstocks`, `production_runs`, `biochar_products`, `orders`, `deliveries`, `credit_batches`, `stockpile_events`, `power_procurement_evidence`) carry a nullable `archived_at` stamped by the facility archive cascade; `NULL` = active. Grandchildren and certifier mirror tables hide transitively. See `docs/database.md` → "Soft Delete — Facility Archive".

| Table | Area | What it does | Use cases | Links |
|---|---|---|---|---|
| `users` | Auth | Stores user identity, role, and profile metadata. | Sign-up, login identity, role-based permissions. | `src/db/schema/auth.ts:12` |
| `session` | Auth | Tracks active login sessions and expiry tokens. | Session validation, logout-all, auth auditing. | `src/db/schema/auth.ts:35` |
| `account` | Auth | Stores provider credentials and token material per user. | Password auth, OAuth account linking. | `src/db/schema/auth.ts:60` |
| `verification` | Auth | Stores one-time verification/reset values and expirations. | Email verification, password reset flows. | `src/db/schema/auth.ts:88` |
| `facilities` | Facilities | Master record for production sites, including required facility timezone (`UTC` default) and durability defaults. | Facility onboarding, local-time reporting, durability defaults. | `src/db/schema/facilities.ts:9` |
| `reactors` | Facilities | Defines pyrolysis units installed at facilities. (Sampling method moved off this table to `production_processes` — ADR 0016.) | Run-to-reactor traceability, capacity planning, reactor compliance checks. | `src/db/schema/facilities.ts:45` |
| `storage_locations` | Facilities | Defines physical material storage points at facilities. | Feedstock/biochar inventory location tracking. | `src/db/schema/facilities.ts:66` |
| `biochar_storage_inventory` | Facilities | Tracks biochar inventory movements and storage state. | Stored-product inventory, dispatch readiness, mass-balance support. | `src/db/schema/storage-inventory.ts` |
| `suppliers` | Parties | Master list of feedstock suppliers and contacts. | Supply chain tracking, chain-of-custody references. | `src/db/schema/parties.ts:8` |
| `customers` | Parties | Buyer/customer entities for biochar distribution. | Sales destination tracking, customer-level delivery reporting. | `src/db/schema/parties.ts:42` |
| `customer_locations` | Parties | Normalized delivery/application locations per customer with structured address fields (country, state/region, city), per-location facility distance, optional site default soil temperature, and a default-destination flag (one default per customer, partial-unique enforced). | Multi-field customers, geospatial destination accuracy, application soil-temperature prefill. | `src/db/schema/parties.ts` |
| `supplier_locations` | Parties | Multi-location sources per supplier with structured address fields (country, state/region, city), per-location facility distance, and a default-source flag (one default per supplier, partial-unique enforced). | Multi-site suppliers, pickup point tracking. | `src/db/schema/parties.ts` |
| `drivers` | Parties | Driver identities and transport credentials/contact fields. | Delivery assignment, transport traceability. | `src/db/schema/parties.ts` |
| `operators` | Parties | Reactor/production operator identities and credentials. | Operational accountability for runs/samples/incidents. | `src/db/schema/parties.ts` |
| `feedstock_deliveries` | Feedstock | Logs incoming biomass shipments and transport attributes. | Intake receiving, transport emissions inputs, supplier delivery records. | `src/db/schema/feedstock.ts:13` |
| `feedstock_types` | Feedstock | Controlled catalog of feedstock classes/categories. | Standardized material classification and filtering. | `src/db/schema/feedstock.ts:71` |
| `feedstocks` | Feedstock | Canonical feedstock batch records with mass and quality fields. | Carbon accounting inputs, sustainability/counterfactual evidence, batch traceability. | `src/db/schema/feedstock.ts:87` |
| `production_runs` | Production | Core pyrolysis batch records with energy inputs and output mass. Tracks biochar wet mass, moisture %, and derived dry mass. Operator selects a feedstock bin (`feedstockStorageLocationId`) and total mass; batch-level M:M rows in `production_run_feedstocks` are auto-allocated proportionally from bin contents. Temperatures via `production_run_readings`; emissions calculated at query time. | Process tracking, run-level energy accounting, operational history. | `src/db/schema/production.ts:24` |
| `production_run_readings` | Production | Time-series telemetry for temperature/pressure/gas flow, entered manually or imported from reactor-day CSV files. | Monitoring-plan evidence, compliance checks, diagnostics. | `src/db/schema/production.ts:101` |
| `production_samples` | Production | In-process field measurements taken during pyrolysis runs (weight, temperature, proximate analysis). | Real-time run monitoring, in-process QC, operator accountability. | `src/db/schema/production.ts:220` |
| `samples` | Production | Lab and field sample measurements for biochar quality/compliance. Attach per credit batch (`credit_batch_id`); `production_run_id` retained as optional in-process provenance (ADR 0016). | Eligibility checks, durability inputs, contaminant screening. | `src/db/schema/production.ts:156` |
| `incident_reports` | Production | Captures production exceptions, severity, and corrective actions. | Adaptive management log, audit evidence, RCA workflows. | `src/db/schema/production.ts:310` |
| `production_run_feedstocks` | Production | Junction mapping feedstock batches consumed by each run. Auto-populated via proportional allocation from the selected feedstock bin. | Input mass traceability and mass-balance reconciliation. | `src/db/schema/production.ts:328` |
| `formulations` | Products | Defines recipe templates for finished biochar products. `biocharRatio` is the primary compliance field (§9.4.2 <50% rule). | Product standardization, blend definition. | `src/db/schema/products.ts:37` |
| `formulation_ingredients` | Products | Blend-material rows per formulation, each referencing a blend-usage `feedstock_types` catalog entry plus a ratio. Cascade-deletes with parent formulation. | Flexible recipe composition beyond simple biochar/compost split. | `src/db/schema/products.ts:44` |
| `biochar_products` | Products | Stores produced product batches and composition/storage details. | Inventory release, run-to-product lineage, downstream order fulfillment. | `src/db/schema/products.ts:117` |
| `vehicles` | Logistics | Master list of transport vehicles and fuel characteristics. | Transport planning, fuel/emissions parameterization. | `src/db/schema/logistics.ts:27` |
| `orders` | Logistics | Customer order records linked to products and quantities. | Commercial order lifecycle, fulfillment planning. | `src/db/schema/logistics.ts:46` |
| `deliveries` | Logistics | Shipment fulfillment records for ordered biochar movement, including an optional per-delivery distance override + note (defaults to the destination location's distance). | Dispatch tracking, dry/wet mass documentation, delivery evidence. | `src/db/schema/logistics.ts:92` |
| `transport_legs` | Logistics | Canonical per-leg transport emissions accounting ledger. | Distance/energy method calculations, BCU tracking, transport auditability. | `src/db/schema/logistics.ts:160` |
| `applications` | Application | Field application events for delivered biochar to soil. | Soil application reporting, per-application CO2e storage outputs. | `src/db/schema/application.ts:21` |
| `soil_temperature_measurements` | Application | Soil temperature observations tied to applications. | 200-year durability baseline and evidence support. | `src/db/schema/application.ts:88` |
| `production_processes` | Production | Sampling-regime campaign keyed `(facility, feedstock)`, spanning reactors (Biochar Protocol §8.3.1; ADR 0016). Owns `sampling_method` (moved off `reactors`), `established_at` baseline epoch, and the inert `method_b_unlocked_at` seam (ADR 0017). Non-unique lookup index — sequential processes per pair over time; find-or-created on credit-batch create. | Method A/B sampling scope, baseline counting, credit-batch process linkage. | `src/db/schema/production-processes.ts` |
| `credit_batches` | Credits | The protocol production batch (ADR 0016): one feedstock, facility-scoped, ≤ 1 month under Isometric. Carries derived `feedstock_type_id` (NOT NULL) + `production_process_id`, plus `total_feedstock_mass_kg`/`ineligible_feedstock_mass_kg` for the >25% ineligible-biomass cap (P0-01). DB `check` enforces the ≤ 1-month Isometric window. | Net removal calculation, durability pathway selection (locked after `verified`/`issued`), registry submission prep, per-credit-batch lab sampling, ineligible biomass fraction reporting. | `src/db/schema/credits.ts:22` |
| `credit_batch_applications` | Credits | M:N join between credit batches and applications. | Tracing which applications contribute to each issuance batch. | `src/db/schema/credits.ts:130` |
| `documents` | Documentation | Central optional evidence store linked by `entity_type` + `entity_id`. | Compliance evidence attachment, media/provenance retention. | `src/db/schema/documentation.ts:14` |
| `certifier_projects` | Certification | Maps local facilities to external certifier project identifiers; also holds per-facility emission-estimate config (genset kWh/L yield, three-stage energy split %) and the facility fallback soil temperature. | Provider project registration and linkage, emission-estimate configuration, application soil-temperature fallback. | `src/db/schema/certification.ts:20` |
| `certifier_sensors` | Certification | Maps local reactors/measurement properties to external certifier sensor IDs. | Time-series telemetry submission, sensor reference reuse. | `src/db/schema/certification.ts` |
| `certifier_project_emissions` | Certification | Facility reporting-period LCA journal rows reconciled against Isometric Project Components. | Period-emission drift checks, ADR 0005 support. | `src/db/schema/certification.ts` |
| `certifier_ghg_statements` | Certification | Independent, period-anchored GHG Statement artifacts that roll up multiple Removals for a supplier-chosen reporting period (ADR 0004). | Period-first GHG Statement creation, verifier submission lifecycle. | `src/db/schema/certification.ts:71` |
| `certifier_removals` | Certification | The Isometric Removal — the submission unit. N credit batches map into one; carries a nullable `ghg_statement_id` FK reconciled from a statement's `removal_ids` (ADR 0003/0004). | Removal grouping and submission, GHG-statement membership. | `src/db/schema/certification.ts:93` |
| `certification_submissions` | Certification | Immutable versioned submission history with payload snapshots. A Removal is one row keyed `localEntityType:'removal'`; a GHG Statement is one row keyed `localEntityType:'ghgStatement'`. | Submission lifecycle tracking, auditability, resubmission/versioning. | `src/db/schema/certification.ts:145` |
| `certifier_document_uploads` | Certification | Maps local documents to provider-uploaded document IDs. | Reusing uploaded evidence, avoiding duplicate uploads. | `src/db/schema/certification.ts:123` |
| `certifier_sync_events` | Certification | Operation log of outbound/inbound certifier sync attempts. | Integration observability, retry/error handling, support debugging. | `src/db/schema/certification.ts:148` |
| `stockpile_events` | Compliance | Time-bounded storage events for biochar and feedstock stockpiling. DB enforces `exception_ref` is required when duration exceeds 12 months (P0-07). | Stockpile duration auditing, risk-level tracking, exception evidence linkage. | `src/db/schema/compliance.ts` |
| `power_procurement_evidence` | Compliance | EC1–EC5 low-carbon electricity procurement evidence keyed to facility and reporting period (P0-11). Stores hard-to-derive regulatory facts; pass/fail outcomes derived by app logic. | Low-carbon electricity claims, PPA/EAC retirement verification, COD and grid region traceability. | `src/db/schema/compliance.ts` |
| `geo_route_cache` | Geo | Cached server-side route geometries keyed by routing profile and rounded origin/destination coordinates. | Chain-of-custody map polylines without repeat ORS calls. | `src/db/schema/geo.ts` |

## Notable Enums

| Enum | Values | Used by |
|---|---|---|
| `samplingMethod` | `method_a`, `method_b` | `production_processes.sampling_method` — Isometric protocol sampling regime, keyed `(facility, feedstock)` (moved off `reactors`, ADR 0016) |
| `soilTemperatureSource` | `baseline`, `global_database` | Applications — soil temperature data source for durability calcs |
| `feedstockTypeUsage` | `pyrolysis`, `blend` | `feedstock_types.usage` — separates registry-validated pyrolysis biomass from internal-only blend materials |
| `applicationEvidenceMethod` | `visual`, `boundary` | Applications — declared evidence route: geotagged visual proof or GIS boundary + logbook |

## Related References

- Isometric requirement mapping: `docs/isometric/schema-mapping.md`
- Conditional field triggers: `docs/isometric/condition-registry.md`
- Database operations and migration notes: `docs/database.md`
