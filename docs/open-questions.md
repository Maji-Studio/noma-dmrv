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

## Schema

### Dropped protocol-stub tables — re-add when each feature is built (opened 2026-06-08)

Removed in migration `drizzle/0037_sour_lethal_legion.sql`. These tables were
scaffolded ahead of implementation — defined in the schema but never queried or
seeded by any app code. Dropped to keep the schema honest about what the app
actually uses (no prod data yet, so re-adding later is cheap). Recover the
original column definitions from git history (the schema files just before
`0037`) when rebuilding the matching feature.

- **`loss_records`** (was `db/schema/loss.ts`) — Biochar Protocol §8.4.2 loss
  accounting (residue / spillage / runoff / volatilization / transport_loss
  adjusting batch CO₂e). Re-add when mass-loss accounting enters credit math.
- **`reversal_risk_assessments`** (was in `credits.ts`) — Appendix I reversal
  risk → buffer-pool %. Also dropped the `credit_batches.reversal_risk_assessment_id`
  FK and the `land_tenure_type` / `soil_erosion_risk` / `climate_volatility_risk`
  / `natural_disaster_risk` / `operator_track_record` enums. Today
  `credit_batches.buffer_pool_percent` is entered directly; re-add when
  buffer-pool justification is built.
- **`ghg_materiality_assessments`** (was in `compliance.ts`) — SSR-emissions-vs-
  net-removals materiality (<1%) checks per credit batch. Re-add when materiality
  assessment is implemented.
- **`feedstock_sc_assessments`** (was in `compliance.ts`) — per-feedstock
  sustainability-criteria pass/fail/conditional records with evidence docs.
  Re-add when the SC assessment workflow is built.
- **`custody_handoffs`** (was in `compliance.ts`) — chain-of-custody ledger.
  Redundant with the *built* chain-of-custody, which derives lineage from FK
  relationships (`data-access/chain-of-custody.ts`), not a ledger. Re-add only
  if an explicit handoff ledger is actually needed.
- **`certifier_sources`** (was in `certification.ts`) — Isometric Source
  definitions; `certification_submissions.source_id` FK dropped with it. Re-add
  when submission Sources are tracked locally rather than derived at submit time.
- **`emission_factors`** (was `db/schema/emissions.ts`) — region/fuel EF
  configuration. The app lets the Isometric component hold EFs (see
  [[transport-legs-distance-based]]); re-add only if EFs move in-house.
- **`production_runs.emission_factors_used`** (column) — JSONB snapshot of EFs
  applied to a run; selected in queries but never written. Re-add as an audit
  snapshot when run-level EF provenance is needed.

Also removed the same day (not Isometric-related): the legacy Next.js-starter
`projects` / `project_members` / `items` template cluster — tables plus their
`[projectId]` route tree, data-access, fn, hooks, components, and `requireProjectMember`
guard. Pure starter-template residue; the app is facility-scoped.

## Architecture

### Facility-access model — build it for real when multi-tenancy starts (`auth/facility-access-model`, opened 2026-06-10)

- **Decision needed:** when a second facility/operator group (or self-serve
  registration) is committed, design and ship a real facility-access model —
  membership tables, scoped guards in `data-access/`, and scoped option
  queries (the known unscoped example: `getSupplierOptions` in
  `src/data-access/suppliers.ts`).
- **Why it matters:** today's shared-data model is intentional and documented
  (`docs/auth.md` §current model, `docs/security.md`); `requireAuth` is a
  userId-truthiness check at ~211 call sites. The moment data must be
  partitioned by operator group, this becomes P0.
- **Explicitly rejected (2026-06-10 architecture review):** shipping a no-op
  `requireAccess(userId, { facility })` seam ahead of the real model. A
  guard that looks scoped but enforces nothing is churn now and false
  confidence later — call sites would read as protected while the
  implementation is a stub. Do the real model once, when the requirement is
  concrete.
- **To resolve:** product decision on multi-tenancy timeline; then a design
  doc (membership grain: user↔facility vs user↔org↔facility, admin override
  semantics, migration for existing rows).

## Isometric Certify integration

### GHG Entry API rename — September 2026 sunset cleanup (`isometric/ghg-entry-migration`, opened 2026-06-10)

- **Migration landed 2026-06-10** (plan Phases 1–4; see
  [`docs/isometric/changes.md`](./isometric/changes.md) → 2026-06-10). noma now
  calls the `ghg_entry` route family; the regen pipeline points at the
  docs-hosted Certify spec.
