# Simple Implementation Guide (P0/P1)

> Purpose: explain what each compliance topic means, what to store, what to derive, and why.
> Scope: current `biochar` + `biochar-storage-soil-environments` implementation planning.

## Design Principles

1. Store only what cannot be safely derived.
2. Keep one canonical table per concept.
3. Use documents as evidence links, not as a substitute for structured fields.
4. Enforce cross-row/cross-period rules in DB triggers for bypass-proof integrity.
5. Prefer simple status enums and dates over workflow-heavy state machines.

## Topic 1: Ineligible Biomass by Reporting Period

### What it means
The compliance decision is at Reporting Period (RP) level, not at single-feedstock-row level. A project can include some ineligible material, but if ineligible mass exceeds the threshold, removals are not creditable for that period.

### Minimal data model
- Add to `credit_batches`:
  - `total_feedstock_mass_kg`
  - `ineligible_feedstock_mass_kg`
- Add to `feedstocks`:
  - `eligibility_status` (`unknown`, `eligible`, `ineligible`)
  - `ineligibility_reason`

### Derive, do not store
- `ineligible_fraction_pct = ineligible_feedstock_mass_kg / total_feedstock_mass_kg * 100`
- `ineligible_threshold_exceeded = ineligible_fraction_pct > 25`

### Why this is simple and sufficient
- Feedstock row stores local classification.
- Credit batch stores RP summary masses.
- Compliance outcome is deterministic from two numbers.

## Topic 2: Stockpiling Controls

### What it means
Stored biochar must have time-bounded storage and periodic controls (condition/risk checks). Long storage windows require exception evidence.

### Minimal data model
- New table: `stockpile_events`
  - `facility_id`
  - `material_type` (biochar, feedstock)
  - `material_id`
  - `started_at`
  - `ended_at`
  - `last_control_at`
  - `risk_level` (`low`, `medium`, `high`)
  - `mitigation_notes`
  - `exception_ref`
  - `document_ref` (optional, nullable text — free-form reference to evidence document)

### Derive, do not store
- `duration_days = ended_at - started_at` (or `now - started_at` if open)
- `over_12_month_limit = duration_days > 365` (or policy-specific month logic)

### Why this is simple and sufficient
One row per stockpile window provides both duration and evidence linkage without extra lifecycle tables.

## Topic 3: Low-Carbon Power Evidence (EC1-EC5)

### What it means
If low-carbon electricity is claimed, auditable procurement evidence is needed (contract, retirement, timing/matching, region/COD constraints).

### Minimal data model
- New table: `power_procurement_evidence`
  - `facility_id`
  - `period_start`
  - `period_end`
  - `contract_type`
  - `generator_cod_date`
  - `grid_region`
  - `matching_type` (`hourly`, `annual`, etc.)
  - `eac_registry`
  - `eac_retirement_id`
  - `retired_at`
  - `document_ref` (nullable text — free-form reference to evidence document)
  - `notes`

### Derive, do not store
- EC1-EC5 individual pass/fail outcomes — computed by app logic from the stored evidence fields (contract type, COD date, matching type, retirement ID, etc.)
- `ec_overall_pass` — derived from individual EC assessments

### Why this is simple and sufficient
This keeps legal/evidence artifacts structured without implementing full contract/accounting subsystems.

## Topic 4: BCU Retirement and Anti-Double-Counting

### What it means
Book-and-Claim Unit (BCU) usage needs retirement proof and an attestation that the same claim is not counted elsewhere.

### Minimal data model
- Extend `transport_legs`:
  - `bcu_registry`
  - `bcu_retirement_tx_id`
  - `bcu_retired_at`
  - `bcu_claim_id`
  - `bcu_no_double_count_attested` (boolean)
  - `bcu_attestation_document_id`

### Derive, do not store
- No extra derived metrics needed for baseline enforcement.

### Why this is simple and sufficient
Leg-level fields keep BCU evidence attached exactly where transport emissions are claimed.

## Topic 5: Amortization Review Schedule

