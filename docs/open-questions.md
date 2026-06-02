# Open Questions

Living tracker of design questions, deferred work, and items waiting on
external confirmation. Add freely; resolve by removing the entry and
recording the decision in the relevant feature doc (e.g.
`docs/isometric/changes.md` or `docs/architecture.md`).

Each entry follows this shape:

- **Title** (`area/topic` or `phase`) — owner, opened YYYY-MM-DD
  - Question / decision needed
  - Why it matters / blocking what
  - What we'd need to resolve it (sandbox check, stakeholder ask, doc lookup)

## Isometric Certify integration

### Project-emission category disambiguator for `mass_based_ci_emissions` (opened 2026-05-24)

- **`miscellaneous` and `sampling_consumables` collide on the same Isometric blueprint**
  (`mass_based_ci_emissions` / `mass` / `kg`). The matcher in
  `src/lib/isometric/utils/project-emission-match.ts` distinguishes them by
  magnitude only; when both Components have similar magnitudes (<±0.5%) the
  matcher returns `kind: "ambiguous"` and surfaces a reason naming the two
  Component `display_name`s.
- Today this is a documented operational requirement on the Isometric operator
  ("give the two Components distinct display_names"). It works but is fragile.
- Resolve via: pick a disambiguator strategy — either (a) match by
  Component `display_name` regex per category (operator naming becomes part of
  the contract), or (b) attach a noma-side `supplierRefIdPrefix` to
  `CATEGORY_TO_BLUEPRINT` and only consider Components whose latest Datapoint
  carries that prefix. Decision needed before the next operator-facing release.

### Project-emissions tracking strategy — journal vs. measured actuals (opened 2026-05-26)

- **Current state (ADR 0005, Posture B):** `/admin/emission-estimates`
  carries a "Period emissions" section that journals five LCA-derived
  categories (`staff_travel`, `pyrolyzer_direct`, `biochar_storage_fuel`,
  `miscellaneous`, `lab_electricity`, `sampling_consumables`) into
  `certifier_project_emissions`. Operator re-publishes the same numbers
  in the Isometric UI as `PROJECT`-scope Components; drift panel on
  `/certification/` reconciles. **noma stores the numbers but does not
  consume them in any calculation.**
- **Question:** is the journal the right long-term home, or should noma
  capture **measured actuals** for the three categories that are
  measurable inside the dMRV (`pyrolyzer_direct`, `biochar_storage_fuel`,
  `lab_electricity` + `sampling_consumables`), keeping the journal only
  for genuinely admin-overhead categories (`staff_travel`,
  `miscellaneous`)?
- **Why it matters:** the LCA produces forecasts. Investors and
  verifiers will eventually want forecast-vs-actual variance. Three of
  five categories have measurement potential in the dMRV today
  (pyrolyzer gas composition lives on `production_run_readings` /
  `production_samples`; fuel + lab utilities would be small additive
  entities). Until the strategy is set we are storing forecasts in
  a place that pretends to be a measurement system.
- **Decision needed:**
  1. Confirm GHG Statement cadence (annual vs. quarterly vs.
     per-removal). Annual + `GHG_STATEMENT`-scope is the simplest
     posture; sub-annual forces `PROJECT`-scope + Isometric
     amortization (ADR 0005 default).
  2. Decide whether noma should track measured actuals for the three
     measurable categories. If yes: scope the new entities
     (`facility_fuel_log`, `lab_utility_log`) and confirm
     `production_run_readings` captures gas mass flow + CH₄/CO
     concentration end-to-end.
  3. Decide year-end reconciliation behaviour — does noma feed the
     next LCA, or does the LCA remain externally authored and noma
     supplies variance evidence only?
