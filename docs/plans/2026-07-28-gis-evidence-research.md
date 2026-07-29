# GIS evidence research — registry ground truth and GeoJSON ingestion

Date: 2026-07-28 · Branch: `fix/drop-distinct-run-day-sampling-rule`

> Non-authoritative interpretation. Every registry claim below links to an
> authoritative Isometric URL — verify there before making a credit claim.

## Executive summary

1. Both modules exist and both are certified: **Biochar Storage in Agricultural
   Soils v1.1** (patch 1.1.0) and **Biochar Storage in Soil Environments v1.3**
   (patch 1.3.1). They are not versions of each other; they are separate modules.
2. Which one binds is decided by the **protocol minor version**, not by
   recency. Protocol **v1.1 §10** locks in `biochar-storage-agricultural-soils`
   v1.1 and never mentions soil-environments; protocol **v1.3 §12** locks in
   `biochar-storage-soil-environments` v1.3 and never mentions agricultural-soils.
   Our Certify project is on protocol **v1.1**.
3. Under agricultural-soils v1.1 the only application-evidence obligation is
   "Project Proponents must report the boundaries of the project area", satisfied
   by maps **or** GPS coordinates **or**, alternatively, geo-tagged dated
   photos/video — and it lands in the **PDD**, not in a removal submission.
4. The "all three stages" and "weighbridge/inventory/affidavit" rules are real
   literal text — but they live in **soil-environments v1.3 §8.5.1/§8.5.2**, a
   module our protocol version does not use. Even there, §8.5.1 and §8.5.2 are
   **alternatives** (R-8PBP-0: "either"), and the logbook list is disjunctive.
5. Our code's section citation (§8.5.1/§8.5.2) is correct for soil-environments
   **v1.3**; our own `requirements-shortlist.md` cites the same content as
   §9.5.1 in **v1.2**. The numbering moved between module versions.
6. Nothing in either module, in protocol v1.1, or in the Certify API makes
   application evidence an **EVIDENCE-TO-SUBMIT** class. Protocol v1.1 §8.3.1.2
   ("Required Records & Documentation") says "must **maintain**… for at least five
   years"; the module says "must be included in the **PDD**". Our hard submission
   blocker is not supported by registry text.
7. **DATA** that must be submitted: mass of biochar applied, application date,
   application rate, storage-location identity. The Certify API models exactly
   these (`POST /biochar_applications`), and we call neither that endpoint nor
   `POST /projects/{id}/storage_locations` today.
8. Isometric **does not** publish a GeoJSON schema. `StorageLocation` is a
   lat/lon **point** — no geometry field anywhere in the Certify OpenAPI. The
   Certify UI "Removal areas" GeoJSON upload is a separate, undocumented
   UI-only surface; `reference_id` almost certainly maps to
   `supplier_reference_id` (the platform-wide external-ID convention).
9. For ingestion: normalize everything to an RFC 7946 `FeatureCollection`, 2D,
   rewound, CRS-stripped, coordinate-rounded, bbox-computed — see the pipeline
   in Question 2.
10. Reusable today: `src/config/geo.ts` (MapLibre + MapTiler + rounding
    constants), the `geoRouteCache.coordinates` jsonb `[lng,lat]` precedent, and
    the existing position-picker MapLibre wiring.

---

# Question 1 — Isometric registry ground truth

## 1.1 Which modules exist, and which one binds

| Slug | Name | Certified minor | Patch | Authoritative URL |
|---|---|---|---|---|
| `biochar-storage-agricultural-soils` | Biochar Storage in Agricultural Soils | **1.1** | 1.1.0 | https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1 |
| `biochar-storage-soil-environments` | Biochar Storage in Soil Environments | **1.3** | 1.3.1 | https://registry.isometric.com/module/biochar-storage-soil-environments/1.3 |

Both were retrieved through the Isometric MCP `protocols_get_content` tool with
`minor_version: "latest_certified"`. The MCP `how_to` tool's own routing advice
confirms the pair: "compare `biochar-storage-agricultural-soils` (certified v1.1)
and `biochar-storage-soil-environments` (certified v1.3)".

### The binding rule is protocol-version-locked, not latest-wins