### What it means
Some emissions are allocated across time and must be reviewed at fixed checkpoints (year 1, 3, 5, renewal).

### Minimal data model
- Add to `credit_batches`:
  - `amortization_rule`
  - `amortization_basis`
  - `amortized_establishment_tco2e`
  - `amortized_end_of_life_tco2e`
- New table: `amortization_review_events`
  - `credit_batch_id`
  - `milestone` (`y1`, `y3`, `y5`, `renewal`)
  - `completed_at`
  - `status`
  - `notes`
  - `document_id`

### Derive, do not store
- `due_date` can be derived from batch anchor date + milestone offset.

### Why this is simple and sufficient
Store only completed/relevant review events; compute schedule dates in query/API logic.

## Topic 6: Embodied Emissions Inventory

### What it means
Embodied emissions must be reproducible from explicit materials/equipment inventory and factor sources.

### Minimal data model
- New table: `embodied_inventory_items`
  - `credit_batch_id`
  - `category` (`equipment`, `material`)
  - `item_name`
  - `quantity`
  - `unit`
  - `factor_value`
  - `factor_unit`
  - `factor_source_ref`
  - `verification_status`
  - `document_id`

### Derive, do not store
- `item_emissions_tco2e = quantity * factor_value` (unit-normalized in calc layer)
- Batch total from sum of item emissions.

### Why this is simple and sufficient
One normalized table supports reproducibility, verification, and audit trails without over-modeling suppliers/products.

## Topic 7: Cross-Row Guardrails (DB Triggers)

### What it means
Some rules depend on aggregate history or state transitions and cannot be guaranteed by single-row checks.

### Required trigger guardrails
1. Method B minimum samples before unlocking `production_processes.sampling_method = method_b` (ADR 0015: regime moved off `reactors`; the reactor-grain `0052` trigger was dropped in `0057`, and the process-grain replacement is deferred to ADR 0016).
2. Method B cadence check on `credit_batches` transition to `verified`/`issued`.
3. Durability field immutability once `credit_batches.status` is `verified` or `issued`.

### Why timestamps are not enough
- `last_edit_date` only records change; it does not block invalid writes.
- Trigger guardrails prevent bypass writes from direct SQL, scripts, or backfills.

## LCA Export Alignment (From Project PDF)

The shared LCA export indicates:
- explicit report metadata (`project`, `status`, `export_generated_at`),
- amortization language (establishment and end-of-life allocated by selected rule),
- component-level factor/source references.

### Minimal support model
- New table: `lca_reports`
  - `credit_batch_id`
  - `external_report_id`
  - `status`
  - `export_generated_at`
  - `protocol_slug`
  - `protocol_version`
  - `source_file_url`

This keeps LCA evidence linked without duplicating all report content in internal tables.

## Abbreviations and Terms

| Term | Meaning |
|---|---|
| `RP` | Reporting Period |
| `PDD` | Project Design Document |
| `GHG` | Greenhouse Gas |
| `CO2e` | Carbon-dioxide equivalent |
| `LCA` | Life Cycle Assessment |
| `BCU` | Book-and-Claim Unit |
| `EAC` | Energy Attribute Certificate |
| `PPA` | Power Purchase Agreement |
| `COD` | Commercial Operation Date (generator start date) |
| `EC1..EC5` | Eligibility criteria set for low-carbon power procurement evidence |
| `SSR` | Source/Stream/Scope of emissions (materiality context in GHG accounting) |
| `EPD` | Environmental Product Declaration |
| `CI` | Carbon Intensity |
| `Method A / Method B` | Biochar sampling pathways in protocol requirements |
| `Durability` | Fraction of carbon counted as durably stored (e.g., 200-year or 1000-year pathway) |

## Suggested Implementation Order (Least Risk)

1. Ineligible biomass RP summary fields.
2. Stockpile events table.
3. DB trigger guardrails for Method B and durability immutability.
4. BCU leg-level retirement/attestation fields.
5. Power procurement evidence table.
6. Amortization fields and review events.
7. Embodied inventory items.
8. LCA report linkage table.