- **Resolve via:** stakeholder conversation on reporting cadence +
  investor narrative requirements; once cadence is set, the
  measurement-vs-journal split becomes a mechanical follow-up. Until
  then, ship the journal as-is and treat it as Phase 1 of a larger
  project-emissions story (see ADR 0005 "Posture C remains an upgrade
  path").

### Transport-leg compliance follow-ups (opened 2026-05-13)

- **Per-leg evidence model deferred** (`isometric/transport-v1.1-evidence`) —
  opened 2026-05-13, deferred to follow-up PR.
  - Isometric Transportation v1.1 §6 + Appendix 1 require: emission-factor
    source citation, factor vintage by mode (road ≤3 y, ship/air ≤5 y,
    rail/pipeline ≤7 y), round-trip vs. onward-leg evidence, distance-method
    fallback justification (§3.1 "appropriately evidenced"), weigh-scale
    calibration record, vehicle class/model year.
  - Current state: `transport_legs.emissionFactorSource` exists but is
    optional; no schema columns for factor vintage, round-trip flag, onward
    destination, or fallback evidence. Form text mentions §3.2 but
    validators do not enforce.
  - Resolve via: a dedicated PR with a Drizzle migration adding the
    columns, condition-registry rules, refreshed
    `docs/isometric/schema-mapping.md` rows 30–32, and three new entries
    on `docs/isometric/p0-compliance-checklist.md`
    (P0-16 method-hierarchy + fallback evidence, P0-17 per-leg
    round-trip default, P0-18 factor vintage by mode).

- **Per-leg vs aggregated submission strategy** (`isometric/transport-v1.1-aggregation`) —
  opened 2026-05-13, **interim resolution shipped 2026-05-13**.
  - Original plan: flip `INPUT_MAPPING` transport rows from
    `distance` (km) to `co2e` (kg) and submit summed per-leg emissions.
    Blocked because Certify's `transport` blueprint exposes
    `distance` / `mass` / `carbon_intensity` as separate inputs with
    `quantity_kind = "distance"`; the strict guard in
    `src/lib/isometric/transformers/datapoint.ts:201-211` rejects unit
    mismatches.
  - Interim: keep mass-weighted distance, but enforce per-category
    uniformity (same method, same emission factor, all legs have load
    mass) so Certify's server-side
    `distance × Σmass × factor = Σⱼ(distⱼ × massⱼ × factor)` holds —
    compliant with §5 within the current template shape. See
    `aggregateTransportLegs` in
    `src/lib/isometric/utils/aggregation.ts`.
  - True per-leg submission (each leg as its own Certify datapoint)
    is blocked on Isometric exposing a transport template input that
    accepts N>1 datapoints per leg category. Re-raise with Isometric
    support before any future work here.

- **No facility-membership model in codebase**
  (`auth/facility-scoping`) — opened 2026-05-13, parked.
  - The new `resolveEntityFacility` in
    `src/data-access/transport-legs.ts` walks the polymorphic parent
    chain back to a facility on every read/write, closing the
    orphan-mutation hole — but the codebase has no "user X may access
    facility Y" check anywhere (audited across `feedstocks`,
    `biochar-products`, `samples`, `deliveries`, `production-runs`).
  - Upgrade: when a facility-membership model lands, swap
    `resolveEntityFacility` for `requireFacilityAccess(userId, fac)` in
    `transport-legs.ts` (one chokepoint) and propagate the helper to
    the other data-access modules.
  - **2026-05-22 update (ADR 0003):** `src/data-access/certifier-removals.ts`
    joins this list — `getCertifierRemovalById`, `listRemovalsForFacility`,
    `getCreditBatchesByRemovalId`, `ensureRemovalForCreditBatch`,
    `assignCreditBatchToRemoval`, `updateRemovalDates` all guard with
    `requireAuth` only. The refactor widened the id-addressable surface
    (`submitRemovalAction` / `assignCreditBatchToRemovalAction` take a raw
    `removalId` from the client), so an authenticated user can submit or
    regroup any facility's removal by id — including driving an external
    Isometric POST. No regression vs. the deleted `submit-credit-batch.ts`
    (same posture), but **decision needed before a second facility operator
    is onboarded**: accept as single-tenant, or land the membership model
    and gate every removal accessor on the resolved facility.

- **Isometric MCP token-URL deprecated 2026-05-15** (`isometric/mcp-auth`) —
  opened 2026-05-13.
  - `https://api.isometric.com/mcp/?token=…` is removed 2026-05-15
    (2 days from 2026-05-13). Replacement: `https://api.isometric.com/mcp`
    with Certify/Registry account sign-in
    (https://docs.isometric.com/user-guides/ai/mcp-server). Dev-tooling
    only; no production code path affected.
  - Migration tracked separately; verify via
    `mcp__claude_ai_isometric__me` after switching.

> **Note:** ADR 0003 / ADR 0004 pre-deploy gates (legacy ledger cutover,
> destructive migration `0021`, wide id-addressable removal/GHG-statement
> surface, no-zero-stub-in-prod) live in
> `docs/isometric/integration-plan.md` → **Pre-deploy gates**. They are
> actions before deploy, not open questions.

### GHG Statement review follow-ups (opened 2026-05-22)

Findings from the Phase 4.5 GHG Statements review (ADR 0004). The
double-create dedup, the N+1 query batching and the non-atomic
`finalizeGhgStatement` were fixed in the same branch; the entries below
were deferred by the operator to a follow-up PR.

  (Resolved & removed 2026-06-02 — `forms/a11y-shared-layer`: `FormField` /
  `FormError` wire `aria-describedby` and `Modal` dev-warns on a missing
  accessible name (commit `33920f5`); `useDialog` now captures the trigger on
  open and restores focus to it on close (`src/hooks/use-dialog.ts`).
  Regression check on focus-restore deferred to an e2e assertion — the e2e
  tree was under concurrent edit at the time.)

  (Resolved & removed 2026-06-02 — see `docs/isometric/changes.md`:
  `certification/error-boundary` shipped as `(app)/certification/error.tsx`;
  `certification/report-url-allowlist` shipped as the `/api/documents/[id]`
  host gate via `src/lib/documents/redirect-allowlist.ts`.)

### Remaining template-coverage gaps

The Phase 3 / 3.6 / 3.7 template inspection found ~10 input coverage gaps;
all but the period-level ones are closed. The full breakdown is in
`docs/isometric/changes.md` (2026-05-11, 2026-05-13, 2026-05-21 entries).
Two items remain:

- **Pyrolyzer pre/post electricity readout** (`isometric/phase-3-readouts`)
  — opened 2026-05-13. `INPUT_MAPPING` under
  `pyrolysis / metered_energy_based_ci_emissions` synthesises
  `initial_readout = 0`, `final_readout = totalElectricityKwh`. The
  difference equals real consumption, which is the only quantity Certify
  uses downstream — verifier-acceptable today, but replace with real
  per-run pre/post readouts when `production_runs` gains the columns.
- **Period-level inputs zero-stubbed** — **resolved 2026-05-24** by
  [ADR 0005](../adr/0005-period-emissions-as-project-components.md).
  Period inputs no longer flow through `INPUT_MAPPING` at all; they're
  `PROJECT`-scope Components managed in the Isometric UI from a noma
  LCA-journal row. The "no template carrying these stubs in production"
  gate is replaced by integration-plan pre-deploy gate #4 (every
  category present in any used Removal Template must have a matching
  noma row AND a Project Component in Isometric).

