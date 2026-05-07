# Isometric Docs Change Log

## 2026-05-06 (Simplify pass — race fix + sandbox test gating)

- **Certifier mapping race in `submitCreditBatch`.** Added
  `insertDraftSubmissionWithMappingLock` and
  `resetSubmissionToDraftWithMappingLock` in `data-access/certification.ts`.
  Each opens a transaction, takes `SELECT ... FOR UPDATE` on the
  `certifier_projects` row keyed by `(facilityId, provider)`, and verifies
  the locked row still matches the `expectedExternalProjectId` (and, for
  Removals, the `expectedDefaultRemovalTemplateId`) the orchestrator
  observed when it built the payload. Both `submitCreditBatch` and
  `createGhgStatementForFacility` now use these variants. The lock
  serializes against the `unlink`/`repoint` paths in
  `upsertCertifierProject` / `deleteCertifierProject`, so a concurrent
  remap either blocks the in-flight submission or fails it cleanly with
  no `certification_submissions` row written.
- **Live sandbox tests are now opt-in.** `tests/isometric-sandbox.integration.test.ts`
  also requires `RUN_ISOMETRIC_SANDBOX_TESTS=1`, on top of the existing
  `ISOMETRIC_*` env preconditions. `pnpm test` skips the file by default;
  use `pnpm test:integration` (sets the env var and includes only
  `tests/**/*.integration.test.ts`) to exercise it. This stops accidental
  hits on the live sandbox during plain `pnpm test`.
- **Internal simplifications.** `submit-credit-batch.ts` now uses a single
  `createOrReconcile` helper for both the datapoint loop and the removal
  POST, replacing two duplicated try/reconcile/log paths.
  `submissions.ts` consolidated `findRemovalBySupplierRef` /
  `findDatapointBySupplierRef` onto a shared `findBySupplierRef` helper.
  `utils/supplier-ref.ts` now names the slug-length constants instead of
  inlining magic numbers.
- **New unit tests** (`tests/isometric-mapping-lock.test.ts`) cover the
  three mapping-lock failure paths (missing row, repointed
  externalProjectId, changed defaultRemovalTemplateId) and both happy
  paths (insert-draft + reset-to-draft).

## 2026-05-06 (Sandbox validation pass)

- **Scope:** First validation pass against the Isometric Certify sandbox
  (`https://api.sandbox.isometric.com/mrv/v0`) using the new sandbox
  credentials in local `.env.local`.
- Updated `scripts/isometric-smoke.ts` and `scripts/isometric-link-demo.ts`
  so the demo project can be overridden by argv or
  `ISOMETRIC_DEMO_PROJECT_ID`. The production demo project remains the
  default guardrail.
- Sandbox baseline:
  - `pnpm tsx scripts/isometric-smoke.ts` confirmed
    `ISOMETRIC_ENVIRONMENT=sandbox` and returned one project:
    `prj_1K9YJ33RKSBX9FFF`.
  - `pnpm tsx scripts/isometric-smoke.ts inspect-template
    prj_1K9YJ33RKSBX9FFF` returned two templates: `Protocol default`
    (`rvt_1K9YJ33RKSBXR2Y3`) and `Dark Earth removal template`
    (`rvt_1K9YK6YRQSBXFVZ0`). Sandbox still has monitored-input coverage
    gaps: 21 unmapped monitored inputs across the two templates. Fixed
    constants are still mostly unbound; the custom template has one
    pre-bound `carbon_intensity` datapoint on the "Last mile feedstock
    transport" component.
  - `pnpm tsx scripts/isometric-smoke.ts datapoint-empty-sources
    prj_1K9YJ33RKSBX9FFF` confirmed sandbox accepts Datapoints with
    `source_ids: []`; created `dtp_1KQYVM2KRSBX2ZF6`.
  - `pnpm tsx scripts/isometric-smoke.ts ghg-statement-list
    prj_1K9YJ33RKSBX9FFF` returned one visible draft statement:
    `ggs_1K9YK7J6FSBX4QM0`, period `2026-01-01..2026-04-01`, one
    Removal.
