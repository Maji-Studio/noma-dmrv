# Isometric integration — status snapshot (2026-05-21)

> Archived implementation log, extracted from
> `docs/isometric/integration-plan.md` to keep `/docs` evergreen.
> Point-in-time record; see the integration plan for current state.

## Status snapshot (2026-05-21)

**Shipped:** Phases 0–4 read paths, plus the Phase 3 write path
end-to-end **with full transport-leg coverage (Phase 3.6 ✅ DONE)**.
Sandbox is wired up (`api.sandbox.isometric.com`,
project `prj_1K9YJ33RKSBX9FFF`); read paths are sandbox-verified via
`tests/isometric-sandbox.integration.test.ts`.

**2026-05-21 — granular template + zero-stub expansion.** The operator
authored a new, more detailed removal template, **Dark Earth Carbon
Template** (`rvt_1KS4S43VPSBXA26X`), in the sandbox Registry UI and bound
all its fixed-constant Datapoints. It declares 7 monitored inputs the
previous `INPUT_MAPPING` did not cover. Those 7 were added as **zero
stubs** in `src/lib/isometric/transformers/datapoint.ts` so the Phase 3
sandbox submit can run end-to-end — bringing the total to **12 zero
stubs**. The schema work to replace all 12 with real data is now
specified as **Phase 3.7** (below). `inspect-template` reports 0
uncovered inputs; transformer + aggregation tests green.

**Phase 3.6 completed 2026-05-13** — the UI / submission half of the
phase that the 2026-05-11 foundation set up. Delivers:

- **Polymorphic transport-leg CRUD** — new
  `src/data-access/transport-legs.ts` with
  `getTransportLegsForEntity(userId, entityType, entityId)` +
  `getTransportLegsForEntities(userId, entityType, entityIds[])`
  (bulk) + auth-guarded create/update/delete with per-entityType
  existence checks. `entityType='feedstock'` references
  `feedstocks.id` (not the vestigial `feedstock_deliveries.id` —
  users only interact with the combined `feedstocks` surface).
- **Schemas / server actions / hooks** —
  `src/schemas/transport-legs.ts` (Zod superRefine mirrors the DB
  energy-usage vs distance-based check constraints),
  `src/fn/transport-legs.ts` (`withAction`-wrapped),
  `src/hooks/use-transport-legs.ts`.
- **Polymorphic UI** — `TransportLegForm` (modal, method-conditional
  required fields) + `TransportLegsPanel` (list / add / edit / delete)
  in `src/components/transport-legs/`. Mounted via `viewModeChildren`
  on the delivery side-sheet (replacing the read-only display),
  sample side-sheet, and feedstock side-sheet. Legacy
  `useTransportLegsForDelivery` / `getTransportLegsForDeliveryFn`
  removed.
- **Lineage walker** — new pure
  `src/lib/isometric/utils/transport-lineage.ts` with
  `collectTransportEntityIds(lineages, runs)` returning
  `{feedstockIds, biocharProductIds, sampleIds}`. Shared by both
  `submit-credit-batch.ts` and `certify-context.ts`.
- **Submission wiring** — `submitCreditBatch` now calls
  `collectTransportEntityIds` → `getTransportLegsForEntities`
  (parallel per category) → `enrichWithTransportLegs(agg, …)` before
  payload build. Submitted Removals carry real transport distances.
- **Pre-flight coverage UX** — `<CertifyPanel>` reads new
  `transportCoverage` field from the context loader and renders a
  three-row checklist (`✓ Feedstock — 3 legs` /
  `! Sample — no legs recorded. Add legs →`). Submit button is
  disabled when any category is empty; the tooltip names the missing
  categories.
- **Tests** — full suite green: 28 files / 182 tests, 3 pre-existing
  skips. New `tests/isometric-transport-lineage.test.ts` (6 cases)
  covers the lineage walker; `tests/isometric-certify-context.test.ts`
  extended (now 6 cases incl. populated-coverage walker assertions).

**Phase 3.6 foundation landed 2026-05-11** (tailored-template path
that unblocks `phase-3-input-coverage` / `phase-3-fixed-constants`):

- `INPUT_MAPPING` refactored from flat `Record<string, …>` to
  three-level `Record<group_key, Record<blueprint_key, Record<input_key, …>>>`
  in `src/lib/isometric/transformers/datapoint.ts`. Disambiguation by
  `(group_key, blueprint_key, input_key)` is required because real
  templates re-use blueprints across groups (e.g., `transport` appears
  twice — biomass→processing AND biochar→storage). New helper
  `lookupInputMapping(groupKey, blueprintKey, inputKey)` exported.
