# Do Production-Run Readings Need to Be Structured Data?

**Research date:** 2026-07-29  
**Decision scope:** Noma production-run temperature/pressure CSVs, Isometric Biochar Protocol v1.1.1, Biochar Storage in Agricultural Soils Module v1.1.0, and the pinned supporting modules in [`versions.json`](../isometric/versions.json)  
**Primary-source rule:** Official Isometric Registry pages, Isometric documentation, and Isometric's Certify OpenAPI only

## Bottom line

**No Isometric protocol requirement found says that Noma must store each production-run sensor reading as a structured database row.** The protocol regulates:

- what must be monitored under the project's selected monitoring and emissions-accounting methods;
- measurement accuracy, frequency, calibration, and location;
- retention of raw data and supporting records for at least five years; and
- whether the evidence is sufficiently available and reproducible for verification.

An immutable original CSV can satisfy the protocol's raw-record obligation if it actually contains the required channels and metadata, is retained, is linked into the verification package, and is accepted for the project's declared monitoring approach. The protocol itself does not prescribe Noma's storage schema.

There is, however, a separate **Certify ingestion** question:

- Isometric accepts CSV as a generic evidence **Source**.
- Isometric's dedicated facility time-series ingestion does **not** accept CSV. It requires registered sensors plus a Parquet file with structured, per-period summary rows.
- That Parquet contains aggregate statistics, not every raw sensor point. Therefore, Noma's row-per-reading table is a local implementation choice even when using the dedicated time-series API.

The recommended product direction is therefore:

> Give the operator a one-step, plant-native CSV upload. Preserve the original file immutably, validate it automatically, retain a compact QA/provenance manifest, and generate Isometric's Parquet transiently when the dedicated time-series route is required. Do not make the operator normalize the CSV and do not keep every reading as a Noma database row unless Noma needs row-level dashboards or analytics.

One item prevents an unconditional "delete the readings table now" recommendation: the live project's Project Design requirements were inspected, but its project-specific DataUpload/monitoring submission configuration could not be verified. Before changing the outbound path, get written confirmation from the Isometric Registry Operations Manager that a Source-backed CSV is acceptable for this project's pressure, direct-emissions, and temperature evidence, or that Noma should continue using `biochar_pyrolysis_reactor_facility_time_series`.

## Confidence and access limitation

Confidence is **high** on the protocol and public API findings, and **medium** on the exact submission route for Noma's live project.

Repository policy says to call the Isometric MCP `how_to` tool first. The parent agent searched for it, but no callable Isometric tool was available in this environment. I therefore verified the requirements directly against the public Registry pages and first-party Certify documentation, and cross-checked request shapes against the checked-in official OpenAPI snapshot. No secrets were inspected and no mutating Certify calls were made. The live Project Design requirements were inspected read-only, but the project's DataUpload/monitoring submission configuration remains unverified.

The parent agent separately inspected the authenticated Certify sandbox UI read-only on 2026-07-29. This is non-public, session-derived evidence rather than a citable public source:

- For project `prj_1K9YJ33RKSBX9FFF`, searching Project Design for “pressure” returned Pathway-specific requirements RD.1 and RD.2.
- RD.2 says that projects must describe and evidence the sensors used to quantify loss of pyrolysis gases through reactor leakage.
- Searching for “temperature” returned only soil-temperature durability requirement DU.3, not a blanket reactor-temperature requirement for every production run.
- Searching for “raw data” returned no project-level checklist requirement.

This live observation is consistent with the Registry text: the project asks for method-specific sensor evidence, not unconditional temperature-plus-pressure rows for every run. It does not resolve whether the project's verifier expects the dedicated DataUpload route, because the Project Design search describes evidence requirements rather than outbound API mechanics.

## Four different questions that should not be conflated

| Layer | Actual question | Answer |
|---|---|---|
| Protocol | Must readings exist, at what cadence and quality? | Sometimes, depending on the selected leakage and direct-emissions methods. |
| Evidence | Must the raw readings be retained and producible? | Yes for applicable methods, generally for at least five years. A file is compatible with this obligation. |
| Certify | Does a dedicated machine-readable time-series submission have a fixed shape? | Yes. Sensor-linked Parquet summaries are required for the DataUpload endpoint. |
| Noma product | Must Noma persist every raw reading in PostgreSQL? | No. That is one way to prepare the Parquet, not an Isometric requirement. |

## What Biochar Protocol v1.1.1 actually requires

### 1. Pressure is conditional, not universally required for every production run