- Local mapping/context checks:
  - Repointed the two local facility mappings to sandbox project
    `prj_1K9YJ33RKSBX9FFF`, confirming the Phase 1 N-facilities-to-one
    project shape still works.
  - Verified stale default-template drift by temporarily setting the local
    credit-batch facility to production template `rvt_1K5F2F6SN1S0N53K`;
    `loadCertifyContextForCreditBatchForUser` surfaced
    `missingDefaultTemplateId` distinctly from the unset-template state.
  - Restored the credit-batch facility to custom sandbox template
    `rvt_1K9YK6YRQSBXFVZ0`; context resolved 9 component blueprints and
    no unresolved blueprint keys. `isProduction=false`, so the production
    confirmation gate remains off under sandbox.
- Verification run:
  - `pnpm test` — 146 tests passed.
  - `pnpm test:e2e` — 75 tests passed, 2 skipped.
  - `pnpm typecheck` — passed.
  - `pnpm lint` — passed with 27 pre-existing warnings outside the touched
    scripts.
- Not yet sandbox-verified end-to-end: credit-batch Removal POST,
  Removal idempotency/supersede, stale-lock recovery, and GHG statement
  create/submit/refresh. The sandbox templates still need pre-bound fixed
  constants and/or a noma-tailored template before the Phase 3 write path
  can pass beyond its current guard.

### Re-validation (later 2026-05-06)

- Tightened `scripts/isometric-smoke.ts` so project-specific modes
  (`inspect-template`, `datapoint-empty-sources`, `ghg-statement-list`)
  refuse to silently fall back to the production demo project ID when
  `ISOMETRIC_ENVIRONMENT=sandbox`. They now require an explicit argv or
  `ISOMETRIC_DEMO_PROJECT_ID` env var on sandbox; production keeps the
  hard-coded fallback.
- Re-ran the gate sequence end-to-end against sandbox `prj_1K9YJ33RKSBX9FFF`:
  - **Gate A**: project list + ghg-statement list reachable; smoke
    datapoint `dtp_1KQYXPV3QSBXPPNG` created with `source_ids: []`.
  - **Gate B**: `inspect-template` re-reports the same gap shape — 21
    unmapped monitored inputs across both templates and unbound fixed
    constants. `submitCreditBatch` would still bail at its template
    guard, so Gates D + E remain `blocked-by-template-readiness`.
  - **Gate C**: confirmed Phase 1 N→1 mapping (both local facilities
    linked to the sandbox project) and the Phase 2 panel rendering on
    credit batch `CB-2026-001`. Phase 2 panel showed 9 blueprints
    matching the inspect-template output and the "Submit to Isometric"
    button was reachable. Drift state re-verified via a temporary
    DB-level template-id swap; the credit-batch panel surfaced the
    distinct "Default removal template is no longer available in
    Certify for this project" warning, and the original template ID
    (`rvt_1K9YK6YRQSBXFVZ0`) was restored immediately.
- Outstanding from this re-validation:
  - Stale-template **server-action** rejection (Gate C step 3) is still
    only covered indirectly. A pure project↔template validation helper
    extracted from `saveFacilityCertifierMapping` would let us assert
    the failure case from a `pnpm tsx` script without standing up a
    Next.js request context.

## 2026-05-06 (Refactor)

- **Scope:** Extract the duplicated submission-claim decision from
  `submitCreditBatch` and `createGhgStatementForFacility` into a pure
  policy module. No runtime-behaviour changes; previously-untested gate
  is now covered by unit tests.
- New code:
  - `src/lib/isometric/utils/submission-claim.ts` —
    `decideSubmissionClaim({ latest, payloadHash, now, lockTtlMs, policy })`
    returns one of `create-new-version` / `resume` / `return-existing` /
    `blocked-in-flight` / `blocked-rejected-with-external` /
    `invalid-changed-hash`. Pure: no I/O, no DB, no fetch. Owns all
    versioning math (callers no longer special-case version=1). Status
    switch is exhaustive with an `assertNever` default so a future
    `certificationSubmissionStatus` enum value is a compile-time error.
  - The single policy parameter `onSubmittedHashChanged` is `'supersede'`
    for Removals (bump version, mark previous superseded) and
    `'invalid-changed-hash'` for GHG-statement creation (the remote
    period row is unique per `(project, end_on)`, so a hash change at
    that state is a programmer error).
  - `tests/isometric-submission-claim.test.ts` — 18 cases covering both
    policies, lock-TTL boundary (strict `<`), defensive
    `submitted + externalId=null`, every status path, determinism, and
    the assertNever guard.
