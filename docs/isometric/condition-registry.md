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
| `durability.200_year` | `credit_batches` + `applications` | `durability_option = 200_year` | `credit_batches.h_to_c_org_ratio` (batch), `applications.soil_temperature_c` + `applications.soil_temperature_source` (site) | DB check (credit batch only) + schema validation |
| `durability.1000_year` | `credit_batches` | `durability_option = 1000_year` | `mean_random_reflectance_percent`, `mean_non_reactive_carbon_percent` | DB check + schema validation |
| `sampling.process_method_b_minimum_samples` | `production_processes` | `sampling_method = method_b` | minimum 30 prior samples in the process | Server validation (`validateReactorSamplingMethodFn`, reactor-grain pending Phase 2 re-grain to `…ByProcess`). **ADR 0015:** sampling moved off `reactors` to `production_processes` and the migration-`0052` DB trigger was dropped (`0057`); the process-grain DB trigger ships with the ADR 0016 Method-B unlock. |
| `sampling.credit_batch_method_b_cadence` | `credit_batches` | process `sampling_method = method_b` | sampled credit batches in period must satisfy `>= 1/10` cadence | Cadence engine implemented (`deriveSamplingRequirement` + `METHOD_B_SAMPLING_CADENCE_RUNS`), derived from the reactor's live method (D6). Removal submission hard-blocks eligibility (H/C_org < 0.5 AND O/C_org < 0.2 on the per-run mean), every Method A run sampled, and ≥3 replicates per sampled run (`evaluateDurabilitySubmissionGates`). Reactor list + removal readiness surface cadence/eligibility status. **ADR 0015 (Phase 2–4, not yet built):** the unit becomes the credit batch and cadence groups per process; current code is still run/reactor-grained. The DB-trigger guardrail is deferred to ADR 0016. |
| `durability.lock_after_verification` | `credit_batches` | `status in (verified, issued)` on `UPDATE` | durability fields become immutable (`durability_option`, durability inputs, durability output) | Planned (not implemented in current migration) |
| `sample.nutrient_claim` | `samples` | nutrient claim flag = true | nutrient fields required when claim is made | Schema validation only |
| `documents.metadata_present` | `documents` | document row exists | `metadata` object (non-null) | DB default + schema validation |
| `application.evidence_method` | `applications` + `documents` | `evidence_method = visual` or `boundary` | visual: uploaded application photos for `metadata.evidenceRole in (stockpile, spreading, incorporation)` with `metadata.geotagStatus = present`; boundary: nonblank `gis_boundary_reference` plus typed logbook evidence (`metadata.logbookEvidenceType in (weighbridge, inventory, affidavit)` or semantic document type) | Certification readiness check (`buildApplicationEvidenceGaps`) + dashboard evidence health. Upload accepts photos missing EXIF and records the gap in metadata rather than rejecting. |
| `deliveries.dry_mass_relation` | `deliveries` | `mass_dry_kg` provided | `mass_dry_kg >= 0` and `mass_dry_kg <= delivered_wet_mass_kg` when wet mass exists | DB check + schema validation |
| `stockpile.exception_ref_required` | `stockpile_events` | `ended_at > started_at + interval '12 months'` | `exception_ref` must be non-null | DB check |

## Ownership Terminology

`documents` uses polymorphic ownership (`entity_type` + `entity_id`) so evidence can attach to any tracked entity without adding entity-specific FK columns.
