# Isometric Certify Open Questions

Registry-specific deferred decisions indexed from
[`open-questions.md`](./open-questions.md). The schema, invariants, resolution
rules, and `needs-registry-check` requirements defined there apply here.

Current interpretation pin: Biochar Protocol v1.1 with the five module versions
in [`docs/isometric/versions.json`](./isometric/versions.json). Resolved or
retired questions do not belong in this file.

### Template component → dmrv source mapping is hardcoded by display name (`certification/template-component-source-wizard`, opened 2026-07-04)

- **Decision needed** — where should the "this template component carries this
  dmrv aggregated source" mapping live? Today it's the code constant
  `PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT`
  (`src/lib/isometric/transformers/datapoint.ts`), keyed by component **display
  name** because Certify exposes no stable per-component key. Full rationale is
  in the code comment above that constant — do not restate it here.
- **Why it matters** — a display-name rename in the Isometric UI fails closed
  with a `SafeError` (can't mis-submit) but blocks the submit until code catches
  up, coupling the registry template to a deploy no operator can do.
- **To resolve** — a facility-configurable component→source mapping (persisted
  on the certifier mapping row) plus an assignment wizard in facility settings;
  the constant becomes the seed/default. Scope it when a second multi-component
  `(group, blueprint, input)` triple appears — today only the pyrolysis
  generator/startup diesel split collides. Structural umbrella: **#291**.

### Replacement 1,000-year component confirmation and template migration (`certification/fdurable-1000-r0-semantics`, opened 2026-07-03; updated 2026-08-13)

- The pinned Biochar Storage in Agricultural Soils v1.1 module's Eq.6 and the
  deprecated `biochar_sequestration_1000_year` component do not express the same
  calculation. That historical component used total carbon and uncapped
  durability.
- The observed replacement is
  `biochar_sequestration_1000_year_f_durable_max`. It consumes paired total and
  directly measured inorganic-carbon lists, `s_fraction`, and product mass;
  calculates organic carbon per replicate; applies the binomial lower estimate;
  and caps durability at 0.95. noma implements this contract locally while
  retaining registry authority.
- **Still open — needs-registry-check:** confirm the replacement formally
  governs this Protocol v1.1 project, confirm the expected inorganic-carbon
  measurement property/unit and acceptable direct methods, confirm pairing by
  Sample/index, and resolve the component-versus-module governance discrepancy.
- **Still open — needs-registry-check:** confirm the current component accepts
  standalone direct `product_mass`, confirm `measured_at` should be the physical
  sampling instant, and verify that three local Samples appear as three remote
  Production batch Sample rows with one scalar mass binding. The code implements
  this preferred contract but has not yet written fresh sandbox data.
- **Still open — external action:** migrate the sandbox template without
  deleting historical templates, then verify one complete submission and
  supersession. No external system was mutated by the code implementation.
- Protocol/module/Standard pins remain unchanged.
  Authoritative pinned module:
  <https://registry.isometric.com/module/biochar-storage-agricultural-soils/1.1?tag=1.1.0>.
  Record the answer in [`docs/isometric/changes.md`](./isometric/changes.md).

### Credit-batch lab-sampling — Method-B Track 2 unlock followups (`certification/method-b-unlock-track-2`)

Track 2 shipped in PR #301
([ADR 0017](./adr/0017-method-b-unlock-registry-computes-noma-gates-and-previews.md),
incl. its 2026-07-12 amendments). Three things remain. DEC runs Method A
everywhere today, so none of this blocks current work — but do not enable
Method B until all three close.

- **`_unsampled` registry wire contract — needs-registry-check.** The live
  `_unsampled` POST stays sandbox-only (`ISOMETRIC_ENVIRONMENT === "sandbox"`)
  because the submitted representation is unconfirmed. The
  working product expectation is to reuse the trailing eligible historical sample
  pool/average rather than require three new 1000-year replicates per unsampled
  batch — but noma must not invent it. Also unconfirmed: whether
  independent/distributed sampling is a hard eligibility gate or an operator
  warning (synthetic same-day rows are not proof in QA either way).
- **Fail-closed gate shape at process grain → #417.** Method-B cadence is
  a production-process history rule, not just the removal member-batch subset;
  the live gate must load the full process batch window or accept an explicit
  process-level cadence fact.
- **Pinned-version dependency → #278.** The project and local interpretation
  are pinned to Biochar v1.1. ADR 0017's historical v1.3 reasoning is not
  sufficient evidence for more v1.1 credit-bearing Method-B logic. Re-verify
  the relevant v1.1 rule and the unsampled blueprint contract together. Also
  coordinate with #291 so the submission layer is not double-built.

### 200-year durability binding confirmation (`isometric/durability-measurement-samples`, opened 2026-06-18)

The sampled 1,000-year measurement-sample path is sandbox-verified and no
longer an open implementation question. The remaining question is 200-year
only. Its builders and aggregation exist, but submission fails closed because
the input binding and one unit transform remain unconfirmed.

- **H/C unit transform — needs-registry-check.** The 200-year blueprint declares
  `h_c_molar_ratios` in `%` while samples store a dimensionless molar ratio
  (~0.5); `toHcMolarRatioPercent`
  (`src/lib/isometric/transformers/measurement-sample.ts`) applies ×100 as the
  most likely transform. The Certify measurement-samples reference lists H:C as
  `DIMENSIONLESS_RATIO` / `HYDROGEN_TO_ORGANIC_CARBON_RATIO`, which may make the
  ×100 wrong. Verify the live template's blueprint input unit before adding the
  200-year explicit binding.

After the unit and live component-input table are confirmed, add the explicit
200-year binding, verify both sampled and unsampled behavior separately, and
only then retire the legacy `carbon_rich_substance_sequestration` mapping and
its tests. Do not delete the legacy mapping while a configured facility still
uses it.

### Ambiguous-lookup rejection records no failed sync event (`isometric/ambiguous-lookup-audit-silence`, opened 2026-06-10)

- **When a registry create's reconcile lookup finds MULTIPLE candidates** (today
  only reachable for GHG Statements — several DRAFT statements for one
  `(project, end_on)`), `performRegistryCreate`
  (`src/fn/certification/registry-create.ts`) rejects the ledger row and throws
  the caller's ambiguity message **without writing a failed sync event**.
  Deliberate Phase 2 parity with the pre-module GHG behavior.