- Refactored:
  - `src/fn/certification/submit-credit-batch.ts` — replaced the
    `if (latest)` tree (lines 283–313 prior to the refactor) with a
    `switch (claim.kind)` on the new module's output. `console.warn` on
    `rejected-hash-changed` preserved.
  - `src/fn/certification/ghg-statements.ts` — same shape for
    `createGhgStatementForFacility` (replaced lines 156–195 prior to the
    refactor). `console.warn` on `rejected-hash-changed` preserved.
- Re-exports: `src/lib/isometric/index.ts` exposes
  `decideSubmissionClaim`, `SubmissionClaim`, `SubmissionClaimInput`,
  `SubmissionClaimPolicy`, `SubmissionClaimRow`, `SubmissionClaimStatus`.
  Internal helpers stay private to the module.
- Why now / why this scope:
  - The two call sites duplicated ~30 lines of nearly identical decision
    logic with one policy difference; small drift had already started
    (different in-flight messages, different rejected handling).
  - This module sits before every external API side effect, so a bug in
    it is high-blast-radius. It was untested.
  - Deliberately *not* an orchestrator or generic state machine — the
    reconciliation, sync-event, and POST/retry layers below it are
    untouched. Those depend on this landing first and remain on the
    backlog.
- Refactor RFCs still on the backlog (from the architecture review,
  not started): reconciliation orchestrator
  (`runRemovalSubmission`/`postOrReconcileRemoval`); input catalog
  centralising `INPUT_MAPPING` + datapoint factory; sync-trail recorder
  to guarantee paired sync events around every external call.

## 2026-05-05 (Phase 4)

- **Scope:** GHG statement lifecycle and reconciliation hardening.
- Added `certifier_ghg_periods` as the local project-period anchor for
  GHG statement submissions. Statement state stays in
  `certification_submissions`; supplier-hosted report URLs are recorded in
  `documents` rows with `entity_type='ghgStatement'`.
- Added typed Certify wrappers for `POST /ghg_statements`,
  `GET /ghg_statements/{id}`, and `POST /ghg_statements/{id}/submit`.
  `GET /ghg_statements` is pagination-only, so local reconciliation
  client-filters by project, period end, and `DRAFT` status.
- Split `src/fn/certification.ts` into a `src/fn/certification/`
  module set before adding Phase 4 actions.
- Added `/certification` for creating, submitting, refreshing, and
  resubmitting GHG statements for the selected facility's Isometric project.
- Hardened Phase 3 submission recovery: stale locks and same-hash failed
  attempts now reconcile Datapoints and Removals by stored supplier refs
  before POSTing missing resources.
- Explicitly still deferred: webhook ingestion, noma-driven PATCH
  orchestration for Removals, automatic resubmission, and external
  amendment claiming for registry-side statement-version drafts.

## 2026-05-05 (Phase 3)

- **Scope:** Phase 3 of the Certify API integration — single credit
  batch → single Removal end-to-end, with idempotency ledger.
  Backfilled changelog entry; Phase 3 shipped alongside Phase 4 on
  2026-05-05.
- **Updated by:** Kenji / Claude
- No new schema; Phase 0's `defaultRemovalTemplateId` column is enough.
- New library code under `src/lib/isometric/`:
  - `transformers/datapoint.ts` — `INPUT_MAPPING` + numeric reading →
    `CreateDatapointRequest`. Replaces the planned `source.ts` /
    `component.ts` split: sources are deferred to Phase 3.5
    (presigned-URL flow blocked on the documents subsystem) and
    component-group assembly lives directly in `transformers/removal.ts`.
  - `transformers/removal.ts` — assembles components into the live
    template's component groups.
  - `utils/aggregation.ts` — mass-weighted blends, durability ratios
    (ported from the varuna prototype, correct per Biochar v1.2).
  - `utils/payload-hash.ts` — canonical-JSON sha256 for the idempotency
    ledger. Tests in `tests/isometric-payload-hash.test.ts`.
  - `utils/supplier-ref.ts` — stable client-side reference IDs used to
    GET-by-`supplier_reference_id` after stale locks.
  - `submissions.ts` — `findRemovalBySupplierRef` /
    `findDatapointBySupplierRef` for stale-lock recovery.