From the Isometric protocol-versioning policy
(https://docs.isometric.com/user-guides/registry/protocol-versioning), verbatim:

> "Each Protocol minor version specifies exactly which Modules it uses and locks
> in their specific minor versions. Once certified, this combination never
> changes, so the Protocol minor version number alone determines the complete set
> of rules applicable to any project."

> "New Module minor versions only take effect when incorporated into a subsequent
> Protocol release. This means that new Module rules only apply when the Protocol
> itself updates and projects adopt the new minor version."

> "Existing projects are not required to adopt a new minor version of a Protocol
> until they seek renewal of their crediting period."

So a newer, certified module does **not** reach a project until the project's
protocol minor version incorporates it *and* the project adopts that version.

### Which module each protocol version locks in — read from the protocol itself

Pulled with `protocols_get_content`, `content_type: "protocol"`, `slug: "biochar"`.

**Biochar Production and Storage v1.1 (patch 1.1.1)** —
https://registry.isometric.com/protocol/biochar/1.1 — §10 "Storage", full
verbatim section:

> "For all information on what chemical and physical characterization of biochar
> must be carried out, and for calculation of CO₂e_Stored, please refer to the
> relevant storage Module."
>
> `<Module slug="biochar-storage-agricultural-soils" version="1.1">`
> Durability and monitoring requirements for Biochar Storage in Agricultural Soils.
> `</Module>`
>
> `<Module slug="biochar-storage-low-oxygen" version="1.0">`
> Durability and monitoring requirements for Biochar Storage in Low Oyxgen Burial Environments.
> `</Module>`

`biochar-storage-soil-environments` appears **zero times** anywhere in protocol
v1.1. `biochar-storage-agricultural-soils/1.1` is additionally referenced from
§6.1 (PDD) and §8.2.

**Biochar Production and Storage v1.3 (patch 1.3.0)** — what `latest_certified`
resolves to — https://registry.isometric.com/protocol/biochar/1.3 — §12 "Storage":

> `:::module{slug="biochar-storage-soil-environments" version="1.3"}`
> `:::module{slug="biochar-storage-low-oxygen" version="1.1"}`
> `:::module{slug="biochar-storage-built-environment" version="1.1"}`

`biochar-storage-agricultural-soils` appears **zero times** in v1.3. The module
was **replaced**, not renamed-and-bumped: agricultural-soils v1.1 belongs to
protocol v1.1; soil-environments v1.3 belongs to protocol v1.3.

### What our project is on

`docs/isometric/versions.json` records a UI-observed fact from the Certify
project (`prj_1K9YJ33RKSBX9FFF`, observed 2026-07-24):

- `baseline_protocol_version: "1.1"`, `current_protocol_version: "1.1"`
- `current_standard_version: "1.7"`
- Repo note, verbatim: *"Module set follows protocol v1.1 references: storage
  module is biochar-storage-agricultural-soils v1.1 (**soil-environments is a
  v1.2-only module**)"*

**Therefore: agricultural-soils v1.1 binds this project; soil-environments does
not** — unless and until we adopt a protocol minor version that locks it in.
(The MCP `how_to` tool volunteers that "the certified Biochar Production and
Storage Protocol is currently at version 1.3 (with earlier versions like v1.1
being historical)" — that is registry-wide currency, not project bindingness.)

### The protocol's own application-evidence and records rules (these DO bind)

Protocol v1.1 has no §8.5 about application evidence — **§8.5 is "Calculation of
CO₂e_Emissions, RP"**, pure emissions accounting. The binding application
evidence lives in §8.3.1.1 and §8.3.1.2.

**§8.3.1.1 "Measurement of Mass of Biochar Applied"**, verbatim:

> "The mass of biochar applied is measured via determination of weight of
> delivered biochar to the application site using a calibrated scale. This serves
> as proof of delivery to site for storage, as well as providing a weight
> measurement. The total mass of applied biochar may be determined by the
> difference in biochar delivery truck weight measured upon arrival at the
> application site and at departure, after offloading of biochar, either into
> storage or directly applied.
>
> Any truck scale used must have a current certification in accordance with
> applicable local, state, or federal regulations for legal-for-trade weights and
> measures. …
>
> In the event that truck scales are not available at the delivery site, for this
> purpose, prior to verification, it can be agreed with Isometric to instead
> provide a signed document for record of receipt, bill of lading and/or
> photograph of delivery, for each completed delivery. This serves as alternative
> proof of delivery to the delivery site for storage. In this case, all details of
> weight measurements carried out at the production site, including all
> precautions taken to prevent mass loss during transportation, must be outlined
> in the PDD."

**§8.3.1.2 "Required Records & Documentation - CO₂e_Stored, n"**, verbatim in full:

> "The Project Proponent must maintain the following records as evidence of gross
> CO₂e stored in applied biochar:
> * Weigh scale tickets for each delivery of biochar (arrival and departure
>   weights) or other equivalent records;
> * Analytical results for each ASTM D5291, or equivalent, analysis for carbon
>   content of biochar from each batch, as required; and
> * Documentation of any spills during application operations and estimates of
>   quantity released.
>
> Records of all C analyses and application masses (e.g. weigh scale tickets) must
> be maintained by the Project Proponent for verification purposes for a period of
> at least five years."

So a section literally titled **"Required Records & Documentation"** does exist —
in the **protocol**, not in the module. The 2026-07-28 session's observation that
agricultural-soils v1.1 has no such section is correct and not in tension with it.

**§6.1 "Project Design Document"** — the protocol's only geospatial requirement,
verbatim bullet:

> "Location information for biomass production, biomass pyrolysis, and the storage
> area, including project boundaries of the Project area;"

It is prose-level: no format, no coordinates, no polygons.

**§6.2.2 "Site Visits"**, verbatim (this is where photo/video actually sits in
protocol v1.1):

> "Project validation and verification must incorporate site visits to project
> facilities in accordance with the requirements of ISO 14064-3, 6.1.4.2, including
> site visits during validation and initial verification to the biomass pyrolysis
> site and the biochar application site. … In cases where it is not possible to
> line up site visits to the pyrolysis site and application site, alternative
> arrangements may be agreed in advance with Isometric, for example using photo and
> video evidence of activities at the application site, and/or introducing spot
> check site visits for ongoing operations."

**Term audit of protocol v1.1 (both pages, whole document).** Zero occurrences of:
`geotag`, `geo-tag`, `GIS`, `GPS`, `coordinate`, `map`, `shapefile`, `GeoJSON`,
`polygon`, `weighbridge`, `logbook`, `stockpile`, `audit`, and `application rate`
as a phrase. `photo` appears twice (§6.2.2 and §8.3.1.1, both permissive);
`video` once (§6.2.2, "may").

### Standard version — both numbers are real and not in conflict

- MCP `protocols_analyze` on `content_type: "standard"`, `slug: "standard"`,
  `minor_version: "latest_certified"` resolves to **Isometric Standard v2.1
  (patch 2.1.1)** — https://registry.isometric.com/standard/2.1. That is the
  latest certified Standard registry-wide.
- The Certify UI shows **current_standard_version 1.7** for our project. Under
  the same version-lock + no-forced-adoption policy above, a project keeps
  operating under the Standard/Protocol version it adopted. Both are true
  simultaneously; the project-level number is the one that governs us.
- Not verified: whether Isometric versions the Standard on the same
  adoption cadence as Protocols. The versioning doc is written about Protocols
  and Modules and says the policy is "authoritatively described in the Isometric
  Standard" — see Caveats.

## 1.2 Verbatim evidence wording — agricultural-soils v1.1 (the binding module)

The module's headings are **not numbered** in the source. The relevant section is
`### Proof of biochar spreading`, near the end of the durability chapter. Full
verbatim text of the two parts that matter:

> **Proof of biochar spreading**
>
> The following aspects of biochar application must be included in the PDD (in
> addition to all others listed in this Module), in order to verify that biochar
> spreading on agricultural soils has occurred.
>
> **Project boundaries**
>
> Project Proponents must report the boundaries of the project area. This could
> be reported using project area maps with clearly demarcated boundaries, the GPS
> coordinates for those boundaries, or the GPS coordinates for the sites at which
> biochar is applied. Alternatively, Project Proponents may choose to use
> geo-tagged and dated photo files and/or video files to provide evidence of
> biochar being spread.

> **Application rate**
>
> Application rate may be optimized for other soil health co-benefits, such as
> moisture retention, increased nutrient management/regulation and soil organic
> carbon stocks, but there is no evidence that biochar application rate has a
> significant effect on biochar-C stability. The application rate paired with the
> project boundaries must be used to confirm total mass of biochar applied. An
> average application rate for the area of biochar spreading may be used, provided
> that justification for this average rate is agreed with Isometric in advance,
> and is detailed in the PDD.

Also relevant, from `#### Environmental monitoring → ##### Field Management`:

> "The information for each field should be submitted with the GHG statement.
> Field management information includes:
> * Irrigation schedule * Irrigation source * Tillage practice * Fertilizer usage
> * Fertilizer composition * Crop type and rotation * Pre-deployment, deployment,
> and post-deployment monitoring"

### Term-frequency audit of agricultural-soils v1.1 (page 1, the whole normative body)

| Term | Occurrences |
|---|---|
| `geotag` (one word) | **0** |
| `geo-tag` | 1 (the sentence quoted above) |
| `photo` | 2 (one is "X-ray photoelectron spectroscopy") |
| `video` | 1 |
| `GPS` | 2 (both in the same sentence above) |
| `stockpile` | **0** |
| `weighbridge` | **0** |
| `affidavit` | **0** |
| `logbook` | **0** |
| `inventory` | 1 (a bibliography entry: "Greenhouse Gas Inventory Model…") |
| `shapefile` / `GeoJSON` / `polygon` | **0** |
| "Required Records & Documentation" heading | **does not exist** |

Confirming the 2026-07-28 session's finding: **there is no "Required Records &
Documentation" section in agricultural-soils v1.1**, and the module never uses
the words stockpile, weighbridge, affidavit, or logbook.

### Modal force

Agricultural-soils v1.1 uses the same Isometric modal convention as its sibling
("must"/"required" = obligation; "should"/"may"/"recommended" = best practice).
Applied to the quoted text:

| Fragment | Modal | Force |
|---|---|---|
| "must be included in the PDD" | must | Mandatory, **PDD-scoped** |
| "must report the boundaries of the project area" | must | Mandatory |
| "This **could** be reported using project area maps…, the GPS coordinates…, or the GPS coordinates…" | could / or | **Open menu of acceptable forms** |
| "**Alternatively**, Project Proponents **may** choose to use geo-tagged and dated photo files and/or video files" | alternatively / may | **Fourth alternative, optional** |
| "The application rate paired with the project boundaries **must** be used to confirm total mass of biochar applied" | must | Mandatory (a **calculation** rule) |
| "An average application rate … **may** be used, provided that justification … is agreed with Isometric in advance" | may + condition | Optional with prior approval |
| "The information for each field **should** be submitted with the GHG statement" | should | Recommendation |

## 1.3 Verbatim evidence wording — soil-environments v1.3 (the module we coded to)

Section numbering in this module is also unprinted, but it is reconstructable
from the module's own cross-references (e.g. §8.2.1: "the evidence requirements
for which are specified in Sections 8.5, 8.6 and 8.7, respectively"). The
relevant chapter is **§8 "Additional Requirements and Guidance on Evidence for
Biochar Application or Mixing"**, with §8.5 covering direct soil application.

**§8.5 — Acceptable Evidence for Biochar Application Directly to Soil**
(requirement `R-8PBP-0`), full body:

> Requirement attribute: *"If deploying through direct soil application, projects
> must confirm they will supply either of the following evidence: 1) Geotagged and
> timestamped visual evidence of stockpiles, spreading, and incorporation of
> biochar or 2) Project boundaries and logbook records"*
>
> "Project Proponents must document **either** of the following methods detailed
> in Section 8.5.1 **or** 8.5.2 that are accepted as sufficient evidence of
> spreading of biochar:"

**§8.5.1 — Visual Documentation** (subrequirement `G-BCH4-0`), full body:

> Requirement attribute: *"Projects must provide geotagged and time and date
> stamped photos or videos confirming: Biochar Stockpiles Before Application,
> Biochar Being Spread or Mixed, Final Incorporation into Soil or Organic Matrix."*
>
> "Geotagged photos or videos are critical for visually confirming the application
> of biochar. These must include all of the following for every storage batch:
>
> - Biochar Stockpiles Before Application:
>    - Images showing the biochar material (e.g., in bags, piles, or storage
>      containers) at the application site, clearly identifiable as biochar, prior
>      to its spreading.
> - Biochar Being Spread or Mixed:
>    - Visuals capturing the active process of biochar being applied to the land
>      (e.g., by spreader, tractor, or manual labor) or being incorporated into the
>      soil.
> - Final Incorporation into Soil or Organic Matrix:
>    - Photos or videos demonstrating the biochar after it has been fully
>      incorporated into the soil or mixed into an organic matrix, showing the
>      uniformity of application.
> - Requirements for Geolocation Metadata and Time Stamps:
>    - All visual documentation must have embedded GPS coordinates (latitude,
>      longitude) and accurate time and date stamps.
>    - This metadata must be verifiable and consistent with the project boundaries
>      and application records. If metadata is not automatically embedded, a
>      separate log linking image filenames to GPS coordinates and timestamps must
>      be maintained."

**§8.5.2 — Project Boundary Mapping With Application Records**
(subrequirement `G-Z1CS-0`), full body:

> Requirement attribute: *"If projects are unable to provide visual documentation,
> they must provide project boundaries and log book records of application."*
>
> "Project boundaries are required to define the areas of application:
>
> - Maps or Geographic Information System (GIS) Layers
>    - High-resolution maps or GIS layers clearly delineating the area of land
>      where biochar application occurred. If the landowner requests anonymity,
>      proof can be provided at the ZIP code (or equivalent) level.
>    - These maps should include relevant identifiers (e.g., field names/numbers,
>      land parcel IDs).
>    - Spreading is not permitted outside of the project boundaries agreed in the
>      PDD.
>
> And, complete logbooks or digital databases are required to detail application
> events:
>
> - Dates and Quantities Applied:
>    - Dates of application and the quantity of biochar (e.g., in tonnes) applied
>      to each specific area evidenced by weighbridge or inventory records or
>      affidavit, from which an application rate can be calculated.
>    - N.B. The application rate should not exceed the maximum loading rates
>      established by the relevant jurisdiction where the biochar is being applied."

