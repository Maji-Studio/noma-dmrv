Ready to code?

Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
Meeting Analysis: Schema & Requirements Gap Assessment

Context

Analysis of an operational meeting discussing the DMRV
workflow — from feedstock arrival through production, biochar
output, mixing, delivery, and credit issuance — compared
against the current database schema (17 core tables) and
Isometric requirements documentation (73 requirements, 15 P0
gaps).

---

1.  Key Decisions from Meeting

#: 1
Decision: Moisture content mandatory on every feedstock
delivery
Impact: Schema change: feedstock_deliveries.moisture_percent
→
NOT NULL
────────────────────────────────────────
#: 2
Decision: Dry mass is THE stable tracking value everywhere
Impact: Design principle: always store wet mass + moisture →
compute dry mass
────────────────────────────────────────
#: 3
Decision: Bins need inventory tracking (add/remove with dry
mass balance)
Impact: New capability: running balance per storage_location
────────────────────────────────────────
#: 4
Decision: Short-term vs long-term bins for feedstock (both go

through feedstocks table)
Impact: Current storage_location_type enum already supports
this
────────────────────────────────────────
#: 5
Decision: Production run input: choose bin → take X kg →
re-measure moisture → auto-update bin
Impact: Workflow change to production_run_feedstocks
────────────────────────────────────────
#: 6
Decision: Biochar output needs moisture content (wet mass +
moisture → dry mass)
Impact: Schema change on production_runs
────────────────────────────────────────
#: 7
Decision: Biochar bins before product mixing — raw biochar
goes to biochar bin, then optionally mixed with manure into

BCF bin
Impact: formulation_id should be optional on biochar_products
────────────────────────────────────────
#: 8
Decision: Mixing operation: biochar bin + manure bin → BCF
bin
(track dry biochar mass in mix)
Impact: New mixing workflow needed
────────────────────────────────────────
#: 9
Decision: Production readings split: flow/pressure/temp =
per-run; CH4/CO2/N2O composition = per-batch
Impact: Move emission compositions to credit_batches or
emission_factors
────────────────────────────────────────
#: 10
Decision: Samples split: production samples (every ~2h) vs
credit batch samples (once per batch for heavy metals)
Impact: Need credit_batch_id linkage on samples
────────────────────────────────────────
#: 11
Decision: Fixed carbon comes from batch, not measured per
delivery
Impact: deliveries.fixed_carbon_percent should auto-populate
from batch
────────────────────────────────────────
#: 12
Decision: Delivery needs moisture content to calculate dry
mass
Impact: Add moisture_content_percent to deliveries
────────────────────────────────────────
#: 13
Decision: Method A requires soil temperature, Method B does
not
Impact: Already in condition-registry, needs UI enforcement
────────────────────────────────────────
#: 14
Decision: Feedstock types: manual entry with link to
Isometric
registry page
Impact: Add registry_url to feedstock_types
────────────────────────────────────────
#: 15
Decision: Materiality/SSR emissions: just link to registry,
don't replicate in DMRV
Impact: Current ghg_materiality_assessments table is
over-engineered for now
────────────────────────────────────────
#: 16
Decision: Transport legs for biochar/BCF delivery only
(feedstock transport in delivery table)
Impact: Already supported by polymorphic entity_type

---

2.  Schema Alignment Analysis

2.1 Feedstock Delivery → Bin → Production (PARTIALLY ALIGNED)

Meeting workflow:
Truck arrives → Document in feedstock_delivery (wet mass +
moisture)
→ Transfer to bin (short-term or long-term) = feedstocks
table
→ Take from bin for production =
production_run_feedstocks
→ Auto-update bin balance

Current schema flow:
feedstock_deliveries (weight_kg, moisture_percent)
→ feedstocks (mass_wet_kg, mass_dry_kg,
moisture_content_percent, storage_location_id)
→ production_run_feedstocks (feedstock_id, mass_used_kg)

What's aligned:

- feedstock_deliveries → feedstocks →
  production_run_feedstocks chain exists
- feedstocks has wet mass, dry mass, moisture content, and
  links to storage location
- storage_location_type enum has feedstock_bin and
  feedstock_pile (maps to short/long-term)