- **What remains, post-sunset (after September 2026):** Isometric removes the
  deprecated `removal*` endpoints/fields. At that point: (a) regenerate
  `certify.d.ts` — the deprecated `Removal*` schemas + `GhgStatement.removal_ids`
  / `Component.removal_template_component_id` keys disappear, so the test mocks
  that still carry both old+new fields (`isometric-reconciliation.test.ts`,
  `isometric-ghg-statement-flow.test.ts`, `isometric-ghg-statement-submit.test.ts`,
  `project-emission-match.test.ts`) drop the deprecated keys; (b) delete the
  🚫-marked deprecated rows from `docs/isometric/openapi-index.md`. No app-code
  change expected — the wire layer already only calls the new routes.
- Full inventory + verified renames + phased plan:
  [`docs/plans/2026-06-10-isometric-ghg-entry-migration.md`](./plans/2026-06-10-isometric-ghg-entry-migration.md).

### GHG entry / statement free-field follow-ups from the rename (`isometric/ghg-entry-free-fields`, opened 2026-06-10)

The migrated surface returns fields noma does not yet capture. Each is a new
capability, not a blocker — tracked here so they are not lost:

- **Credit allocation / buffer pool.** `GhgEntry` + `GhgStatement` now expose
  `risk_of_reversal_percentage` and `credit_allocation`
  (`buffer_pool_contribution_kg` / `supplier_allocation_kg`). Surfacing the
  split on the certify panel / credit-batch detail is new UI. Relates to the
  dropped `reversal_risk_assessments` table (see Schema section above).
- **Reporting-period readback.** `GhgStatement.reporting_period_start_at` /
  `_end_at` are returned; reading them back can fix the known reconciliation
  gap where the statement wizard's "predicted to be linked" preview
  over-promises against Isometric's server-derived period.
- **Source `description`.** Optional human-readable label now accepted on
  `POST /sources` / `PATCH /sources/{id}` (we pass the `Undefined` sentinel
  today). Wire it to a real label when the Sources panel grows one.

### GHG-statement period-overlap: app-layer guard vs. DB constraint (`isometric/ghg-period-overlap-db-constraint`, opened 2026-06-04)