- Not blind: the reason survives in the ledger row's `metadata.lastError` and
  the row status flips to `rejected`. But the statement's
  `certifier_sync_events` timeline just stops — the detail panel's "recent sync
  events" list shows nothing for the failed attempt.
- Phase 3's boundary test pins current behavior by assertion
  (`tests/registry-boundary-ghg-statement.test.ts`) with a pointer here — flip
  that assertion when this is resolved.
- **Resolve via:** decide whether ambiguity should append a `status: "failed"`
  sync event (operation `ghg_statement:create`, errorMessage = the ambiguity
  wording, no response body). One-line change in `reconcileToResult` plus the
  pinned assertion; no migration.

### Supplier-reference reconciliation is a bounded full-list scan (`isometric/reconciliation-lookup-bound`, opened 2026-08-24)

- Neither endpoint exposes a supplier-reference filter, so each
  reconcile-before-POST lookup performs a bounded paginated scan. Storage
  Location lookup is scoped to one Isometric project by
  `GET /projects/{project_id}/storage_locations`; its independent 1,000-record
  bound (50 x 20 pages) therefore applies per project, and exceeding it blocks
  new site registration for that project. Biochar Application lookup uses the
  unscoped `GET /biochar_applications`; it scans every application visible to
  the credential/account, with its own independent 1,000-record bound, and
  exceeding that account-visible bound blocks new application registration.
  Both paths fail loudly instead of risking a duplicate POST
  (`src/lib/isometric/storage-locations.ts`,
  `src/lib/isometric/biochar-applications.ts`).
- **Resolve via:** ask Isometric for a supplier-reference filter (report via
  MCP `submit_feedback`), or raise `DEFAULT_LOOKUP_MAX_PAGES` when a project or
  credential/account approaches its respective bound.

### Biochar Application GHG Entry association timing (`isometric/biochar-application-ghg-entry-association`, opened 2026-08-27)

- **Observed — needs-registry-check:** sandbox Biochar Application
  `bse_1M11R23Y2SBXKCE9` was fully persisted with both provider-managed
  `ghg_entry_id` and `removal_id` null. The create request exposes no GHG Entry
  field, so `assertRemoteClaimableForCurrentRemoval`
  (`src/fn/certification/biochar-applications.ts`) accepts both-null readback,
  records the null observations, and still rejects any present association to a
  different GHG Entry.
- **Still open — needs-registry-check:** confirm whether and when Isometric sets
  either association, and whether inclusion in a GHG Entry is instead derived
  from project and reporting-window facts. Close this only after `how_to` plus
  the relevant OpenAPI/protocol check or a sandbox probe documents the
  provider-owned lifecycle in [`docs/isometric/changes.md`](./isometric/changes.md).

