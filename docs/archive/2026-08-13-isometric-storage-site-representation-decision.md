# Isometric storage-site representation decision

> **Dated, non-authoritative research.** Assessed on 2026-08-13 against
> Isometric's first-party API documentation, Registry protocol/module pages,
> the configured sandbox project, and the current noma codebase. Re-check the
> live API, project configuration, and verifier expectations before
> implementation. noma remains pinned to Biochar Production and Storage v1.1
> and Biochar Storage in Agricultural Soils v1.1 as recorded in
> [`docs/isometric/versions.json`](../isometric/versions.json).

## Decision

**Chosen direction: add Certify Storage Locations and Biochar Applications as
an additive traceability layer. Keep the existing GHG-entry `CO2 stored`
component as the authoritative carbon-accounting path.**

This choice is now settled at the resource-model level. Implementation still
has one hard gate: the public Biochar Application request cannot represent a
net/delivered mass by itself. It requires both truck mass on arrival and truck
mass on departure. noma must not invent those observations; cases with only a
net mass need a written Isometric-approved API encoding or an API change first.

Measurement Locations are **not** a prerequisite for creating a Storage
Location or Biochar Application and are explicitly out of scope for the
selected implementation. They belong to a separate field-measurement workflow
that can be reconsidered later if Isometric requires location-bound soil
samples.

Do not add an invented storage-site or “segregation” Datapoint to the current
sequestration component. The live component's blueprint accepts only the
durability and mass inputs used to calculate stored CO2. A site/application
Datapoint would either be rejected by the blueprint or require a different,
Isometric-approved component whose accounting meaning is not currently known.

The supplied Certify URL edits one specific GHG Entry and component, not the
project's reusable GHG Entry template. The live screen offers a separate
“Convert into a new template” action. Manual changes at that URL therefore
affect the current entry unless deliberately converted and adopted as a new
template.

The specialized API is the better semantic home for site identity,
coordinates, application date, application rate, vehicle weights, Production
Batch lineage, and application evidence. The domain grain is also known:
one noma credit batch maps to one Isometric Production Batch, while one noma
Removal/GHG Entry can aggregate several credit batches and therefore several
Production Batches. The remaining blocker is the weight/evidence encoding, not
the identity of the batch resource.

## Why the two options are not substitutes

