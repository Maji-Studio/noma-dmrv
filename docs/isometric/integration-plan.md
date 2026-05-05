# Plan: Isometric Certify API integration for noma-dmrv

## Context

Connect noma-dmrv to Isometric's Certify API so MRV data flowing through the
biochar chain (Facility → ... → CreditBatch) can be submitted for verification,
and so protocol/SOP requirements can be pulled programmatically.

A working prototype exists at
`/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/varuna-carbon-dmrv/src/lib/isometric/`
(~4500 lines). Its credit-batch → removal → GHG statement path works
end-to-end, but most other endpoints are stubbed with fake IDs, types are
hand-written, and there is no retry, no lock, no payload hashing. We will
**rebuild** in noma — generating the API client off Isometric's OpenAPI spec
and aligning to noma's existing layered conventions and existing certification
schema.

**Scope (user-confirmed, delivered in phases):** submit MRV → Certify; pull
protocol requirements; pull SOPs/docs; submit GHG statements for verification.
**Auth:** env-level credentials only (`X-Client-Secret` + `Authorization:
Bearer <jwt>` — both pre-issued via Isometric's UI; no programmatic refresh).

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

```
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

```
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

### Phase 1 — Facility ↔ Isometric project mapping UI

The first thing every other phase depends on: an admin needs to be able to
declare "this facility submits to that registry project" without writing
SQL. Until this exists, we can't even render Phase 2's "Certify" panel
because `getCertifierProjectByFacility(facilityId)` will always return null.

**Schema work:**
- Drop the `certifier_projects_provider_external_unique` constraint (see
  Schema changes §2). Generate migration via `pnpm db:generate`.

**Data access (`src/data-access/certification.ts`, NEW):**
- `getCertifierProjectByFacility(facilityId)` → `CertifierProject | null`.
- `listCertifierProjectsForExternal(provider, externalProjectId)` → returns
  every facility currently linked to a given Isometric project (powers the
  "this project is already linked to facilities X, Y" UI hint, replacing
  the now-removed unique constraint).
- `upsertCertifierProject(facilityId, input)` — insert or update the row for
  the `(facilityId, provider)` pair. Auth-guarded.
- `deleteCertifierProject(facilityId, provider)` — unlink.
- All return plain types, not `ActionResult`.

**Isometric client additions (`src/lib/isometric/`):**
- `listProjects()` — wraps `GET /projects` (already exercised by the smoke
  script). No caching for now; the project list is tiny (2 today) and we
  want fresh reads while operators are onboarding.
- `listRemovalTemplates(externalProjectId)` — wraps
  `GET /removal_templates?project_id=…`. Used to populate the
  `defaultRemovalTemplateId` dropdown.

**Server actions (`src/fn/certification.ts`, NEW):**
- `loadFacilityCertifierMapping(facilityId)` — `withAction`. Returns
  `{ mapping, availableProjects, availableTemplates }`. `availableTemplates`
  is fetched only if a `mapping` already exists (otherwise the dropdown is
  hidden until a project is chosen).
- `saveFacilityCertifierMapping(input)` — `withAction`. Input includes
  `facilityId`, `externalProjectId`, optional `defaultRemovalTemplateId`,
  optional `protocolVersion`. Calls `upsertCertifierProject`. On the way
  in, validates against the live `listProjects()` result so a stale or
  bogus ID can't be saved. When `ISOMETRIC_ENVIRONMENT=production`, returns
  a `requiresProductionConfirm` flag the UI must satisfy by re-submitting
  with `confirmProduction: true`.
- `deleteFacilityCertifierMapping(facilityId)` — `withAction`. Refuses if
  any `certificationSubmissions` row exists for that facility's
  downstream entities (preserves audit trail).

**React Query hooks (`src/hooks/use-certification.ts`, NEW):**
- `useFacilityCertifierMapping(facilityId)` — `useQuery`. Stale time 30s.
- `useSaveFacilityCertifierMapping()` — `useMutation`; invalidates the
  query above.
- `useDeleteFacilityCertifierMapping()` — `useMutation`; same invalidation.

**UI (`src/components/certification/`, NEW):**
- `facility-certifier-card.tsx` — primary surface, dropped onto the facility
  detail page. Shows current mapping or "Not linked" state. Edit button
  opens a side sheet form.
- `facility-certifier-form.tsx` — side sheet form:
  - Project dropdown (`EntitySelect`-style, populated live from
    `availableProjects`). Each item shows project ID + name; warns inline
    if the project is already linked to other facilities.
  - Default removal template dropdown — disabled until project is chosen.
  - Protocol version input (free text; pre-fills from existing mapping).
  - Production-environment confirm checkbox, only rendered when
    `ISOMETRIC_ENVIRONMENT=production`.
- Mount point: extend `src/app/(app)/facilities/[facilityId]/page.tsx` (or
  whatever the facility detail route is called — verify) with a "Certification"
  card section.

**No admin-table view yet.** Add later if the operator ever runs >5
facilities; the per-facility card is fine for the demo project.

**Acceptance:**
1. From a facility detail page, an admin can pick the demo Isometric project
   from a dropdown and save. A `certifier_projects` row is created.
2. The same project can be linked from a *second* facility without error
   (validates the dropped unique constraint).
3. Re-opening the facility shows the saved mapping; the default-template
   dropdown is now populated.
4. With `ISOMETRIC_ENVIRONMENT=production`, saving without the confirm
   checkbox is rejected.

### Phase 2 — Read-only template/blueprint surfacing

- `lib/isometric/` exposes `listComponentBlueprints()` (HTTP-only).
- `fn/certification.ts`:
  - `loadCertifyContext(facilityId)` — wrapped with `withAction`, returns
    `{ project, templates, blueprints }`. Combines DB row + live API.
- `hooks/use-certification.ts`:
  - `useCertifyContext(facilityId)` — React Query. Stale time 5m.
- UI: a **"Certify" section inside the existing credit-batch side sheet**.
  Shows facility's project link, available templates, blueprint requirements
  inline. No new route. Phase 1's mapping UI is the prerequisite — without
  a `certifierProjects` row, this section renders an empty state pointing
  the user back to the facility page.

### Phase 3 — Single removal submission (end-to-end)

The smallest meaningful unit is one credit batch → one removal. Phases 1–2
are prerequisites: a facility must be linked, and templates/blueprints must
be surfaced.

1. Transformers (pure functions, table-driven tests):
   - `transformers/source.ts` — local `documents` row → `CreateSourceRequest`.
   - `transformers/datapoint.ts` — numeric reading → `CreateDatapointRequest`
     (with optional standard deviation for uncertainty).
   - `transformers/component.ts` — aggregated production data → component
     inputs, using a declarative `INPUT_MAPPING` dict (port the pattern from
     `varuna/.../transformers/removal.ts:63-110`).
   - `transformers/removal.ts` — assemble components into the template's
     component groups.
2. Port `utils/aggregation.ts` from
   `varuna/.../utils/aggregation.ts` — mass-weighted blends, durability
   ratios. Correct per Biochar v1.2.
3. `fn/certification.ts` adds `submitCreditBatch(creditBatchId)`:
   - Resolve facility → look up `certifierProjects` row → 422 if absent.
   - Call `getApplicationLineage(applicationId)` — **reuse existing
     branching** (`delivery.biocharProductId ?? order.biocharProductId`,
     null `linkedProductionRunId`, empty feedstocks). If lineage warnings
     are non-empty for blocking fields, refuse submission with a clear
     message.
   - Run aggregation.
   - For each step (sources, datapoints, components, removal), call the
     idempotency ledger flow against `certificationSubmissions`.
   - Append a row to `certifierSyncEvents` per HTTP attempt.
4. UI inside the credit-batch side sheet:
   - "Submit to Isometric" button. Disabled when:
     - facility has no certifier project, or
     - lineage has blocking warnings, or
     - latest submission row is locked in flight.
   - Status badge driven by latest `certificationSubmissions.status`.
   - Sync-event log accordion showing the last N attempts.

**Acceptance:** one seeded credit batch produces a real `Removal` in sandbox
Certify with all linked components, datapoints, and sources visible in the
Isometric UI. Re-clicking Submit is a no-op (matched payload hash). Mutating
the batch and re-submitting creates a `version=2` row and supersedes v1.

### Phase 4 — GHG statement lifecycle

- `submitGhgStatement(removalIds[])` server action.
- `getGhgStatementStatus(externalId)` polled by React Query while status is
  `DRAFT|SUBMITTED`; long stale time once `VERIFIED|REJECTED`.
- "Resubmit" path on rejection (`POST /ghg_statements/{id}/submit`).
- Each transition appends a `certifierSyncEvents` row.
- Webhook ingestion: `certifierProjects.webhookSecret` already exists. Add a
  small `app/api/certification/webhook/route.ts` that validates the HMAC and
  reconciles `certificationSubmissions` rows on inbound notifications. This
  removes most of the need for status polling.

### Phase 5 — Time-series + bulk paths (deferred)

`MonitoringSubmission`, `DataUploadSubmission`, biochar-specific
`POST /biochar_applications`. Skip until Phase 3/4 is stable in production.

### Phase 6 — Protocol/SOP surfacing (orthogonal)

The Certify API does not expose protocol-compliance rules. Two paths:

- **Build-time snapshot (recommended):** extend the existing
  `docs/isometric/update-playbook.md` workflow to dump SOP markdown into
  `public/isometric-sops/` for in-app reference. No runtime MCP dependency.
- **Runtime via MCP:** a server action that calls
  `mcp__claude_ai_isometric__protocols_get_content` /
  `isometric_docs_get`. Only viable if the MCP server is reachable from the
  Next.js runtime — confirm before committing.

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

- `src/config/env.ts` — three optional vars added.
- `src/db/schema/certification.ts` — add `defaultRemovalTemplateId`.
- `src/lib/isometric/{client,types,index}.ts` + `generated/` + `transformers/`
  + `utils/{aggregation,payload-hash}.ts` — new.
- `src/data-access/certification.ts` — new.
- `src/fn/certification.ts` — new.
- `src/hooks/use-certification.ts` — new.
- `src/components/certification/` — new.
- `src/components/credit-batches/credit-batch-list.tsx` — extend the side
  sheet with a "Certify" section (Phase 2+3).
- `src/app/(app)/facilities/[facilityId]/page.tsx` (or equivalent) — mount
  `<FacilityCertifierCard />` (Phase 1).
- `src/app/api/certification/webhook/route.ts` — new (Phase 4).
- `scripts/isometric-smoke.ts` — Phase 0 (✅ done).
- `scripts/isometric-link-demo.ts` — Phase 0 stopgap until Phase 1 UI
  ships (✅ done).

## Verification

- **Phase 0 (✅):** `pnpm tsx scripts/isometric-smoke.ts` prints production
  project list (2 projects, including the demo one).
- **Phase 1:** `tests/e2e/facility-certifier-mapping.spec.ts` — seed two
  facilities, link both to the demo project via the UI, assert two
  `certifier_projects` rows with the same `externalProjectId` (validates
  unique-constraint drop). Production-confirm guard tested by toggling
  `ISOMETRIC_ENVIRONMENT=production` in the test env.
- **Phase 2:** open a credit-batch side sheet — Certify section renders the
  facility's project + templates + blueprints.
- **Phase 3:** `tests/e2e/certification-submit.spec.ts` — seed a credit
  batch, click Submit, assert a `certificationSubmissions` row with non-null
  `externalId` and `status='submitted'`. Re-click → no new row. Manually
  verify the removal exists in sandbox Certify on first run only.
- **Phase 4:** add status-transition assertions; mock-webhook delivery test.
- **Unit tests:** `tests/unit/{isometric-transformers,payload-hash,
  certification-idempotency}.test.ts` — pure-function tables for
  transformers, ledger state machine for idempotency.

## Open questions (not blocking Phase 0)

1. Does Certify support a metadata field on POSTed entities that lets us
   round-trip a client nonce for reconciliation lookups? If not, design an
   alternative fingerprint (timestamp + entity-code search). Verify via
   `openapi_documents_get_object` for `Removal`/`Datapoint`/`Source`.
2. Sources upload order: must `Source` be uploaded (presigned URL flow)
   *before* the `Datapoint` that references it, or can it be attached later?
   Affects whether the orchestrator needs a true two-phase commit. Read
   `user-guides/certify/key-certify-concepts`.
3. Multi-org credentials within 12 months? If yes, `client.ts` should already
   accept credentials as a constructor argument so a future per-facility-creds
   refactor is cheap. Plan assumes single-org for now.
