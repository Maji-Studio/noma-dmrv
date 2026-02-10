# Current Schema Overview

Source of truth: `src/db/schema/*.ts` (Drizzle schema files).

| Table | Area | What it does | Use cases | Links |
|---|---|---|---|---|
| `users` | Auth | Stores user identity, role, and profile metadata. | Sign-up, login identity, role-based permissions. | `src/db/schema/auth.ts:12` |
| `session` | Auth | Tracks active login sessions and expiry tokens. | Session validation, logout-all, auth auditing. | `src/db/schema/auth.ts:35` |
| `account` | Auth | Stores provider credentials and token material per user. | Password auth, OAuth account linking. | `src/db/schema/auth.ts:60` |
| `verification` | Auth | Stores one-time verification/reset values and expirations. | Email verification, password reset flows. | `src/db/schema/auth.ts:88` |
| `facilities` | Facilities | Master record for production sites and defaults. | Facility onboarding, regional reporting, durability defaults. | `src/db/schema/facilities.ts:9` |
| `reactors` | Facilities | Defines pyrolysis units installed at facilities. | Run-to-reactor traceability, capacity planning, reactor compliance checks. | `src/db/schema/facilities.ts:45` |
| `storage_locations` | Facilities | Defines physical material storage points at facilities. | Feedstock/biochar inventory location tracking. | `src/db/schema/facilities.ts:66` |
| `suppliers` | Parties | Master list of feedstock suppliers and contacts. | Supply chain tracking, chain-of-custody references. | `src/db/schema/parties.ts:8` |
| `customers` | Parties | Buyer/customer entities for biochar distribution. | Sales destination tracking, customer-level delivery reporting. | `src/db/schema/parties.ts:42` |
| `customer_locations` | Parties | Normalized delivery/application locations per customer. | Multi-field customers, geospatial destination accuracy. | `src/db/schema/parties.ts:75` |
| `drivers` | Parties | Driver identities and transport credentials/contact fields. | Delivery assignment, transport traceability. | `src/db/schema/parties.ts:105` |
| `operators` | Parties | Reactor/production operator identities and credentials. | Operational accountability for runs/samples/incidents. | `src/db/schema/parties.ts:120` |
| `feedstock_deliveries` | Feedstock | Logs incoming biomass shipments and transport attributes. | Intake receiving, transport emissions inputs, supplier delivery records. | `src/db/schema/feedstock.ts:13` |
| `feedstock_types` | Feedstock | Controlled catalog of feedstock classes/categories. | Standardized material classification and filtering. | `src/db/schema/feedstock.ts:71` |
| `feedstocks` | Feedstock | Canonical feedstock batch records with mass and quality fields. | Carbon accounting inputs, sustainability/counterfactual evidence, batch traceability. | `src/db/schema/feedstock.ts:87` |
| `production_runs` | Production | Core pyrolysis batch execution records and calculated outputs. | Process tracking, run-level emissions/energy accounting, operational history. | `src/db/schema/production.ts:24` |
| `production_run_readings` | Production | Time-series telemetry for temperature/pressure/gas composition. | Monitoring-plan evidence, compliance checks, diagnostics. | `src/db/schema/production.ts:101` |
| `samples` | Production | Lab and field sample measurements for biochar quality/compliance. | Eligibility checks, durability inputs, contaminant screening. | `src/db/schema/production.ts:156` |
| `incident_reports` | Production | Captures production exceptions, severity, and corrective actions. | Adaptive management log, audit evidence, RCA workflows. | `src/db/schema/production.ts:310` |
| `production_run_feedstocks` | Production | Junction mapping feedstock batches consumed by each run. | Input mass traceability and mass-balance reconciliation. | `src/db/schema/production.ts:328` |
| `formulations` | Products | Defines recipe templates for finished biochar products. | Product standardization, blend definition. | `src/db/schema/products.ts:11` |
| `biochar_products` | Products | Stores produced product batches and composition/storage details. | Inventory release, run-to-product lineage, downstream order fulfillment. | `src/db/schema/products.ts:27` |
| `vehicles` | Logistics | Master list of transport vehicles and fuel characteristics. | Transport planning, fuel/emissions parameterization. | `src/db/schema/logistics.ts:27` |
| `orders` | Logistics | Customer order records linked to products and quantities. | Commercial order lifecycle, fulfillment planning. | `src/db/schema/logistics.ts:46` |
| `deliveries` | Logistics | Shipment fulfillment records for ordered biochar movement. | Dispatch tracking, dry/wet mass documentation, delivery evidence. | `src/db/schema/logistics.ts:92` |
| `transport_legs` | Logistics | Canonical per-leg transport emissions accounting ledger. | Distance/energy method calculations, BCU tracking, transport auditability. | `src/db/schema/logistics.ts:160` |
| `applications` | Application | Field application events for delivered biochar to soil. | Soil application reporting, per-application CO2e storage outputs. | `src/db/schema/application.ts:21` |
| `soil_temperature_measurements` | Application | Soil temperature observations tied to applications. | 200-year durability baseline and evidence support. | `src/db/schema/application.ts:88` |
| `credit_batches` | Credits | Aggregates reporting-period data into credit issuance batches. | Net removal calculation, durability pathway selection, registry submission prep. | `src/db/schema/credits.ts:22` |
| `credit_batch_applications` | Credits | M:N join between credit batches and applications. | Tracing which applications contribute to each issuance batch. | `src/db/schema/credits.ts:130` |
| `emission_factors` | Emissions | Versioned lookup table for fuel/electricity emission factors. | Standardized CO2e calculations by region/fuel and validity window. | `src/db/schema/emissions.ts:19` |
| `documents` | Documentation | Central file evidence store with explicit ownership FKs. | Compliance evidence attachment, media/provenance retention. | `src/db/schema/documentation.ts:20` |
| `certifier_projects` | Certification | Maps local facilities to external certifier project identifiers. | Provider project registration and linkage. | `src/db/schema/certification.ts:19` |
| `certifier_sources` | Certification | Normalizes external source references by provider/type. | Stable mapping of provider-specific IDs used in submissions. | `src/db/schema/certification.ts:46` |
| `certification_submissions` | Certification | Immutable versioned submission history with payload snapshots. | Submission lifecycle tracking, auditability, resubmission/versioning. | `src/db/schema/certification.ts:68` |
| `certifier_document_uploads` | Certification | Maps local documents to provider-uploaded document IDs. | Reusing uploaded evidence, avoiding duplicate uploads. | `src/db/schema/certification.ts:105` |
| `certifier_sync_events` | Certification | Operation log of outbound/inbound certifier sync attempts. | Integration observability, retry/error handling, support debugging. | `src/db/schema/certification.ts:130` |
| `feedstock_sc_assessments` | Compliance | Structured sustainability-criteria assessments per feedstock. | SC pass/fail evidence, assessor audit trail, validity windows. | `src/db/schema/compliance.ts:21` |
| `custody_handoffs` | Compliance | Chain-of-custody event ledger for material transfers. | Provenance proof across parties and handoff points. | `src/db/schema/compliance.ts:58` |
| `ghg_materiality_assessments` | Compliance | Stores SSR/net-removal materiality assessments by credit batch. | Materiality threshold checks and reassessment scheduling. | `src/db/schema/compliance.ts:79` |
| `projects` | Legacy/Core Template | Legacy multi-project container table from base template. | Project scoping in generic template flows. | `src/db/schema/projects.ts:8` |
| `project_members` | Legacy/Core Template | Role mapping between users and projects. | Access control and collaborator management. | `src/db/schema/projects.ts:26` |
| `items` | Legacy/Core Template | Example CRUD entity tied to projects. | Demo data patterns and template scaffolding. | `src/db/schema/items.ts:8` |

## Related References

- Isometric requirement mapping: `docs/isometric/schema-mapping.md`
- Conditional field triggers: `docs/isometric/condition-registry.md`
