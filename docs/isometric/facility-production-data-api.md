# Isometric facility and production-data API research

> **Non-authoritative implementation research.** Verified against Isometric's
> live Certify OpenAPI and first-party documentation on 2026-08-04. The project
> remains pinned to Biochar Production and Storage Protocol v1.1 and Biochar
> Storage in Agricultural Soils v1.1 in [`versions.json`](./versions.json).
> Re-check the live sources and the project's live GHG-entry template before
> implementing credit logic.

## Decision summary

1. **Do not build a facility sync.** The current Certify OpenAPI has no
   facility list, get, create, patch, or delete path. Create and maintain the
   one Isometric facility in Certify's UI, then store its `fcl_...` ID in the
   existing facility-to-certifier project mapping. The user's target is
   `fcl_1KST05ZW3SBXZCM7` under project `prj_1K9YJ33RKSBX9FFF`; verify in the UI
   that this is the intended production line before making it canonical.
   [Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json),
   [sandbox facility page](https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities/fcl_1KST05ZW3SBXZCM7?tab=production-batches)
2. **Map one noma credit batch to one Isometric production batch.** This is
   consistent with the accepted local domain decision, but only while the
   credit batch represents one coherent protocol Production Batch rather than
   an arbitrary accounting group. The protocol says the feedstock, pyrolysis,
   produced biochar characteristics, transport distances, and storage-site
   characteristics are the same throughout a Production Batch.
   [Biochar Protocol v1.1, section 8.3.1](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar),
   [ADR 0016](../adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)
