# Condition Registry (Phase 2)

This file is the canonical trigger map for `conditional_required` enforcement.

Requiredness levels:
- `required`: always mandatory.
- `conditional_required`: mandatory when trigger evaluates true.
- `optional`: never mandatory.

## Conditions

| condition_id | entity | trigger | required fields when triggered | enforcement |
|---|---|---|---|---|
| `transport.energy_usage` | `transport_legs` | `calculation_method = energy_usage` | `fuel_type`, one of (`fuel_consumed_liters`, `electricity_kwh`), `emission_factor_used` | DB check + schema validation |
| `transport.distance_based` | `transport_legs` | `calculation_method = distance_based` | `load_mass_kg`, `vehicle_type`, `emission_factor_used` | DB check + schema validation |
| `durability.200_year` | `credit_batches` | `durability_option = 200_year` | `soil_temperature_c`, `h_to_c_org_ratio` | DB check + schema validation |
| `durability.1000_year` | `credit_batches` | `durability_option = 1000_year` | `mean_random_reflectance_percent`, `mean_non_reactive_carbon_percent` | DB check + schema validation |
| `sample.nutrient_claim` | `samples` | `nutrient_claim_enabled = true` | `phosphorus_g_per_kg`, `potassium_g_per_kg`, `magnesium_g_per_kg`, `calcium_g_per_kg`, `iron_g_per_kg` | DB check + schema validation |
| `production.continuous_gas_measurement` | `production_run_readings` | `continuous_gas_measurement = true` | `ch4_ppm`, `n2o_ppm`, `co_ppm`, `co2_ppm` | DB check + schema validation |
| `documents.metadata_present` | `documents` | document row exists | `metadata` object (non-null) | DB default + schema validation |
| `documents.photo_video_capture_time` | `documents` | `document_type in (photo, video)` | `captured_at` | DB check + schema validation |
| `deliveries.dry_mass_relation` | `deliveries` | `mass_dry_kg` provided | `mass_dry_kg >= 0` and `mass_dry_kg <= delivered_wet_mass_kg` when wet mass exists | DB check + schema validation |

## Ownership Terminology

`documents` uses explicit FK ownership (`feedstock_id`, `delivery_id`, `transport_leg_id`, etc.) with exactly one owner per row. Legacy polymorphic ownership (`entity_type`/`entity_id`) is not used.