- **`isometric/mapping-version-dimension`** — opened 2026-05-24,
  **deferred**.
  - **Question:** when Isometric introduces blueprint versioning (e.g.
    `pyrolysis@v1` → `pyrolysis@v2` where `carbon_content` moves from
    `dimensionless` to `mass_fraction`), how should `INPUT_MAPPING`
    represent the version dimension — a 4-tuple
    `(group, blueprint, blueprintVersion, input)`, an
    `N`-entries-per-input branch-on-`compatible_unit` model, or
    something else?
  - **Why deferred:** the Certify OpenAPI surface today does not expose
    any `blueprint_version` field — verified by grep across
    `src/lib/isometric/generated/certify.d.ts`. There are no concrete
    versioning examples to model the table against, so any 4-tuple
    decision would be speculative. Submit-time guards
    (`datapoint.ts:394-404`) + the nightly coverage check (B1) catch
    type/unit mismatches; no near-term integrity risk.
  - **Resolve via:** re-read the OpenAPI on any spec bump; reopen this
    entry the first time Isometric ships a versioned blueprint. The
    decision then has a concrete example to anchor against.

- **`isometric/phase-3-fixed-constants`** — opened 2026-05-05, **bootstrap
  shipped 2026-05-13**.
  - The default sandbox templates have ~12 `type=fixed` constants without
    pre-bound datapoints. Phase 3's orchestrator bails with `SafeError`
    directing the admin to Isometric's template editor.
  - Resolved by the `noma-mvp` template authoring walkthrough
    (`docs/isometric/sandbox-template-authoring.md`, Step 3 —
    "Pre-bind fixed constants" / "Alternative — Bootstrap fixed constants")
    and the `bootstrap-fixed-constants` mode of
    `scripts/isometric-smoke.ts`. Operational follow-ups (replacing the
    `1.0` placeholder for sampling consumables; validating
    region-specific factors before production) tracked in the
    walkthrough's "Verifier-readiness" section.

### Phase 5 Slice B / C deferrals (opened 2026-05-29)

Scoped out of the Phase 5 Slice A design (biochar reactor time-series via
Parquet — see [ADR 0006](./adr/0006-data-upload-submission-idempotency.md))
during the 2026-05-28 grilling session. Each is independently shippable
once Slice A is in production and operator demand surfaces.

- **Slice B — `POST /biochar_applications`** (`isometric/phase-5-slice-b`)
  - Per-spread-event JSON submission (`application_date`,
    `truck_mass_on_arrival/departure`, `average_application_rate`) that
    Isometric verifiers use to inspect individual delivery records.
  - Why deferred: requires two upstream primitives that noma does not
    currently post — `POST /production_batches` and
    `POST /projects/{id}/storage_locations`. Resolving the upstream
    dependency chain doubles the scope vs. Slice A.
  - Resolve via: a focused PR that wires the two upstream primitives,
    then layers `biochar_applications` on top. Likely opens around the
    same time soil-storage requirements push Isometric to add
    `storage_locations`-aware endpoints. Per-application
    `supplier_reference_id` IS supported by the create request
    (`certify.d.ts:1527`), so the standard reconciliation pattern
    applies — no ADR 0006-style departure needed.

- **Slice C — `MonitoringSubmission`** (`isometric/phase-5-slice-c`)
  - `POST /projects/{project_id}/monitoring_requirements/{id}/submissions`
    — structured-by-requirement submissions, parallel surface to the
    bulk Parquet path Slice A targets.
  - Why deferred: overlaps with Slice A's purpose for biochar reactor
    telemetry. Without operator demand we don't know whether
    `MonitoringSubmission` or `DataUploadSubmission` is the canonical
    home for which protocol-mandated measurements.
  - Resolve via: ask Isometric directly, "for biochar reactor
    temperature/pressure, do you prefer MonitoringSubmission or
    DataUploadSubmission?" If MonitoringSubmission, consider whether
    Slice A's hourly aggregator becomes a `MonitoringSubmission`
    feeder rather than a Parquet writer.

### Isometric Certify docs — UPPERCASE vs lowercase enum mismatch (opened 2026-05-29, filed 2026-05-29)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  on 2026-05-29. Remains open here until the docs page is updated.
- The "Uploading time series data" docs page
  (`docs.isometric.com/user-guides/certify/time-series-data-upload`)
  shows measurement-property quantity_kind and qualifier values in
  UPPERCASE (`TEMPERATURE`, `PRESSURE`, `MASS_FRACTION`, `COMPOUND_CO2`).
  The actual API requires **lowercase** — confirmed against sandbox on
  2026-05-29 with `POST /sensors`:
  - UPPERCASE → 422 enum violation listing the canonical lowercase set.
  - lowercase (`temperature`, `pressure`, `mass_fraction`,
    `compound_co2`) → accepted.
- Why it matters: future readers (including us) following the docs to
  build a Parquet writer will produce rejected requests until they
  discover the case mismatch by trial.
- Resolve via: re-check the docs page in the next update-playbook
  pass; close this entry when the prose matches the live API.

### Isometric Certify docs — 60-second cap on aggregation-period is undocumented (opened 2026-05-29, filed 2026-05-29)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  on 2026-05-29. Remains open here until the docs page is updated.
- The end-to-end sandbox smoke on 2026-05-29 (the parquet smoke probe,
  since deleted — its pattern lives in
  `tests/isometric-sandbox.integration.test.ts`) showed Isometric
  rejects DataUploadSubmissions where
  `aggregation_period_end - aggregation_period_start > 60 s` with
  `AggregationPeriodDurationInvalidError: Aggregation period of N
  seconds exceeds maximum allowed of 60 seconds`. The public docs page
  (`docs.isometric.com/user-guides/certify/time-series-data-upload`)
  describes the Parquet column shape but does not state this cap, so a
  reader following the docs alone will choose any window size and only
  discover the limit at submit time.
