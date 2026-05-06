# Current Schema Overview

Source of truth: `src/db/schema/*.ts` (Drizzle schema files).

| Table | Area | What it does | Use cases | Links |
|---|---|---|---|---|
| `users` | Auth | Stores user identity, role, and profile metadata. | Sign-up, login identity, role-based permissions. | `src/db/schema/auth.ts:12` |
| `session` | Auth | Tracks active login sessions and expiry tokens. | Session validation, logout-all, auth auditing. | `src/db/schema/auth.ts:35` |
| `account` | Auth | Stores provider credentials and token material per user. | Password auth, OAuth account linking. | `src/db/schema/auth.ts:60` |
| `verification` | Auth | Stores one-time verification/reset values and expirations. | Email verification, password reset flows. | `src/db/schema/auth.ts:88` |
| `facilities` | Facilities | Master record for production sites and defaults. | Facility onboarding, regional reporting, durability defaults. | `src/db/schema/facilities.ts:9` |
| `reactors` | Facilities | Defines pyrolysis units installed at facilities. | Run-to-reactor traceability, capacity planning, reactor compliance checks, sampling-method selection. | `src/db/schema/facilities.ts:45` |
| `storage_locations` | Facilities | Defines physical material storage points at facilities. | Feedstock/biochar inventory location tracking. | `src/db/schema/facilities.ts:66` |
| `suppliers` | Parties | Master list of feedstock suppliers and contacts. | Supply chain tracking, chain-of-custody references. | `src/db/schema/parties.ts:8` |
| `customers` | Parties | Buyer/customer entities for biochar distribution. | Sales destination tracking, customer-level delivery reporting. | `src/db/schema/parties.ts:42` |
| `customer_locations` | Parties | Normalized delivery/application locations per customer with structured address fields (country, state/region, city). | Multi-field customers, geospatial destination accuracy. | `src/db/schema/parties.ts` |
| `supplier_locations` | Parties | Multi-location sources per supplier with structured address fields (country, state/region, city). | Multi-site suppliers, pickup point tracking. | `src/db/schema/parties.ts` |
| `drivers` | Parties | Driver identities and transport credentials/contact fields. | Delivery assignment, transport traceability. | `src/db/schema/parties.ts` |
| `operators` | Parties | Reactor/production operator identities and credentials. | Operational accountability for runs/samples/incidents. | `src/db/schema/parties.ts` |
| `feedstock_deliveries` | Feedstock | Logs incoming biomass shipments and transport attributes. | Intake receiving, transport emissions inputs, supplier delivery records. | `src/db/schema/feedstock.ts:13` |
| `feedstock_types` | Feedstock | Controlled catalog of feedstock classes/categories. | Standardized material classification and filtering. | `src/db/schema/feedstock.ts:71` |
| `feedstocks` | Feedstock | Canonical feedstock batch records with mass and quality fields. | Carbon accounting inputs, sustainability/counterfactual evidence, batch traceability. | `src/db/schema/feedstock.ts:87` |
| `production_runs` | Production | Core pyrolysis batch records with energy inputs and output mass. Tracks biochar wet mass, moisture %, and derived dry mass. Operator selects a feedstock bin (`feedstockStorageLocationId`) and total mass; batch-level M:M rows in `production_run_feedstocks` are auto-allocated proportionally from bin contents. Temperatures via `production_run_readings`; emissions calculated at query time. | Process tracking, run-level energy accounting, operational history. | `src/db/schema/production.ts:24` |
| `production_run_readings` | Production | Time-series telemetry for temperature/pressure/gas composition. | Monitoring-plan evidence, compliance checks, diagnostics. | `src/db/schema/production.ts:101` |
| `production_samples` | Production | In-process field measurements taken during pyrolysis runs (weight, temperature, proximate analysis). | Real-time run monitoring, in-process QC, operator accountability. | `src/db/schema/production.ts:220` |
| `samples` | Production | Lab and field sample measurements for biochar quality/compliance. | Eligibility checks, durability inputs, contaminant screening. | `src/db/schema/production.ts:156` |
| `incident_reports` | Production | Captures production exceptions, severity, and corrective actions. | Adaptive management log, audit evidence, RCA workflows. | `src/db/schema/production.ts:310` |
| `production_run_feedstocks` | Production | Junction mapping feedstock batches consumed by each run. Auto-populated via proportional allocation from the selected feedstock bin. | Input mass traceability and mass-balance reconciliation. | `src/db/schema/production.ts:328` |
| `formulations` | Products | Defines recipe templates for finished biochar products. `biocharRatio` is the primary compliance field (§9.4.2 <50% rule). | Product standardization, blend definition. | `src/db/schema/products.ts:37` |
| `formulation_ingredients` | Products | Multi-ingredient rows per formulation with typed categories and ratios. Cascade-deletes with parent formulation. | Flexible recipe composition beyond simple biochar/compost split. | `src/db/schema/products.ts:57` |
| `biochar_products` | Products | Stores produced product batches and composition/storage details. | Inventory release, run-to-product lineage, downstream order fulfillment. | `src/db/schema/products.ts:117` |
| `vehicles` | Logistics | Master list of transport vehicles and fuel characteristics. | Transport planning, fuel/emissions parameterization. | `src/db/schema/logistics.ts:27` |
| `orders` | Logistics | Customer order records linked to products and quantities. | Commercial order lifecycle, fulfillment planning. | `src/db/schema/logistics.ts:46` |
| `deliveries` | Logistics | Shipment fulfillment records for ordered biochar movement. | Dispatch tracking, dry/wet mass documentation, delivery evidence. | `src/db/schema/logistics.ts:92` |
| `transport_legs` | Logistics | Canonical per-leg transport emissions accounting ledger. | Distance/energy method calculations, BCU tracking, transport auditability. | `src/db/schema/logistics.ts:160` |
| `applications` | Application | Field application events for delivered biochar to soil. | Soil application reporting, per-application CO2e storage outputs. | `src/db/schema/application.ts:21` |
| `soil_temperature_measurements` | Application | Soil temperature observations tied to applications. | 200-year durability baseline and evidence support. | `src/db/schema/application.ts:88` |
| `credit_batches` | Credits | Aggregates reporting-period data into credit issuance batches. Includes `total_feedstock_mass_kg` and `ineligible_feedstock_mass_kg` summary columns for the >25% ineligible-biomass cap (P0-01). | Net removal calculation, durability pathway selection (locked after `verified`/`issued`), registry submission prep, Method B cadence guardrails (reactor-driven), ineligible biomass fraction reporting. | `src/db/schema/credits.ts:22` |
| `credit_batch_applications` | Credits | M:N join between credit batches and applications. | Tracing which applications contribute to each issuance batch. | `src/db/schema/credits.ts:130` |
| `emission_factors` | Emissions | Versioned lookup table for fuel/electricity emission factors. | Standardized CO2e calculations by region/fuel and validity window. | `src/db/schema/emissions.ts:19` |
| `documents` | Documentation | Central optional evidence store linked by `entity_type` + `entity_id`. | Compliance evidence attachment, media/provenance retention. | `src/db/schema/documentation.ts:14` |
| `certifier_projects` | Certification | Maps local facilities to external certifier project identifiers. | Provider project registration and linkage. | `src/db/schema/certification.ts:19` |
| `certifier_ghg_periods` | Certification | Anchors provider project reporting periods for GHG statement submissions. | Prevents duplicate local statements for one Isometric project period while keeping statement state in `certification_submissions`. | `src/db/schema/certification.ts` |
| `certifier_sources` | Certification | Normalizes external source references by provider/type. | Stable mapping of provider-specific IDs used in submissions. | `src/db/schema/certification.ts:46` |
| `certification_submissions` | Certification | Immutable versioned submission history with payload snapshots. | Submission lifecycle tracking, auditability, resubmission/versioning. | `src/db/schema/certification.ts:68` |
| `certifier_document_uploads` | Certification | Maps local documents to provider-uploaded document IDs. | Reusing uploaded evidence, avoiding duplicate uploads. | `src/db/schema/certification.ts:105` |
| `certifier_sync_events` | Certification | Operation log of outbound/inbound certifier sync attempts. | Integration observability, retry/error handling, support debugging. | `src/db/schema/certification.ts:130` |
| `feedstock_sc_assessments` | Compliance | Structured sustainability-criteria assessments per feedstock. | SC pass/fail evidence, assessor audit trail, validity windows. | `src/db/schema/compliance.ts:21` |
| `stockpile_events` | Compliance | Time-bounded storage events for biochar and feedstock stockpiling. DB enforces `exception_ref` is required when duration exceeds 12 months (P0-07). | Stockpile duration auditing, risk-level tracking, exception evidence linkage. | `src/db/schema/compliance.ts` |
| `power_procurement_evidence` | Compliance | EC1–EC5 low-carbon electricity procurement evidence keyed to facility and reporting period (P0-11). Stores hard-to-derive regulatory facts; pass/fail outcomes derived by app logic. | Low-carbon electricity claims, PPA/EAC retirement verification, COD and grid region traceability. | `src/db/schema/compliance.ts` |
| `custody_handoffs` | Compliance | Chain-of-custody event ledger for material transfers. | Provenance proof across parties and handoff points. | `src/db/schema/compliance.ts:58` |
| `ghg_materiality_assessments` | Compliance | Stores SSR/net-removal materiality assessments by credit batch. | Materiality threshold checks and reassessment scheduling. | `src/db/schema/compliance.ts:79` |
| `projects` | Legacy/Core Template | Legacy multi-project container table from base template. | Project scoping in generic template flows. | `src/db/schema/projects.ts:8` |
| `project_members` | Legacy/Core Template | Role mapping between users and projects. | Access control and collaborator management. | `src/db/schema/projects.ts:26` |
| `items` | Legacy/Core Template | Example CRUD entity tied to projects. | Demo data patterns and template scaffolding. | `src/db/schema/items.ts:8` |

## Notable Enums

| Enum | Values | Used by |
|---|---|---|
| `samplingMethod` | `method_a`, `method_b` | `reactors.sampling_method` — Isometric protocol sampling method selection |
| `soilTemperatureSource` | `baseline`, `global_database` | Applications — soil temperature data source for durability calcs |
| `ingredientType` | `compost`, `mineral`, `lime`, `binder`, `amendment`, `other` | `formulation_ingredients.ingredient_type` — categorizes non-biochar recipe components |

## Related References

- Isometric requirement mapping: `docs/isometric/schema-mapping.md`
- Conditional field triggers: `docs/isometric/condition-registry.md`
