# Isometric Certify open questions

Read this before changing registry integration or certification behavior. Entries
follow the [shared open-question rules](./open-questions.md); each needs a code
anchor and evidence before closure. Local code checks do not resolve
`needs-registry-check` questions. Historical registry observations retain their
original dates and are not fresh verification. Protocol pins live in
[versions.json](./isometric/versions.json). Code checked 2026-10-30.

Dated API observations and current readback rules belong in
[registry behavior](./isometric/registry-behavior.md#application-source-readback).

### Applications retain a replaced Storage Location (`isometric/biochar-application-storage-location-replaced`, opened 2026-09-08, `needs-registry-check`)

- **Anchor:** `src/data-access/certifier-storage-locations.ts:replaceMissingStorageLocationRegistration`.
- **Gap:** Dependent Application claims keep their payloads and IDs with `review_required` / `storage_location_replaced`. `ensureBiocharApplication` blocks reuse, including ambiguous creates; unclaimed Applications use the replacement.
- **To resolve:** Confirm the registry correction/supersession contract and provide an explicit recovery preserving the journal and preventing duplicate POSTs.

### Biochar Application Source readback awaits a staging retest (`isometric/biochar-application-source-readback`, opened 2026-09-08)

- **Anchor:** `src/fn/certification/biochar-application-source-readback.ts:checkBiocharApplicationSourceReadback`.
- **Gap:** Exact-ID matching and location-scoped pagination are implemented in [#1514](https://github.com/Maji-Studio/noma-dmrv/pull/1514). Isolated sandbox probes confirm the ID-filter trap and available Source readback, but do not establish the complete evidence-bearing Removal path on staging.
- **To resolve:** Submit one fresh evidence-bearing Removal on staging, then verify persisted Source status and summary refresh. Preserve empty-set propagation retries, mismatch persistence and unconfirmed no-answer behavior. Close this entry only with full-path evidence; [registry behavior](./isometric/registry-behavior.md#application-source-readback) owns the probe details.

### Removal deletion leaves Datapoints behind (`isometric/removal-deletion-orphans`, opened 2026-09-08, `needs-registry-check`)

- **Anchor:** `src/fn/certification/delete-removal.ts:deleteRemoval`.
- **Gap:** Deletion removes owned registry records and released Sources, but leaves Datapoints. Shared Storage Locations stay. The 2026-09-10 MCP/OpenAPI check found irreversible `DELETE /sources/{id}` returning 204, no GHG Entry cascade, and refusal while locked Datapoints, validated assets or verified statements use a Source. Whether orphan draft Datapoints cause that refusal still needs a sandbox check. Source deletion runs after local finalization under `withReleasedDocumentMirrorLock`; refusal records `removal:delete:source` failure without failing local deletion.
- **To resolve:** Decide whether to delete orphan Datapoints, which cannot be deleted while Components use them. Single-document and parent deletes only release local mappings; remote cleanup there needs a durable outbox and remains outside scope. Preserve version-specific supplier references.

### Partial deletion needs a clear recovery state (`isometric/removal-deletion-partial-cleanup`, opened 2026-09-08)

- **Anchor:** `src/fn/certification/delete-removal.ts:deleteRegistryRecords`.
- **Gap:** A GHG Entry may delete before an Application DELETE fails. The claim releases but the ledger retains the deleted GHG Entry ID. Repeating Delete converges through tolerated 404s; Submit can instead reuse that ID and report drift.
- **To resolve:** Decide between deletion-only recovery metadata blocking Submit and explicit recreate-on-404 behavior. Preserve the journal in `src/data-access/certifier-removal-deletion.ts:finalizeRemovalDeletion`.

<a id="fixed-datapoint-deprecation-signal-isometricfixed-datapoint-deprecation"></a>

### Fixed Datapoint deprecation signal (`isometric/fixed-datapoint-deprecation`, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/template-observations/load-enrichment.ts:loadTemplateEnrichment`.
- **Gap:** Enrichment stores `deprecated: null`; the planned deprecated-factor advisory has no authoritative signal. Missing enrichment still blocks; deprecation itself is advisory.
- **To resolve:** Confirm a registry deprecation signal before implementing the advisory.

### Replacement 1,000-year contract and template migration (`certification/fdurable-1000-r0-semantics`, opened 2026-07-03, updated 2026-08-13, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/storage-blueprints.ts:CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR`.
- **Gap:** The replacement `biochar_sequestration_1000_year_f_durable_max` is implemented locally with paired total/inorganic-carbon lists, scalar product mass and `s_fraction`. The historical component used total carbon and uncapped durability, unlike the pinned module calculation. Local implementation does not establish acceptance of the replacement for this project.
- **To resolve:** Confirm Protocol v1.1 applicability, inorganic-carbon property/unit/direct methods, Sample-index pairing, direct scalar mass, sampling-time `measured_at`, and three local Samples becoming three remote Sample rows. Resolve component/module governance against the [pinned module](https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1?tag=1.1.0). A current four-input template was observed in the [2026-10-30 read probes](./archive/2026-10-30-isometric-verification.md); confirm the mapped facility selects it, migrate only if needed while retaining history, then verify submission and supersession. Fresh validation of this replacement contract remains pending; preserve protocol/module/Standard pins and record evidence in [changes.md](./isometric/changes.md).

### Method-B process history and registry contract (`certification/method-b-unlock-track-2`, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/storage-blueprints.ts:STORAGE_BLUEPRINTS` and `src/fn/certification/durability-readiness.ts`.
- **Gap:** Track 2 shipped in #301; historical Method-B reasoning in [ADR 0017](./adr/0017-method-b-unlock-registry-computes-noma-gates-and-previews.md), including its 2026-07-12 amendments, is not authority for the v1.1 pin. Unsampled 200-year binding is gated; unsampled 1,000-year is unsupported. Historical sandbox-only experiments do not establish a production wire contract.
- **To resolve:** Before enabling Method B, confirm the unsampled representation and trailing historical sample pool/average, independent/distributed sampling gate versus warning, and the full production-process cadence window (#417). Synthetic same-day rows are not eligibility evidence. Reverify the v1.1 rule with the blueprint contract (#278), coordinating with #291. DEC was recorded as Method A only; do not infer current operator usage from that historical note.

### 200-year durability units and binding (`isometric/durability-measurement-samples`, opened 2026-06-18, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/transformers/measurement-sample.ts:toHcMolarRatioPercent` and `src/lib/isometric/storage-blueprints.ts:STORAGE_BLUEPRINTS`.
- **Gap:** Both 200-year paths remain gated. The recorded blueprint uses `%` for `h_c_molar_ratios`; local ratios are dimensionless and the builder applies ×100. The recorded API reference instead describes `DIMENSIONLESS_RATIO` / `HYDROGEN_TO_ORGANIC_CARBON_RATIO`. Historical sampled 1,000-year validation does not settle the replacement contract above.
- **To resolve:** Confirm the live input table and unit transform, add explicit binding, and verify sampled and unsampled paths separately. Retain legacy `carbon_rich_substance_sequestration` mapping/tests while any configured facility uses it.

### Ambiguous reconciliation lacks a failed sync event (`isometric/ambiguous-lookup-audit-silence`, opened 2026-06-10)

- **Anchor:** `src/fn/certification/registry-create.ts:reconcileToResult`.
- **Gap:** Multiple candidates reject the ledger row and retain `metadata.lastError` but append no failed sync event. GHG Statements can produce this ambiguity for a project/end date; `tests/registry-boundary-ghg-statement.test.ts` pins the silence.
- **To resolve:** Decide whether to append `ghg_statement:create` failure with ambiguity wording and no response body; update the boundary assertion.

### Reconciliation scans have finite bounds (`isometric/reconciliation-lookup-bound`, opened 2026-08-24, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/storage-locations.ts:findStorageLocationBySupplierReference` and `src/lib/isometric/biochar-applications.ts:findBiocharApplicationBySupplierReference`.
- **Gap:** Without a supplier-reference filter, each lookup stops at 1,000 records, 50 × 20 pages. Storage Locations scan one project; Applications scan the entire visible account. Other list reads use the client default of 10,000 records and throw `IsometricPageLimitError`; Production Batch/Sample scans can therefore block deletion too.
- **To resolve:** Request a registry supplier-reference filter or deliberately raise the relevant lookup/client bound when that specific project or account approaches it. Keep fail-closed behavior rather than risking duplicate POSTs.

### Application future dates need the facility day (`isometric/application-future-facility-day`, opened 2026-10-21)

- **Anchor:** `src/fn/certification/removal-reporting-window.ts:assertRemovalDatesNotFuture`.
- **Gap:** The stored UTC-midnight calendar day is compared with the current instant. East of UTC a valid same-day Application can fail; west of UTC a next-day Application can pass.
- **To resolve:** Compare the application day with `src/lib/date-utils.ts:formatFacilityDate` using the current instant and facility timezone. Keep production-end checks as instant comparisons.

### Application association timing (`isometric/biochar-application-ghg-entry-association`, opened 2026-08-27, `needs-registry-check`)

- **Anchor:** `src/fn/certification/biochar-applications.ts:assertRemoteClaimableForCurrentRemoval`.
- **Gap:** The 2026-08-27 sandbox observation `bse_1M11R23Y2SBXKCE9` had both `ghg_entry_id` and `removal_id` null after persistence. No association is supplied on create. Noma accepts both-null readback and rejects a present association to another GHG Entry.
- **To resolve:** Confirm when either provider-owned association is populated, or whether membership derives from project/reporting dates. Record MCP/OpenAPI or sandbox evidence before closing.

### Deprecated GHG Entry aliases (`isometric/ghg-entry-migration`, opened 2026-06-10, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/generated/certify.d.ts`.
- **Gap:** Noma uses `ghg_entry` routes, but generated deprecated `Removal*`, `GhgStatement.removal_ids` and `Component.removal_template_component_id` fields remain. The original question recorded a September 2026 alias sunset; do not infer current availability from that date.
- **To resolve:** Check the current spec, regenerate types, and remove obsolete test fields and the alias note in [openapi-index.md](./isometric/openapi-index.md) when the spec removes them. No app route migration is expected.

### Facility membership inside an organization (`security/facility-membership`, opened 2026-06-18)

- **Anchor:** `src/data-access/documents.ts:getDocumentById` and `src/data-access/certification.ts:assertSubmissionInFacility`.
- **Gap:** Org isolation and Admin requirements for remote writes exist, but per-user facility access inside an org does not. The 2026-06-18 audit also absorbed `security/document-authz`, opened 2026-06-15: private document reads by UUID prove org membership, not access to the owning entity. Local Removal grouping is not Admin-only.
- **To resolve:** Decide before introducing mutually untrusted facility teams. Build `requireFacilityAccess` first; resolve facility from the anchor row, then gate document/entity, Removal, statement, mapping and sync-event access. Preserve org scope and remote-write Admin floors. A derived `expectedFacilityId` is defense in depth, not membership authorization; do not substitute a created-by-only document rule. Extend `tests/documents-authz.test.ts`. See [ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md) and the [facility-scope audit](./archive/2026-07-09-certification-submit-facility-scope-partial-fix.md).

### Optional database period-overlap constraint (`isometric/ghg-period-overlap-db-constraint`, opened 2026-06-04, deferred)

- **Anchor:** `src/fn/certification/ghg-statements.ts:createGhgStatementDraft` and `src/data-access/facility-certification-boundary-lock.ts:withFacilityCertificationBoundarySessionLock`.
- **Gap:** The create action now serializes its overlap check and registry creation by organization/facility. The old concurrent-action race is resolved. There is still no database exclusion constraint for direct writes; start dates can be null until registry reconciliation.
- **To resolve:** Decide whether direct-write defense warrants a `btree_gist` range exclusion constraint and explicit null-start handling. Preserve the action lock regardless.

### Road factor coverage for the actual fleet (`isometric/transport-fleet-factor-coverage`, opened 2026-05-13, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/utils/aggregation.ts:transportVehicleAdvisories`.
- **Gap:** Mixed vehicles are advisory only; fleet records do not prove GVW classes or that the bound road factor covers the lightest vehicle. [#1017](https://github.com/Maji-Studio/noma-dmrv/issues/1017) owns confirmation; preserve the [#961 factor evidence](https://github.com/Maji-Studio/noma-dmrv/issues/961#issuecomment-6171802000).
- **To resolve:** Confirm fleet GVW per transport category and the active template GLEC row with operator/registry. Rebind `carbon_intensity` if needed and cite the exact row in its Source.

### Vehicle facts after submitted lineage releases (`isometric/transport-released-lineage-snapshots`, opened 2026-05-13, deferred)

- **Anchor:** `src/data-access/vehicles.ts:updateVehicleOnce`.
- **Gap:** Vehicle type/model-year edits skip submitted feedstock legs. Rejection/supersession and regrouping can leave those legs with old snapshots; rebuilding inputs does not refresh fleet facts.
- **To resolve:** Refresh through `src/data-access/transport-legs.ts:syncFeedstockTransportLeg` only after proving no submitted lineage still holds them. Preserve feedstock/artifact/vehicle lock order and test edit, release and regroup for both fields.

### Transport factor provenance and evidence (`isometric/transport-v1.1-evidence`, opened 2026-05-13, deferred, `needs-registry-check`)

- **Anchor:** `src/db/schema/logistics.ts:transportLegs`.
- **Gap:** The recorded Transportation v1.1 §6/Appendix 1 interpretation calls for factor citation/vintage, calibration and vehicle evidence. Recorded vintage limits are road ≤3 years, ship/air ≤5, rail/pipeline ≤7; recheck the authoritative source before enforcing them. No factor-source/vintage/onward-destination columns exist. Noma deliberately doubles stored one-way distance for the empty return; retained documents are separate facts.
- **To resolve:** Confirm applicability before adding fields or gates. Keep current round-trip policy; update [condition-registry.md](./isometric/condition-registry.md), [schema-mapping.md](./isometric/schema-mapping.md) and [P0 checklist](./isometric/p0-compliance-checklist.md) together if requirements change.

### Mixed-mode transport (`isometric/transport-mixed-mode`, opened 2026-05-13, deferred)

- **Anchor:** `src/lib/isometric/utils/aggregation.ts`.
- **Gap:** One `mass_distance` component has one factor. Combining road with rail/ship fails the mixed-mode check; distinct modes cannot share one road scalar.
- **To resolve:** Revisit per-mode component instances when the transport UI permits a non-road mode.

### Blueprint version dimension (`isometric/mapping-version-dimension`, deferred)

- **Anchor:** `src/lib/isometric/semantic-binding-catalog.ts` and `src/lib/isometric/transformers/datapoint.ts:INPUT_MAPPING`.
- **Gap:** The committed spec has no `blueprint_version`. Current quantity/unit guards detect incompatible inputs, but no concrete versioned blueprint determines how catalog keys should evolve.
- **To resolve:** Recheck each spec bump. Choose explicit version keys or unit-dependent alternatives only when a real versioned blueprint appears.

### Structured monitoring submissions (`isometric/phase-5-slice-c`, opened 2026-05-29, deferred, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/generated/certify.d.ts` monitoring-submission routes.
- **Gap:** The recorded route is `POST /projects/{project_id}/monitoring_requirements/{id}/submissions`. The approved MVP requires no continuous reactor gas telemetry.
- **To resolve:** Confirm the registry monitoring-evidence contract if operator demand requires a submission path.

### Facility list endpoint (`isometric/facilities-list-endpoint`, opened 2026-06-10, `needs-registry-check`)

- **Anchor:** `src/components/certification/facility-certifier-dialog.tsx`.
- **Gap:** The recorded API check found no facility list/create route; the committed spec still has no facility list. `externalFacilityId` remains an unvalidated pasted ID from Certify. The missing read capability was filed with Isometric; UI-only creation is intentional.
- **To resolve:** When a real project-scoped facility list exists, replace the free-text field using the existing project-template picker pattern.

### Webhook contract (`isometric/phase-5-webhooks`, `needs-registry-check`)

- **Anchor:** `src/db/schema/certification.ts:certifierProjects` and `src/fn/certification/ghg-statements.ts:refreshGhgStatementStatus`.
- **Gap:** `webhookSecret` exists, but the committed spec has no webhook contract. Operators refresh manually. Payload, signature header and HMAC algorithm remain unconfirmed.
- **To resolve:** Ask Isometric and recheck API docs through the [update playbook](./isometric/update-playbook.md). Build a receiver only after the signed contract is published.

### External statement-version amendments (`isometric/phase-5-external-amendments`, deferred)

- **Anchor:** `src/fn/certification/ghg-statements.ts:refreshGhgStatementStatus`.
- **Gap:** Known local statements expose pending totals and support resubmission, but refresh does not universally claim an external version draft created by direct Certify edits to dates or members.
- **To resolve:** Add a deliberate claim/reconcile flow for externally created statement versions.

### Changed-hash orphan cleanup (`isometric/phase-5-changed-hash-orphans`, deferred)

- **Anchor:** `src/fn/certification/submit-removal.ts` and `src/fn/certification/registry-create.ts:performRegistryCreate`.
- **Gap:** Same-hash retries reconcile saved references; changed inputs intentionally create fresh version references. Resources from an older failed hash can remain unused.
- **To resolve:** Reconcile/report these only if real partial-failure traffic warrants per-Datapoint bookkeeping.

### Stream large Source files (`isometric/sources-stream-large-files`, deferred)

- **Anchor:** `src/fn/certification/sources-mirror-core.ts` and `src/fn/certification/sources-transfer.ts:downloadDocumentBlob`.
- **Gap:** The preflight refuses documents over `SOURCES_MAX_BYTES`, currently 50 MB. Download reads the whole managed object into bytes, then a Blob. The earlier HTTP loopback is gone; whole-file buffering remains.
- **To resolve:** Add provider-to-registry streaming with correct content length only when a real LCA PDF/video exceeds the cap.

### Mirror lock spans remote transfers (`isometric/sources-lock-hold-time`, deferred)

- **Anchor:** `src/fn/certification/sources-mirror-core.ts` mirror transaction.
- **Gap:** The per-document advisory lock spans lookup, create/upload-URL acquisition, storage read and PUT. Submit and visibility changes share the lock; slow transfers serialize other work on that document.
- **To resolve:** Before multi-operator scale, consider locked reservation, unlocked upload and locked completion with persisted upload status. Preserve orphan and visibility fencing.

### Per-Datapoint submission journal (`isometric/phase-4-datapoint-ledger`, deferred)

- **Anchor:** `src/fn/certification/submit-removal.ts` and `src/db/schema/certification.ts:certificationSubmissions`.
- **Gap:** Partial failures can leave successful remote Datapoints without their GHG Entry. The journal does not track each Datapoint independently.
- **To resolve:** Add per-Datapoint resume bookkeeping only if partial failures justify it. Coordinate with changed-hash orphan cleanup.

### PATCH or supersede a changed GHG Entry (`isometric/phase-4-ghg-entry-patch`, deferred, `needs-registry-check`)

- **Anchor:** `src/fn/certification/submit-removal.ts`.
- **Gap:** Changed payloads create a new versioned remote GHG Entry. Which fields the registry permits to change in place, and whether verifier review prefers that, remain unsettled.
- **To resolve:** Confirm mutable fields and lifecycle restrictions before considering PATCH. Preserve the submission journal.

### Per-run operating LIST inputs (`isometric/phase-4-operating-list-inputs`, deferred)

- **Anchor:** `src/lib/isometric/transformers/ghg-entry.ts:buildCreateGhgEntryRequest`.
- **Gap:** LIST inputs already support multiple Datapoint IDs and sampled durability uses them. Operating measurements still aggregate production runs rather than retaining one Datapoint per run.
- **To resolve:** Revisit only when an actual template requires per-run operating values. A Removal may already contain multiple credit batches.

### Legacy URL ownership (`storage/phase-2`, deferred)

- **Anchor:** `src/db/schema/production.ts:productionSamples` and `src/db/schema/feedstock.ts:feedstockTypes`.
- **Gap:** `photoUrl` remains a URL field. `registryUrl` is an external registry-page link, so converting both mechanically to document foreign keys would change their meaning. Neither is automatically the document route's `fileUrl` fallback.
- **To resolve:** Decide whether production photos should become managed documents; preserve external registry links. Any migration needs an explicit evidence-ownership contract. See [storage.md](./storage.md).

### Mirror preflight helper (`code/mirror-preflight-helper`, opened 2026-05-26, deferred)

- **Anchor:** `src/fn/certification/sources-mirror-core.ts` and `src/fn/certification/sources-transfer.ts:buildSourceRequestBody`.
- **Gap:** Inline storage-key, size, MIME and storage-head guards narrow fields manually; the request builder still uses non-null assertions.
- **To resolve:** Extract a helper returning validated locals when this code is next changed.

### Shared database client type (`code/dbclient-alias`, opened 2026-05-26, deferred)

- **Anchor:** `src/data-access/certifier-document-uploads.ts:DbClient` and `src/db/index.ts:DbTransaction`.
- **Gap:** The transaction-or-database type remains local and similar unions recur in data access.
- **To resolve:** Promote a shared alias if repeated usage warrants it.

### Submission test fixtures (`code/isometric-submission-test-fixtures`, opened 2026-05-26, deferred)

- **Anchor:** `tests/isometric-submit-removal.test.ts`, `tests/isometric-sources-mirror-flow.test.ts` and `tests/isometric-ghg-statement-submit.test.ts`.
- **Gap:** Each repeats mock declarations and setup, increasing the cost of submission dependency changes.
- **To resolve:** Share fixture defaults while keeping hoisted `vi.mock` calls in each file. Follow [testing.md](./testing.md).

### Source row on narrow screens (`ux/sources-panel-row-layout`, opened 2026-05-27, deferred)

- **Anchor:** `src/components/certification/sources-panel.tsx:CandidateRow`.
- **Gap:** The 2026-05-27 sandbox test pass recorded Mirror clipping below about 640 px with long filenames. The action row still lacks wrapping; no fresh visual retest establishes closure.
- **To resolve:** Reproduce at narrow widths, then wrap or simplify actions under the [design system](./design-system.md).

### Annual-test direct-emissions attribution (`isometric/pyrolyzer-direct-attribution`, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/datapoint-mapping.ts:lookupPeriodInputTuple`.
- **Gap:** `pyrolyzer_direct` remains a registry-owned PROJECT-scope component; the unresolved point is verifier acceptance of annual-test and throughput-proportional attribution under the v1.1 pin.
- **To resolve:** Ask registry/verifier and retain the fail-closed Removal-scope guard regardless.

### Protocol-pin migration (`isometric/protocol-pin-migration`, opened 2026-06-04, `needs-registry-check`)

- **Anchor:** `docs/isometric/versions.json` and `.claude/workflows/isometric-gap-check.js`.
- **Gap:** #278 owns whether/when to move beyond the project/local v1.1 pin. Current latest-certified versions need registry verification. Editing local pins does not migrate registry templates.
- **To resolve:** Follow #278 impact analysis, registry migration and acceptance checks; rerun the authoritative gap workflow before repinning.

### Wizard failure paths (`certification/wizard-robustness`, opened 2026-06-05)

- **Anchor:** `src/components/certification/new-removal-dialog/submit-step.tsx:SubmitStep`, `src/components/certification/certification-registry-guard.tsx:CertificationRegistryGuard` and `src/fn/certification/create-removal-with-batches.ts:createRemovalWithBatchesAction`.
- **Gap:** Submit callbacks have no synchronous double-fire fence, although the shared confirmation Button already disables while pending; verify any pre-render race before changing it. The registry guard ignores query errors and can redirect a transient failure to Settings, with no loading UI. Batch health is checked before the write transaction; only membership/facility is rechecked under lock.
- **To resolve:** Test the submit race and preserve server idempotency. Add distinct registry error/retry/loading states. Decide whether batch health is point-in-time advisory or must be rechecked under the grouping lock.

### Early template metadata validation (`isometric/template-binding-metadata`)

- **Anchor:** `src/lib/isometric/template-binding-coverage.ts:findUnbindableTemplateInputs`.
- **Gap:** Quantity-kind/unit mismatch, missing blueprint input and missing fixed Datapoint ID can still fail later in the builder. The builder remains fail-closed; coverage runs from several callers with differing blueprint availability.
- **To resolve:** Extract common validation, pass resolved blueprints consistently and test refusal before registry writes.

### Per-project protocol version (`isometric/project-protocol-version`, opened 2026-10-17)

- **Anchor:** `src/db/schema/certification.ts:certifierProjects` and `src/fn/certification/protocol-version-preflight.ts:checkProtocolVersionAtSubmit`.
- **Gap:** The nullable project column is not set by mapping. Settings shows global pins; submission normally records a missing-version warning. #1092 did not settle this choice.
- **To resolve:** Choose an operator-recorded per-project version for mismatch detection, or remove the column/preflight warning if the global pin is sufficient. Recheck registry availability before relying on an API field.

### Corrections after finalization (`isometric/post-finalization-correction`, opened 2026-10-19, parked, `needs-registry-check`)

- **Anchor:** `src/lib/isometric/production-batches.ts:createProductionBatch` and `src/data-access/certifier-removal-deletion.ts:finalizeRemovalDeletion`.
- **Gap:** Before finalization, Removal deletion is the correction path. Noma has no post-finalization replacement flow; the recorded API contract has no Production Batch/MeasurementSample PATCH.
- **To resolve:** Parked by Kenji on 2026-10-19 under #632; #1112/#1113 stay closed until a real case. Reopening starts with Isometric confirming replacement acceptance or provider-side amendment.

### Delete visibility for mirrored documents (`isometric/mirrored-document-delete-ui`, opened 2026-10-20, deferred)

- **Anchor:** `src/data-access/documents.ts:releaseUnreferencedIsometricMapping` and `src/components/samples/sample-documents-panel.tsx:SampleDocumentsPanel`.
- **Gap:** Since #1188 the server refuses a Member deleting a mapped document or parent, but document panels lack mapping-aware presentation and still offer Delete.
- **To resolve:** Expose mapping facts and hide/disable Delete below `REMOVAL_REGISTRY_DELETION_MIN_ROLE` on document panels and parent records.