The pinned storage module calculates gross stored CO2 from biochar carbon
content, dry mass applied, and durable fraction. It defines
`m_biochar` as the dry mass of biochar applied. This is the job of the
sequestration component in the GHG Entry, not of a site record.
[Biochar Storage in Agricultural Soils v1.1, section 4.1.1](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#4.1.1)

The same module separately requires proof of spreading through project-area
boundaries, coordinates, or geotagged and dated media, and says application
rate together with the project boundary must confirm total mass applied.
[Biochar Storage in Agricultural Soils v1.1, section 4.2](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1#4.2)

Isometric likewise distinguishes the resources in Certify:

- Datapoints are values used in carbon-accounting calculations; Components
  represent physical activities or fluxes and consume blueprint-defined
  Datapoint inputs. GHG Entries are built from those Components.
  [Key Certify concepts](https://docs.isometric.com/user-guides/certify/key-certify-concepts)
- `POST /projects/{project_id}/storage_locations` creates a project-owned site
  with name, coordinates, storage method, description, and optional stable
  supplier reference.
  [POST Storage Location](https://docs.isometric.com/api-reference/certify/post-storage-location)
- `POST /biochar_applications` creates an application event with date, one
  Production Batch, one storage site, average application rate, arrival and
  departure truck masses, stable supplier reference, and supporting Source
  IDs.
  [POST Biochar Application](https://docs.isometric.com/api-reference/certify/post-biochar-application)

Therefore the complete model is:

```text
Storage Location + Biochar Application
    physical site, event, lineage, and evidence

GHG Entry CO2-stored component
    carbon-content x applied dry mass x durable fraction
```

## Chosen API design: resource boundaries and implementation gates

### Storage sites are not measurement locations

The similarly named resources serve different purposes:

| Isometric concept | Meaning in this workflow | Needed for the chosen application path? |
| --- | --- | --- |
| **Storage Location** (`slc_…`) | The farm/field storage destination. It carries project ownership, site name, coordinates, and `biochar_field` storage method. | **Yes.** Its ID is sent as `storage_site_id` when creating a Biochar Application. |
| **Biochar Application** (`bse_…`) | One application event for one Production Batch at one Storage Location, with date, rate, truck weights, and Sources. | **Yes.** This is the selected application traceability record. |
| **Removal Area** | A polygon/group of fields credited together in the Field measurements UI. | **Separate/conditional.** It is useful for project geometry but is not an input to the Biochar Application POST. |
| **Measurement Location** (`mlc_…`) | A precise latitude/longitude point where a physical sample was taken, within a Removal Area in the older Field measurements workflow. | **No for applications; conditional for soil samples.** The current Storage sites workflow may link a sample directly to its Storage Location. |
| **Measurement Sample** (`mts_…`) | A dated set of measured values. `biochar_soil` is a measurement type, not a separate “soil sample” API resource. | **Conditional.** Add it only for the project's required/recommended sampling plan. |

The first-party Field measurements guide explicitly places Measurement
Locations inside Removal Areas and uses them to locate samples. Its workflow is
CSV-based: upload Measurement Locations, receive Isometric `mlc_…` IDs, then
use those IDs in the sample CSV. The API can create the same point resource
directly. However, the current sandbox project's newer Storage sites screen
has no Measurement Locations tab and its soil-sample upload links samples by
the **Storage Location supplier reference**. The current Measurement Sample
OpenAPI request supports both models: it contains separately nullable
`measurement_location_id` and `storage_location_id` fields. This appears to be
a transitional surface, so noma must not assume that every soil sample needs
an `mlc_…` resource.
[Field measurements](https://docs.isometric.com/user-guides/certify/field-measurements),
[POST Measurement Locations](https://docs.isometric.com/api-reference/certify/post-measurement-locations),
[POST Measurement Samples](https://docs.isometric.com/api-reference/certify/post-measurement-samples),
[Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

For an API implementation, keep site/event creation and field sampling as two
independent slices. Ask Isometric whether this project expects a `biochar_soil`
Measurement Sample to carry `storage_location_id`,
`measurement_location_id`, or both. Only add Measurement Location creation if
the answer requires the precise sampling point resource.

Isometric's guide says Production Batch and Pyrolysis Reactor samples are
required for all biochar projects and describes soil samples as conditional on
project durability/setup, while recommending them for all biochar projects.
Because the configured live 1000-year sequestration component has no
soil-temperature input, obtain a project-specific answer from Isometric before
making soil sampling a submission blocker. If soil samples are required, then
create/reconcile Measurement Locations and submit `biochar_soil` Measurement
Samples; otherwise do not add Measurement Locations merely to support the
application endpoint.
[Field measurements, Samples](https://docs.isometric.com/user-guides/certify/field-measurements#samples),
[Adding measurement samples](https://docs.isometric.com/user-guides/certify/measurement-samples)

### Net mass is protocol-possible by agreement but not expressible by this POST

The current public request schema makes all three quantities required:

- `average_application_rate`
- `truck_mass_on_arrival`
- `truck_mass_on_departure`

Each is a `ScalarQuantity`: `magnitude` and `unit` are required, while
`standard_deviation` is optional/nullable. There is no `net_mass`,
`transported_mass`, `delivered_mass`, or `applied_mass` alternative in the
request. A body containing only noma's transported/net mass therefore does not
satisfy the documented schema; omission is expected to fail request validation.
[POST Biochar Application](https://docs.isometric.com/api-reference/certify/post-biochar-application),
[Certify OpenAPI](https://docs.isometric.com/api-reference/certify/mrv.openapi.json)

Biochar Protocol v1.1 is more flexible about evidence than the public endpoint.
It says mass applied is measured from delivered weight using a calibrated scale
and may be calculated as arrival minus departure. Where truck scales are
unavailable, the supplier may agree with Isometric **before verification** to
provide a signed receipt, bill of lading, and/or delivery photo, and must retain
arrival/departure tickets **or equivalent records**. That allowance establishes
a protocol path for alternative proof, but it does not define how to serialize
one net mass into two mandatory API fields.
[Biochar Production and Storage v1.1, sections 8.3.1.1-8.3.1.2](https://registry.isometric.com/protocol/biochar/1.1#8.3.1.1)

Consequently:

- Do not copy the net mass into `truck_mass_on_arrival` and use zero for
  departure; that would change the meaning of two named observations.
- Do not derive an arbitrary tare weight or label an applied dry mass as a
  truck observation.
- Keep the alternative delivery records as Sources, but do not assume
  `source_ids` waive required request fields.
- Ask Isometric to provide, in writing, either the accepted gross/tare values to
  use for an agreed equivalent-record case, another supported submission path,
  or a net-mass field/API change. Until then, cases with only net mass are
  blocked from `POST /biochar_applications`, even if their evidence can be
  protocol-compliant.

### Production Batch and GHG Entry grain

The correct identity mapping is:

```text
1 noma credit batch  <->  1 Isometric Production Batch (ptb_...)

1 noma Removal/GHG Entry
    contains 1..N credit batches
    therefore aggregates 1..N Isometric Production Batches
```

This is already the repository contract: noma registers each member credit
batch as its own Production Batch, then builds one Removal/GHG Entry from the
full set of member credit batches. A GHG Entry ID must never be substituted for
`production_batch_id`, and noma must not create one Production Batch per GHG
Entry.

Because one Biochar Application request accepts exactly one
`production_batch_id`, a multi-batch physical spreading event cannot be sent
as one request. The likely remote grain is one **credit-batch allocation slice
at a site/date**, using stable, distinct supplier references, but Isometric
must confirm that contract before noma splits the event. In particular, the
allocated masses and rates must reconcile without duplicating the physical
event, and the treatment of shared gross/tare observations and Sources is not
documented.
[POST Biochar Application](https://docs.isometric.com/api-reference/certify/post-biochar-application)

There is one narrower current-code constraint: the implemented 1,000-year path
rejects a Removal containing more than one credit batch. The present Tanzania
flow therefore behaves as one credit batch to one GHG Entry, but that guard is
an implementation rule, not the identity mapping between the concepts.

## Sandbox and repository observations

### Current live sandbox shape

Read-only inspection on 2026-08-13 found:

- Component `cmp_1KZX2RYD7SBXJ0ZG` is a `REMOVAL`-scope,
  `SEQUESTRATION` component using blueprint
  `biochar_sequestration_1000_year`. Its only inputs are
  `carbon_contents` (list of three Datapoints), `product_mass` (one scalar),
  and `s_fraction` (list of three Datapoints). It has no site, coordinates,
  application-event, or segregation input.
- GHG Entry `rmv_1KZX2RYD7SBXTC7R` exposes accounting totals, dates,
  allocation, and statement/feedstock links. It has no storage-location or
  application fields.
- The project currently has no remote Biochar Applications and no remote
  Storage Locations (`total_count = 0` on both list endpoints).
- The separate live Storage sites surface nevertheless supports three distinct
  concepts: sites (farm, field, or landfill geometry), Biochar Applications
  (Production Batch applied at a site and time with rate and mass evidence),
  and soil samples (site and measurement date). Its zero counts alongside an
  already-calculating GHG Entry demonstrate that structured storage records
  and the sequestration calculator are independent.

These are observations of one sandbox project, not a general API guarantee.
The public list schema does show a nullable `ghg_entry_id` on a Biochar
Application, but the create request does not accept a GHG Entry ID and the
documentation does not explain when or how that association is made.
[GET Biochar Applications](https://docs.isometric.com/api-reference/certify/get-biochar-applications),
[POST Biochar Application](https://docs.isometric.com/api-reference/certify/post-biochar-application)

### Current noma shape

noma already implements and protects the accounting path:

- [`src/lib/isometric/transformers/sequestration-binding.ts`](../../src/lib/isometric/transformers/sequestration-binding.ts)
  accepts exactly one supported storage component and validates its exact
  blueprint inputs, input shapes, quantity kinds, and monitored status.
- [`docs/isometric/sandbox-template-authoring.md`](../isometric/sandbox-template-authoring.md)
  records the same sandbox contract and notes that template mutation remains
  an operator action in Certify rather than a template-authoring API.
- [`src/lib/certification/removal-source-bindings.ts`](../../src/lib/certification/removal-source-bindings.ts)
  maps application inventory/logbook evidence to sequestration `product_mass`.
  It intentionally excludes GIS-boundary evidence until Biochar Application
  `source_ids`, or an equivalent boundary target, is integrated.
- GHG Entry submission uses stable supplier references, immutable local
  snapshots, semantic hashes, reconciliation, and Source-binding verification.
  Manual remote edits are outside that local reviewed snapshot.

noma also has much of the physical application data needed for the specialized
resources:

- [`src/db/schema/application.ts`](../../src/db/schema/application.ts) stores
  date, wet and dry applied biochar mass, field area, point coordinates, field
  identifier, GIS boundary, evidence method, and soil temperature. Average
  application rate can be derived from applied mass and field area.
- Customer locations hold destination coordinates, names, and addresses in
  [`src/db/schema/parties.ts`](../../src/db/schema/parties.ts).
- Production Batches are already registered and journaled through
  [`src/fn/certification/production-batches.ts`](../../src/fn/certification/production-batches.ts).

One material data/API gap and one allocation rule remain:

1. noma does not store the required truck mass on arrival and truck mass on
   departure as distinct measured observations. Delivered or applied mass is
   not automatically evidence of both gross and tare weight.
2. The identity grain is fixed—one credit batch is one Isometric Production
   Batch—but a physical application involving several credit batches must be
   split into one remote application per credit-batch allocation. The rule for
   allocating gross/tare observations, rate, and shared Sources across those
   remote records still needs Isometric approval.

The missing vehicle observations matter to the pinned protocol, not only to
the API schema. Biochar Protocol v1.1 says applied mass is measured using a
calibrated scale and may be determined from the delivery truck's arrival and
departure weights. It permits agreed alternative delivery evidence when a
truck scale is unavailable, requires arrival/departure tickets or equivalent
records, and requires application losses to be deducted and allocated to the
specific application.
[Biochar Production and Storage v1.1, sections 8.3.1.1-8.3.1.2](https://registry.isometric.com/protocol/biochar/1.1#8.3.1.1)

## Option A: only use the GHG Entry storage component

### Advantages

- **Necessary and already aligned with the calculation.** `product_mass` is
  the dry biochar mass used in the module's stored-CO2 equation; carbon and
  durability inputs are already bound to the same sequestration component.
- **Lower implementation and operational risk.** The current submission path
  validates the live template and journals every reviewed payload and Source
  binding.
- **One authoritative accounting result.** The registry calculates the
  credited result from exact, blueprint-defined inputs instead of noma
  introducing a parallel stored-CO2 calculation.
- **Current evidence support.** Application inventory/logbook evidence can
  already justify the `product_mass` Datapoint.

### Disadvantages

- **It does not represent a storage site or application event.** The current
  component has no site identity, coordinates, application date, rate, vehicle
  weights, field boundary, or direct Production Batch-to-site link.
- **It aggregates away physical traceability.** One scalar product mass can
  support the GHG Entry calculation but cannot preserve each field/application
  event or repeated applications at one site.
- **It is a poor home for spreading evidence.** Attaching a boundary or field
  photo to `product_mass` would conflate evidence of location/application with
  evidence of mass.
- **Manual edits split authority.** Changing a submitted GHG Entry in Certify
  bypasses noma's semantic hash and reviewed snapshot. Calculation-changing
  edits require statement resubmission, and the API exposes only the latest
  resource state; historical submitted states are inspected in the UI.
  [Modifying resources](https://docs.isometric.com/user-guides/certify/modifying-resources)
- **Template drift can block noma.** Adding or renaming monitored inputs without
  a matching explicit binding makes the current compiler fail closed. A new
  Datapoint is valid only when an approved Component blueprint declares the
  corresponding input.

### Verdict

Use this option for **carbon accounting only**. It does not close the stated
storage-site/application gap by itself.

## Option B: add Storage Locations and Biochar Applications through the API

### Advantages

- **Correct semantic grain.** The records explicitly model the site and the
  spreading event rather than overloading a calculation input.
- **Richer traceability.** A Biochar Application directly references a Storage
  Location and one registered Production Batch, giving the verifier a clearer
  production-to-storage chain.
- **First-class application evidence.** `source_ids` belong on the application
  request, providing a natural target for field boundaries, application logs,
  dated/geotagged evidence, and weigh records.
- **Stable cross-system identity.** Both resources support
  `supplier_reference_id`; this fits noma's existing reconciliation pattern.
- **Protocol-aligned site facts.** Coordinates and rate directly support the
  module's proof-of-spreading and mass-confirmation requirements.
- **Potential GHG-entry association.** The response includes nullable
  `ghg_entry_id`; once Isometric explains and proves its lifecycle, that could
  connect physical application facts with the accounting entry without adding
  ad hoc component inputs.

### Disadvantages

- **The Storage Location API is beta and opt-in.** Isometric's first-party
  guide says storage-location endpoints require support enablement. Availability
  must be confirmed separately for sandbox and production.
  [GET Storage Location](https://docs.isometric.com/api-reference/certify/get-storage-location)
- **Required data is missing locally.** The application POST requires arrival
  and departure truck masses. New measured fields and evidence may be needed;
  deriving both from one delivered mass would be unsafe without Isometric's
  written acceptance.
- **Application grain conflicts with noma lineage.** One request accepts one
  Production Batch, but one physical local application may contain multiple
  Production Batch contributions. Splitting it remotely could duplicate the
  date, site, rate, and Sources unless the allocation contract is explicit.
- **Correction support is asymmetric.** The public application surface exposes
  create, read, list, and delete but no PATCH. The correction and post-statement
  immutability rules need a sandbox proof before production use.
- **Weak list reconciliation.** The Biochar Application list exposes pagination
  but no documented supplier-reference/project filters, so recovery after an
  uncertain POST may require bounded full-list scanning. Storage Location
  listing is similarly pagination-only within a project.
- **Association behavior is undocumented.** A create call does not identify a
  GHG Entry even though responses can contain `ghg_entry_id`. It is not safe to
  assume creation changes the current GHG Entry or is automatically included in
  the right GHG Statement.
- **It does not replace the sequestration calculation.** The application
  resource carries operational facts but does not contain carbon content or
  durable fraction and therefore cannot compute the pinned module's stored-CO2
  result by itself.
- **More lifecycle and audit state.** noma needs remote-ID journals, immutable
  payload snapshots, drift detection, environment scoping, Source validation,
  deletion/correction policy, and operator-visible sync status for two new
  resource families.

### Verdict

This is the selected **storage-site and application traceability** solution.
Implement it as an additive, sandbox-gated layer, with net-mass-only cases held
until Isometric supplies a supported encoding.

## Low-code pilot: use the structured Storage sites UI first

Before rolling out the API integration, the project can pilot the same
structured model in Certify's Storage sites UI. The observed sandbox surface
accepts point or polygon GeoJSON sites and CSV uploads for Biochar Applications
and soil samples. The separately documented Field measurements UI also uses CSV
for Measurement Locations and samples.

This would validate the verifier-facing grain, geometry, units, and application
to GHG Entry association with little engineering effort. It is suitable for a
small pilot or backfill, but manual file preparation and weak synchronization
make it unsuitable as the long-term system of record at production volume.

The UI/API geometry difference is itself a contract question: the UI accepts
polygon geometry while the Storage Location POST documents only latitude and
longitude. Confirm whether boundaries belong in Storage Locations, Certify
Removal Areas, attached Sources, or another endpoint before choosing a data
model.

## Questions Isometric must answer before implementation

1. Are Storage Locations and Biochar Applications enabled for project
   `prj_1K9YJ33RKSBX9FFF` in both sandbox and production, and are they the
   intended resources for Biochar Storage in Agricultural Soils v1.1?
2. What creates the returned Biochar Application `ghg_entry_id` association?
   Is it automatic from Production Batch/reporting dates, configured by
   Isometric, or performed through another UI/API operation?
3. Confirm the proposed grain: should one physical application containing
   several credit batches be submitted as one Biochar Application per
   Isometric Production Batch? If so, how must gross/tare masses, application
   rate, Sources, and site facts be allocated without duplication?
4. What units and wet/dry basis are expected for arrival mass, departure mass,
   and average application rate? Must arrival/departure be direct scale
   observations, and is their difference expected to equal dry or wet applied
   biochar mass? For the protocol's pre-agreed “equivalent records” route, what
   exact API values or alternative endpoint should noma use when only net mass
   is available?
5. Does a reused field/customer location map to one persistent Storage Location
   across repeated application events? What change to coordinates or field
   boundaries requires a new location rather than a PATCH?
6. What is the supported correction flow for a Biochar Application after it has
   been associated with a submitted or verified GHG Statement?
7. Should the same Source be referenced by both the Biochar Application and the
   GHG Entry's `product_mass` Datapoint when it supports both facts, or does
   Isometric expect distinct evidence attachments?
8. Is point location sufficient for this project, or should field boundaries
   also be represented through Certify Removal Areas/field measurements?
9. Does this configured 1000-year project require `biochar_soil` Measurement
   Samples? If so, should each request use its Storage Location ID, a separate
   Measurement Location ID, or both? The general Field measurements guide's
   durability wording does not match the live component, which has no soil
   temperature input, and the sandbox Storage sites workflow links soil
   samples directly to a storage-site supplier reference.

## Recommended delivery sequence

### Now

- Leave the live `biochar_sequestration_1000_year` component and its exact
  `carbon_contents`, `product_mass`, and `s_fraction` inputs unchanged.
- Continue using application inventory/logbook evidence for `product_mass`.
- Do not manually add a generic “storage site” or “segregation” Datapoint to the
  current GHG Entry.
- Ask Isometric the nine contract questions above and retain written answers
  as project governance evidence.

### After Isometric confirmation

1. Add measured arrival/departure vehicle-weight fields, their units/basis, and
   supporting evidence to noma if Isometric requires them. If Isometric accepts
   equivalent net-mass evidence, implement only its written API encoding.
2. Document the fixed identity grain (credit batch = Production Batch) and the
   approved allocation rule for multi-credit-batch physical applications.
3. Add a project-scoped remote Storage Location mapping, preferably from the
   customer/application site domain rather than noma's facility inventory-bin
   `storage_locations` table. The two concepts have the same name but different
   meanings.
4. Create/reconcile Storage Locations with stable supplier references.
5. Create/reconcile Biochar Applications with Production Batch IDs and exact
   application Sources.
6. Prove in sandbox how `ghg_entry_id`, statement visibility, corrections,
   deletion, and resubmission behave.
7. Surface the new records alongside, not instead of, the GHG Entry accounting
   breakdown.
8. Keep Measurement Locations and `biochar_soil` Measurement Samples out of
   this implementation. Reopen them only as a separate decision if Isometric
   makes soil sampling a project requirement.

## Final recommendation

**Proceed with the chosen hybrid sequence: retain Option A and add Option B.** The
GHG Entry's existing sequestration component remains the only evidenced,
project-configured route for calculating `CO2e_stored`. The specialized API is
the selected answer to the missing storage-site and application traceability.
Measurement Locations are conditional sampling infrastructure, not a dependency
of that path. The Biochar Application POST cannot accept only transported/net
mass today: both arrival and departure quantities, including units, are
mandatory, while standard deviation is optional. Do not fabricate gross/tare
values; gate those submissions on an Isometric-approved encoding. The fixed
lineage remains credit batch = Production Batch, with each GHG Entry free to
aggregate several such batches.
