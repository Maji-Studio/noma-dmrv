# Plan: Isometric Certify API integration for noma-dmrv

## Context

Connect noma-dmrv to Isometric's Certify API so MRV data flowing through the
biochar chain (Facility → ... → CreditBatch) can be submitted for verification,
and so protocol/SOP requirements can be pulled programmatically.

A working prototype exists in a sibling repo (`varuna-carbon-dmrv`) under
`src/lib/isometric/` (~4500 lines). Its credit-batch → removal → GHG statement path works
end-to-end, but most other endpoints are stubbed with fake IDs, types are
hand-written, and there is no retry, no lock, no payload hashing. We will
**rebuild** in noma — generating the API client off Isometric's OpenAPI spec
and aligning to noma's existing layered conventions and existing certification
schema.

**Scope (user-confirmed, delivered in phases):** submit MRV → Certify; pull
protocol requirements; pull SOPs/docs; submit GHG statements for verification.
**Auth:** env-level credentials only (`X-Client-Secret` + `Authorization:
Bearer <jwt>` — both pre-issued via Isometric's UI; no programmatic refresh).

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

## Reuse what already exists

These files dictate the design — none of them existed in my first draft and
all of them shape the plan:

- `src/db/schema/certification.ts` — already defines the full certification
  persistence model:
  - `certifierProjects` (facility-scoped, provider-aware project registration
    with `externalProjectId`, `protocolSlug`, `protocolVersion`, optional
    `webhookSecret`, JSONB `metadata`).
  - `certifierSources` (provider-agnostic source mappings).
  - `certificationSubmissions` — has everything we need for safe idempotency:
    `submissionType`, `localEntityType/Id`, `externalId`, `version`, `status`
    (`draft|submitted|accepted|rejected|superseded`), `payloadSnapshot`,
    `payloadHash`, `submittedAt`, **`lockedAt`** (in-flight lock),
    `supersededAt`. Two unique constraints already cover the right things.
  - `certifierDocumentUploads` (links our `documents` table to external
    document IDs).
  - `certifierSyncEvents` (append-only audit log of sync attempts).
- `src/data-access/chain-of-custody.ts` — `getApplicationLineage()` resolves
  the full chain with the correct branching: `delivery.biocharProductId ??
  order.biocharProductId`; product may have no `linkedProductionRunId`;
  production run may have no feedstock allocations. Each branch emits a
  warning. **Submission must consume this result, not re-derive.**
- `src/fn/with-action.ts` — `withAction(fn)` is the canonical server-action
  wrapper (auth check + try/catch + `ActionResult<T>`). All new server actions
  must use it.
- `src/data-access/isometric.ts` and `src/fn/isometric.ts` — **already in use
  for sampling eligibility (Method A/B) and protocol-condition validators.
  Do not touch them.** New work goes into separate files.
- `src/config/env.ts` — eager `envSchema.parse(process.env)` at import (line
  64). Adding required env vars breaks boot for everyone, including local dev
  without sandbox credentials. New vars must be **optional** in the schema.
- `src/components/credit-batches/credit-batch-list.tsx` — credit batches are
  viewed/edited in a side sheet (`sideSheet` state on line 84). There is no
  detail page route. UI surface lives in the side sheet.

## Schema changes (additive, minimal)

The existing `certification.ts` model covers ~95% of what we need.

1. **Default removal template per project.** ✅ Done in Phase 0 — added
   `defaultRemovalTemplateId text` to `certifierProjects` (migration
   `drizzle/0015_flimsy_arachne.sql`).

2. **Allow N facilities → 1 Isometric project.** **Drop** the existing
   `certifier_projects_provider_external_unique` constraint on
   `(provider, externalProjectId)`. Real biochar operators register multiple
   physical sites under a single registry project, and Isometric's data model
   has no notion of "facility" — Removals roll up at the project level. Keep
   the second unique constraint on `(facilityId, provider)` so one facility
   never has ambiguous routing.

   ```sql
   ALTER TABLE certifier_projects
     DROP CONSTRAINT certifier_projects_provider_external_unique;
   ```

3. **Feedstock-type external mapping.** Today `certifierSources` can already
   carry this with `sourceType='feedstock_type'` + `sourceReferenceId=<local
   uuid>`. Use it as-is; no schema change. Confirm by inspecting `seed.ts` to
   see if any seeded mappings already exist.

No new tables. No `isometric_external_ids`, no `isometric_submission_log` —
those were duplicates of `certificationSubmissions` and `certifierSyncEvents`.

## Idempotency design (first-class)

Every outbound POST follows this pattern. The flow uses
`certificationSubmissions` as the lock + ledger:

```text
1. Compute payloadHash = sha256(canonicalJson(payload))
2. SELECT FROM certification_submissions WHERE
     localEntityType=? AND localEntityId=? AND submissionType=?
   ORDER BY version DESC LIMIT 1
3. Branch on the latest row:
   a. No row, or status='superseded'
      → INSERT new row (version=N+1, status='draft', lockedAt=now(),
        payloadSnapshot, payloadHash). This INSERT is the lock.
      → POST to Isometric.
      → On 2xx: UPDATE row SET externalId=..., status='submitted',
                          submittedAt=now(), lockedAt=NULL.
      → On 5xx/network: leave row locked. Next attempt reconciles.
   b. Latest row has status='draft' AND lockedAt within ttl
      → A submission is in flight. Reject the new request.
   c. Latest row has status='draft' AND lockedAt past ttl AND
        payloadHash matches → reconciliation path:
      → Try GET /removals?metadata.localEntityId=<uuid>
        (or list + filter — Certify has no metadata filter, so we'll need
         to store a client-generated nonce in payload metadata and search
         by it; verify via openapi_documents_get_object before relying).
      → If found remotely: UPDATE row with externalId, mark submitted.
      → If not found: clear lockedAt and re-POST with the SAME payloadHash.
   d. Latest row status='submitted'/'accepted' AND payloadHash matches new
        payload → no-op, return existing externalId.
   e. Latest row status='submitted'/'accepted' AND payloadHash differs →
        intentional update: PATCH /removals/{id} or supersede + new version,
        depending on what Certify allows for that resource.
   f. Latest row status='rejected' → caller must explicitly resubmit; bump
        version and follow path (a).
```

This is the right place for this logic per the reviewer's feedback. The
existing `lockedAt` + `payloadHash` + `version` schema is exactly the
primitive needed.

**`certifierSyncEvents`** receives an append-only entry on every attempt
(request, response, status, error) — used for debugging and the UI sync log,
not for state.

**Open implementation question (not blocking Phase 0):** Certify list
endpoints — verify whether a metadata field can be used to round-trip a
client-side nonce for reconciliation lookups. If not, we'll need a different
fingerprint strategy (e.g., timestamp + entity-code search).

## Layered architecture (no collisions with existing files)

```text
src/lib/isometric/                     # PURE — no DB, no ActionResult, no auth
  ├─ client.ts                         # fetch wrapper: headers, retry, errors,
  │                                    #   cursor pagination helper
  ├─ generated/certify.d.ts            # openapi-typescript output (committed)
  ├─ types.ts                          # re-exports + augmentations
  ├─ transformers/                     # noma domain → Certify request shape
  │   ├─ source.ts
  │   ├─ datapoint.ts
  │   ├─ component.ts
  │   ├─ removal.ts
  │   └─ ghg-statement.ts
  ├─ utils/
  │   ├─ aggregation.ts                # port verbatim from varuna
  │   └─ payload-hash.ts               # canonicalJson + sha256
  └─ index.ts

src/data-access/certification.ts       # NEW — auth-guarded DB ops on the
                                       #   certifierProjects, certifierSources,
                                       #   certificationSubmissions,
                                       #   certifierDocumentUploads,
                                       #   certifierSyncEvents tables.
                                       #   Returns plain types (NOT ActionResult).

src/fn/certification.ts                # NEW — server actions wrapped with
                                       #   withAction(). Orchestrates: load
                                       #   lineage → transform → idempotency
                                       #   ledger → HTTP call → ledger update.

src/hooks/use-certification.ts         # NEW — React Query hooks.

src/components/certification/          # NEW — Certify panel inside the existing
  ├─ certify-panel.tsx                 #   credit-batch side sheet.
  ├─ submission-status-badge.tsx
  └─ sync-event-log.tsx
```

**Naming note:** "certification" rather than "isometric" because the existing
schema is provider-agnostic (`certifierProvider` enum supports `puro_earth`
and `verra`). New code should follow that convention. Provider-specific bits
(transformers, client) stay under `src/lib/isometric/`.

## Env vars (credentials only — facility/project IDs live in DB)

Add to `src/config/env.ts` as **optional**:

```ts
ISOMETRIC_CLIENT_SECRET: z.preprocess(emptyToUndefined,
  z.string().min(1).optional()),
ISOMETRIC_ACCESS_TOKEN: z.preprocess(emptyToUndefined,
  z.string().min(1).optional()),
ISOMETRIC_ENVIRONMENT: z.enum(['sandbox', 'production']).optional()
  .default('sandbox'),
```

The client throws `IsometricApiError('not configured')` at call time if
either credential is missing — boot stays clean for unrelated work.

`ISOMETRIC_PROJECT_ID` / `ISOMETRIC_BIOCHAR_REMOVAL_TEMPLATE_ID` from my
first draft are **deleted** — these are per-facility values stored in
`certifierProjects.externalProjectId` and the new
`defaultRemovalTemplateId` column.

## Phased delivery

### Phase 0 — Foundation, no business logic ✅ DONE

- ✅ `pnpm add openapi-typescript -D`.
- ✅ Generated `src/lib/isometric/generated/certify.d.ts`.
- ✅ Three optional env vars added to `src/config/env.ts`.
- ✅ `src/lib/isometric/client.ts` built:
  - Native `fetch`. Base-URL from `ISOMETRIC_ENVIRONMENT`.
  - Headers from env. Typed `IsometricApiError` on non-2xx.
  - Retry with exponential backoff on `429` and `5xx` (max 3, jitter).
  - Cursor-pagination helper.
  - Throws `IsometricApiError('not configured')` if creds absent.
- ✅ Migration `drizzle/0015_flimsy_arachne.sql` adds
  `defaultRemovalTemplateId text` to `certifierProjects`.
- ✅ `scripts/isometric-smoke.ts` — verified against **production** (read-only
  `GET /projects`). Two projects returned:
  - `prj_1K6G4S1PJ1S0TR4Z` — Sifuri Halisi TZ001-B (live — do not touch)
  - `prj_1K5F2F6SN1S0ZKDQ` — Dark Earth Carbon Ltd's Biochar Demo Project
    (target for all Phase 1+ work)
- ✅ `scripts/isometric-link-demo.ts` — one-shot CLI to link a noma facility
  to the demo project; hard-codes the demo project ID so it can't accidentally
  point at the live one. Use until the Phase 1 UI ships.

### Phase 1 — Facility ↔ Isometric project mapping UI ✅ DONE

The first thing every other phase depends on: an admin needs to be able to
declare "this facility submits to that registry project" without writing
SQL. Until this existed, we couldn't even render Phase 2's "Certify" panel
because `getCertifierProjectByFacility(facilityId)` would always return null.

**Schema work:**
- ✅ Dropped `certifier_projects_provider_external_unique`.
  Migration `drizzle/0016_panoramic_selene.sql`. The `(facilityId, provider)`
  unique constraint remains so each facility still has a single,
  unambiguous mapping per provider.

**Isometric client additions (`src/lib/isometric/projects.ts`, NEW):**
- ✅ `listProjects()` — wraps `GET /projects` via `paginateAll`.
- ✅ `listRemovalTemplates(externalProjectId)` — uses the **nested**
  `GET /projects/{project_id}/removal_templates` (no top-level
  `/removal_templates` endpoint exists in Certify; verified against
  `certify.d.ts`). Cursor-paginated.
- Both re-exported from `src/lib/isometric/index.ts`. No caching;
  list is tiny (2 today) and freshness matters during onboarding.

**Data access (`src/data-access/certification.ts`, NEW):**
- ✅ `getCertifierProjectByFacility(userId, facilityId, provider?)` →
  `CertifierProjectRow | null`.
- ✅ `listFacilitiesLinkedToExternal(userId, provider, externalProjectId)`
  → joins `facilities`, returns `{ facilityId, code, name }[]` so the
  client can render "Already linked to: …" hints (replaces what the
  dropped unique constraint used to enforce).
- ✅ `upsertCertifierProject(userId, input)` — `ON CONFLICT DO UPDATE`
  on `(facilityId, provider)`.
- ✅ `deleteCertifierProject(userId, facilityId, provider?)` — refuses
  with `SafeError` if any `certificationSubmissions` row of type
  `creditBatch` exists for the facility (joined via
  `creditBatches.facilityId`). Phase 3 is the first writer; the guard
  expands as more submission types come online.
- All auth-guarded by `requireAuth(userId)`; return plain types
  (not `ActionResult`).

**Server actions (`src/fn/certification.ts`, NEW):**
- ✅ `loadFacilityCertifierMapping(facilityId)` — `withAction`. Returns
  `{ mapping, availableProjects, availableTemplates, linkHints, isProduction }`.
  `availableTemplates` is fetched only if a `mapping` already exists.
  `linkHints` pre-computes facilities linked to each project so the
  dialog doesn't need a second round-trip.
- ✅ `saveFacilityCertifierMapping(input)` — `withAction`. Validates
  `externalProjectId` *and* `defaultRemovalTemplateId` against live
  Isometric data so a stale/cross-project template ID can't be saved.
  Throws **`SafeError`** (not plain `Error`) for any user-visible
  message, since `withAction` (`src/fn/with-action.ts:45-50`) hides
  non-`SafeError` messages outside development.
- ✅ `deleteFacilityCertifierMapping(facilityId)` — `withAction`,
  delegates to `deleteCertifierProject` (which enforces the unlink
  guard).
- ✅ `loadIsometricProjectTemplates(externalProjectId)` — separate
  action used by the dialog to refetch templates when the user
  changes the project picker.
- Production-confirm pattern: when `ISOMETRIC_ENVIRONMENT === 'production'`
  and `confirmProduction` is unset, throws `SafeError`. The UI surfaces
  the message and re-submits once the user ticks the inline checkbox.

**React Query hooks (`src/hooks/use-certification.ts`, NEW):**
- ✅ `useFacilityCertifierMapping(facilityId, enabled?)` — staleTime 30s.
- ✅ `useIsometricProjectTemplates(externalProjectId | null)` — staleTime
  60s; powers live re-fetch when the dialog's project selection changes.
- ✅ `useSaveFacilityCertifierMapping()` / `useDeleteFacilityCertifierMapping()`
  — both invalidate `certificationKeys.facilityMapping(facilityId)` and the
  `certificationKeys.all` parent on success.

**Side sheet primitive extension (`src/components/ui/entity-side-sheet/index.tsx`):**
- ✅ Added optional `viewModeChildren?: React.ReactNode` prop. Renders
  *below* the existing `sections` block in view mode (edit/create modes
  still use `children`). Lets callers append interactive content
  (cards with dialog state) without re-implementing the sections render.

**UI (`src/components/certification/`, NEW):**
- ✅ `facility-certifier-section.tsx` — view-mode card. Two states:
  - *Not linked:* "Link Isometric project" CTA + helper text.
  - *Linked:* project name + ID, default template name + ID,
    protocol slug + version, "Edit" / "Unlink" buttons.
- ✅ `facility-certifier-dialog.tsx` — modal `<dialog>` form using RHF +
  `zodResolver(saveMappingSchema)`. Includes:
  - Native `FormSelect` project picker populated from
    `availableProjects`; helper text shows "Already linked to: …" when
    `linkHints` reports other facilities on the chosen project.
  - Default removal template `FormSelect` — disabled until a project is
    chosen, refetches via `useIsometricProjectTemplates` when project
    changes, auto-clears the selection on project change so a stale
    template ID is never submitted.
  - Free-text protocol version `FormInput`.
  - Production-confirm checkbox rendered only when
    `loaderData.isProduction === true` (env stays server-side).
  - `UnlinkConfirmDialog` exported alongside; surfaces the
    `SafeError` from the data-access guard verbatim.
- ✅ Mount point: `src/components/facilities/facility-list.tsx` passes
  `viewModeChildren={<FacilityCertifierSection facilityId={…} />}`. No
  facility detail page exists (or was needed); the existing list →
  `EntitySideSheet` view mode is the surface.
- *(Deferred)* `facility-certifier-status-badge.tsx` — would add a
  per-row "Linked / Not linked" pill but causes N+1 queries; revisit
  with a summary endpoint.

**Stopgap script:**
- ✅ `scripts/isometric-link-demo.ts` updated: removed the
  `externalConflict` hard-stop (which contradicted the schema change);
  it now logs an informational note about co-linked facilities instead.

**Acceptance (all met):**
1. From the facility list side sheet, an admin can pick the demo
   Isometric project from a dropdown and save. A `certifier_projects`
   row is created.
2. The same project can be linked from a *second* facility without
   error (validates the dropped unique constraint).
3. Re-opening the facility shows the saved mapping; the default-template
   dropdown is populated from
   `GET /projects/{project_id}/removal_templates`.
4. With `ISOMETRIC_ENVIRONMENT=production`, saving without the confirm
   checkbox is rejected with the `SafeError` message.
5. Selecting a template, then changing the project, refuses submission
   if the user re-picks the stale template ID (server validates
   `defaultRemovalTemplateId` against the chosen project's live
   templates).

### Phase 2 — Read-only template/blueprint surfacing ✅ DONE

The first non-Phase-1 surface where a noma user sees live Certify data
inside a domain entity (a credit batch), and the visual prerequisite for
Phase 3's submission button. Mounts via the existing `viewModeChildren`
slot on the credit-batch `EntitySideSheet` — no new route or detail page.

**Isometric client (`src/lib/isometric/projects.ts`, extended; re-exported
from `src/lib/isometric/index.ts`):**
- ✅ `listComponentBlueprints()` — wraps the global
  `GET /component_blueprints` endpoint via `paginateAll`. Component
  blueprints are catalog-scoped (not project- or template-scoped),
  verified against `generated/certify.d.ts:55-68,3738-3774`.
- ✅ `IsometricComponentBlueprint` type alias for
  `components["schemas"]["ComponentBlueprint"]`.

**Server action (`src/fn/certification.ts`, extended):**
- ✅ `loadCertifyContextForCreditBatch(creditBatchId)` — `withAction`.
  Keys off the credit batch (not the facility) so the trust boundary
  matches Phase 3's `submitCreditBatch`: load batch via
  `getCreditBatchById`, derive `facilityId` server-side, then resolve
  the certifier project, live project record, default removal template,
  and only the component blueprints that template's groups reference
  (`groups[].components[].blueprint_key` deduped against the global
  catalog).
- ✅ Returns `CertifyContextForCreditBatch` with explicit fields for
  drift detection: `missingDefaultTemplateId` distinguishes "default
  never set" from "default set but no longer in Certify", and
  `unresolvedBlueprintKeys` flags per-blueprint drift between the saved
  template and the current Certify catalog.
- ✅ Skips remote calls entirely when the facility is unlinked, and
  skips the global blueprint catalog fetch when no resolvable template
  is available — preserves the "no Isometric calls when not needed"
  goal for unlinked or partially-configured batches.

**React Query hook (`src/hooks/use-certification.ts`, extended):**
- ✅ `useCertifyContextForCreditBatch(creditBatchId, enabled?)` —
  staleTime 5 min (blueprints + templates change rarely).
- ✅ `certificationKeys.certifyContextForCreditBatch(creditBatchId)`
  added to the key factory.

**UI (`src/components/certification/`, extended):**
- ✅ `certify-panel.tsx` — collapsed `<details>` accordion with
  "Isometric Certify" header. Renders five distinct states:
  - *Loading* / *Error* — uses `error instanceof Error ? error.message
    : fallback` (no `safeMessage` lookup; matches the existing hook
    pattern in `use-certification.ts`).
  - *Not linked* — body text directing the user to facility settings,
    no remote calls made.
  - *Linked, no default template* — shows project + ID; hint to set a
    default. Blueprint catalog not fetched.
  - *Linked, default template stale* (drift) — shows project header
    plus a warning row identifying the stale `defaultRemovalTemplateId`.
    Distinct from the no-default case so users can act on registry
    drift before Phase 3 submission.
  - *Linked, default template resolved* — project + template summary
    + the `BlueprintList`; an additional warning row appears above the
    list if any `unresolvedBlueprintKeys` are present.
- ✅ `blueprint-list.tsx` — pure presentational list. Each row shows
  `display_name`, monospace `key`, `description`, and an inputs summary
  (`N input(s): <quantity_kind>, …`).

**Mount point (`src/components/credit-batches/credit-batch-list.tsx`):**
- ✅ Passes `viewModeChildren={<CertifyPanel creditBatchId={…} />}` on
  the existing `EntitySideSheet` (line 84 holds the side-sheet entity).
  Mirrors the Phase 1 mount pattern for `<FacilityCertifierSection />`.

**Acceptance:**
1. Open a credit batch whose facility is **not** linked → accordion
   expands to the not-linked empty state, no Isometric calls in the
   network panel.
2. Link the facility (Phase 1 UI) but leave the default template unset
   → "default template not selected" hint, `listComponentBlueprints`
   not called.
3. Set a valid default removal template, reopen the batch → project
   name + template + blueprint table populated from live Certify data.
4. Set `defaultRemovalTemplateId` to a stale ID directly in the DB,
   reopen → drift warning, blueprint catalog still not fetched.
5. Drop a blueprint key from the resolver via a temporary code change
   → "N blueprint(s) … no longer in Certify's catalog" warning row
   appears. Revert.

### Phase 3 — Single removal submission (end-to-end) ✅ DONE

One credit batch → one Removal, with the full idempotency ledger.
Phases 1–2 are prerequisites; Phase 4 (GHG statements) builds on this.

**Transformers (`src/lib/isometric/transformers/`, NEW):**
- ✅ `datapoint.ts` — `INPUT_MAPPING` table + numeric reading →
  `CreateDatapointRequest`. Carries the `quantity_kind` / `unit`
  conversions (e.g. `samples.organicCarbonPercent / 100` for
  `dimensionless` inputs that the demo template expects as a 0–1
  fraction).
- ✅ `removal.ts` — assembles components directly into the template's
  component groups. Replaces the originally-planned `component.ts`
  (component-group assembly is small enough to inline) and `source.ts`
  (sources deferred to Phase 3.5).

**Utils (`src/lib/isometric/utils/`, NEW):**
- ✅ `aggregation.ts` — mass-weighted blends and durability ratios,
  ported from the varuna prototype (correct per Biochar v1.2).
- ✅ `payload-hash.ts` — canonical-JSON sha256 used by the ledger.
  Tests in `tests/isometric-payload-hash.test.ts`.
- ✅ `supplier-ref.ts` — stable client-side reference IDs that round-trip
  through Certify so a stuck draft can be reconciled by
  GET-by-`supplier_reference_id` after a stale lock.
- ✅ `submission-claim.ts` — pure retry-decision module
  (`decideSubmissionClaim`). Returns one of `create-new-version` /
  `resume` / `return-existing` / `blocked-in-flight` /
  `blocked-rejected-with-external` / `invalid-changed-hash`. Owns all
  versioning math; status switch is exhaustive with `assertNever`.
  Extracted on 2026-05-06 from a prior inline branch and reused by
  both Removal and GHG-statement orchestrators. Covered by
  `tests/isometric-submission-claim.test.ts` (18 cases — see
  `docs/isometric/changes.md` 2026-05-06 entry for the policy split).

**Submissions helper (`src/lib/isometric/submissions.ts`, NEW):**
- ✅ `findRemovalBySupplierRef(...)` and
  `findDatapointBySupplierRef(...)` — used by the orchestrator on
  same-hash retries to claim a remote row that was created by an
  earlier failed attempt before re-POSTing.

**Server action — split first, then add (`src/fn/certification/`, NEW):**
- ✅ Split `src/fn/certification.ts` into a directory module
  (`facility-mapping.ts`, `certify-context.ts`, `submit-credit-batch.ts`,
  `shared.ts`, `index.ts`) before Phase 4. Phase 4 added
  `ghg-statements.ts` to the same directory.
- ✅ `submitCreditBatch(creditBatchId)` in `submit-credit-batch.ts`:
  - Resolves facility → looks up `certifier_projects` row → throws a
    `SafeError` if absent.
  - Calls `getApplicationLineage(applicationId)` — **reuses existing
    branching** (`delivery.biocharProductId ?? order.biocharProductId`,
    nullable `linkedProductionRunId`, possibly-empty feedstocks).
    Refuses submission when lineage has blocking warnings.
  - Runs aggregation, builds the payload, computes `payloadHash`.
  - Calls `decideSubmissionClaim` and acts on the returned claim.
    Idempotent: re-clicking Submit with the same payload returns the
    existing externalId; mutating the batch creates a `version=2` row.
  - Each HTTP attempt appends a `certifier_sync_events` row.

**UI (`src/components/certification/`, EXTENDED):**
- ✅ `certify-panel.tsx` gained the "Submit to Isometric" button —
  disabled when the facility is unlinked, lineage has blocking
  warnings, or the latest submission row is locked in flight.
- ✅ `submission-status-badge.tsx` and `sync-event-log.tsx` — status
  surfaces driven by the latest `certification_submissions` row and
  the recent `certifier_sync_events` history.
- Mounted via the same `viewModeChildren` slot as Phase 2's read-only
  panel (`src/components/credit-batches/credit-batch-list.tsx`).

**Pre-coding gates resolved during Phase 3** (see
`docs/open-questions.md`):
- ✅ Empty `source_ids: []` confirmed accepted by Certify against the
  demo project. Sources stay deferred to Phase 3.5.
- Two new blockers surfaced from live-template inspection — tracked
  under `phase-3-input-coverage` (20 monitored inputs without
  `INPUT_MAPPING` entries) and `phase-3-fixed-constants` (~12 fixed
  constants needing pre-bound datapoints in the Isometric template
  editor). `submitCreditBatch` bails with a clear `SafeError` when
  unbound constants are detected.

**Acceptance (met):** one seeded credit batch produces a real Removal in
Certify with linked Datapoints. Re-clicking Submit is a no-op (matched
payload hash). Mutating the batch and re-submitting creates a
`version=2` row and supersedes v1.

**To do (carried forward):** source-upload presigned-URL flow (Phase 3.5),
per-Datapoint sub-ledger rows (Phase 4 deferral).

### Phase 3.7 — Replace zero-stubs with real monitored data (NOT started)

**Context.** Phase 3 submits a Removal whose monitored Datapoints come
from noma's production data via the `INPUT_MAPPING` table in
`src/lib/isometric/transformers/datapoint.ts`. When a removal template
declares a monitored input that noma has no field to source, the entry
emits a hard-coded `0` ("zero stub"). Certify accepts a `0` Datapoint, so
this lets the end-to-end pipeline be proven in the sandbox — but a zero
stub **understates the Removal's real emissions**. As of 2026-05-21 there
are **12 zero stubs**, driven by the granular **Dark Earth Carbon
Template** (`rvt_1KS4S43VPSBXA26X`) the operator authored in the Registry
UI. This phase enumerates the schema work to turn each stub into a real
value.

**Hard rule:** no template carrying *any* zero stub may be promoted to a
*production* Isometric project. Sandbox only until this phase closes.

The 12 stubs group into seven workstreams. "Effort" is relative.

#### A. Per-stage energy split — `production_runs` table

noma stores **one** `electricity_kwh` and **one** `diesel_genset_liters`
per run. The Dark Earth Carbon Template models energy at three stages
(biomass processing / pyrolysis / biochar processing), each with a
grid-electricity component **and** a diesel-genset component. One combined
number cannot feed those slots without double-counting — today
`electricity_kwh` is read by *both* the pyrolysis meter and the
biochar-processing grid input.

New columns on `production_runs` (all `real`, nullable):

| Column | Unit | Feeds template input | Replaces stub |
|---|---|---|---|
| `biomass_processing_electricity_kwh` | kWh | biomass-feedstock-processing · metered · final_readout | #6, #7 |
| `pyrolysis_electricity_kwh` | kWh | pyrolysis · metered · final_readout (split from shared `electricity_kwh`) | — (fixes double-count) |
| `biochar_processing_electricity_kwh` | kWh | biochar-processing · grid_electricity_use | — (fixes double-count) |
| `biomass_genset_energy_kwh` | kWh | biomass-feedstock-processing · energy_based · energy | #8 |
| `pyrolysis_genset_energy_kwh` | kWh | pyrolysis · energy_based · energy | #9 |
| `biochar_processing_genset_energy_kwh` | kWh | biochar-processing · energy_based · energy | #10 |

**Decision needed:** the genset components want energy in **kWh**, but
noma records genset fuel in **litres** (`diesel_genset_liters`). Either
(a) capture genset energy directly in kWh, or (b) keep litres and convert
with a genset-efficiency constant (kWh per litre). Also — genset diesel is
currently summed into `totalDieselLiters`, which already feeds the
`fuel_usage_by_volume` components; routing it to the genset components too
would **double-count diesel**. Phase 3.7 must split "fuel-volume diesel"
(startup/handling) from "genset diesel" cleanly. *Effort: medium.*

#### B. Pyrolyzer stack GHG — `production_runs` (or `production_run_readings`)

The Dark Earth Carbon Template's `direct-emissions` group needs CH₄ and CO
**concentration** (mg/kg) and **mass flow** (kg) of the pyrolyzer exhaust.
noma has `credit_batches.ch4Ppm` / `ch4CompositionPercent` at *credit-batch*
level only — too coarse. New per-run columns (or a typed
`production_run_readings` measurement kind):

| Column | Unit | Feeds | Replaces stub |
|---|---|---|---|
| `ch4_concentration_mg_per_kg` | mg/kg | direct-emissions · ghg_direct_emissions · concentration (CH₄) | #1 (part) |
| `co_concentration_mg_per_kg` | mg/kg | direct-emissions · ghg_direct_emissions · concentration (CO) | #1 (part) |
| `ch4_mass_flow_kg` | kg | direct-emissions · ghg_direct_emissions · mass_flow (CH₄) | #2 (part) |
| `co_mass_flow_kg` | kg | direct-emissions · ghg_direct_emissions · mass_flow (CO) | #2 (part) |

Note `INPUT_MAPPING` keys on `(group, blueprint, input)` — CH₄ and CO
share the input key, so distinguishing them needs the transformer to also
look at the component (a small `datapoint.ts` change beyond the columns).
*Effort: medium — needs a measurement source decision (PLC export vs
manual entry).*

#### C. Biochar-application fuel — `applications` table

`biochar-storage` component "Biochar application via tractor" wants the
fuel volume burned spreading biochar. New column on `applications`:

| Column | Unit | Feeds | Replaces stub |
|---|---|---|---|
| `application_fuel_volume_liters` | L | biochar-storage · fuel_usage_by_volume · volume_of_fuel | #3 |

*Effort: low — one column + one form field.*

#### D. Lab-analysis electricity — `samples` table

`sampling-required-for-mrv` component "Laboratory analysis electricity
use" wants the lab's electricity per analysis. New column on `samples`:

| Column | Unit | Feeds | Replaces stub |
|---|---|---|---|
| `lab_analysis_electricity_kwh` | kWh | sampling-required-for-mrv · grid_electricity_use · electricity_use | #4 |

*Effort: low — one column + one form field. May be supplier-provided
from the lab rather than operator-entered.*

#### E. Sample transport mass-distance — aggregation only, **no schema change**

`sampling-required-for-mrv` component "Mass-distance-based CI emissions
samples to EU" wants **mass × distance** (tonne·km). noma's
`transport_legs` rows (`src/db/schema/logistics.ts`) **already** carry
`distance_km` and `load_mass_kg` per leg. Add a derived field
`sampleTransportMassDistanceTonneKm` to `AggregatedProductionData`
(`src/lib/isometric/utils/aggregation.ts`), computed as
`Σ(distance_km × load_mass_kg / 1000)` over the sample legs, then point
the `INPUT_MAPPING` entry at it. *Effort: low — the only stub that needs
no migration. Easiest first win.*

#### F. Staff travel — new entity

`staff-travel` group ("Staff travel flights" + "Staff travel local")
wants travel distance (km). noma has **no staff-travel concept at all**.
Options: (a) a new `staff_travel_legs` table scoped to a production run or
credit batch, or (b) drop the staff-travel components from the template
if the protocol treats them as optional. *Effort: high if built (new
table + data-access + fn + hooks + form + aggregation); zero if the
template drops the components. Decide with the protocol scope.*

| Stub | Replaces |
|---|---|
| `staff-travel · distance_based_ci_emissions · distance` | #5 |

#### G. Miscellaneous mass — definition needed

`miscellaneous` group "Mass-based CI emissions" — the LCA intent of this
component is unclear from the template alone. **Action:** the operator
defines what "miscellaneous mass-based CI" represents (consumables?
packaging?), then it routes to an existing or new field — or the
component is removed from the template. *Effort: unknown until defined.*

| Stub | Replaces |
|---|---|
| `miscellaneous · mass_based_ci_emissions · mass` | #12 |

#### Suggested order

1. **E** (sample mass-distance) — no migration, immediate accuracy win.
2. **C** + **D** (application fuel, lab electricity) — one column each.
3. **A** (per-stage energy) — also fixes the existing electricity
   double-count; the largest correctness gain.
4. **B** (pyrolyzer GHG) — needs a measurement-source decision.
5. **F** + **G** (staff travel, miscellaneous) — need scope/definition
   decisions before any code.

Each closed stub: delete its `transform: () => 0` line in
`INPUT_MAPPING`, point `source` at the real `AggregatedProductionData`
field, and add a `tests/isometric-transformers.test.ts` case. When the
**last** stub closes, the template may move to a production project.

**Acceptance:** `pnpm tsx scripts/isometric-smoke.ts inspect-template`
shows 0 uncovered inputs (already true), AND
`docs/open-questions.md` → `isometric/sandbox-zero-stubs` is empty, AND a
Removal submitted against the production project carries no `0`-valued
monitored Datapoint that should be non-zero.

### Phase 4 — GHG statement lifecycle ✅ DONE (webhook deferred)

The lifecycle layer above Phase 3: aggregate one or more Removals into a
`GhgStatement`, transition it through DRAFT → SUBMITTED → VERIFIED /
REJECTED, and surface registry feedback back to operators.

**Schema (migration `drizzle/0017_glorious_night_thrasher.sql`):**
- ✅ `certifier_ghg_periods` — local project-period anchor that prevents
  duplicate statements for the same `(project, end_on)` pair.
  Statement *state* stays in `certification_submissions`; only the
  period anchor is new. Supplier-hosted report URLs are recorded as
  `documents` rows with `entity_type='ghgStatement'`.

**Isometric client (`src/lib/isometric/ghg-statements.ts`, NEW):**
- ✅ Typed wrappers for `POST /ghg_statements`,
  `GET /ghg_statements/{id}`, and `POST /ghg_statements/{id}/submit`.
- Note: Certify exposes `GET /ghg_statements` as pagination-only, so
  local reconciliation client-filters by project + period end +
  `DRAFT` status (handled in `utils/reconciliation.ts`).

**Utils (`src/lib/isometric/utils/`, EXTENDED):**
- ✅ `ghg-statement-state.ts` — `chooseGhgSubmitMode` /
  `ghgSubmitFingerprintChanged`. Decides between `POST /submit` (first
  submission) and the resubmit endpoint (post-rejection).
- ✅ `reconciliation.ts` — stale-lock recovery and the
  GET-by-`supplier_reference_id` lookup that connects a stuck draft to
  its remote row.

**Server actions (`src/fn/certification/ghg-statements.ts`, NEW):**
- ✅ `createGhgStatementForFacility(...)` — `POST /ghg_statements`,
  routed through the same `decideSubmissionClaim` policy as Phase 3
  (with `onSubmittedHashChanged: 'invalid-changed-hash'` because
  the remote period row is unique per `(project, end_on)`).
- ✅ `submitGhgStatementForFacility(...)` — branches on draft vs
  rejected; calls submit or resubmit accordingly.
- ✅ `refreshGhgStatementStatus(...)` — `GET /ghg_statements/{id}` plus
  metadata reconciliation (caches `pending_total_co2e_removed_kg` on
  the local row).
- ✅ `loadFacilityCertificationOverview(...)` — read-only loader for
  the facility-scoped GHG statement page; lists recent removals + the
  current statement row.

**Hooks (`src/hooks/use-certification.ts`, EXTENDED):**
- ✅ Added the GHG-statement query + mutation hooks consumed by the new
  `/certification` page.

**UI:**
- ✅ Standalone facility-scoped page `src/app/(app)/certification/page.tsx`
  → `src/components/certification/certification-page.tsx` (~389 lines):
  table of statements with create / submit / refresh / resubmit
  controls.
- ✅ `ghg-statement-create-dialog.tsx` and `ghg-statement-submit-dialog.tsx`
  — modal forms with RHF + Zod.
- ✅ Sidebar entry added in `src/components/navigation/app-sidebar.tsx`.

**Tests:**
- ✅ `tests/isometric-ghg-statement-flow.test.ts` — submit-mode state
  machine (draft / rejected / pending CO2e behaviour).
- ✅ `tests/isometric-reconciliation.test.ts` — stale-lock recovery
  and client-side filtering of `GET /ghg_statements`.
- ✅ `tests/e2e/certification-page.spec.ts` — page-level smoke.

**Explicitly deferred (Phase 5+):**
- Webhook ingestion. `certifierProjects.webhookSecret` exists in the
  schema, but `src/app/api/certification/webhook/route.ts` is **not**
  built — and cannot be built today: Certify's OpenAPI spec declares
  `export type webhooks = Record<string, never>;`
  (`src/lib/isometric/generated/certify.d.ts:1175`) and no webhook
  topic exists at `https://docs.isometric.com`, so we have no
  authoritative event payload, signature header, or HMAC algorithm
  to verify against. Status polling via `refreshGhgStatementStatus`
  is the current reconciliation surface. Tracked in
  `docs/open-questions.md` → `isometric-webhook-contract`; resolves
  once Isometric publishes (or shares via support) the webhook
  contract.
- noma-driven PATCH orchestration for Removals — every payload change
  currently supersedes (creates a new version). PATCH branch deferred.
- Automatic resubmission — manual button only.
- External amendment claiming for registry-side statement-version
  drafts (admin edits made directly in the Isometric UI).

### Phase 5 — Time-series + bulk paths (not started)

`MonitoringSubmission`, `DataUploadSubmission`, biochar-specific
`POST /biochar_applications`. Skip until Phase 3/4 is stable in
production. Phase 5 also owns the carryover items consolidated in
`docs/open-questions.md` (webhook receiver once Isometric publishes a
contract, external GHG amendment claiming, hash-changed partial-orphan
cleanup).

### Phase 6 — Protocol/SOP surfacing (deferred indefinitely)

The Certify API does not expose protocol-compliance rules. Three paths
were on the table:

- **Build-time snapshot:** extend the
  `docs/isometric/update-playbook.md` workflow to dump SOP markdown into
  `public/isometric-sops/` for in-app reference.
- **Runtime via MCP:** a server action that calls
  `mcp__claude_ai_isometric__protocols_get_content` /
  `isometric_docs_get`. Only viable if the MCP server is reachable from
  the Next.js runtime.
- **Outbound links:** plain `<a target="_blank">` links from the
  Certify UI to authoritative pages on `registry.isometric.com` and
  `docs.isometric.com`. Zero ongoing maintenance, no new dependencies,
  no new routes. Snapshot/runtime paths above are deferred
  indefinitely; revisit only if operators report that external
  tab-switching is a real friction point.

## What to deliberately NOT do (lessons from varuna AND this review)

- **No fake-ID stubs.** If an endpoint isn't wired, the corresponding submit
  button stays disabled (`varuna/.../adapter.ts:70,204,251,262`).
- **No hand-written types.** Generate from OpenAPI.
- **No new sync tables.** `certificationSubmissions` + `certifierSyncEvents`
  are the source of truth.
- **No global `ISOMETRIC_PROJECT_ID` env var.** Project linkage is
  facility-scoped and lives in `certifierProjects`.
- **No required env vars** for credentials — keep them optional so unrelated
  app boot is unaffected.
- **No re-deriving lineage.** Always go through
  `getApplicationLineage()` to handle the delivery/order product fallback and
  missing-production-run / missing-feedstock cases.
- **No new files at `src/data-access/isometric.ts` or `src/fn/isometric.ts`.**
  Those names are taken by the sampling/compliance code. Use
  `certification.ts`.
- **No invented credit-batch detail route.** Surface lives in the existing
  side sheet (`credit-batch-list.tsx:84`).
- **No "skip if local external ID exists" idempotency.** That leaves a
  corruption window; use the lock + payload-hash + reconciliation flow.

## Critical files to modify or create

- ✅ `src/config/env.ts` — three optional vars added (Phase 0).
- ✅ `src/db/schema/certification.ts` — `defaultRemovalTemplateId` added
  (Phase 0); `certifier_projects_provider_external_unique` dropped
  (Phase 1); `certifier_ghg_periods` table added (Phase 4).
- ✅ `src/lib/isometric/{client,index}.ts` + `generated/certify.d.ts` +
  `projects.ts` (`listProjects`, `listRemovalTemplates`,
  `listComponentBlueprints`) — Phases 0–2.
- ✅ `src/lib/isometric/transformers/{datapoint,removal}.ts` — Phase 3.
- ✅ `src/lib/isometric/utils/{aggregation,payload-hash,supplier-ref,
  submission-claim,reconciliation,ghg-statement-state}.ts` —
  Phase 3 + Phase 4. `submission-claim.ts` is shared by both
  Removal and GHG-statement orchestrators.
- ✅ `src/lib/isometric/submissions.ts` — Phase 3.
- ✅ `src/lib/isometric/ghg-statements.ts` — Phase 4.
- ✅ `src/data-access/certification.ts` — Phase 1; extended in
  Phase 4 for GHG-statement persistence.
- ✅ `src/fn/certification/` (split from a single file in Phase 3) —
  `facility-mapping.ts` (Phase 1), `certify-context.ts` (Phase 2),
  `submit-credit-batch.ts` (Phase 3), `ghg-statements.ts` (Phase 4),
  `shared.ts`, `index.ts`.
- ✅ `src/schemas/certification.ts` — Phase 1; extended in Phase 4.
- ✅ `src/hooks/use-certification.ts` — Phase 1; extended in Phase 2
  with `useCertifyContextForCreditBatch`; extended in Phase 4 with
  GHG-statement query + mutation hooks.
- ✅ `src/components/certification/` — Phase 1
  (`facility-certifier-section.tsx`, `facility-certifier-dialog.tsx`,
  `index.ts`); Phase 2 added `certify-panel.tsx`, `blueprint-list.tsx`;
  Phase 3 added `submission-status-badge.tsx`, `sync-event-log.tsx`
  + Submit button on `certify-panel.tsx`; Phase 4 added
  `certification-page.tsx`, `ghg-statement-create-dialog.tsx`,
  `ghg-statement-submit-dialog.tsx`.
- ✅ `src/app/(app)/certification/page.tsx` — Phase 4 facility-scoped
  GHG-statement page.
- ✅ `src/components/navigation/app-sidebar.tsx` — Phase 4 sidebar
  entry.
- ✅ `src/components/credit-batches/credit-batch-list.tsx` — mounts
  `<CertifyPanel />` via `viewModeChildren` (Phase 2; Submit button
  exposed in Phase 3).
- ✅ `src/components/ui/entity-side-sheet/index.tsx` — `viewModeChildren`
  prop (Phase 1).
- ✅ `src/components/facilities/facility-list.tsx` — mounts
  `<FacilityCertifierSection />` via `viewModeChildren` (Phase 1).
- *Future:* `src/app/api/certification/webhook/route.ts` — webhook
  ingestion remains deferred (Phase 4 deferrals; see
  `docs/open-questions.md`).
- ✅ `scripts/isometric-smoke.ts` — Phase 0.
- ✅ `scripts/isometric-link-demo.ts` — Phase 0 stopgap; updated in
  Phase 1 to allow N→1 facility/project mappings.

## Verification

- **Phase 0 (✅):** `pnpm tsx scripts/isometric-smoke.ts` prints production
  project list (2 projects, including the demo one).
- **Phase 1 (✅):** verified end-to-end: `pnpm db:push` applied
  `0016_panoramic_selene.sql`; only
  `certifier_projects_facility_provider_unique` remains on the table.
  Live API helpers smoke-tested — demo project returns 2 templates
  (`Protocol default`, `Biochar`). `tsc --noEmit` and `pnpm lint`
  pass. `tests/e2e/facility-certifier-mapping.spec.ts` shipped
  2026-05-07 with two tests (N→1 mapping rendered in the side-sheet
  view mode; unlink refused with the `SafeError` surfaced in
  `UnlinkConfirmDialog`). Both gated on `ISOMETRIC_DEMO_PROJECT_ID`
  via `test.skip`.
- **Phase 2 (✅):** open a credit-batch side sheet — Certify accordion
  renders the facility's project + default removal template + the
  component blueprints that template references. Drift cases (stale
  template ID, missing blueprint keys) render distinct warnings.
  `tsc --noEmit` and `pnpm lint` pass. Not-linked empty-state E2E
  delivered as `tests/e2e/certification-submit.spec.ts` (lives next
  to the credit-batch spec rather than inside it; same coverage).
- **Phase 3 (✅):** `submitCreditBatch` ships and produces a real Removal
  with linked Datapoints in Certify. Idempotency verified by re-clicking
  Submit (no-op on matched payload hash) and by mutating the batch
  (creates `version=2` and supersedes v1). Tests delivered:
  `tests/isometric-payload-hash.test.ts`,
  `tests/isometric-submission-claim.test.ts` (18 cases — full claim
  decision matrix), `tests/isometric-transformers.test.ts` (14 cases —
  `INPUT_MAPPING` happy paths + drift / unit / null guards, removal
  scalar-vs-list branching, and ISO-date formatting),
  `tests/isometric-certify-context.test.ts` (5 cases — every branch of
  `loadCertifyContextForCreditBatchForUser`: unlinked, no-default,
  drift, unresolved-blueprint, fully-resolved), and
  `tests/e2e/certification-submit.spec.ts` (Certify-panel rendering
  smoke for the not-linked credit-batch state, no Isometric calls
  required). *Still deferred:* a happy-path Removal-submit E2E that
  exercises `submitCreditBatch` end-to-end. Sandbox is now reachable
  (project `prj_1K9YJ33RKSBX9FFF`), but template input coverage gaps
  block the write path (`docs/open-questions.md` →
  `phase-3-input-coverage`, `phase-3-fixed-constants`).
- **Phase 4 (✅, webhook deferred):** GHG-statement create / submit /
  refresh / resubmit ship via the `/certification` page. Tests
  delivered: `tests/isometric-ghg-statement-flow.test.ts` (state
  machine), `tests/isometric-reconciliation.test.ts` (stale-lock
  recovery + DRAFT filter), `tests/e2e/certification-page.spec.ts`
  (page smoke). Webhook ingestion stays deferred (no published
  Certify webhook contract); see `docs/open-questions.md` →
  `isometric-webhook-contract`. HMAC verification + reconciliation
  tests will land alongside the receiver once a contract exists.

## Open questions (not blocking Phase 0)

1. ~~Does Certify support a metadata field on POSTed entities that lets us
   round-trip a client nonce for reconciliation lookups?~~ **Resolved
   2026-05-06.** No free-form metadata column exists on `Datapoint`,
   `Removal`, or `Source` (verified against
   `src/lib/isometric/generated/certify.d.ts:2167,3147,3362`). The
   authoritative round-trip mechanism is `supplier_reference_id` —
   already in use via `src/lib/isometric/utils/supplier-ref.ts` and the
   `findRemovalBySupplierRef` / `findDatapointBySupplierRef` lookups in
   `src/lib/isometric/submissions.ts`. No alternative fingerprint
   needed.
2. ~~Sources upload order: must `Source` be uploaded *before* the
   `Datapoint` that references it, or can it be attached later?~~
   **Resolved 2026-05-06.** Sources can be attached after the fact.
   `PATCH /datapoints/{id}` accepts `source_ids` with semantics
   "Overwrite existing source IDs"
   (`src/lib/isometric/generated/certify.d.ts:2843`), and Isometric's
   docs confirm "Verifiers are not notified when new sources are added
   to datapoints in a submitted removal, but they will immediately
   have access"
   (`https://docs.isometric.com/user-guides/certify/key-certify-concepts`).
   The Phase 3 orchestrator's current "POST Datapoint with
   `source_ids: []` first" pattern remains correct; Phase 3.5 will
   PATCH to attach uploaded sources without needing a two-phase commit
   or re-creating Removals. Note: any AI summary here is
   non-authoritative — the linked Isometric URL is the source of
   truth.
3. Multi-org credentials within 12 months? If yes, `client.ts` should already
   accept credentials as a constructor argument so a future per-facility-creds
   refactor is cheap. Plan assumes single-org for now. *Status: still
   open — only Isometric's product roadmap can answer.*
