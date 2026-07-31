# Isometric Production-Run Readings Evidence

**Research date:** 2026-07-31
**Scope:** Biochar Production and Storage Protocol v1.1.1, Biochar Storage in Agricultural Soils Module v1.1.0, and the current first-party Certify API surface

## Conclusion

Isometric does **not** expressly require one raw CSV for every production run.
It does require the raw monitoring records for the monitoring method the project
actually uses. Those records must be auditable and, depending on the method,
retained for at least five years and made available through Isometric's
verification process.

Therefore:

- Noma does not need to convert an operator's CSV into structured telemetry merely
  to satisfy the protocol's raw-record obligation.
- A readings-file field may reasonably carry a **CERT** indicator when it is the
  place Noma collects evidence required by the project's approved monitoring
  method.
- A blanket rule that every completed production run must have a CSV is a
  conservative Noma/project control, not a requirement stated in the base v1.1
  protocol or agricultural-soils module. It should be described that way unless
  the approved PDD, project-specific Certify requirement, or verifier instruction
  makes it mandatory.
- Keeping the file only inside Noma is not automatically the same as supplying it
  to Isometric. If it supports an MRV datapoint or PDD requirement, it still needs
  to be linked or supplied through the project-agreed Certify/verifier workflow.

## 1. Protocol monitoring and evidence obligation

The obligation is **method-dependent**, not universal production telemetry:

| Approved monitoring route | v1.1 obligation | Grain stated by Isometric |
|---|---|---|
| Validated reactor model for pyrolysis-gas loss | Reactor model, empirical validation, and process mass balance | Project/model, not one CSV per run |
| Sub-atmospheric-pressure alternative | Calibrated pressure sensor, readings at least every minute, raw data available on request | Reactor operations; no file format or per-run file rule |
| Regular leakage-testing alternative | Test to an applicable standard/accredited authority at least annually; retain proof/results for at least five years | Test event, not production run |
| Continuous direct-emissions measurement | Flow plus CH4, H2, CO, and CO2 readings at least every minute; raw data available on request | Reporting Period |
| Accredited emissions-testing alternative | Emissions-test report plus operating temperature readings at least every minute and supporting calibration evidence | Reporting Period |

Sources: Biochar Protocol v1.1.1, [§9.1.2, “Pyrolysis gas
loss”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#pyrolysis-gas-loss),
[§9.2.2, “Measurements - CO2e Direct,
RP”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#measurements---coedirectrp),
[§9.2.3, “Required Records &
Documentation”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#required-records--documentation---coedirectrp),
and [§§9.2.4-9.2.4.1, “Emissions
testing”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#emissions-testing---coedirectrp).

For continuous direct-emissions monitoring, §9.2.3 expressly requires raw
flow/concentration meter data for the **Reporting Period**, calibration records,
and manufacturer manuals to be maintained for at least five years. The
emissions-testing alternative likewise requires raw pyrolyzer-temperature data
for the Reporting Period and supporting records. These sections say neither
“CSV” nor “one file per production run.”

Protocol §6.6, [“Data
Sharing”](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1#data-sharing),
says measurements and supporting documentation used for quantification are made
available through Isometric's platform, subject to permitted confidentiality
restrictions. It establishes availability to Isometric/verification, but does
not prescribe CSV, a particular API resource, or a per-run upload boundary.

The Agricultural Soils Module adds no general reactor-readings requirement.
Its [§3.5, “Data
Reporting”](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1?tag=1.1.0#data-reporting),
requires raw data underlying **biochar characterization** analyses and gives a
multi-sheet spreadsheet as an example. That is laboratory/characterization
evidence, not a command to upload a reactor CSV for every production run.

## 2. Certify/API structured telemetry is a separate route

Certify's dedicated time-series workflow is not a raw-CSV archive. It requires:

1. registered sensors;
2. a FileUpload;
3. a Parquet file containing sensor-linked aggregation periods; and
4. a DataUploadSubmission processed asynchronously.

The official guide says the Parquet rows contain period start/end, sensor
reference, min/max/mean/median, count, sample standard deviation, and first/last
actual timestamps. See [Certify, “Uploading time series
data”](https://docs.isometric.com/user-guides/certify/time-series-data-upload#upload-process-overview)
and [“Parquet file
structure”](https://docs.isometric.com/user-guides/certify/time-series-data-upload#parquet-file-structure).

The API exposes
`biochar_pyrolysis_reactor_facility_time_series`, but the request only identifies
the FileUpload, submission type, and facility/storage location. It has no
production-run ID and no field making one submission mandatory per run. See
[`POST /data-upload-submissions`](https://docs.isometric.com/api-reference/certify/post-data-upload-submission)
and [`POST /file-uploads`](https://docs.isometric.com/api-reference/certify/post-file-upload).
The checked-in first-party generated types show the same contract in
[`CreateDataUploadSubmissionRequest`](../../src/lib/isometric/generated/certify.d.ts)
and fix FileUpload content type to `application/vnd.apache.parquet`.

The existence of this API proves how to submit structured time series **if the
project must use that route**. It does not, by itself, prove that every Biochar
v1.1 project or every production run must create a DataUploadSubmission. Noma's
current integration inventory correctly marks the telemetry path “dark”; see
[`openapi-index.md`](../isometric/openapi-index.md#telemetry-operations).

## 3. A raw CSV can be evidence without being structured telemetry

Certify's generic Source flow accepts CSV (`text/csv`) and instructs clients to
attach a Source to the datapoint it supports. See [Certify, “Uploading
sources”](https://docs.isometric.com/api-reference/certify/uploading-sources#supported-filetypes).
The Project Design UI also lists production-batch records, monitoring data logs,
and calibration records as “Operational Record” evidence; see [Certify,
“Project design”](https://docs.isometric.com/user-guides/certify/project-design#pdd-drafting).

This establishes that an unchanged CSV is a supported evidence artifact. It
does **not** establish that uploading an unlinked CSV alone closes a requirement,
nor that Source upload is interchangeable with a project-required
DataUploadSubmission.

## Product interpretation for Noma

A defensible Noma rule is:

> Preserve the operator's native readings file unchanged and associate it with
> every production run whose approved monitoring method requires those readings.
> Treat absence as a certification-readiness gap for that method.

If Noma intentionally chooses the simpler blanket rule “one readings file for
every completed run,” the UI may mark it **CERT**, but documentation should call
it a conservative evidence-completeness control. It should not claim that
Isometric v1.1 expressly mandates a CSV per run.

Before making that gate a statement of external compliance, confirm for the live
project:

1. which gas-loss and direct-emissions monitoring routes the approved PDD uses;
2. whether Isometric/verifier expects DataUploadSubmission, a private Source/PDD
   attachment, or evidence on request; and
3. whether the project-specific monitoring plan defines production run as the
   required evidence boundary.

## Research limitation

No callable Isometric MCP `how_to` tool was available in this environment. The
findings were therefore checked against the official Registry pages, first-party
Certify documentation, and the repository's generated Certify OpenAPI types. No
authenticated live-project configuration was queried. Project-specific
requirements may consequently be stricter than the public base documents.
