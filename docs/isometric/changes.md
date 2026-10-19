# Isometric Docs Change Log

## 2026-10-16: Emissions entries behind EMISSIONS_ENTRIES_ENABLED (#1058)

Added the `emission_entries` and `emission_entry_values` tables and the
`emission_entry` document owner for entry evidence. Writes are behind
`EMISSIONS_ENTRIES_ENABLED`, which is off by default; the flag also refuses new
sample transport legs. No binding or submitted value changed. Entry aggregation
for submission remains deferred to PR 4. See [ADR 0032](../adr/0032-per-batch-emissions-entries-bound-to-template-lines.md).

## 2026-10-16: Energy page estimates and the Emission factors settings section removed (#1091)

noma no longer shows estimated CO₂e on the Energy page or offers the "Emission
factors" section in Certification settings ([ADR 0031](../adr/0031-operator-energy-estimates.md)).
No registry binding and no submitted value changed: the factors never fed a
submission.

## 2026-10-15: Correct reactor-monitoring citations and retain document-only gates (#627 slices 1, 2, 4)

The passages were read through the Isometric MCP (`how_to`, then
`protocols_get_content` for Biochar v1.1, tag 1.1.1) on 2026-10-15.
The [authoritative registry text](https://registry.isometric.com/protocol/biochar/1.1?tag=1.1.1)
confirms §9.1.2's sub-atmospheric pressure alternative: records at one-minute
intervals or more frequently, accuracy 2% FS or better, manufacturer calibration
requirements met or exceeded and calibration at least annual, with raw data
available on request. PDD B.19 supplies the project's five-year operational-record
retention commitment; §9.1.2 itself says only that raw data must be available on
request. The [project monitoring requirement](./requirements-shortlist.md#project-reactor-monitoring)
records the exact quoted clauses, registry URL and approved-PDD basis.
The schema's former Appendix II citation, five-minute reactor-temperature
cadence and pressure-threshold condition were unsupported. The protocol's
only appendix is Appendix 1: Risk of Reversal Questionnaire.

This resolves `isometric/readings-research-corrections`. The approved PDD
uses annual accredited emissions testing (E.1/E.3), so §9.2.4 requires flue-stack
temperature during project operations within 10% of the emissions-test value(s),
at one-minute intervals or more frequently, with 2% FS accuracy or better and
calibration at least annual and meeting or exceeding manufacturer requirements.
§9.2.4.1 requires raw pyrolyzer temperature data for the Reporting Period to be
retained for at least five years. Both passages are quoted in the shortlist.
The approved PDD's lack of a recurring temperature CSV requirement is a format
question only, not a reason to omit that series. Decision added 2026-10-16:
Kenji confirmed that the Readings file (`sensor_data`) uploaded on each production
run is the retained raw record for both the pressure and flue-stack temperature
series. noma stores it unchanged and does not check its contents, which are the
operator's responsibility, so file presence stays the readiness gate.
No continuous-gas CSV extension is needed for the approved emissions-testing
route. A future project choosing another emissions method needs its own evidence
contract. Historical research stays archived.

The Readings file stays unchanged on the production run. Readiness and Removal
submission use file presence, not parsed rows, Sensors, Parquet or reactor MeasurementSamples. Focused tests cover empty
structured readings, missing/pending/failed files, and submission without
telemetry calls. The optional readings importer retained by #942 q25 and
#1014 is unchanged. #627's remaining query-bounds follow-up is resolved:
`getProductionRunReadingsList` and the unmounted `ProductionRunReadingTable` cap the preview at 500 newest rows in stable order and signal omitted rows.
The registry upload pipeline and TelemetryPanel
were already retired in #987, as recorded on 2026-10-13; this slice removes
no modules or schema.

## 2026-10-15: Removal templates pinned per credit batch (#1067, #1058)

`removal_template_observations` retains normalized definitions, enriched inputs
and component-ID line contracts. Owner/Admin review settles proposed or invalid
contracts. Credit batches copy the facility default on creation; only Switch
template changes the pin. Removal grouping and compilation use member pins,
with connection prerequisites kept separate from default-template setup advice.
Pre-existing rows are not backfilled under the pre-production policy. See
[ADR 0032](../adr/0032-per-batch-emissions-entries-bound-to-template-lines.md).

Fixed-datapoint REST responses expose no deprecation flag. The deprecated-factor
readiness advisory remains deferred pending a registry signal; see
[the open question](../open-questions-isometric.md#fixed-datapoint-deprecation-signal-isometricfixed-datapoint-deprecation).

## 2026-10-15: Sample moisture retained as evidence only (#942 q1)

Kenji resolved `isometric/sample-moisture-submission`: Sample moisture stays
readiness-gated on sampled credit batches, and noma sends no moisture
measurement. `src/lib/certification/entity-readiness.ts:deriveEntityCertifyReadiness`
keeps the gate through the Sample field descriptors in
`src/lib/certification/certify-field-registry.ts`. The sequestration component's
Sample inputs remain total carbon and measured inorganic carbon (both dry
basis) plus `s_fraction`, built by
`src/lib/isometric/transformers/measurement-sample.ts:build1000YearSequestrationSample`;
dry biochar mass is computed and submitted separately.

[Agricultural Soils v1.1, Chemical Characteristics, Table 2](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1)
requires moisture characterization per production batch, with at least three
samples, to establish the dry mass of biochar applied. The
[Certify measurement-samples guide](https://docs.isometric.com/user-guides/certify/measurement-samples)
supports `mass_fraction_wet_basis` with `compound_h2o` on production-batch
samples, but that optional encoding does not create a submission requirement.
This records Kenji's decision and its source basis; readiness and payload
behavior are unchanged.

## 2026-10-15: App-only reflectance histograms and advisory (#942 q9, #1016)

Kenji decided that reflectance histograms are uploaded in the app only, as
`reflectance_histogram` documents owned by a Sample. PDF, image and tabular
files use the lab-report size limit. REST/MCP owners and the published OpenAPI
contract are unchanged. A sampled 1,000-year credit batch without an uploaded
histogram on any of its Samples receives a warning; it can still submit the
Removal. Histograms stay in noma and are not bound as Isometric Sources;
`removal-source-bindings.ts` binds only `lab_report` documents for Samples.
Pending and failed uploads do not count, and unloaded evidence does
not produce a warning. This records the product decision, not a new registry
verification. Sample moisture is retained as evidence only, per the decision
above.

## 2026-10-15: Certification status changes recorded as activity (#1038)

Certification status transitions are recorded in `activity_events` in the same
transaction as the ledger write. Events retain raw local and remote statuses,
the submission version, and the triggering actor. Registry refreshes use the
registry source and the registry's own time for that transition (submission time only for AWAITING_VERIFICATION, issue time for CREDITS_ISSUED); unchanged statuses add no event.

## 2026-10-15: Transport justification, bin typing and readings import (#942 q11, q22, q25)

- **q11:** Distance-method fallback justification, including why energy-usage
  data is unavailable, lives in the PDD, outside noma (#1012). noma keeps its
  distance-based transport path without a justification field or submission gate.
  Other transport evidence gaps remain open.
- **q22:** A feedstock bin's type is set when the bin is created and validated
  on each intake. A bin without a type gets one on its first intake.
- **q25:** Keep the readings import (#1014). The original telemetry CSV stays
  unchanged as sensor-data evidence; the importer can also load its rows as
  structured readings within the run window. The operator flow retains the file
  without parsing; the separate structured preview is bounded as described in
  [Production Run Extensions](../architecture.md#production-run-extensions).

## 2026-10-15: Samples require a credit batch; unused characterization columns removed

- Issue #1016 makes every lab Sample belong to one credit batch and removes
  run-only attachment and membership-driven reattachment. Batches with Samples
  must have those Samples moved or deleted before the batch can be deleted.
- The unused histogram/thermogram URL columns and batch-level durability,
  buffer percentage and registry columns are removed. Lab evidence uses the
  document slots; live 1,000-year accounting continues to use sample replicates.
- Decision #942 q6 keeps validation lab results outside noma. The unreachable
  Sample heavy-metal, PAH, PCB and dioxin/furan columns are removed. No submitted
  value or certification mapping changes.

## 2026-10-15: Required facility and party-location data (#1012, #942 q15)

Facility GPS is required to save by the q15 product decision. Supplier and
customer locations retain required GPS on update, customer location names
are required in storage, and countries have no placeholder default. Supplier
and customer creates require at least one location. Recorded site distances
must be positive. Supplier-level GPS, distance and the obsolete supplier
Certify badge are removed; feedstock transport uses the default supplier
location. These are entry invariants, not a change to registry calculations.

## 2026-10-15: Facility and feedstock setup rules aligned (#1012)

- Facility registry links require an external facility ID in storage and setup readiness, matching save and Production Batch submission.
- The unused genset energy yield is removed. Diesel continues to submit by volume through `fuel_usage_by_volume` (#319).
- Reference soil temperature has a CERT marker only for 200-year facilities, matching the submission gate. Pyrolysis feedstock types have a registry-mapping marker; blend types remain internal-only.
- Reactor types and feedstock categories are constrained to the supported values. Feedstock usage must be supplied explicitly. Reactors with production runs cannot move between facilities.

## 2026-10-15: Required intake fields and external eligibility evidence (#1013, #942 q8)

Intakes require a delivery date, supplier, wet mass, moisture below 100%, and bin.
Dry mass is derived; feedstock losses require an event time and switching a bin
to mix requires a merge time. Manual transport legs expose model year; evidence
uses uploads rather than unused document-reference columns. Eligibility,
counterfactual and leakage evidence stays outside noma; intake eligibility
columns and the ineligible-feedstock mass-balance exit are removed. Unused
intake GPS, CO2e, source-region and storage-bin supplier-reference fields are
removed. The legacy intake shipment table was subsequently retired (#1013).

BFA v1.2.3 Appendix 3 gives FSC Mix and Controlled Wood sourcing recommendations,
not a general 25% ineligible-biomass cap; the shortlist now reflects that scope.

## 2026-10-15: Optional TGA and mean reflectance (#942 q3, #1016)

Kenji resolved `isometric/tga-1000-year-requirement`: TGA reactive/residual
carbon and mean R₀ are optional when saving and certifying 1,000-year Samples.
The form, Sample writers and certification descriptors no longer require them.
The submitted durability tuple still requires total carbon, measured inorganic
carbon and `sReflectanceFraction` on each sampled 1,000-year Sample. Neither
TGA nor mean R₀ feeds that tuple. This records the product decision, not a new
registry verification.

Sample moisture is required for certification on sampled batches (#942 q1),
but remains optional at save. The existing measurement-sample payload has no
moisture field mapping; no new registry field was invented.

The one-calendar-month batch cap and 7 °C soil-temperature floor remain noma
conservative rules (#942 q7), as recorded in ADR 0016. Behavior is unchanged.

## 2026-10-15: Proof of delivery required before submission (#942 q12)

- Reverses the 2026-07-29 retained-records stance for proof of delivery:
  each delivery in a Removal needs an uploaded, delivery-owned delivery receipt,
  bill of lading or delivery photo before submission, independent of the
  template's transport categories.
- Saving a delivery without proof remains allowed. Pending uploads do not
  count as proof. Other retained records remain outside this requirement.

## 2026-10-15: Third-party sale verification fields dropped

Credit batches no longer store the third-party sale verification columns
`affidavit_reference`, `intended_use_confirmation`, `company_verification_ref`,
and `mixing_timeline_days` (decision #942 q26).
`biochar.third_party_sale` is listed as **Not supported** in
[`condition-registry.md`](./condition-registry.md). The old `G-SZZR-0` reference
was not found in the pinned protocols. Supporting a third-party sale requires
a new design; registry requirements still apply.

## 2026-10-13: Reactor time-series upload retired

The reactor time-series upload pipeline was removed in issue #987. The approved
MVP retains the Readings file (`sensor_data`) on each production run and needs no
registry sensor registration or bulk time-series upload. ADR 0006 is retired;
the full pipeline can be restored from `archive/reactor-telemetry-upload`
(staging commit `5b7a252c2`).

## 2026-10-13: Lab sample entry warnings and archived batches

- Writing a lab sample (UI or API) returns non-blocking warnings that mirror
  the submission gates: complete H/C_org and O/C_org, a sampling day before the
  credit batch window, and on 1,000-year batches R0, S, TGA and at least 500 R0
  readings (`src/lib/certification/sample-entry-warnings.ts`). The 500 floor is
  a "should" in module v1.1 and warns only; the TGA requirement is an open
  registry question (`isometric/tga-1000-year-requirement`).
- Creating, updating or moving a sample onto an archived credit batch is
  refused. Reads and deletes still work.
- H/C_org and O/C_org are calculated by the server whenever their inputs are
  present (`src/lib/calculations/sample-ratios.ts`).

## 2026-10-13: A Sample with H/C_org but no O/C_org blocks submission

- Eligibility (module §3 Table 2) is judged on Samples that carry both
  H/C_org and O/C_org, but the submitted H/C_org mean
  (`buildPerBatchDurabilityData`) pools every usable H/C_org. A Sample with an
  adverse H/C_org and a blank O/C_org could pass eligibility while its H/C_org
  still reached the registry.
- `evaluateDurabilitySubmissionGates` now blocks a sampled credit batch while
  any Sample in the submitted H/C_org mean lacks its O/C_org, and names those
  Samples (Kenji, round 7 Q54). The submitted population is unchanged: the
  operator records the O/C_org or corrects the Sample. Both sides share the
  `isUsableNumber` predicate from `biochar-eligibility.ts`, and
  `evaluateRunEligibility` reports the affected replicates as
  `unpairedHToCReplicateIndexes`.
- The credit-batch durability chips no longer read "Chemistry eligible" in
  that case; they read "Chemistry incomplete" and name the Samples.

## 2026-10-01: Storage components, diesel split and Source targets come from the catalog

- The sampled 1,000-year durability inputs
  (`biochar_sequestration_1000_year_f_durable_max`) are catalog entries with
  strategy `measurement-sample` in
  `src/lib/isometric/semantic-binding-catalog.ts`, each carrying its
  measurement property, data shape, source contract and unit transform.
  `SEQUESTRATION_COMPONENT_INPUT_BINDINGS`
  (`src/lib/isometric/transformers/sequestration-binding.ts`) is a projection
  of them, and `transformSequestrationSourceValue` applies the transform the
  binding declares. The unit transforms are named in
  `src/lib/isometric/source-transforms.ts`.
- The storage blueprint keys, their durability tier and sampling, the
  tier-to-blueprint selection (ADR 0021) and the 200-year transforms (H/C ×100,
  carbon percent to fraction) moved from `measurement-sample.ts` to
  `src/lib/isometric/storage-blueprints.ts`. The 200-year components stay
  unbound and fail closed (ADR 0013). The unused
  `SEQUESTRATION_1000_YEAR_COMPONENT_CONTRACTS` is gone.
- The generator/startup diesel split and the Safety margin carve-out are named
  disambiguation rules (`PYROLYSIS_DIESEL_SPLIT`, `SAFETY_MARGIN_CARVE_OUT`)
  on their catalog roles, documented as exceptions for a provider key that is
  not stable. An unrecognised pyrolysis diesel component fails with the same
  message as before.
- Each catalog role names the noma evidence roles whose Sources support it.
  The Source binding rules, the durability ledger targets and the persisted
  Source target schema (`src/fn/certification/removal-snapshot-readers.ts`)
  are projections of them. Projections live in
  `src/lib/isometric/semantic-binding-projections.ts`.
- No binding or submitted value changed (#638 slice A, part of #291).
  `MAPPING_REVISION` and `SOURCE_BINDING_MAPPING_REVISION` keep their values;
  `tests/binding-catalog-exceptions.test.ts` pins the pre-#638 storage
  classification, sequestration bindings, Source targets and the diesel
  message. `tests/binding-tuple-literal-guard.test.ts` now also catches
  backtick and object-key mirrors outside comments. Persisting component
  assignments by template-component ID is #893; the binding editor is #894.

## 2026-10-01: Energy page drops the submission preview and shows estimates

- `/energy` no longer previews the grid electricity and diesel values a
  Removal submits; the Removal flow already shows what is submitted. The
  page now estimates CO₂e per record from per-facility emission factors
  (`facility_emission_factors`, [ADR 0031](../adr/0031-operator-energy-estimates.md)).
- Display only. No binding, datapoint or submitted value changed, and the
  estimate factors never reach the registry; Isometric applies the factors on
  its template ([ADR 0018](../adr/0018-isometric-owns-project-emissions.md)).

## 2026-10-01: Field registry tuples and transport categories come from the catalog

- `CERTIFY_FIELD_REGISTRY` (`src/lib/certification/certify-field-registry.ts`)
  now names only the aggregated facts each field feeds.
  `resolveCertifyFieldInputTuples` resolves the removal-template inputs through
  the catalog (`projectInputTuplesBySource`), so fields whose fact feeds a bound
  input now list it even where the old literals left it out (moisture, the
  Safety margin, the transport-derived distances and masses).
- `deriveRequiredTransportCategories`
  (`src/fn/certification/certify-transport-coverage.ts`) reads the catalog's
  `projectTransportCategories`; the hand-kept `TRANSPORT_SOURCE_TO_CATEGORY`
  and its sync comment are gone. `TRANSPORT_SOURCE_FACTS` names the fact each
  transport category submits, and readiness routes transport legs through
  `transportRepairDestination` (`src/fn/certification/certify-readiness-gaps.ts`)
  instead of its own category-to-fix-target map.
- No binding or submitted value changed (#637, part of #291).
  `tests/binding-catalog-projections.test.ts` pins the pre-#637 sources,
  tuples, categories and fix targets, and shows one catalog edit moving the
  registry tuples and the transport categories together.
  `tests/binding-tuple-literal-guard.test.ts` fails when a source file quotes
  a catalog `(blueprint_key, input_key)` pair; its allowlist names the mirrors
  #638 and #639 still own.

## 2026-10-01: Removal input bindings live in one semantic catalog

- `src/lib/isometric/semantic-binding-catalog.ts` now owns every ordinary
  removal-template binding, keyed by `(blueprint_key, input_key)` with an
  explicit role per allowed group: the source fact, datapoint contract
  (unit, quantity kind, type, transform), attribution bucket, strategy
  (aggregated Datapoint or PROJECT-scope forbidden) and the per-component
  carve-outs. `SOURCE_FACTS` carries each fact's readiness provenance and
  repair destination once; the Removal template diagnostic reads its source
  labels from there.
- `INPUT_MAPPING` and `PERIOD_INPUT_TUPLES` in
  `src/lib/isometric/transformers/datapoint.ts` are projections of the
  catalog. No binding changed: `tests/semantic-binding-catalog.test.ts` pins
  both tables and `MAPPING_REVISION` to their pre-catalog values (#636, part
  of #291). Sequestration bindings, `CERTIFY_FIELD_REGISTRY` and
  `TRANSPORT_SOURCE_TO_CATEGORY` move in the next slices.

## 2026-09-16: Source audit events are staged outside the mirror transaction

- `mirrorDocumentToSourceForUser` (`src/fn/certification/sources.ts`) runs its
  transaction inside `withStagedSyncEvents`
  (`src/fn/certification/sync-event-stage.ts`), so every `certifier_sync_events`
  payload, including the failure diagnostics from `withSourceSyncEventOnFailure`
  (`src/fn/certification/source-sync-events.ts`), is held in a closure and
  written once the transaction settles: success rows after commit, failure rows
  after rollback. Nothing asks the root pooled `db` for a second connection
  while the transaction holds one, so the audit trail survives at
  `DEFAULT_DB_POOL_MAX = 1` (`src/db/pool-config.ts`).
- Pinned by `tests/certifier-source-sync-events-tx.test.ts`, which runs the
  mirror against a real `max: 1` pool. This closes the
  `storage/sources-sync-events-tx` open question (issue #772).

## 2026-09-10: Removal deletion deletes the Sources it released

- Verified through the `how_to` MCP tool and the public Certify OpenAPI:
  `DELETE /sources/{id}` returns 204 and is irreversible; deleting a draft
  GHG Entry does not cascade to its Sources or Datapoints; the registry
  refuses a Source that locked Datapoints, validated assets, or a verified
  GHG Statement still use.
- After `finalizeRemovalDeletion` commits, `deleteRemoval` sends one
  `DELETE /sources/{id}` per released mirror
  (`deletion.releasedDocumentMirrors`), each fenced by the document's mirror
  lock through `withReleasedDocumentMirrorLock`. A mirror of the same
  document that reconciled onto the Source first keeps it (`retained`); one
  that queues behind the delete creates a new Source. A 404 counts as
  absent. Any other refusal is recorded as a failed `removal:delete:source`
  sync event with the registry detail and does not fail the deletion, since
  the local side is already consistent and the Source stayed on the
  registry before this change too. A fence failure (bounded lock wait,
  connection) or a missing client is recorded the same way. The
  `removal:delete` event is written before this cleanup starts; the action
  result carries `deletedSourceIds`.
- The single-document and parent-record delete paths still leave the remote
  Source in place. `isometric/removal-deletion-orphans` in
  `docs/open-questions-isometric.md` is narrowed to Datapoints.
- Code: `src/lib/isometric/sources.ts` (`deleteSource`),
  `src/data-access/certifier-removal-deletion.ts`
  (`withReleasedDocumentMirrorLock`), `src/fn/certification/delete-removal.ts`
  (`deleteReleasedSources`), `tests/fixtures/fake-registry.ts` (Sources and
  `DELETE /sources/{id}`).

## 2026-09-08: recover deleted Storage Locations and report evidence failures accurately

- `src/fn/certification/storage-locations.ts:ensureStorageLocation` now
  rechecks a confirmed 404 under registration locks, reconciles the unchanged
  supplier reference, and adopts an exact replacement or creates one.
- `src/data-access/certifier-storage-locations.ts:replaceMissingStorageLocationRegistration`
  replaces only the external ID and atomically flags dependent Biochar
  Application journals for review, preserving submitted payloads and IDs.
  Correction of those existing claims remains tracked as
  `isometric/biochar-application-storage-location-replaced` in
  `docs/open-questions-isometric.md`.
- `src/fn/certification/submit-removal.ts` completes the creation progress
  step before evidence reconciliation begins. A later artifact failure now
  appears on the evidence step without leaving a spinner active.

## 2026-09-08: Removal deletion releases the evidence mirrors it orphaned

- Deleting a never-finalized Removal now also releases the local
  `certifier_document_uploads` mapping of every Source that only the deleted
  ledger rows cite. The release runs inside the finalize transaction under
  the per-document mirror locks, rechecks after each delete, and records the
  released `documentId` / `externalDocumentId` pairs under the ledger row's
  `deletion.releasedDocumentMirrors`. The remote Source still stays on the
  registry (`isometric/removal-deletion-orphans`); a later submission that
  mirrors the same document reconciles onto it by supplier reference.
- A ledger row stamped with the `deletion` metadata record no longer pins
  anything: the snapshot-reference guard behind document unlink and delete,
  and the reviewed-evidence lock from 2026-09-07, both skip such rows. Their
  snapshot remains the audit trail for registry records that no longer exist.
- Deleting a parent record (Application, Delivery, transport leg, and the
  other document owners) releases an Isometric mapping that no live snapshot
  cites, the same way single-document delete already did, instead of refusing
  on any mirror row. Mappings for other providers and Sources a live snapshot
  cites still refuse the delete. This also frees records orphaned by
  deletions that ran before this change.
- Code: `src/data-access/certifier-document-uploads.ts`
  (`releaseDocumentUploadsReferencedOnlyBySubmissions`),
  `src/data-access/certifier-removal-deletion.ts`,
  `src/data-access/documents.ts`.

## 2026-09-08: accepted create request is the Application evidence contract

- Re-verified on this date against the public Certify OpenAPI and the `how_to`
  MCP tool: `CreateBiocharApplicationRequest` accepts `source_ids`; the
  `BiocharApplication` response (POST and GET), `Source`, and `GET /sources`
  expose no Application-to-Source link. Only the GraphQL `BiocharSpreadEvent`
  type (`biocharSpreadEventSources`) does.
- Reconciliation no longer refuses a readback that omits `source_ids`. The
  accepted `POST /biochar_applications` request carries the reviewed Source
  set and is the attachment contract; the 200 response only confirms
  acceptance. The immutable submission snapshot retains the IDs sent. When a
  response does return `source_ids`, the exact reviewed set is still required;
  a null value counts as omitted and any other non-array value is reported
  as drift. Recorded as `isometric/biochar-application-source-readback` in
  `docs/open-questions-isometric.md`.
- The strict readback guard introduced on 2026-09-07 blocked every
  evidence-bearing Removal on staging. Authoritative GraphQL readback remains
  tracked in issue #737.

## 2026-09-08: never-finalized Removals can be deleted, registry first

- A Removal whose submission never reached "Submission complete" (no ledger
  row, or a `draft`/`rejected` row) can be deleted from the Removal detail
  sheet and the New Removal wizard. Submitted, accepted, and superseded
  Removals, and any Removal in a GHG Statement, refuse deletion. Any member
  may delete, registry cleanup included; the authorization question is
  deferred to issue #746. The client gate refuses when any earlier ledger
  version finalized, which the latest row alone cannot show.
- A ledger row that never recorded a GHG Entry ID is reconciled by its
  supplier reference through `GET /ghg_entries` before the cleanup decides
  nothing is there, because the POST may have landed without its response.
- Deletion removes the registry records first: `DELETE /ghg_entries/{id}` for
  the GHG Entry the ledger recorded, then `DELETE /biochar_applications/{id}`
  for each confirmed Biochar Application registration. Both endpoints are
  irreversible and the GHG Entry delete is refused unless the entry is still
  `DRAFT` (public Certify OpenAPI, checked on this date). A refusal releases
  the deletion claim and changes nothing locally. A 404 counts as already
  deleted so a retry after a partial cleanup converges.
- A Biochar Application registration still `creating` (its POST was
  interrupted before the registry ID came back) is resolved by supplier
  reference through `GET /biochar_applications` and deleted when found.
- The claim stamps every ledger row, rejected ones included, with a fresh
  lock and the `deleting` outcome; the submit path's resume CAS now refuses
  any row whose lock is fresh, so a retry cannot adopt a GHG Entry that the
  cleanup is about to delete. Local cleanup re-reads the ledger under the
  Removal locks and refuses if a submission ran between claim and finalize,
  then marks the ledger rows
  `rejected` with a `deletion` metadata record (deleted and already-absent
  registry IDs both listed), removes the Biochar
  Application registration rows so their supplier references are free for a
  later Removal, releases production-claim reservations and credit batch
  slices, and deletes the Removal row. Datapoints, Measurement Samples,
  Production Batches, Storage Locations, and Sources stay on the registry (see
  `isometric/removal-deletion-orphans` in `docs/open-questions-isometric.md`);
  the local Source mappings are released since the later 2026-09-08 entry.
- Code: `src/fn/certification/delete-removal.ts` (core),
  `src/fn/certification/delete-removal-action.ts` (server action),
  `src/data-access/certifier-removal-deletion.ts`.

## 2026-09-07: fail-closed Application evidence and safe recovery

- The public [Certify OpenAPI schema](https://docs.isometric.com/api-reference/certify/mrv.openapi.json), checked on this date, accepts `source_ids` in `CreateBiocharApplicationRequest` but omits it from `BiocharApplication`. Evidence-bearing Removal finalization remains blocked until an authoritative attachment readback exists. When Source IDs are returned, reconciliation requires the exact reviewed set.
- Evidence refresh preserves the prior snapshot and locks reviewed documents against deletion (ledger rows stamped by Removal deletion no longer count, see 2026-09-08). Only an explicitly mutation-free interrupted attempt may rebuild versioned inputs; possible or confirmed registry mutations require exact retry/reconciliation first.
- A finite pending GHG Statement total, including zero, represents pending changes under the provider's documented null-versus-number contract. Failed verification retains its own status.
- The incomplete sandbox scenarios and external verifier report delivery remain acceptance blockers documented in the [retest record](../archive/qa/2026-09-07-isometric-blockers-retest.md).

## 2026-08-27 (Biochar Application canonical readback units)

- Live Certify Biochar Application responses canonicalize submitted `t/ha` to
  `metric_ton / hectare` and submitted `kg` to `kilogram` on readback.
- Reconciliation accepts only those semantically identical spelling pairs.
  Quantity magnitudes, application and dependency identities, dates, supplier
  references, and any present GHG Entry association remain strict; unrelated
  units and an association to a different GHG Entry still fail closed as
  registry drift. Both provider-managed association fields may remain null on
  a fully persisted Application, which is accepted and retained in the journal.
- Confirmed Biochar Application retries read the persisted external identity
  directly. A present association must match the current GHG Entry; null
  provider-managed associations are accepted. Bounded supplier-reference scans
  remain only for unconfirmed orphan recovery.
- Biochar Application journal identity and supplier references are versioned by
  immutable Removal submission. A superseding GHG Entry creates one new
  Biochar Application for that submission while the prior registry application
  remains intact; retries reuse the current version without a duplicate write.
- Kilogram request/readback comparison is shared with Production Batch
  reconciliation so both endpoints retain the same verified alias contract.
- Application field size is required and positive at form, create, update,
  data-access, and submission boundaries. Delivered wet mass copy
  states the persisted minimum of 0.001 kg explicitly.

## 2026-08-26 (Biochar Application API restored)

- Removal submission now ensures Production Batches, then Storage Locations,
  then one Biochar Application per immutable Application by credit-batch slice
  in the configured Isometric environment.
- Biochar Application arrival mass is exactly the slice's allocated wet kg and
  departure mass is zero kg. Commingled slices partition the physical
  Application total.
- Biochar Applications use the ordinary claim, reconciliation, drift, retry,
  and confirmation journal lifecycle. There is no missing-mass gate or
  placeholder lifecycle.
- Delivery truck weighing was removed. Delivery receipts and photos remain
  retained documents but do not bind to sequestration inputs. Delivery bills
  of lading retain only their biochar transport binding.
- Storage Location synchronization now follows the configured environment.

## 2026-08-16 (1000-year Removal grouping and local draft recovery)

- A 1000-year facility can group only one credit batch into each Removal. The
  wizard enforces this before Continue, and the authoritative transaction
  rechecks the locked facility tier before creating a Removal or assigning
  application slices. When one physical Application spans multiple 1000-year
  credit batches, each immutable batch slice can join its own Removal. The
  200-year multi-batch flow still keeps the complete Application together.
- An authenticated operator can discard a purely local Removal draft after
  confirmation. Recovery releases only that Removal's application-slice
  memberships and deletes its local row in one transaction.
- Recovery refuses any Removal with a submission ledger row, production claim,
  reporting dates, GHG Statement membership, or sticky possible-mutation
  marker. Append-only sync events are retained as audit history but do not act
  as registry state or block recovery by themselves. Recovery shares the
  submission advisory lock so a concurrent claim cannot race the discard.
  Before any submit-time Source mirroring can mutate Isometric, noma persists
  the sticky marker under the same Removal and artifact locks, so recovery
  stays fail-closed throughout the pre-ledger external-write window.
- `claimSubmissionDraft` rechecks the Removal under the artifact lock. When
  discard wins the race, the claim creates no ledger row and performs no
  registry work (`tests/certification-submissions.test.ts`).

## 2026-08-16 (whole-batch production-claim concurrency hardening)

- A Removal now reserves all unclaimed member credit batches atomically before
  its first registry POST. A mutation-free failure releases the reservation;
  possible or confirmed remote mutation keeps it fail-closed for reconciliation.
- The earliest reporting period wins a shared batch's production inputs, using
  the latest member Application date as the pre-submit completion date and the
  draft creation time and ID only as tie-breakers.
- Whole-batch production inputs include completed, unapplied member runs and
  their feedstock transport. Those runs do not dilute the applied biochar
  delivery-transport fraction.
- For 200-year facilities, an Application may join a Removal only when all of
  its credit-batch slices are unassigned; an existing sibling owner blocks the
  assignment. A 1000-year Removal instead owns its single batch slice.

## 2026-08-15 (application-slice Removal attribution and carbon ledger)

- Biochar remaining in a source bin can be used for a new product after its
  production run has supported a submitted Removal. Submitted source records
  remain immutable; the new downstream draw is a new record.
- Removal membership now freezes application-by-credit-batch wet and dry mass
  slices. Newly applied mass from the same credit batch remains available for a
  later Removal.
- The first successful Removal claims the full production-emissions bucket.
  Later Removals retain delivery and stored inputs and omit already-claimed
  production inputs.
- A commingled physical Application compiles one registry Biochar Application
  per immutable credit-batch slice while retaining the shared observed truck
  facts.
- Removal review and credit-batch detail now show a compact carbon ledger, one
  stored-CO₂e estimate, linked source records, and the prior production claim.
- Noma submits accounting inputs; Isometric remains authoritative for project
  emissions and the net removal result.

## 2026-08-15 (Storage Location and Biochar Application Removal integration)

One customer location represents one reusable agricultural application site per
Isometric project. Organization Owners/Admins can explicitly synchronize that
site from an Application detail sheet. Sandbox Removal submission also ensures
all required Production Batches, then Storage Locations, then Biochar
Applications before completing the submission. Storage Location reconciliation
and drift handling remain unchanged; application create and update actions do
not perform registry writes, and local name or coordinate drift never triggers
an automatic PATCH.

Delivery create/edit now records optional observed truck mass before and after
unloading in kilograms. Sandbox Removal preflight requires both observations
for every included Application and never substitutes delivered wet mass or zero
as observed evidence. It also requires a positive field size, compiles
commingled mass as one immutable application-by-credit-batch slice per registry
Production Batch, refuses deliveries split across multiple Applications, and
snapshots the resolved values before any registry mutation. The Biochar Application
journal claims the exact payload before POST and reconciles bounded list pages
by its versioned environment/provider reference after retries. Rate is applied
tonnes divided by field hectares (`t/ha`); truck mass values use `kg`.
Production-environment registry synchronization remains explicitly disabled for
both Storage Location and Biochar Application resources.

This traceability layer does not change the GHG Entry `CO2 stored` component,
its payload hash, or the existing sequestration calculation. Measurement
Locations remain out of scope. The migration chain and focused local
tenant/concurrency tests are verified independently of the live provider; live
sandbox Storage Location behavior and any registry UI URL remain unverified.

Certification-readiness, transport-evidence, supporting-source, and sampling
correction notes are archived in
[`docs/archive/2026-07-28-certification-readiness-and-sampling-corrections.md`](../archive/2026-07-28-certification-readiness-and-sampling-corrections.md).

Application mass records remain uploadable, but new uploads do not use the
inapplicable Soil Environments v1.2 classification taxonomy. Completed
production runs require one successfully uploaded, unchanged readings CSV for
certification readiness. This file-presence check is a conservative Noma
control and does not claim that structured telemetry was submitted to Certify.
Dated implementation context is archived in
[`docs/archive/isometric-changes-archive-2026-07-31-operational-feedback.md`](../archive/isometric-changes-archive-2026-07-31-operational-feedback.md).

Certification review corrections for report serialization, Production Batch
reconciliation, workspace eligibility, and grouped Removal readiness are
archived in
[`docs/archive/2026-08-09-certification-review-corrections.md`](../archive/2026-08-09-certification-review-corrections.md).

Removal submission recovery and the observed Production Batch mass-unit
readback are archived in
[`docs/archive/2026-08-10-removal-submission-recovery.md`](../archive/2026-08-10-removal-submission-recovery.md).

## 2026-08-14 (replacement s_fraction binding matches observed blueprint shape)

The live `biochar_sequestration_1000_year_f_durable_max` blueprint declares
`s_fraction` as a `dimensionless_ratio` LIST. Removal compilation now binds the
existing `dimensionless_ratio/inertinite_fraction` Measurement Sample response
Datapoints directly instead of duplicating them as `dimensionless` Datapoints.
Product mass remains the only standalone durability Datapoint. The local
contract now matches the read-only sandbox blueprint shape and removes the
false template-admin blocker. Registry confirmation that this replacement
governs the Protocol v1.1 project and a fresh end-to-end sandbox submission
remain pending.

## 2026-08-14 (sync-event key widened; stale-lock script re-keyed)

- `certifier_sync_events.entity_id` widened from `uuid` to `text` (migration
  0108). The column is polymorphic per `entity_type`: local UUIDs for removals,
  GHG statements, and documents; `nm-slc-*` supplier references (or an
  `unmapped:*` fallback) for Storage Locations, whose sync events previously
  failed to insert and crashed the application sync panel on read.
- `scripts/isometric-clear-stale-lock.ts` now targets the Removal ledger key
  (`localEntityType='removal'`); it previously queried `creditBatch` and could
  never find current rows. It refuses to clear a draft whose
  `metadata.externalMutation` is `possible`/`confirmed` unless
  `--force-confirmed` is passed, because rejecting such a draft re-versions
  the supplier references and can duplicate registry entries.
- GHG statement creates now persist the interrupted marker (`lastError`,
  `lastAttemptOutcome`, `externalMutation`) when a timeout/5xx may have
  reached the registry, matching the Removal pipeline.

## Production batch identity readback and recovery

Before binding durability measurements, read the exact persisted ProductionBatch
ID ([GET Production Batch](https://docs.isometric.com/api-reference/certify/get-production-batch.md)).
Verify its ID, stable supplier reference and saved facility; a live identity with
a changed current project/facility mapping blocks submission. Preserve local
payload-drift reporting and legacy date-hash migration for live same-mapping batches.
Only a 404 or the provider 400 detail naming exactly the requested missing ID
permits recovery. Reconcile the stable reference before POST, refuse duplicate
references, and validate the complete current payload (including supported legacy
windows). Keep the old journal until confirmation, then replace it with an
organization/provider/batch/old-ID and row-version compare-and-set. Audit the old
and new IDs. Other read errors never trigger replacement.
## 2026-08-13 (Production Batch physical run windows)

New Isometric Production Batches now submit the earliest member production-run
start and latest completed member-run end as `started_at` and `ended_at`. These
are physical instants, matching the checked-in Certify OpenAPI descriptions and
the existing Production Batch mapping decision, rather than UTC day-boundary
timestamps derived from the credit batch's date-only window. This keeps every
member run inside the immutable remote Production Batch, preserves non-zero
same-day windows, and renders the operator's physical run times consistently in
positive- and negative-offset facility timezones.

Reconciliation accepts the former UTC day-start/day-end representation for a
remote batch carrying the same stable supplier reference and otherwise matching
identity and records that compatibility claim in the sync audit trail. Stored
payload hashes from that exact legacy representation migrate once to the
physical-window hash; changes to mass, facility, feedstock, kind, supplier
reference, or a later physical window still emit drift. Open member runs fail
before that batch's registry POST.
The behavior is covered hermetically; fresh sandbox verification is pending.

## 2026-08-13 (measurement Samples preserve local Sample grain)

Sampled 1,000-year submission now creates one Isometric
`MeasurementSample` for each independently analysed noma Sample. Each request
uses a deterministic versioned reference containing the stable local Sample
identity, the Sample's own sampling instant, and only its paired total-carbon,
inorganic-carbon, and `s_fraction` values. Input row ordering does not change
the semantic snapshot or supplier references.

Batch product mass no longer appears as a property of an aggregate physical
Sample. It is materialized once as a standalone direct `REPORTED` kg Datapoint,
with the existing inventory and durability Sources. The GHG Entry continues to
receive three ordered IDs for each chemistry/reflectance list and one scalar
mass ID. Measurement Sample source patching processes every capture even though
none carries mass.

The snapshot schema and mapping revision reject the former aggregate shape.
Supplier-reference journaling and collection reconciliation resume after one or
two successful Sample creates, and a source-patching retry reconciles all three
without duplicate POSTs. This is code-implemented and hermetically verified;
fresh sandbox verification is still pending. No production enablement or
external-record remediation is included.

## Feedstock inventory mass basis

Feedstock-bin stock, withdrawals, losses, and reconciliation now use wet,
as-received kilograms as their authoritative physical inventory unit.
`production_run_feedstocks.wet_mass_used_kg` records that wet allocation and
replaces the former ambiguously named `mass_used_kg` column. Production runs
continue to derive dry feedstock mass from their recorded wet mass and moisture
for process calculations and certification inputs. Certification lineage uses
the wet allocation shares to select contributing intake batches without
changing the dry-mass values submitted for protocol calculations.

## 2026-08-13 (replacement sampled 1,000-year component implemented locally)

The current sampled component contract is
`biochar_sequestration_1000_year_f_durable_max`, with paired list inputs
`total_carbon_contents`, `inorganic_carbon_contents`, and `s_fraction`, plus
scalar `product_mass`. Every submitted replicate requires directly measured
inorganic carbon; noma does not derive it from total minus reported organic
carbon on this path.

The local explanatory preview now mirrors the component: calculate organic
carbon per replicate as total minus inorganic, average it, calculate raw
durability as the binomial lower estimate, bound credit-bearing organic carbon
and durability at zero, cap durability at 0.95, and use the bounded value for
stored CO2e. Evidence ledgers show the three per-replicate
values, `s_fraction`, product mass, raw and capped durability, cap status,
component key, and formula label. Isometric remains authoritative.

The deprecated `biochar_sequestration_1000_year` remains readable and is
labelled as legacy total-carbon/uncapped semantics. New template selection and
submission compilation reject it. Production sampled submission remains
blocked, and unsampled Method B remains unsupported. Protocol v1.1,
Agricultural Soils module v1.1, and Standard v1.7 pins are unchanged. Isometric
confirmation and external sandbox-template migration remain outstanding; no
registry template was changed by this implementation.

## 2026-08-10 (customer location application evidence)

Application records now support `location` as the first and default evidence
method for identifying where biochar was applied under Agricultural Soils v1.1.
The location path uses the application's complete latitude/longitude pair,
normally derived from the selected delivery customer's saved location. GIS
boundary evidence remains available as an alternative, while visual evidence
remains unavailable in the creation UI.

This changes noma's local application evidence enum and defaults; it does not
add or change an Isometric API operation. Application evidence-health counts
remain informational and do not block certification submission.

## Live submission progress

Removal and GHG Statement submission dialogs now show progress from noma's
actual orchestration checkpoints. Completed registry calls receive checkmarks,
repeated monitored-input and durability calls show completed and total counts,
conditional steps are marked as not required, and work recovered from an
earlier attempt is marked as already sent. This is UI feedback over the existing
single submission request, not a background job or a new Isometric API
capability.

Submission dialogs cannot be dismissed while the request is active. If a call
fails, the failed step remains visible and retry continues through the existing
submission-ledger reconciliation path without assuming that an uncertain
registry write did not happen.

Certification remodel implementation notes from 2026-06-03 and 2026-06-04 are
archived in
[`docs/archive/isometric-changes-archive-2026-06-certification-remodel.md`](../archive/isometric-changes-archive-2026-06-certification-remodel.md).

Feedstock type certification guardrail implementation notes from 2026-06-13 are
archived in
[`docs/archive/isometric-changes-archive-2026-06-13-feedstock-type-certification-guardrails.md`](../archive/isometric-changes-archive-2026-06-13-feedstock-type-certification-guardrails.md).

Transport-leg evidence now reaches Isometric as mirrored Sources, and submit can
auto-generate a transport evidence ledger Source from live legs. Dated
implementation and sandbox-verification notes from 2026-06-19 are archived in
[`docs/archive/isometric-changes-archive-2026-06-19-transport-evidence-sources-and-ledger.md`](../archive/isometric-changes-archive-2026-06-19-transport-evidence-sources-and-ledger.md).

Removal review, Source lifecycle, and transport-provenance implementation notes
from 2026-07-27 are archived in
[`docs/archive/isometric-changes-archive-2026-07-27-removal-review-sources-transport.md`](../archive/isometric-changes-archive-2026-07-27-removal-review-sources-transport.md).

## Registry Source visibility contract

Certification Settings exposes one organization-wide Isometric Source
visibility policy to organization Owners/Admins and Platform Admins. It defaults
to private and applies to every new Source created through the centralized
mirror flow, including generated Removal evidence-ledger PDFs. Per-document
visibility controls and the remote visibility PATCH action were removed, so
callers cannot override the persisted policy.

Policy changes are forward-only: noma does not bulk-rewrite existing Isometric
Sources, and reconciliation continues to preserve the registry-of-record
visibility for Sources that already exist.

Dated implementation and verification notes are archived in
[`docs/archive/isometric-changes-archive-2026-07-24-registry-source-visibility.md`](../archive/isometric-changes-archive-2026-07-24-registry-source-visibility.md).

Earlier implementation notes are archived by date:

- [`2026-07-02 to 2026-07-29`](../archive/isometric-changes-archive-2026-07-02-to-07-29.md)
- [`2026-07-23 to 2026-07-24`](../archive/isometric-changes-archive-2026-07-23-to-07-24.md)
- [`2026-06-10 to 2026-06-20`](../archive/isometric-changes-archive-2026-06-10-to-06-20.md)
- [`2026-05-26 to 2026-06-08`](../archive/isometric-changes-archive-2026-05-26-to-06-08.md)
- [`2026-02 to 2026-05-24`](../archive/isometric-changes-archive-2026-02-to-05-24.md)

## 2026-10-16: stored-entry display facts

Batch health uses batch-scoped stored entries and automatic figures.
Facility Energy activity includes counting entries only on reviewed facility
energy sources. These local changes remain behind `EMISSIONS_ENTRIES_ENABLED`;
PR 4 owns Removal-flow zero confirmation and registry contribution compilation.