- `src/fn/certification.ts` was split into `src/fn/certification/`
  (`facility-mapping.ts`, `certify-context.ts`,
  `submit-credit-batch.ts`, `shared.ts`, `index.ts`) before adding the
  Phase 4 GHG-statement actions.
- New server action `submitCreditBatch(creditBatchId)` in
  `submit-credit-batch.ts`. Reuses `getApplicationLineage()` (does not
  re-derive lineage), runs aggregation, then idempotency-ledger flow
  against `certification_submissions` keyed on `lockedAt` +
  `payloadHash` + `version`. Each HTTP attempt appends a
  `certifier_sync_events` row. The retry-decision gate at the head of
  the orchestrator was later extracted into
  `utils/submission-claim.ts` (see 2026-05-06 entry above).
- UI extensions in `src/components/certification/`:
  - `certify-panel.tsx` gained the "Submit to Isometric" button —
    disabled when the facility is unlinked, when lineage has blocking
    warnings, or when the latest submission row is locked in flight.
  - `submission-status-badge.tsx` and `sync-event-log.tsx` — status
    surfaces driven by the latest `certification_submissions` row and
    the recent `certifier_sync_events` history.
  - Mounted via the existing `viewModeChildren` slot on the
    credit-batch `EntitySideSheet`
    (`src/components/credit-batches/credit-batch-list.tsx`).
- Pre-coding gates resolved during Phase 3 (see
  `docs/open-questions.md`):
  - Empty `source_ids` confirmed accepted by Certify against the demo
    project (`prj_1K5F2F6SN1S0ZKDQ`); Phase 3.5 sources stay deferred.
  - Live-template inspection surfaced two new blockers tracked under
    `phase-3-input-coverage` (20 monitored inputs without
    `INPUT_MAPPING` entries) and `phase-3-fixed-constants` (~12
    `type=fixed` constants needing pre-bound datapoints in the
    Isometric template editor).
- Explicitly deferred at Phase 3 close: source-upload presigned-URL
  flow (Phase 3.5), per-Datapoint sub-ledger rows, transformer unit
  tests. Idempotency-decision unit tests landed via the 2026-05-06
  refactor.

## 2026-05-05 (Phase 2)

- **Scope:** Phase 2 of the Certify API integration — read-only Certify
  panel inside the credit-batch side sheet
- **Updated by:** Kenji / Claude
- New code:
  - `src/lib/isometric/projects.ts` — added `listComponentBlueprints()`
    against the global `GET /component_blueprints` endpoint, plus the
    `IsometricComponentBlueprint` type alias. Re-exported from
    `src/lib/isometric/index.ts`.
  - `src/fn/certification.ts` — added
    `loadCertifyContextForCreditBatch(creditBatchId)`. Resolves credit
    batch → facility → mapping → live project + template + referenced
    blueprints. Distinguishes "no default template" from "default template
    is stale" (drift) via `missingDefaultTemplateId`, and per-blueprint
    drift via `unresolvedBlueprintKeys`. Skips remote calls when
    unlinked, and skips the global blueprint catalog when no resolvable
    template is available.
  - `src/hooks/use-certification.ts` — added
    `useCertifyContextForCreditBatch(creditBatchId)` (5 min stale time)
    and the matching `certifyContextForCreditBatch` query key.
  - `src/components/certification/certify-panel.tsx` — accordion panel
    with five states: loading, error, not-linked, no-default, stale-default,
    and resolved-template (renders the blueprint list).
  - `src/components/certification/blueprint-list.tsx` — pure presentational
    list of resolved blueprints (display name, key, description, inputs
    summary).
- Side sheet:
  - `src/components/credit-batches/credit-batch-list.tsx` mounts
    `<CertifyPanel creditBatchId={…} />` via the existing
    `viewModeChildren` slot on `EntitySideSheet`. No new route or
    detail page.
