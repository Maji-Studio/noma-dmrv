# Isometric OpenAPI Index

> **Non-authoritative.** Pulled from the Isometric MCP
> (`openapi_documents_list_objects`) on **2026-05-19**. Both APIs are
> pinned to `v0` per [`versions.json`](./versions.json). Re-pull before
> relying on any row — see [How to refresh](#how-to-refresh).

Annotated index of every operation, schema, server, and security scheme
exposed by Isometric's two public APIs (`certify` / `registry`),
cross-referenced with what `noma-dmrv` actually uses today.

## Status legend

| Symbol | Meaning |
|---|---|
| ✅ | Wired up in noma — call site cited in the Notes column |
| 🟡 | Partially wired or scoped to an active phase |
| ⬜ | Not used yet — candidate for a future phase |
| 🚫 | Deliberately out of scope (reason in Notes) |

Current totals (2026-05-19 pull): **Certify** = 78 operations, **Registry** = 34 operations.
Wired up in noma today: **11 Certify** operations, **0 Registry** operations.

---

## Certify API (`/mrv/v0`)

Title: *Isometric Certify Data Ingestion API* · Version: `v0`

### Operations

#### Organisation

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/organisation` | ⬜ | Not called directly; `client.ts` reads `ISOMETRIC_ORG_ID` from env |

#### Projects, removal templates, monitoring, storage locations

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/projects` | ✅ | `src/lib/isometric/projects.ts:10` |
| GET | `/projects/{id}/monitoring_requirements` | ⬜ | Phase 5 |
| GET | `/projects/{project_id}/monitoring_requirements/{requirement_id}` | ⬜ | Phase 5 |
| GET | `/projects/{project_id}/monitoring_requirements/{id}/submissions` | ⬜ | Phase 5 |
| POST | `/projects/{project_id}/monitoring_requirements/{id}/submissions` | ⬜ | Phase 5 (time-series MonitoringSubmission) |
| DELETE | `/projects/{project_id}/monitoring_requirements/{monitoring_requirement_id}/submissions/{id}` | ⬜ | Phase 5 |
| GET | `/projects/{project_id}/removal_templates` | ✅ | `projects.ts:17` |
| GET | `/projects/{project_id}/removal_templates/{id}` | ⬜ | Indirectly via the list call above; not yet needed |
| GET | `/projects/{project_id}/storage_locations` | ⬜ | Phase 5 (soil-storage module) |
| POST | `/projects/{project_id}/storage_locations` | ⬜ | Phase 5 |
| GET | `/projects/{project_id}/storage_locations/{id}` | ⬜ | Phase 5 |
| PATCH | `/projects/{project_id}/storage_locations/{id}` | ⬜ | Phase 5 |
| DELETE | `/projects/{project_id}/storage_locations/{id}` | ⬜ | Phase 5 |
| GET | `/projects/{project_id}/storage_locations/{id}/monitoring_requirements` | ⬜ | Phase 5 |

#### Component blueprints, components, project components

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/component_blueprints` | ✅ | `projects.ts:22` |
| GET | `/component_blueprints/{key}` | ⬜ | Bulk list above covers current needs |
| GET | `/components` | ⬜ | — |
| POST | `/components` | ✅ | `src/lib/isometric/submissions.ts:39` |
| GET | `/components/{id}` | ⬜ | — |
| PATCH | `/components/{id}` | ⬜ | Phase 4 supersede path (deferred) |
| DELETE | `/components/{id}` | ⬜ | — |
| POST | `/project_components` | ⬜ | Phase 4 |
| POST | `/project_components/{id}/removal_attributions` | ⬜ | Phase 4 |
| DELETE | `/project_components/{component_id}/removal_attributions/{removal_id}` | ⬜ | Phase 4 |
| POST | `/ghg_statement_components` | ⬜ | Phase 4 |

#### Datapoints

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/datapoints` | ✅ | `submissions.ts:66` (filtered by `supplier_reference_id`) |
| POST | `/datapoints` | ✅ | `submissions.ts:21` |
| GET | `/datapoints/{id}` | ⬜ | — |
| PATCH | `/datapoints/{id}` | ✅ | `submissions.ts:28` |
| DELETE | `/datapoints/{id}` | ⬜ | — |
| GET | `/datapoints/{id}/components` | ⬜ | — |
| GET | `/datapoints/{id}/removal_template_components` | ⬜ | Useful for template introspection; not yet needed |

#### Removals

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/removals` | ✅ | `submissions.ts:60` (filtered by `supplier_reference_id`) |
| POST | `/removals` | ✅ | `submissions.ts:32` |
| GET | `/removals/{id}` | ⬜ | — |
| PATCH | `/removals/{id}` | ⬜ | Phase 4 supersede branch (deferred) |
| DELETE | `/removals/{id}` | ⬜ | — |
| GET | `/removals/{id}/component_attributions` | ⬜ | — |
| PATCH | `/removals/{id}/component_attributions` | ⬜ | Phase 4 |

#### GHG statements

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/ghg_statements` | ✅ | `src/lib/isometric/ghg-statements.ts:43` (supplier-ref lookup) |
| POST | `/ghg_statements` | ✅ | `ghg-statements.ts:17` |
| GET | `/ghg_statements/{id}` | ✅ | `ghg-statements.ts:21` |
| POST | `/ghg_statements/{id}/submit` | ✅ | `ghg-statements.ts:28` / `:35` |

#### Sources & file uploads

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/sources` | ⬜ | Phase 3.5 |
| POST | `/sources` | 🟡 | Phase 3.5 — blocked on documents subsystem S3 backend (`open-questions.md` `isometric/phase-3.5`) |
| GET | `/sources/{id}` | ⬜ | Phase 3.5 |
| PATCH | `/sources/{id}` | ⬜ | Phase 3.5 |
| DELETE | `/sources/{id}` | ⬜ | Phase 3.5 |
| GET | `/sources/{id}/private_url` | ⬜ | Phase 3.5 |
| POST | `/sources/{id}/signed_upload_url` | 🟡 | Phase 3.5 — paired with `POST /sources` |
| POST | `/file-uploads` | ⬜ | Phase 5 |

#### Feedstock & production batches

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/feedstock_types` | ⬜ | Phase 5 (verifier visibility for noma's feedstock catalog) |
| GET | `/feedstock_types/{id}` | ⬜ | Phase 5 |
| PATCH | `/feedstock_types/{id}` | ⬜ | Phase 5 |
| DELETE | `/feedstock_types/{id}` | ⬜ | Phase 5 |
| GET | `/feedstock_types/{feedstock_type_id}/feedstock_batches` | ⬜ | Phase 5 |
| POST | `/feedstock_batches` | ⬜ | Phase 5 |
| GET | `/feedstock_batches/{id}` | ⬜ | Phase 5 |
| DELETE | `/feedstock_batches/{id}` | ⬜ | Phase 5 |
| GET | `/production_batches` | ⬜ | Phase 5 |
| POST | `/production_batches` | ⬜ | Phase 5 |
| GET | `/production_batches/{id}` | ⬜ | Phase 5 |
| DELETE | `/production_batches/{id}` | ⬜ | Phase 5 |

#### Biochar applications

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/biochar_applications` | ⬜ | Phase 5 |
| POST | `/biochar_applications` | ⬜ | Phase 5 (per `integration-plan.md` §Phase 5) |
| GET | `/biochar_applications/{id}` | ⬜ | Phase 5 |
| DELETE | `/biochar_applications/{id}` | ⬜ | Phase 5 |

#### Measurement, sensors, storage units

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/measurement_locations` | ⬜ | Phase 5 |
| POST | `/measurement_locations` | ⬜ | Phase 5 |
| GET | `/measurement_locations/{id}` | ⬜ | Phase 5 |
| DELETE | `/measurement_locations/{id}` | ⬜ | Phase 5 |
| GET | `/measurement_samples` | ⬜ | Phase 5 |
| POST | `/measurement_samples` | ⬜ | Phase 5 |
| GET | `/sensors` | ⬜ | Phase 5 |
| POST | `/sensors` | ⬜ | Phase 5 |
| GET | `/sensors/{id}` | ⬜ | Phase 5 |
| GET | `/storage_units` | ⬜ | Phase 5 |
| POST | `/storage_units` | ⬜ | Phase 5 |
| GET | `/storage_units/{id}` | ⬜ | Phase 5 |

#### Data upload submissions

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/data-upload-submissions` | ⬜ | Phase 5 (bulk path) |
| POST | `/data-upload-submissions` | ⬜ | Phase 5 |
| GET | `/data-upload-submissions/{id}` | ⬜ | Phase 5 |

#### Deprecated

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/processes` | 🚫 | Deprecated by Isometric; use `GET /projects/{id}/removal_templates` instead |

### Schemas

<details>
<summary>Certify schemas (~150 total) — grouped by domain</summary>

- **Removals / templates** — `Removal`, `RemovalTemplate`, `RemovalTemplateComponent`, `RemovalTemplateComponentGroup`, `RemovalTemplateComponentInput`, `RemovalTemplateComponentInputs`, `CreateRemovalRequest`, `CreateRemovalStep`, `CreateRemovalComponentLink`, `PatchRemovalRequest`, `PatchRemovalComponentAttributionsRequest`, `PaginatedListResource_Removal_`, `PaginatedListResource_RemovalTemplate_`, `PaginatedListResource_RemovalTemplateComponent_`. *Used by `transformers/removal.ts` + `submissions.ts`.*
- **Datapoints** — `Datapoint`, `DatapointType`, `DatapointQuantityInput`, `DatapointLockedStatus`, `CreateDatapointRequest`, `PatchDatapointRequest`, `PaginatedListResource_Datapoint_`. *Used by `transformers/datapoint.ts` + `submissions.ts`.*
- **Components** — `Component`, `ComponentAttribution`, `ComponentBlueprint`, `ComponentBlueprintExpression`, `ComponentBlueprintExpressionInput`, `ComponentBlueprintExpressionInputType`, `ComponentBlueprintInput`, `ComponentInputType`, `ComponentListInput`, `ComponentScalarInput`, `ComponentScope`, `ComponentToAttribute`, `ComponentType`, `AddComponentToRemoval`, `CreateComponentRequest`, `CreateComponentListInput`, `CreateComponentScalarInput`, `CreateRemovalComponentLink`, `PatchComponentRequest`, `PaginatedListResource_Component_`, `PaginatedListResource_ComponentAttribution_`, `PaginatedListResource_ComponentBlueprint_`. *Used by `transformers/removal.ts`.*
- **GHG statements** — `GhgStatement`, `GhgStatementStatus`, `CreateGhgStatementRequest`, `CreateGhgStatementComponentRequest`, `ResubmitGhgStatementRequest`, `SubmitGhgStatementRequest`, `PaginatedListResource_GhgStatement_`. *Used by `ghg-statements.ts`.*
- **Sources** — `Source`, `SourceType`, `SourcePrivateUrlInfo`, `SourcePublicUrlInfo`, `CreateDocumentSourceRequest`, `CreateSourceResponse`, `PatchSourceRequest`, `SignedUploadUrlRequest`, `PaginatedListResource_Source_`. *Phase 3.5.*
- **Project / monitoring / storage locations** — `Project`, `Process`, `ProcessStep`, `MonitoringPhase`, `MonitoringSubmission`, `ProjectMonitoringRequirement`, `CreateMonitoringSubmissionRequest`, `StorageLocation`, `StorageMethod`, `CreateStorageLocationRequest`, `PatchStorageLocationRequest`, `PaginatedListResource_Process_`, `PaginatedListResource_Project_`, `PaginatedListResource_ProjectMonitoringRequirement_`, `PaginatedListResource_MonitoringSubmission_`, `PaginatedListResource_StorageLocation_`. *Partially used (project/template list); rest is Phase 5.*
- **Feedstock & production batches** — `FeedstockType`, `FeedstockBatch`, `CreateFeedstockBatchRequest`, `PatchFeedstockType`, `ProductionBatch`, `ProductionBatchKind`, `CreateProductionBatchRequest`, `PaginatedListResource_FeedstockType_`, `PaginatedListResource_FeedstockBatch_`, `PaginatedListResource_ProductionBatch_`. *Phase 5.*
- **Biochar applications** — `BiocharApplication`, `CreateBiocharApplicationRequest`, `PaginatedListResource_BiocharApplication_`. *Phase 5.*
- **Measurement, sensors, storage units** — `MeasurementLocation`, `MeasurementSample`, `MeasurementValue`, `MeasurementProperty`, `MeasurementTypeKey`, `CreateMeasurementLocationRequest`, `CreateMeasurementSampleRequest`, `CreateMeasurementSampleValueRequest`, `Sensor`, `CreateSensorRequest`, `StorageUnit`, `CreateStorageUnitRequest`, `Frequency`, `PaginatedListResource_MeasurementLocation_`, `PaginatedListResource_MeasurementSample_`, `PaginatedListResource_Sensor_`, `PaginatedListResource_StorageUnit_`. *Phase 5.*
- **Data upload submissions** — `DataUploadSubmission`, `DataUploadSubmissionStatus`, `DataUploadSubmissionType`, `CreateDataUploadSubmissionRequest`, `FileUpload`, `CreateFileUploadRequest`, `PaginatedListResource_DataUploadSubmission_`. *Phase 5.*
- **Project components & attribution** — `CreateProjectComponentRequest`, `UpdateProjectComponentRemovalAttributionRequest`, `ProjectComponentAmortizationStrategy`. *Phase 4.*
- **Quantity / units** — `ScalarQuantity`, `QuantityKindType`, `QuantityKindQualifierType`, `InputDataShape`. *Used throughout transformers.*
- **Organisation & misc** — `Organisation`, `RiskOfReversal`, `PageInfo`, `Undefined`.
- **Path/query/request-param wrappers** — `IsometricIDPathParam_*`, `IsometricIDQueryParam_*`, `IsometricIDRequestParam_*` (one per resource: `BiocharSpreadEvent`, `Component`, `DataUploadSubmission`, `Datapoint`, `FeedstockBatch`, `FeedstockType`, `GhgEntryTemplate`, `GhgEntry`, `GhgStatement`, `MeasurementLocation`, `MonitoringRequirement`, `MonitoringSubmission`, `ProductionBatch`, `ProjectRequirement`, `Project`, `Sensor`, `Source`, `StorageLocation`, `StorageUnit`).
- **Errors** — `HTTPValidationError`, `ValidationError`.

</details>

### Servers

| Env | URL |
|---|---|
| Sandbox | `https://api.sandbox.isometric.com/mrv/v0` |
| Production | `https://api.isometric.com/mrv/v0` |

### Security

`HTTPBearer` (declared in the OpenAPI doc). **In practice the API also
requires `X-Client-Secret` on every request** — see the embedded auth
guide in the Certify OpenAPI `info` description. `src/lib/isometric/client.ts`
sends both headers.

---

## Registry API (`/registry/v0`)

Title: *Isometric Registry API* · Version: `v0`

**Integration status: nothing wired up in noma today.** Every row below
is ⬜ unless explicitly marked 🚫. The Registry API becomes relevant when
noma needs to surface credit-batch state, deliveries, retirements, or
transfers in-app — currently those flows live on the registry UI
(`registry.isometric.com`).

### Operations

#### Identity

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/organisation` | ⬜ | Identity bootstrap |
| GET | `/supplier` | ⬜ | Identity bootstrap |

#### Suppliers & projects (read-only)

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/projects` | ⬜ | Registry-side project listing |
| GET | `/projects/{id}` | ⬜ | — |
| GET | `/projects/{id}/documents` | ⬜ | — |
| GET | `/suppliers` | ⬜ | — |
| GET | `/suppliers/{id}` | ⬜ | — |
| GET | `/suppliers/{id}/projects` | ⬜ | — |
| GET | `/suppliers/{id}/issuances` | ⬜ | — |
| GET | `/suppliers/{id}/orders` | ⬜ | — |
| GET | `/suppliers/{id}/deliveries` | ⬜ | — |

#### Organisations & balances

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/organisations/{id}` | ⬜ | — |
| GET | `/organisations/{id}/credit_balance` | ⬜ | — |
| GET | `/organisations/{id}/credit_batches` | ⬜ | — |
| GET | `/organisations/{id}/orders` | ⬜ | — |

#### Credit batches, issuances, orders, deliveries

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/credit_batches/{id}` | ⬜ | — |
| GET | `/issuances` | ⬜ | — |
| GET | `/issuances/{id}` | ⬜ | — |
| GET | `/issuances/{id}/credit_batches` | ⬜ | — |
| GET | `/orders/{id}` | ⬜ | — |
| GET | `/orders/{id}/deliveries` | ⬜ | — |
| GET | `/deliveries` | ⬜ | — |
| POST | `/deliveries` | ⬜ | Future — record real delivery against an order |
| GET | `/deliveries/{id}` | ⬜ | — |
| GET | `/deliveries/{id}/credit_batches` | ⬜ | — |

#### Retirements, transfers, refunds, beneficiaries

| Method | Path | Status | Notes |
|---|---|---|---|
| GET | `/retirements` | ⬜ | — |
| POST | `/retirements` | ⬜ | — |
| POST | `/retirements/from_oldest_credits` | ⬜ | — |
| GET | `/retirements/{id}` | ⬜ | — |
| GET | `/retirements/{id}/credit_batches` | ⬜ | — |
| GET | `/transferees` | ⬜ | — |
| GET | `/transfers` | ⬜ | — |
| POST | `/transfers` | ⬜ | — |
| GET | `/transfers/{id}` | ⬜ | — |
| GET | `/transfers/{id}/credit_batches` | ⬜ | — |
| GET | `/refunds/{id}` | ⬜ | — |
| GET | `/refunds/{id}/credit_batches` | ⬜ | — |
| GET | `/beneficiaries` | ⬜ | — |
| POST | `/beneficiary` | ⬜ | — |

#### Stripe Connect

| Method | Path | Status | Notes |
|---|---|---|---|
| POST | `/stripe/checkout` | 🚫 | noma is not a Stripe-Connect supplier — Buyer-side checkout flow |
| GET | `/stripe/configuration` | 🚫 | Same as above |

### Schemas

<details>
<summary>Registry schemas (~60 total) — grouped by domain</summary>

- **Credits** — `CreditBatch`, `CreditBatchQuantity`, `CreditBatchSortField`, `CreditBatchStatus`, `CreditQuantity`, `CreditBalance`, `ListResource_CreditBatch_`, `PaginatedListResource_CreditBatch_`.
- **Issuance / delivery / order** — `Issuance`, `IssuanceCreditBatches`, `Order`, `OrderStatus`, `OrderCreditBalance`, `Delivery`, `CreateDeliveryRequest`, `PaginatedListResource_Issuance_`, `PaginatedListResource_Order_`, `PaginatedListResource_Delivery_`.
- **Retirement / transfer / refund** — `Retirement`, `RetirementPurpose`, `CreateRetirementByBatchRequest`, `CreateRetirementOldestCreditsRequest`, `Transfer`, `CreateTransferRequest`, `BufferPoolRefund`, `PaginatedListResource_Retirement_`, `PaginatedListResource_Transfer_`.
- **Beneficiary** — `CreateIndividualBeneficiary`, `CreateOrganizationBeneficiary`.
- **Organisation / supplier / project** — `Organisation`, `OrganisationCreditBalance`, `Supplier`, `SupplierCreditBalance`, `SupplierStripeConfiguration`, `Project`, `ProjectStatus`, `ProjectCreditBalance`, `ProjectDocument`, `Pathway`, `CarbonRemovalData`, `Location`, `PaginatedListResource_Organisation_`, `PaginatedListResource_Supplier_`, `PaginatedListResource_Project_`, `PaginatedListResource_ProjectDocument_`.
- **Stripe** — `CreateStripeCheckoutSessionRequest`, `StripeCheckoutResponse`, `StripeSubscriptionFrequency`.
- **Misc** — `PageInfo`, `SortDirection`.
- **Path/query/request-param wrappers** — `IsometricIDPathParam_*`, `IsometricIDQueryParam_*`, `IsometricIDRequestParam_*` (`BufferPoolRefund`, `CreditBatch`, `Delivery`, `Issuance`, `Order`, `Organisation`, `Project`, `Retirement`, `Supplier`, `Transfer`).
- **Errors** — `HTTPValidationError`, `ValidationError`.

</details>

### Servers

| Env | URL |
|---|---|
| Sandbox | `https://api.sandbox.isometric.com/registry/v0` |
| Production | `https://api.isometric.com/registry/v0` |

### Security

Same as Certify — `HTTPBearer` plus `X-Client-Secret` on every request.

---

## What's still pending (rollup)

Cross-reference these tables against the canonical phase docs:

- **Phase 3.5** — source-upload presigned URLs (`POST /sources`,
  `POST /sources/{id}/signed_upload_url` and the rest of the
  `/sources` surface). Blocked on the documents subsystem getting a
  real S3-equivalent backend.
  See [`integration-plan.md`](./integration-plan.md) §Phase 3.5 and
  [`open-questions.md`](../open-questions.md) `isometric/phase-3.5`.
- **Phase 4** — `PATCH /removals/{id}`, `PATCH /components/{id}`,
  `POST /project_components`, `POST /ghg_statement_components`,
  component-attribution endpoints. Deferred until a production signal
  forces a supersede-vs-patch decision. See
  [`integration-plan.md`](./integration-plan.md) §Phase 4.
- **Phase 5** — time-series + bulk: monitoring submissions,
  sensors, storage units, measurement locations / samples,
  feedstock / production batch lifecycle, biochar applications,
  file uploads, data upload submissions. Not started; see
  [`integration-plan.md`](./integration-plan.md) §Phase 5 and
  [`open-questions.md`](../open-questions.md) `isometric/phase-5`.
- **Phase 6** — Protocol/SOP surfacing. Deferred indefinitely.
- **Registry API** — the whole surface is unused. Read paths
  (`/credit_batches`, `/retirements`, `/deliveries`,
  `/organisations/{id}/credit_balance`) are the obvious first
  candidates if and when we want in-app registry visibility. Stripe
  endpoints are 🚫 (Buyer-side, not noma's role).

---

## How to refresh

When Isometric ships a new API version, or quarterly during the
`update-playbook.md` refresh:

1. From an MCP-enabled session, call `openapi_documents_list_objects`
   for each `(api, object_type)` pair:
   - `api ∈ {certify, registry}`
   - `object_type ∈ {operation, schema, securityScheme, server}`
2. Diff the operation/schema lists against this file. Add/remove rows
   as needed and bump the "Last refreshed" date in the header.
3. Re-run `grep -rn -E 'isometric\.(get|post|patch|delete)\b' src/lib/isometric`
   to confirm every ✅ row still points at a real call site; update
   file:line references when code moves.
4. Cross-check the rollup against `integration-plan.md` and
   `open-questions.md` so phase pointers don't drift.

See [`update-playbook.md`](./update-playbook.md) for the broader refresh
workflow.