**§8.4 — General Principles for Evidence** (the retention rule):

> "All records must be maintained for a minimum of 5 years from the date of
> collection, using standardized formats to ensure completeness, comparability,
> and reliability over time."

**§8.10 — Verification and Audit Guidance** (who consumes this evidence):

> "VVBs will examine all submitted evidence to ensure compliance with the PDD…
> - What VVBs Will Check:
>    - Consistency between application records, visual evidence, and mapping
>    - Accuracy of quantities reported against sales/delivery records
>    - Completeness of chain-of-custody documentation
>    - Verification of geotagging metadata
>    - Interviewing personnel involved in biochar application or mixing
>    - Site visits to confirm application areas and practices"

**Appendix 1 monitoring table** — the *only* placement parameter for the
application step, verbatim cell contents:

> `Placement` | "Biochar recipient location and batch IDs" | **Required** | Measured |
> Units: "Various accepted" | Data source: "Records of delivery" | Measurement
> Method: "**Weigh scale tickets, delivery records, sales invoices, purchase
> orders, or transfer records**" | Frequency: "Measure every production or storage
> batch"

Note that the module's own monitoring appendix does **not** name geotags, GIS
layers, or photos as the measurement method for placement.

Terms that **do not appear anywhere** in soil-environments v1.3:
`shapefile`, `GeoJSON`, `polygon`.

## 1.4 Answering (c): literal requirement or hardened reading?

| Element in our code | Registry status |
|---|---|
| Three stages (stockpile / spreading / incorporation) as a conjunctive set | **Literal** in soil-environments v1.3 §8.5.1 ("These must include all of the following for every storage batch"). **Absent entirely** from agricultural-soils v1.1. |
| Three stages as an **unconditional** requirement | **Hardened.** §8.5 is explicitly disjunctive: "must document **either** … 8.5.1 **or** 8.5.2", and §8.5.2's own attribute begins "If projects are unable to provide visual documentation". A project on the boundary path owes zero photos. Our code does honour the branch via `evidenceMethod`, but defaults every unset value to `visual` (`APPLICATION_EVIDENCE_RULE_SPEC.dispatch.defaultPath = "visual"`), which turns the operator's silence into the strictest branch. |
| GIS map of application area | **Literal** in §8.5.2 ("High-resolution maps or Geographic Information System (GIS) Layers"), but qualified: identifiers are "**should** include", and ZIP-code-level is explicitly acceptable when the landowner requests anonymity. Our `gisBoundaryReference` non-blank check is a reasonable proxy but the module never demands machine-readable geometry. |
| weighbridge / inventory / affidavit as an enumerated set | **Literal wording**, but **disjunctive**: "evidenced by weighbridge **or** inventory records **or** affidavit". Our `any-document-matcher` correctly treats them as alternatives. Nothing is hardened here — but the whole clause is subordinate to choosing §8.5.2. |
| Any of it as a **submission gate** | **Hardened.** Nothing in either module ties this evidence to a GHG entry/statement POST. §8.4 makes it a 5-year retained record; §8.10 makes it VVB-examined; §6 and the agricultural-soils "Proof of biochar spreading" section both scope it to the **PDD**. |
| Section citation "§8.5.1/§8.5.2" in `application-evidence.ts` | **Correct for soil-environments v1.3.** Our own `docs/isometric/requirements-shortlist.md` cites the same content as "Soil Module §9.5.1" against the **v1.2** URL — the numbering moved between v1.2 and v1.3. The code comment's *URL* (`/module/biochar-storage-soil-environments`, unversioned) is the real defect: it points at a module the project does not use. |

## 1.5 DATA / EVIDENCE-TO-RETAIN / EVIDENCE-TO-SUBMIT classification

Lens per `docs/isometric/changes.md` (2026-07-28 entries): a hard submission
blocker is justified **only** for EVIDENCE-TO-SUBMIT. Registry text is a floor,
not a ceiling; "should" is not "must".

| Element | Class | Registry basis | Current noma behaviour | Verdict |
|---|---|---|---|---|
| Mass of biochar applied (`m_biochar`) | **DATA** | soil-env v1.3 Appendix 1: "Required", "Measure every storage batch"; agri-soils v1.1: "The application rate paired with the project boundaries must be used to confirm total mass of biochar applied" | Feeds `co2-stored` datapoints | Correct |
| Application date | **DATA** | Certify API `BiocharApplication.application_date` (required); protocol §8.6.2 reporting-window anchor | Drives `completedOn` | Correct |
| Average application rate | **DATA** | Certify API `CreateBiocharApplicationRequest.average_application_rate` (**required**); agri-soils v1.1 "Application rate" | **Not captured, not submitted** | **Gap** |
| Storage-location identity (name + lat/lon) | **DATA** | Certify API `CreateStorageLocationRequest` requires `project_id`, `name`, `latitude`, `longitude` | Not created via API | **Gap** |
| Truck mass on arrival / departure | **DATA** | Certify API `BiocharApplication.truck_mass_on_arrival` / `_on_departure` (**required**) — the registry's own weighbridge-equivalent, as *numbers*. Mirrors protocol v1.1 §8.3.1.1: "the difference in biochar delivery truck weight measured upon arrival at the application site and at departure" | Not captured | **Gap** |
| Project-area boundaries (map / GPS coords / GIS layer) | **PDD-stage** (a third class: validated once, not per-removal) | agri-soils v1.1 "must be included in the PDD"; soil-env v1.3 §8.5.2 + "project boundaries agreed in the PDD" | Hard per-removal blocker on `gisBoundaryReference` | **Over-enforced** |
| Geotagged stockpile / spreading / incorporation media | **EVIDENCE-TO-RETAIN** (and only on the visual branch of a module we do not use) | soil-env v1.3 §8.4 "retained… minimum of 5 years"; §8.10 "VVBs will examine"; not present in agri-soils v1.1 | Hard submission blocker via `entityReadinessGaps` | **Over-enforced** |
| Logbook of dates + quantities (weighbridge / inventory / affidavit) | **EVIDENCE-TO-RETAIN** | soil-env v1.3 §8.5.2 + §8.4 retention; §8.10 VVB sampling | Hard submission blocker on the boundary branch | **Over-enforced** |
| Weigh scale tickets per delivery (arrival + departure weights) "or other equivalent records" | **EVIDENCE-TO-RETAIN** | Protocol v1.1 §8.3.1.2 "must maintain the following records"; "must be maintained … for at least five years". Nothing sends them to Isometric. | Uploadable as documents | Correct as retained |
| Documentation of spills during application | **EVIDENCE-TO-RETAIN** + **DATA** (the deducted mass) | Protocol v1.1 §8.3.1.2 record; "Other Considerations": "that amount **must** be deducted from the delivered amount of biochar based on delivery weigh tickets" | Not modelled | Gap |
| Photograph of delivery / signed receipt / BOL | **EVIDENCE-TO-RETAIN, conditional** | Protocol v1.1 §8.3.1.1: only "in the event that truck scales are not available", and only if "it can be agreed with Isometric … prior to verification" | Uploadable | Correct as optional |
| Chain-of-custody documentation | **EVIDENCE-TO-RETAIN** | soil-env v1.3 §8.9 `G-W8A1-0`: "retained for a minimum period (5 years…). Records should be stored securely and be readily accessible for audit." | Modelled as DAG + documents | Correct |
| Field-management info (irrigation, tillage, fertilizer, crop) | **DATA, advisory** | agri-soils v1.1: "**should** be submitted with the GHG statement"; soil-env v1.3 §5.2.1: "**should** be submitted within the GHG statement" | Not captured | Acceptable gap ("should") |
| Any application media/map file reaching Isometric | **EVIDENCE-TO-SUBMIT — only if voluntarily attached** | Certify Sources are the transport (`CreateBiocharApplicationRequest.source_ids`); nothing makes them mandatory | Mirrored as Sources | Correct as optional |

**No element in either module is EVIDENCE-TO-SUBMIT by registry mandate.**
Consequently no application-evidence hard submission blocker survives the lens.

### Where the blocker lives in our code today

`buildApplicationEvidenceReadiness`
(`src/fn/certification/application-evidence-readiness.ts`) →
`buildCertifyEntityReadiness` (`src/fn/certification/certify-entity-readiness.ts`)
→ `entityReadinessGaps` on the removal context
(`src/fn/certification/certify-context-core.ts`) → `readiness.ts` renders it as
"Incomplete entity certifier data: …" and `submitRemoval` throws
"Removal submission blocked: …". So a missing incorporation photo currently
stops a GHG entry POST.

## 1.6 Does Isometric define a GIS/GeoJSON format for storage sites?

**No schema is published. The API has no geometry at all.**

### Certify OpenAPI — searched exhaustively

- `StorageLocation` fields: `id`, `name` (max 100), `description`, `latitude`
  (−90…90), `longitude` (−180…180), `project_id`, `supplier_id`,
  `storage_method`, `supplier_reference_id` (max 100 on read / 200 on create).
  **Required: `id`, `name`, `project_id`, `supplier_id`, `storage_method`.**
  There is **no** polygon, geometry, boundary, area, or GeoJSON field.
- `StorageMethod` enum: `biochar_field`, `biochar_landfill`,
  `biomass_injection_well`, `biomass_subsurface`, `saline_aquifer`,
  `in_situ_mineralization`.
