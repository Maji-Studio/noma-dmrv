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

## Current status

Phases 0–4 are delivered: the read paths (project / removal-template /
component-blueprint surfacing), the Phase 3 write path (Removal submission
with transport-leg coverage), and the Phase 4 GHG-statement layer. The
Isometric sandbox is wired up and the read paths are sandbox-verified.

The integration was **re-leveled twice** in May 2026. The first re-level
(2026-05-21) is superseded; the **current model is ADR 0003**
(`docs/adr/0003-removal-as-submission-unit.md`, 2026-05-22):

- The Isometric **Removal is the submission unit**, held locally by a
  `certifierRemovals` row (facility-scoped). **N credit batches map into one
  Removal** — default 1:1 per month, lazily created on first submit; several
  can be grouped via the Removals hub. `creditBatches` carries a nullable
  `removalId` FK.
- A Removal aggregates the **deduped union of production runs** reached
  through its member credit batches' application lineage, **applied-biochar
  scoped** — each run weighted by `appliedDryKg / runTotalBiocharOutput`
  (linear mass allocation).
- Submission is **single-phase** `submitRemoval` — no GHG phase.
- **GHG Statements are decoupled.** A GHG Statement is an arbitrary
  supplier-chosen reporting period, not a synonym for a credit batch. It is
  delivered as an **independent feature** — see Phase 4.5.

Phase 3.7 replaced the energy zero-stubs with real per-run data and added
the per-facility emission-estimate admin surface. The per-reporting-period
inputs remain zero-stubbed and are tracked in `docs/open-questions.md`
(`isometric/phase-3.7-period-inputs`); no template carrying a zero stub
may be promoted to a production project. Webhook ingestion and the
Phase 5+ time-series / bulk paths are deferred.

Per-phase delivery detail is in the "Phased delivery" section below. A
point-in-time implementation log (sandbox wiring, the 2026-05 hardening
pass, transport-leg rollout) is archived at
`docs/archive/isometric-integration-status-2026-05-21.md`.

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
  matches Phase 3's `submitRemoval`: load batch via
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

### Phase 3 — Removal submission (end-to-end) ✅ DONE

> **Re-leveled — current model is ADR 0003**
> (`docs/adr/0003-removal-as-submission-unit.md`). The Removal is the
> submission unit, held locally by a `certifierRemovals` row; N credit
> batches map into one Removal; a Removal aggregates the deduped,
> applied-mass-scoped union of production runs reached through its member
> batches' application lineage. Submission is single-phase `submitRemoval`.
> The transformers, idempotency ledger, and supplier-ref machinery below
> are unchanged — only the orchestrator's grain moved.

Removal submission with the full idempotency ledger. Phases 1–2 are
prerequisites.

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
  (`facility-mapping.ts`, `certify-context.ts`, `shared.ts`, `index.ts`).
  The ADR 0003 re-leveling added `submit-removal.ts`, `removal-grouping.ts`,
  and `certify-context.ts`'s removal-scoped loaders; `ghg-statements.ts`
  is wired live by Phase 4.5.
- ✅ `submitRemoval(...)` in `submit-removal.ts` — the submission unit
  (one `certifierRemovals` row → one Isometric Removal):
  - Loads the removal's full context (every member credit batch's deduped
    run union + per-run applied-biochar attribution), aggregates ALL runs
    together with linear mass allocation, enriches with pooled transport
    legs + the facility emission config, builds the datapoints/removal
    payload, computes `payloadHash`.
  - Calls `decideSubmissionClaim` and acts on the returned claim. Ledger
    row keyed `localEntityType:'removal'`, `localEntityId: certifierRemovals.id`.
    Idempotent: a completed removal short-circuits via `return-existing`;
    a changed payload supersedes to a new version. The `payloadHash`
    covers the source run set + resolved inputs, **not** the member-batch
    id set — a pure-membership change must not POST a duplicate Removal.
  - Each HTTP attempt appends a `certifier_sync_events` row.
- ✅ Lineage resolution **reuses existing branching**
  (`delivery.biocharProductId ?? order.biocharProductId`, nullable
  `linkedProductionRunId`, possibly-empty feedstocks) and refuses
  submission when any lineage has blocking warnings.
- ✅ `submitCreditBatchRemoval` / `submitRemovalAction` /
  `assignCreditBatchToRemoval` (`removal-grouping.ts`) drive the credit-batch
  Certify panel and the Removals hub — lazy 1:1 creation, N:1 grouping,
  direct submit.

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
  editor). `submitRemoval` bails with a clear `SafeError` when
  unbound constants are detected.