3. **Sync in dependency order:** facility mapping -> registry feedstock type ->
   production batch -> production-batch measurement sample -> returned
   datapoint/source bindings -> GHG entry. Sensors and Parquet time-series are
   a separate monitoring lane; they do not replace production-batch samples.
   [Production-batch API](https://docs.isometric.com/api-reference/certify/post-production-batch),
   [measurement-sample guide](https://docs.isometric.com/user-guides/certify/measurement-samples),
   [time-series guide](https://docs.isometric.com/user-guides/certify/time-series-data-upload)
4. **Implement production batches first, then production-batch samples.** These
   close an explicit gap in the current integration. Treat sensor registration
   and time-series uploads as a later, conditional slice until Isometric
   confirms how it expects Biochar monitoring to be submitted. Isometric's
   field-measurement guide calls Production batch and Pyrolysis reactor samples
   required for Biochar, while `/sensors` is documented as the first step only
   for the separate time-series upload flow.
   [Field measurements](https://docs.isometric.com/user-guides/certify/field-measurements),
   [time-series guide](https://docs.isometric.com/user-guides/certify/time-series-data-upload)

## What “required” means in this document

The sources expose three different kinds of obligation that must not be
collapsed:

- **API-required:** the current OpenAPI request schema requires the property to
  be present for the request to validate. A schema property may be required but
  nullable.
- **Certification-required:** the pinned protocol/module or Certify workflow
  requires the data or evidence for verification, even if an HTTP request can
  technically be accepted without it.
- **Conditional:** required only for the chosen durability, sampling, gas-loss,
  emissions, regulation, or monitoring path.
- **Optional/recommended:** not required by the selected API or pinned
  certification path. “Recommended” protocol measurements should not become a
  submission blocker without a project-specific agreement.

The API describes transport validation, not the complete certification
contract. For example, a production-batch request can validate without a lab
report, but the module requires externally verifiable characterization data,
laboratory QA/QC, calibration records, and raw/reduced data.
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json),
[Agricultural Soils v1.1, sections 3.4.2-3.5](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#sampling-guidance-laboratory-requirements-data-quality)

## 1. Facility

### Current authoritative surface

The 2026-08-04 live OpenAPI contains no path with `facility` in its path name.
Facilities nevertheless exist as foreign IDs consumed by production batches,
sensors, and data-upload submissions. This makes the facility a UI-owned
prerequisite, not an API-synchronised resource.
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

The Certify UI defines a Biochar facility as a site/production line that may
combine outputs from co-located reactors. If reactor outputs are stored and
tracked independently, the UI instructs the supplier to create separate
facilities for the separate production lines. Therefore one remote facility is
correct only if Dark Earth Carbon operates one combined and tracked production
line for the project.
[Certify sandbox Facilities UI](https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities)

### Minimal one-facility architecture

Use one immutable external mapping for this project:

| Mapping fact | Value / source | Classification |
|---|---|---|
| Isometric environment | sandbox now; production is a separate credential and data environment | required configuration |
| Isometric project ID | `prj_1K9YJ33RKSBX9FFF` | required configuration |
| Isometric facility ID | proposed canonical `fcl_1KST05ZW3SBXZCM7`, after one-time UI confirmation | required configuration |
| Local facility | the one noma facility represented by the remote production line | required configuration |
| Default GHG-entry template | existing provider mapping; validate separately against the live project template | required for later GHG entry, not facility mapping |

Sandbox and production accounts and credentials are independent, so an
`fcl_...` ID must always be stored with its provider environment and project
mapping; it must never be copied blindly from sandbox to production.
[Isometric API environments](https://docs.isometric.com/api-reference/introduction#environments)

The supplied screenshot shows two remote facility rows even though the desired
end state is one. Confirm which row the linked `fcl_1KST05ZW3SBXZCM7` represents,
make that mapping canonical, and remove/archive the duplicate only through the
Certify UI after confirming it has no dependent data. The API cannot perform or
preflight that cleanup.
[Certify sandbox Facilities UI](https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities),
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

### Strictly needed vs not needed

| Item | Classification | Reason |
|---|---|---|
| One correct `fcl_...` mapping | strictly needed for the proposed production-batch and Biochar time-series requests | `facility_id` is required by `CreateProductionBatchRequest`; it is the association used by Biochar sensors/time-series. [OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json) |
| Facility list/create client | not possible and therefore not in scope | no facility paths are published. [OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json) |
| Multiple remote facilities | conditional | only if outputs form separately stored/tracked production lines. [Certify Facilities UI](https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/facilities) |
| Automatic facility metadata sync | optional/unavailable | downstream responses expose only the facility ID or project association, not a Facility resource. [OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json) |

### Facility validation and failure mode

There is no read endpoint with which noma can validate a pasted facility ID
before its first downstream write. Validate the ID format locally, require an
operator to open the exact Certify facility deep link, and bind the mapping to
the selected project/environment. A downstream `POST /production_batches` or
`POST /sensors` failure must leave the local resource unsynchronised rather than
silently removing the mapping.
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

## 2. Production batches

### Domain mapping

Use this mapping and keep the names distinct:

| noma | Isometric Certify | Do not confuse with |
|---|---|---|
| credit batch | `/production_batches` Production Batch | an issued Registry “credit batch” |
| credit batch ID/code | `supplier_reference_id` / optional `display_name` | the remote `ptb_...` ID |
| declared pyrolysis feedstock type | one entry in `feedstock_type_ids` | a local blend-only ingredient |
| production period | `started_at`, `ended_at` | a GHG-entry reporting period |
| batch output mass, basis to be confirmed | `mass` | dry applied mass used by the sequestration calculation |

The protocol's Production Batch is a homogeneous production/storage cohort,
and the local accepted decision already makes the credit batch this protocol
grain. The 1:1 mapping is therefore the intended mapping, but submission must
still fail when a local credit batch violates its one-feedstock/consistent-
process boundary.
[Biochar Protocol v1.1, section 8.3.1](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar),
[ADR 0016](../adr/0016-credit-batch-is-production-batch-production-process-scopes-sampling.md)

### API operations and lifecycle

The current resource exposes:

- `GET /production_batches` with cursor pagination only;
- `POST /production_batches`;
- `GET /production_batches/{id}`;
- `DELETE /production_batches/{id}`.

There is no PATCH operation and no server-side
`supplier_reference_id`, facility, project, or date filter on the list route.
The list defaults to 10 and supports at most 50 resources per page.
[Get Production Batches](https://docs.isometric.com/api-reference/certify/get-production-batches),
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

This should be treated as a **create-after-finalisation** resource, not a live
mirror of a draft. Corrections cannot be expressed by PATCH. The published
documentation does not state what happens when deleting a production batch
already referenced by samples, applications, or submitted calculations, so
automatic delete-and-recreate must be limited to an explicitly safe draft path
or deferred to Isometric support.
[Delete Production Batch](https://docs.isometric.com/api-reference/certify/delete-production-batch),
[Modifying resources](https://docs.isometric.com/user-guides/certify/modifying-resources)

Noma-side policy, not an Isometric requirement (Certify gates only on
API-schema validity): before POSTing, fail closed unless the credit batch has at least one member run,
all member runs are complete, every member belongs to the mapped facility and
declared production-process/feedstock identity, all required output masses are
present and positive, and the derived physical window is coherent. After the
remote resource exists, mutations to those identity fields need the same
certification-lineage lock used for other submitted artifacts.

### Create payload

`POST /production_batches` requires all of the following properties:

| Field | API classification | Proposed source | Notes |
|---|---|---|---|
| `facility_id` | required | canonical external facility mapping | This indirectly associates the batch to the project. |
| `feedstock_type_ids` | required array | the credit batch's one certifier-validated feedstock type | The schema sets no minimum item count, but an empty array would contradict this Biochar mapping. |
| `supplier_reference_id` | required, 1-200 chars | stable noma credit-batch identity, namespaced for environment/provider | Isometric describes it as unique for resources created by a supplier. |
| `kind` | required; only `biochar` is allowed | constant | No other current enum value exists. |
| `started_at` | required ISO-8601 datetime | earliest member `production_runs.startTime` | Use the physical instant in UTC, not midnight derived from `credit_batches.startDate`. |
| `ended_at` | required ISO-8601 datetime | latest member `production_runs.endTime` | Every member run must be closed; do not create an open/in-progress batch remotely. |
| `mass.magnitude` | required number | batch mass after the basis decision below | Do not send a locally rounded display value. |
| `mass.unit` | required non-empty string | project-agreed unit, preferably the template-compatible canonical unit | `standard_deviation` is optional/nullable. |
| `display_name` | optional/nullable, 1-150 chars | operator-facing credit-batch code | Isometric auto-generates it from the facility name when omitted. |

Source for the exact field contract:
[Post Production Batch](https://docs.isometric.com/api-reference/certify/post-production-batch),
[live `CreateProductionBatchRequest`](https://docs.isometric.com/api-reference/certify/mrv.openapi.json).

### One unresolved mass decision blocks a safe implementation

The official OpenAPI labels `mass` only as a scalar quantity and does not say
whether this resource expects produced wet biochar, produced dry biochar, or
the ultimately applied dry mass. The pinned storage module separately defines
the credited sequestration mass as **dry mass applied**, while the protocol
also distinguishes produced batches from storage/application batches.
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json),
[Agricultural Soils v1.1, section 4.1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#quantification-of-coe),
[Biochar Protocol v1.1, section 8.3.1](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar)

Before coding the payload, ask Isometric one precise question:

> For `POST /production_batches`, what physical mass and basis should a Biochar
> project submit: produced wet mass, produced dry mass, or dry mass later
> applied? If the batch is only partially applied in one reporting period,
> should the production-batch `mass` remain the full produced amount?

Until answered, retain the full local mass facts and do not guess a conversion.
The GHG-entry sequestration `product_mass` remains a separate applied-mass
input regardless of this answer.

### Idempotency and reconciliation

The API publishes no idempotency-key header for this resource. Use the stable
`supplier_reference_id` as the business key, persist the returned `ptb_...` ID,
and hash the exact request payload. Because `GET /production_batches` has no
reference filter, recovery after a timeout/crash requires paginating the entire
list and matching the supplier reference client-side before attempting another
POST.
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

Minimum local sync state:

- provider and environment;
- organization, project, facility, and local credit-batch IDs;
- stable supplier reference;
- remote production-batch ID;
- exact payload snapshot/hash and local data revision;
- state (`draft`, `creating`, `created`, `failed`, `superseded`), last error,
  and timestamps.

This is a design recommendation derived from the published create/list surface,
not an Isometric-specified ledger schema.

## 3. Production-batch measurement samples

### What is strictly required for Biochar

Isometric's Certify guide says Production batch and Pyrolysis reactor sample
types are required for all Biochar projects; Soil samples are required for a
200+ year path and recommended more broadly. Production-batch samples quantify
the biochar, while pyrolysis-reactor samples monitor the reactor. They are
separate resources and should not be conflated with continuous sensor uploads.
[Field measurements](https://docs.isometric.com/user-guides/certify/field-measurements),
[measurement-sample guide](https://docs.isometric.com/user-guides/certify/measurement-samples)

For the pinned agricultural-soil module, the batch-level core is:

| Measurement/evidence | Classification | Cadence |
|---|---|---|
| Total carbon content | strictly required | every sampled Production Batch under Method A/B; normally >=3 samples |
| Moisture content | strictly required | every sampled Production Batch under Method A/B; normally >=3 samples |
| H/C organic ratio, `< 0.5` | strictly required | every sampled Production Batch under Method A/B; normally >=3 samples |
| O/C organic ratio, `< 0.2` | strictly required, but not every batch | validation and when feedstock/reactor/process parameters change; minimum one sample |
| Ash | strictly required, but not every batch | validation and when feedstock/reactor/process parameters change; minimum one sample |
| Fixed carbon / volatile matter | required characterization with the module's stated substitution note | validation and when feedstock/reactor/process parameters change; minimum one sample |
| Random reflectance `R0` | conditional | required for the 1,000-year durability option; every sampled batch |
| PAH panel | conditional waiver | required at validation/change unless stringent mitigation is pre-agreed with Isometric and documented |
| Pb, Cd, Cu, Ni, Hg, Zn, Cr, As and organic contaminants | strictly required; threshold source is conditional | measure at the module's stated cadence; use applicable local-law limits where they exist, otherwise the module/WBC limits control |
| pH, specific surface area, porosity, particle size, CEC, bonding-state analyses | optional/recommended | do not make these generic submission blockers |

[Agricultural Soils v1.1, Table 2 and section 2.2](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#chemical-characteristics)

Method A measures every Production Batch. Method B can sample fewer batches
only after an Isometric-agreed initial set; after that it requires sampling at
least every 10 Production Batches, uses eligible samples from the preceding six
months for the conservative estimate, and requires a random-sampling plan
agreed with Isometric. A feedstock/process change or significant carbon
deviation starts a new Production Process and restarts sampling history.
[Biochar Protocol v1.1, section 8.3.1](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar)

The default within-batch rule is at least three representative samples per
measured batch. Protocol v1.1 permits an alternative only with justification
and evidence that within-batch variation is minimal. The storage module is
stricter in its presentation: it says composite samples must be divided into at
least three representative laboratory replicates and that project sampling
must demonstrate within-batch homogeneity. Therefore noma's existing >=3 local
Sample gate is the safe default; any exception should be an explicit
Isometric-approved project decision, not a generic toggle.
[Biochar Protocol v1.1, minimum samples](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar),
[Agricultural Soils v1.1, section 3.4.1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#homogeneity-considerations)

### API resource and create payload

Create a production-batch sample with `POST /measurement_samples` and
`measurement_type: "biochar_production_batch"`. The current API has list,
create, and delete operations but no GET-by-ID or PATCH operation for
measurement samples. The list route has cursor pagination only and no supplier-
reference, project, batch, type, or date filter.
[Post Measurement Samples](https://docs.isometric.com/api-reference/certify/post-measurement-samples),
[Get Measurement Samples](https://docs.isometric.com/api-reference/certify/get-measurement-samples),
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

The request contract is unusual: several properties are required to be present
but may be `null`.

| Field | API classification | Production-batch value |
|---|---|---|
| `supplier_reference_id` | required property, nullable, max 200 | always send a stable non-null reference for reconciliation |
| `measured_at` | required datetime | actual lab/sampling measurement time; do not substitute sync time |
| `project_id` | required | mapped external project ID |
| `feedstock_batch_id` | required property, nullable | `null` for this production-batch path unless Isometric directs otherwise |
| `measurement_location_id` | required property, nullable | `null` for the batch chemistry unless Isometric assigns a required location |
| `measurement_type` | required | `biochar_production_batch` |
| `values` | required array | one or more template/protocol-relevant measurements |
| `storage_location_id` | required property, nullable | `null` for the production-batch chemistry unless Isometric directs otherwise |
| `production_batch_id` | optional in OpenAPI | **semantically required for this integration:** returned `ptb_...` ID |

Each value requires a `measurement_property` and a quantity with `magnitude`
and `unit`; `standard_deviation` is optional/nullable. The supported Biochar
Production batch property catalogue includes mass, H:C, carbon fractions,
moisture, ash, fixed/volatile carbon, contaminants, and reflectance-derived
fractions.
[Live `CreateMeasurementSampleRequest`](https://docs.isometric.com/api-reference/certify/mrv.openapi.json),
[Biochar measurement-property catalogue](https://docs.isometric.com/user-guides/certify/measurement-samples#production-batch)

### Remote sample grain: preserve the local replicates

The official guide defines a measurement sample as a set of physical
measurements and allows many values in one resource. It does not state whether
the >=3 laboratory replicates should be represented as three
`measurement_samples` resources or as repeated values within one batch-linked
resource. The current noma sandbox durability path uses one remote
`biochar_production_batch` measurement sample per credit batch and retains
replicate values where the live blueprint expects list inputs.
[Measurement-sample guide](https://docs.isometric.com/user-guides/certify/measurement-samples),
[`durability-measurement-samples.ts`](../../src/fn/certification/durability-measurement-samples.ts),
[`measurement-sample.ts`](../../src/lib/isometric/transformers/measurement-sample.ts)

Do not collapse or delete the three local Sample records. Keep each replicate's
identity, collection time, results, method, and lab evidence locally. Before
generalising the sandbox representation, ask Isometric whether its Production
batch sample UI/API expects:

1. one remote sample per independent replicate;
2. one remote batch sample containing repeated per-replicate values; or
3. one remote batch sample containing mean plus standard deviation, with raw
   replicates supplied as evidence.

This question matters for Method B's sample counts and outlier handling. The
protocol computes from individual eligible samples, not merely from one
pre-averaged number.
[Biochar Protocol v1.1, Method B and outliers](https://registry.isometric.com/protocol/biochar/1.1#calculation-of-cbiochar)

### Durability-specific minimum wire values

The exact crediting values must be driven by the live GHG-entry template and
component blueprint, not by a hard-coded universal list. Isometric states that
measurement samples can supply inputs to credit calculations, and the live
template determines which datapoints the sequestration component consumes.
[Build an LCA, components using sample data](https://docs.isometric.com/user-guides/certify/lca#components-using-sample-data),
[measurement-sample guide](https://docs.isometric.com/user-guides/certify/measurement-samples)

Current local evidence is narrower than a production-ready claim:

- sampled 1,000-year sandbox wiring has been exercised with per-replicate total
  carbon and reflectance-derived `s_fraction`, plus product mass;
- the 200-year H/C unit/binding remains explicitly unconfirmed and fails closed;
- unsampled Method B's registry representation remains unconfirmed.

These are repository implementation observations, not Isometric protocol
requirements.
[`integration-plan.md`](./integration-plan.md),
[`measurement-sample.ts`](../../src/lib/isometric/transformers/measurement-sample.ts)

### Evidence is required even when the POST accepts numbers

The module requires qualified-laboratory evidence, QA/QC, calibration records,
raw data, replicate measurements, uncertainty, and a reproducible summary.
Records must be retained for at least five years; archiving a representative
physical sample for five years is recommended, not required.
[Agricultural Soils v1.1, sections 3.4.2-3.5](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#laboratory-requirements)

`POST /measurement_samples` returns a `datapoint_id` for each value. Capture
those IDs and attach the applicable lab report/source to the exact
calculation-used datapoints before GHG-statement submission. Isometric explains
that sources evidence datapoints and that calculation-used sample datapoints
become visible in the Registry after issuance.
[Measurement-sample response](https://docs.isometric.com/api-reference/certify/post-measurement-samples),
[Key Certify concepts](https://docs.isometric.com/user-guides/certify/key-certify-concepts),
[data visibility](https://docs.isometric.com/user-guides/certify/data-visibility#measurement-samples)

### Idempotency and corrections

Use a stable, versioned supplier reference and persist the returned `mts_...`
ID plus every returned datapoint ID. Because the API provides no supplier-
reference filter, reconciliation must scan all pages client-side. Because there
is no PATCH operation, a correction requires a controlled new version or a
delete/recreate flow while deletion is demonstrably safe; never silently
replace a sample already used by a submission.
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json),
[Modifying resources](https://docs.isometric.com/user-guides/certify/modifying-resources)

## 4. Sensors and time-series data

### Sensor records are conditional, not a substitute for protocol monitoring

`POST /sensors` is required only when using Isometric's time-series upload
pipeline. It creates metadata for a sensor/channel; the subsequent Parquet rows
identify the channel by the sensor's supplier `reference`. Production-batch and
Pyrolysis reactor measurement samples remain separate Certify resources.
[Time-series upload process](https://docs.isometric.com/user-guides/certify/time-series-data-upload#upload-process-overview),
[measurement-sample guide](https://docs.isometric.com/user-guides/certify/measurement-samples)

Protocol sensor/monitoring duties can be mandatory even when `/sensors` is not.
The PDD reactor diagram must show temperature/pressure sensor positioning. The
gas-loss path requires appropriate monitoring/model evidence, or one of the
allowed alternatives. The sub-atmospheric-pressure alternative requires a
calibrated pressure sensor with accuracy at least 2% of full scale, readings at
least every minute, calibration at least annually and to manufacturer
requirements, and raw data available on request. Annual leakage testing is a
different allowed alternative. The correct monitoring burden therefore depends
on the project-agreed gas-loss and direct-emissions method.
[Biochar Protocol v1.1, sections 9.1.1-9.1.2](https://registry.isometric.com/protocol/biochar/1.1#reactor-design-requirements),
[direct emissions](https://registry.isometric.com/protocol/biochar/1.1#direct-emissions)

For direct emissions, the protocol provides materially different evidence
routes. The continuous-instrumentation route requires inline gas-flow
measurement together with continuous CH4, H2, CO, and CO2 composition
measurements at one-minute resolution. The alternative emissions-testing route
uses an appropriately accredited testing body and requires the tested operating
period to be representative, including one-minute flue-stack-temperature
monitoring. Therefore, an existing temperature-and-pressure sensor pipeline is
neither a universal minimum nor sufficient evidence for every project: the
applicable route must first be fixed in the project design and monitoring plan.
[Biochar Protocol v1.1, direct emissions](https://registry.isometric.com/protocol/biochar/1.1#direct-emissions)

### Sensor API contract

`POST /sensors` requires:

| Field | API classification | Biochar use |
|---|---|---|
| `reference` | required, max 255 | stable unique identity for the physical/logical measurement channel |
| `measurement_property.quantity_kind` | required | one allowed property, e.g. `temperature` or `pressure` |
| `measurement_property.qualifier` | required property, nullable | normally `null` for temperature/pressure; compound qualifier for gas composition |
| `units` | required | exact unit used by uploaded values, e.g. `degC` or `bar` |
| `facility_id` | optional/nullable in schema | required by this architecture to associate a Biochar reactor channel with the canonical facility |
| `manufacturer` | optional/nullable | useful evidence metadata, not technically required |
| `model` | optional/nullable | useful evidence metadata, not technically required |
| `storage_location_id` | optional/nullable | `null` for a facility sensor |

[Post Sensors](https://docs.isometric.com/api-reference/certify/post-sensors),
[Live `CreateSensorRequest`](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

The current sensor surface is `GET /sensors`, `POST /sensors`, and
`GET /sensors/{id}` only. The list can filter by `project_id` and `reference`.
There is no PATCH or DELETE operation, and the response does not echo
`facility_id`. Reconcile by stable `reference` before POSTing; treat changed
units/property or physical sensor replacement as a new sensor identity rather
than mutating the old one.
[Get Sensors](https://docs.isometric.com/api-reference/certify/get-sensors),
[Live Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

The time-series guide allows these Biochar Pyrolysis Reactor properties:
temperature, pressure, and mass fractions of CH4, CO, CO2, H2, and N2O. The
guide does not list a Biochar flow-rate property, even though the protocol's
gas-loss/direct-emissions methods may require flow. Therefore the documented
time-series lane alone cannot be assumed to satisfy the complete gas-loss or
direct-emissions evidence contract.
[Time-series Biochar properties](https://docs.isometric.com/user-guides/certify/time-series-data-upload#biochar-pyrolysis-reactor),
[Biochar Protocol v1.1, pyrolysis gas loss](https://registry.isometric.com/protocol/biochar/1.1#pyrolysis-gas-loss)

### Time-series upload choreography

When this optional lane is enabled, the official sequence is:

1. Create/reconcile every sensor reference.
2. `POST /file-uploads` with Parquet content type, exact byte length, and file
   name; the API returns a file-upload ID and signed upload URL.
3. PUT the exact Parquet bytes to the signed URL with the matching content type.
4. `POST /data-upload-submissions` with
   `submission_type: "biochar_pyrolysis_reactor_facility_time_series"`, the
   file-upload ID, and the canonical facility ID.
5. Poll `GET /data-upload-submissions/{id}` until `completed` or `failed`; retain
   the returned error message on failure.

[Time-series upload process](https://docs.isometric.com/user-guides/certify/time-series-data-upload#upload-process-overview),
[Post File Upload](https://docs.isometric.com/api-reference/certify/post-file-upload),
[Post Data Upload Submission](https://docs.isometric.com/api-reference/certify/post-data-upload-submission),
[Get Data Upload Submission](https://docs.isometric.com/api-reference/certify/get-data-upload-submission)

The file-upload request is strictly Parquet
(`application/vnd.apache.parquet`) and has a 100,000,000-byte maximum. Required
columns are aggregation-period start/end, sensor reference, min, max, mean,
median, count, sample standard deviation, first timestamp, and last timestamp;
extra columns are ignored.
[Post File Upload](https://docs.isometric.com/api-reference/certify/post-file-upload),
[Parquet structure](https://docs.isometric.com/user-guides/certify/time-series-data-upload#parquet-file-structure)

Preserve the unchanged raw readings separately. An aggregated Parquet upload
does not by itself prove compliance with the protocol's requirement that
one-minute pressure records and raw data be available on request.
[Biochar Protocol v1.1, pyrolysis gas loss](https://registry.isometric.com/protocol/biochar/1.1#pyrolysis-gas-loss),
[Parquet structure](https://docs.isometric.com/user-guides/certify/time-series-data-upload#parquet-file-structure)

### Official-documentation conflict to resolve before calling this production-ready

The current time-series guide says near its introduction that time-series data
can “currently” be associated only with DAC facilities/storage locations, but
the same page publishes a Biochar Pyrolysis Reactor property table and the live
OpenAPI accepts `biochar_pyrolysis_reactor_facility_time_series`. Treat Biochar
time-series as an available-but-needing-confirmation surface until an end-to-end
sandbox submission completes and the Isometric Registry Operations Manager
confirms this is the intended monitoring channel for this v1.1 project.
[Time-series guide](https://docs.isometric.com/user-guides/certify/time-series-data-upload),
[Live `DataUploadSubmissionType`](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

## 5. Minimum delivery slices

### Repository fit: reuse what already exists

The local model already contains most of the persistence seams this work needs:

- `certifier_projects.externalFacilityId` is the canonical manual facility
  mapping. Keep the ID there; do not hard-code `fcl_...` in application code or
  environment variables.
- `credit_batches` already carries the intended Production Batch identity:
  facility, one feedstock type, one production-process epoch, a bounded window,
  and exclusive production-run membership.
- `feedstock_types.isometricFeedstockTypeId` already supplies the remote
  `feedstock_type_ids` entry. A missing link is a hard production-batch blocker.
- `certification_submissions` already provides provider-aware external IDs,
  immutable payload snapshots/hashes, versions, and submission state. Reuse it
  for the 1:1 mapping with `submissionType: "production_batch"`,
  `localEntityType: "creditBatch"`, and `externalId: ptb_...`; do not add a
  production-batch ID column to `credit_batches`.
- `certifier_sensors` already maps a local reactor/property to the stable remote
  Sensor ID and reference. The current sensor reconciliation design is suitable
  for the later time-series slice.
- The measurement-sample transformer already accepts an optional
  `productionBatchId`, but the current removal-scoped durability builder does
  not supply one. Production-batch creation must precede that path before the
  resulting measurement can appear under the facility's Production batch
  samples.

The important runtime gap is telemetry ingestion. The existing submission
orchestrator can create sensors, aggregate readings, write Parquet, upload it,
and poll the data-upload submission, but the normal production-run document
flow currently retains an uploaded CSV without populating the canonical
row-level readings consumed by that orchestrator. Do not expose the dormant
submission action until either the CSV is parsed and validated into
`production_run_readings`, or a direct validated CSV-to-Parquet adapter is
built. In both cases the original raw file must remain evidence.

Relevant local seams:
[`certification.ts`](../../src/db/schema/certification.ts),
[`credits.ts`](../../src/db/schema/credits.ts),
[`feedstock.ts`](../../src/db/schema/feedstock.ts),
[`submit-telemetry.ts`](../../src/fn/certification/submit-telemetry.ts),
[`measurement-sample.ts`](../../src/lib/isometric/transformers/measurement-sample.ts),
and [`integration-plan.md`](./integration-plan.md).

Having one facility simplifies operator interaction, not the data model: the
UI may omit a facility selector once the mapping is verified, but every server
operation must still resolve and authorize the organization/facility mapping
before using the external ID.

### Slice 0: one-time external setup

- Confirm in Certify that `fcl_1KST05ZW3SBXZCM7` is the single intended
  production line under `prj_1K9YJ33RKSBX9FFF`.
- Decide how to handle the second facility shown in the screenshot; do not
  delete it until its dependent data is checked in the UI.
- Persist and lock the project/facility/environment mapping.
- Ask Isometric for the production-batch `mass` basis and the expected remote
  representation of the >=3 independent batch replicates.

### Slice 1: production batches (highest priority)

- Add a typed API wrapper for list/create/get/delete without exposing delete to
  normal automatic sync.
- Create only from a final, valid credit batch.
- Map exactly one local credit batch to one remote `ptb_...`.
- Reconcile by complete paginated supplier-reference scan before retrying POST.
- Persist the remote ID and payload hash.

### Slice 2: production-batch samples (highest certification value)

- Require Slice 1's remote production-batch ID.
- Drive properties/units from the live sequestration blueprint plus the pinned
  protocol requirements.
- Preserve local replicate grain and source evidence.
- Capture every returned datapoint ID and bind the lab-report Source.
- Use versioned supplier references and fail closed on corrections or unknown
  measurement-property/unit mappings.
- Keep 200-year and Method B production writes disabled until their wire
  contracts are confirmed; do not broaden the existing sampled 1,000-year
  sandbox claim merely because the generic endpoint exists.

### Slice 3: required Pyrolysis reactor samples

Isometric's Biochar field-measurement guide calls these required, but the exact
project-specific values and cadence should come from the pinned protocol,
monitoring requirements, and Isometric agreement. Research and implement this
as a measurement-sample slice, distinct from `/sensors`.
[Field measurements](https://docs.isometric.com/user-guides/certify/field-measurements),
[measurement-sample guide](https://docs.isometric.com/user-guides/certify/measurement-samples)

### Slice 4: sensors and time-series (conditional/later)

- Confirm the Biochar time-series contract with Isometric.
- Register one sensor resource per immutable measurement-channel identity,
  reconcile by reference, and retain calibration/equipment evidence locally.
- Start with only monitoring properties the project actually requires; do not
  upload every API-supported gas/property merely because it is available.
- Retain raw readings, submit the required aggregate Parquet schema, persist the
  file/submission IDs and payload hash, and poll terminal status.

## 6. Go/no-go matrix

| Capability | Strictly needed now? | API available? | Recommendation |
|---|---:|---:|---|
| Facility CRUD/list sync | no | no | Use one manually verified external ID. |
| Facility ID mapping | yes | consumed downstream | Canonicalize `fcl_1KST05ZW3SBXZCM7` after UI confirmation. |
| Production batch sync | yes for the requested traceability | yes | Build first; 1 credit batch = 1 production batch. |
| Production-batch samples | yes for Biochar quantification | yes | Build second, after resolving replicate representation and mass/binding questions. |
| Lab report/raw QA evidence | yes for verification | Sources/datapoints available | Bind evidence to returned sample datapoints and retain the full report locally. |
| Pyrolysis reactor samples | yes according to Certify guide | yes through `measurement_samples` | Separate follow-up slice. |
| Soil samples | conditional | yes | Required for the 200+ year soil-temperature path; otherwise recommended. |
| Sensor catalogue | only when using time-series | yes | Later slice; reconcile by stable reference. |
| Biochar Parquet time-series | conditional and docs-conflicted | endpoint/enum available | Sandbox + Isometric confirmation before production claim. |
| Manufacturer/model on Sensor | no | optional | Send when known; useful for evidence but not an API gate. |
| Recommended physical/chemical properties | no generic gate | many properties supported | Retain/report where measured; do not block by default. |

## 7. Questions for Isometric

These are the smallest questions whose answers materially change the payload or
architecture:

1. What mass and mass basis does `POST /production_batches.mass` represent for
   Biochar, especially when a batch is applied across multiple reporting
   periods?
2. Should >=3 independent laboratory replicates be three MeasurementSample
   resources, repeated values in one production-batch MeasurementSample, or a
   mean/standard-deviation value backed by raw-source evidence?
3. For this project and pinned v1.1 protocol, which exact production-batch
   measurement properties and units must be uploaded to Certify for the chosen
   durability template, beyond the datapoints consumed in the sequestration
   calculation?
4. Is `biochar_pyrolysis_reactor_facility_time_series` supported for production
   submissions despite the contradictory DAC-only sentence in the user guide?
5. Should required Pyrolysis reactor monitoring be submitted as
   `measurement_type: "pyrolysis_reactor"`, as Parquet time-series, through
   Monitoring Submissions, or through a defined combination?
6. How should a supplier correct a ProductionBatch or MeasurementSample after
   it is referenced by a draft/submitted GHG entry, given that neither resource
   exposes PATCH?
7. Can Isometric expose a read-only
   `GET /projects/{project_id}/facilities` endpoint so the pasted facility ID can
   be validated before writes?

## Primary sources

- [Certify OpenAPI, live v0](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)
- [Certify API introduction](https://docs.isometric.com/api-reference/certify/certify-introduction)
- [Biochar Production and Storage Protocol v1.1](https://registry.isometric.com/protocol/biochar/1.1)
- [Biochar Storage in Agricultural Soils Module v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1)
- [Adding measurement samples](https://docs.isometric.com/user-guides/certify/measurement-samples)
- [Field measurements](https://docs.isometric.com/user-guides/certify/field-measurements)
- [Uploading time-series data](https://docs.isometric.com/user-guides/certify/time-series-data-upload)
- [Post Production Batch](https://docs.isometric.com/api-reference/certify/post-production-batch)
- [Post Measurement Samples](https://docs.isometric.com/api-reference/certify/post-measurement-samples)
- [Post Sensors](https://docs.isometric.com/api-reference/certify/post-sensors)
- [Post Data Upload Submission](https://docs.isometric.com/api-reference/certify/post-data-upload-submission)