Gaps identified:

Gap: feedstock_deliveries.moisture_percent is nullable
Current State: Optional field
What's Needed: Make NOT NULL (meeting: "mandatory for
inventory")
────────────────────────────────────────
Gap: feedstock_deliveries has no mass_dry_kg
Current State: Only weight_kg + moisture_percent
What's Needed: Add computed mass_dry_kg or calculate in app
layer
────────────────────────────────────────
Gap: No bin inventory balance
Current State: storage_locations.capacity_kg only
What's Needed: Need current_dry_mass_kg running balance or
transaction ledger
────────────────────────────────────────
Gap: production_run_feedstocks missing moisture
re-measurement
Current State: Only mass_used_kg
What's Needed: Add moisture_content_percent + mass_dry_kg for

the material taken out
────────────────────────────────────────
Gap: No auto-update of bin when material removed
Current State: No logic exists
What's Needed: Need application logic or DB trigger to
decrement bin balance

2.2 Dry Mass as Primary Value (PARTIALLY ALIGNED)

Meeting principle: "The dry mass is the stable value we
should focus on." Everywhere: wet mass + moisture content →
dry mass. The dry mass never changes (unlike wet mass which
varies with moisture).

Current coverage by table:

Table: feedstock_deliveries
Wet Mass: weight_kg
Moisture %: moisture_percent
Dry Mass: --
Status: Missing dry mass
────────────────────────────────────────
Table: feedstocks
Wet Mass: mass_wet_kg
Moisture %: moisture_content_percent
Dry Mass: mass_dry_kg
Status: Complete
────────────────────────────────────────
Table: production_run_feedstocks
Wet Mass: --
Moisture %: --
Dry Mass: --
Status: Only has mass_used_kg (ambiguous wet/dry)
────────────────────────────────────────
Table: production_runs (output)
Wet Mass: --
Moisture %: --
Dry Mass: --
Status: Only biochar_output_kg (ambiguous)
────────────────────────────────────────
Table: biochar_products
Wet Mass: --
Moisture %: --
Dry Mass: --
Status: Only mass_kg (ambiguous)
────────────────────────────────────────
Table: deliveries
Wet Mass: delivered_wet_mass_kg
Moisture %: --
Dry Mass: mass_dry_kg
Status: Missing moisture content
────────────────────────────────────────
Table: applications
Wet Mass: biochar_applied_tons
Moisture %: --
Dry Mass: biochar_applied_dry_tons
Status: OK but no moisture %

Pattern needed everywhere: mass_wet_kg +
moisture_content_percent → mass_dry_kg (calculated)

2.3 Biochar Output & Bins (GAP)

Meeting: Biochar comes out of machine → measure wet mass +
moisture → store in biochar bin. Later, optionally mix with
manure to create BCF.

Current schema:

- production_runs.biochar_output_kg — single field, unclear
  if wet or dry
- production_runs.biochar_storage_location_id — links to bin
- biochar_products — has formulation_id (NOT NULL implied by
  workflow), mass_kg, storage_location_id

Gaps:

Gap: Biochar output needs wet/dry/moisture triple
Detail: production_runs only has biochar_output_kg
────────────────────────────────────────
Gap: biochar_products.formulation_id should be optional
Detail: Raw biochar has no formulation; only BCF needs one
────────────────────────────────────────
Gap: No manure/compost inventory
Detail: No table for non-biochar materials (manure bins)
────────────────────────────────────────
Gap: No mixing operation
Detail: No way to document: take X from biochar bin + Y from
manure bin → create BCF bin
────────────────────────────────────────
Gap: biochar_products.mass_kg ambiguous
Detail: Should be wet mass + moisture + dry mass triple

2.4 Production Readings & Emissions Split (MISALIGNED)

Meeting clarification:

- Production run level (time-series): temperature, pressure,
  gas flow rate, timestamp
- Credit batch level (benchmark/periodic): CH4 composition,
  CO2, N2O (ppm and/or %)

Current schema: production_run_readings contains BOTH:

- temperature_c, pressure_bar, gas_flow_rate (correct —
  production level)
