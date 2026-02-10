# Phase 2 Plan (Greenfield Reset): Schema + Validation Alignment

## Context Reset (Locked)
This project currently has **no production system**. For Phase 2 we optimize for correctness and clarity, not backward compatibility.

What this allows us to do:
- Make breaking schema changes freely.
- Remove duplicate/legacy columns instead of carrying aliases.
- Squash and re-baseline migrations.
- Enforce strict validation from day 1 (no long warning period needed).
- Absorb useful backlog from legacy planning artifacts and retire them.

## Primary Goal
Create one coherent data model where:
- requiredness is explicit (`required`, `conditional_required`, `optional`),
- transport/durability logic is method-driven,
- core schema stays certifier-agnostic,
- Isometric integration remains in `isometric_*` tables.

## Locked Decisions
| # | Decision | Final direction |
|---|---|---|
| 1 | Customer with multiple locations | Add `customer_locations`; link order to a location. |
| 2 | Delivery dry mass | Add `deliveries.mass_dry_kg`; allow deterministic derivation helper during ingest. |
| 3 | Transport source of truth | `transport_legs` is canonical; delivery-level transport fields become derived summary or are removed. |
| 4 | `conditional_required` enforcement | Enforce in app validation + DB checks where condition is row-local. |
| 5 | Documentation requirements | Use a document requirement matrix by process step/method; document metadata required when document row exists. |
| 6 | Nutrient fields requirement | Required only when nutrient/fertilizer claim pathway is used. |
| 7 | PPM requirement | Required only when continuous gas measurement pathway is selected. |
| 8 | Rollout style | Strict enforcement immediately (pre-production context). |
| 9 | Coordinate model | Standardize on `gps_latitude`/`gps_longitude`; remove legacy `gps_lat`/`gps_lng`. |

## Target Requiredness Model
- `required`: always mandatory.
- `conditional_required`: mandatory when trigger condition is true.
- `optional`: never mandatory.

`conditional_required` examples:
- Transport `energy_usage` => fuel fields required.
- Transport `distance_based` => distance/load/vehicle class fields required.
- Durability `200_year` => soil temperature evidence required.
- Fertilizer/nutrient claim => nutrient declarations required.

## Execution Plan

### Phase A: Policy Canonicalization
1. Add a condition registry file (`docs/isometric/condition-registry.md` or `.json`) with explicit triggers and required fields.
2. Update schema review artifacts to include `conditional_required`.
3. Reconcile terminology (`documents` explicit FK ownership, not legacy polymorphic `documentation.entity_type/entity_id`).

Deliverables:
- Condition registry.
- Updated review taxonomy and rule mapping.

### Phase B: Core Schema Refactor (Breaking Allowed)
1. **Customer locations**
   - Add `customer_locations` table:
     - `id`, `customer_id`, `name`, `gps_latitude`, `gps_longitude`, `address`, timestamps.
   - Add `orders.customer_location_id` (required).
   - Keep `deliveries` location override optional only if real delivery differs from order destination.

2. **Delivery dry mass**
   - Add `deliveries.mass_dry_kg`.
   - Add check constraint: `mass_dry_kg >= 0` and (if both present) `mass_dry_kg <= delivered_wet_mass`.

3. **Transport normalization**
   - Keep `transport_legs` as canonical for method, factors, and per-leg emissions.
   - Remove or clearly mark delivery transport fields as derived cache fields.
   - Ensure required columns for both transport methods are represented.

4. **Coordinates normalization**
   - Remove legacy `gps_lat`/`gps_lng` from core tables.
   - Keep only `gps_latitude`/`gps_longitude`.
   - Add range checks: latitude [-90, 90], longitude [-180, 180].

5. **Schema mismatch cleanup**
   - Align nullability with policy for fields currently “required in docs but nullable in DB”.
   - Preserve optionality for true method-conditional fields.

Deliverables:
- Updated Drizzle schema files.
- New migration set (squashed baseline).

### Phase C: Validation and Rules Engine
1. Implement condition-aware validators in server action layer.
2. Use explicit error messages:
   - Example: `load_mass_kg is required when calculation_method=distance_based`.
3. Enforce cross-field invariants that DB cannot safely express.

Deliverables:
- Validation utilities.
- Unit tests for condition logic.

### Phase D: Calculations and Derivation Helpers
1. Add deterministic derivation utility for `mass_dry_kg` when source inputs exist:
   - `mass_dry_kg = mass_wet_kg * (1 - moisture_percent/100)`.
2. Mark records as non-credit-ready when derivation inputs are missing.
3. Keep explicit override path when measured dry mass is available.

Deliverables:
- Derivation utility + tests.
- Clear precedence rule (measured > derived).

### Phase E: Reset, Seed, Verify
1. Squash migrations to clean baseline.
2. Reset local DB and reseed canonical fixtures.
3. Run integration tests on create/update flows for affected entities.

Deliverables:
- New baseline migration.
- Passing tests with strict validation enabled.

### Phase F: Imported Backlog from Former `schema-delta.csv`
The following items are explicitly carried forward from the legacy delta inventory and are in scope for implementation:

1. **Storage location alignment**
   - Add canonical `latitude`/`longitude` for storage locations.
   - Add optional Isometric mapping helpers (`isometric_storage_method`, `isometric_description`, `isometric_supplier_reference_id`).

2. **Application payload completeness**
   - Add `average_application_rate_magnitude` and `average_application_rate_unit`.

3. **Isometric source/monitoring objects**
   - Add `isometric_sources`.
   - Add `isometric_monitoring_submissions`.

4. **Isometric resubmission lifecycle support**
   - Add lifecycle fields (`version`, `submitted_at`, `superseded_at`, `status`) on:
     - `isometric_production_batches`
     - `isometric_storage_locations`
     - `isometric_biochar_applications`
     - `isometric_removals`
     - `isometric_ghg_statements`
   - Relax one-shot uniqueness constraints where multi-submit history is needed.

5. **Compliance ledgers**
   - Add `feedstock_sc_assessments`.
   - Add `custody_handoffs`.
   - Add `ghg_materiality_assessments`.

## Migration Strategy (Pre-Production)
Because no production data compatibility is required:
1. Replace legacy migration chain with a new squashed baseline.
2. Drop deprecated columns directly (instead of long deprecation windows).
3. Regenerate seed data to match final schema.

## Acceptance Criteria
- Every stakeholder comment is mapped to a concrete schema/validation action.
- No unresolved contradiction between docs requiredness and DB nullability.
- Transport and durability pathways enforce method-conditional requiredness.
- Customer multi-location and delivery dry mass are first-class.
- Core schema uses canonical coordinate columns only.
- `transport_legs` is the transport accounting source of truth.

## Out of Scope
- Re-pinning Isometric versions in `versions.json`.
- Expanding certifier-specific models beyond `isometric_*` integration boundaries.

## Immediate Next Actions
1. Create the condition registry file.
2. Update `schema-review.csv` requiredness labels to include `conditional_required`.
3. Implement schema refactor in Drizzle files and generate a fresh baseline migration.
4. Implement validators and tests.
5. Remove legacy `schema-delta.csv` from the active docs set (absorbed into this plan).
