# Isometric Docs Change Log

> Tracks documentation updates only. Not an authoritative policy source.
> Note: historical entries may reference pre-squash migration filenames that are no longer present in the current repo baseline.

## 2026-02-11

- **Scope:** Detailed implementation guidance and glossary
- **Updated by:** Codex
- Docs changes:
  - Added `simple-implementation-guide.md` with topic-by-topic implementation notes for ineligible biomass, stockpiling, power procurement evidence, BCU, amortization, embodied inventory, and trigger guardrails.
  - Added plain-language explanations for derived-vs-stored field decisions.
  - Added abbreviation glossary (RP, EC1-EC5, BCU, EAC, PPA, COD, EPD, etc.).
  - Updated `README.md` to include and route readers to the new guide.

- **Scope:** Documentation reconciliation to current schema baseline
- **Updated by:** Codex
- Docs changes:
  - Rewrote `schema-mapping.md` to match current table/column names and live implementation status in `src/db/schema/*`.
  - Corrected `condition-registry.md` enforcement statuses to distinguish implemented checks from planned (not yet migrated) trigger guardrails.
  - Added `p0-compliance-checklist.md` as an execution checklist table for highest-priority compliance gaps.
  - Updated `README.md` index and freshness date for the isometric docs set.
- Baseline references used:
  - `drizzle/0000_blue_mastermind.sql`
  - `src/db/schema/*`

## 2026-02-11

- **Scope:** Sampling method enforcement baseline
- **Updated by:** Codex
- Schema/workflow changes:
  - Added `sampling_method` enum (`method_a`, `method_b`) and moved ownership to `reactors.sampling_method` (default `method_a`).
  - Removed sampling-method storage from `facilities` and `credit_batches`.
  - Added server-side Method B eligibility evaluation for reactor-level selection (minimum 30 prior samples).
  - Added DB trigger guardrail to block ineligible `reactors.sampling_method=method_b`.
  - Added DB trigger guardrail on `credit_batches` to enforce Method B cadence (>=1 sampled run per 10 runs) for reactors configured with Method B.
  - Updated Isometric condition registry and schema mapping entries for sampling-method rules.
- Migration: guardrails and columns updated in `drizzle/0000_lowly_grim_reaper.sql`.

- **Scope:** Durability immutability guardrail
- **Updated by:** Codex
- Schema/workflow changes:
  - Added DB trigger guardrail to freeze `credit_batches` durability fields once batch status is `verified` or `issued`.
  - Documented the guardrail in the condition registry as `durability.lock_after_verification`.
- Migration: guardrail SQL squashed into `drizzle/0000_lowly_grim_reaper.sql`.

## 2026-02-10

- **Scope:** Phase 2 schema + validation alignment (greenfield reset)
- **Updated by:** Codex
- Schema/workflow changes:
  - Added condition registry and explicit requiredness model (`required`, `conditional_required`, `optional`).
  - Added `customer_locations`; linked orders to required location; added optional delivery location override.
  - Added `deliveries.mass_dry_kg` and `deliveries.delivered_wet_mass_kg` with consistency checks.
  - Normalized coordinates to `gps_latitude`/`gps_longitude` with range checks.
  - `transport_legs` confirmed as canonical transport accounting model.
  - Added Isometric lifecycle fields (`version`, `status`, `submitted_at`, `superseded_at`) on submission tables.
  - Added `isometric_sources` and `isometric_monitoring_submissions`.
  - Added compliance ledgers: `feedstock_sc_assessments`, `custody_handoffs`, `ghg_materiality_assessments`.
  - Added server-layer conditional validators and dry-mass derivation utility with tests.
- Migration: replaced legacy baseline with squashed `drizzle/0000_lowly_grim_reaper.sql`.

## 2026-02-09

- **Scope:** Biochar + Soil Storage initial baseline
- **Updated by:** Codex
- Protocol `biochar` pinned at v1.2 (patch 1.2.0).
- Modules pinned: `biochar-storage-soil-environments v1.2`, `biomass-feedstock-accounting v1.3`, `energy-use-accounting v1.2`, `transportation v1.1`, `ghg-accounting v1.0`, `embodied-emissions v1.0`.
- Initial requirements shortlist and schema mapping created.
