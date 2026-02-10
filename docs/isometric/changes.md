# Isometric Docs Change Log

> This log tracks documentation updates only. It is not an authoritative policy source.

## Entry Template
### YYYY-MM-DD
- Scope: Biochar + Soil Storage
- Updated by: `<name>`
- Version changes:
  - Protocol: `<slug> <old> -> <new>`
  - Module: `<slug> <old> -> <new>`
- Source URLs checked:
  - `<authoritative URL>`
- Requirement deltas:
  - Added: `<count>`
  - Changed: `<count>`
  - Removed: `<count>`
  - Notes: `<threshold/formula/cadence/evidence changes>`
- Schema mapping deltas:
  - New `P0` gaps: `<count>`
  - Closed `P0` gaps: `<count>`
  - Notes: `<short summary>`
- Verification:
  - All shortlist rows include source reference + URL: `yes/no`
  - Non-authoritative warning preserved: `yes/no`

---

## 2026-02-09
- Scope: Biochar + Soil Storage
- Updated by: Codex
- Version changes:
  - Protocol: `biochar` pinned at `v1.2` (patch `1.2.0`)
  - Modules pinned: `biochar-storage-soil-environments v1.2`, `biomass-feedstock-accounting v1.3`, `energy-use-accounting v1.2`, `transportation v1.1`, `ghg-accounting v1.0`, `embodied-emissions v1.0`
- Requirement deltas:
  - Added: initial baseline
  - Changed: n/a
  - Removed: n/a
- Schema mapping deltas:
  - New `P0` gaps: initial baseline
  - Closed `P0` gaps: n/a

## 2026-02-10
- Scope: Phase 2 schema + validation alignment (greenfield reset)
- Updated by: Codex
- Schema/workflow changes:
  - Added condition registry and explicit schema review matrix with `required`, `conditional_required`, `optional`.
  - Added `customer_locations`; linked orders to required location; added optional delivery location override.
  - Added `deliveries.mass_dry_kg` and `deliveries.delivered_wet_mass_kg` with consistency checks.
  - Normalized core coordinate fields to `gps_latitude`/`gps_longitude` and added latitude/longitude range checks.
  - Kept `transport_legs` as canonical transport accounting model with row-local conditional checks.
  - Added Isometric lifecycle fields (`version`, `status`, `submitted_at`, `superseded_at`) across submission tables.
  - Added `isometric_sources` and `isometric_monitoring_submissions`.
  - Added compliance ledgers: `feedstock_sc_assessments`, `custody_handoffs`, `ghg_materiality_assessments`.
  - Added server-layer conditional validators and dry-mass derivation utility with tests.
- Migration deltas:
  - Replaced legacy migration baseline with fresh squashed baseline (`drizzle/0000_lowly_grim_reaper.sql`).
