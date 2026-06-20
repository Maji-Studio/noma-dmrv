# Condition Registry (Current Implementation)

This file is the canonical trigger map for `conditional_required` enforcement in the current repo state.

Requiredness levels:
- `required`: always mandatory.
- `conditional_required`: mandatory when trigger evaluates true.
- `optional`: never mandatory.

## Conditions

| condition_id | entity | trigger | required fields when triggered | enforcement (current state) |
|---|---|---|---|---|
| `transport.energy_usage` | `transport_legs` | `calculation_method = energy_usage` | `fuel_type`, one of (`fuel_consumed_liters`, `electricity_kwh`), `emission_factor_used` | DB check + schema validation |
| `transport.distance_based` | `transport_legs` | `calculation_method = distance_based` | `load_mass_kg`, `vehicle_type`, `emission_factor_used` | DB check + schema validation |
| `durability.200_year` | `credit_batches` + `applications` + `certifier_projects` | `durability_option = 200_year` | `credit_batches.h_to_c_org_ratio` (batch); per-application `applications.soil_temperature_c` + `applications.soil_temperature_source` (verified/issued gate); facility reference `certifier_projects.default_soil_temperature_c` + `default_soil_temperature_source` (submission gate) | DB check at verified/issued (migrations `0053`/`0054`) + schema validation. **Tier-1 (2026-06-20):** soil temperature submits as the operator-declared **facility reference** (`resolveFacilityReferenceSoilTemperature`, 7 °C floor), fail-closed at removal submission; per-application temp becomes a future per-removal override. |
| `durability.batch_sampling` | `credit_batches` (+ `samples`) | `durability_option = 200_year` and the batch is sampled | ≥ 3 **usable** replicates (complete H/C_org + O/C_org) pooled across the batch's member runs/days; the pooled mean must pass H/C_org < 0.5 AND O/C_org < 0.2 (module §3 Table 2) | Fail-closed removal-submission gate (`evaluateDurabilitySubmissionGates`, **credit-batch-grained** — Tier-1). Indeterminate chemistry fails closed; a non-blocking warning fires when usable replicates cluster on one run/day (§8.3.1 expects them distributed). |
| `durability.1000_year` | `credit_batches` | `durability_option = 1000_year` | `mean_random_reflectance_percent`, `mean_non_reactive_carbon_percent` | DB check + schema validation |
| `sampling.process_method_b_minimum_samples` | `production_processes` | `sampling_method = method_b` | minimum 30 prior samples in the process | ADR 0017 Track 1 implements the process-grained baseline counter (`getMethodBEligibilityByProcess` / `countEligibleSamplesByProcess`) and read-only `/production-processes` progress. The explicit unlock action and DB backstop remain Track 2 work; Method B is inert today. |
| `sampling.credit_batch_method_b_cadence` | `credit_batches` | process `sampling_method = method_b` | sampled credit batches in period must satisfy `>= 1/10` cadence | ADR 0017 Track 1 re-grains the cadence engine to credit batches (`deriveSamplingRequirement`). The operator surface shows lifetime process cadence; Track 2 must pass process-level cadence facts into any live Method-B submission gate. |
| `durability.lock_after_verification` | `credit_batches` | `status in (verified, issued)` on `UPDATE` | durability fields become immutable (`durability_option`, durability inputs, durability output) | Planned (not implemented in current migration) |
| `sample.nutrient_claim` | `samples` | nutrient claim flag = true | nutrient fields required when claim is made | Schema validation only |
| `documents.metadata_present` | `documents` | document row exists | `metadata` object (non-null) | DB default + schema validation |
| `application.evidence_method` | `applications` + `documents` | `evidence_method = visual` or `boundary` | visual: uploaded application photos for `metadata.evidenceRole in (stockpile, spreading, incorporation)` with `metadata.geotagStatus = present`; boundary: nonblank `gis_boundary_reference` plus typed logbook evidence (`metadata.logbookEvidenceType in (weighbridge, inventory, affidavit)` or semantic document type) | Certification readiness check (`buildApplicationEvidenceGaps`) + dashboard evidence health. Upload accepts photos missing EXIF and records the gap in metadata rather than rejecting. |
| `deliveries.dry_mass_relation` | `deliveries` | `mass_dry_kg` provided | `mass_dry_kg >= 0` and `mass_dry_kg <= delivered_wet_mass_kg` when wet mass exists | DB check + schema validation |
| `stockpile.exception_ref_required` | `stockpile_events` | `ended_at > started_at + interval '12 months'` | `exception_ref` must be non-null | DB check |

## Ownership Terminology

`documents` uses polymorphic ownership (`entity_type` + `entity_id`) so evidence can attach to any tracked entity without adding entity-specific FK columns.
