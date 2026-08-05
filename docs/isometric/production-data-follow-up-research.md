# Isometric production-data follow-up research

> **Non-authoritative.** This file interprets the first-party sources cited
> inline. Verify against the registry and the live Certify OpenAPI before
> changing credit logic or making a credit claim. Research brief:
> [`docs/plans/2026-08-04-isometric-production-data-follow-up-research-brief.md`](../plans/2026-08-04-isometric-production-data-follow-up-research-brief.md).

- Researched: 2026-08-04. All URLs accessed 2026-08-04.
- Pinned versions ([`versions.json`](./versions.json)): Biochar Production and
  Storage Protocol **v1.1** (tag 1.1.1); Biochar Storage in Agricultural Soils
  **v1.1** (tag 1.1.0).
- Method: Isometric MCP (`how_to`, `protocols_*`, `isometric_docs_*`,
  `openapi_documents_*`, `graphql_analyze_type`) plus direct fetches of the live
  OpenAPI and Certify guides. **No sandbox mutations, no authenticated API
  calls, no live-template inspection.**
- Source classification used throughout: **[REQ]** documented Isometric
  requirement · **[INF]** inference · **[CONFLICT]** first-party sources
  disagree · **[GAP]** first-party silence requiring an Isometric answer.

Two caveats on evidence handling. The MCP `protocols_analyze` tool returns
LLM-generated summaries alongside verbatim quotes; only verbatim quotes are
cited as **[REQ]** below. And module v1.1.0 cross-references "Section 8.3.1" of
the protocol, but in protocol patch 1.1.1 that content sits under unnumbered
headings inside §8; local docs citing §8.3.1 point at the right content under
stale numbering.

---

## 1. Executive decision table

| # | Blocker | Status | One-line resolution |
|---|---|---|---|
| 1 | Production Batch mass basis | **unresolved** | `mass` is the only undescribed property in `CreateProductionBatchRequest`, and the same silence repeats in GraphQL and the reference page. A related **gap** (downgraded from "conflict" after adversarial verification): the module defines `m_biochar` as dry mass applied and cross-references the protocol for how to measure it, but no first-party text publishes the conversion. Note protocol **v1.3** addresses this directly — see §2. |
| 2 | Binding three Production Batch samples | **resolved** (mechanism) | Templates bind **datapoints, not samples**: a list-shaped blueprint input takes a `datapoint_ids` array. The blueprint computes the mean and the standard error internally; list **cardinality is numerically load-bearing** on the 1000-year path. Four sub-gaps remain. |
| 3 | Reactor-monitoring submission route | **source-conflicted** | One guide names `pyrolysis_reactor` MeasurementSamples as required for monitoring, but publishes **no property catalogue** for that type. Time-series is live for biochar in the API while its own guide says DAC-only. Monitoring Submissions can be near-eliminated. No route is chosen. |
| 4 | Correction / reconciliation lifecycle | **source-conflicted** | The general PATCH-and-resubmit model is documented and authoritative, but the `supplier_reference_id` guide makes a filtering guarantee the live spec contradicts for exactly the two resources this design needs. |

Nothing in this report chooses the mass basis or the monitoring route. Both
remain open by evidence, not by omission.

### Scope reality check (added after an over-hardening audit, 2026-08-04)

Three facts bound how much of this report is actionable work, and an earlier
draft of it did not state any of them:

1. **Certify has no submission gate beyond API schema validity.** Its data checks
   are explicitly *"not gating to submission"* (§6). Every protocol and module
   obligation resolves at **verification**, not at submit time. Do not build a
   client-side blocker from anything in §3.3 or §6 without deciding to.
2. **200-year is not a live path.** `src/db/schema/facilities.ts` records that
   *"1000-year is the go-forward tier; 200-year is surfaced-but-disabled in the UI
   until a 200-year client onboards"*, and the column defaults to `1000_year`. All
   200-year material below (soil temperature baselining, `h_c_molar_ratios`, the
   Woolf coefficients, the `_c_org` blueprint) is reference material, not queued
   work.
3. **Reactor monitoring volume is elective and the spread is large.** The
   minimum-obligation method combination leaves exactly **one** ≥1-minute channel,
   whose modal is "should", against six under the maximum. See §4.1.

This report has been corrected once already for the failure mode this project has
hit twice before: quoting a requirement's gate branch and silently dropping its
documented escape branch. §3.2's three-sample rule was the instance found.

---

## 2. Blocker 1 — Production Batch mass basis

### Status: unresolved

**No first-party source states whether `POST /production_batches.mass` is
produced wet mass, produced dry mass, or applied dry mass.**

**[GAP]** `CreateProductionBatchRequest.mass` is a `ScalarQuantity` **with no
`description` key**, while every sibling property (`facility_id`,
`feedstock_type_ids`, `supplier_reference_id`, `kind`, `started_at`,
`ended_at`, `display_name`) carries one. The operation description is only
"Creates a production batch in the Isometric system".
(live Certify OpenAPI, `CreateProductionBatchRequest` / `POST /production_batches`)

**[GAP]** The omission is systemic, not a REST-doc oversight. The GraphQL type
`ProductionBatch.mass(options: QuantityOptions): Quantity!` has no SDL
description either, while sibling fields in the same traversal do. The rendered
page <https://docs.isometric.com/api-reference/certify/post-production-batch>
adds no prose. Three independent renderings, same silence.

### The related first-party conflict

**[REQ]** Protocol v1.1.1, §8 → Calculation of C_biochar, Equations 2/3 symbol
list: *"m_biochar, n (p) — the total mass of biochar **emplaced** for Storage
Batch n OR for each production batch p included in Storage Batch n, **in
tonnes**"*. The same section, "Measurement of Mass of Biochar Applied", sources
that mass from a **truck-weight difference at the application site** on a
legal-for-trade scale (NIST HB 44) — an as-delivered weighing. Production-site
weighing appears only as a documented fallback requiring PDD justification.

**[REQ]** Agricultural Soils module v1.1.0 §4.1.1: *"CO₂e_stored = C_biochar ×
m_biochar × F_durable × 44/12 … m_biochar is the **dry mass of biochar
applied**."*

**[GAP] — downgraded from [CONFLICT] after adversarial verification.** An
earlier draft called these two definitions a conflict. They are not. The module
defines `m_biochar` as dry mass applied **and in the same breath points at the
protocol for measurement**: *"See Section 8.3.1.1 of the Biochar Production and
Storage Protocol for full guidelines on measurement of mass of biochar applied,
m_biochar."* The protocol **never uses the word "wet"**, and the truck-difference
method is permissive (*"may be determined by"*), not mandatory. What is genuinely
missing is the **conversion**: no first-party text publishes how an emplaced
weighing becomes a dry mass. The module's §3.3 note — *"The moisture content of
applied biochar is necessary for the quantification of CO₂e_stored… Carbon
content can be reported in dry basis to account for differences in total biochar
mass"* — is the closest bridge and is not an equation. An explicit
`m_biochar = wet × (1 − moisture)` formula surfaced only in an MCP summary and is
**not** backed by any verbatim registry quote; treat it as unsourced.