- `MeasurementLocation`: `latitude` + `longitude` + `supplier_reference_id` only.
- `BiocharApplication` / `CreateBiocharApplicationRequest`: `storage_site_id`,
  `production_batch_id`, `application_date`, `average_application_rate`,
  `truck_mass_on_arrival`, `truck_mass_on_departure`, `supplier_reference_id`,
  `source_ids[]`. No geometry.
- Full operation list contains **no** `/removal_areas`, `/plots`, `/geometries`,
  or any geospatial upload endpoint. Storage locations are
  `GET|POST|PATCH|DELETE /projects/{project_id}/storage_locations[/{id}]`.

### Where GeoJSON *does* appear in Isometric's own documentation

1. **Field measurements → Removal areas**
   (https://docs.isometric.com/user-guides/certify/field-measurements), verbatim:
   > "Field measurements are currently supported for: **Biochar projects** using
   > the [Biochar Storage in Agricultural Soils module]…"
   > "Each removal area is a group of project areas, such as fields, that will be
   > credited together. For Biochar projects, this may include farms where biochar
   > from the same pyrolysis reactor is spread."
   > "You can upload **GeoJSON files** representing your removal areas as follows:
   > 1. Go to the **Removal areas** tab. 2. Click **Add removal area**, select your
   > files, and click **Upload**. 3. **Uploaded polygons will be rendered in the
   > plot map preview**, where you can toggle between private and public views."

   That page documents the *workflow* only. It specifies **no** schema, no
   property names, no CRS, no winding, no size limit.

2. **Data visibility**
   (https://docs.isometric.com/user-guides/certify/data-visibility), verbatim:
   > "Removal areas on draft projects are visible only to the Supplier and
   > Isometric's tech team. On assignment of a Verifier to a project, removal areas
   > will be viewable by the Verifier. **A Plot Overview for a project is published
   > on the Registry when credits are issued. The Plot Overview shows the geometry
   > of the removal area but does not show internal removal area boundaries or
   > project latitude/longitude.**"

3. **Project design → source categories**
   (https://docs.isometric.com/user-guides/certify/project-design), verbatim
   under "Reference / Evidence":
   > "Academic papers, technical reports, allometric equations, site/facility/
   > feedstock photos, screenshots, **geospatial files (GeoJSON, maps, satellite
   > imagery, elevation models)**, invoices"

   So GeoJSON is an explicitly recognised **PDD attachment category**.

4. **Geospatial minimum standards** — there are pages for
   [shapefiles](https://docs.isometric.com/user-guides/certify/geospatial/shapefiles),
   [rasters](https://docs.isometric.com/user-guides/certify/geospatial/rasters),
   [LiDAR](https://docs.isometric.com/user-guides/certify/geospatial/lidar) and
   [FAIR principles](https://docs.isometric.com/user-guides/certify/geospatial/principles).
   **There is no GeoJSON page.** The shapefile page is the closest normative text
   and its rules transfer cleanly. Verbatim:
   > "Files must be provided in ESRI shapefile format with an **optional
   > accompanying GeoJSON version**."
   > "Files should follow a consistent naming convention that includes a project
   > identifier, purpose of the shapefile, and date, e.g.,
   > `ProjectID_ShapefilePurpose_YYYYMMDD`."
   > "**Must use a defined coordinate reference system such as WGS 84.**"
   > "**Polygons must be topologically correct and closed, with no gaps and
   > self-intersections or overlapping polygons within the same layers.**"
   > "Metadata should be ISO 19115 compliant and include: … Spatial extent
   > (bounding box coordinates) · Coordinate reference system details · Data
   > quality reports including topology validation results …"

   FAIR principles page adds: "Data should use recognized standards for
   coordinate reference systems, data formats, and metadata schemas."

### The Certify UI upload template (`name` / `description` / `reference_id`)

Not documented anywhere I could find — not in `isometric_docs_list`, not in the
Certify OpenAPI, not in either module. What *is* verifiable:

- `name` and `description` are exactly the two free-text fields on
  `StorageLocation` (`name` required, max 100; `description` optional).
- `reference_id` almost certainly maps to **`supplier_reference_id`**, which
  Isometric documents platform-wide
  (https://docs.isometric.com/user-guides/certify/supplier-reference-id) and
  describes in every OpenAPI schema as: *"A string that must be unique for all
  resources created by a specific supplier. It can be used by a client to
  identify the correct objects in their system."* It is an idempotency/lookup
  key, so it **does** have meaning: reuse the same value to address the same
  record, keep it stable, keep it unique per supplier.
- The mapping `reference_id` → `supplier_reference_id` is **inferred, not
  documented** — see Caveats.

### Practical conclusion for our GIS feature

There is no registry-mandated GeoJSON contract to conform to. We should:

- Store and render RFC 7946 (WGS 84, `[lon, lat]`) — mandated indirectly by the
  shapefile page's "must use a defined coordinate reference system such as WGS 84"
  and by RFC 7946 §4 itself.
- Enforce closed, non-self-intersecting, non-overlapping polygons — the only
  hard geometry rule Isometric states anywhere.
- Emit a FeatureCollection whose feature `properties` carry `name`,
  `description`, `reference_id` so the file can be dropped straight into the
  Certify Removal-areas uploader, and so the same values can back
  `POST /projects/{id}/storage_locations`.
- Treat the file as a **PDD / Source attachment**, not a submission gate.

---

# Question 2 — GeoJSON ingestion for an upload/paste flow

## 2.0 What already exists in this repo (verified by reading the code)

| Asset | Path | What it gives us |
|---|---|---|
| Geo constants | `src/config/geo.ts` | `maptilerStyleUrl(key)`, `SAT_TILE_URL` / `SAT_TILE_ATTRIBUTION` / `SAT_RASTER_SATURATION`, `DEFAULT_MAP_CENTER` (`[35.74, -6.17]`, **`[lng, lat]`**), `DEFAULT_MAP_ZOOM`, `FOCUSED_MAP_ZOOM`, `ROUTE_CACHE_COORD_DECIMALS = 5` ("~1 m precision"), rate-limit descriptors |
| Brand map theme | `src/components/map/map-theme.ts` | `applyBrandRecolor(map)` (idempotent, skips our own layers), `OWN_LAYER_PREFIX = "noma-"`, `MAP_ACCENT_TOKEN`, `createMarkerElement(accent)` |
| Map chrome | `src/components/map/map-controls.tsx` | `MapControls` with `onZoomIn` / `onZoomOut` / **optional `onFit`** / `satOn` + `onToggleSat`. The fit button already exists for a fitBounds action. |
| Full MapLibre wiring reference | `src/components/forms/position-picker/position-picker-map.tsx` | `next/dynamic({ ssr: false })` loading (keeps `maplibre-gl` out of the shared client bundle), `NEXT_PUBLIC_MAPTILER_KEY`, WebGL-init failure fallback, `STYLE_LOAD_TIMEOUT_MS = 12_000` style-load watchdog, the `styledata`-before-`error` discrimination, SAT raster source/layer pattern, `COORD_DECIMALS = 6` rounding helper, and the `mapPoint()` range guard (`Math.abs(lat) > 90 \|\| Math.abs(lng) > 180`) |
| Geocoding UI | `src/components/forms/position-picker/address-search.tsx` | Debounced ORS/Pelias search we can offer alongside a pasted boundary |
| jsonb geometry precedent | `src/db/schema/geo.ts` | `geoRouteCache.coordinates: jsonb().$type<[number, number][]>()` with the comment "Route polyline as `[lng, lat]` pairs (GeoJSON order)", endpoints rounded to `ROUTE_CACHE_COORD_DECIMALS` "so float noise can't fragment the cache" |
| Large-file path | `src/lib/storage/s3-compatible.ts`, `src/lib/documents/upload-policy.ts` | Presigned `PutObjectCommand` direct-to-bucket uploads, and `DOCUMENT_UPLOAD_MAX_MB = 10` as the existing house limit. A presigned upload **bypasses the server-action body limit entirely.** |

Notes and traps:

- `mapPoint()` in `position-picker-map.tsx` is exactly the range guard needed for
  the `[lat, lng]`-swap heuristic — extract and share it rather than re-inventing.
- `applyBrandRecolor` hides **every** `symbol` layer and recolors every `fill`
  layer that is not prefixed `noma-`. Any boundary layers we add must use the
  `noma-` prefix or they will be recolored/hidden.
- The repo has **no** `@turf/*`, `@types/geojson`, `proj4`, or any GeoJSON
  library today (`package.json`: `maplibre-gl ^5.24.0`, `zod ^4.3.6`).
- `next.config.ts` sets **no** `serverActions.bodySizeLimit`, so Next's default
  applies unchanged.
- Naming collision to avoid: `src/components/storage-locations/` in this repo is
  the **on-site biochar bin** feature, not the Isometric `StorageLocation`
  (field site). Do not overload the name.
- Today's `applications.gisBoundaryReference` is `text("gis_boundary_reference")`
  capped at 255 chars in `src/schemas/applications.ts` — a link, not geometry. A
  real boundary needs a new `jsonb` column; the 255-char field cannot hold one.

## 2.1 Input variants a robust parser must accept

All quotes below are verbatim from RFC 7946
(https://www.rfc-editor.org/rfc/rfc7946).

### Top-level shape

> §3: "A GeoJSON object represents a Geometry, Feature, or collection of
> Features. A GeoJSON object has a member with the name 'type'. The value of the
> member MUST be one of the GeoJSON types."

> §3.3: "A FeatureCollection object has a member with the name 'features'. The
> value of 'features' is a JSON array. Each element of the array is a Feature
> object as defined above. **It is possible for this array to be empty.**"

Accept and coerce: `FeatureCollection`, `Feature`, bare `Geometry`
(`Point`/`MultiPoint`/`LineString`/`MultiLineString`/`Polygon`/`MultiPolygon`),
and `GeometryCollection`. Everything becomes a `FeatureCollection`.

**Nested FeatureCollections are invalid** and must be rejected, not flattened.
RFC 7946 §7.1 forbids the confusing sibling members that would make a nested
collection well-formed; a `FeatureCollection` inside `features[]` is not a
`Feature`, so it fails §3.3. Reject with a specific message rather than trying
to guess intent.

**`GeometryCollection` is legal but discouraged.** RFC 7946 §3.1.8 exists, but
the spec advises against it where a single geometry or a MultiPolygon will do.
Flatten each member geometry into its own Feature, carrying the parent's
`properties` (if any) onto each — and record that you did so.

### Null geometry and properties

> §3.2: "A Feature object has a member with the name 'geometry'. The value of the
> geometry member SHALL be either a Geometry object as defined above or, **in the
> case that the Feature is unlocated, a JSON null value**. A Feature object has a
> member with the name 'properties'. The value of the properties member is an
> object (any JSON object or a JSON null value). If a Feature has a commonly used
> identifier, that identifier SHOULD be included as a member of the Feature object
> with the name 'id', and the value of this member is **either a JSON string or
> number**."

So: `geometry: null` is **valid** GeoJSON. For a boundary-upload flow it is
useless — drop those features and report the count. `properties` must be
**present**; a missing `properties` key is technically non-conformant, so
normalize it to `{}` rather than rejecting.

### The legacy `crs` member — RFC 7946 §4 in full

> §4: "The coordinate reference system for all GeoJSON coordinates is a geographic
> coordinate reference system, using the World Geodetic System 1984 (WGS 84) datum,
> with longitude and latitude units of decimal degrees. This is equivalent to the
> coordinate reference system identified by the Open Geospatial Consortium (OGC)
> URN urn:ogc:def:crs:OGC::CRS84. An OPTIONAL third-position element SHALL be the
> height in meters above or below the WGS 84 reference ellipsoid. In the absence of
> elevation values, applications sensitive to height or depth SHOULD interpret
> positions as being at local ground or sea level.
>
> **Note: the use of alternative coordinate reference systems was specified in
> [GJ2008], but it has been removed from this version of the specification because
> the use of different coordinate reference systems -- especially in the manner
> specified in [GJ2008] -- has proven to have interoperability issues.** In general,
> GeoJSON processing software is not expected to have access to coordinate reference
> system databases or to have network access to coordinate reference system
> transformation parameters. **However, where all involved parties have a prior
> arrangement, alternative coordinate reference systems can be used without risk of
> data being misinterpreted.**"

**Recommended policy — a three-way split, not a blanket rule:**

| `crs` content | Action |
|---|---|
| absent | Proceed. WGS 84 is the only legal assumption. |
| present and names WGS 84 / CRS84 / EPSG:4326 (`urn:ogc:def:crs:OGC:1.3:CRS84`, `urn:ogc:def:crs:EPSG::4326`, `"EPSG:4326"`, `{"type":"name","properties":{"name":"…4326"}}`) | **Strip the member and proceed.** It is redundant, not wrong. |
| present and names anything else (EPSG:3857, a national grid, a `"link"`-type crs) | **Reject with an actionable message**, e.g. "This file declares coordinate system EPSG:3857. Re-export it in WGS 84 (EPSG:4326) — in QGIS, Save Features As… → CRS: EPSG:4326." |

Do **not** attempt reprojection. RFC 7946 §4 explicitly says processing software
"is not expected to have access to coordinate reference system databases", and
the only sanctioned escape is "prior arrangement" between parties — which a file
upload from an operator is not. Reprojection would need `proj4` (and an EPSG
lookup), adds a real dependency for a rare input, and silently converting
someone's data is exactly the interoperability failure §4 is warning about. A
clear rejection is safer and cheaper. Note that a 3857-in-a-4326-file mistake is
also **self-detecting**: Web Mercator coordinates are metres in the millions, so
the range check below catches them even without a `crs` member.

### 3D and 4D positions

> §3.1.1: "A position is an array of numbers. There MUST be two or more elements.
> The first two elements are longitude and latitude, or easting and northing,
> precisely in that order and using decimal numbers. Altitude or elevation MAY be
> included as an optional third element. **Implementations SHOULD NOT extend
> positions beyond three elements because the semantics of extra elements are
> unspecified and ambiguous.**"

Accept 2 or 3 elements; **truncate to 2** on normalization (elevation is
meaningless for a field boundary and doubles the storage). Reject positions with
4+ elements rather than silently truncating — those files carry M-values or
unspecified data and the operator should know their exporter is wrong.

### Winding order

> §3.1.6: "A linear ring MUST follow the right-hand rule with respect to the area
> it bounds, i.e., **exterior rings are counterclockwise, and holes are
> clockwise.**"

**MapLibre renders regardless of winding** — a wrongly wound polygon still draws
as a filled shape, so a visual preview will not surface the bug. But winding is
load-bearing for anything computing area or point-in-polygon (`@turf/area`,
`@turf/boolean-point-in-polygon`), and for consumers downstream of us. So:
**rewind silently, do not reject.** GDAL takes the same position: with
`RFC7946=YES`, "Polygons will be written such as to follow the right-hand rule
for orientation (counterclockwise external rings, clockwise internal rings)"
(https://gdal.org/en/stable/drivers/vector/geojson.html).

> Caveat: I could not find a primary MapLibre statement that says "winding is
> ignored." The claim rests on MapLibre's vector-tile fill pipeline and the
> general behaviour of the Mapbox GL lineage. Treat "MapLibre renders regardless"
> as high-confidence-but-unverified — see Caveats.

### Swapped `[lat, lon]` axis order

§3.1.1 is unambiguous: "The first two elements are longitude and latitude …
**precisely in that order**". The `[lat, lon]` mistake is the single most common
real-world GeoJSON defect (Leaflet uses `[lat, lng]` for its own APIs, which
trains the error).

Detection heuristic, in order of confidence:

1. **Hard error** — any `|position[1]| > 90`. That value cannot be a latitude, so
   the file is either swapped or not in degrees at all. Reject.
2. **High confidence swap** — every position has `|position[0]| <= 90` **and** at
   least one position has `|position[1]| > 90`. Caught by (1).
3. **Ambiguous zone** — both values within ±90. Genuinely undecidable from the
   data. Two mitigations, both better than guessing: (a) if the operator's
   facility has a known lat/lon (`src/config/geo.ts` `DEFAULT_MAP_CENTER` is
   Tanzania, `[35.74, -6.17]`), warn when the parsed centroid is more than, say,
   a few hundred km from the facility **and** the swapped centroid is closer;
   (b) always render the parsed result on the map before saving — an operator
   sees instantly that their field landed in the Indian Ocean.

**Never auto-swap.** A silent axis flip that guesses wrong produces a plausible
but wrong boundary, which is worse than a rejection. Warn + preview + require
confirmation.

Note our repo already has the exact range guard, in
`src/components/forms/position-picker/position-picker-map.tsx`:
`if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;`

### Antimeridian and bbox

> §3.1.9: "Any geometry that crosses the antimeridian SHOULD be represented by
> cutting it in two such that neither part's representation crosses the
> antimeridian."

> §5: "The value of the bbox member MUST be an array of length 2*n where n is the
> number of dimensions represented in the contained geometries, with all axes of
> the most southwesterly point followed by all axes of the more northeasterly
> point. The axes order of a bbox follows the axes order of geometries."

For a biochar field boundary, an antimeridian crossing is a data error, not a
legitimate case — a single agricultural parcel does not span 180°. Detect a
longitude span > 180° and reject with "this boundary appears to span half the
globe; check for swapped or malformed coordinates." Never trust an input `bbox`:
**always recompute** it.

### What real-world exporters actually emit

| Exporter | Behaviour | Primary source / confidence |
|---|---|---|
| **`ogr2ogr` / GDAL** (the engine under QGIS export and most shapefile→GeoJSON conversion) | `RFC7946=[YES/NO]: **Defaults to NO.** Whether to use RFC 7946 standard. Otherwise **GeoJSON 2008 initial version will be used**." With `RFC7946=YES`: coordinates forced to EPSG:4326 (auto-reprojecting if needed), right-hand rule applied on write, `COORDINATE_PRECISION` default **7**. With the default `NO`: `COORDINATE_PRECISION` default **15**. `WRITE_BBOX` defaults to `NO`. | **Verified** — https://gdal.org/en/stable/drivers/vector/geojson.html |
| **QGIS** "Save Features As… → GeoJSON" | Wraps ogr2ogr, so the default is the 2008 flavour: source CRS preserved (a `crs` member appears if not 4326), 15-decimal coordinates, no bbox, winding not normalized. | Inferred from the GDAL driver defaults; QGIS-specific defaults **not verified** |
| **ArcGIS Pro / ArcGIS Online export** | Historically emits `crs` blocks and has used non-RFC conventions. | **Not verified** from a primary Esri source |
| **geojson.io** | Emits plain RFC-7946-shaped FeatureCollections. | **Not verified** |
| **KML → GeoJSON (Google Earth)** | KML is WGS 84 by definition, so CRS is safe, but converters commonly emit `Point`/`LineString` soups, `GeometryCollection`s for multi-geometry placemarks, and 3D positions (KML coordinates are `lon,lat,alt`). Styling ends up as junk `properties`. | Structural expectation; **not verified** per-converter |

**Practical consequence:** the two most likely defects from a real operator are
(a) a `crs` member naming a national grid or Web Mercator, and (b) 15-decimal
3D coordinates — both direct products of ogr2ogr's non-RFC defaults. Design the
error copy for those two cases specifically.

## 2.2 Library evaluation

Repo baseline: `zod ^4.3.6` and `maplibre-gl ^5.24.0` are installed; there is no
`@turf/*`, `@types/geojson`, or `proj4`.

| Package | Latest | Published | Unpacked | Min+gzip | Types | Deps | License | Verdict |
|---|---|---|---|---|---|---|---|---|
| `@placemarkio/check-geojson` | 0.1.14 | 2025-02-18 | 353,476 B | **~5.2 kB** | yes (`typings`) | **zero runtime deps** | MIT | **Adopt** |
| `@turf/rewind` | 7.3.5 | current | 28,464 B | **~1.4 kB** | yes | 6 `@turf/*` + tslib | MIT | **Adopt** |
| `@turf/truncate` | 7.3.5 | current | 19,438 B | ~0.9 kB | yes | `@turf/*` | MIT | **Adopt** |
| `@turf/bbox` | 7.3.5 | current | 12,339 B | ~0.7 kB | yes | `@turf/meta`, `@turf/helpers`, `@types/geojson`, tslib | MIT | **Adopt** |
| `@turf/clean-coords` | 7.3.5 | current | 30,874 B | ~1.4 kB | yes | `@turf/*` | MIT | Optional |
| `@turf/turf` (meta-package) | 7.3.5 | current | 597,368 B | ~135 kB | yes | **101 deps** | MIT | **Reject** — 100× the cost of the three modules |
| `@types/geojson` | current | — | 9,514 B | 0 (types only) | — | — | MIT | **Adopt** as devDependency |
| `geojson-validation` | 1.0.2 | **2020-07-14** | 82,186 B | unverified | **no** | none | **LGPL-3** | **Reject** |
| `geojson-schema` + `ajv` | 1.0.5 | 2024-03-17 | 94,661 B | n/a (JSON only) | — | needs ajv | — | **Reject** |
| `@mapbox/geojsonhint` | 2.x | — | 85,839 B | ~5.9 kB | — | — | ISC | **Reject** — archived |
| `proj4` / `reproject` | — | — | — | large | — | — | — | **Reject** — RFC 7946 §4 |
| `zod` | 4.3.6 | installed | — | — | yes | — | MIT | **Keep, narrowed role** |

**Why `geojson-validation` is disqualified, not merely stale:** its own README
states validation is based on "the GeoJSON Format Specification revision 1.0" —
the pre-IETF **2008 draft**, i.e. exactly the spec we are normalizing *away*
from. It also carries **LGPL-3** (unlike everything else here, which is MIT),
ships no TypeScript types, and its last functional publish was 2020-07-14 at
`gitlab.com/mjbecze/GeoJSON-Validation`.

**Why `geojson-schema` is disqualified:** it is JSON Schema **draft-07**, and its
own README says the schema "can not be used to validate that linear rings are
closed or that they follow the right-hand rule… parsers must implement their own
logic on top of JSON Schema validation" — the two things we most need.

**Why `@placemarkio/check-geojson` wins.** It is the maintainer-endorsed
successor to `geojsonhint` (the archived repo's own description reads
"IMPORTANT: This repo will be archived. Use @placemarkio/check-geojson
instead."). Verified against its source (`lib/`), it checks:

- all 9 GeoJSON `type` values, case-sensitively
- **duplicate object keys** — which neither `JSON.parse` (last wins, silently)
  nor Zod can see
- position arity (2 or 3 numeric elements) and per-type coordinate nesting
  (LineString ≥ 2 positions, Polygon rings ≥ 4)
- **ring closure** — first position must equal last (RFC 7946 §3.1.6)
- **`bbox` arity** — exactly 4 or 6 numbers (RFC 7946 §5's `2*n`)
- **RFC 7946 §7.1 sibling-member exclusivity** — a Geometry may not carry
  `properties`/`geometry`/`features`; a Feature may not carry `features`; a
  FeatureCollection may not carry `properties`/`coordinates`
- Feature `id` is string|number; `properties` present and object|null

and it reports **character offsets** (`from`/`to`) taken from the momoa JSON AST,
which is exactly what a paste textarea needs to highlight the broken span.

API (from `lib/index.ts`):

```ts
check(jsonStr: string): GeoJSON                 // throws HintError with .issues
getIssues(jsonStr: string): HintIssue[]         // never throws; [] when valid
scavenge(jsonStr: string): {                    // partial-failure recovery
  result: GeoJSON;
  rejected: Array<{ feature: unknown; reasons: HintIssue[] }>;
}
```

`scavenge()` is the important one: it keeps the valid features, drops the
invalid ones, and tells you **why** each was dropped — the difference between
"your file is invalid" and "3 of 47 features were dropped: features[12] ring not
closed…".

It deliberately does **not** check `crs`, coordinate precision, or winding
(README cites RFC 7946 Appendix B.1 for `crs`). Those stay with `@turf/rewind`
and our own code — the tools are complementary, not overlapping.

**Residual risk, stated plainly:** no commits since 2025-02-18 and the README
says "the API is not yet stable". Mitigations: zero runtime dependencies (nothing
can rot underneath it), MIT, and we confine it behind one internal function so
swapping it for a hand-rolled Zod structural schema later is contained. **Pin the
exact version.**

### Recommended minimal stack

```
zod                          already installed — narrowed to domain rules only
@types/geojson               devDependency, types-only, 0 runtime bytes
@placemarkio/check-geojson   ~5.2 kB gzip, zero runtime deps
@turf/rewind                 ~1.4 kB gzip
@turf/truncate               ~0.9 kB gzip
@turf/bbox                   ~0.7 kB gzip
```

~8.2 kB gzip total, and **all of it runs server-side** inside `src/fn/` — zero
bytes reach the client bundle. That matters here: `position-picker.tsx` already
loads `maplibre-gl` via `next/dynamic({ ssr: false })` specifically to keep it
out of the shared bundle.

Division of labour:

| Concern | Owner |
|---|---|
| RFC 7946 structural conformance + character offsets + duplicate keys + ring closure + §7.1 | `check-geojson` |
| Partial-failure recovery (keep good features, explain drops) | `check-geojson` `scavenge()` |
| `crs` gate, lat/lon range + axis-order heuristic, feature/vertex caps, `properties` caps, antimeridian span | **Zod + our own code** |
| Winding, precision, 3rd-element strip, bbox | `@turf/rewind`, `@turf/truncate`, `@turf/bbox` |
| End-to-end typing (`FeatureCollection<Polygon \| MultiPolygon>`) | `@types/geojson` |

Zod stays, but shrinks from "reimplement RFC 7946" to "enforce our domain
contract and type the output" — which keeps the existing `withAction` ZodError
path working for domain failures while structural failures get richer,
offset-carrying errors.

## 2.3 Normalized storage shape and the exact normalization steps

**Store one RFC 7946 `FeatureCollection`**, always — never a bare Geometry, never
a `Feature`, never a `GeometryCollection`. Invariants of the stored value:

1. `type: "FeatureCollection"`, with a recomputed 4-element `bbox`.
2. Every feature is `Polygon` or `MultiPolygon` (a boundary is an area). Points
   and lines are dropped with a reported reason.
3. Every position is exactly 2 elements, `[longitude, latitude]`, WGS 84.
4. Coordinates rounded to **6 decimal places**.
5. Exterior rings counterclockwise, holes clockwise (RFC 7946 §3.1.6).
6. No `crs` member anywhere; no foreign top-level members.
7. `properties` present on every feature, containing only our allow-list:
   `name`, `description`, `reference_id` (matching the Certify upload template
   and `supplier_reference_id`), plus a bounded passthrough of the operator's own
   keys.

**Why 6 decimals.** Decimal-degree precision at the equator: 5 dp = 1.11 m,
6 dp = 111 mm, 7 dp = 11.1 mm. A field boundary walked with a handheld GPS is
accurate to metres at best, so 6 dp is already an order of magnitude finer than
the measurement. It also matches `COORD_DECIMALS = 6` already used in
`position-picker-map.tsx` ("~0.1 m precision — more than enough to pin a site").
Note GDAL's own RFC 7946 default is **7**; 6 is the defensible tightening, and
15 (GDAL's 2008 default) is pure noise that inflates the payload ~2×.

### Ordered pipeline

Run every step server-side, in `src/fn/`, in this order. Each step's RFC
justification is given.

| # | Step | Why / source |
|---|---|---|
| 1 | **Size guard on the raw string, before anything else.** Reject over the byte cap without parsing. | A 50 MB paste must not reach `JSON.parse`. |
| 2 | **`getIssues(rawString)`** — structural validation *before* `JSON.parse`. It parses via momoa internally, so syntax errors and semantic errors come back in one pass **with `from`/`to` character offsets**. Bail here with those offsets. | `check-geojson`; enables inline highlighting in the paste textarea |
| 3 | **`JSON.parse`** (now known-parseable) and reject anything that is not a non-null, non-array object. | §3: the root must be a GeoJSON object |
| 4 | **`crs` gate.** Absent → continue. Names WGS 84/CRS84/EPSG:4326 → strip and continue. Anything else → reject with the re-export instruction. | RFC 7946 §4 (quoted above) |
| 5 | **Coerce to FeatureCollection.** `Geometry` → one Feature; `Feature` → single-feature collection; `GeometryCollection` → one Feature per member geometry, parent `properties` copied onto each; nested `FeatureCollection` → reject. | §3, §3.3, §7.1 |
| 6 | **`scavenge()`** on the collection: keep valid features, collect per-feature rejection reasons into a `normalizationNotes` payload surfaced to the operator. | `check-geojson` |
| 7 | **Drop `geometry: null` features** and count them. | §3.2 explicitly allows null geometry; it is useless for a boundary |
| 8 | **Filter to `Polygon` / `MultiPolygon`.** Report dropped Point/Line features by count and type. | Domain rule, not RFC |
| 9 | **Axis-order + range check.** Reject any `|lat| > 90` or `|lon| > 180`. In the ambiguous zone, compute the centroid, compare against the facility position, and warn (never auto-swap). | §3.1.1 "precisely in that order" |
| 10 | **Antimeridian span check** — reject a longitude span > 180°. | §3.1.9 |
| 11 | **Strip the 3rd position element** (`@turf/truncate` with `coordinates: 2`). Reject positions with 4+ elements. | §3.1.1 "SHOULD NOT extend positions beyond three elements" |
| 12 | **Round coordinates to 6 dp** (`@turf/truncate` `precision: 6`, its default). Steps 11 and 12 are one `truncate(fc, { coordinates: 2, mutate: true })` call. | precision table above |
| 13 | **Rewind** (`@turf/rewind`) so exterior rings are CCW and holes CW. Silent, never a rejection. | §3.1.6 |
| 14 | **Strip foreign members** at every level; normalize `properties` to `{}` when absent; keep only the allow-listed keys plus a capped passthrough (cap key count and total serialized bytes). | §7.1 and payload hygiene |
| 15 | **Recompute `bbox`** with `@turf/bbox(fc, { recompute: true })` — `@turf/bbox` short-circuits and returns any existing `geojson.bbox` unless you pass `recompute`. Result is `[minX, minY, maxX, maxY]`, matching §5's SW-then-NE ordering. | §5; never trust an input bbox |
| 16 | **Cap feature count and total vertex count** after normalization; reject over the cap with the actual numbers in the message. | DoS + render budget |
| 17 | **Zod parse** the normalized object into the typed `FeatureCollection<Polygon \| MultiPolygon>` that goes to the DB. | Types the output; keeps `withAction`'s ZodError path meaningful |

Store the result in a **`jsonb`** column (matching the `geoRouteCache.coordinates`
precedent in `src/db/schema/geo.ts`), plus denormalized `bbox` columns if you
ever want to query spatially without PostGIS. Also persist the normalization
notes (dropped features and why) so the operator and the VVB can see what the
pipeline changed — that transparency is itself evidence quality.

## 2.4 Size limits

### Server actions

Next.js docs (https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions,
docs version 16.2.12), verbatim:

> "By default, the maximum size of the request body sent to a Server Action is
> **1MB**, to prevent the consumption of excessive server resources in parsing
> large amounts of data, as well as potential DDoS attacks.
>
> However, you can configure this limit using the `serverActions.bodySizeLimit`
> option. It can take the number of bytes or any string format supported by bytes,
> for example `1000`, `'500kb'` or `'3mb'`."

> "The limit applies to the raw HTTP request body, including the bytes that
> `multipart/form-data` adds for boundaries, part headers, and field metadata. If
> you expect uploads close to the configured value, leave some room for this
> overhead. For typical multipart uploads, an additional 10–20 KB is a reasonable
> rule of thumb."

`next.config.ts` in this repo sets **no** `serverActions` block, so the **1 MB
default applies today**.

### Postgres

`jsonb` sits under the generic field limit: PostgreSQL's limits table gives
**field size: 1 GB** (https://www.postgresql.org/docs/current/limits.html), with
values TOASTed out of line when large ("Only an 18-byte pointer must remain
inside the tuple"). `jsonb` is "stored in a decomposed binary format that makes
it slightly slower to input due to added conversion overhead, but significantly
faster to process, since no reparsing is needed"
(https://www.postgresql.org/docs/current/datatype-json.html).

So Postgres is **not** the binding constraint — 1 GB is four orders of magnitude
above anything sane here. The real costs of a large `jsonb` boundary are read
amplification on every row fetch and the client-side render budget, not storage.

### Recommended limits

| Surface | Limit | Rationale |
|---|---|---|
| **Paste textarea** | **256 KB** of text | Comfortably inside the 1 MB server-action default with room for form overhead; ~2–4k vertices at 6 dp, far more than any real field boundary. Enforce client-side (character count with live feedback) **and** server-side (step 1). |
| **File upload, small path** | **1 MB**, through the server action | Keeps the default `bodySizeLimit`; no config change needed. |
| **File upload, large path** | **10 MB**, via the existing **presigned direct-to-bucket** upload (`src/lib/storage/s3-compatible.ts`, `DOCUMENT_UPLOAD_MAX_MB = 10`), then server-side fetch + normalize | **Bypasses the server-action body limit entirely** and reuses machinery we already run. Strongly preferred over raising `bodySizeLimit`. |
| **Post-normalization stored payload** | **~2 MB** `jsonb`, hard reject above | Keeps row reads cheap and the map render responsive. |
| **Feature count** | **500** features | A removal area is fields, not a cadastre. |
| **Total vertex count** | **100,000** positions | Bounds parse + rewind + render cost. |
| **`properties` per feature** | 32 keys / 8 KB serialized | Strips ArcGIS/QGIS attribute dumps. |

Do **not** raise `serverActions.bodySizeLimit` globally — it is an app-wide
setting and would weaken every other action. Route large files through the
presigned path instead.

## 2.5 MapLibre rendering

All signatures verified against https://maplibre.org/maplibre-gl-js/docs/.

```
addSource(id: string, source: SourceSpecification | CanvasSourceSpecification): this
addLayer(layer: AddLayerObject, beforeId?: string): this
fitBounds(bounds: LngLatBoundsLike, options?: FitBoundsOptions, eventData?: any): this
```

- `addSource` `id` "Must not conflict with existing sources"; `source` conforms to
  the MapLibre Style Specification source definition. An inline GeoJSON object is
  accepted as `data`.
- `addLayer` `beforeId` = "The ID of an existing layer to insert the new layer
  before, resulting in the new layer appearing visually beneath the existing
  layer." Use this to keep the fill under the SAT raster toggle correctly ordered.
- **`LngLatBoundsLike = LngLatBounds | [[LngLatLike, LngLatLike]] | [number, number, number, number]`.**
  So `fitBounds` accepts our `@turf/bbox` output `[minX, minY, maxX, maxY]`
  **directly** — no `LngLatBounds` construction needed. `fitBounds` will "Center
  these bounds in the viewport and use the highest zoom level up to and including
  getMaxZoom that fits them in the viewport", and `FitBoundsOptions` "supports all
  properties from AnimationOptions and CameraOptions" (so `duration` and `padding`
  are available, though the type page does not enumerate them).
- **`GeoJSONSource.setData(data: string | GeoJSON): Promise<void>`** — "Sets the
  GeoJSON data and re-renders the map." The parameter accepts "A GeoJSON data
  object **or a URL to one. The latter is preferable in the case of large GeoJSON
  files**." Reach for `map.getSource(id).setData(fc)` to update in place rather
  than remove/re-add the source.
- GeoJSON sources are **worker-parsed** — `_updateWorkerData()` invokes the
  worker's `geojson.loadData`, "which handles loading the geojson data and
  preparing to serve it up as tiles, using geojson-vt or supercluster as
  appropriate". Large payloads therefore do not block the main thread on parse,
  but they do block on structured-clone transfer.
- `updateData()` (incremental) "requires unique IDs for every feature in the
  source. The IDs can either be specified on the feature, or by using the
  `promoteId` option to specify which property should be used as the ID." If we
  ever do incremental edits, `promoteId: "reference_id"` is the natural choice.

### Layer plan

One source, three layers, all prefixed `noma-` so `applyBrandRecolor` skips them:

| Layer | Type | Purpose | Filter |
|---|---|---|---|
| `noma-boundary-fill` | `fill` | Polygon interiors, low `fill-opacity`, accent from `MAP_ACCENT_TOKEN.pink` (field/outbound) | `["==", ["geometry-type"], "Polygon"]` |
| `noma-boundary-line` | `line` | Crisp outlines — essential, because a low-opacity fill alone reads as mush | same |
| `noma-boundary-point` | `circle` | Any Point features we chose to show (e.g. sample locations) | `["==", ["geometry-type"], "Point"]` |

Add all three after `map.once("load")` and after `applyBrandRecolor(map)`, using
the same lifecycle shape as `position-picker-map.tsx`. Wire the existing
`MapControls` `onFit` prop to `map.fitBounds(bbox, { padding: 32 })`.

**Reuse, do not re-derive:** the WebGL-init try/catch, the
`STYLE_LOAD_TIMEOUT_MS` watchdog, the `styledata`-before-`error` discrimination,
and the SAT raster toggle in `position-picker-map.tsx` are all directly
transplantable and encode hard-won failure handling. Extract them into a shared
map-lifecycle hook rather than copying a third time.

---

# Caveats — what is NOT verified

These are gaps, not conclusions. Do not treat any of them as settled.

**Question 1**

1. **The Certify project's protocol/Standard versions are UI-observed, not
   API-read.** `versions.json` says so itself: "Certify project protocol and
   Standard versions are UI-observed facts because `GET /projects` exposes no
   protocol fields and `GET /ghg_statements/{id}` returned `protocol_version` null
   on 2026-07-24." I did not re-observe the UI in this session. If the project has
   since adopted protocol v1.3, the binding module flips to soil-environments v1.3
   and most of §1.4's "over-enforced" verdicts reverse. **Re-confirm in the Certify
   UI before acting on this document.**
2. **Standard v1.7 vs v2.1.** I verified that `latest_certified` for the Standard
   is v2.1 and that the project shows 1.7. I did **not** verify that the Standard
   follows the same no-forced-adoption lifecycle as Protocols — the versioning doc
   is written about Protocols and Modules and only says the policy is
   "authoritatively described in the Isometric Standard". The inference that 1.7
   still governs us is reasonable but unconfirmed.
3. **`reference_id` → `supplier_reference_id` is inferred.** The Certify UI's
   GeoJSON upload template is documented nowhere I could find — not in
   `isometric_docs_list`, not in the Certify OpenAPI, not in either module. The
   mapping rests on the fact that `name`/`description` are exactly the
   `StorageLocation` text fields and that `supplier_reference_id` is the
   platform-wide external-ID convention. **Ask Isometric to confirm**, and consider
   filing it via the MCP `submit_feedback` tool as a documentation gap.
4. **I did not inspect the live Certify UI** for this project — no screenshots, no
   template download. Everything about the uploader comes from the docs page and
   the API shape.
5. **Removal areas have no API surface at all.** I could not determine how (or
   whether) removal-area geometry is retrievable programmatically, how it relates
   to `StorageLocation`, or what happens to a polygon on upload (reduced to a
   centroid? stored separately?). The docs describe only the UI flow.
6. **Page 2 of agricultural-soils v1.1 was not read** (definitions/appendix). All
   normative content quoted here is from page 1; the term counts are page-1 counts.
   A definitions entry could in principle qualify a term, though none of the
   searched evidence terms appeared at all.
7. **Section numbers in both modules are reconstructed, not printed.** Neither
   module's markdown prints heading numbers; §8.5.1/§8.5.2 and the
   agricultural-soils structure are inferred from the documents' own
   cross-references. The requirement IDs (`R-8PBP-0`, `G-BCH4-0`, `G-Z1CS-0`) are
   printed and are the stable identifiers — **cite those, not section numbers.**
8. **`protocols_get_metadata` does not exist** on this MCP server even though the
   `protocols_get_content` footer instructs you to call it. Worth reporting.
9. **Whether Isometric would actually accept a boundary-path (§8.5.2-style)
   submission for our project is a policy question, not a text question.** The
   text permits it; the Registry Operations Manager decides.

**Question 2**

10. **"MapLibre renders polygons regardless of winding order" is unverified.** I
    found no primary MapLibre statement. The recommendation (rewind silently,
    never reject) is safe either way, but do not repeat the rendering claim as
    fact.
11. **`FitBoundsOptions.padding` and `duration` are not enumerated** on the
    MapLibre type page I read; they are inherited from `CameraOptions` /
    `AnimationOptions` per the docs' own wording. Confirm the exact shape when
    implementing.
12. **No documented maximum GeoJSON size for a MapLibre source** was found. The
    2 MB stored-payload cap is a judgement call, not a documented limit.
13. **Exporter behaviour is verified only for GDAL/ogr2ogr.** QGIS, ArcGIS Pro,
    ArcGIS Online, geojson.io, and KML converters are described from the GDAL
    defaults and structural expectation. Before writing operator-facing error
    copy, test one real export from each tool the operators actually use.
14. **`geojson-validation`'s gzip size could not be obtained** — Bundlephobia
    failed persistently for that package specifically while succeeding for others.
    Only npm's 82,186 B unpacked figure exists. It is rejected on licence/spec
    grounds regardless, so the gap does not affect the recommendation.
15. **The gzip figures for the adopted packages come from Bundlephobia**, a
    third-party build service, not from npm. They are approximations of shipped
    cost. The npm unpacked sizes in the same table are first-party.
16. **`@placemarkio/check-geojson` capabilities were verified by reading its
    source**, not by running it. Write a test fixture set (swapped axes, unclosed
    ring, `crs` block, 3D coords, GeometryCollection, nested FeatureCollection)
    and assert the pipeline's behaviour before trusting any of this in production.
17. **No `pnpm` install or build was run**, so none of the bundle-cost or
    compatibility claims are empirically confirmed in this repo.

---

# Sources

**Isometric registry (via MCP `protocols_get_content` / `protocols_analyze`)**

- Biochar Storage in Agricultural Soils **v1.1** (patch 1.1.0) —
  https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1
- Biochar Storage in Soil Environments **v1.3** (patch 1.3.1) —
  https://registry.isometric.com/module/biochar-storage-soil-environments/1.3
- Biochar Production and Storage Protocol **v1.1** (patch 1.1.1) —
  https://registry.isometric.com/protocol/biochar/1.1
- Biochar Production and Storage Protocol **v1.3** (patch 1.3.0) —
  https://registry.isometric.com/protocol/biochar/1.3
- Isometric Standard **v2.1** (patch 2.1.1) —
  https://registry.isometric.com/standard/2.1

**Isometric documentation (via MCP `isometric_docs_get`)**

- Protocol versioning — https://docs.isometric.com/user-guides/registry/protocol-versioning
- Field measurements (Removal areas / GeoJSON upload) — https://docs.isometric.com/user-guides/certify/field-measurements
- Data visibility (Plot Overview) — https://docs.isometric.com/user-guides/certify/data-visibility
- Project design (PDD source categories) — https://docs.isometric.com/user-guides/certify/project-design
- Geospatial: Shapefiles — https://docs.isometric.com/user-guides/certify/geospatial/shapefiles
- Geospatial: FAIR Principles — https://docs.isometric.com/user-guides/certify/geospatial/principles
- Storage monitoring [beta] — https://docs.isometric.com/user-guides/certify/storage-monitoring
- Supplier Reference ID — https://docs.isometric.com/user-guides/certify/supplier-reference-id

**Isometric Certify OpenAPI (via MCP `openapi_documents_list_objects` / `get_object`)**

- Schemas: `StorageLocation`, `CreateStorageLocationRequest`,
  `PatchStorageLocationRequest`, `StorageMethod`, `BiocharApplication`,
  `CreateBiocharApplicationRequest`, `MeasurementLocation`
- Full operation list (searched for geospatial endpoints; none exist)

**Standards**

- RFC 7946, *The GeoJSON Format* — https://www.rfc-editor.org/rfc/rfc7946
  (§3, §3.1.1, §3.1.6, §3.1.9, §3.2, §3.3, §4, §5, §7.1)

**Libraries and platform docs**

- Next.js `serverActions` config (docs v16.2.12) — https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- MapLibre GL JS `Map` — https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/
- MapLibre GL JS `LngLatBoundsLike` — https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/LngLatBoundsLike/
- MapLibre GL JS `GeoJSONSource` — https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/
- GDAL GeoJSON driver — https://gdal.org/en/stable/drivers/vector/geojson.html
- `@placemarkio/check-geojson` — https://github.com/placemark/check-geojson · https://registry.npmjs.org/@placemarkio/check-geojson
- `@turf/rewind` · `@turf/bbox` · `@turf/truncate` · `@turf/turf` — https://registry.npmjs.org/@turf/rewind/latest etc.
- `geojson-validation` — https://registry.npmjs.org/geojson-validation · https://gitlab.com/mjbecze/GeoJSON-Validation
- PostgreSQL limits — https://www.postgresql.org/docs/current/limits.html
- PostgreSQL JSON types — https://www.postgresql.org/docs/current/datatype-json.html
- Decimal degrees precision — https://en.wikipedia.org/wiki/Decimal_degrees

**This repository**

- `src/lib/certification/application-evidence.ts`
- `src/fn/certification/application-evidence-readiness.ts`
- `src/fn/certification/certify-entity-readiness.ts`
- `src/fn/certification/certify-context-core.ts`
- `src/lib/certification/readiness.ts`
- `src/config/geo.ts`
- `src/components/map/map-theme.ts`, `src/components/map/map-controls.tsx`
- `src/components/forms/position-picker/position-picker-map.tsx`
- `src/db/schema/geo.ts`, `src/db/schema/application.ts`, `src/schemas/applications.ts`
- `src/lib/documents/upload-policy.ts`, `src/lib/storage/s3-compatible.ts`
- `next.config.ts`, `package.json`
- `docs/isometric/versions.json`, `docs/isometric/changes.md`,
  `docs/isometric/requirements-shortlist.md`, `docs/isometric/schema-mapping.md`