- Why it matters: noma's first integration design (2026-05-29 morning)
  picked 1-hour windows on verifier-readability grounds; the smoke
  forced a revision to 60-second windows after the docs gave no
  warning. Future integrations will hit the same wall.
- Resolve via: re-check the docs page in the next update-playbook
  pass; close this entry when the prose names the cap.

### Isometric Certify docs — biochar pyrolysis reactor declared DAC-only (opened 2026-05-29, filed 2026-05-29)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  on 2026-05-29. Remains open here until the docs page is updated.
- The same docs page opens with: *"Time series data can currently be
  associated with either a Direct Air Capture (DAC) capture facility
  or a DAC storage location (saline aquifer),"* but then lists
  Biochar Pyrolysis Reactor measurement properties and the OpenAPI
  enum includes `biochar_pyrolysis_reactor_facility_time_series`.
  Sandbox probe on 2026-05-29 confirmed the API accepts the biochar
  submission_type; the prose intro is stale.
- Why it matters: anyone evaluating "does Isometric support biochar
  time-series?" via the docs prose will incorrectly conclude no.
- Resolve via: re-check the docs page in the next update-playbook
  pass; close this entry when the intro enumerates biochar alongside
  DAC.

### Phase 4 deferrals

- **Isometric webhook contract availability** (`isometric/phase-5`) — opened 2026-05-06
  - When will Isometric publish a webhook event schema, signature
    header, and HMAC algorithm we can verify against?
  - Why it matters: blocks any automated reconciliation of GHG-statement
    state. `certifierProjects.webhookSecret` exists in the schema, but
    Certify's OpenAPI declares `webhooks = Record<string, never>` and
    no webhook topic exists at `https://docs.isometric.com`. Today
    users rely on the manual "Refresh" button calling
    `refreshGhgStatementStatus` to reconcile. A receiver built today
    would be guessing payload shape, signature header name, and HMAC
    algorithm.
  - Resolve via: ask Isometric support directly; check
    `api-reference/` quarterly via the existing update playbook
    (`docs/isometric/update-playbook.md`). Once the contract is
    published, build `src/app/api/certification/webhook/route.ts`
    and add HMAC + reconciliation tests.

- **External GHG statement amendment claiming** (`isometric/phase-5`) - opened 2026-05-05
  - Detect when an admin edits GHG statement dates or attached Removals
    directly in Isometric and the registry creates a new statement-version
    draft that noma has not claimed.
  - Why: Phase 4 surfaces `pending_total_co2e_removed_kg` and supports
    resubmission against the known local row, but it does not compare the
    local `externalId` against the registry's current period draft on every
    refresh.
  - Resolve by adding a claim/reconcile flow for external statement-version
    drafts.

- **Hash-changed partial-orphan cleanup** (`isometric/phase-5`) - opened 2026-05-05
  - Reconcile or report Datapoints/Removals created by a failed attempt when
    local inputs changed before the retry, causing a new payload hash and new
    supplier refs.
  - Why: same-hash retries now reuse stored refs and reconcile before POST,
    but changed-hash retries intentionally create a fresh version. Any remote
    resource from the failed old hash can remain orphaned.
  - Resolve only if production traffic shows this failure mode often enough
    to justify per-Datapoint sub-ledger bookkeeping.

- ~~**Source upload flow**~~ (`isometric/phase-3.5`) — opened 2026-05-05,
  resolved 2026-05-26. Shipped end-to-end via server-side proxy mirror
  (see `docs/isometric/changes.md`). Follow-up items below.

- **Per-input source attribution** (`isometric/sources-per-input-attribution`)
  — opened 2026-05-26
  - Phase 3.5 ships removal-wide attribution: every monitored Datapoint
    receives the same `source_ids` list. Verifiers see complete evidence
    per Datapoint but lose the per-input narrowing that "this lab report
    supports carbon_content + product_mass, not transport distance"
    would convey.
  - Why: a verification-quality concern, not an API correctness one. The
    Isometric API accepts removal-wide source attribution today.
  - Resolve by: extending `loadCandidateDocumentsForRemovalAction` to
    return per-input bindings (or a per-blueprint heuristic) and threading
    them through `buildCreateDatapointRequest`'s `sourceIds` arg, which is
    already per-input. Defer until Phase 5 or operator feedback signals
    it's needed.

- **Stream large source files** (`isometric/sources-stream-large-files`)
  — opened 2026-05-26
  - Phase 3.5 caps mirror size at 50 MB via `arrayBuffer()` for code
    simplicity. Larger documents fail loud with a `SafeError`.
  - Resolve by: piping `response.body` (ReadableStream) from the noma
    storage download directly into the Isometric PUT body with
    `duplex: "half"`. Modern Node fetch supports this; needs careful
    `Content-Length` handling.
  - Defer until a real LCA PDF or video evidence exceeds the cap.

- ~~**Sources mirror-flow integration tests**~~ (`isometric/sources-integration-tests`)
  — opened 2026-05-26, **resolved 2026-05-26**. Shipped as
  `tests/isometric-sources-mirror-flow.test.ts` (4 tests covering GET-found
  → 200 PUT → insert, GET-found → 409 → insert, reconciled-`isPublic`
  authoritative path, rejection of out-of-lineage documents). See
  `docs/isometric/changes.md`.