- Docs:
  - `integration-plan.md` Phase 2 section, "Critical files",
    "Verification": marked done with the actual files shipped.

## 2026-05-05

- **Scope:** Phase 1 of the Certify API integration — facility ↔ Isometric project mapping
- **Updated by:** Kenji / Claude
- Schema changes (migration `drizzle/0016_panoramic_selene.sql`):
  - Dropped `certifier_projects_provider_external_unique` so multiple
    noma facilities can roll up into a single registry project (matches
    how operators register; Isometric's data model has no facility
    concept). Kept `(facilityId, provider)` unique to preserve
    unambiguous routing per facility.
- New code:
  - `src/lib/isometric/projects.ts` — `listProjects()`,
    `listRemovalTemplates(externalProjectId)` using the nested
    `GET /projects/{project_id}/removal_templates` endpoint
    (verified via OpenAPI types; no top-level `/removal_templates`
    exists).
  - `src/data-access/certification.ts`, `src/fn/certification.ts`,
    `src/schemas/certification.ts`, `src/hooks/use-certification.ts` —
    layered CRUD + RHF/Zod schema for the mapping. Unlink guarded by
    `SafeError` if any `creditBatch` submission exists for the
    facility (one-hop join via `creditBatches.facilityId`).
  - `src/components/certification/{facility-certifier-section,
    facility-certifier-dialog}.tsx` — view-mode card (in the facility
    list `EntitySideSheet`) plus modal form with project picker,
    template select, protocol version, and a production-confirm
    checkbox shown only when `ISOMETRIC_ENVIRONMENT === 'production'`.
- Side sheet primitive:
  - Added `viewModeChildren?` to `EntitySideSheet`; renders below the
    existing `sections` block so callers can mount interactive content
    in view mode without overriding the static-section render.
- Stopgap:
  - `scripts/isometric-link-demo.ts` updated: removed the
    `externalConflict` exit (incompatible with the dropped unique
    constraint); now logs an informational note about co-linked
    facilities.
- Docs:
  - `integration-plan.md` Phase 1 section, "Critical files",
    "Verification": marked done with the actual files shipped.

## 2026-04-19

- **Scope:** P0-01, P0-07, P0-11 schema gaps closed
- **Updated by:** Kenji / Claude
- Schema changes (migration `drizzle/0014_nasty_silver_samurai.sql`):
  - Added `credit_batches.total_feedstock_mass_kg` and `credit_batches.ineligible_feedstock_mass_kg` (nullable real, with non-negative and ordering DB checks). Closes P0-01 schema gap; ineligible fraction derived by app logic.
  - Added `stockpile_events` table (`facility_id`, `material_type` biochar|feedstock, `material_id`, `started_at`, `ended_at`, `last_control_at`, `risk_level`, `mitigation_notes`, `exception_ref`, `document_ref`). DB check enforces `exception_ref` is non-null when duration >12 months. Closes P0-07 schema gap.
  - Added `power_procurement_evidence` table keyed to `facility_id` + `period_start`/`period_end`. Stores `contract_type`, `generator_cod_date`, `grid_region`, `matching_type`, `eac_registry`, `eac_retirement_id`, `retired_at`, `document_ref`, `notes`. EC1-EC5 pass/fail derived by app logic; no boolean flags stored. Closes P0-11 schema gap.
- Docs changes:
  - Updated `simple-implementation-guide.md`: fixed `document_id` → `document_ref` (nullable text), removed `ec1_pass…ec5_pass` boolean columns, corrected `material_type` values to `biochar | feedstock`.
  - Updated `schema-mapping.md`: changed coverage status for P0-01, P0-07, P0-11 rows from `missing` to `schema-done`.
  - Updated `p0-compliance-checklist.md`: set P0-01, P0-07, P0-11 status to `in_progress` (schema done; app-layer guards and UI follow in next PR).
  - Updated `condition-registry.md`: added `stockpile.exception_ref_required` condition row.
  - Updated `schema-overview.md`: added rows for `stockpile_events` and `power_procurement_evidence`; noted new columns on `credit_batches`.

