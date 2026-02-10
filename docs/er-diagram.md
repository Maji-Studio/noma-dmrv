# ER Diagrams

Source of truth: `/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/src/db/schema/*.ts`

This is split into focused diagrams so relationships are legible.

## 1) Core Operations (Feedstock -> Production -> Delivery -> Application -> Credits)

```mermaid
erDiagram
  facilities ||--o{ reactors : contains
  facilities ||--o{ storage_locations : has
  facilities ||--o{ feedstock_deliveries : receives
  facilities ||--o{ feedstocks : records
  facilities ||--o{ production_runs : runs
  facilities ||--o{ biochar_products : produces
  facilities ||--o{ orders : receives
  facilities ||--o{ deliveries : ships
  facilities ||--o{ applications : applies
  facilities ||--o{ credit_batches : reports

  suppliers ||--o{ feedstock_deliveries : supplies
  suppliers ||--o{ feedstocks : supplies
  drivers ||--o{ feedstock_deliveries : drives
  drivers ||--o{ feedstocks : drives
  drivers ||--o{ deliveries : drives
  vehicles ||--o{ feedstock_deliveries : used_for
  vehicles ||--o{ deliveries : used_for
  feedstock_types ||--o{ feedstock_deliveries : classifies
  feedstock_types ||--o{ feedstocks : classifies
  feedstock_deliveries ||--o{ feedstocks : can_create

  feedstocks ||--o{ production_run_feedstocks : consumed_in
  production_runs ||--o{ production_run_feedstocks : uses
  production_runs ||--o{ production_run_readings : records
  production_runs ||--o{ samples : sampled_as
  production_runs ||--o{ incident_reports : can_have
  production_runs ||--o{ biochar_products : can_source
  operators ||--o{ production_runs : operates
  operators ||--o{ samples : collects
  operators ||--o{ incident_reports : reports
  reactors ||--o{ production_runs : used_by
  reactors ||--o{ samples : sampled_from
  reactors ||--o{ incident_reports : incident_on

  formulations ||--o{ biochar_products : recipe_for
  formulations ||--o{ orders : selected_in
  biochar_products ||--o{ orders : ordered_as
  biochar_products ||--o{ deliveries : delivered_as

  customers ||--o{ customer_locations : has
  customers ||--o{ orders : places
  customer_locations ||--o{ orders : destination
  customer_locations ||--o{ deliveries : optional_override
  orders ||--o{ deliveries : fulfilled_by
  deliveries ||--o{ applications : applied_via
  applications ||--o{ soil_temperature_measurements : measured_by

  credit_batches ||--o{ lab_analyses : includes
  samples ||--o{ lab_analyses : analyzed_as
  credit_batches ||--o{ credit_batch_applications : groups
  applications ||--o{ credit_batch_applications : grouped_in
```

## 2) Compliance, Evidence, and Emissions

```mermaid
erDiagram
  feedstocks ||--o{ feedstock_sc_assessments : assessed_by
  documents ||--o{ feedstock_sc_assessments : evidence_for

  credit_batches ||--o{ ghg_materiality_assessments : assessed_by

  documents ||--o{ custody_handoffs : attached_to

  feedstocks ||--o{ documents : can_attach_to
  feedstock_deliveries ||--o{ documents : can_attach_to
  production_runs ||--o{ documents : can_attach_to
  samples ||--o{ documents : can_attach_to
  incident_reports ||--o{ documents : can_attach_to
  biochar_products ||--o{ documents : can_attach_to
  deliveries ||--o{ documents : can_attach_to
  transport_legs ||--o{ documents : can_attach_to
  applications ||--o{ documents : can_attach_to
  credit_batches ||--o{ documents : can_attach_to
  lab_analyses ||--o{ documents : can_attach_to

  emission_factors {
    uuid id PK
    text country
    text fuel_type
    real emission_factor_kg_co2e_per_unit
    date valid_from
    date valid_to
  }
```

Notes:
- `documents` has a DB check that enforces exactly one owner FK per row.
- `transport_legs` uses a polymorphic (`entity_type`, `entity_id`) pattern for its transported entity; it is not a strict FK to each possible source table.
- `emission_factors` is a standalone lookup/config table used by calculations.

## 3) Isometric Sync + Auth/Legacy

```mermaid
erDiagram
  facilities ||--o{ isometric_projects : mapped_to
  isometric_sources ||--o{ isometric_monitoring_submissions : versions
  production_runs ||--o{ isometric_production_batches : versions
  applications ||--o{ isometric_storage_locations : versions
  applications ||--o{ isometric_biochar_applications : versions
  credit_batches ||--o{ isometric_removals : versions
  credit_batches ||--o{ isometric_ghg_statements : versions
  documents ||--o{ isometric_document_uploads : uploaded_as
  isometric_sync_events {
    uuid id PK
    text entity_type
    uuid entity_id
    text operation
    text status
  }

  users ||--o{ session : has
  users ||--o{ account : has
  users ||--o{ projects : owns
  users ||--o{ project_members : joins
  projects ||--o{ project_members : has
  projects ||--o{ items : contains
  verification {
    text id PK
    text identifier
    text value
    timestamp expires_at
  }
```