- **Non-overlapping reporting periods are enforced in `createGhgStatementDraft`**
  (reject an `end_on` ≤ the latest other statement's end) and mirrored in the
  create drawer. This is a read-then-write check, not a DB invariant.
- A truly concurrent pair of creates with overlapping periods could both pass
  the check (TOCTOU). Low likelihood — periods are consecutive, the
  `(provider, facility, end_on)` unique constraint already blocks exact dupes,
  and this is a single-operator internal tool — but it's not airtight.
- Resolve via: a Postgres `EXCLUDE USING gist` range constraint on
  `(facility_id, daterange(reporting_period_start_on, reporting_period_end_on))`
  once start dates are reliably populated (they're reconciled post-create, so a
  draft row has a null start until Isometric returns the window — the constraint
  would need to tolerate that or be deferred). Decide if the DB-level guarantee
  is worth the `btree_gist` extension + null-start handling.

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

### Remaining template-coverage gaps

The Phase 3 / 3.6 / 3.7 template inspection found ~10 input coverage gaps;
all are now closed (the period-level inputs were resolved 2026-05-24 by
[ADR 0005](../adr/0005-period-emissions-as-project-components.md) — they're
now `PROJECT`-scope Components managed in the Isometric UI). The full
breakdown is in `docs/isometric/changes.md` (2026-05-11, 2026-05-13,
2026-05-21 entries). Two forward-looking items remain:

- **Pyrolyzer pre/post electricity readout** (`isometric/phase-3-readouts`)
  — opened 2026-05-13. `INPUT_MAPPING` under
  `pyrolysis / metered_energy_based_ci_emissions` synthesises
  `initial_readout = 0`, `final_readout = totalElectricityKwh`. The
  difference equals real consumption, which is the only quantity Certify
  uses downstream — verifier-acceptable today, but replace with real
  per-run pre/post readouts when `production_runs` gains the columns.

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

### Isometric Certify API — no facilities LIST endpoint (forces paste-only `fcl_…`) (`isometric/facilities-list-endpoint`, opened 2026-06-10, filed 2026-06-10)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  (missing capability) on 2026-06-10. Remains open here until a read endpoint
  exists.
- The Certify API exposes **no way to enumerate facilities** — verified against
  the live operation list (`mcp__isometric__openapi_documents_list_objects`,
  certify): no `GET /facilities`, no `GET /projects/{project_id}/facilities`,
  no `POST /facilities`. The facility id (`fcl_…`) appears only as a stored
  scalar field on other resources.
- **Why it matters:** the facility certifier mapping's "Isometric facility
  (telemetry)" field (`externalFacilityId`) is therefore a free-text paste —
  operators create the facility in the Certify UI, then hand-copy the `fcl_…`
  id into noma (`facility-certifier-dialog.tsx`). Error-prone (typo →
  telemetry submitted against the wrong facility), and it's the one mapping
  field with no validation against a real list. We wanted a dropdown; the
  missing LIST capability blocks it. (Creation being UI-only is fine and
  intentional — the gap is purely the missing read.)
- **Resolve via:** when Isometric ships a read endpoint (ideally
  `GET /projects/{project_id}/facilities` returning id + display name), wire the
  dropdown by mirroring the existing template-picker chain:
  `listFacilitiesByProject()` in `src/lib/isometric/projects.ts` → a
  `useIsometricProjectFacilities(projectId)` hook (pattern:
  `useIsometricProjectTemplates`) → swap the free-text `externalFacilityId`
  `FormInput` for a `FormSelect` in `facility-certifier-dialog.tsx`. Re-check
  the certify OpenAPI operation list on the next update-playbook pass; close
  this entry once the endpoint exists.

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
- **2026-06-03 update — stakeholder ask: why do we not have this data,
  and is an interim `0` acceptable?** Surfaced again hitting SUBMIT on
  `/certification/removals`. The root cause is upstream of the template:
  noma has **no source for the `pyrolyzer_direct` magnitude** (exhaust
  CH₄/CO concentration + gas mass flow). It is not operational
  production-run data — it comes from the annual external LCA, and the
  `certifier_project_emissions` rows are still Moshi-LCA **placeholders**,
  not real extracted values (ADR 0005 "no production promotion until the
  seed is replaced").
  - **The interim-`0` temptation is the exact integrity bug ADR 0005
    removed.** Pyrolyzer direct emissions are *positive* emissions that
    *reduce* net removal. Sending `0` (the old zero-stub behaviour)
    **inflates** the credit and is anti-conservative — the wrong
    direction for a registry. So `0` is not a neutral placeholder; it is
    an over-claim until the real LCA value lands.
  - **Stakeholder questions to resolve:**
    1. Who owns the LCA report, and what is the real `pyrolyzer_direct`
       value (kg CO₂e for the window) we should transcribe into
       `/admin/emission-estimates`?
    2. Until that value exists, is the agreed interim posture (a) **omit
       the component from the template** so the Removal simply doesn't
       carry it (data absent, not a false `0`), or (b) a deliberately
       **conservative over-estimate** transcribed as a PROJECT-scope
       Component? Both are defensible; `0` is not.
    3. Does this block only sandbox exploration, or a real
       production submission? (Sandbox: unblock by editing the sandbox
       template only — no registry consequence.)
  - **Do NOT re-add a zero-stub `INPUT_MAPPING` entry to bypass the
    guard.** That reverts ADR 0005 and re-introduces the over-claim.
    The unblock path is template-field removal, not a fake datapoint.

### Certify-removal redesign — pinned biochar protocol behind latest certified (opened 2026-06-04)

- `docs/isometric/versions.json` pins biochar `1.2.0`; a `protocols_analyze` on
  2026-06-04 resolved patch `1.2.2`, and biochar `1.3` is now **CERTIFIED**
  (2026-05-22) on the registry (some modules likewise have newer patches).
- **Why it matters:** the per-batch health check + submit payload encode
  1.2-line expectations; if 1.3 changes the required-input/evidence set or
  durability thresholds (H:Corg < 0.5, R₀ ≥ 2%, pollutant ceilings), they drift
  from the live protocol.
- **Resolve via:** an `update-playbook.md` pass evaluating 1.2 → 1.3 (refresh
  `requirements-shortlist.md` + `schema-mapping.md`, append to `changes.md`).
  Out of scope for the redesign build itself — but the redesign must not bake in
  1.2-specific numbers it doesn't already depend on.

### Certify-removal redesign — submit-context builder N+1 on selection/submit hot paths (`certification/submit-context-n+1`, opened 2026-06-05)

- Two N+1s remain in the shared submission-context builder (surfaced by the
  2026-06-05 CodeRabbit + audit pass): `loadSelectableBatchesForFacility`
  (`fn/certification/certify-context.ts`) loops a full `buildRemovalContext` per
  ungrouped batch — each iteration walks that batch's applications through
  `getChainOfCustodyData` (~6 queries/application) plus production-run and
  transport-leg loads; and `resolveScopeForRemoval` resolves member
  `applicationIds` + `co2eStoredPreview` per member (≈2×M queries).
- **Why it matters:** the New-Removal wizard's first step and the submit path;
  cost scales with batches × applications-per-batch. The per-batch Isometric
  *remote* calls were already hoisted, and the create-removal confirm loop was
  fixed in the same pass (`buildCreditBatchContextWithFacts` loads facility facts
  once) — what's left is the per-batch DB lineage fan-out.
- **Resolve via:** rework `buildRemovalContext` to batch the lineage walks across
  a batch set (one chain-of-custody resolve keyed by all `applicationIds`, one
  transport-leg query over all entity ids), or add a lighter projected
  fact-loader for the ungrouped-batch health verdict that doesn't need the full
  submission context. **Constraint:** `resolveScopeForRemoval` now intentionally
  does per-batch preview work because the submit summary needs
  `co2eStoredPreview` per member (the `0.0 tCO₂e` fix, 2026-06-05) — a
  grouped-`applicationIds` optimization must still supply the per-batch preview.
  The builder is shared with the submit pipeline (`submitRemoval`), so verify
  both paths. High-risk, deliberately deferred — wants a focused pass, not a
  mechanical edit.

### Certify-removal redesign — wizard robustness gaps (`certification/wizard-robustness`, opened 2026-06-05)

- Three failure-path gaps from the 2026-06-05 audit, all low-likelihood on a
  single-operator tool but each a surprising mode before a registry write:
  - **Submit double-fire:** `SubmitConfirmDialog.onConfirm`
    (`components/certification/new-removal-dialog/submit-step.tsx`) calls
    `fireSubmit(true)` unconditionally; a double-activate before `isPending`
    flips can fire the mutation twice. (Server submit is ~idempotent, which
    softens it; the primary Submit button is already `busy`-guarded.)
  - **Registry-guard error path:** `CertificationRegistryGuard`
    (`components/certification/certification-registry-guard.tsx`) ignores the
    certifier-summary query's `error` — a transient fetch failure reads as
    "no registry" and silently redirects the operator from every certification
    page to Settings (vs. a retry state). It also renders blank `null` while
    loading rather than a loading affordance.
  - **Batch-health TOCTOU:** `createRemovalWithBatchesAction` re-derives each
    batch's health *outside* the write transaction; the data-access write
    re-checks ungrouped/same-facility under `FOR UPDATE` but not health, so a
    batch could regress below `ready` between check and locked write. Health is
    a soft/derived gate, so impact is grouping a briefly-regressed batch.
- **Resolve via:** guard `onConfirm` with `if (submitMutation.isPending) return;`
  and disable the confirm action while pending; give the registry guard an
  explicit error/retry state distinct from "no registry" (and a loading
  affordance vs. bare `null`); for the TOCTOU, either re-assert
  `state === "ready"` inside `createRemovalWithCreditBatches` after acquiring the
  locks, or document health as a point-in-time advisory, not a write invariant.
  (Missing structured logs on the removal writes belong with the deferred
  observability work — see `Correctness / observability` below — not here.)

### Certify-removal redesign — removal-detail-sheet deep link drops `step=evidence` (`certification/removal-detail-deep-link`, opened 2026-06-05)

- The redesign turned `removals/[removalId]/review` into a redirect that strips
  `?step=`. `components/certification/removal-detail-sheet.tsx` (not in the
  redesign's changed set, so untouched) still builds
  `evidenceHref = ${reviewHref}&step=evidence` plus a "Review & submit" link, so
  that deep link silently loses its evidence-step intent and lands on the wizard
  entry instead. Flagged by both the simplify and loading-states audit passes.
- **Why it matters:** minor UX regression on an existing entry point; not a
  crash, but the operator no longer arrives where the link promises.
- **Resolve via:** point `removal-detail-sheet.tsx` at the wizard's resume entry
  directly (drop the now-dead `&step=` param), or have the redirect
  preserve/translate `step=` into the new `resume=` param.

## Audit follow-ups (opened 2026-05-25)

Batch of deferrals from the whole-codebase tech-debt audit run on
`feature/isometric-api` (CRITICAL + HIGH fixes landed in-PR; entries below
are the items that were flagged but kept out of that scope). Roughly
ordered by leverage.

### Architecture audit — remaining phases (opened 2026-05-21, plan archived 2026-06-03)

The 2026-05-21 `/ship AUDIT` plan
(`docs/archive/2026-05-21-architecture-audit-scalability-tech-debt.md`) was
partially executed: Phase 0 (PII log line, doc-query cap, parallel FK checks,
`max-lines` lint, `DB_POOL_MAX` docs, CI prod approval gate) and the
observability half of Phase 2 (structured logger) are done; Phase 4 split the
two oversized data-access files. The remainder is still open:

- **Phase 1 — schema-wide indexes.** Add `index()` for unindexed FK columns
  across the schema, time-series indexes (`productionRunReadings.timestamp`,
  `soilTemperatureMeasurements.measurement_date`), and the composite
  `transportLegs (entity_type, entity_id)`. One `pnpm db:generate` migration.
  (Superset of the narrower isometric-table composites in `perf/missing-indexes`
  below — fold those into the same migration.)
- **Phase 3 — read-path + correctness.** `creditBatches` aggregate-drift (T2)
  is the priority: stored CO₂e/mass aggregates have nothing keeping them in sync
  with linked applications — a reported-number correctness risk for a carbon
  registry; prefer deriving over storing. Plus H5 explicit column selection on
  wide-table reads, full document pagination, a central `query-config.ts`,
  narrowed React Query invalidation, and `revalidatePath` on key mutations.
- **Phase 4 (remainder) — file size.** `seed-data.ts` (1165 LOC) and ~11
  oversized forms still exceed the 1000-line cap; then flip the `max-lines` lint
  from `warn` to `error`.
- **Phase 5 — CRUD/hooks de-duplication.** Same scope as `code/hooks-factory`
  below; optional, only worth it if the entity set keeps growing.

### Structural / cross-cutting

- **Duplicate-hooks factory** (`code/hooks-factory`) — opened 2026-05-25.
  - The `src/hooks/use-*.ts` family is ~4–5k lines of near-identical
    query/mutation wiring per entity. A `createEntityHooks(...)` factory
    would collapse most of it. (Carved out of the original `code/file-size-rule`
    entry, whose data-access file-size half is now resolved — see below.)
  - Resolve via: dedicated refactor PR — should not stack on top of
    in-flight feature work.

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

- **Pin the document-redirect allowlist to the exact Isometric report bucket**
  (`security/redirect-host-pinning`)
  - The `/api/documents/[id]` redirect guard was narrowed (2026-06-03, see
    `docs/isometric/changes.md`) to `.s3.amazonaws.com` (+ regional/dualstack),
    `.storage.googleapis.com`, `.digitaloceanspaces.com`, `.isometric.com`. The
    S3/Spaces families still match **any** bucket on those providers, so an authed
    user could still store a `fileUrl` on an arbitrary bucket host. Low risk
    (browser 302; not request-attacker-controlled), accepted for now.
  - Resolve via: discover the exact host(s) Isometric presigns GHG-statement
    report URLs against (Isometric MCP `how_to` → certify OpenAPI report object,
    or inspect `documents.file_url` in a real environment) and set
    `ISOMETRIC_STORAGE_REDIRECT_HOSTS` to that explicit host per environment — it
    replaces the default families. No code change needed.

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

## Product bins & formulations

### Product-bin formulation claim-release policy (`product-bins/formulation`) — opened 2026-06-04, **deferred**

- A product bin (`storage_locations` of type `product_bin`) carries an
  optional `formulationId` enforcing "one formulation per bin" so bins stay
  clean (mirrors the existing `feedstockTypeId` "one feedstock type per bin"
  pattern). It is set at bin setup, or **claimed on first use**: the first
  formulated product placed into an unassigned bin sets the bin's
  `formulationId` (`createBiocharProduct` / `updateBiocharProduct` in
  `src/data-access/biochar-products.ts`).
- **Decision deferred:** the claim is currently a *persistent* reservation —
  nothing auto-releases it when the bin's last product is applied/removed or
  has its formulation changed. To re-purpose an emptied bin, an operator edits
  the bin and clears the formulation. `updateStorageLocation` guards that edit:
  it rejects clearing/re-pointing while the bin still holds product of a
  different formulation (`IS DISTINCT FROM`), so manual release is only allowed
  once the bin is genuinely free of conflicting product.
- **Why it matters:** without auto-release, a long-lived facility accumulates
  bins permanently tagged to old formulations, so they stop appearing as
  "unassigned" for new pure-biochar or different-formulation intake. Acceptable
  for now (manual release works); revisit if operators report bin churn.
- **Resolve via:** decide between (a) keep manual release (document as the
  intended model), or (b) auto-clear a bin's `formulationId` when its last
  matching product leaves (`deleteBiocharProduct` + the move-out path of
  `updateBiocharProduct`). If (b), record the decision and remove this entry.

## E2E walkthrough follow-ups (opened 2026-06-07)

Surfaced by a manual walkthrough of every entity + certification; most findings
were fixed in that pass and the two below were deferred by product decision. The
dated run context and the registry counts that prompted these questions are
archived in
[docs/archive/2026-06-07-e2e-walkthrough-snapshot.md](archive/2026-06-07-e2e-walkthrough-snapshot.md).

### Production-run Readings: wire-in vs. remove (`production-runs/readings`) — opened 2026-06-07, **deferred**

- `ProductionRunReadingForm` + `ProductionRunReadingTable` (plus the schema and
  `src/data-access/production-runs` reading queries/hooks) exist but are
  **imported nowhere**. The only readings UI on the prod-run form is a
  non-functional CSV stub labelled "UI mock only … not uploaded or saved yet".
- **Why it matters:** a half-built feature plus a stub that looks functional
  invites confusion (an operator may believe CSV readings are persisted).
- **Resolve via:** decide between (a) wire the Reading table/form into the
  prod-run **edit** sheet like Samples/Incidents and implement real CSV upload
  + persistence (L), or (b) remove the dead components and the CSV stub (S).
  Record the decision and remove this entry.

### Certification view is local-first; doesn't mirror the registry (`isometric/registry-mirror`) — opened 2026-06-07, **deferred**

- The in-app cert view can show 0 removals / 0 GHG statements while the live
  sandbox registry holds drafts created out-of-band. Period math aligns (the
  app preview's "0 removals" for an open period matches the registry draft), so
  this is almost certainly **by-design**: the app surfaces only what *it*
  created, not the full registry state. (A concrete observed snapshot of these
  counts is archived in
  [2026-06-07-e2e-walkthrough-snapshot.md](archive/2026-06-07-e2e-walkthrough-snapshot.md).)
- **Why it matters:** the bare 0-counts can be misread as "the registry is
  empty" rather than "nothing created from here yet".
- **Resolve via:** decide between (a) a one-line note in the cert UI clarifying
  the local-first model (S), or (b) a read/sync view that mirrors existing
  registry removals/statements into the app (M–L). Likely (a); record the
  decision and remove this entry.
- **API note (2026-06-07):** option (b) is technically **unblocked** — the
  Certify API exposes `GET /ghg_statements` (active, cursor-paginated) and
  `GET /removals` (deprecated but functional, filterable by
  `supplier_reference_id`), plus single-`GET` variants. So a read/sync view is
  buildable; the open decision is product (do we want it), not capability.

### Isometric submission refs aren't stable across a DB reseed (`isometric/reseed-idempotency`) — opened 2026-06-07, **deferred**

- Submission idempotency **is implemented and correct within a DB lifetime**:
  `submission-claim.ts` locks drafts, refs are deterministic
  (`buildSourceSupplierRef` → `nm-src-{documentId}`), and
  `findRemovalBySupplierRef` + idempotent membership linking reconcile after a
  5xx instead of recreating. The gap: `supplier_reference_id` is derived from
  **local row UUIDs**, which `pnpm db:reset` regenerates → the dedupe lookup
  can't match the prior registry entity → re-submission creates a **duplicate**
  registry removal/source/statement. This is the likely cause of the sandbox
  project accumulating duplicate draft removals across test cycles (see the
  archived [walkthrough snapshot](archive/2026-06-07-e2e-walkthrough-snapshot.md)
  for observed counts).
- **Why it matters:** **sandbox-only today** — prod won't reseed, so refs stay
  stable and idempotency holds. It's a test-hygiene issue, not a production
  data-integrity bug. But it makes the sandbox registry a noisy mirror, and any
  future reseed-like prod event (restore from scratch, re-key) would silently
  duplicate.
- **Resolve via:** (a) accept it — sandbox drafts are harmless (0 credits
  issued); optionally clean them periodically (S); or (b) derive
  `supplier_reference_id` from a stable business key (the entity's `XX-26-NNN`
  code) instead of the row UUID, so re-submission after a reseed reconciles
  instead of duplicating (M). Likely (a) pre-launch. Record the decision and
  remove this entry.

## Audit follow-ups (whole-repo audit, opened 2026-06-07)

Deferred items from the 9-commit + working-tree audit — held back as needing a
product/UX decision or being larger than a review-fix. The audit pass's
execution summary (which high-severity findings were fixed) is archived in
[docs/archive/2026-06-07-whole-repo-audit-snapshot.md](archive/2026-06-07-whole-repo-audit-snapshot.md).
Sizing: (S) small, (M) medium, (L) large.

### Unbounded readings table — pagination/virtualization (`perf/readings-table-unbounded`) — opened 2026-06-07, **deferred**

- The `(production_run_id, timestamp)` index **landed** (migration `0036`), so the query
  is no longer a full scan. Still open: `getProductionRunReadings` has no `.limit`, and
  `production-run-reading-table.tsx` renders every row to the DOM with no virtualization.
  Telemetry is the highest-cardinality child entity on a run.
- **Why it matters:** a run with thousands of readings ships the whole set to the client
  and paints every row. Not biting yet at seed scale; will bite as real telemetry lands.
- **Resolve via:** decide server-side paging UX (page size, infinite-scroll vs. pages),
  then add `.limit`/offset + `@tanstack/react-virtual` (M). UX decision first.

### Overview loader lineage fan-out (`perf/overview-lineage-nplus1`) — opened 2026-06-07, **deferred**

- `loadCertificationOverview` rebuilds a full submission context per removal; each walks
  every application through `getChainOfCustodyData`, which issues ~5–6 sequential single-row
  queries → on the order of R×A×6 round-trips per landing-page load, uncached. Same root
  pattern as the per-batch `getCo2eStoredPreview` fan-out (`credit-batches.ts:380`) and the
  per-row `getCreditBatchById`/`getLatestSubmission` loops in `certify-context-core.ts`.
- **Why it matters:** the certification landing page latency grows linearly with
  removals×applications; every navigation re-runs the full fan-out.
- **Resolve via:** batch lineage with set-based `inArray` queries (delivery→order→
  product→run in one pass, zip in JS) and/or memoize the Overview payload (React Query
  staleTime or a server cache). The batched primitive `getCreditBatchSummariesByRemovalIds`
  already exists as a model (L). Owner decides read/write/cache tradeoff.

### create-removal idempotency key (`concurrency/create-removal-idempotency`) — opened 2026-06-07, **deferred**

- `createRemovalWithBatchesAction` has no server-side idempotency key. Batch double-link is
  already race-safe (rows locked `FOR UPDATE`, re-checked `removalId IS NULL`), and the UI
  Confirm button is `busy`-gated, so single-tab and same-batch-set retries are covered. The
  residual gap: a network retry or a second tab submitting a **disjoint** batch set can create
  an extra `certifier_removals` row, and `gcRemovalIfOrphaned` only reaps on delete, not create.
  A creation **log line** was added in the audit pass; the dedupe key was not.
- **Why it matters:** narrow exposure (no batch double-spend, no bad credits — just a stray
  empty/duplicate removal), but it needs product semantics to close cleanly.
- **Resolve via:** add optional client-generated `idempotencyKey` to
  `createRemovalWithBatchesSchema`, persist with a unique index, `INSERT … ON CONFLICT
  (idempotency_key) DO NOTHING RETURNING id` inside the existing txn (M). Local Postgres
  dedupe only — the Isometric POST happens later in `submitRemoval`, no upstream idempotency
  header applies here.

### Inline-CRUD table duplication (`refactor/inline-crud-table`) — opened 2026-06-07, **deferred**

- The three production-run child tables (readings/incidents/samples) share ~90% boilerplate:
  identical `inlineForm` discriminated-union state machine, header markup, `TableSkeleton`,
  empty state, edit/delete column, and `DeleteConfirmDialog` wiring. `formatTimestamp` is
  copy-pasted 3×.
- **Why it matters:** maintenance drift — a fix to one table's CRUD flow has to be mirrored
  3× (this audit already had to touch all three together for the `readOnly`/loading changes).
- **Resolve via:** extract a generic `<InlineEntityTable>` or `useInlineCrudTable` hook
  parameterized by columns + form component + mutation hooks; per-entity files collapse to a
  config (M). Deliberately not done as a review-fix — pure refactor, no behavior change, wants
  its own PR + test pass.

### Generic typing for the certify field registry (`types/certify-registry-generic`) — opened 2026-06-07, **deferred**

- `certify-field-registry.ts` condition/`formFields` lookups are keyed by bare strings probed
  via `(entity as Record<string, unknown>)[field]` in `entity-readiness.ts`. A typo in a
  registry key compiles fine and silently reads `undefined` → readiness gate passes when it
  shouldn't. This class of bug is exactly what produced the original **MRV durability gap**
  (now fixed at the data layer + covered by a regression test in
  `tests/isometric-certify-context.test.ts`).
- **Why it matters:** the focused regression test closes the *known* instance; the *class*
  remains open — another mistyped key would fail the same silent way.
- **Resolve via:** make the registry generic per entity — `CertifyFieldDescriptor<T>` with
  `condition.field: keyof T` and `formFields: readonly (keyof T)[]`, and
  `deriveEntityCertifyReadiness<T>` bound to the real row type per entity kind, so every key
  becomes a compile-checked property reference (M). Judged not worth doing solely to satisfy
  the audit now that the root cause has a test; revisit when the registry next grows.

### Minor: correlation-id field drift in removal submit (`observability/submit-correlation-id`) — opened 2026-06-07, **deferred**

- The removal submit flow binds `submissionAttemptId` on its child logger but several deeper
  boundary logs key the correlation field as `submissionId` (the DB row id) instead — an
  aggregator filtering on one won't see records keyed by the other. No data loss; weakens
  "trace one attempt end-to-end." `ghg-statements.ts` already uses `submissionAttemptId`
  consistently.
- **Resolve via:** thread the attempt-scoped `log` child (which already carries
  `submissionAttemptId`) through those boundary logs, or include both ids (S).

## E2E robustness follow-ups (opened 2026-06-10)

Deferred from the e2e-reliability pass that split live-sandbox specs out of PR
CI (`@live` tag → nightly `e2e-live.yml`) and fixed the stale full-chain
selectors (EntitySelect migration, auto-matched credit-batch applications).

### Graceful degrade for invalid Isometric project links (`certification/invalid-project-422`) — opened 2026-06-10

- A facility linked to a project id the registry rejects (404/422) makes
  `safeListIfConfigured` re-throw, and React Query retries the failing server
  action — repeated real API calls and a degraded page instead of a calm
  "project not resolvable" state. Surfaced in CI when fake-project specs ran
  with real creds loaded; same behavior would hit prod on a stale/revoked link.
- **Resolve via:** treat non-retryable 4xx (404/422) from project-scoped
  listings as "link not resolvable" — return an empty/flagged result instead of
  throwing, and surface a warning chip on the registry-connection card (M).

### Hermetic local stub for the Isometric client (`testing/isometric-stub`) — opened 2026-06-10

- `BASE_URLS` in `src/lib/isometric/client.ts` is hardcoded, so the @live specs
  can only run against the real sandbox; devs without `ISOMETRIC_DEMO_PROJECT_ID`
  silently skip them, which is how the Settings/mapping specs drifted unnoticed.
- **Resolve via:** a test-only base-URL override + a small fixture stub server
  (started from Playwright globalSetup) serving canned project/template
  responses, so the certification flows run hermetically everywhere (M).

### Unprompted "Link Isometric project" modal after facility create, CI prod build only (`facilities/phantom-link-dialog`) — opened 2026-06-10

- In the first hermetic CI run (PR #167, run 27265121281, shard 1), the
  `facilities.spec.ts` "admin can create a facility" test failed on both
  attempts: artifacts show `FacilityCertifierDialog` ("Link Isometric project")
  open over `/facilities` immediately after the create succeeded, aria-hiding
  the page so the heading role-query failed. The trace records no click that
  opens it, and static analysis finds no mount outside
  `facility-certifier-section.tsx` (Settings page, click-gated `editOpen`).
  Not reproducible locally in dev mode, with or without Isometric creds; the
  test passed in all prior CI runs (which loaded creds).
- **Why it matters:** if the modal really opens unprompted on production
  builds, that's a user-facing bug, not a test bug.
- **Replication attempts (all passed — GitHub-runner-only, 6/6 failures
  there):** local dev build (with and without Isometric creds), local prod
  build hermetic, prod + empty freshly-pushed DB, and full shard-1 set (51
  tests, 2 workers, retries, empty DB, `CI=1`). The dialog is
  `FacilityCertifierDialog` (trace DOM: `facility-certifier-dialog-title`,
  empty project options), whose ONLY JSX mount is click-gated `editOpen` in
  `facility-certifier-section.tsx` — rendered solely on
  `/certification/settings`, yet it appears on `/facilities` ~0.5s after
  facility create, amid the sidebar-wide RSC re-prefetch triggered by the
  `?facility=` URL swap. Prime suspects: Next 16 PPR/prefetch interaction
  under slow CI CPU.
- **Interim quarantine:** `facilities.spec.ts` dismisses the modal if present
  (loud `phantom-link-dialog` test annotation) so the suite stays green while
  keeping the real assertion. Remove the workaround when this is resolved.
- **Resolve via:** CI-side instrumentation — temporary `--trace on` first
  attempt, or a debug step dumping the React owner chain of the dialog node
  when present (component names need a non-minified build to be readable) (M).

### Playwright hygiene (`testing/e2e-hygiene`) — opened 2026-06-10

- `waitForLoadState("networkidle")` is used throughout `full-chain-ui.spec.ts`
  (slow-by-design with polling queries); shard 1 carries all `certification-*`
  files because sharding distributes by file. Consider `fullyParallel: true`
  (shard by test) after confirming no in-file ordering deps, replacing
  networkidle waits with role-based expects, and `eslint-plugin-playwright` (S).
