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

- **No route-level error boundary** (`certification/error-boundary`) —
  opened 2026-05-22, deferred.
  - There is no `error.tsx` anywhere under `src/app`. A thrown error in a
    Certification route (loader reject, server-fn throw not caught by
    `ActionResult`) renders a blank screen instead of a recoverable UI.
  - Resolve via: add `src/app/(app)/certification/error.tsx` with a retry
    affordance — a new convention for the project, so confirm placement
    (per-route-group vs a single app-level boundary) before landing.

- **Report-URL open-redirect / 2nd-party SSRF**
  (`certification/report-url-allowlist`) — opened 2026-05-22, deferred.
  - The operator-supplied GHG-statement report URL (`reportUrl` in
    `submitGhgStatementToVerifier`) is stored on a `documents` row and
    later served through the pre-existing `/api/documents/[id]` route,
    which 302-redirects to `fileUrl` with no host allowlist. A crafted
    URL turns the redirect into an open redirect / server-side fetch of
    an arbitrary host.
  - Pre-existing pattern — the `/api/documents/[id]` `fileUrl` branch
    predates this feature and is shared by every external/legacy URL
    column (see the `storage/phase-2` entry).
  - Resolve via: decide an allowlist policy (e.g. restrict to known
    object-storage / Isometric hosts) and enforce it at the
    `/api/documents/[id]` redirect, not per-caller.

- **Shared-component a11y gaps** (`forms/a11y-shared-layer`) — opened
  2026-05-22, deferred.
  - `FormField` / `FormError` (`src/components/forms/`) do not wire
    `aria-describedby` from input to error message; `useDialog`
    (`src/hooks/use-dialog.ts`) does not restore focus to the trigger on
    close. Surfaced by the GHG Statement dialogs but the gap is in the
    shared layer, so a fix touches every form and dialog in the app.
  - Resolve via: a dedicated a11y pass on the shared forms/dialog
    primitives with a regression check across existing consumers.

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

- **Sources mirror-flow integration tests** (`isometric/sources-integration-tests`)
  — opened 2026-05-26
  - Phase 3.5 ships pure-logic tests (`tests/isometric-sources.test.ts`)
    but the mirror flow's full decision matrix (happy path, recovery
    GET-found → signed-upload-url 200 → PUT → insert, recovery GET-found
    → signed-upload-url 409 → insert, mid-PUT failure with retry, race
    detection / orphan-source sync_event) needs DB + Isometric client
    integration tests.
  - Resolve by: adding `tests/isometric-sources-mirror.integration.test.ts`
    using the same mocking pattern as `tests/isometric-submit-removal.test.ts`.

- **Cross-process source advisory lock in submitRemoval** (`isometric/sources-submit-lock`)
  — opened 2026-05-26
  - Unlink uses an advisory lock keyed on `source:{provider}:{externalDocumentId}`,
    but `submitRemoval` does NOT take a matching lock when resolving
    `sourceIds` for the semantic hash. A narrow TOCTOU window exists:
    between submit-removal's `resolveSourceIdsForRemoval` and the
    `insertDraftSubmissionWithMappingLock`, an unlink that grabs the
    source-level lock can delete the row our submit just snapshotted.
    The post-delete recheck in unlink catches the snapshot-after-delete
    case; the converse (snapshot lands AFTER unlink check but BEFORE
    delete) is mitigated by the second snapshot check inside the unlink
    transaction.
  - Resolve by: have `submitRemoval` acquire the per-source advisory
    locks before computing `payloadHash`, hold them until the draft row
    is INSERTed. Deferred until operator feedback shows the race fires.

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

- **Rate limiting on submission actions** (`security/rate-limit-submissions`)
  - `submitRemovalAction`, `submitCreditBatchRemoval`,
    `submitGhgStatementToVerifier` drive external POSTs that consume
    Isometric quota and burn `ISOMETRIC_CLIENT_SECRET`. The in-flight
    lock in `decideSubmissionClaim` blocks duplicate submissions of the
    same removal but not sweep-all-removals abuse by an authenticated
    user. Better Auth rate-limits only `/sign-in/email` and friends.
  - Resolve via: per-user (or per-facility) rate limit inside
    `withAction` — token bucket, e.g. 10 submissions/hour/user, 30/hour/facility.
    Design call on the bucket strategy first.

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