> Tracks documentation updates only. Not an authoritative policy source.
> Note: historical entries may reference pre-squash migration filenames that are no longer present in the current repo baseline.

## 2026-02-11

- **Scope:** Detailed implementation guidance and glossary
- **Updated by:** Codex
- Docs changes:
  - Added `simple-implementation-guide.md` with topic-by-topic implementation notes for ineligible biomass, stockpiling, power procurement evidence, BCU, amortization, embodied inventory, and trigger guardrails.
  - Added plain-language explanations for derived-vs-stored field decisions.
  - Added abbreviation glossary (RP, EC1-EC5, BCU, EAC, PPA, COD, EPD, etc.).
  - Updated `README.md` to include and route readers to the new guide.

- **Scope:** Documentation reconciliation to current schema baseline
- **Updated by:** Codex
- Docs changes:
  - Rewrote `schema-mapping.md` to match current table/column names and live implementation status in `src/db/schema/*`.
  - Corrected `condition-registry.md` enforcement statuses to distinguish implemented checks from planned (not yet migrated) trigger guardrails.
  - Added `p0-compliance-checklist.md` as an execution checklist table for highest-priority compliance gaps.
  - Updated `README.md` index and freshness date for the isometric docs set.
- Baseline references used:
  - `drizzle/0000_blue_mastermind.sql`
  - `src/db/schema/*`

## 2026-02-11

- **Scope:** Sampling method enforcement baseline
- **Updated by:** Codex
- Schema/workflow changes:
  - Added `sampling_method` enum (`method_a`, `method_b`) and moved ownership to `reactors.sampling_method` (default `method_a`).
  - Removed sampling-method storage from `facilities` and `credit_batches`.
  - Added server-side Method B eligibility evaluation for reactor-level selection (minimum 30 prior samples).
  - Added DB trigger guardrail to block ineligible `reactors.sampling_method=method_b`.
  - Added DB trigger guardrail on `credit_batches` to enforce Method B cadence (>=1 sampled run per 10 runs) for reactors configured with Method B.
  - Updated Isometric condition registry and schema mapping entries for sampling-method rules.
- Migration: guardrails and columns updated in `drizzle/0000_lowly_grim_reaper.sql`.

- **Scope:** Durability immutability guardrail
- **Updated by:** Codex
- Schema/workflow changes:
  - Added DB trigger guardrail to freeze `credit_batches` durability fields once batch status is `verified` or `issued`.
  - Documented the guardrail in the condition registry as `durability.lock_after_verification`.
- Migration: guardrail SQL squashed into `drizzle/0000_lowly_grim_reaper.sql`.

## 2026-02-10

- **Scope:** Phase 2 schema + validation alignment (greenfield reset)
- **Updated by:** Codex
- Schema/workflow changes:
  - Added condition registry and explicit requiredness model (`required`, `conditional_required`, `optional`).
  - Added `customer_locations`; linked orders to required location; added optional delivery location override.
  - Added `deliveries.mass_dry_kg` and `deliveries.delivered_wet_mass_kg` with consistency checks.
  - Normalized coordinates to `gps_latitude`/`gps_longitude` with range checks.
  - `transport_legs` confirmed as canonical transport accounting model.
  - Added Isometric lifecycle fields (`version`, `status`, `submitted_at`, `superseded_at`) on submission tables.
  - Added `isometric_sources` and `isometric_monitoring_submissions`.
  - Added compliance ledgers: `feedstock_sc_assessments`, `custody_handoffs`, `ghg_materiality_assessments`.
  - Added server-layer conditional validators and dry-mass derivation utility with tests.
- Migration: replaced legacy baseline with squashed `drizzle/0000_lowly_grim_reaper.sql`.

## 2026-02-09

- **Scope:** Biochar + Soil Storage initial baseline
- **Updated by:** Codex
- Protocol `biochar` pinned at v1.2 (patch 1.2.0).
- Modules pinned: `biochar-storage-soil-environments v1.2`, `biomass-feedstock-accounting v1.3`, `energy-use-accounting v1.2`, `transportation v1.1`, `ghg-accounting v1.0`, `embodied-emissions v1.0`.
- Initial requirements shortlist and schema mapping created.