**Acceptance (met):** submitting a removal produces one real Removal in
Certify aggregating its member credit batches' applied-scoped production
runs, with linked Datapoints. Re-clicking Submit is a no-op (matched
payload hash). Mutating a source run and re-submitting supersedes to
`version=2`; a pure membership change (grouping a batch in/out) does not
POST a duplicate.

**To do (carried forward):** source-upload presigned-URL flow (Phase 3.5),
per-Datapoint sub-ledger rows (Phase 4 deferral).

### Phase 3.7 — Real energy data + per-facility emission config ✅ DONE (energy; period inputs deferred)

**Shipped 2026-05-21.** Phase 3 submitted Removals with monitored inputs
hard-coded to `0` ("zero stubs"). Phase 3.7 replaces the *energy* stubs
with real per-run data and builds the admin surface for the estimates
the routing needs. The per-reporting-period inputs are deferred.

**What grilling + the Sifuri Halisi LCA established:**

- Operators record ONE combined electricity figure + diesel litres per
  production run; they cannot differentiate the pre-processing /
  pyrolysis / post-processing stages on site. The LCA's per-stage split
  is an estimate.
- All three per-stage electricity components share carbon intensity
  0.531 kgCO₂e/kWh; all three diesel-genset components share 0.8 — so
  splitting energy across stages is **emissions-neutral** (it shapes
  only the per-stage breakdown shown in the registry, not the total).
- The genset components are energy-based (kWh); noma measures genset
  diesel in litres. Conversion yield ≈ **3.375 kWh/L** (LCA diesel CI
  2.7 ÷ genset CI 0.8).

**Schema — no new table.** Four nullable columns on `certifier_projects`
(migration `drizzle/0019_magical_menace.sql`):
`genset_energy_yield_kwh_per_litre`, `stage_split_biomass_pct`,
`stage_split_pyrolysis_pct`, `stage_split_biochar_pct`. They sit
alongside `default_removal_template_id` as "how this facility submits"
config.

**Transformer.** `aggregateProductionRuns` splits diesel into
`totalStartupDieselLitres` (operation + preprocessing) and
`totalGensetDieselLitres`. New pure `enrichWithFacilityConfig(agg,
config)` routes the combined electricity + genset kWh across the
per-stage components by the facility's stage-split estimate.
`enrichWithTransportLegs` also computes
`sampleTransportMassDistanceTonneKm`. The `INPUT_MAPPING` energy entries
point at the new fields (zero-stub `transform: () => 0` removed) — this
also fixes a latent double-count where `totalElectricityKwh` fed both
the pyrolysis meter and the biochar-processing grid input at full value,
and a diesel double-count (genset litres were in the volume component).

**Admin.** New `/admin/emission-estimates` page — facility selector +
numeric form editing the emission columns of the facility's
`certifier_projects` row. Minimal admin nav added to `admin/layout.tsx`.
Stack: `updateFacilityEmissionConfig` (data-access),
`saveFacilityEmissionConfig` (fn), `useSaveFacilityEmissionConfig`
(hook), `facilityEmissionConfigSchema` with a sum-to-100 `superRefine`.

**Energy summary page.** New `/energy` route (Production section) — a
read-only facility rollup of electricity + diesel across production
runs, with the per-stage submission preview.

**Seed.** `seed-data.ts` creates a `certifier_projects` row for Moshi
(sandbox project `prj_1K9YJ33RKSBX9FFF` + `Dark Earth Carbon Template`
+ emission columns from the LCA: yield 3.375; splits 32.2 / 58.5 / 9.3).
This also removes the manual "link facility" step from sandbox test runs.

**Deferred — `docs/open-questions.md` → `isometric/phase-3.7-period-inputs`.**
These stay zero-stubbed: pyrolyzer CH₄/CO concentration + gas mass-flow,
lab-analysis electricity, sampling consumables mass, staff-travel
distance, miscellaneous mass. After the re-leveling these are
period-level and belong on the GHG Statement's "Reporting period
emissions" tab, not on per-run Removals. Unresolved: tracked operational
entities vs admin estimates, and how a per-reporting-period figure is
apportioned across the ~12 monthly GHG Statements in a period. **No
template carrying a zero stub may go to a production project.**