**[REQ] — first-party text the earlier draft missed, bearing directly on this.**
The protocol states biochar *"should be sampled in its final pre-storage
condition, i.e., post-processing and **at typical moisture levels**."*

**[REQ] — protocol v1.3 answers much of Blocker 1, and this report is pinned to
v1.1.** The currently certified protocol v1.3.0 carries requirement `R-ADXG-0`
with three options, the first verbatim: *"Dry weight is measured for every batch
of biochar produced and this can be traced to the point of storage for example
through volume based tracking; or"* — the others being a consistent-wetting
target with SEM < 5 % across Method A samples, or per-batch moisture measurement.
v1.3 also renames the section from "Measurement of Mass of Biochar **Applied**"
to "…Biochar **Stored**". This does not resolve `production_batches.mass` (an API
field the protocol never mentions), but it means **PB-1 should be asked against
v1.3, and a version bump may be the real answer** rather than a support ticket.

### What the API model does tell us

**[REQ]** Certify has a **separate** applied-mass resource. `POST
/biochar_applications` requires `project_id`, `storage_site_id`,
`production_batch_id`, `average_application_rate`, `application_date`,
`truck_mass_on_arrival`, `truck_mass_on_departure`, `supplier_reference_id`;
the read model adds nullable `removal_id` and `ghg_entry_id`. This is the
resource that structurally mirrors the protocol's applied-mass measurement.