- ~~**Cross-process source advisory lock in submitRemoval**~~
  (`isometric/sources-submit-lock`) — opened 2026-05-26,
  **resolved 2026-05-26**. `submitRemoval` now acquires per-document
  mirror locks (key: `mirror:{provider}:{documentId}`) sorted to prevent
  ABBA, re-resolves source IDs inside the locked transaction, and inserts
  the draft snapshot atomically via the new composable
  `insertDraftSubmissionWithMappingLockAndLocks` data-access helper.
  mirror, unlink, and submit now interlock on the same lock key. See
  `src/lib/isometric/utils/source-lock.ts`,
  `src/fn/certification/submit-removal.ts` (create-new-version branch),
  and `src/data-access/certification.ts`.

- **Mirror lock held across Isometric HTTP round-trips**
  (`isometric/sources-lock-hold-time`) — opened 2026-05-26
  - `mirrorDocumentToSource` holds the per-document mirror advisory lock
    across three Isometric calls (`findSourceBySupplierRef`,
    `createSource` / `requestSignedUploadUrl`, `putBlobToSignedUrl`) plus
    the storage download. Now that `submitRemoval` and
    `setDocumentSourceVisibility` also acquire the same lock, a slow
    upload of a `SOURCES_MAX_BYTES` blob (50 MB cap) stalls every
    concurrent submit + visibility flip on the same document for the
    full upload duration. Acceptable for single-tenant v1; logged as the
    main scalability tradeoff to revisit before multi-operator workloads.
  - Resolve by: split mirror into a `reserve` phase (lock, look-up
    remote, request upload URL, persist a `pending` mapping, release
    lock) and an `upload` phase (PUT without holding the lock,
    re-acquire briefly to flip `pending → ready`). Adds one
    `upload_status` column to `certifier_document_uploads` and one extra
    DB round-trip per mirror, but unblocks parallel work on neighbouring
    documents.

- **Per-input source attribution (was: removal-wide attribution)**
  see `isometric/sources-per-input-attribution` above — unchanged by the
  Phase 3.5 hardening; still removal-wide.

### Phase 3.5 source-mutation hardening — deferred simplifications (opened 2026-05-26)

Surfaced by the `/simplify` pass that followed the P1/P2 fix set (tx
threading, removalId scoping with `assertDocumentIsCandidateForRemoval`,
locked source-id resolution in submit, `isPublic` reconciliation). All
below the threshold for the same PR; revisit next time the area is
touched.

- **Extract `finalizeSnapshotInputs` from `submitRemoval`'s create-new-version
  closure** (`code/submit-removal-finalize-helper`)
  - The `prepare` callback passed to
    `insertDraftSubmissionWithMappingLockAndLocks` in
    `src/fn/certification/submit-removal.ts` is ~80 lines mixing lock
    acquisition, conditional source-id reconciliation, hash
    recomputation, template-input rebuild, and final
    `InsertDraftSubmissionInput` assembly. Readable today (linear,
    rare-path clearly marked) but a third caller would force extraction.
  - Resolve via: pull `finalizeSnapshotInputs({candidateDocumentIds,
    tentativeSourceIds, semanticPayload, semanticHash, monitored,
    datapointBodyByKey, …})` into a sibling module; the closure shrinks
    to "acquire locks → call helper → return input".

- **Extract `assertDocumentReadyForMirror` pre-flight from
  `mirrorDocumentToSource`** (`code/mirror-preflight-helper`)
  - 10 sequential `SafeError` throws on document nullability fields
    (`storageKey`, `fileSizeBytes`, `mimeType`, head size match, …) plus
    the post-validation `: number` / `: string` narrowing tricks.
    Pre-existing pattern, not introduced by the hardening, but the
    extraction would also delete the `!` non-null assertions in
    `buildSourceRequestBody`.
  - Resolve via: lift to a helper returning narrowed locals
    `{fileSizeBytes, mimeType}` so the function signature carries the
    invariant.

- **Export `DbClient = DbTransaction | typeof db` from `@/db`**
  (`code/dbclient-alias`)
  - `src/data-access/certifier-document-uploads.ts` defines the alias
    locally; `src/data-access/applications.ts` writes the union inline at
    3 sites. As more data-access modules accept optional `tx`, the
    duplication compounds.
  - Resolve via: add one export in `src/db/index.ts`, migrate the
    inline unions in `applications.ts`, swap the local alias.

- **Shared test fixture builder for Isometric submission tests**
  (`tests/isometric-submission-fixtures`)
  - `tests/isometric-submit-removal.test.ts`,
    `tests/isometric-sources-mirror-flow.test.ts`, and
    `tests/isometric-ghg-statement-submit.test.ts` each repeat ~8
    `vi.mock(...)` declarations and a similar `beforeEach`
    `mockResolvedValue` block. They evolve together — a new data-access
    dependency in `submit-removal.ts` typically breaks all three.
  - Resolve via: `tests/fixtures/isometric-submission-mocks.ts` exporting
    `applyIsometricSubmissionMocks()` (the `vi.mock` list) and
    `setDefaultSubmissionMockData(overrides?)` (the `beforeEach`
    defaults). Note `vi.mock` factories are hoisted, so each test file
    still calls them in its hoisted section — the shared module exposes
    the path list and the per-test default data.

- **Per-column upload-URL field migration** (`storage/phase-2`) — opened 2026-05-19
  - `production.plc_data_file_url`, `samples.r0_histogram_file_url`,
    `samples.tga_thermogram_file_url`, `production_samples.photo_url`,
    `feedstock.registry_url`, `emissions.source_url` are still plain
    text columns. Phase 2 plan: add a `*_document_id` FK alongside each,
    backfill via UI, drop the URL column.
  - Why: route all uploaded evidence through the single `documents`
    table (one audit trail, one storage-key convention, one
    visibility/ACL model).
  - Not urgent; existing URL fields keep working as external/legacy
    links via the `/api/documents/[id]` proxy route's fileUrl branch.