**Critical files:** `src/db/schema/certification.ts`,
`src/lib/isometric/utils/aggregation.ts`,
`src/lib/isometric/transformers/datapoint.ts`,
`src/fn/certification/{submit-removal,facility-mapping}.ts`,
`src/data-access/certification.ts`, `src/schemas/certification.ts`,
`src/hooks/use-certification.ts`,
`src/components/admin/emission-estimates-form.tsx`,
`src/app/(app)/admin/{layout.tsx,emission-estimates/page.tsx}`,
`src/components/energy/energy-summary.tsx`,
`src/app/(app)/energy/page.tsx`,
`src/components/navigation/app-sidebar.tsx`, `src/db/seed-data.ts`.

### Phase 4 — GHG statement lifecycle ✅ DONE, then decoupled

> **Superseded by ADR 0003** (`docs/adr/0003-removal-as-submission-unit.md`).
> Phase 4 originally shipped a "credit batch = GHG Statement" lifecycle with
> a two-phase `submitCreditBatch`. ADR 0003 (2026-05-22) established that a
> GHG Statement is an arbitrary supplier-chosen reporting period, **not** a
> synonym for a credit batch — so the GHG layer was **decoupled** from the
> submit path. `submitCreditBatch` and its two-phase orchestration were
> removed; submission is the single-phase `submitRemoval` of Phase 3. The
> GHG layer is re-keyed and wired live as an independent feature in
> Phase 4.5.

The Isometric client and lifecycle machinery built in Phase 4 are retained
and form the basis of Phase 4.5.

**Isometric client (`src/lib/isometric/ghg-statements.ts`):** retained.
- ✅ Typed wrappers for `POST /ghg_statements`,
  `GET /ghg_statements/{id}`, and `POST /ghg_statements/{id}/submit`.
- `CreateGhgStatementRequest` carries only `{ end_on, project_id }`;
  Removals link to the statement by reporting-period date range,
  **server-side** — `removal_ids` is read-only, `reporting_period_start_at`
  is server-derived.
- `findDraftGhgStatementsByPeriod` — client-side filter by project +
  period end + `DRAFT` (`GET /ghg_statements` is pagination-only).

**Lifecycle utils (`src/lib/isometric/utils/`):** retained.
- ✅ `ghg-statement-state.ts` — `chooseGhgSubmitMode` /
  `ghgSubmitFingerprintChanged` (first submit vs resubmit).
- ✅ `reconciliation.ts` — stale-lock recovery + GET-by-`supplier_reference_id`.

**Server actions (`src/fn/certification/ghg-statements.ts`):** kept but
**dormant** after ADR 0003 — re-keyed from the credit batch and wired live
by Phase 4.5.

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
  `docs/open-questions.md` → `isometric-webhook-contract`.
- noma-driven PATCH orchestration for Removals — every payload change
  currently supersedes (creates a new version). PATCH branch deferred.
- Automatic resubmission — manual button only.
- External amendment claiming for registry-side statement-version
  drafts (admin edits made directly in the Isometric UI).

### Phase 4.5 — Multi-removal GHG Statements + Certification route group 🚧 IN PROGRESS

ADR 0003 left GHG Statements as "a future, independent feature." Phase 4.5
delivers it: an operator creates an Isometric GHG Statement covering a
chosen reporting period that rolls up multiple Removals, then submits it
to the verifier.

**Route group.** A provider-neutral `src/app/(app)/certification/` group
(named neutrally — Verra / Gold Standard / CSI may be added later): a hub
`page.tsx` plus `removals/page.tsx` (the existing Removals hub moves here)
and `ghg-statements/page.tsx`. The sidebar gains a "Certification" section.

**Schema.** New `certifierGhgStatements` table (facility-scoped, mirrors
`certifierRemovals`: `reportingPeriodEndOn`, server-derived
`reportingPeriodStartOn`). `certifierRemovals` gains a nullable
`ghgStatementId` FK — reconciled from the statement's `removal_ids`, not
user-assigned. Additive migration `0023`.

**Period-first creation.** Isometric creates a statement from only
`{ project_id, end_on }` and links Removals server-side by date range, so
the create flow is period-first via a stepper dialog: pick the period end →
preview the Removals predicted to be linked (and the open Removals outside
the period) → confirm. After the POST, the actual `removal_ids` are
reconciled back onto local `certifierRemovals.ghgStatementId`.

**Server layer.** `ghg-statements.ts` is re-keyed from the credit batch to
a `ghgStatement` local entity (ledger row `localEntityType:'ghgStatement'`,
`localEntityId: certifierGhgStatements.id`): `createGhgStatementDraft`,
`submitGhgStatementToVerifier`, `refreshGhgStatementStatus`,
`loadGhgStatementState`. The lifecycle stays DRAFT → AWAITING_VERIFICATION
→ VERIFIED / FAILED_VERIFICATION.

