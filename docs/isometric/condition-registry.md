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
| `durability.batch_sampling` | `credit_batches` (+ `samples`) | `durability_option = 200_year` and the batch is sampled | ≥ 3 **usable** replicates (complete H/C_org + O/C_org) pooled across the batch's member runs/days; the pooled mean must pass H/C_org < 0.5 AND O/C_org < 0.2 (module §3 Table 2) | Fail-closed removal-submission gate (`evaluateDurabilitySubmissionGates`, **credit-batch-grained** — Tier-1). Indeterminate chemistry fails closed. No within-batch run/day distribution is required or checked: §8.3.1 asks only that the ≥3 be representative of the batch's full range of physical characteristics (its distinct-days language governs Method B's cadence *across* batches). |
| `durability.1000_year` | `credit_batches` | `durability_option = 1000_year` | `mean_random_reflectance_percent`, `mean_non_reactive_carbon_percent` | DB check + schema validation |
| `sampling.unsampled_batch_eligibility` | `credit_batches` + `production_processes` + `samples` | a new batch chooses `sampling = unsampled` | Isometric organization credentials and facility project mapping; all three process prerequisites; eligible sampled-batch sample count since the current epoch ≥ the agreed baseline (minimum 30) | Transactional server validation at batch creation using `getMethodBEligibilityForProcess` and the canonical `countEligibleSamplesByProcess` read (ADR 0022). Eligibility is computed, not stored; the batch choice is immutable after creation. |
| `durability.lock_after_verification` | `credit_batches` | `status in (verified, issued)` on `UPDATE` | durability fields become immutable (`durability_option`, durability inputs, durability output) | Planned (not implemented in current migration) |
| `sample.nutrient_claim` | `samples` | nutrient claim flag = true | nutrient fields required when claim is made | Schema validation only |
| `documents.metadata_present` | `documents` | document row exists | `metadata` object (non-null) | DB default + schema validation |
| `application.evidence_method` | `applications` + `documents` | `evidence_method = visual` or `boundary` | visual evidence health: uploaded application photos for `metadata.evidenceRole in (stockpile, spreading, incorporation)` with `metadata.geotagStatus = present`; boundary evidence health: non-null `gis_boundary`. Typed application-mass records remain optional attachments and do not affect readiness. | Dashboard evidence health only. Application evidence does not block certification or Removal submission under the pinned Biochar Protocol v1.1 / Agricultural Soils v1.1 rules. An uploaded GeoJSON file is retained as a `gis_boundary` application document; a boundary entered through the paste path retains no source file. |
| `deliveries.dry_mass_relation` | `deliveries` | `mass_dry_kg` provided | `mass_dry_kg >= 0` and `mass_dry_kg <= delivered_wet_mass_kg` when wet mass exists | DB check + schema validation |
| `stockpile.exception_ref_required` | `stockpile_events` | `ended_at > started_at + interval '12 months'` | `exception_ref` must be non-null | DB check |

## Ownership Terminology

`documents` uses polymorphic ownership (`entity_type` + `entity_id`) so evidence can attach to any tracked entity without adding entity-specific FK columns.