### GHG Entry deprecated-alias cleanup after the September 2026 sunset (`isometric/ghg-entry-migration`, opened 2026-06-10)

noma already calls only the `ghg_entry` route family. The remaining work begins
after the confirmed alias sunset:
  (a) regenerate `certify.d.ts` — the deprecated `Removal*` schemas and the
  `GhgStatement.removal_ids` / `Component.removal_template_component_id` keys
  disappear, so the test mocks still carrying both old+new fields
  (`isometric-reconciliation.test.ts`, `isometric-ghg-statement-flow.test.ts`,
  `isometric-ghg-statement-submit.test.ts`) drop the deprecated keys; (b) drop
  the deprecated-`/removals*`-alias note from
  [`docs/isometric/openapi-index.md`](./isometric/openapi-index.md), which now
  carries the aliases as prose rather than marked rows. No app-code route
  migration is expected.
### GHG entry / statement free-field follow-ups (`isometric/ghg-entry-free-fields`, opened 2026-06-10)

The migrated surface returns fields noma does not yet capture — new capability,
not a blocker:

- **Credit allocation / buffer pool.** `GhgEntry` + `GhgStatement` expose
  `risk_of_reversal_percentage` and `credit_allocation`
  (`buffer_pool_contribution_kg` / `supplier_allocation_kg`). Surfacing the
  split is new UI. Relates to the dropped `reversal_risk_assessments` table.
- **Source `description`.** Optional human-readable label now accepted on
  `POST /sources` / `PATCH /sources/{id}` (we pass the `Undefined` sentinel).
  Wire it when the Sources panel grows a label.

### Per-user facility membership within an organization (`security/facility-membership`, opened 2026-06-18)

The only surviving question from the 2026-06-18 authz audit. Org isolation
itself is **built and enforced** — see the invariants section,
[ADR 0010](./adr/0010-shared-schema-org-column-tenancy.md),
[`docs/organization.md`](./organization.md), and the `tests/e2e/org-isolation.spec.ts`
/ `tests/e2e/organization-settings.spec.ts` specs. What does not exist is a
"user X may access facility Y" check *inside* an org.

- **Current authorization:** irreversible Isometric writes require organization
  Admin role: Removal submit, telemetry submit, GHG Statement create/submit,
  Source mirror, report prepare/approve, and mapping changes. The local
  `createRemovalWithBatchesAction` grouping step is facility/org-scoped but is
  not Admin-only because it creates no remote registry resource.
- **Consequence:** an Admin may act on any facility in the organization; an
  ordinary member may still read/manage organization-scoped resources according
  to the current entity actions, including local Removal grouping. A decision is
  needed before an organization contains mutually untrusted facility teams.
- **The durable lesson (do not regress):** a server action must resolve the
  facility from the **anchor row**, never from a client-supplied field. The
  shipped seam `resolveSubmissionFacilityId` / `assertSubmissionInFacility`
  (`src/data-access/certification.ts`) does exactly this, and the id/key-addressed
  reads take an optional `expectedFacilityId`. It is defence-in-depth +
  fail-closed on a dangling anchor, **not** an access check — every wired caller
  derives the expected facility from the same anchor id it is reading. Detail:
  [`docs/archive/2026-07-09-certification-submit-facility-scope-partial-fix.md`](./archive/2026-07-09-certification-submit-facility-scope-partial-fix.md).
- **Documents are blocked on the same decision** (was
  `security/document-authz`, opened 2026-06-15). `getDocumentById` /
  `updateDocument` / `setDocumentVisibility` / `assertCanManageDocumentEntity`
  (`src/data-access/documents.ts`) all take `ctx: OrgContext`, call
  `requireOrgScope(ctx)`, and filter on `documents.organizationId`, so
  **cross-org reads are refused** — including via the `/api/documents/[id]`
  presigned-download redirect. What is missing is *intra-org* narrowing: any org
  member can read any private document in that org by UUID without proving
  access to the owning `(entityType, entityId)`, so the
  `visibility: public | private` column encodes a boundary org scoping alone
  doesn't enforce. Fold document reads/mutations through the facility/entity
  check once membership lands (a `createdBy`-only stopgap is too tight —
  operators share documents on shared entities) and implement the `it.todo`
  negative tests in `tests/documents-authz.test.ts` against the scoped helper.
