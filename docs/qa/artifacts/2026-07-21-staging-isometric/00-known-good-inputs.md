# Known-Good Synthetic Inputs — Staging Isometric QA (2026-07-21)

**Purpose.** A concrete, in-range input set for exercising one biochar Removal end
to end against the Isometric **sandbox** Certify environment from staging. Every
value below is synthetic. Nothing here is a credit claim.

**Authority.** Protocol facts were pulled from the connected Isometric MCP server
on 2026-07-21 (`how_to` called first, then `protocols_list`,
`protocols_get_metadata`, `protocols_get_content`, `protocols_analyze`,
`openapi_documents_get_object`). Repo files are non-authoritative
interpretations — `docs/isometric/README.md` says so explicitly. Where the two
disagree, the registry wins and the disagreement is listed in
[§10 Uncertainties](#10-uncertainties-to-confirm-in-the-staging-ui).

> Any AI summary of protocol content — including this file — is **not
> authoritative**. Verify against the registry URLs cited in §11.

---

## 1. Protocol, module and version choice

### 1.1 What the registry currently offers

| Content | Slug | Minor versions CERTIFIED | Latest patch |
|---|---|---|---|
| Protocol | `biochar` | 1.0, 1.1, **1.2**, **1.3** | 1.2 → `1.2.2`; 1.3 → `1.3.0` |
| Storage module | `biochar-storage-soil-environments` | **1.2**, **1.3** | 1.2 → `1.2.2`; 1.3 → `1.3.0` |
| Feedstock module | `biomass-feedstock-accounting` | 1.0–**1.3** | `1.3.0` |
| Energy module | `energy-use-accounting` | 1.0–1.3 | — |
| GHG module | `ghg-accounting` | 1.0, 1.1 | `1.0.1` / — |
| Transport module | `transportation` | 1.0, 1.1 | `1.1.0` |
| Embodied module | `embodied-emissions` | 1.0 | `1.0.3` |

`biochar` v1.3 was certified 2026-05-22. Its release note is limited in scope:
*"Added new module Mobile Reactors v1.0; Updated … Energy Use Accounting v1.3,
GHG Accounting to v1.1, Biochar Storage in Soil Environments v1.3 … Updated
Appendix 4: Risk of Reversal Questionnaire to align with Standard 2.0 updates;
Minor typographical fixes."* The soil module's v1.3.0 note is a single line:
*"Updated Buffer Pool section to align with Standard 2.0 updates."*

### 1.2 The choice for this run

**Use `biochar` v1.2 + `biochar-storage-soil-environments` v1.2 as the
interpretation baseline, and confirm the staging project's actual version before
submitting.**

Reasoning, in order:

1. **`docs/isometric/versions.json` is the repo's single version-pin file** and
   pins protocol `biochar` 1.2 / patch 1.2.0 and module
   `biochar-storage-soil-environments` 1.2 / patch 1.2.0 (plus
   `biomass-feedstock-accounting` 1.3, `energy-use-accounting` 1.2,
   `transportation` 1.1, `ghg-accounting` 1.0, `embodied-emissions` 1.0). The
   repo's requirement mapping, `condition-registry.md` trigger IDs and schema
   coverage were all derived against that pin.
2. **The staging removal template was authored against 1.2-era blueprints.**
   `src/lib/isometric/transformers/measurement-sample.ts:13` records that the
   measurement properties, blueprint keys and units "were confirmed by the live
   coverage-check … sandbox template `rvt_1KS4S43VPSBXA26X`". A QA run's job is
   to exercise *that* template, not a version the template was never authored
   against.
3. **The 1.2 → 1.3 deltas do not touch the numbers this run depends on.** Both
   release notes point at Buffer Pool / Standard 2.0 alignment, the reversal
   questionnaire, and dependent-module bumps — not at the durability equation,
   the H/C_org gate, or the chemistry thresholds. Treat that as *reason to
   proceed*, not as proof; re-verify if staging turns out to be on 1.3.
4. **The registry project, not this document, decides.** The protocol version is
   a property of the Isometric project the facility is linked to
   (Certification → Settings). Read it there first. If staging is on 1.3, the
   input set below still stands, but re-run `protocols_get_content` for
   `biochar-storage-soil-environments` 1.3 §3 and §5 before treating any
   threshold as confirmed.

**Not chosen, and why:**

- `biochar-crcf` v1.0, `biomass-feedstock-accounting-crcf`, `ghg-accounting-crcf`
  — all **DRAFT**, consultation closed 2026-06-17. Never QA against a draft.
- `biochar-storage-low-oxygen`, `biochar-storage-built-environment` — out of the
  repo's declared scope (`docs/isometric/README.md`).
- `biochar-production-distributed-small-scale`,
  `biochar-production-combustion-co-product`,
  `biochar-production-mobile-reactor` — alternative production modules; noma
  models a fixed continuous reactor, so none applies.

---

## 2. Durability tier

**Choose `200_year`.**

The soil module offers exactly two crediting options and no others (there is no
100-year option — `CONTEXT.md`, *Durability tier*):

| Tier | Basis | Required chemistry |
|---|---|---|
| **200-year** | Woolf et al. (2021), modified for conservatism | H/C_org ratio + soil temperature |
| 1000-year | Sanei et al. (2024/2025) | Mean random reflectance R₀ + non-reactive carbon by TGA |

Reasons to pick 200-year for a known-good run:

- **It is the implemented, coverage-checked path.** Two blueprints exist and are
  pinned in code: `biochar_sequestration_200_year_c_org` (lab-sampled) and
  `biochar_sequestration_200_year_unsampled` (Method B). Use the `_c_org` one.
- **The 1000-year path carries a known live-vs-module divergence.**
  `measurement-sample.ts:70-81` documents that the live
  `biochar_sequestration_1000_year` blueprint takes `carbon_contents`,
  `product_mass` and `s_fraction` and computes
  `mean(s_fraction) − √(mean·(1−mean)/n)` — with **no non-reactive-carbon input
  and no 0.95 cap**, both of which the module's Eq. 6 requires. That divergence
  is flagged in ADR 0013 / `docs/open-questions.md`. A QA run should not try to
  establish known-good behaviour on a surface that is itself unresolved.
- **1000-year needs ≥500 individual R₀ measurements per replicate** (ISO
  7404-5:2009) plus TGA re-pyrolysis data — a much larger synthetic fixture with
  more ways to be wrong.

> **Facility-level trap.** The durability tier is declared on the **facility** and
> inherited by its credit batches, samples and removal template — there is no
> per-batch override (`CONTEXT.md`; ADR 0021). But
> `src/schemas/facilities.ts:174` defaults `durabilityOption` to **`1000_year`**,
> while `src/schemas/samples.ts:197` defaults to `200_year`. **Explicitly set the
> QA facility to `200_year`** rather than accepting a default. A tier/template
> mismatch fails closed at submit time via
> `expectedSequestrationBlueprintKeys()`.

---

## 3. Feedstock

**Choose a woody forestry / wood-processing residue** — e.g. untreated softwood
sawmill residue chips.

Per `biomass-feedstock-accounting` v1.3 §Introduction, eligible categories are
exactly:

- Forestry residues and downstream wood processing residues ← **use this**
- Agricultural residues
- Industrial residues
- Municipal wastes
- Invasive species

All eligible feedstocks are **wastes or residues**. Purpose-grown biomass
(food/feed/energy crops, trees grown for BiCRS, material destined for long-lived
wood products) is **prohibited** — there is no path through the module.

Why woody residue specifically: the biochar protocol singles out feedstocks with
a **C/N ratio under 30** (manure, biosolids, seaweed) as triggering additional
N₂O monitoring obligations during pyrolysis. Softwood residue sits far above
C/N 30, so the run avoids that entire branch.

**Registry feedstock type.** The Certify `FeedstockType` object is
`{ id (ftt_…), name, supplier_reference_id }` — a free-form `name`, **not an
enum**. The catalogue is account-global and browse-only in noma
(`src/lib/isometric/feedstock-types.ts`): noma keeps its own local
`feedstock_types` table and surfaces the registry list read-only for
cross-reference. So: pick the closest wood-residue entry from the registry
catalogue shown in the feedstock-type form and **record its exact `name` and
`ftt_` id in the run log** — do not invent a name.

Local record, `usage = pyrolysis` (blend-usage types are internal-only and never
submitted — `CONTEXT.md`, *Feedstock type*).

---

## 4. Sample chemistry — thresholds and the recommended value set

All results **must be reported on a dry basis** (module §3.3). Minimum **3
independent replicates per credit batch**, taken from distinct points/days across
the batch and analysed individually — *not* three aliquots of one grab
(`CONTEXT.md`, *Replicate*; protocol §8.3.1).

### 4.1 Gating thresholds (module Table 2 / Table 3)

| Property | Unit | Threshold | Gates? |
|---|---|---|---|
| Molar **H/C_org** | ratio | **< 0.5** | Yes — eligibility + drives F_durable |
| Molar **O/C_org** | ratio | **< 0.2** | Yes — eligibility |
| Total carbon | % w/w | — | Required, no threshold |
| Inorganic carbon (C_inorg) | % w/w | — | Required, no threshold |
| Total hydrogen (H) | % w/w | — | Required (feeds H/C_org) |
| Total oxygen (O) | % w/w | — | Required (feeds O/C_org) |
| Total nitrogen (N) | % w/w | — | Required |
| Total sulfur (S) | % w/w | — | Required |
| Moisture | % w/w | — | Required |
| Ash | % w/w | — | Required |
| pH | unitless | — | Required, no threshold |
| Salt content | g kg⁻¹ | — | Required |
| Bulk density (<3 mm) | kg m⁻³ | — | Required |
| Nutrients P, K, Mg, Ca, Fe | g kg⁻¹ | — | Required (declaration) |
| Heavy metals Pb/Cd/Cu/Ni/Hg/Zn/Cr/As | g t⁻¹ DM (= mg kg⁻¹) | Pb 300 · Cd 5 · Cu 200 · Ni 100 · Hg 2 · Zn 1000 · Cr 200 · As 20 | **Yes** |
| PAH — EFSA 8 | g t⁻¹ DM | **≤ 1** | **Yes** |
| PAH — EPA 16 | g t⁻¹ DM | declaration only | No |
| PCDD/F (17) | ng kg⁻¹ DM | **≤ 20** | **Yes** |
| PCB (12 WHO) | mg kg⁻¹ DM | **≤ 0.2** | **Yes** |
| Random reflectance R₀ | % | ≥ 2 % creditable fraction | 1000-year only — **skip** |
| Non-reactive carbon | % | — | 1000-year only — **skip** |

Recommended (not required, no threshold): specific surface area (m² g⁻¹, BET ISO
9277:2022), porosity (%), particle-size distribution, volatile matter, water
holding capacity, NMR bulk carbon bonding state, XPS surface bonding state.

### 4.2 Recommended replicate set (3 replicates, one credit batch)

Deliberately mid-range: comfortably inside every gate, with a small non-zero
spread so the registry's standard-deviation handling is actually exercised, and
**not** clipped by the 0.95 F_durable cap (a clipped value would mask arithmetic
errors).

| Field (dry basis) | Rep A | Rep B | Rep C | Mean | Std dev |
|---|---|---|---|---|---|
| Total carbon % | 82.4 | 82.0 | 81.6 | **82.0** | 0.400 |
| Inorganic carbon % | 1.6 | 1.5 | 1.4 | **1.5** | 0.100 |
| Organic carbon (C_org) % *(derived)* | 80.8 | 80.5 | 80.2 | **80.5** | 0.300 |
| Total hydrogen % | 2.20 | 2.15 | 2.10 | **2.15** | 0.050 |
| **Molar H/C_org** *(derived)* | 0.324 | 0.318 | 0.312 | **0.318** | 0.0062 |
| Total oxygen % | 10.30 | 10.20 | 10.10 | **10.20** | 0.100 |
| **Molar O/C_org** *(derived)* | 0.096 | 0.095 | 0.094 | **0.095** | 0.001 |
| Total nitrogen % | 0.62 | 0.60 | 0.58 | 0.60 | 0.020 |
| Total sulfur % | 0.05 | 0.05 | 0.05 | 0.05 | 0.000 |
| Ash % | 5.10 | 5.00 | 4.90 | 5.00 | 0.100 |
| Moisture % (as received) | 8.2 | 8.0 | 7.8 | 8.0 | 0.200 |
| pH | 9.3 | 9.2 | 9.1 | 9.2 | 0.100 |
| Salt content g kg⁻¹ | 2.6 | 2.5 | 2.4 | 2.5 | 0.100 |
| Bulk density kg m⁻³ | 205 | 200 | 195 | 200 | 5.0 |

Mass closure on Rep B: C 82.0 + H 2.15 + N 0.60 + S 0.05 + O 10.20 + ash 5.00 =
**100.00 %**. Keep it closing — a fixture that doesn't sum is the first thing a
reviewer will (correctly) reject.

Molar arithmetic (atomic weights C 12.011, H 1.008, O 15.999), Rep B:
`H/C_org = (2.15/1.008) ÷ (80.5/12.011) = 2.1329 / 6.7022 = 0.3183` ✓ < 0.5
`O/C_org = (10.20/15.999) ÷ 6.7022 = 0.6375 / 6.7022 = 0.0951` ✓ < 0.2

### 4.3 Contaminants — one sample, representative of the process

Monitoring frequency for these is **1 sample at project validation**, not per
batch, unless feedstock/reactor/process parameters change.

| Analyte | Value | Cap | Unit |
|---|---|---|---|
| Pb | 12 | 300 | g t⁻¹ DM |
| Cd | 0.3 | 5 | g t⁻¹ DM |
| Cu | 25 | 200 | g t⁻¹ DM |
| Ni | 8 | 100 | g t⁻¹ DM |
| Hg | 0.05 | 2 | g t⁻¹ DM |
| Zn | 90 | 1000 | g t⁻¹ DM |
| Cr | 15 | 200 | g t⁻¹ DM |
| As | 1.2 | 20 | g t⁻¹ DM |
| PAH EFSA-8 | 0.35 | 1 | g t⁻¹ DM |
| PAH EPA-16 | 3.2 | (declare) | g t⁻¹ DM |
| PCDD/F (17) | 4 | 20 | ng kg⁻¹ DM |
| PCB (12 WHO) | 0.02 | 0.2 | mg kg⁻¹ DM |

Nutrient declaration (P 6.0, K 12.0, Mg 3.5, Ca 20.0, Fe 4.0 **g kg⁻¹**): the
module requires the declaration, but noma's nutrient claim is a **separate opt-in
flag** with its own unit convention — see §10.3. **Leave
`nutrientClaimEnabled = false` for this run.**

### 4.4 Sampling regime

Set the production process to **Method A** (`method_a`). Method B requires a ≥30
prior Method-A sample baseline on that production process plus a ≥1-in-10 sampled
cadence, and routes to the `_unsampled` blueprint whose live POST is
flag-gated. Method A + a sampled batch → `biochar_sequestration_200_year_c_org`,
the confirmed path.

---

## 5. Temperature — two distinct temperatures, do not conflate

### 5.1 Soil temperature (T_soil) — a durability input

| Field | Value |
|---|---|
| `soilTemperatureSource` | **`global_database`** |
| `soilTemperatureC` | **15.0 °C** |
| Cited source | Lembrechts et al. (2022) global soil-temperature dataset, or equivalent |

Rules (module §5.1.1.3.1 / requirement `R-F5RZ-0`):

- Two accepted sources only: **`baseline`** (project's own ISO 4974 measurements,
  ≥10 measurements per site-month for the preceding year, averaged) or
  **`global_database`**. `global_database` is chosen here because it needs no
  synthetic year-long measurement series.
- **Air temperature must never be used as a proxy** — mean annual soil temps run
  2–4 °C warmer than air.
- **Conservative floor of 7 °C** is applied by the registry.
- Submit to a **maximum of one decimal place**.
- If soil-temperature variation inside the project boundary exceeds **1 °C**, the
  project must be subdivided or the **highest** (most conservative) value used.
- Recorded per **application**, not per credit batch
  (`applicationSoilTemperatureSchema`). noma's app-level range is −50…60 °C —
  wider than the protocol's effective floor; 15.0 satisfies both.

### 5.2 Pyrolysis temperature — a process/eligibility input

- The protocol sets **no mandatory minimum HHT and no minimum residence time**.
  It states that higher temperatures (**> 500 °C**) yield more stable biochar
  through larger polyaromatic structures.
- Where a numeric rule does exist it is a **stability band**: during normal
  operation the pyrolysis temperature must stay within **±10 %** of the values
  recorded during emissions testing.
- Method B additionally requires a "demonstrably stable production process,
  evidenced by consistent production temperatures and residence times".

**Recommended synthetic run parameters:** HHT **550 °C**, residence time
**25 min**, reactor telemetry held within 550 ± 55 °C for the run window. This
sits above the 500 °C stability discussion and supports the PAH risk-mitigation
argument ("sufficiently high pyrolysis temperature to ensure thermal cracking of
PAHs") if that route is ever taken — though for this run PAH is simply measured
and reported.

Telemetry CSV (canonical headers, per `docs/storage.md`): `timestamp_utc`,
`temperature_c`, `pressure_bar`, optional `dryer_frequency_hz` /
`reactor_frequency_hz`. Every row carries a full UTC timestamp; rows are clipped
to the run's `start_time`/`end_time`.

---

## 6. Required chain data

### 6.1 Batch and process structure

| Concept | Rule | QA value |
|---|---|---|
| Production batch = **credit batch** | One feedstock, consistent pyrolysis conditions, **< 1 month** window (`R-6YSW-0`) | One batch, 2026-06-01 → 2026-06-30 |
| Batch ID | Unique, **sequential**, used on all documentation (`G-MYJQ-0`) | e.g. `E2E-CB-2026-06` |
| Production process | `(facility, feedstock)`, spans reactors; `established_at` = real operational start | One process, Method A |
| Replicates | ≥3 independent, per credit batch | 3 (§4.2) |
| Removal | Facility-scoped; N credit batches → 1 Removal (default 1:1) | 1 batch → 1 Removal |
| Reporting period | Starts at biomass sourcing, ends at biochar application | Covers the June batch's full chain |
| Stockpiling | **≤ 12 months** production → end use (`G-6VWJ-0`) | Applied within ~3 weeks |

### 6.2 Traceability chain to populate

`Facility → Reactor → Feedstock Delivery → Feedstock → Production Run → Biochar
Product → Order → Delivery → Application → Credit Batch → Sample`

Chain-of-custody requirements (`R-3MYN-0`): unique batch IDs on all
documentation; documentation at **every** custody handoff (dispatch notes,
receiving reports, QC certificates, signed delivery notes / BOLs / invoices);
records retained **≥ 5 years**; a chain-of-custody diagram or equivalent.

### 6.3 Application / storage event

| Field | Value | Notes |
|---|---|---|
| Deployment pathway | **Direct soil application** | Simplest of the three (§8.5). Avoids on-site mixing (§8.6) and third-party sale (§8.7), which add affidavits and <50 % v/v mixing evidence |
| Land use | Agricultural soil (arable) | Eligible per module §Applicability |
| `evidenceMethod` | **`visual`** | See §7 |
| `biocharAppliedTons` / `biocharAppliedDryTons` | 10.870 / **10.000** | Dry mass is what the durability maths uses |
| `fieldSizeHa` | 5.0 | |
| `fieldIdentifier` | `E2E-FIELD-01` | |
| `cropType` | `maize` | |
| `gpsLatitude` / `gpsLongitude` | must be a **complete pair** | `gpsPairSuperRefine` rejects a half-filled pair |
| `applicationMethodType` | `mechanical` | |
| `applicationDate` | within the reporting period, after delivery | |

Application-rate sanity: 10.0 t dry over 5.0 ha = **2.0 t ha⁻¹** — a normal
agronomic rate, and the module requires the rate not exceed jurisdictional
maximum loading rates.

Site-selection constraints to respect in the synthetic scenario: not applied to
frozen (≥12 h in the preceding 24 h), waterlogged or snow-covered land; not on
steep erosion-prone slopes; ≥10 m from any watercourse and ≥50 m from any spring,
well or borehole.

### 6.4 Feedstock accounting inputs (per delivery/batch)

Supplier-reported, per `biomass-feedstock-accounting` v1.3:

- Feedstock **mass** (tonnes; wet and dry) — evidenced by weigh-scale tickets
- Feedstock **TOC content** (%) — lab analysis, ISO 20236:2024
- **Counterfactual** parameters, assessed per feedstock source (≈10-yearly):
  `CO2e_CounterfactualEmissions15` and `CO2e_CounterfactualStorage50`, both in
  **t CO₂e**
- **Market leakage**: pathways ML2–ML7 define `CO2e_Leakage = 0`. Sawmill
  residue with no economic purpose fits that group — **use a zero-leakage
  pathway** and skip ML1's quantified-leakage reporting entirely.
- Sustainability chain-of-custody evidence (e.g. FSC 100 % / PEFC 100 %, or
  regional LULUCF data)

Transport legs: **distance-based only** in noma
(`transportLegConditionSchema`) — `distance_km` and `load_mass_kg` are both
required; the **emission factor comes from the Isometric blueprint, not from
us**. Record a `distanceSource` of `manual` or `document` for the QA run
(`map_estimate` needs a routing key).

---

## 7. Evidence and document requirements

### 7.1 Proof of end use — pick exactly one method

The module accepts **either** (`R-8PBP-0`); noma models this as one
`evidenceMethod` per application, and what counts as missing evidence follows
from the declared method (`CONTEXT.md`, *Evidence method*).

**Use `visual`** (`G-BCH4-0`) — required for **every storage batch**, all three
of:

1. **Stockpile before application** — biochar in bags/piles/containers at the
   site, clearly identifiable as biochar
2. **Being spread or mixed** — the active application
3. **Final incorporation** — after incorporation into soil, showing uniformity

Every photo/video must carry **embedded GPS coordinates and an accurate
time+date stamp**, consistent with the project boundary and application records.
If metadata is not auto-embedded, a separate log linking filename → GPS →
timestamp must be maintained. noma accepts a photo lacking metadata but raises a
**geotag flag** (evidence health, not an upload error) — for a *known-good* run,
supply synthetic images **with** EXIF GPS + timestamps so no flag is raised.

The alternative, `boundary` (`G-Z1CS-0`), needs high-resolution maps or GIS
layers delineating the application area (ZIP-code level if the landowner requests
anonymity) with field/parcel identifiers, **plus** logbooks giving dates and
quantities applied, evidenced by weighbridge/inventory records or affidavit. Use
it only for a second, contrasting QA case.

### 7.2 Document set to upload

noma's `DOCUMENT_TYPES` (`src/schemas/documents.ts`) — attach against the listed
entity:

| Purpose | `documentType` | Entity | Formats | Max |
|---|---|---|---|---|
| Lab certificate of analysis | `lab_report` | `sample` | PDF, PNG/JPEG/GIF/WebP, CSV/XLS/XLSX | 50 MB |
| Feedstock + product mass | `weighbridge_ticket` | `feedstock_delivery`, `delivery` | PDF, images | 25 MB |
| Custody handoff | `bill_of_lading` | `delivery`, `transport_leg` | PDF, images | 25 MB |
| Proof of delivery | `delivery_receipt` | `delivery` | PDF, images | 25 MB |
| Sale / transfer record | `invoice` | `order` | PDF only | 25 MB |
| Application evidence | `photo` | `application` | PNG/JPEG/GIF/WebP | 25 MB |
| Application evidence | `video` | `application` | MP4, WebM | 100 MB |
| Reactor telemetry | `sensor_data` | `production_run` | CSV/XLS/XLSX | 25 MB |
| Instrument calibration | `calibration_certificate` | `reactor`, `facility` | PDF, images | 25 MB |
| Project Design Document | `pdd` | `facility` | PDF only | 50 MB |
| Purchaser declaration | `affidavit` | `order`, `delivery` | PDF only | 25 MB |

The lab COA is attached as a `lab_report` **document on the Sample** — it is
**not** a separate record (`CONTEXT.md`, *Sample*).

`photo`/`video` on an application additionally carry
`applicationEvidenceRole` (visual) or `applicationLogbookEvidenceType`
(boundary). Upload through **mode 1 (real upload)** of `FormFileUpload`
(`entityType` + `entityId` + `documentType`) — the default **mockup** mode never
reaches storage (`docs/forms.md` §File upload).

### 7.3 Laboratory requirements

- Labs must conform to **ISO 17025** or equivalent (`G-YGMA-0`); sample
  preparation **should** follow ISO 13909-4:2025.
- The PDD must carry a bulleted list of the standards used per parameter
  (`G-W8P6-0`) — ISO/ASTM/DIN references as in §4.1.
- Data reports to the VVB must include raw data, replicates, reference standards,
  analytical uncertainty, n, std dev, and % error on standards.
- Records retained **≥ 5 years**; archiving a ~100 g dried subsample for 5 years
  is recommended.

For the QA run: synthetic lab name + a synthetic accreditation string in
`labName` / `labAccreditation`. **Do not use a real laboratory's name or a real
accreditation number.**

---

## 8. Accepted formats and units

| Quantity | Unit | Where |
|---|---|---|
| All reporting | **SI / metric** | Module Appendix 1 |
| Chemistry (C, H, N, O, S, ash, moisture) | % (w/w), **dry basis** | Module Table 2 |
| H/C_org, O/C_org | dimensionless molar ratio | Module Table 2 |
| Salt, nutrients | g kg⁻¹ | Module Table 2 |
| Heavy metals, PAH | mg kg⁻¹ ≡ g t⁻¹ DM | Module Table 2 |
| PCDD/F | ng kg⁻¹ DM | Module Table 2 |
| PCB | mg kg⁻¹ DM | Module Table 2 |
| Bulk density | kg m⁻³ | Module Table 2 |
| Feedstock mass | tonnes | Feedstock module |
| GHG quantities | t CO₂e, **GWP100**, latest IPCC AR | Feedstock module |
| Soil temperature | °C, ≤ 1 decimal place | Module §5.1.1.3.1 |
| Transport distance | km | `transportLegConditionSchema` |
| Timestamps | UTC ISO-8601 (`Z`) | `docs/forms.md`, readings CSV |
| Dates (form fields) | `YYYY-MM-DD`, parsed at **local** midnight | `docs/forms.md` |

**Wire units the noma→Certify transformer applies** (`measurement-sample.ts`):

| Blueprint input | Wire unit | Transform from noma |
|---|---|---|
| `soil_temp` | `degC` | none |
| `product_mass` | `kg` | none |
| `total_carbon_contents`, `inorganic_carbon_contents` | `dimensionless` | **% ÷ 100** |
| `h_c_molar_ratios` | `%` | **ratio × 100** — ⚠️ **UNCONFIRMED** |

Measurement properties: H/C_org →
`{quantity_kind: dimensionless_ratio, qualifier: hydrogen_to_organic_carbon_ratio}`;
soil temp → `{quantity_kind: temperature, qualifier: null}`; total carbon →
`{mass_fraction, total_carbon}`; inorganic carbon →
`{mass_fraction, total_inorganic_carbon}`; product mass → `{mass, null}`.

Mass/ratio caps in noma: masses are `numeric(14,3)` capped at
`MASS_INPUT_MAX_KG` = 100,000,000 kg; H/C_org and O/C_org are `numeric(7,6)`
capped at `RATIO_INPUT_MAX` = 9.999999 (`docs/forms.md`).

---

## 9. Registry-calculated fields — do not invent these

Submit the **inputs**. The registry derives everything below; hand-entering a
value here is how a QA run produces a number that looks right and means nothing.

**Isometric calculates:**

| Quantity | Formula / source |
|---|---|
| **F_durable,200** | `min(0.95, 1 − [c + (a + b·ln(T_soil))·H/C_org])`, with **a = −0.383, b = 0.350, c = −0.048** (module Table 4) |
| **CO₂e_stored** | `C_biochar × m_biochar × F_durable × 44.01/12.01` (Eq. 1) |
| **C_biochar** | `Total Carbon − C_inorg` (Eq. 2) |
| Method-B unsampled carbon | `μ_CC − σ_CC/√n` over the **6-month eligible** pool |
| 3σ winsorisation | Applied once ≥30 historical measurements exist |
| **CO₂e_Counterfactual** | Feedstock-module Eq. 1–3 from the reported counterfactual params |
| **CO₂e_Leakage** aggregate | Feedstock-module Eq. 5 |
| Activity data → CO₂e | Emission factors / GWPs are **registry fixed constants** |
| Co-product emissions allocation | By energy content / system boundary |
| **CO₂e_Removal,RP** | `CO₂e_Stored − CO₂e_Counterfactual − CO₂e_Emissions` |
| Uncertainty discount | From the submitted standard deviations |
| **Buffer pool** | **2 %** of issued credits (Very Low Risk of Reversal) |

**Expected registry output for the §4.2/§5.1 value set — a check figure, not an
input:**

```
a + b·ln(15.0)  = −0.383 + 0.350 × 2.70805 = 0.564818
× H/C_org 0.318 = 0.179613
+ c (−0.048)    = 0.131613
F_durable,200   = min(0.95, 1 − 0.131613) = 0.8684

C_biochar = (82.0 − 1.5)/100 = 0.805
CO2e_stored = 0.805 × 10,000 kg × 0.8684 × 3.66445 ≈ 25,617 kg ≈ 25.6 t CO2e
```

That is **gross stored CO₂e before** operational/embodied/transport/leakage
deductions and before the 2 % buffer. If the staging UI shows a net figure within
a plausible margin below ~25.6 t, the durability path is wired correctly. Note
F_durable = 0.868 is **not** at the 0.95 cap — deliberate, so a cap can't hide a
bad calculation.

**Also not ours to invent:** transport emission factors (blueprint-supplied),
any GWP value, and — per ADR 0018 — project emissions generally; noma
deliberately shows **no net-CO₂e figure** on the traceability Sankey.

**Never submit a template carrying a zero stub** against a production project
(`CONTEXT.md`, *Zero stub*). Sandbox only.

---

## 10. Uncertainties to confirm in the staging UI

Ordered by how badly each could invalidate the run.

1. **`h_c_molar_ratios` ×100 transform is UNCONFIRMED.**
   `measurement-sample.ts:186-197` states the blueprint declares the input in
   `%` while noma stores a dimensionless ratio (~0.5), and applies ×100 as "the
   most likely transform". A wrong factor here is a **100×** error in F_durable's
   dominant term. Inspect the live template's declared unit before trusting any
   output. Tracked in `docs/open-questions.md`.
2. **Carbon-content unit (`dimensionless`, % ÷ 100) and `product_mass` binding
   are also sandbox-gated guesses** (same file, lines 138-184). Confirm against
   the live template.
3. **Which protocol version the staging project is actually on** (1.2 vs 1.3) —
   Certification → Settings. `versions.json` says 1.2; `src/config/certification.ts`
   comments cite "Biochar Protocol v1.3 … verified 2026-06-20". These disagree;
   the registry project settles it. See §1.2.
4. **Facility durability-tier default is `1000_year`** in
   `src/schemas/facilities.ts:174` while the sample form defaults `200_year`.
   Set the tier explicitly.
5. **Nutrient units.** The module expects P/K/Mg/Ca/Fe in **g kg⁻¹**;
   `sampleConditionSchema` names them `*_g_per_kg` but the form schema names them
   `phosphorusPercent` etc. (`src/schemas/samples.ts:232-236`). Two different
   units under two names for the same quantity. **Keep
   `nutrientClaimEnabled = false`** until this is resolved, then re-test.
6. **`DURABILITY_MEASUREMENT_SAMPLES_LIVE`** is a sandbox-only flag
   (`docs/security.md`) that gates the live measurement-samples submit path.
   Confirm its state on staging — with it off, the durability samples never
   reach the registry and a "successful" run proves less than it appears to.
7. **Datapoint ↔ component-input binding** (auto-link vs explicit `datapoint_id`)
   is listed as unresolved in `measurement-sample.ts:16-21`.
8. **Registry credentials + project link may be absent.** `docs/security.md`:
   staging resets deliberately do not load the Isometric trio, so Certification
   Settings shows `Credentials: Not configured` and Removals fails closed by
   redirecting to Settings. Restore before starting.
9. **Exact registry feedstock-type `name` and `ftt_` id** — read from the
   browse-only list; do not assume.
10. **`transportation` module in v1.3.** The `biochar` v1.2 metadata lists
    `transportation` v1.1 among its referenced modules; the v1.3 metadata listing
    does not. If staging is on 1.3, confirm where transport emissions are
    accounted before assuming the v1.1 distance-based equation still applies.
11. **Which blueprint keys the live template carries.** The submit-time guard
    rejects any sequestration component outside
    `expectedSequestrationBlueprintKeys(tier)`. For `200_year` that set is
    `{biochar_sequestration_200_year_c_org, biochar_sequestration_200_year_unsampled}`.

---

## 11. Authoritative citations

**Isometric registry (authoritative):**

- Protocol — Biochar Production and Storage v1.2:
  <https://registry.isometric.com/protocol/biochar/1.2> (patch `1.2.2`)
- Protocol v1.3: <https://registry.isometric.com/protocol/biochar/1.3> (patch `1.3.0`)
- Module — Biochar Storage in Soil Environments v1.2:
  <https://registry.isometric.com/module/biochar-storage-soil-environments/1.2> (patch `1.2.2`)
- Module v1.3: <https://registry.isometric.com/module/biochar-storage-soil-environments/1.3> (patch `1.3.0`)
- Module — Biomass Feedstock Accounting v1.3:
  <https://registry.isometric.com/module/biomass-feedstock-accounting/1.3>
- Module — Energy Use Accounting v1.2:
  <https://registry.isometric.com/module/energy-use-accounting/1.2>
- Module — Transportation Emissions Accounting v1.1:
  <https://registry.isometric.com/module/transportation/1.1>
- Module — GHG Accounting v1.0:
  <https://registry.isometric.com/module/ghg-accounting/1.0>
- Module — Embodied Emissions Accounting v1.0:
  <https://registry.isometric.com/module/embodied-emissions/1.0>
- Isometric Standard: <https://registry.isometric.com/standard>

**Requirement / sub-requirement identifiers used above:** `R-VGXA-0` (biochar
characterization) · `G-W8P6-0` (standards list) · `G-YGMA-0` (ISO 17025) ·
`R-S8K1-1`/`G-MP0D-0` (sampling heterogeneity) · `R-F5RZ-0` + `G-QMBJ-0` /
`G-YY2W-0` (T_soil source) · `R-BFEE-0` + `G-BX9K-0` / `G-ZJ58-0` (combined
tiers) · `R-6E1D-0` + `G-6VWJ-0`/`G-TGR7-0`/`G-E5KW-0`/`G-1TFH-0`/`G-NFB6-0`/
`G-946V-0` (stockpiling) · `R-Z4A3-0` (fuel-use reversal risk) · `R-T2X2-0`
(mixing pathway) · `R-8PBP-0` + `G-BCH4-0` / `G-Z1CS-0` (application evidence) ·
`R-WB7B-0`, `R-G030-0` (mixing / third-party sale) · `R-3MYN-0` + `G-MYJQ-0` /
`G-8KEC-0` / `G-W8A1-0` (chain of custody) · `R-ENZR-0`/`G-02XQ-0` (monitoring
table) · `R-6YSW-0` (batch duration) · `R-ADXG-0` (Method-B moisture) ·
`R-4K5P-0`/`G-R8DY-0` (soil productivity safeguard) · `G-F74T-0` (Method-B
≥30 baseline) · `G-2W0F-0` (Method-B ≥1-in-10 cadence).

**Repo references (non-authoritative interpretations):**

- `.claude/CLAUDE.md` — critical rules, docs index
- `CONTEXT.md` — Durability tier, Sample, Replicate, Method A/B, Credit batch,
  Removal, Evidence method, Monitored input, Fixed constant, Zero stub
- `docs/isometric/README.md` · `docs/isometric/versions.json` — version pins
- `docs/architecture.md` — layer stack, `withAction`, submission idempotency,
  sampling-method enforcement
- `docs/security.md` — env inventory, `DURABILITY_MEASUREMENT_SAMPLES_LIVE`,
  staging-reset credential gap
- `docs/forms.md` — numeric helpers, Zod 4 formats, date handling, upload modes
- `docs/storage.md` — document pipeline, readings CSV contract
- `src/lib/isometric/transformers/measurement-sample.ts` — blueprint keys, units,
  measurement properties, sandbox-gated confirms
- `src/schemas/isometric.ts` · `samples.ts` · `applications.ts` · `facilities.ts`
  · `documents.ts` — enums, conditional-required rules, upload rules
- `src/config/certification.ts` — Method-B thresholds, rolling-window constants
- ADRs 0013, 0016, 0017, 0018, 0020, 0021; `docs/open-questions.md`

---

*Generated 2026-07-21 for the authorized staging QA run. All values are
synthetic. No credentials, tokens, signed URLs or PII appear in this file.*