- **Per-Datapoint ledger sub-rows** (`isometric/phase-4`) — opened 2026-05-05
  - Add `submissionType='datapoint'` rows in `certification_submissions`
    so a re-submit short-circuits successfully-POSTed datapoints from a
    prior failed attempt.
  - Why: Phase 3 leaks orphan datapoints in Certify on partial-failure
    re-submits. The leaked rows have no Removal reference; they're
    cosmetic clutter, but not silent data quality issues.
  - Resolve only if partial-failure rates rise; the bookkeeping cost is
    real and not worth it for one-off recoveries.

- **PATCH `/removals` vs supersede-and-create** (`isometric/phase-4`) — opened 2026-05-05
  - Phase 3 always creates a new versioned remote Removal on payload
    changes (the supersede path). If Certify supports in-place PATCH for
    selected fields and verifier UX prefers it, branch 3e gains a PATCH
    path.
  - Why: more accurate audit trail when only metadata changes (no v=2
    Removal flooding the registry UI).
  - Resolve via reading Certify's PATCH docs and confirming with their
    team which fields are mutable post-creation.

- **`LIST` data-shape inputs receiving multiple datapoints** (`isometric/phase-4`)
  — opened 2026-05-05
  - `CreateComponentListInput.datapoint_ids[]` accepts N IDs, but Phase 3
    aggregation collapses N runs into a single value, so list inputs
    receive a one-element array. If a verifier asks for per-run datapoints,
    the aggregation step changes shape.
  - Why: today's protocol-level UX is "one credit batch = one Removal"
    with aggregated values; per-run is overkill but may be required for
    some templates.
  - Resolve only when a template surfaces that needs per-run breakdown.

### Phase 3.5 Sources panel test-pass follow-ups (opened 2026-05-27)

Surfaced while manually exercising the Sources panel against the
Isometric sandbox (Cases A–H). Cases A–E and the precondition guards
(Cases G/H) all passed; the three items below were either band-aided in
this PR or are clean UX deferrals.

- **`storage/sources-storage-loopback` — replace the HTTP loopback in
  `downloadDocumentBlob` with a `getObjectStream(key)` on
  `StorageProvider`.**
  - `src/fn/certification/sources.ts:368-387` issues a presigned URL,
    then `fetch`es it back from the same server. In dev that flows
    through `/api/storage/...` and requires `STORAGE_SIGNING_SECRET`;
    the round trip duplicates network and signing work that an internal
    stream would avoid entirely.
  - Resolve via: add `getObjectStream(key): Promise<{ stream, contentType, contentLength }>`
    to the `StorageProvider` interface (local-fs + S3 + GCS
    implementations), then have `downloadDocumentBlob` call it
    directly. Browser→storage signed URLs stay for genuine browser
    use; the server→storage path stops self-fetching.
  - Why: removes one HTTP hop per mirror, makes the loopback-host
    allowlist surface area smaller, and kills the dev-only
    `STORAGE_SIGNING_SECRET` dependency for this code path.

- **`storage/sources-sync-events-tx` — move `certifier_sync_events`
  writes out of the mirror business transaction.**
  - `safeAppendSyncEvent` (called inside `db.transaction` in
    `mirrorDocumentToSource`) currently calls `appendSyncEvent` on the
    root `db`. With a single-connection pool the audit write deadlocks
    waiting for a connection held by the open business transaction.
  - Band-aided this PR by setting `DB_POOL_MAX=10` in `.env.local`
    (audit writes go to a different connection). That's
    pool-size-dependent and shouldn't be the long-term invariant.
  - Resolve via: accumulate event payloads in a closure and flush them
    after the transaction settles (success or rollback). Audit always
    lands; no pool-size assumption. Touch points:
    `src/fn/certification/sources.ts` (`withSyncEventOnFailure`,
    `safeAppendSyncEvent`), `src/data-access/certification.ts`
    (`appendSyncEvent`).

- **`ux/sources-panel-row-layout` — buttons clip on narrow viewports.**
  - The Mirror / Unlink / visibility-toggle button row in
    `SourcesPanel` (`src/components/certification/sources-panel/`)
    clips below ~640px when filenames are long; reliably forced
    `javascript_tool` `btn.click()` over `computer.left_click` during
    manual testing.
  - Pure UX follow-up. Resolve via: wrap the action row, switch to
    icon-only on narrow viewports, or move buttons to a per-row
    overflow menu.

### Submit-removal — `pyrolyzer_direct` PROJECT-scope conflict in default template (opened 2026-05-27)

Encountered while running Sources-panel Case F (post-submit unlink
should fail-closed). Clicking SUBMIT on a Removal raised this SafeError:

> `This input belongs to a Project-scope Component (PROJECT scope,
> category="pyrolyzer_direct"). Remove
> "direct-emissions/ghg_direct_emissions/concentration" from the Removal
> Template; the corresponding emission is tracked as a Project Component
> published in the Isometric UI from a row in
> /admin/emission-estimates (ADR 0005)`

- **Question:** the seeded default Removal Template still references the
  `direct-emissions/ghg_direct_emissions/concentration` input. Under
  ADR 0005 the `pyrolyzer_direct` magnitude lives in
  `certifier_project_emissions` and is published in Isometric as a
  PROJECT-scope Component — the Removal payload must not carry that
  input. The check at submit time fails-closed correctly; the seed /
  default template carries a category that ADR 0005 said to remove.
- **Why it matters:** blocks Case F end-to-end test pass for the
  Sources panel, and any operator who tries to submit using the seeded
  default template hits the same error.