- **Resolve via:** build a real `requireFacilityAccess(ctx, facilityId)` first
  (do not wire calls to a missing helper), then gate every
  removal/statement/telemetry/mapping accessor on the *resolved*
  facility, preserve the Admin requirement for remote writes, and audit all `localEntityId`
  accessors in `certifier_sync_events` for the same shape. Also swap
  `resolveEntityFacility` (`src/data-access/transport-legs.ts` — the polymorphic
  parent-chain walk that already closed the orphan-mutation hole) for the new
  helper at that one chokepoint, then propagate.
- **Pattern to copy:** `mirrorDocumentToSource` enforces a forgery-proof
  document→removal lineage anchor
  (`assertDocumentIsCandidateForRemoval`); `reconcileRemovalMembership` is
  facility-predicated + `FOR UPDATE` internally.

### GHG-statement period-overlap: app-layer guard vs. DB constraint (`isometric/ghg-period-overlap-db-constraint`, opened 2026-06-04)

- Non-overlapping reporting periods are enforced in `createGhgStatementDraft`
  (reject an `end_on` ≤ the latest other statement's end) and mirrored in the
  create dialog. A read-then-write check, not a DB invariant.
- A truly concurrent pair of creates with overlapping periods could both pass
  (TOCTOU). Low likelihood — periods are consecutive and the
  `(provider, facility, end_on)` unique constraint blocks exact dupes — but not
  airtight.
- **Resolve via:** a Postgres `EXCLUDE USING gist` range constraint on
  `(facility_id, daterange(reporting_period_start_on, reporting_period_end_on))`
  once start dates are reliably populated (they're reconciled post-create, so a
  draft row has a null start until Isometric returns the window — the constraint
  must tolerate that or be deferred). Decide if the DB guarantee is worth the
  `btree_gist` extension + null-start handling.

### Transport-leg compliance follow-ups (opened 2026-05-13)

- **Per-leg evidence model deferred** (`isometric/transport-v1.1-evidence`).
  - Isometric Transportation v1.1 §6 + Appendix 1 require: emission-factor
    source citation, factor vintage by mode (road ≤3 y, ship/air ≤5 y,
    rail/pipeline ≤7 y), round-trip vs. onward-leg evidence, distance-method
    fallback justification (§3.1 "appropriately evidenced"), weigh-scale
    calibration record, vehicle class/model year.
  - **Current state** (`src/db/schema/logistics.ts`): `tripType` **exists**
    (`'return'` default, ×2 multiplier — see the invariants section), as do
    `billOfLading` and `weighScaleTicketRef`. There is **no**
    `emissionFactorSource` column anywhere in the schema, and none for factor
    vintage, onward destination, or fallback evidence. Form text mentions §3.2
    but validators do not enforce.
  - **Resolve via:** a dedicated PR with a Drizzle migration adding the columns,
    condition-registry rules
    ([`docs/isometric/condition-registry.md`](./isometric/condition-registry.md)),
    refreshed [`docs/isometric/schema-mapping.md`](./isometric/schema-mapping.md)
    rows 30–32, and three new entries on
    [`docs/isometric/p0-compliance-checklist.md`](./isometric/p0-compliance-checklist.md)
    (P0-16 method-hierarchy + fallback evidence, P0-17 per-leg round-trip
    default, P0-18 factor vintage by mode).

- **Mixed-mode transport** (`isometric/transport-mixed-mode`) — **deferred.** One
    `mass_distance` component carries one emission factor, so rail/ship legs
    (different EF) cannot be summed into a road tonne·km scalar — today they
    trip the mixed-factor warning and block submission. Supporting them needs
    per-mode component instances. Out of scope while the transport UI is
    road-only; re-raise when a non-road mode is enterable.

### Blueprint versioning in `INPUT_MAPPING`

- **Blueprint version dimension in `INPUT_MAPPING`**
  (`isometric/mapping-version-dimension`) — **deferred**.
  - **Question:** when Isometric introduces blueprint versioning (e.g.
    `carbon_content` moving from `dimensionless` to `mass_fraction` in
    `pyrolysis@v2`), how should `INPUT_MAPPING` represent the version dimension
    — a 4-tuple `(group, blueprint, blueprintVersion, input)`, an
    N-entries-per-input branch-on-`compatible_unit` model, or something else?
  - **Why deferred:** the Certify OpenAPI exposes no `blueprint_version` field
    (verified by grep across `src/lib/isometric/generated/certify.d.ts`). With
    no concrete example, any decision would be speculative. The submit-time unit
    guards in `src/lib/isometric/transformers/datapoint.ts` plus the nightly
    coverage check catch type/unit mismatches; no near-term integrity risk.
  - **Resolve via:** re-read the OpenAPI on any spec bump; reopen the first time
    Isometric ships a versioned blueprint.

### Phase 5 Slice B / C deferrals (opened 2026-05-29)

Scoped out of the Phase 5 Slice A design (biochar reactor time-series via
Parquet — [ADR 0006](./adr/0006-data-upload-submission-idempotency.md)). The
Slice A server pipeline exists but its UI is dark. Each item below is
independently shippable when its upstream primitives and operator demand exist.

- **Deleted Storage Location recovery** (`isometric/storage-location-recovery`).
  If an already-journaled remote Storage Location returns 404, noma marks its
  immutable registration drifted and does not recreate it automatically. A
  future operator recovery flow must explicitly decide whether to forget and
  replace that identity; sandbox sync currently requires manual registry review.

- **Slice C — `MonitoringSubmission`** (`isometric/phase-5-slice-c`).
  `POST /projects/{project_id}/monitoring_requirements/{id}/submissions` —
  structured-by-requirement submissions, parallel to the bulk Parquet path.
  Deferred because it overlaps Slice A's purpose; without operator demand we
  don't know which is the canonical home for which protocol-mandated
  measurement. **Resolve via:** ask Isometric directly whether reactor
  temperature/pressure belongs in `MonitoringSubmission` or
  `DataUploadSubmission`. If the former, consider whether Slice A's hourly
  aggregator becomes a `MonitoringSubmission` feeder rather than a Parquet writer.

### Isometric Certify API — no facilities LIST endpoint (`isometric/facilities-list-endpoint`, opened 2026-06-10)

- Filed with Isometric as a missing capability. The Certify API exposes **no way
  to enumerate facilities** — verified against the live operation list: no
  `GET /facilities`, no `GET /projects/{project_id}/facilities`, no
  `POST /facilities`. The facility id (`fcl_…`) appears only as a stored scalar
  on other resources.
- **Why it matters:** the facility certifier mapping's "Isometric facility
  (telemetry)" field (`externalFacilityId`) is therefore a free-text paste —
  operators create the facility in the Certify UI then hand-copy the id into
  noma (`facility-certifier-dialog.tsx`). Error-prone (typo → telemetry
  submitted against the wrong facility), and it is the one mapping field with no
  validation against a real list. Creation being UI-only is fine and
  intentional; the gap is purely the missing read.
- **Resolve via:** when a read endpoint ships (ideally
  `GET /projects/{project_id}/facilities` returning id + display name), mirror
  the existing template-picker chain: `listFacilitiesByProject()` in
  `src/lib/isometric/projects.ts` → a `useIsometricProjectFacilities(projectId)`
  hook (pattern: `useIsometricProjectTemplates`) → swap the free-text
  `FormInput` for a `FormSelect`.

### Phase 4 deferrals

- **Isometric webhook contract availability** (`isometric/phase-5`).
  When will Isometric publish a webhook event schema, signature header, and HMAC
  algorithm? Blocks any automated reconciliation of GHG-statement state.
  `certifierProjects.webhookSecret` exists in the schema, but Certify's OpenAPI
  declares `webhooks = Record<string, never>` and no webhook topic exists in the
  docs. Today users rely on the manual "Refresh" button calling
  `refreshGhgStatementStatus`. A receiver built now would be guessing payload
  shape, header name, and algorithm. **Resolve via:** ask Isometric support;
  check `api-reference/` quarterly via
  [`docs/isometric/update-playbook.md`](./isometric/update-playbook.md). Once
  published, build a certification webhook route with HMAC and reconciliation
  tests.

- **External GHG statement amendment claiming** (`isometric/phase-5`).
  Detect when an admin edits statement dates or attached Removals directly in
  Isometric and the registry creates a new statement-version draft noma has not
  claimed. Phase 4 surfaces `pending_total_co2e_removed_kg` and supports
  resubmission against the known local row, but does not compare the local
  `externalId` against the registry's current period draft on every refresh.
  **Resolve via:** a claim/reconcile flow for external statement-version drafts.

- **Hash-changed partial-orphan cleanup** (`isometric/phase-5`).
  Reconcile or report Datapoints/Removals created by a failed attempt when local
  inputs changed before the retry, producing a new payload hash and new supplier
  refs. Same-hash retries reuse stored refs and reconcile before POST, but
  changed-hash retries intentionally create a fresh version, so remote resources
  from the failed old hash can remain orphaned. **Resolve only if** production
  traffic shows this often enough to justify per-Datapoint sub-ledger bookkeeping.

- **Stream large source files** (`isometric/sources-stream-large-files`).
  Phase 3.5 caps mirror size at 50 MB with a **pre-flight** check —
  `if (document.fileSizeBytes > SOURCES_MAX_BYTES)` in
  `src/fn/certification/sources.ts` — and larger documents fail loud with a
  `SafeError`. The download itself buffers via `response.blob()`
  (`src/fn/certification/sources-transfer.ts`). **Resolve via:** pipe
  `response.body` from the noma storage download directly into the Isometric PUT
  with `duplex: "half"` (needs careful `Content-Length` handling). Defer until a
  real LCA PDF or video exceeds the cap.

- **Mirror lock held across Isometric HTTP round-trips**
  (`isometric/sources-lock-hold-time`).
  `mirrorDocumentToSource` holds the per-document mirror advisory lock across
  three Isometric calls (`findSourceBySupplierRef`, `createSource` /
  `requestSignedUploadUrl`, `putBlobToSignedUrl`) plus the storage download.
  Since `submitRemoval` and `setDocumentSourceVisibility` also acquire it, a
  slow 50 MB upload stalls every concurrent submit + visibility flip on the same
  document. Logged as the main scalability tradeoff to revisit before
  multi-operator workloads. **Resolve via:** split mirror into a `reserve` phase
  (lock, look up remote, request upload URL, persist a `pending` mapping,
  release) and an `upload` phase (PUT without the lock, re-acquire briefly to
  flip `pending → ready`). Adds one `upload_status` column to
  `certifier_document_uploads` and one DB round-trip per mirror.

- **Per-Datapoint ledger sub-rows** (`isometric/phase-4`).
  Add `submissionType='datapoint'` rows in `certification_submissions` so a
  re-submit short-circuits successfully-POSTed datapoints from a prior failed
  attempt. Phase 3 leaks orphan datapoints in Certify on partial-failure
  re-submits; the leaked rows have no Removal reference — cosmetic clutter, not
  a data-quality issue. **Resolve only if** partial-failure rates rise.

- **PATCH `/ghg_entries/{id}` vs supersede-and-create** (`isometric/phase-4`).
  The current flow creates a new versioned remote GHG Entry on payload changes. If
  Certify supports in-place PATCH for selected fields and verifier UX prefers
  it, branch 3e gains a PATCH path (more accurate audit trail when only metadata
  changes; no v=2 Removal flooding the registry UI). **Resolve via** reading
  Certify's PATCH docs and confirming which fields are mutable post-creation.

- **`LIST` data-shape inputs receiving multiple datapoints**
  (`isometric/phase-4`).
  `CreateComponentListInput.datapoint_ids[]` accepts N IDs, but Phase 3
  aggregation collapses N runs into a single value, so list inputs receive a
  one-element array. Today's protocol-level UX is "one credit batch = one
  Removal" with aggregated values. **Resolve only when** a template surfaces
  that needs a per-run breakdown.

- **Per-column upload-URL field migration** (`storage/phase-2`). *(Misfiled — a
  storage concern sitting inside the Isometric section; move on next touch.)*
  Four plain-text URL columns survive: `r0HistogramFileUrl` and
  `tgaThermogramFileUrl` (`src/db/schema/production.ts`), `photoUrl` (same file,
  `production_samples`), and `registryUrl` (`src/db/schema/feedstock.ts`).
  (`plc_data_file_url` and `emissions.source_url` no longer exist.)
  Phase 2 plan: add a `*_document_id` FK alongside each, backfill via UI, drop
  the URL column — routing all uploaded evidence through the single `documents`
  table (one audit trail, one storage-key convention, one visibility model, see
  [`docs/storage.md`](./storage.md)). Not urgent; existing URL fields keep
  working as external/legacy links via the `/api/documents/[id]` proxy route's
  `fileUrl` branch.

### Phase 3.5 source-mirroring hardening — deferred simplifications (opened 2026-05-26)

Surfaced by the `/simplify` pass after the P1/P2 fix set. All below the
threshold for the same PR; revisit next time the area is touched.

- **Extract `assertDocumentReadyForMirror` pre-flight from
  `mirrorDocumentToSource`** (`code/mirror-preflight-helper`). Ten sequential
  `SafeError` throws on document nullability fields (`storageKey`,
  `fileSizeBytes`, `mimeType`, head size match, …) plus post-validation
  narrowing tricks. Lifting it to a helper that returns narrowed locals would
  also delete the `!` non-null assertions in `buildSourceRequestBody`.

- **Export `DbClient = DbTransaction | typeof db` from `@/db`**
  (`code/dbclient-alias`). `src/data-access/certifier-document-uploads.ts`
  defines the alias locally; `src/data-access/applications.ts` writes the union
  inline at 3 sites. As more data-access modules accept optional `tx`, the
  duplication compounds.

- **Shared test fixture builder for Isometric submission tests.**
  `tests/isometric-submit-removal.test.ts`,
  `tests/isometric-sources-mirror-flow.test.ts`, and
  `tests/isometric-ghg-statement-submit.test.ts` each repeat ~8 `vi.mock(...)`
  declarations and a similar `beforeEach` block; a new data-access dependency in
  `submit-removal.ts` typically breaks all three. **Resolve via:**
  add a shared fixture builder exporting the mock path list and per-test
  defaults. Note `vi.mock` factories are hoisted, so each file still calls them
  in its hoisted section. See [`docs/testing.md`](./testing.md).

### Phase 3.5 Sources panel test-pass follow-ups (opened 2026-05-27)

Surfaced while exercising the Sources panel against the sandbox (Cases A–H).
A–E and the precondition guards (G/H) passed; the three below were band-aided or
are clean deferrals.

- **`storage/sources-storage-loopback` — replace the HTTP loopback in
  `downloadDocumentBlob` with a `getObjectStream(key)` on `StorageProvider`.**
  `src/fn/certification/sources.ts` issues a presigned URL then `fetch`es it
  back from the same server. In dev that flows through `/api/storage/...` and
  requires `STORAGE_SIGNING_SECRET`; the round trip duplicates network and
  signing work an internal stream would avoid. **Resolve via:** add
  `getObjectStream(key): Promise<{ stream, contentType, contentLength }>` to the
  `StorageProvider` interface (local-fs + S3 + GCS) and call it directly.
  Browser→storage signed URLs stay for genuine browser use. Removes one HTTP hop
  per mirror, shrinks the loopback-host allowlist surface, and kills the dev-only
  `STORAGE_SIGNING_SECRET` dependency on this path.

- **`storage/sources-sync-events-tx` — move `certifier_sync_events` writes out
  of the mirror business transaction. ⚠️ NOT MITIGATED — live at the default
  pool size.** `appendSyncEventBestEffort` (`src/fn/certification/shared.ts`)
  runs on the root `db` while being called from inside the transaction opened in
  `mirrorDocumentToSource` (`src/fn/certification/sources.ts`). With a
  single-connection pool the audit write deadlocks waiting for a connection held
  by the open business transaction — **the same pool-starvation failure the
  `assertSameOrg` `executor` parameter exists to prevent** (see the invariants
  section).
  A previous version of this entry claimed the risk was band-aided with
  `DB_POOL_MAX=10`. **That is false.** `src/db/index.ts` runs
  `max: env.DB_POOL_MAX ?? 1` and `.env.local` records `DB_POOL_MAX skipped — no
  "DB_POOL_MAX" field in the 1Password item`, so the effective pool size is
  **1** and the starvation path is fully live. Treat this as unmitigated until
  fixed.
  **Resolve via:** accumulate event payloads in a closure and flush after the
  transaction settles (success or rollback). Touch points:
  `src/fn/certification/sources.ts` (`withSourceSyncEventOnFailure`, the
  `appendSyncEventBestEffort` calls inside the mirror transaction),
  `src/data-access/certification.ts` (`appendSyncEvent`).

- **`ux/sources-panel-row-layout` — Mirror clips on narrow viewports.** The
  Mirror action in `src/components/certification/sources-panel.tsx` can clip
  below ~640px when filenames are long. Pure UX follow-up: wrap the action row
  or go icon-only on narrow viewports. See
  [`docs/design-system.md`](./design-system.md).

### Annual-test attribution for `pyrolyzer_direct` (`isometric/pyrolyzer-direct-attribution`)

`pyrolyzer_direct` is already settled as a registry-owned PROJECT-scope
Component, guarded against Removal-scope zero stubs by
`PERIOD_INPUT_TUPLES`.

- **Still open — needs-registry-check:** whether Isometric or a verifier accepts
  annual-test plus throughput-proportional PROJECT-scope attribution, given the
  pinned Biochar v1.1 reporting-period/direct-emissions requirements. Keep the
  fail-closed scope guard regardless of the answer.

### Pinned biochar protocol behind latest certified (opened 2026-06-04)

**Owned by #278** — impact analysis, acceptance checklist, and the
migration sequence all live there; do not duplicate them here. Local pins are in
[`docs/isometric/versions.json`](./isometric/versions.json): the project and
local interpretation are pinned to Biochar Protocol v1.1. The remaining
question is whether and when to migrate beyond that pin; the real work is
registry-side (including template re-authoring), so editing the file migrates
nothing. **Which versions are currently latest-certified is
needs-registry-check** — do not restate unverified latest-version numbers. Re-run
`.claude/workflows/isometric-gap-check.js` on any bump to regenerate the
authority-vs-docs-vs-code gap list before re-pinning.

### Submit-context builder N+1 on selection/submit hot paths (`certification/submit-context-n+1`, opened 2026-06-05)

- Two N+1s remain in the shared submission-context builder, now living in
  `src/fn/certification/certify-context-core.ts` (`certify-context.ts` keeps
  `loadSelectableBatchesForFacility` only as a thin re-export). The
  selectable-batches path loops a full `buildRemovalContext` per ungrouped batch
  — each iteration walks that batch's applications through
  `getChainOfCustodyData` (~6 queries/application) plus production-run and
  transport-leg loads; and `resolveScopeForRemoval` resolves member
  `applicationIds` + `co2eStoredPreview` per member (≈2×M queries).
- **Why it matters:** the New-Removal wizard's first step and the submit path;
  cost scales with batches × applications-per-batch. The per-batch Isometric
  *remote* calls were already hoisted and the create-removal confirm loop fixed
  (`buildCreditBatchContexts` loads facility facts once) — what's left is
  the per-batch DB lineage fan-out.
- **Resolve via:** rework `buildRemovalContext` to batch the lineage walks across
  a batch set (one chain-of-custody resolve keyed by all `applicationIds`, one
  transport-leg query over all entity ids), or add a lighter projected
  fact-loader for the ungrouped-batch health verdict. **Constraint:**
  `resolveScopeForRemoval` intentionally does per-batch preview work because the
  submit summary needs `co2eStoredPreview` per member — a grouped optimization
  must still supply it. The builder is shared with `submitRemoval`, so verify
  both paths. High-risk; wants a focused pass, not a mechanical edit.

### Wizard robustness gaps (`certification/wizard-robustness`, opened 2026-06-05)

Three failure-path gaps, each a surprising mode before a registry write:

- **Submit double-fire:** `SubmitConfirmDialog.onConfirm`
  (`src/components/certification/new-removal-dialog/submit-step.tsx`) calls
  `fireSubmit(true)` unconditionally; a double-activate before `isPending` flips
  can fire the mutation twice. (Server submit is ~idempotent; the primary Submit
  button is already `busy`-guarded.) **Fix:** guard with
  `if (submitMutation.isPending) return;` and disable the confirm while pending.
- **Registry-guard error path:** `CertificationRegistryGuard`
  (`src/components/certification/certification-registry-guard.tsx`) ignores the
  certifier-summary query's `error` — a transient fetch failure reads as "no
  registry" and silently redirects the operator from every certification page to
  Settings. It also renders bare `null` while loading. **Fix:** an explicit
  error/retry state distinct from "no registry", plus a loading affordance.
- **Batch-health TOCTOU:** `createRemovalWithBatchesAction` re-derives each
  batch's health *outside* the write transaction; the data-access write
  re-checks ungrouped/same-facility under `FOR UPDATE` but not health, so a
  batch could regress below `ready` between check and locked write. Health is a
  soft/derived gate, so impact is grouping a briefly-regressed batch. **Fix:**
  either re-assert `state === "ready"` inside `createRemovalWithCreditBatches`
  after acquiring locks, or document health as a point-in-time advisory.

### TelemetryPanel orphaned, reactor-telemetry submit dark (`certification/telemetry-panel-orphaned`, opened 2026-06-19)

- `TelemetryPanel` still exists but is not rendered anywhere, so the reactor
  temperature/pressure → Isometric `DataUploadSubmission` path remains dark.
  Archive:
  [`docs/archive/2026-06-19-telemetry-panel-orphaned.md`](./archive/2026-06-19-telemetry-panel-orphaned.md).
- **Resolve via:** re-home and barrel-export `TelemetryPanel`, then validate the
  file-upload → signed PUT → data-upload-submission pipeline live on the sandbox
  before re-surfacing it.