- ch4_ppm, n2o_ppm, co_ppm, co2_ppm (meeting says these
  should be batch-level)

However: The continuous_gas_measurement boolean + ppm fields
on production_run_readings are for continuous monitoring of
syngas flow (Isometric Appendix II requirement for 1-min
intervals). This IS production-level data.

The batch-level emissions (composition percentages for
certification) are a DIFFERENT concept — these are the
periodic lab measurements that get assigned to a credit
batch. Currently, emission_factors table stores regional
factors, not batch-specific measurements.

Resolution: Keep continuous ppm readings on
production_run_readings (they're correct for monitoring). Add
batch-level emission composition fields to credit_batches or
create a batch_emission_measurements table.

2.5 Samples Split (PARTIALLY ALIGNED)

Meeting clarification:

- Production samples (every ~2 hours): moisture, temperature,
  basic quality checks — linked to production_run_id
- Credit batch samples (once per batch): heavy metals, PAHs,
  full chemistry — linked to credit_batch_id

Current schema: samples table has ALL fields (heavy metals,
chemistry, durability) linked only to production_run_id.

Gap: No credit_batch_id on samples table. Heavy metals and
full chemistry should be batch-level, not run-level. Need to
either:

- Add credit_batch_id to samples (make production_run_id
  optional)
- Or create separate batch_samples table

  2.6 Orders & Deliveries (MOSTLY ALIGNED)

Meeting:

- Orders: customer asks for X kg of product (gross/wet)
- Delivery: measure wet mass + moisture content → know dry
  mass → fixed carbon from batch
- Orders should inherit formulation from product

Current schema gaps:

Gap: deliveries missing moisture_content_percent
Detail: Has delivered_wet_mass_kg and mass_dry_kg but no
moisture field
────────────────────────────────────────
Gap: deliveries.fixed_carbon_percent
Detail: Meeting says this should auto-come from batch, not
per-delivery entry
────────────────────────────────────────
Gap: orders has no formulation link
Detail: Gets it through biochar_product_id → formulations
(indirect, OK)

2.7 Transport Legs (ALIGNED)

Meeting: Only for biochar/BCF deliveries. Feedstock transport
emissions already in feedstock delivery context.

Current: transport_legs with entity_type enum supports
feedstock|biochar|sample|delivery. Polymorphic design handles
both scenarios.

Status: Aligned. The meeting confirms the current design is
correct.

2.8 Soil Temperature / Method Selection (ALIGNED)

Meeting: Method A needs soil temperature. Method B doesn't.

Current: applications has soil_temperature_source and
soil_temperature_c. soil_temperature_measurements table
exists. Condition already in condition-registry.

Status: Schema is aligned. Needs UI-level enforcement
(disable soil temp fields when Method B selected on reactor).

2.9 Feedstock Types (MINOR GAP)

Meeting: Manual entry. Link to Isometric registry page for
verification.

Current: feedstock_types has code, name, category,
description.

Gap: Missing registry_url field to store link to Isometric
registry page.

---

3.  Summary of Required Schema Changes

Priority 1: Core Workflow Fixes (Blocking Prototype)

1.  feedstock_deliveries: Make moisture_percent NOT NULL. Add
    mass_dry_kg (computed).
2.  production_run_feedstocks: Add moisture_content_percent,
    mass_wet_kg, mass_dry_kg for re-measurement at production
    time.
3.  production_runs: Rename biochar_output_kg or add
    biochar_output_wet_kg, biochar_output_moisture_percent,
    biochar_output_dry_kg.
4.  biochar_products: Add mass_wet_kg,
    moisture_content_percent, mass_dry_kg. Make formulation_id
    nullable (raw biochar has no formulation).
5.  deliveries: Add moisture_content_percent.
6.  storage_locations: Add current_dry_mass_kg for inventory
    balance tracking.

Priority 2: Structural Additions

7.  feedstock_types: Add registry_url field.
8.  samples: Add nullable credit_batch_id FK (for batch-level
    heavy metal / chemistry samples).
9.  credit_batches: Add emission composition fields
    (ch4_composition_ppm, co2_composition_ppm,
    n2o_composition_ppm, particulates_ppm) for batch-level
    benchmarks.
10. Mixing operations: Design a mechanism for combining bins
    (biochar + manure → BCF). Could be a new mixing_events table
    or extend biochar_products with source bin references.

Priority 3: Application Logic

11. Bin inventory auto-update: When feedstocks added to bin →
    increment storage_locations.current_dry_mass_kg. When
    production_run_feedstocks consumes → decrement.
12. Dry mass auto-calculation: Everywhere wet mass + moisture
    % entered, compute dry mass.
13. Fixed carbon inheritance: deliveries.fixed_carbon_percent
    auto-populated from linked credit batch.

---

4.  What's NOT Needed (Meeting Confirmed)

- Isometric platform API connection for feedstock types —
  manual entry is sufficient
- Complex materiality tracking — just link to registry page
- Feedstock transport legs — already captured in feedstock
  delivery context
- Load capacity utilization % on transport — "hard to
  quantify," mass + volume sufficient
- Per-delivery fixed carbon measurement — comes from batch

---

5.  Current Application State vs Prototype Needs

The meeting ended with a goal: "Give you a prototype where
you can track data for each step with real data."

Currently built: Auth, project scaffolding, schema explorer,
example CRUD (items)
Not built: Any operational pages for feedstock, production,
biochar, delivery, credits

Minimum prototype pages needed:

1.  Facility / Reactor / Bin management
2.  Feedstock delivery entry (wet mass + moisture → dry mass)
3.  Feedstock → bin assignment
4.  Production run creation (select bin → take material →
    enter readings)
5.  Biochar output → biochar bin
6.  Biochar product / BCF mixing
7.  Order → Delivery workflow
8.  Credit batch creation with samples

---

6.  Verification

- Cross-reference each schema change against
  docs/isometric/schema-mapping.md coverage table
- Ensure dry mass calculation formula: mass_dry_kg =
  mass_wet_kg \* (1 - moisture_content_percent / 100)
- Validate bin inventory logic with test scenario from
  meeting: 100kg delivery → 80kg dry mass → add to bin → take
  50kg for production → bin shows 30kg remaining
- Check Isometric condition-registry triggers still hold
  after schema changes

---

7.  Cross-Check of External Analysis

An external analysis was provided with specific line
references and claims. Here is a line-by-line verification
against the actual codebase.

Line Reference Verification

Claim: "dry-mass utility direction in mass-dry.ts (line 20)"
File:Line: src/lib/calculations/mass-dry.ts:20
Actual Content: export function deriveMassDryKg(
Verdict: CORRECT — function exists and implements wetMass \*
(1 - moisture/100)
────────────────────────────────────────
Claim: "Feedstock wet/dry/moisture fields" at lines 98-100
File:Line: src/db/schema/feedstock.ts:98-100
Actual Content: massWetKg, massDryKg, moistureContentPercent
Verdict: CORRECT — all three fields present on feedstocks
table
────────────────────────────────────────
Claim: "Storage location linkage" at line 106
File:Line: src/db/schema/feedstock.ts:106
Actual Content: storageLocationId:
uuid('storage_location_id').references(...)
Verdict: CORRECT
────────────────────────────────────────
Claim: "Continuous gas conditions" at lines 86, 102
File:Line: src/db/schema/production.ts:86,102
Actual Content: continuousGasMeasurement boolean + DB check
constraint
Verdict: CORRECT — check enforces ppm NOT NULL when flag is
true
────────────────────────────────────────
Claim: "Transport leg model with method-based checks" at
lines
138, 171, 207
File:Line: src/db/schema/logistics.ts:138,171,207
Actual Content: Table definition, calculationMethodType,
energy_usage check constraint
Verdict: CORRECT — both energy_usage and distance_based
checks
present
────────────────────────────────────────
Claim: "Soil temperature and source fields" at lines 58-59
File:Line: src/db/schema/application.ts:58-59
Actual Content: soilTemperatureSource, soilTemperatureC
Verdict: CORRECT
────────────────────────────────────────
Claim: "Only mass_used_kg on join table" at line 228
File:Line: src/db/schema/production.ts:228
Actual Content: massUsedKg: real('mass_used_kg').notNull()
Verdict: CORRECT — no moisture/dry mass fields
────────────────────────────────────────
Claim: "biochar_products requires formulation_id" at line 57
File:Line: src/db/schema/products.ts:57-58
Actual Content: formulationId:
uuid('formulation_id').notNull()
Verdict: CORRECT — .notNull() on line 58 confirms mandatory
────────────────────────────────────────
Claim: "Deliveries dry/wet mass but no moisture" at line 107
File:Line: src/db/schema/logistics.ts:107-108
Actual Content: deliveredWetMassKg + massDryKg present, no
moistureContentPercent
Verdict: CORRECT
────────────────────────────────────────
Claim: "fixed_carbon_percent at delivery level" at line 106
File:Line: src/db/schema/logistics.ts:106
Actual Content: fixedCarbonPercent:
real('fixed_carbon_percent')
Verdict: CORRECT
────────────────────────────────────────
Claim: "Method B guardrails open/planned" at p0-checklist
line
10
File:Line: docs/isometric/p0-compliance-checklist.md:10
Actual Content: P0-03: "Server-side eligibility check only" /

status: open
Verdict: CORRECT
────────────────────────────────────────
Claim: "Method B cadence planned" at condition-registry line
19
File:Line: docs/isometric/condition-registry.md:19
Actual Content: "Planned (not implemented in current
migration)"
Verdict: CORRECT
────────────────────────────────────────
Claim: "Isometric docs fresh 2026-02-11" at README line 42
File:Line: docs/isometric/README.md:42
Actual Content: Last refreshed: 2026-02-11
Verdict: CORRECT
────────────────────────────────────────
Claim: "Non-authoritative by design" at README line 3
File:Line: docs/isometric/README.md:3
Actual Content: > **Non-authoritative.** All summaries are
interpretations...
Verdict: CORRECT (actually line 3, not 42)
────────────────────────────────────────
Claim: "mass-balance expectations" at requirements-shortlist
line 9
File:Line: docs/isometric/requirements-shortlist.md:9
Actual Content: "Ineligible biomass cap" — mentions
"feedstock
mass balance logs"
Verdict: MISLEADING — line 9 is about ineligible biomass >25%

cap, not the wet→dry mass-balance accounting principle
discussed in the meeting

Summary: 14/15 line references verified correct, 1 misleading

Claims Verification

Claim: "Dry mass is canonical" aligns with mass-dry.ts
Verdict: CORRECT
Detail: deriveMassDryKg() at line 20 and
resolveDeliveryDryMass() at line 35 implement exactly this
pattern
────────────────────────────────────────
Claim: Feedstock has complete wet/dry/moisture triple
Verdict: CORRECT
Detail: feedstocks table has all three fields (lines 98-100)
with DB checks (dry ≤ wet, moisture 0-100)
────────────────────────────────────────
Claim: Production readings support continuous gas
Verdict: CORRECT
Detail: continuous_gas_measurement boolean + check constraint

requiring ppm fields when true (lines 86-109)
────────────────────────────────────────
Claim: Transport legs have method-based enforcement
Verdict: CORRECT
Detail: Two DB check constraints (lines 207-222) enforce
required fields per calculation method
────────────────────────────────────────
Claim: Soil temp + source exist for durability
Verdict: CORRECT
Detail: Both fields on applications (lines 58-59), plus
soil_temperature_measurements table
────────────────────────────────────────
Claim: No inventory movement ledger
Verdict: CORRECT
Detail: storage_locations only has capacity_kg
(facilities.ts:73), no balance/inventory fields
────────────────────────────────────────
Claim: biochar_products.formulation_id is NOT NULL
Verdict: CORRECT
Detail: products.ts:57-58 — .notNull() confirmed
────────────────────────────────────────
Claim: Deliveries missing moisture %
Verdict: CORRECT
Detail: logistics.ts:106-108 — has wet mass + dry mass, no
moisture field between them
────────────────────────────────────────
Claim: Method B guardrails still open
Verdict: CORRECT
Detail: P0-03 status is open; condition-registry shows
"Planned"

What the External Analysis Got Right

1.  All "where it already fits" claims are verified accurate
2.  All 6 "main gaps" are real and verified against actual
    schema code
3.  The action plan structure (freeze rules → inventory model
    → production capture → product model → delivery model →
    compliance → prototype) is a sound sequence
4.  Correctly identifies mass-dry.ts as an existing utility to
    build upon

What the External Analysis Missed or Mischaracterized

Issue: feedstock_deliveries.moisture_percent nullable
Detail: Not called out as a gap. Meeting explicitly says
"mandatory for inventory." This is feedstock.ts:38 — no
.notNull(). Needs schema change.
────────────────────────────────────────
Issue: feedstock_deliveries has no mass_dry_kg
Detail: Not flagged. Currently only weight_kg (wet) +
moisture_percent. No derived dry mass field.
────────────────────────────────────────
Issue: production_runs.biochar_output_kg ambiguity
Detail: Not explicitly flagged. Line 52 of production.ts —
single field, no wet/dry/moisture distinction. Meeting says

biochar output needs full triple.
────────────────────────────────────────
Issue: biochar_products.mass_kg ambiguity
Detail: Not flagged. products.ts:66 — single mass_kg field,
unclear if wet or dry. Meeting requires the triple.
────────────────────────────────────────
Issue: No manure/compost bin type
Detail: storage_location_type enum (common.ts:51-56) only
has:
feedstock_bin, feedstock_pile, biochar_pile, product_pile.
No compost_bin or manure_pile. Meeting discusses manure
bins.
────────────────────────────────────────
Issue: samples table has no credit_batch_id
Detail: Not flagged in gap list. Currently only links to
production_run_id (production.ts:123-125). Meeting splits
samples into production vs batch level.
────────────────────────────────────────
Issue: feedstock_types missing registry_url
Detail: Not mentioned. Meeting says "copy and paste the link
on the registry." Current table has no URL field
(feedstock.ts:62-71).
────────────────────────────────────────
Issue: requirements-shortlist.md line 9 mischaracterized
Detail: Cited as "mass-balance expectations" but it's
actually
about ineligible biomass caps. The dry-mass accounting
principle is an operational decision, not a single
Isometric
requirement line item.
────────────────────────────────────────
Issue: No UI exists at all
Detail: Analysis implies prototype effort with a 2-week
timeline but doesn't acknowledge that ZERO operational UI
pages currently exist — only auth, items CRUD, and schema
explorer. The prototype scope is larger than implied.
────────────────────────────────────────
Issue: resolveDeliveryDryMass already handles delivery
context
Detail: The mass-dry.ts utility (lines 35-78) already has the

pattern for measured vs derived dry mass with creditReady
flag. This should be reused for ALL mass entry points, not
just deliveries.
────────────────────────────────────────
Issue: Continuous gas readings ARE correctly production-level
Detail: The analysis correctly keeps ppm on
production_run_readings but doesn't emphasize that these
continuous ppm readings are an Isometric Appendix II
requirement (1-min intervals). What's missing is the
SEPARATE batch-level emission composition values (once per
batch for certification). The two concepts coexist and both

need representation.

Corrected Gap Count

The external analysis identified 6 main gaps. After
cross-check, the actual count is 11 gaps:

1.  No inventory movement ledger (confirmed)
2.  biochar_products.formulation_id mandatory (confirmed)
3.  Deliveries missing moisture % (confirmed)
4.  fixed_carbon_percent delivery-level inconsistency
    (confirmed)
5.  Method B guardrails open (confirmed)
6.  Isometric docs non-authoritative (confirmed, but this is
    by design, not a gap)
7.  NEW: feedstock_deliveries.moisture_percent nullable
8.  NEW: feedstock_deliveries missing mass_dry_kg
9.  NEW: production_runs.biochar_output_kg ambiguous (no
    wet/dry/moisture triple)
10. NEW: biochar_products.mass_kg ambiguous (no
    wet/dry/moisture triple)
11. NEW: samples table missing credit_batch_id for
    batch-level samples
12. NEW: storage_location_type enum missing
    compost_bin/manure_pile for mixing workflow
13. NEW: feedstock_types missing registry_url