- **Resolve via:** update the default Removal Template seed (and any
  fixture template references) to drop
  `direct-emissions/ghg_direct_emissions/concentration` per ADR 0005,
  then re-run Case F. Track in the submit-removal phase; not a
  Sources-panel concern.

## Audit follow-ups (opened 2026-05-25)

Batch of deferrals from the whole-codebase tech-debt audit run on
`feature/isometric-api` (CRITICAL + HIGH fixes landed in-PR; entries below
are the items that were flagged but kept out of that scope). Roughly
ordered by leverage.

### Structural / cross-cutting

- **File-size hard-rule violations** (`code/file-size-rule`)
  - `src/data-access/entities.ts` is 1323 lines, `src/data-access/production-runs.ts`
    is 1076. CLAUDE.md sets a 1000-line hard limit. `entities.ts` is 14
    near-identical `getX` / `getXById` factories — collapse via a
    `buildSearchableEntityFinder({table, codeCol, nameCol, ...})` factory
    plus per-entity files under `src/data-access/entities/`. `production-runs.ts`
    splits cleanly into `{queries, mutations, readings, stats, codes}.ts`.
    Same pattern unblocks a separate `createEntityHooks` factory for the
    `src/hooks/use-*.ts` family (~4–5k duplicate lines).
  - Resolve via: dedicated refactor PR — should not stack on top of
    in-flight feature work.

- **Structured logger + Isometric API boundary logging** (`code/logger-introduction`)
  - Project has zero structured logging — only `console.warn` / `console.error`.
    Critical-path entries (`submitRemoval`, `createGhgStatementDraft`,
    `submitGhgStatementToVerifier`, `isometricRequest` boundary) emit
    operational signal only via the in-DB `certifierSyncEvents` ledger,
    which is not searchable in any aggregator and carries no latency.
  - Resolve via: pick a logger (pino likely), wire it through
    `src/lib/log/`, replace `console.*` in `src/fn/certification/*` +
    `src/lib/isometric/*`, attach `{op, removalId, externalProjectId,
    mappingRevision, attempt, duration_ms}`. Also mint a per-submission
    `submissionAttemptId = randomUUID()` for cross-event correlation.

  (Resolved & removed 2026-06-02 — `security/rate-limit-submissions`: opt-in
  `rateLimit` on `withAction`, 5/min/user per submit pipeline, in-memory
  sliding window. See `docs/isometric/changes.md`. NOTE: this resolved the
  abuse-defense concern only; a per-facility limit and the exact cross-instance
  ceiling were explicitly out of scope — reopen if either is needed.)