The reactor must account for unintended pyrolysis-gas leakage. The primary route is a validated chemical reactor model with a process mass balance. If that is impractical, the protocol permits either:

1. continuous system-pressure measurement demonstrating consistently sub-atmospheric operation; or
2. regular leakage testing of the system.

For the pressure route, the sensor must be accurate to 2% of full scale or better, readings must be recorded at least every minute, calibration must follow the manufacturer and occur at least annually, and raw data must be available on request. For the leakage-test route, testing must follow an applicable standard or accredited authority, occur at least every 12 months, and proof/results must be retained for at least five years. See [Biochar Protocol v1.1.1, §9.1.2, “Pyrolysis gas loss”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#pyrolysis-gas-loss).

Consequences:

- A generic "pressure CSV required for every completed run" gate is a Noma policy, not the protocol rule.
- A project using the validated-model route does not satisfy that route merely by uploading pressure readings.
- A project using annual leakage testing may not need a production pressure time series at all.
- The protocol section does not contain Noma's current `>0.5 bar` condition.

### 2. Direct-emissions monitoring requires different channels from Noma's current CSV

If direct emissions are measured continuously, the project must measure emitted-gas flow and the concentrations of at least CH4, H2, CO, and CO2 immediately upstream of emission. Flow and composition measurements must be continuous, recorded at least every minute, calibrated at least annually (or more often if the manufacturer requires it), and supported by traceable calibration evidence. Raw data must be available on request. See [§9.2.2, “Measurements - CO2e Direct, RP”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#measurements---coedirectrp).

The retained record package must include raw flow and concentration data for the reporting period, calibration records, and manufacturer calibration and maintenance manuals for at least five years. See [§9.2.3, “Required Records & Documentation”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#required-records--documentation---coedirectrp).

Noma's current canonical CSV requires only timestamp, temperature, and pressure. It does not capture CH4, H2, CO, or CO2 concentration. Its legacy gas-flow field is not in the canonical CSV and is not published by the current time-series transformer. Consequently, the current structured table cannot by itself demonstrate compliance with the protocol's continuous direct-emissions method.

### 3. Temperature time series are conditional and have a specific measurement point

The protocol permits accredited emissions testing instead of continuous gas flow/composition measurement for projects where continuous monitoring is impractical. Under this route, operating feedstock must be shown comparable to the tested feedstock and the **flue-stack temperature** during operations must remain within 10% of the emissions-test value. That temperature sensor must have accuracy of 2% of full scale or better, be recorded at least every minute, be calibrated at least annually or per a stricter manufacturer schedule, and have raw data available on request. See [§9.2.4, “Emissions testing”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#emissions-testing---coedirectrp).

The records retained for at least five years must include the accredited emissions-test report, raw pyrolyzer temperature data for the reporting period, temperature-equipment calibration records, and manufacturer manuals. See [§9.2.4.1, “Required Records & Documentation - emissions testing”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#required-records--documentation---emissions-testing).

Important corrections to the present Noma interpretation:

- No general five-minute production-temperature requirement was found in the pinned v1.1.1 protocol.
- The applicable temperature requirement is at least one-minute reporting under the emissions-testing alternative.
- A column named `temperature_c` without a measurement-point identity does not prove that it is the required flue-stack measurement.

Temperature may also support a pre-agreed PAH-testing mitigation by showing that operating conditions are maintained, but that is a separate, project-agreed use of evidence in the agricultural-soils module.

### 4. Data gaps and anomalies require a control response, not merely storage

The PDD must include conditions for stopping or pausing deployment when instrument malfunctions create gaps in required monitoring, pollutants exceed PDD thresholds, regulatory compliance is compromised, or health and safety is threatened. See [§5.2.3, “Adaptive Management”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#adaptive-management).

The protocol does not prescribe a universal interpolation, duplicate-resolution, or outlier-replacement algorithm for production telemetry. It instead requires the project to define and follow a defensible control plan. The raw file, gap report, resolution decision, and any conservative adjustment should therefore remain auditable.

The verification threshold is 5% considering omissions, errors, and misstatements, and qualitative findings can include weak controls, poorly managed documentation, and difficulty locating requested information. See [§6.2.1, “Verification Materiality”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#verification-materiality). Structure can improve auditability, but structure alone is not compliance.

## What the pinned storage and energy modules add

### Biochar characterization data can explicitly be spreadsheet-based

The Agricultural Soils Module requires characterization reports to include raw data, standards, replicate measurements, and a reproducible analysis trail, with records retained for at least five years. It gives a spreadsheet with summary, reduced-data, processing, and raw-data sheets as an example report format. See [Biochar Storage in Agricultural Soils v1.1.0, §3.5, “Data Reporting”](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1?tag=1.1.0#data-reporting).

This section concerns laboratory characterization rather than reactor telemetry, but it is strong evidence that Isometric's protocol design is evidence- and reproducibility-oriented, not database-schema-oriented.

### Electricity has its own hourly requirement

The pinned Energy Use Accounting Module requires project electricity use to be measured using a utility-grade or independent meter with at least hourly reporting. Meter accuracy must be reported, and meters must be calibrated initially and at regular manufacturer-specified intervals. See [Energy Use Accounting v1.2.0, §5.6, “Measurements”](https://registry.isometric.com/module/energy-use-accounting/1.2?tag=1.2.0#measurements---coe).

Allowable records include electronic or manually logged on-site meter readings. Electricity records, meter specifications, and calibration records must be retained for at least five years. See [§5.7, “Required records and documentation”](https://registry.isometric.com/module/energy-use-accounting/1.2?tag=1.2.0#required-records-and-documentation---coe).

This is independent of the temperature/pressure CSV. Removing Noma's row-level reactor readings would not remove the need for hourly electricity evidence where applicable. Conversely, keeping temperature/pressure rows does not close the electricity requirement.

## What Certify accepts

### Generic evidence Source: CSV is supported

Isometric's Source flow accepts CSV (`text/csv`) as an evidence type, alongside PDF, Parquet, Excel, and other formats. The Source must be uploaded and then attached to a datapoint or other relevant submission object so that it supports the MRV value. See [Certify, “Uploading sources”](https://docs.isometric.com/api-reference/certify/uploading-sources) and [`POST /sources`](https://docs.isometric.com/api-reference/certify/post-source).

Uploading an unlinked file is not enough. Source files included in a submitted GHG statement are visible to the assigned verifier; private Source contents are not publicly exposed after issuance, although metadata such as the filename can be listed. See [Certify, “Data visibility”](https://docs.isometric.com/user-guides/certify/data-visibility).

Certify's Project Design workflow also explicitly recognizes production-batch records, monitoring data logs, and calibration records as “Operational Record” supporting files. See [Certify, “Project design”](https://docs.isometric.com/user-guides/certify/project-design).

### Dedicated time-series DataUpload: Parquet summaries are required

Certify's time-series upload flow requires:

1. creating sensor records;
2. creating a file upload;
3. uploading a Parquet file;
4. creating a DataUploadSubmission; and
5. checking its asynchronous processing status.

For a biochar pyrolysis reactor, the documented measurement properties include CH4, CO, CO2, H2, and N2O mass fractions, pressure, and temperature. The Parquet file contains one row per sensor and aggregation period with:

- aggregation-period start/end;
- sensor reference;
- minimum, maximum, mean, and median;
- count and sample standard deviation; and
- first and last actual timestamps.

It does **not** contain each raw sensor value. See [Certify, “Uploading time series data”](https://docs.isometric.com/user-guides/certify/time-series-data-upload).

The official API offers the submission type `biochar_pyrolysis_reactor_facility_time_series`, and the file-upload endpoint fixes the content type to `application/vnd.apache.parquet`. See [`POST /data-upload-submissions`](https://docs.isometric.com/api-reference/certify/post-data-upload-submission) and [`POST /file-uploads`](https://docs.isometric.com/api-reference/certify/post-file-upload).

The guide contains a documentation inconsistency: its introductory sentence says time-series association is currently limited to DAC, while the same page has a Biochar Pyrolysis Reactor property table and the API exposes a biochar submission type. The narrower intro should not be used to remove the existing integration without Isometric confirmation.

The current Noma aggregator also needs a correctness fix independent of this storage decision. Isometric's current time-series guide specifies **sample standard deviation using Bessel's correction**, while [`src/lib/isometric/transformers/data-upload.ts`](../../src/lib/isometric/transformers/data-upload.ts) calculates population standard deviation and says Isometric does not differentiate. Any continued or replacement DataUpload path should use the documented sample formula and define the behavior for one-value buckets.

### MonitoringSubmission: file-backed, but not proven for this biochar project

The official Certify OpenAPI's `CreateMonitoringSubmissionRequest` takes a previously uploaded `source_id`, a `valid_from`, optional `valid_to`, notes, and an optional supplier reference. This supports a file-backed monitoring model without row-level API datapoints.

However, Isometric's public Storage Monitoring guide says that monitoring requirements are configured by Isometric per project and that the beta UI is presently supported for specified salt-cavern storage pathways. See [Certify, “Storage monitoring”](https://docs.isometric.com/user-guides/certify/storage-monitoring). Therefore, this route cannot be assumed available for Noma's agricultural-soils project without checking the live configuration.

## Do row-level sensor points need to be submitted?

**No protocol or Certify source reviewed requires submission of every raw point as an individual API resource.**

- The protocol says raw data must be retained and made available on request for the applicable methods.
- The dedicated Certify time-series API ingests summary periods with counts and descriptive statistics.
- Generic Sources can carry the original CSV.

The right separation is:

- **Raw evidence:** immutable original CSV, retained for at least five years.
- **Compliance QA:** coverage, cadence, gaps, sensor identity, calibration validity, and exception decisions.
- **Certify machine-readable representation:** generated Parquet summaries if the project uses DataUpload.
- **Carbon-accounting datapoints:** only the aggregate values actually used by removal/GHG calculations, linked to Sources.

## Current Noma behavior: which parts are product choices

### Noma currently requires telemetry more broadly than the protocol

[`src/lib/certification/entity-readiness.ts`](../../src/lib/certification/entity-readiness.ts) marks every non-failed/non-cancelled production run incomplete when `readingsCount` is zero. It does not condition this on the project's selected reactor-model, sub-atmospheric-pressure, leakage-test, continuous-emissions, or emissions-testing method.

[`src/components/production-runs/production-run-detail-fields.ts`](../../src/components/production-runs/production-run-detail-fields.ts) likewise labels readings as required for all certification-candidate runs. This is a conservative Noma product rule, not a faithful rendering of v1.1.1.

### The table's semantics are weaker than the protocol semantics

[`src/db/schema/production.ts`](../../src/db/schema/production.ts) stores one generic temperature and pressure per run/timestamp. It does not identify:

- the physical measurement point;
- the actual sensor;
- sensor accuracy and full-scale range;
- the calibration certificate and validity window;
- whether temperature means reactor, flue-stack, or another location;
- gas species for direct-emissions composition;
- quality flags, gaps, maintenance, or exception disposition; or
- which protocol monitoring strategy the series supports.

Its comments also claim five-minute temperature and a `>0.5 bar` pressure condition not found in the pinned v1.1.1 sections reviewed.

### The canonical CSV is Noma's constraint

[`src/lib/production-readings/readings-csv.ts`](../../src/lib/production-readings/readings-csv.ts) requires a Noma canonical header set with timestamp, temperature, and pressure. It clips readings to a production-run window, accepts null/dropout values, and persists accepted rows. This conversion burden is not imposed by the protocol or the generic Source API.

### Structured rows currently serve only a few local consumers

The rows currently power:

- a read-only readings table and reading counts;
- the Noma-wide certification readiness gate; and
- the transient aggregation used to generate Isometric Parquet.

[`src/lib/isometric/transformers/data-upload.ts`](../../src/lib/isometric/transformers/data-upload.ts) turns those rows into sensor-linked summary periods, while [`src/fn/certification/submit-telemetry.ts`](../../src/fn/certification/submit-telemetry.ts) reads them back and publishes the generated Parquet. This can be performed directly from the preserved source file; PostgreSQL row persistence is not inherently required.

Production-run sensor documents are currently excluded from Noma's ordinary Removal Source mirroring in [`src/fn/certification/sources.ts`](../../src/fn/certification/sources.ts). Therefore, simply stopping the import today would leave the CSV local and would also break the existing DataUpload generation. A file-only design requires an explicit outbound evidence/submission path.

## Recommended Noma design

### Operator experience

The visible workflow should be exactly what was requested:

> Upload the plant's CSV once. Noma handles the rest.

Do not require the operator to rename columns, convert timestamps, select channel mappings for every run, or press a second “import” action.

### Persist the file and a compact manifest, not every raw point

Keep:

- immutable original object and SHA-256;
- facility, reactor, production-run/reporting-period association;
- upload and parser version;
- detected source format/profile;
- channel-to-sensor mapping, units, and measurement points;
- first/last timestamp and row count;
- expected versus observed cadence and coverage;
- gap, duplicate, invalid, and out-of-range counts;
- per-channel summary statistics;
- calibration certificate IDs and validity at measurement time;
- anomaly/exception disposition and reviewer;
- generated Parquet hash or retained derivative;
- Isometric Source/DataUpload IDs and status.

Parse and validate in a stream or temporary job. Generate the Parquet from the source file plus a versioned adapter. Keeping the source hash, adapter version, and derivative hash makes the transformation reproducible without duplicating millions of sensor rows in the application database.

If Noma later needs charts, keep per-minute or per-hour aggregates in a separate analytical store or cache. That is a product/analytics decision, not a compliance prerequisite.

### Make readiness conditional on the declared monitoring strategy

Replace the unconditional `readingsCount > 0` gate with method-specific evidence:

| Declared method | Required readiness evidence |
|---|---|
| Validated reactor model for leakage | Model version, validation evidence, process mass balance, PDD reference |
| Sub-atmospheric-pressure alternative | Pressure source file, one-minute coverage QA, sensor accuracy, annual/current calibration, raw-file retention |
| Annual leakage-test alternative | Test date, standard/accreditation, signed results, next due date, five-year retention |
| Continuous direct-emissions measurement | Flow plus CH4/H2/CO/CO2 series, measurement point, one-minute coverage, traceable calibration |
| Accredited emissions-test alternative | Signed test report, feedstock comparability, flue-stack temperature series, ±10% operating check, one-minute coverage, calibration |
| Electricity accounting | Hourly meter evidence, meter/calibration metadata, allocation method where shared |

### Preserve a verifier-friendly package

A file-only design is safe only if the package is easy to audit. For each reporting period, provide:

- the untouched source CSV;
- a human-readable QA summary;
- sensor and calibration documents;
- the selected method and applicability statement;
- all data gaps and their treatment;
- any generated Parquet and its transformation manifest; and
- direct links between the package, GHG statement, and relevant PDD requirement.

This is more defensible than a generic temperature/pressure table that gives a structured appearance but lacks measurement-point and calibration semantics.

## Decision

### Recommended now

1. **Approve the “upload once” UX direction.**
2. **Stop treating row-level PostgreSQL storage as a protocol requirement.**
3. **Design a file-first evidence record with automatic QA and a versioned CSV-to-Parquet adapter.**
4. **Condition certification readiness on the chosen monitoring method instead of requiring telemetry on every run.**
5. **Retain raw files and calibration evidence for at least five years.**

### Confirmation required before removing the current row pipeline

Ask Noma's Isometric Registry Operations Manager:

1. For project `prj_1K9YJ33RKSBX9FFF`, is `biochar_pyrolysis_reactor_facility_time_series` required for verification, recommended, or optional?
2. May the original production telemetry CSV be submitted as a private Source linked to the relevant PDD requirement, GHG datapoint, or monitoring requirement instead?
3. Which leakage route is approved in the PDD: validated reactor model, continuous sub-atmospheric pressure, or annual leakage testing?
4. Which direct-emissions route is approved: continuous flow/composition measurement or accredited emissions testing with flue-stack temperature?
5. What exact sensor measurement points and calibration documents does the VVB expect?
6. Does the verifier want the original raw CSV in addition to the aggregated Parquet?

If Isometric says DataUpload is required, Noma can still remove row persistence and generate the required Parquet directly from the uploaded CSV. If Isometric accepts Source-only evidence, Noma can remove both row persistence and the dedicated telemetry submission for this project, while retaining automatic QA.

## Primary sources

- [Biochar Production and Storage Protocol v1.1.1](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1)
- [Biochar Storage in Agricultural Soils Module v1.1.0](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1?tag=1.1.0)
- [Energy Use Accounting Module v1.2.0](https://registry.isometric.com/module/energy-use-accounting/1.2?tag=1.2.0)
- [Certify: Uploading time series data](https://docs.isometric.com/user-guides/certify/time-series-data-upload)
- [Certify: Uploading sources](https://docs.isometric.com/api-reference/certify/uploading-sources)
- [Certify API: Post Data Upload Submission](https://docs.isometric.com/api-reference/certify/post-data-upload-submission)
- [Certify API: Post File Upload](https://docs.isometric.com/api-reference/certify/post-file-upload)
- [Certify API: Post Source](https://docs.isometric.com/api-reference/certify/post-source)
- [Certify: Data visibility](https://docs.isometric.com/user-guides/certify/data-visibility)
- [Certify: Project design](https://docs.isometric.com/user-guides/certify/project-design)
- [Certify: Storage monitoring](https://docs.isometric.com/user-guides/certify/storage-monitoring)