- `BuildCreateDatapointArgs` gained `groupKey` + `componentBlueprintKey`
  fields; `submit-credit-batch.ts` orchestrator threads them through.
- `AggregatedProductionData` extended with three optional fields:
  `feedstockTransportAvgDistanceKm`, `biocharTransportAvgDistanceKm`,
  `sampleTransportAvgDistanceKm`. Populated by new
  `enrichWithTransportLegs(agg, { feedstock, biochar, sample })` pure
  helper that calls `aggregateTransportLegs(legs)` (mass-weighted
  average: `Σ(distance × load_mass) / Σ(load_mass)`).
- `ResolvedTemplateInput` (in `aggregation.ts`) gained `groupKey` field;
  `validateForTemplate` updated to use nested lookup.
- `scripts/isometric-smoke.ts inspect-template` now reports the
  `(group, blueprint, input)` tuple for any unmapped entries.
- New `docs/isometric/sandbox-template-authoring.md` — step-by-step
  walkthrough for an admin to author a noma-tailored template
  (4 components, 7 monitored inputs, 6 fixed constants) in the
  Registry UI so Phase 3 sandbox writes can succeed end-to-end.
- Tests: 16 transformer tests updated + 11 new
  `tests/isometric-transport-aggregation.test.ts` cases covering
  mass-weighted average correctness, null/empty handling, and
  `enrichWithTransportLegs` non-mutation. Full suite: 175 / 178
  passing (3 pre-existing skips).

**Outstanding:**

- *Blocked on Isometric* — webhook contract publication; multi-org
  credentials roadmap (Q3 below). Tracked in `docs/open-questions.md`.
- *Tailored template authored 2026-05-21* — the operator built
  **Dark Earth Carbon Template** (`rvt_1KS4S43VPSBXA26X`) in the sandbox
  Registry UI with all fixed constants bound; `INPUT_MAPPING` now covers
  every monitored input it declares (7 added as zero stubs). Phase 3
  sandbox write E2E is no longer template-blocked.
- *Not yet started — Phase 3.7* — replace all 12 `INPUT_MAPPING` zero
  stubs with real monitored data (schema work). Full field-by-field
  spec in the Phase 3.7 section below. Prerequisite for any *production*
  Isometric project.
- *Blocked on a noma subsystem* — `phase-3.5` source-upload
  presigned-URL flow waits on the documents subsystem getting a real
  S3 backend.
- *Deferred until production signal* — `phase-4` per-Datapoint
  sub-ledger, PATCH-vs-supersede branch, LIST inputs with multiple
  datapoints; `phase-5` external GHG amendment claiming and
  hash-changed partial-orphan cleanup. All in
  `docs/open-questions.md`.
- *Not yet started* — Phase 5 (time-series + bulk:
  `MonitoringSubmission`, `DataUploadSubmission`,
  `POST /biochar_applications`); Phase 6 (Protocol/SOP surfacing).
- ~~*Carryover* — `tests/e2e/facility-certifier-mapping.spec.ts` from
  Phase 1 verification.~~ ✅ Landed 2026-05-07. Two tests: N→1 mapping
  through the side-sheet view-mode UI, and unlink-refused with the
  exact `SafeError` surfaced in `UnlinkConfirmDialog`. Both run as a
  read-only sandbox-backed E2E (gated behind
  `ISOMETRIC_DEMO_PROJECT_ID`; `test.skip` otherwise).

**Resolved this session:** Open-question Q1 (no `metadata` field on
Datapoint/Removal/Source — `supplier_reference_id` is the round-trip
mechanism) and Q2 (`PATCH /datapoints` accepts `source_ids`, so
Phase 3.5 doesn't need a two-phase commit). See "Open questions"
section at the bottom for citations.

**Hardening pass (2026-05-06):** Closed the certifier-mapping race in
`submitCreditBatch` and `createGhgStatementForFacility`. Both flows
now route through `insertDraftSubmissionWithMappingLock` /
`resetSubmissionToDraftWithMappingLock` (`data-access/certification.ts`),
which lock the `certifier_projects` row and verify
`(externalProjectId, defaultRemovalTemplateId)` before writing the
draft submission. Concurrent `unlink`/`repoint` either blocks the
in-flight submission or fails it cleanly. Unit-tested in
`tests/isometric-mapping-lock.test.ts`. Same pass also gated
`tests/isometric-sandbox.integration.test.ts` behind
`RUN_ISOMETRIC_SANDBOX_TESTS=1` (run via `pnpm test:integration`)
so plain `pnpm test` no longer touches the live sandbox.