**[REQ]** Certify's measurement vocabulary *can* express mass basis and does not
here: measurement type `Biomass` offers `Dry mass | MASS |
MATERIAL_CONDITION_DRY` and `Wet mass | MASS | MATERIAL_CONDITION_WET`, while
`Biochar → Production batch` offers only an unqualified `Mass | MASS | —` —
on a page that elsewhere distinguishes dry-basis and wet-basis fractions.
(<https://docs.isometric.com/user-guides/certify/measurement-samples>)

**[INF]** The best-supported reading is that `ProductionBatch.mass` is the
**produced batch mass at the facility**, because the resource is scoped by
`facility_id` + `started_at`/`ended_at` and applied mass has its own resource.
Nothing establishes whether that produced mass is wet or dry. **Do not code a
moisture conversion on this basis.**

### Partial application across reporting periods

**[GAP]** The protocol never addresses splitting one Production Batch across
reporting periods or Storage Batches; its equations run the other way
(Equation 3 sums *k* Production Batches into one Storage Batch).

**[REQ]** Loss is deducted from the **delivered** amount, not a produced amount:
*"where a process upset results in loss of biochar, that amount must be deducted
from the delivered amount of biochar based on delivery weigh tickets."*
(Protocol v1.1.1, "Other Considerations — CO₂e_Stored,n")

**[REQ]** Certify's documented mechanism for spreading one physical activity
across periods is the **component attribution factor** (*"if a single transport
leg transported feedstock for two production batches, an attribution factor of
0.5 can be assigned to the component on each GHG entry"*), which Isometric never
applies to `production_batches.mass`.
(<https://docs.isometric.com/user-guides/certify/ghg-entry>)

**[REQ]** `production_batches` has create/list/get/delete and **no PATCH**. A
mass recorded once cannot be amended if the applied total later diverges.

**Net:** if `mass` is the full produced amount, nothing reconciles it against
the sum of `BiocharApplication` truck deltas. If it is the credited portion, a
batch spanning two periods has no representable answer given the missing PATCH.
Both readings are unfalsifiable from published sources.

### Units and `standard_deviation`

| Item | Finding | Class |
|---|---|---|
| `unit` | `ScalarQuantity.unit` is a free-form string, `minLength 1`, **no enum, no pattern, no examples**. No allowed-unit list is published for this field. | [GAP] |
| Protocol unit | `m_biochar` is stated **in tonnes**. | [REQ] |
| Blueprint unit | Sequestration blueprints show `kg` as the **example** unit for `product_mass`. | [REQ] |
| Storage | GraphQL exposes `Quantity.precision` and `mass(options: QuantityOptions)`, so Certify stores the submitted unit and converts on read rather than normalising on write. | [REQ] |
| `standard_deviation` semantics | Optional, nullable, **no description**: population vs sample, absolute vs relative, and which uncertainty component it carries are all unstated. Whether it propagates from a *production batch* into any calculation is stated nowhere. | [GAP] |
| Datapoint-level analogue | *"A standard deviation should be provided if the datapoint is to be included in the variance propagation method"* — scoped to **Datapoints**, and a production batch is not a Datapoint resource. | [REQ] |
| On-point precedent | Isometric's own worked example: *"The mass of biochar is measured with a weigh scale as evidenced by the source provided, so the mass is accurate primary data and does not require an uncertainty discount."* | [REQ] |

### Interaction with the GHG-entry `product_mass` input

Reported separately and **not** used to infer the production-batch answer, per
the brief.

**[REQ]** All four biochar sequestration blueprints compute `result =
product_mass × carbon_content × durable_fraction × 3.667`. `product_mass` is
documented only as "Mass of product", Quantity Kind `Mass`, example unit `kg`,
**with no wet/dry qualification** **[GAP]**.

**[INF]** In the same blueprints `total_carbon_contents` and
`inorganic_carbon_contents` are `Mass Fraction Dry Basis List`. Multiplying a
dry-basis fraction by `product_mass` is dimensionally coherent only if
`product_mass` is itself dry; otherwise the component over-credits by the
moisture fraction. Isometric never states this.

**[REQ]** Isometric publishes an explicit moisture-correction blueprint where it
wants one — `biomass_burial_with_moisture_correction` carries
`moisture_correction = (1 − average_material_moisture_content) / (1 −
average_sampled_moisture_content)`. **No biochar blueprint contains any moisture
term.** This contrast is the strongest available signal that `product_mass` is
expected already-dry, and it is still an inference.

---

## 3. Blocker 2 — binding three independent Production Batch samples

### Status: resolved for the mechanism; four named sub-gaps

**The headline finding: an Isometric GHG-entry template never references a
MeasurementSample. It references datapoints.**

### 3.1 Wire-level mapping

**Step 1 — POST the sample(s).** `POST /measurement_samples`
(`CreateMeasurementSampleRequest`). Properties required to be present, several
of them nullable:

| Property | Required | Value on this path |
|---|---|---|
| `supplier_reference_id` | required, nullable, ≤200 | distinct per record; unique per supplier |
| `measured_at` | required, `date-time` | actual lab/sampling instant |
| `project_id` | required | `prj_…` |
| `feedstock_batch_id` | required, nullable | `null` |
| `measurement_location_id` | required, nullable | `null` for batch chemistry |
| `measurement_type` | required | `biochar_production_batch` |
| `storage_location_id` | required, nullable | `null` |
| `values[]` | required array | one entry per measurement |
| `production_batch_id` | **optional**, nullable | the same `ptb_…` on every record |

Each `values[]` item is `measurement_property { quantity_kind, qualifier }`
(both required, qualifier nullable) plus `value` (`DatapointQuantityInput`:
`magnitude` required, `unit` required-nullable, `standard_deviation`
optional-nullable).

**Step 2 — what returns.** `MeasurementSample` carries `id` (`mts_…`),
`production_batch_id`, `supplier_reference_id`, `measured_at`, and `values[]`
where **every element carries a required `datapoint_id`**. N values ⇒ N
datapoints.

**[REQ]** `MeasurementSample.measured_at` is typed `date` on the response while
the request accepts `date-time`. Time-of-day is lost on read-back; whether it is
lost on write is unstated **[GAP]**.

**Step 3 — bind into the GHG entry.** `POST /ghg_entries` takes
`ghg_entry_template_id` plus `ghg_entry_template_components[]`, each
`{ ghg_entry_template_component_id: "rtc_…", inputs: [...] }` where every input
is one of:

- `CreateComponentListInput` = `{ input_key, datapoint_ids: [dtp_…, dtp_…, dtp_…] }`
- `CreateComponentScalarInput` = `{ input_key, datapoint_id }`

**`CreateComponentListInput.datapoint_ids` is the entire binding mechanism.**
Its description: *"The Isometric IDs of the datapoints that will be used to
populate the value of this input."* The same union is used by `POST
/components`.

**[REQ]** List-ness lives on the **blueprint**
(`ComponentBlueprintInput.data_shape` / `InputDataShape`, *"Whether the input is
a list of datapoints"*), not on the template component input — which exposes
only a singular nullable `datapoint_id`, pre-bound for `fixed` inputs and left
empty for `monitored` ones.

**[GAP]** There is **no** documented mechanism by which a template, blueprint,
or GHG entry references an `mts_…` ID, and **no** documented auto-aggregation of
samples sharing a `production_batch_id`. `production_batch_id` is provenance for
the UI and the verifier; it is not the calculation join. Which datapoints enter
a list is entirely supplier-chosen at GHG-entry construction time.

**[REQ]** *"On credit issuance, any **individual sample datapoints** that are
used as inputs in a crediting calculation are shown in the removal calculation
view."* (<https://docs.isometric.com/user-guides/certify/data-visibility>)

**[GAP]** No first-party worked example of the sample-datapoint → list-input
flow exists. `your-first-ghg-entry` shows no list input and no measurement-sample
datapoint.

### 3.2 What the template computes — the blueprint owns the statistics

**[REQ] — condensed, not verbatim.** The keys, operators and coefficients below
were verified against the Component Blueprint Library; the presentation is
compressed. Two known compressions: `ln(soil_temp)` is really a three-step chain
(`soil_temp_delta = soil_temp − 0.0°C`, normalized against `1.0Δ°C`, then `ln`),
and `_200_year_unsampled` adds (not subtracts) the winsorized standard error on
H/C. Re-read the library before implementing arithmetic:

```text
biochar_sequestration_1000_year_f_durable_max
  result               = product_mass × mean(carbon_contents) × durable_fraction × 3.667
  carbon_contents      = total_carbon_contents − inorganic_carbon_contents
  durable_fraction     = Minimum(durable_fraction_calc, 0.95)
  durable_fraction_calc= mean(s_fraction) − s_standard_error
  s_standard_error     = sqrt( mean(s_fraction) × (1 − mean(s_fraction)) / num_samples )
  num_samples          = |s_fraction|

biochar_sequestration_200_year_c_org
  result                    = product_mass × mean(carbon_contents) × durable_fraction × 3.667
  durable_fraction          = Minimum(1 − non_durable_fraction_calc, 0.95)
  non_durable_fraction_calc = −0.048 + (−0.383 + 0.35 × ln(soil_temp)) × mean(h_c_molar_ratios)

biochar_sequestration_{1000,200}_year_unsampled   (Method B)
  calculated_carbon_content = WinsorizedMean(carbon_contents, carbon_contents)
                            − WinsorizedStandardError(carbon_contents, carbon_contents)
```

**No external averaging step exists and none should be performed.** Outlier
handling (winsorization) exists **only** in the `_unsampled` Method B
blueprints; the sampled blueprints use a plain arithmetic mean.

**[REQ] — numerically load-bearing.** `num_samples = |s_fraction|` means the
**cardinality of the `datapoint_ids` array drives the conservatism penalty** on
the 1000-year path. Three list members give `sqrt(S(1−S)/3)`; a single collapsed
value gives `sqrt(S(1−S)/1)`, a materially larger deduction. This independently
vindicates the project's three-independent-samples decision at the *datapoint*
level.

Note the asymmetry: the **200-year** formula uses `mean(h_c_molar_ratios)` with
**no √n term**, so on that path replicate cardinality is numerically neutral and
matters only for provenance and evidence.

**[REQ]** This matches the registry text exactly:

- Protocol v1.1.1 §8.3.1 Method A: *"If multiple samples are taken per Batch,
  the average C_biochar content of these samples must be used. Data used to
  calculate the average should be reported."*
- **[REQ] — conditional. An earlier draft of this report quoted only branch 1.**
  §8.3.1 "Minimum number of samples per Batch": *"To account for the possibility
  of variation within a single Production Batch **either of the following
  approaches must be adopted**: 1. A minimum of 3 samples must be taken for each
  measured Production Batch. These samples must be representative of the full
  range of physical characteristics (eg. particle size, color) available in the
  batch. 2. Justification and evidence must be provided to demonstrate that the
  'within batch' variation is likely to be minimal."* Three samples is **option 1
  of two**, not a mandate, and neither branch is a submission gate — it is a
  sampling-plan obligation evidenced in the PDD and checked at verification.
- **[CONFLICT]** Ag Soils v1.1.0 §3.4.1.1 states the 3-replicate rule
  unconditionally while §3.4.1 routes back to §8.3.1's either/or. The module
  hardens what the protocol makes elective, and first-party text does not
  reconcile them. Keeping 3 replicates is the conservative reading — record it as
  a **noma project choice**, not a registry gate.
- §8.3.1 outliers: winsorize beyond 3σ, *"only if method B is used"*, and
  *"only once a minimum number of 30 measurements have been taken"*.
- §8.3.1 Method B unsampled: `C_Biochar = μ_CC − σ_CC/√n`; *"Eligible samples
  are those taken in the previous 6 months … Older samples may not be used."*
- Ag Soils v1.1.0 §4.1.1 Option 2: `F_durable = S − sqrt(S × (1 − S) / N)`,
  N = *"the number of samples taken per batch"*.
- Ag Soils v1.1.0 §3.4.1.1: *"Composite samples must be divided into a minimum
  of three representative replicates per batch … to allow estimation of the mean
  and standard deviation and detection of potential outliers."*

**[CONFLICT]** The protocol gates winsorization on ≥30 measurements and defines
μ/σ over same-process samples from the previous 6 months *excluding the batch
being calculated*. The blueprint's `WinsorizedMean(carbon_contents,
carbon_contents)` documents none of those three rules. Whether Certify enforces
them or expects supplier pre-filtering is unknown.

### 3.3 Per-record vs other-cadence properties

**On every record** (API): the eight required properties above plus the shared
`production_batch_id`.

**On every record** (certification — Ag Soils v1.1 §3.3 Table 2, cadence column
verbatim *"Measure every production batch as per method A or B applicable.
Minimum number of 3 samples per production batch."*):

| Measurement | `quantity_kind` / `qualifier` | Blueprint input & unit |
|---|---|---|
| Carbon content | `MASS_FRACTION_DRY_BASIS` / `TOTAL_CARBON` | `total_carbon_contents`, `mg/kg` |
| Inorganic carbon | `MASS_FRACTION_DRY_BASIS` / `TOTAL_INORGANIC_CARBON` | `inorganic_carbon_contents`, `mg/kg` |
| Moisture | `MASS_FRACTION_{DRY,WET}_BASIS` / `COMPOUND_H2O` | **none** — verification-time, calculation-unused. Table 2 states this per **batch** with a sample floor, not per record, and it inherits §8.3.1's either/or |
| H/C organic ratio | `DIMENSIONLESS_RATIO` / `HYDROGEN_TO_ORGANIC_CARBON_RATIO` | `h_c_molar_ratios`, `%` (200-yr) |
| Random reflectance R₀ | **no matching property** (see gap) | `s_fraction`, `%` (1000-yr) |

**Once per batch, not per replicate:** `product_mass` (scalar, Mass, `kg`).

**Once per validation or per process change, minimum 1 sample** (§3.3 Table 2
verbatim: *"Measure at project validation unless feedstock, reactor or process
parameters change. Minimum number of 1 sample."*): O/C organic ratio, ash
content, volatile matter **or** fixed carbon, and the USEPA-16 PAH panel
(waivable only by pre-agreed documented mitigation). Recommended only: BET
surface area, porosity, CEC, pH, NMR/XPS bonding state.

**Per-period / per-site, never per sample:** `soil_temp` (200-yr). Ag Soils
§4.1.1 Option 1 requires ISO 4974:2023 baselining over the preceding year with
*"at least 10 measurements per site-month"* averaged across every application
site, or a justified global-dataset value. The modals are softer than an earlier
draft implied: proponents *"**can choose to** Baseline their own annual soil
temperature measurements"*, which *"**should** be carried out according to ISO
4974:2023, **or equivalent**"*, and air temperatures *"**should** not be used as a
proxy"*. §4.1.2.2 caps within-boundary variation at 1 °C. **A 200-year GHG
entry therefore cannot be assembled from production-batch samples alone.**

**[GAP] — a second uncarried measurement.** The catalogue exposes `H:C |
DIMENSIONLESS_RATIO | HYDROGEN_TO_ORGANIC_CARBON_RATIO` but **no O/C property at
all**, though O/C organic ratio is a validation-cadence certification requirement.
This is the same gap class as `s_fraction` below and needs the same answer from
Isometric.

**[REQ]** Units: *"An input can accept different units as long as they are
compatible with its quantity kind… Components handle unit transformations
automatically"* and *"data should be reported with the same value and units as
shown in your attached sources."* Send the lab's native units, not
pre-converted ones.

**[GAP] — `s_fraction` has no measurement property.** The published
Production-batch catalogue lists `Inertinite Fraction`, `Semi-Inertinite
Fraction`, and `Poorly Carbonized Fraction` (all `DIMENSIONLESS_RATIO`) but no
reflectance/R₀ property and nothing meaning "fraction of R₀ readings above the
2 % benchmark". There is no documented way to carry `s_fraction` as a
measurement-sample value; it must be posted as a standalone `POST /datapoints`,
which severs it from the sample provenance chain. Nor is there a documented
carrier for the module's *"should report a set of at least 500 measurements of R₀,
calculated at the maceral-level, for each sample"* — whose histogram the module
asks be submitted *"at the point of project verification"* — other than a Source
file.

### 3.4 Lab reports, QA/QC, uncertainty, Sources

**[REQ] Sources attach to datapoints, never to samples.**
`CreateDatapointRequest.source_ids` is required; `PatchDatapointRequest.source_ids`
is *"Overwrite existing source IDs"*; `CreateMeasurementSampleRequest` has **no
`source_ids` field at any level**. Adding or removing sources on a datapoint does
**not** require statement resubmission.

**[GAP] — the pivotal one.** Datapoints minted by a measurement sample carry
`locked_status: locked_measurement_sample_datapoint`, and `DatapointLockedStatus`
says *"Locked Datapoints cannot be updated: if an updated version of a data
input is required then a new Datapoint must be created."* `PatchDatapointRequest`
exposes `source_ids`, but nothing documents whether a **source-only** PATCH
succeeds on a locked sample datapoint. **Attaching the lab report to the exact
calculation-used datapoints — a hard verification requirement — has no
documented, guaranteed path.** This is the single highest-value support
question in this report.

**[REQ] Uncertainty.** `DatapointQuantityInput.standard_deviation`: *"Leave null
if the datapoint is not to be included in the uncertainty analysis for the
removal."* But the sensitivity guide states *"All datapoints are included in the
analysis except **list inputs related to CO₂ storage, such as measurements of
biochar carbon content**. These inputs are assumed to be accurate primary data
and can be omitted."* **[INF]** the three carbon-content datapoints are exempt
from the ±20 % sweep and from `uncertainty_justification`; batch-level
conservatism is delivered instead by the blueprint's `s_standard_error` /
winsorized-SE terms. Separately **[REQ]**, *"All datapoints are considered
statistically independent for the purpose of variance propagation"* — the
correct treatment for replicates.

**[REQ] The registry demands more than three numbers — but it demands them at
verification, not at submission.** Ag Soils v1.1 §3.5 is a **VVB-delivery and
retention** obligation: *"Project Proponents are required and are responsible for
the **delivery of biochar characterization data to a project's VVB**."* Reports
must include *"the raw data from which any data analysis/reduction was performed,
including standards and replicate measurements"* plus a summary of analytical
uncertainty, sample count, standards used, standard runs, standard deviation and
percentage error. The **four-sheet spreadsheet is an example, not a required
structure**: *"This **may, for example, take the form of** a spreadsheet
containing four sheets."*

**[REQ] ISO 17025 is recommended, not required.** §3.4.2: *"A qualified
laboratory **is evidenced by** accreditation to ISO 17025 or equivalent
standards… It is **recommended** that Project Proponents **should** utilize
accredited analytical services such as UKAS, MCERTS, DWTS, and ISO **whenever
feasible**."* Non-accredited labs are explicitly permitted: *"Where a Project
Proponent utilizes laboratory facilities within an academic institution, **or a
non-accredited commercial laboratory**, periodic external validation must be
undertaken with an accredited facility"*, at a frequency *"agreed with Isometric
on a case-by-case basis"*. The only unconditional obligation here is to **report
which laboratory was used**.

**[REQ] Calibration evidence goes to the VVB and the PDD, never the payload.**
§3.4.3: calibration records and CRM-referenced checks are *"reported… **to the
relevant Validation and Verification Body (VVB)** when submitting biochar
characterization data"*, and QA/QC processes are reported *"**within the PDD**"*.
Records ≥5 years; a ~100 g physical archive sample is *recommended*. **The API has
no structured field for any of this — it all binds as Source documents.**

### 3.5 Corrections once a sample is referenced

**[REQ] There is no correction path *on* a measurement sample.** The documented
path is: mint replacement datapoints → re-point the component inputs → resubmit
the statement.

1. `measurement_samples` exposes `GET` (list), `POST`, `DELETE`. **No PATCH and
   no `GET /measurement_samples/{id}`.**
2. Sample datapoints are locked; a new datapoint must be created to correct one.
3. `PATCH /components/{id}` and `PATCH /ghg_entries/{id}`: *"Associated GHG
   entries will be recalculated, if they are not in an immutable state."* The
   replacement `datapoint_ids` array is installed here, not on the sample.
4. *"A PATCH update to a component that modified the datapoint used as one of
   its inputs"* requires `POST /ghg_statements/{id}/submit`. Detect via
   `pending_total_co2e_removed_kg`: *"If it is null, the GHG statement does not
   need to be resubmitted."*
5. Hard stops: `DELETE /datapoints/{id}` *"Will fail if the datapoint is in use
   by a component"*; `DELETE /components/{id}` *"will fail if the component is
   in use by a verified removal"*; `DELETE /ghg_entries/{id}` errors unless
   DRAFT; `locked_used_in_verified_removal` is terminal.
6. `GET /datapoints/{id}/components` and
   `GET /datapoints/{id}/ghg_entry_template_components` enumerate a datapoint's
   consumers before you correct it.

**[GAP]** `DELETE /measurement_samples/{id}` documents **no** in-use guard,
unlike every neighbouring delete. **[INF]** treat it as unsafe: POST corrected
sample(s) → PATCH component `datapoint_ids` → resubmit → only then consider
deleting the superseded sample, never before.

### 3.6 Method A/B and 200-year/1000-year

**[REQ] The binding shape is identical across all four paths** — a list of
datapoint IDs per list input. Only the blueprint key and the input set change.

| Path | Blueprint key | List inputs | Extra scalar | In-blueprint statistics |
|---|---|---|---|---|
| Method A, 1000-yr | `biochar_sequestration_1000_year_f_durable_max` | `total_carbon_contents`, `inorganic_carbon_contents`, `s_fraction` | `product_mass` | mean(carbon); mean(s) − binomial SE; cap 0.95 |
| Method A, 200-yr | `biochar_sequestration_200_year_c_org` | `total_carbon_contents`, `inorganic_carbon_contents`, `h_c_molar_ratios` | `product_mass`, `soil_temp` | mean(carbon); Woolf 2021; cap 0.95 |
| Method B, 1000-yr | `biochar_sequestration_1000_year_unsampled` | as A/1000 | `product_mass` | WinsorizedMean − WinsorizedSE on carbon, **and it keeps the full `durable_fraction_calc = mean(s_fraction) − s_standard_error` / `num_samples = \|s_fraction\|` chain** — replicate cardinality is load-bearing on Method B too |
| Method B, 200-yr | `biochar_sequestration_200_year_unsampled` | as A/200 | `product_mass`, `soil_temp` | Winsorized on carbon **and** H/C |

**[GAP]** For the `_unsampled` blueprints nothing documents *which* datapoints
populate the lists, nor whether Certify enforces the 6-month eligibility window,
the exclusion of the current batch, or the ≥30-measurement winsorization gate.

**[CONFLICT] — module version attribution.** The blueprint library describes
`biochar_sequestration_1000_year_f_durable_max` as belonging to the **Biochar
Storage in Soil Environments** module and `biochar_sequestration_200_year_c_org`
as belonging to **Agricultural Soils v1.2** — yet Agricultural Soils **v1.1**
§4.1.1 Option 2 defines the identical `F_durable = S − sqrt(S(1−S)/N)`
equation, and v1.1 is what this project is pinned to. Neither blueprint's
applicability under Ag Soils v1.1 can be asserted from documentation alone.

**[CONFLICT] — the live template's key is not in the catalogue.** The live
project template binds `biochar_sequestration_1000_year` with a single
pre-netted `carbon_contents` LIST and an `s_fraction` LIST of quantity kind
`dimensionless`. The published catalogue instead lists
`biochar_sequestration_1000_year_f_durable_max` with a **pair** of list inputs
(`total_carbon_contents` and `inorganic_carbon_contents`, both `mg/kg`) and
types `s_fraction` as `Dimensionless Ratio` (`%`). This is recorded in-repo at
`src/lib/isometric/transformers/sequestration-binding.ts:87` — *"referenced by
the live template but absent from the component-blueprint catalog"* —
independently verified during this pass.

> **Do not port the catalogue's input names or units into the integration.**
> The live template is authoritative for what the project must send; the
> catalogue is authoritative for what the maths does. Re-run
> `GET /projects/{project_id}/ghg_entry_templates` before any change here.

---

## 4. Blocker 3 — reactor-monitoring submission route

### Status: source-conflicted. No route chosen.

### 4.1 Protocol monitoring obligations under v1.1

**[REQ] — structural finding.** v1.1 has **no consolidated monitoring plan or
monitoring-parameters table**. Obligations are distributed across methodology
sections, and almost every continuous reactor obligation is **conditional on a
method the project chooses**, not universal.

| Parameter | Mandatory / conditional | Cadence | Accuracy | Calibration | Retention |
|---|---|---|---|---|---|
| Temp + pressure **sensor positioning** on a PDD engineering diagram (§9.1.1) | **Mandatory, all projects** | once, at validation | — | — | PDD |
| Process parameters, production rates, volumes (§6.1) | **Mandatory — PDD disclosure only** | once, at validation | — | — | PDD |
| HTT / peak temperature; residence time | **Not** a per-batch or per-period deliverable (PDD + background prose only) | — | — | — | — |
| Reactor **system pressure**, sub-atmospheric (§9.1.2) | **Conditional** — one of three gas-loss routes | continuous, **≥1-minute** | 2 % of full scale | per manufacturer, **≥annual** | raw on request; leak-test proof ≥5 yr |
| Gas **mass flow rate** (§9.2.2) | **Conditional** — continuous-instrumentation route | **≥1-minute**, t/h | 2 % FS, inline Coriolis/thermal | ≥annual, traceable to national standards | ≥5 yr (§9.2.3) |
| Gas **composition CH₄, H₂, CO, CO₂** (§9.2.2) | **Conditional** — same route | **≥1-minute** | 2 % FS, inline NDIR/TDL | ≥annual; calibration gases with certificate of analysis | ≥5 yr |
| **Flue stack temperature** (§9.2.4) | **Conditional** — accredited emissions-testing route (ASTM D7036 / ISO 17025); operating temp within **10 %** of tested value | **≥1-minute** | 2 % FS | ≥annual | ≥5 yr incl. signed test report (§9.2.5) |

The gas-loss routes are **hierarchical, not a flat menu**. A validated
chemical-kinetics reactor model is primary; the other two are permitted only
*"in situations where it is **not possible** to develop a high-quality
mathematical reactor model to represent pyrolyzer operations"*: continuous
sub-atmospheric pressure monitoring at ≥1-minute, or leakage testing that
*"**should** be conducted at least once every 12 months"* per ASTM
E1003-13(2022). Separately and unconditionally for every project: *"The reactor
design **must** include sensors to quantify leakage due to loss of pyrolysis
gasses during operation of the reactor"* — with no stated cadence. Only the
≥1-minute pressure **recording** is elective.

**[REQ]** Ag Soils v1.1 §3.1 **explicitly declines** to set reactor
requirements, deferring to protocol §9. It uses reactor parameters only as a
re-characterization trigger (Tables 1/2 re-measured when *"feedstock, reactor or
process parameters change"*), as a §3.3 PAH-waiver basis, and as a §3.4.1
sampling-plan design input.

**Consequence — this decides scope more than Blocker 3 does.** Reactor data
volume is set by the project's chosen gas-loss and direct-emissions methods, not
by the pathway. The **minimum-obligation combination** is ≥12-monthly ASTM
E1003-13(2022) leakage testing (or a validated reactor model) for gas loss, plus
§9.2.4 accredited emissions testing for direct emissions. That leaves **exactly
one ≥1-minute channel — flue stack temperature — and its modal is "should"**,
against **six** channels (system pressure, mass flow, CH₄, H₂, CO, CO₂) under the
§9.1.2-pressure + §9.2.2-continuous combination. The §9.2.4 route's price is
elsewhere: an accredited testing entity (ASTM D7036 / ISO 17025 / state-approved),
feedstock similarity within 10 %, operating stack temperature within 10 % of the
tested value, and a signed report retained ≥5 years. **In no configuration is any
of it uploaded** — every branch ends in "available upon request" plus retention.
Whether §7.6's row-level readings pipeline is load-bearing at all follows from
this choice.

**[REQ] — citation corrected.** The Data Sharing section (cited as §6.4 in an
earlier draft; by heading order it is **§6.6** — §6.4 is Additionality) is a
**publication** rule, not a submission rule: evidence *"will be available **to the
public** through Isometric's platform"*, enumerating the PDD, GHG Statement,
measurements and supporting documentation such as calibration certificates,
emission factors, literature and permits. **Raw sensor time-series is not on that
list.** Raw 1-minute data is *"made available upon request"* and retained
≥5 years; it is **not** stated to be uploaded.

**[GAP]** The protocol never names Certify and prescribes no submission
mechanism or format.

### 4.2 Route comparison

| | **A. `pyrolysis_reactor` MeasurementSamples** | **B. Sensors + Parquet time-series** | **C. Monitoring Submissions** | **D. Documented combination** |
|---|---|---|---|---|
| Live-API existence | **Yes** — `pyrolysis_reactor` ∈ `MeasurementTypeKey` | **Yes** — `biochar_pyrolysis_reactor_facility_time_series` ∈ `DataUploadSubmissionType` | Yes (generic) — `/projects/{id}/monitoring_requirements/{id}/submissions` | n/a |
| Documented purpose | *"`Production batch` and `Pyrolysis reactor` samples are **required for all Biochar projects** for CDR quantification and monitoring, **respectively**"* | Continuous/regularly-sampled sensor readings; publishes a **Biochar Pyrolysis Reactor** property table | *"currently configured for"* salt-cavern / subsurface-biomass / permeable-reservoirs modules **only** | **none found** |
| Published properties | **NONE** — no catalogue for this type | temperature `degC`; pressure `bar`; MASS_FRACTION × CH₄/CO/CO₂/H₂/**N₂O** `mg/kg`. **No flow-rate property** (DAC tables have one) | n/a — document-based | — |
| Cadence | **not stated anywhere** | Rows are **aggregation periods**: start/end timestamp, `sensor_reference`, min, max, mean, median, count, stddev (Bessel), first/last timestamp. Extra columns ignored | `Frequency` enum incl. `continuous`, `every_1_days`, `once_per_production_batch` | — |
| Facility association | **None** — no `facility_id`; associates via `project_id` | **Direct** — `facility_id` on both `CreateSensorRequest` and `CreateDataUploadSubmissionRequest` | **None** — scoped to project/storage location/storage unit; **no facility field exists** | — |
| Equipment / calibration metadata | none | `manufacturer`, `model` on Sensor (optional) | carried naturally as the source document | — |
| Workflow | 200 → `MeasurementSample`; 422 validation. No GET-by-id, no PATCH; DELETE exists | file-upload → signed PUT → submission → poll; status `pending`/`completed`/`failed` + `error_message`; Parquet only, ≤100 MB | POST/GET/DELETE; auto-attaches to a GHG statement when validity ⊆ reporting period; Valid/Partial/Missing | — |
| Evidence binding | **Strong** — every `MeasurementValue` carries a `datapoint_id`; datapoints bind Sources | **Weak/absent** — no source or datapoint binding published | **Source IS the payload** (`source_id` + window + notes) | — |

### 4.3 The Biochar-vs-DAC time-series tension

Verified through two independent channels on 2026-08-04. **The conflict is real,
current, and internal to a single page.**

**[CONFLICT]** The guide's introduction states: *"Time series data can currently
be associated with either a Direct Air Capture (DAC) capture facility or a DAC
storage location (saline aquifer)."* The **same page** then publishes a
**Biochar Pyrolysis Reactor** property table *and* a **WAE Wastewater Treatment
Plant** table, and the live enum carries both non-DAC submission types.

**[INF, strong]** The DAC-only sentence is stale prose that was not updated when
Biochar and WAE support landed. Two independent non-DAC pathways with published
property tables and live enum values is not a plausible shape for an unsupported
feature. **This remains an inference.** "Enum exists and table published" does
not establish that Isometric intends this as the reactor channel for a v1.1
agricultural-soils project, that it is enabled on this project's account, or
that a verifier will accept aggregated Parquet. Do not upgrade it to a decision
without Isometric confirmation **plus** an end-to-end sandbox `completed` status.

**A second, equally blocking tension.** **[GAP]** `pyrolysis_reactor` is called
required by the field-measurements guide, yet the measurement-samples guide —
which publishes a property catalogue for **every** other type, including Biochar
Production batch and Biochar Soil — publishes **none** for it. A required sample
type with no published property contract cannot be implemented from
documentation alone. Circumstantially **[INF]**, `QuantityKindQualifierType`
contains `pyrolysis_reactor_emissions` and `flue_stack_emissions` qualifiers
with no home in any published catalogue, and `QuantityKindType` carries
`mass_flow_rate`, `time`, `temperature`, `pressure` — but expressibility is not
a contract.

**[CONFLICT] N₂O asymmetry — and it dissolves at v1.3.** The Certify Biochar
time-series table includes N₂O mass fraction; protocol **v1.1** §9.2.2 requires
CH₄, H₂, CO and CO₂ only. But **v1.3** requirement `R-TKNH-0` reads *"Projects
must select the method used to monitor stack emissions for **CH₄, N₂O, CO, and
CO₂**"* — H₂ dropped, N₂O added, with prose on N₂O formation at C/N < 30.
Certify's table is a **superset aligned with v1.3**, not an asymmetry. This
"conflict" is an artifact of pinning to v1.1.

**[INF] The flow-rate gap makes Route B provably incomplete** for a §9.2.2
continuous-instrumentation project: the protocol requires continuous gas mass
flow in t/h, and the Biochar time-series property table publishes no flow-rate
property at all.

**[INF] Route C can be near-eliminated** on first-party evidence: the
storage-monitoring guide scopes monitoring submissions to three storage modules
that do not include biochar-agricultural-soils, and
`ProjectMonitoringRequirement` has no facility field, while reactor monitoring
is inherently facility-scoped. This is the closest thing to a negative
resolution in this section — it still warrants a confirmation question.

**[INF]** Aggregated Parquet does not by itself discharge §9.1.2 / §9.2.2's
"raw data available on request" obligation.

---

## 5. Blocker 4 — correction and reconciliation lifecycle

### Status: source-conflicted

| Resource | Published operations | Documented correction path | Downstream-reference behaviour |
|---|---|---|---|
| **Production Batch** | list, create, get, delete. **No PATCH** | **None documented** | **Undocumented** — DELETE carries no stated precondition, unlike `DELETE /datapoints/{id}` and `DELETE /components/{id}` which document in-use failure |
| **MeasurementSample** | list, create, delete. **No PATCH, no GET-by-id** | **None documented** | **Undocumented and materially risky** — POST mints datapoints server-side; whether DELETE cascades, orphans, or is refused when those datapoints are bound is unstated |
| **Sensor** | list (filters `project_id`, `reference`), create, get. **No PATCH, no DELETE** | **None — no correction path exists** | A mis-created sensor is permanent, and its `reference` is the join key for Parquet rows |
| **Data upload submission** | list (filter `status`), create, get. **No PATCH, no DELETE** | **None documented** | Overlapping re-uploads have no documented merge/replace/dedupe semantics |
| *(contrast)* Datapoint, Component, GHG entry, Removal, Source, Feedstock type, Storage location | full **PATCH** | PATCH, then resubmit the statement if calculations changed | explicit recalculation semantics |

### Documented guarantees

1. **[REQ]** PATCH-able resources recalculate automatically: *"Associated
   components and removals will be recalculated, if they are not in an immutable
   state."*
2. **[REQ]** Verifier visibility is gated on statement resubmission.
   `pending_total_co2e_removed_kg` is the authoritative signal — **null means no
   resubmission needed**; non-null is the post-resubmission total. This is an
   explicit affordance for batching many corrections before exposing them.
3. **[REQ]** **No version history via API, ever**: *"You cannot currently query
   previous versions and we have no plans to support this functionality.
   Instead, you should use the UI."* Clients must keep their own submission
   journal.
4. **[REQ]** Immutability is **state-based**, not resource-based (DRAFT-only
   deletes; `locked_used_in_verified_removal` is terminal).
5. **[REQ]** Supplier reference IDs are unique per (supplier, resource type);
   duplicate POSTs error.
6. **[REQ]** Visibility ratchets: org only → assigned verifier on submission →
   public registry on issuance.

### The conflict

**[CONFLICT]** The `supplier-reference-id` guide states: *"The
`supplier_reference_id` can also be used in queries to GET endpoints that return
multiple objects."* This is **false for the two resources this design depends
on**:

- `GET /datapoints` — **has** `supplier_reference_id` (alongside `project_id`,
  `measurement_sample_id`, `used_in_ghg_entry`).
- `GET /measurement_samples` — **does not**. Parameters are exactly `last`,
  `before`, `first`, `after`, `x-client-secret`.
- `GET /production_batches` — **does not**. Same five.
- `GET /sensors` — has `reference`, a differently-named field, plus `project_id`.

Combined with a 50-item page cap, cursor-only pagination, and no
`GET /measurement_samples/{id}`, **there is no bounded way to look up a
measurement sample you created.** Recovery from a lost POST response requires a
full scan of every measurement sample the org has ever created.

### Client-side handling (noma recommendation, **not** an Isometric guarantee)

- **The local submission journal is the system of record for external IDs.**
  Given guarantee 3 and the missing filters, `certification_submissions`
  (`payloadSnapshot` + `payloadHash` + `version`) is authoritative, not a cache.
  This should be stated as a deliberate architectural constraint.
- **Correct by supersede-with-new-supplier-ref, not delete-and-recreate.** Never
  DELETE a measurement sample or production batch whose datapoints may already
  be bound into a component or a submitted GHG entry; mint v+1 instead and leave
  the stale resource in place.
- **Treat sensors as immutable and append-only.** Derive `reference` values
  deterministically and validate before the first POST — there is no second
  chance.
- **Bound the reconciliation scan.** Fail loudly toward the journal rather than
  scanning unbounded.

---

## 6. Data classification

**[REQ] — read this before implementing any of the rows below.** Certify has **no
documented submission gate beyond API schema validity**: *"Certify will check your
data and flag issues before submission. **Issues are not gating to submission**,
but we recommend addressing, disputing or commenting on every issue as they must
be resolved before your GHG Statement is verified."*
(<https://docs.isometric.com/user-guides/certify/ghg-statement>) Every protocol and
module obligation below is therefore either an API-schema gate or a
**verification-time** obligation. **Do not implement any of them as a client-side
blocker on submission** unless noma independently decides to, and records that as
a product choice rather than a registry requirement.

| Class | Contents |
|---|---|
| **API-validation gate** (the HTTP request fails without it) | Production Batch: `facility_id`, `feedstock_type_ids[]`, `supplier_reference_id`, `kind`, `started_at`, `ended_at`, `mass`. MeasurementSample: `supplier_reference_id`, `measured_at`, `project_id`, `feedstock_batch_id`, `measurement_location_id`, `measurement_type`, `storage_location_id`, `values[]` (several required-but-nullable). Sensor: `reference`, `measurement_property`, `units`. File upload: `content_type` = `application/vnd.apache.parquet`, `content_length` ≤ 100,000,000, `file_name`. Data upload submission: `submission_type`, `file_upload_id`. |
| **Validation-time (PDD)** | Reactor engineering design diagram including temperature/pressure sensor positioning (§9.1.1); the sampling plan with number, frequency, justification, and how it addresses within-batch heterogeneity (Ag Soils §3.4.1); QA/QC processes (§3.4.3); analytical methods per measurement; PAH-waiver mitigation evidence if claimed (§3.3); O/C, ash, volatile matter or fixed carbon, and the PAH panel — minimum 1 sample each, re-measured only if feedstock, reactor or process parameters change; heavy-metal and organic-contaminant panels at the same cadence (Ag Soils §2.2). |
| **Verification-time** (produced to the VVB on request; retained ≥5 years) | Carbon content, inorganic carbon, moisture and H/C organic per production batch at whatever sample count the elected §8.3.1 branch implies; which laboratory was used; calibration records and CRM-referenced checks; raw + reduced + summary characterization data with analytical uncertainty (§3.5); R₀ histograms at verification for the 1000-year option; raw ≥1-minute reactor data for the elected monitoring branch; weigh tickets; leak-test proofs; signed emissions-test reports. **None of these is a precondition to POSTing or to submitting a GHG statement.** |
| **Conditional** (triggered by a project method choice) | Sample-count design: ≥3 replicates per batch **or** justified within-batch-homogeneity evidence (§8.3.1). Lab qualification: ISO 17025 accreditation **or** periodic external validation at an Isometric-agreed frequency (§3.4.2). Gas-loss route: validated reactor model (primary) **or**, only where the model is not possible, sub-atmospheric pressure monitoring **or** ≥12-monthly leakage testing. Direct-emissions route: continuous instrumentation (§9.2.2) **or** accredited stack testing (§9.2.4). Durability path: `s_fraction` + R₀ histograms (1000-yr) vs `h_c_molar_ratios` + `soil_temp` (200-yr). Soil temperature: ISO 4974 project baselining **or** a justified global-dataset value. Method B: winsorization and the 6-month eligible-sample window. |
| **Recommended / optional** | `display_name` on a Production Batch; `standard_deviation` on any `ScalarQuantity` (and explicitly to be omitted for accurate primary data such as weigh-scale mass); Sensor `manufacturer` / `model`; BET surface area, porosity, CEC, pH, NMR/XPS bonding state; a ~100 g physical archive sample. |

The closest thing to a genuine submit-with-the-statement obligation in either
document is Ag Soils §4.1.2.1, and its modal is "should": *"The information for
each field **should** be submitted with the GHG statement"* — irrigation schedule
and source, tillage practice, fertilizer usage and composition, crop type and
rotation, and pre/deployment/post-deployment monitoring. That is field
management, not production-batch chemistry.

---

## 7. Implications for current repository seams

Moved to its own companion doc:
[`production-data-follow-up-repo-seams.md`](./production-data-follow-up-repo-seams.md).

Headline findings there: Production Batch does not exist in the integration at
all (`productionBatchId` has zero callers, so every sample we have posted carries
`production_batch_id: null`); `credit_batches` is the ready-made local identity
minus three fields; the two durability paths declare the same measurement with
different `quantity_kind`s; the reconciliation scan is unbounded; and the
telemetry pipeline's canonical input table is written only by the seeder — under
a schema comment citing a protocol appendix that does not exist.

## 8. Ready-to-send Isometric support questions

All 32 questions are maintained as a separate, copy-pasteable file:
[`production-data-follow-up-support-questions.md`](./production-data-follow-up-support-questions.md)
— grouped as PB-1..7 (mass basis), MS-1..9 (sample binding), RM-1..10
(reactor monitoring), and LC-1..6 (lifecycle).

Send first, in this order: **MS-1** (source attachment to locked sample
datapoints — blocks evidence binding), **PB-1** (mass basis), **RM-1 + RM-2**
(monitoring route and its missing property catalogue), **LC-1** (reconciliation
filters).

---

## 9. What this report does not decide

- **The mass basis.** Open. Do not implement a wet/dry/applied choice or a
  moisture conversion for `production_batches.mass` until PB-1 is answered.
- **The reactor-monitoring route.** Open. Route C is near-eliminated on
  first-party evidence; A and B both remain live, and B is provably incomplete
  on its own for a §9.2.2 continuous-instrumentation project.
- **The three-record vs one-record-with-repeated-values grain** (§7.3). Both
  satisfy the blueprint arithmetic because the calculation binds datapoints, not
  samples. This is a design decision for the implementation plan.
- **Whether to close the orphaned readings pipeline** (§7.6). Downstream of the
  route decision.

Live-template inspection was explicitly out of scope for this pass. Before any
implementation work on §3, re-run
`pnpm tsx scripts/isometric-smoke.ts inspect-template <prj>` and treat the live
template — not the published catalogue — as authoritative for input keys, data
shapes and units.
