# Condition Registry (Current Implementation)

This file is the canonical trigger map for `conditional_required` enforcement in the current repo state.

Requiredness levels:
- `required`: always mandatory.
- `conditional_required`: mandatory when trigger evaluates true.
- `optional`: never mandatory.

## Conditions

| condition_id | entity | trigger | required fields when triggered | enforcement (current state) |
|---|---|---|---|---|
| `transport.energy_usage` | `transport_legs` | Not supported | No energy-usage fields are stored on legs | Input schema exposes only `distance_based` |
| `biochar.third_party_sale` | `credit_batches` | Not supported | noma does not record third-party sales of biochar before application | No third-party sale fields are stored on credit batches; supporting a third-party sale requires a new design; registry requirements still apply |
| `transport.distance_based` | `transport_legs` | `calculation_method = distance_based` | Positive `load_mass_kg` for aggregation; distance and mode recorded per leg | DB check (`logistics.ts`: `distance_based` requires `load_mass_kg`) + schema validation + aggregation gate for mass and mixed methods/modes. Vehicle type and model year are evidence records; mixed values are advisory only. The removal template's fixed transport factor is not stored on legs |
| `durability.200_year` | `samples` + `applications` + `certifier_projects` | Facility tier is `200_year` | Sample-derived H/C_org; per-application soil temperature; facility reference soil temperature | Sample aggregation and submission gates; batch durability is derived, not entered |
| `durability.batch_sampling` | `credit_batches` (+ `samples`) | `durability_option = 200_year` and the batch is sampled | ≥ 3 **usable** replicates (complete H/C_org + O/C_org) pooled across the batch's member runs/days; the pooled mean must pass H/C_org < 0.5 AND O/C_org < 0.2 (module §3 Table 2) | Fail-closed removal-submission gate (`evaluateDurabilitySubmissionGates`, **credit-batch-grained** — Tier-1). Indeterminate chemistry fails closed. No within-batch run/day distribution is required or checked: §8.3.1 asks only that the ≥3 be representative of the batch's full range of physical characteristics (its distinct-days language governs Method B's cadence *across* batches). |
| `durability.1000_year` | `samples` + `facilities` | Facility tier is `1000_year` | Sample replicates: organic carbon, total carbon, inorganic carbon and s_fraction | Sample aggregation and submission gates; local preview uses the same replicate population |
| `sampling.unsampled_batch_eligibility` | `credit_batches` + `production_processes` + `samples` | a new batch chooses `sampling = unsampled` | Isometric organization credentials and facility project mapping; all three process prerequisites; eligible sampled-batch sample count since the current epoch ≥ the agreed baseline (minimum 30) | Transactional server validation at batch creation using `getMethodBEligibilityForProcess` and the canonical `countEligibleSamplesByProcess` read (ADR 0022). Eligibility is computed, not stored; the batch choice is immutable after creation. |
| `sample.nutrient_claim` | `samples` | nutrient claim flag = true | nutrient fields required when claim is made | Schema validation only |
| `documents.metadata_present` | `documents` | document row exists | `metadata` object (non-null) | DB default + schema validation |
| `application.evidence_method` | `applications` + `documents` | `evidence_method = visual` or `boundary` | visual evidence health: uploaded application photos for `metadata.evidenceRole in (stockpile, spreading, incorporation)` with `metadata.geotagStatus = present`; boundary evidence health: non-null `gis_boundary`. Typed application-mass records remain optional attachments and do not affect readiness. | Dashboard evidence health only. Application evidence does not block certification or Removal submission under the pinned Biochar Protocol v1.1 / Agricultural Soils v1.1 rules. An uploaded GeoJSON file is retained as a `gis_boundary` application document; a boundary entered through the paste path retains no source file. |
| `deliveries.dry_mass_relation` | `deliveries` | `mass_dry_kg` provided | `mass_dry_kg >= 0` and `mass_dry_kg <= delivered_wet_mass_kg` when wet mass exists | DB check + schema validation |
| `stockpile.exception_ref_required` | `stockpile_events` | `ended_at > started_at + interval '12 months'` | `exception_ref` must be non-null | Legacy DB check only, not a requirement of pinned Biochar v1.1.1 or Agricultural Soils v1.1.0. Neither specifies a 12-month stockpiling rule. |

## Ownership Terminology

`documents` uses polymorphic ownership (`entity_type` + `entity_id`) so evidence can attach to any tracked entity without adding entity-specific FK columns.