- **Single-tenant authorization → facility-membership model**
  (`security/facility-membership-authz`)
  - Acknowledged in `docs/isometric/integration-plan.md` pre-deploy
    gate #3. Every `data-access/{certification,project-emissions,
    certifier-removals,certifier-ghg-statements}.ts` accessor guards only
    with `requireAuth(userId)` — no facility-membership check. On a
    multi-tenant deployment, any authenticated user could enumerate or
    mutate any facility's rows by id. The new `project_emissions.ts`
    inherits this posture explicitly (file header comment lines 11–15).
  - Resolve via: introduce `requireFacilityAccess(userId, facilityId)`,
    update every data-access chokepoint, audit all `localEntityId`
    accessors in `certifier_sync_events` for the same shape.

### Performance / scalability

- **Drift loader `AbortSignal`** (`perf/isometric-drift-abort`)
  - `loadProjectEmissionDrift` issues two paginated Isometric fetches.
    On rapid facility-toggle the in-flight server invocation continues
    against Isometric's API, wasting quota and occasionally surfacing
    older facility's drift during the transition. React Query auto-injects
    `signal` into `queryFn` — wire it through `loadProjectEmissionDrift
    → listComponents → paginateAll → isometric.get`.

- **Sequential datapoint POSTs in `submitRemoval`** (`perf/datapoint-fanout`)
  - `src/fn/certification/submit-removal.ts:576` iterates
    `transport.datapointBodies` and awaits each `createOrReconcile`
    sequentially — N × Isometric RTT per submission. With 5–15 monitored
    inputs per template this is 1–9s of avoidable wait per submission.
    `Promise.all` with `p-limit(4)` cuts wall-time ~Nx without
    overwhelming Isometric's per-second budget. Sync-event ordering
    becomes interleaved — trade-off the owner should call.

- **Missing composite indexes** (`perf/missing-indexes`)
  - `certifier_project_emissions` list query filters `(provider,
    facility_id)` and orders `(lca_window_end_on DESC, created_at DESC)`
    but the migration ships only a single-column FK index — Postgres
    sorts in memory per request.
  - `certifier_sync_events(entity_type, entity_id, attempted_at DESC)`
    has no index. Table grows ~2–3 rows per submission × ~20 submissions
    per facility per month; every detail page does a seq scan.
  - Resolve via: one migration adding both composite indexes.

- **CI coverage script serial per-facility loop** (`perf/coverage-check-fanout`)
  - The N+1 DB query is fixed (batched `inArray`), but the outer
    `for (const facility of facilities)` in `scripts/isometric-coverage-check.ts`
    still iterates facilities one at a time. Each facility runs 1×
    `listRemovalTemplates` + `Promise.all([listComponents, listDatapoints])`.
    `p-limit(4)` over the facility array cuts CI wall-time linearly.

### Correctness / observability

- **Mapping-revision ambiguity on resume path** (`isometric/mapping-revision-resume`)
  - `submit-removal.ts:645,715` stamps the current `MAPPING_REVISION` on
    sync events emitted during the resume branch, but the actual
    datapoint bodies were built from `payloadSnapshot.__mappingRevision`
    (a potentially older deploy's mapping). An auditor querying
    `response_payload->>'mapping_revision'` cannot tell which mapping
    authored the bytes.
  - Resolve via: stamp both `snapshot_mapping_revision` (from
    `row.payloadSnapshot.__mappingRevision`) AND
    `runtime_mapping_revision` (current module constant) on every resume
    sync event. Minor JSONB shape addition, no migration.

- **CATEGORY_REGISTRY consolidation** (`code/category-registry`)
  - Four parallel sources of truth for project-emission categories:
    `project_emission_category` pgEnum, `projectEmissionCategoryValues`
    Zod tuple, `CATEGORY_TO_BLUEPRINT` in
    `src/lib/isometric/utils/project-emission-match.ts`, and the
    `PERIOD_INPUT_TUPLES` category strings in
    `src/lib/isometric/transformers/datapoint.ts`. Comments warn
    contributors to keep them in sync; nothing enforces it.
  - Resolve via: one `CATEGORY_REGISTRY` in
    `src/lib/isometric/categories.ts` keyed by `ProjectEmissionCategory`
    with `{pgValue, blueprintKey, primaryInputKey, expectedUnit,
    groupKeys[], inputKeys[]}`. Derive the other three from it; add a
    build-time test asserting registry keys match the pgEnum array.

- **Lossy `IsometricApiError` in submission catch paths** (`obs/preserve-error-context`)
  - `createOrReconcile` (`submit-removal.ts:721-749`) and
    `createGhgStatementRemote` (`ghg-statements.ts:287-326`) catch
    failures, write a `failed` sync event carrying only
    `errorMessage: message`, and throw a wrapped `SafeError`. The
    original `err.body`, `err.status`, `err.code` from
    `IsometricApiError` are dropped — neither the audit ledger nor any
    future logger receives them.
  - Resolve via: include `err.body`, `err.status`, `err.code` in
    `responsePayload` alongside `mapping_revision`; pair with the logger
    work above so the developer-facing stack and the operator-facing
    `SafeError` live in different channels.

### Accessibility

- **Color-only severity convention in drift panel** (`a11y/wcag-1.4.1`)
  - The drift-panel warn variant now carries an SR-only "Warning:"
    prefix and `<ul>/<li>` list semantics — but the visual severity is
    still encoded only by `--color-signal-orange` left border + a
    decorative `!` glyph. WCAG 1.4.1 (use of color) requires a
    non-color cue; the SR-only text satisfies AT users but the sighted-
    low-vision case still needs a non-color visual signal (e.g.,
    "Warning" inline text, an icon with sufficient contrast).
  - Resolve via: dedicated `audit-a11y` pass that also runs a runtime
    contrast check on `--color-signal-orange` against the white
    background, and that picks the project's house style for severity
    badges (consider promoting `DriftRow` into a project-wide notice
    primitive if a sibling appears).

## Documentation hygiene

### Review feedback parked for future PRs (opened 2026-05-19)

- **`docs/isometric/changes.md` archival split** (`docs/changelog-archival`) —
  opened 2026-05-19, **deferred**.
  - Review suggested moving dated implementation-history sections (e.g.,
    2026-05-11 Phase 3.6 foundation, 2026-05-07 env/dialog refactor) out of
    `docs/isometric/changes.md` into `docs/archive/` and leaving only an
    evergreen status pointer in the original file.
  - Why parked: `changes.md` is documented in `CLAUDE.md` and
    `docs/isometric/README.md` as the project's local changelog. A
    changelog is dated by construction; splitting every entry into
    `docs/archive/` would defeat its discoverability without changing
    information density.
  - Resolve via: agree on a retention policy first (e.g., "entries older
    than 6 months move to `docs/archive/isometric-changes-<year>.md`"),
    then execute the cut in one PR rather than ad-hoc per review.

- **`docs/open-questions.md` dated-section extraction** (`docs/open-questions-format`) —
  opened 2026-05-19, **deferred**.
  - Review suggested moving "Pre-coding gates (status as of 2026-05-11)"
    and "Phase 3 blockers found in template inspection" into
    `docs/archive/` because they read as implementation logs.
  - Why parked: the file's documented entry shape (top of file) is
    `Title (area/topic) — owner, opened YYYY-MM-DD`. Dates are part of
    the contract, and the "Phase 3 blockers" entries are still partly
    open (sandbox zero stubs, electricity-readout schema work). They
    will leave this file when resolved, not when stale.
  - Resolve via: a dedicated pass that closes the still-open
    sub-entries (electricity readout, per-run GHG concentration,
    fuel-volume capture) so the parent gate can be removed.

- **`docs/isometric/README.md` and `sandbox-template-authoring.md` phase
  language** (`docs/evergreen-language`) — opened 2026-05-19, **deferred**.
  - Review flagged phase- or date-specific phrasing in the README index
    entry for `sandbox-template-authoring.md` and elsewhere.
  - Why parked low-priority: the phase references describe what the
    walkthrough *unblocks*, which remains accurate. Rephrasing is
    cosmetic; bundle with the next substantive update to the
    walkthrough (e.g., once a noma-mvp template ships and the doc is
    rewritten to reflect lived experience).

- **`env-banner.tsx` style-constant extraction** (`code/env-banner-style-consts`) —
  opened 2026-05-19, **deferred**.
  - Review suggested extracting padding (`px-12 py-8` / `px-16 py-12`)
    and icon-size (`16` / `20`) literals into named constants.
  - Why parked: only two call sites duplicate each literal, and the
    inline ternary makes the inline/page divergence immediately
    visible. Per `CLAUDE.md` ("Don't add abstractions beyond what the
    task requires"), this is below the threshold for extraction.
    Revisit if a third variant is added.
