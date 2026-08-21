# Isometric Certify and Registry API opportunity assessment

> **Dated, non-authoritative implementation research.** Assessed on
> 2026-08-13 against Isometric's live first-party API documentation, Registry
> protocol/module pages, and the current repository. Re-check the live OpenAPI,
> API changelogs, project-specific Certify configuration, and the Registry
> project record before implementation. Noma remains pinned to
> [Biochar Production and Storage v1.1](https://registry.isometric.com/protocol/biochar/1.1)
> and
> [Biochar Storage in Agricultural Soils v1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1)
> in [`docs/isometric/versions.json`](../isometric/versions.json); this document
> does not change that pin.

## Decision summary

**Yes, but asymmetrically.** Noma should deepen its use of Certify for recurring
MRV submission and add the Registry API as a separate, primarily read-only
post-issuance control plane.

The highest-value next steps are:

1. **Use Registry Project data for an authoritative protocol-version guard.**
   Registry Project responses now expose `protocol_data.baseline_version`,
   `protocol_data.current_version`, and durability. That can replace noma's
   operator-recorded, advisory-only protocol version check with a live check
   against the project that will actually be verified.
   [Registry API changelog, 2026-07-20](https://docs.isometric.com/api-reference/registry/api-changelog),
   [GET Project](https://docs.isometric.com/api-reference/registry/project)
2. **Add read-only issuance and credit-lifecycle reconciliation.** After a GHG
   Statement is verified, Registry issuances and credit batches can connect the
   existing Certify GHG Entry IDs to issued quantities, serial numbers, buffer
   allocation, and active/split/retired/delivered state.
   [GET Issuances](https://docs.isometric.com/api-reference/registry/issuances),
   [GET Issuance Credit Batches](https://docs.isometric.com/api-reference/registry/issuance-credit-batches),
   [GET Credit Batch](https://docs.isometric.com/api-reference/registry/credit-batch)
3. **Design the next Certify traceability slice around storage locations and
   Biochar Applications.** Noma already registers Production Batches, but this
   is a modeling project rather than simple endpoint wiring: the endpoint
   requires gross/tare vehicle weights that noma does not store, and one local
   application can contain lineage from more than one credit/Production Batch
   while one remote application accepts one `production_batch_id`. Resolve
   those grains before implementation.
   [POST Biochar Application](https://docs.isometric.com/api-reference/certify/post-biochar-application)
4. **Do not build Registry delivery, retirement, or transfer writes yet.** They
   are commercial credit-ledger actions, not MRV. Add them only if noma is
   explicitly meant to operate the supplier's Registry inventory. Noma's
   current Orders and Deliveries are physical biochar logistics and must not be
   mapped to Registry credit Orders and Deliveries merely because the names
   match.

This is an incremental recommendation, not a call to rebuild the integration.
Noma already uses the core Certify workflow well; the main gaps are a missing
post-issuance loop and two high-value upstream resource families.

| Opportunity | Value | Read/write risk | Recommendation |
|---|---:|---:|---|
| Registry Project protocol/version read | High | Low | **Now** |
| Registry issuance and credit-batch reconciliation | High | Low | **Before first issuance** |
| Certify storage locations + Biochar Applications | High | Medium/high | **Model and confirm with Isometric next** |
| Certify project/statement Component authoring | Medium | Medium | **Conditional on noma owning the inputs** |
| Certify monitoring/time-series submission | Unclear | High | **Defer** |
| Registry deliveries/transfers/retirements | Outside current MRV scope | High | **Do not build yet** |

## Product boundary: Certify is not Registry

| Surface | Isometric's role | Noma's appropriate use |
|---|---|---|
| **Certify API** (`/mrv/v0`) | Submit supplier data and evidence for verification: Sources, Datapoints, Components, GHG Entries, GHG Statements, production/measurement resources, and selected monitoring resources. Isometric describes the product split as “submit data for verification.” [API introduction](https://docs.isometric.com/api-reference/introduction), [Certify introduction](https://docs.isometric.com/api-reference/certify/certify-introduction) | One-way, auditable export of noma's operational MRV facts; reconcile remote IDs and verifier-facing status back into noma. |
| **Registry API** (`/registry/v0`) | Query public projects, issuances, credit batches, deliveries, retirements and transfers; account-scoped supplier/buyer actions include delivery, transfer and retirement. Isometric describes the product split as “query, deliver and retire credits.” [API introduction](https://docs.isometric.com/api-reference/introduction), [Registry introduction](https://docs.isometric.com/api-reference/registry/registry-introduction) | Read authoritative project/issuance/credit lifecycle data. Add writes only if noma becomes the operational system for Registry credit inventory. |
| **Registry protocol/module pages** | Authoritative certification rules and versioned methodology content. The project's current protocol minor determines ongoing operations, verification and issuance. [Protocol versioning](https://docs.isometric.com/user-guides/registry/protocol-versioning) | Continue pinning and interpreting the relevant protocol/module set locally. Do not infer rules from API request schemas or automatically adopt the latest published protocol. |

The APIs do not automate the entire certification lifecycle. The Certify API
assumes a project and its templates exist; its public surface has no project
creation or LCA-builder write path, and feedstock types are created through the
Certify UI. It is best understood as recurring MRV/reporting automation after
project setup, not as a substitute for Certify, the Registry Operations
Manager, or the verifier.
[Certify introduction](https://docs.isometric.com/api-reference/certify/certify-introduction),
[GET Feedstock Types](https://docs.isometric.com/api-reference/certify/get-feedstock-types)

## Current noma position

### What is already strong

Current code already implements most of the recurring Certify path:

- organization-specific encrypted credentials and an `/mrv/v0` client with
  timeouts, cursor pagination, 429/transient retry handling for safe methods,
  and no unsafe automatic POST retry (`src/lib/isometric/client.ts`);
- project, GHG Entry template, Component blueprint, and feedstock-type reads
  (`src/lib/isometric/projects.ts`, `src/lib/isometric/feedstock-types.ts`);
- deterministic Source upload/reconciliation, exact Source-to-Datapoint
  binding, Datapoint creation, GHG Entry creation/reconciliation, and
  post-submit binding verification;
- GHG Statement discovery, draft adoption/creation, membership reconciliation,
  report preparation, submit/resubmit, and remote-status refresh;
- risk-of-reversal, supplier allocation, buffer-pool allocation, and pending
  recalculation values already surfaced from Certify responses;
- Production Batch registration before measurement-sample submission, with a
  stable supplier reference, a local idempotency journal, payload hashing, and
  remote reconciliation (`src/fn/certification/production-batches.ts`,
  `src/db/schema/certifier-production-batches.ts`);
- a server-side sensor/Parquet/Data Upload Submission path, though it has no
  mounted operator entry point and its project-specific certification role is
  not yet confirmed.

This makes “use the Certify API better” a question of filling carefully chosen
resource gaps, not adding another general submission abstraction.

### Material blind spots

1. **Protocol version is still manually recorded.**
   `src/fn/certification/protocol-version-preflight.ts` explicitly treats the
   project protocol check as advisory because Certify does not return it. The
   local mapping field can therefore be stale at the exact point it is used to
   judge submission compatibility.
2. **No Registry client or generated Registry type surface exists.** A current
   source search finds no `/registry/v0` calls. Noma stops at Certify status and
   does not reconcile an accepted statement to the Registry issuance or
   issued credit batches.
3. **Storage locations and Biochar Applications are not wired.** Noma has
   application/customer-location/evidence lineage and linked Production
   Batches, but it lacks the endpoint's individual arrival/departure truck
   weights and a settled mapping when one application draws from multiple
   credit batches.
4. **Project/GHG Statement Components are read but not authored.** This is
   consistent with the current ADR decision that Isometric owns PROJECT-scope
   emissions. It is an intentional boundary unless noma becomes the source of
   those recurring emissions.
5. **The evergreen OpenAPI index is stale for Production Batches.**
   [`docs/isometric/openapi-index.md`](../isometric/openapi-index.md) still calls
   that family unwired, while current code registers Production Batches in the
   Removal submission path. Refresh that index separately; this dated report
   does not edit it.

## Recommended opportunities

### 1. Registry-backed project and protocol guard — do now

**Value: high. Effort: low to medium. Risk: low if read-only.**

`GET /registry/v0/projects/{id}` returns the same `prj_…` identity plus the
project's baseline/current protocol minor versions, verifier, durability,
crediting period, location, and issued/retired totals.
[GET Project](https://docs.isometric.com/api-reference/registry/project)

The distinction between baseline and current is load-bearing: the baseline is
the initially validated minor version for the crediting period, while the
current version governs ongoing operations, verification, and issuance.
[Protocol versioning: Project Protocol versions](https://docs.isometric.com/user-guides/registry/protocol-versioning#project-protocol-versions)

Recommended behavior:

- introduce a separate generated Registry client and base URL rather than
  teaching the Certify client that `/mrv/v0` and `/registry/v0` are one API;
- on project mapping validation and again before a registry write, fetch the
  Registry Project and compare `protocol_data.current_version` with
  `docs/isometric/versions.json`;
- store the observation time and values in the sync/audit trail;
- fail closed or require explicit administrative acknowledgement on mismatch;
- never auto-change the local protocol pin. A protocol adoption is a governed
  project decision, not a cache refresh.

This directly closes the uncertainty recorded in `versions.json` without
scraping the Certify UI.

### 2. Issuance and credit-batch reconciliation — do before first issuance

**Value: high once verification begins. Effort: medium. Risk: low if
read-only.**

Registry issuances expose project, supplier, issuance date, reporting-period
dates, supplier credit total, and buffer-pool total. Issuance credit batches
and individual credit-batch reads expose the Registry batch ID, the associated
Certify entry as `removal_id`, serial number, sequestered date, quantity,
owner/beneficiary, delivery and retirement links, carbon-removal breakdown,
and `active | split | retired` status.
[GET Issuances](https://docs.isometric.com/api-reference/registry/issuances),
[GET Issuance Credit Batches](https://docs.isometric.com/api-reference/registry/issuance-credit-batches),
[GET Credit Batch](https://docs.isometric.com/api-reference/registry/credit-batch)

The entry ID is the key seam: noma already persists the Certify `ghg_entry` ID
for each local Removal, while the Registry credit-batch response currently
returns that same `rmv_...` identity in its legacy-named `removal_id` field.
Issued Registry credit batches can therefore be joined back without inventing
a fuzzy project/date mapping.

Recommended first slice:

1. Resolve and store the authenticated supplier identity with
   `GET /registry/v0/supplier`.
   [GET Current Supplier](https://docs.isometric.com/api-reference/registry/current-supplier)
2. After a GHG Statement becomes verified/accepted, poll the supplier/project
   issuance list and match by project and reporting period.
3. Read the issuance's credit batches and map each `removal_id` to the local
   Removal's Certify GHG Entry ID.
4. Persist a provider-owned mirror of the issuance ID, credit-batch ID, serial,
   issued quantity, supplier/buffer totals, lifecycle status, and last observed
   time. Keep operational mass/accounting source facts in noma; treat the
   Registry as authority for issued-credit state.
5. Show a small “issued credits” panel and a reconciliation warning when an
   accepted statement has no matching issuance or a Registry credit batch
   cannot be mapped to a known GHG Entry.

No webhook/event-subscription surface appears in Isometric's complete
documentation index, so this should be a bounded manual refresh plus low-rate
polling job, not an assumed event-driven integration.
[Isometric documentation index](https://docs.isometric.com/llms.txt)

### 3. Storage-location and Biochar-Application model — investigate next

**Value: high for traceability and verifier review. Effort: medium to high.
Risk: medium because storage APIs are beta.**

The Biochar Application request can carry:

- the application date;
- linked `production_batch_id` and project;
- a storage-site ID;
- arrival/departure truck masses and average application rate;
- a stable supplier reference; and
- Source IDs for the supporting evidence.

[POST Biochar Application](https://docs.isometric.com/api-reference/certify/post-biochar-application)

Noma now has Production Batch registration and owns the application,
customer-location, applied mass, derivable rate and evidence lineage. Creating
the remote application record would reduce the semantic gap between the local
chain of custody and what Isometric/verifiers can inspect. It also provides a
natural home for application-boundary evidence that should remain attached to
the physical application rather than only to a compiled calculation input.

Two local-model gaps make this more than an HTTP wrapper:

- the endpoint asks for separate truck mass on arrival and departure; noma
  stores delivered/applied mass but not those gross and tare observations; and
- the endpoint accepts one `production_batch_id`, while one local application
  can inherit biochar from multiple credit batches through its product and
  delivery lineage. Noma must decide whether to split one physical application
  into one remote record per contributing Production Batch (with allocated
  masses/rate/evidence), or whether Isometric expects a different grain.

The dependency is important: Certify storage locations can be created and
listed with supplier reference, coordinates, description and storage method,
but the endpoint is explicitly beta and requires opt-in.
[POST Storage Location](https://docs.isometric.com/api-reference/certify/post-storage-location),
[GET Storage Locations](https://docs.isometric.com/api-reference/certify/get-storage-locations)

Before implementation, obtain written confirmation from Isometric that:

- this Biochar v1.1 project is enabled for the storage-location and
  application endpoints in sandbox and production;
- one customer application location should map to one `slc_…` storage
  location, including repeated applications at the same coordinates;
- the expected wet/dry basis and units for the two truck masses and application
  rate, and whether new gross/tare observations are required;
- how to represent one application whose material comes from multiple
  Production Batches; and
- application Sources and later GHG Entry inputs should both reference the
  same evidence, rather than duplicate or replace one another.

Build this with the same stable supplier-reference, claim-before-POST,
reconcile-after-uncertain-outcome, and immutable snapshot pattern used for
Production Batches. The list endpoints' limited filters and `v0` status make a
local journal essential.

### 4. Project and reporting-period Components — conditional

**Value: potentially medium. Effort: medium. Risk: medium.**

Certify can create a GHG Statement Component that is evenly attributed to the
statement's GHG Entries, and a Project Component that is allocated to future
statements according to a selected strategy.
[POST GHG Statement Component](https://docs.isometric.com/api-reference/certify/post-ghg-statement-component),
[POST Project Component](https://docs.isometric.com/api-reference/certify/post-project-component)

This is useful only if noma becomes the authoritative source for a recurring
period/project emission. Current architecture deliberately keeps staff travel,
establishment/end-of-life emissions, and other PROJECT-scope values in
Isometric. Automating writes without first restoring a local domain model would
create a second incomplete editor and weaken the current ownership boundary.

Recommendation: keep reading these Components for coverage/drift checks. Add
authoring only for a named, recurring value whose source, cadence, evidence,
allocation strategy, correction semantics, and owner have all been agreed.

### 5. Monitoring submissions and telemetry — defer pending Isometric guidance

**Value: uncertain for the pinned agricultural-soil project. Effort: already
partly spent. Risk: high if assumed to be certification-complete.**

Monitoring Submissions associate a Source and validity period with a generated
project monitoring requirement, but the endpoint is opt-in beta.
[POST Monitoring Submission](https://docs.isometric.com/api-reference/certify/post-monitoring-submission)
The current storage-monitoring guide lists configured monitoring submissions
for salt cavern, subsurface biomass, and permeable-reservoir storage modules,
not Biochar Storage in Agricultural Soils.
[Storage monitoring](https://docs.isometric.com/user-guides/certify/storage-monitoring)

Noma's time-series upload pipeline should therefore stay dark until Isometric
confirms which Biochar v1.1 requirements it satisfies, the accepted reactor
properties/cadence, and whether the canonical route is Data Upload Submission,
Measurement Sample, Monitoring Submission, or a combination. API acceptance is
not evidence of protocol compliance.

### 6. Registry commercial actions — later, behind an explicit product decision

**Value: low for current MRV scope; potentially high for future commercial
operations. Risk: high.**

Supplier accounts can read Registry orders/credit inventory and create a
Delivery by allocating specified issued credit batches and quantities to an
existing Registry order.
[POST Create Delivery](https://docs.isometric.com/api-reference/registry/create-delivery)
Buyer accounts can retire or transfer owned credits.
[POST Create Retirement](https://docs.isometric.com/api-reference/registry/create-retirement),
[POST Create Transfer](https://docs.isometric.com/api-reference/registry/create-transfer)

Do not map these onto `orders` and `deliveries` in noma's logistics schema.
Those rows describe customers receiving physical biochar; Registry orders and
deliveries describe ownership/allocation of issued carbon credits. If the
business later wants noma to execute credit fulfillment, introduce a separate
credit-inventory domain with explicit operator review, authorization,
idempotency/reconciliation, and immutable audit records.

The Registry API does not expose an issuance-create action. Verification and
issuance remain Isometric-owned; noma can observe the outcome but should not
model issuance as one of its own write workflows.
[Registry API introduction](https://docs.isometric.com/api-reference/registry/registry-introduction)

## API maturity and operating constraints

| Constraint | Consequence for noma |
|---|---|
| Both APIs are currently rooted at `v0`. Isometric promises non-breaking compatibility only for versions **higher than** `v0`; it may add endpoints, optional parameters and response properties without treating them as breaking. [API standards](https://docs.isometric.com/api-reference/standards) | Generate separate types from both official OpenAPI specs, parse responses tolerantly, contract-test critical fields, and monitor both changelogs. Do not assume `v0` stability. |
| New integrations must use `ghg_entry*`; `removal*` is a deprecated alias scheduled for removal after the transition ending in September 2026. [Certify introduction](https://docs.isometric.com/api-reference/certify/certify-introduction), [Certify API changelog](https://docs.isometric.com/api-reference/certify/api-changelog) | Current application code already uses `ghg_entry*`; keep tests/types free of the alias after the published sunset. |
| Every call needs `X-Client-Secret`; organization actions also use an organization-scoped bearer JWT. Tokens expire after one year; client secrets are environment-specific and do not expire. [Authentication](https://docs.isometric.com/api-reference/authentication) | Reuse the encrypted per-organization credential store only after probing that the supplier organization is authorized for Registry as well as Certify. Add credential-expiry health and rotation reminders; never log headers. |
| Production and sandbox have separate accounts, data and credentials. [API introduction: Environments](https://docs.isometric.com/api-reference/introduction#environments) | Persist environment with every external identity. Never carry `prj_`, `slc_`, `iss_`, or `ctb_` IDs from sandbox into production. |
| Isometric publishes no SDKs but supplies Certify and Registry OpenAPI JSON. [API introduction](https://docs.isometric.com/api-reference/introduction) | Keep generated Certify and Registry surfaces in separate files and include both in the existing OpenAPI-drift workflow. |
| Relay-style cursor pagination defaults to 10 and caps at 50. A conservative request rate is about 120/minute, with exponential backoff on 429. [API standards](https://docs.isometric.com/api-reference/standards), [API introduction: Rate limits](https://docs.isometric.com/api-reference/introduction#rate-limits) | Page boundedly, cache read observations, avoid full-list scans in interactive flows, and extend the current safe retry/backoff client behavior to Registry reads. |
| Certify API reads expose only the latest resource state; previous versions are available through the UI, not the API. Calculation-affecting PATCHes require GHG Statement resubmission. [Modifying resources](https://docs.isometric.com/user-guides/certify/modifying-resources) | Preserve noma's local immutable payload snapshots and superseding-version audit. Do not replace that journal with PATCH-heavy mirroring or destructive deletes. |
| Submitted/issued resource visibility expands to the verifier and then the public Registry; Source filenames remain visible even for non-public files. [Certify key concepts](https://docs.isometric.com/user-guides/certify/key-certify-concepts), [Data visibility](https://docs.isometric.com/user-guides/certify/data-visibility) | Keep the existing explicit Source-visibility policy and review filenames/descriptions for confidential or personal information before submission. |

## Suggested delivery sequence

### Phase 0 — confirm access and contracts

- Ask Isometric to confirm Registry API access for the current supplier token
  and whether the same organization credentials cover both services.
- Ask for sandbox/production opt-in status and the four application/storage
  decisions listed above.
- Refresh the Certify OpenAPI index to reflect the already-implemented
  Production Batch path.

### Phase 1 — read-only Registry foundation

- Generate `registry.d.ts` from the official Registry OpenAPI alongside the
  current Certify type surface.
- Add a Registry client sharing credential loading, redacted logging,
  timeouts, pagination and safe retry policy, but with its own base URL.
- Implement `GET current supplier` and `GET project` health/mapping checks.
- Upgrade protocol preflight from operator-recorded advisory to authoritative
  Registry comparison while retaining the local governed pin.

### Phase 2 — close the issuance loop

- Add issuance/credit-batch mirror tables or a provider-owned equivalent,
  organization scoped and keyed by Registry IDs.
- Add manual refresh plus low-frequency polling after statement acceptance.
- Reconcile credit batches by `removal_id`, surface issued/supplier/buffer
  quantities and lifecycle status, and alert on unmapped state.

### Phase 3 — richer Certify traceability

- After Isometric opt-in/contract confirmation, settle the application-to-
  Production-Batch grain and add any required gross/tare observations.
- Implement storage-location mapping/reconciliation, then submit Biochar
  Applications with exact Source IDs and Production Batch links.
- Keep the feature sandbox-gated until field bases, correction behavior and
  downstream GHG Entry association are proven.

### Phase 4 — optional commercial Registry product

- Only after an explicit product decision, design a separate credit-order,
  inventory and fulfillment domain.
- Start read-only; add Registry Delivery writes last. Retirement/transfer
  belong to buyer-account workflows and are outside the current supplier MRV
  scope.

## Final recommendation

The best use of Isometric's APIs is not “more endpoints” in general. It is a
closed, authority-aware lifecycle:

```text
noma operational facts
  -> Certify Production Batches / Sources / Datapoints / GHG Entries
  -> Certify GHG Statement and verification
  -> Registry Issuance and issued Credit Batches
  -> read-only reconciliation back to noma
```

The immediate return comes from the two read-only Registry additions because
they remove a real protocol-version uncertainty and close the post-verification
blind spot at relatively low risk. The next Certify design investment should be
the Biochar Application grain and missing weight observations, not generic
telemetry or commercial credit delivery, because it aligns most directly with
noma's existing traceability and evidence model. Registry mutations should
remain out of scope until the business asks noma to operate credit inventory
rather than only MRV and certification.