**Critical files:** `src/db/schema/certification.ts`, NEW
`src/data-access/certifier-ghg-statements.ts`,
`src/fn/certification/ghg-statements.ts` (re-key),
`src/hooks/use-certification.ts`, `src/schemas/certification.ts`,
NEW `src/components/certification/{ghg-statements-hub,
ghg-statement-create-dialog,ghg-statement-submit-dialog}.tsx`,
`src/app/(app)/certification/**`, `src/components/navigation/app-sidebar.tsx`.

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
  (Phase 1); `certifier_ghg_periods` added in Phase 4, dropped by the
  first re-leveling; `certifierRemovals` table + `creditBatches.removalId`
  added by ADR 0003; `certifierGhgStatements` table +
  `certifierRemovals.ghgStatementId` added by Phase 4.5.
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
  `submit-removal.ts` + `removal-grouping.ts` (ADR 0003 Removal
  submission), `ghg-statements.ts` (re-keyed live by Phase 4.5),
  `shared.ts`, `index.ts`. `submit-credit-batch.ts` was removed by
  ADR 0003.
- ✅ `src/schemas/certification.ts` — Phase 1; extended in Phase 4.
- ✅ `src/hooks/use-certification.ts` — Phase 1; extended in Phase 2
  with `useCertifyContextForCreditBatch`; extended in Phase 4 with
  GHG-statement query + mutation hooks.
- ✅ `src/components/certification/` — Phase 1
  (`facility-certifier-section.tsx`, `facility-certifier-dialog.tsx`,
  `index.ts`); Phase 2 added `certify-panel.tsx`, `blueprint-list.tsx`;
  Phase 3 added `submission-status-badge.tsx`, `sync-event-log.tsx`.
  ADR 0003 added `removals-hub.tsx` and recast `certify-panel.tsx` as a
  compact removal status strip. Phase 4.5 adds `ghg-statements-hub.tsx`,
  `ghg-statement-create-dialog.tsx`, `ghg-statement-submit-dialog.tsx`.
- ✅ `src/app/(app)/certification/` — a Phase 4 facility-scoped page,
  removed by the first re-leveling, restored by ADR 0003 as the Removals
  hub, and expanded by Phase 4.5 into a route group (`page.tsx` hub +
  `removals/` + `ghg-statements/`).
- ✅ `src/components/navigation/app-sidebar.tsx` — a Phase 4 sidebar
  entry, removed then restored; Phase 4.5 gives it a "Certification"
  section with Removals + GHG Statements.
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
- **Phase 3 (✅):** `submitRemoval` ships and produces one real Removal
  in Certify aggregating its member credit batches' applied-scoped
  production runs, with linked Datapoints. Idempotency verified by
  re-clicking Submit (no-op on matched payload hash) and by mutating a
  source run (supersedes to `version=2`). Tests delivered:
  `tests/isometric-payload-hash.test.ts`,
  `tests/isometric-submission-claim.test.ts` (18 cases — full claim
  decision matrix), `tests/isometric-transformers.test.ts`
  (`INPUT_MAPPING` happy paths + drift / unit / null guards, removal
  scalar-vs-list branching, and ISO-date formatting),
  `tests/isometric-certify-context.test.ts` (10 cases — context
  resolution branches + per-run transport coverage). *Still deferred:*
  a happy-path Removal-submit E2E that exercises `submitRemoval`
  end-to-end. Sandbox is now reachable (project `prj_1K9YJ33RKSBX9FFF`),
  but template input coverage gaps block the write path
  (`docs/open-questions.md` → `phase-3-input-coverage`,
  `phase-3-fixed-constants`).
- **Phase 4 (✅, then decoupled):** the GHG-statement lifecycle shipped,
  then ADR 0003 decoupled it from the submit path. The Isometric client
  and lifecycle utils are retained; `ghg-statements.ts` is re-keyed and
  wired live by Phase 4.5. The submit-mode state-machine and stale-lock
  reconciliation tests still pass. Webhook ingestion stays deferred (no
  published Certify webhook contract); see `docs/open-questions.md` →
  `isometric-webhook-contract`.
- **Phase 4.5 (🚧):** verification is detailed in the execution plan —
  the period-first stepper creates a `certifier_ghg_statements` row + a
  ledger row keyed `('isometric','ghg_statement','ghgStatement',<id>)`;
  reconciliation sets `certifier_removals.ghg_statement_id`;
  submit-to-verifier flips the ledger status.

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
