# Plan: Isometric Certify API integration for noma-dmrv

This doc is the **forward-looking** plan and status surface. It owns
roadmap, current architecture contracts, pre-deploy gates, and what
still has to be built. It does **not** narrate per-PR history — that
lives in `docs/isometric/changes.md`. Design decisions live in
`docs/adr/`; open questions live in `docs/open-questions.md`.

## Scope

Connect noma-dmrv to Isometric's Certify API so MRV data flowing
through the biochar chain (Facility → … → CreditBatch → Removal → GHG
Statement) can be submitted for verification, and so protocol/SOP
requirements can be pulled programmatically.

- **Auth:** env-level credentials only
  (`X-Client-Secret` + `Authorization: Bearer <jwt>`, both pre-issued
  via Isometric's UI; no programmatic refresh).
- **Provider-neutral naming:** new code lives under
  `certification.*` because the existing schema is provider-agnostic
  (`certifierProvider` enum supports `puro_earth` and `verra`).
  Provider-specific bits (transformers, client) stay under
  `src/lib/isometric/`.

## Current model (read the ADRs)

- **[ADR 0001 — Emission-estimate config](../adr/0001-emission-estimate-config.md)**
  (Phase 3.7, partly superseded). Per-facility genset yield is admin
  config, not an operational column.
- **[ADR 0015 — Energy single combined measurement point](../adr/0015-energy-single-combined-measurement-point.md)**.
  The active removal template takes one grid-electricity datapoint and one
  diesel-genset datapoint; stage splits are removed.
- **[ADR 0002 — Credit batch = GHG Statement](../adr/0002-credit-batch-as-ghg-statement.md)**
  (Superseded). Recorded for cross-reference only.
- **[ADR 0003 — Removal as submission unit](../adr/0003-removal-as-submission-unit.md)**.
  The Isometric Removal is the submission unit, held locally by a
  `certifierRemovals` row. `N credit batches → 1 Removal`. Submission
  is single-phase `submitRemoval` aggregating the deduped,
  applied-mass-scoped union of production runs reached through member
  batches' application lineage.
- **[ADR 0004 — GHG Statement as independent artifact](../adr/0004-ghg-statement-as-independent-artifact.md)**.
  A GHG Statement is a supplier-chosen reporting period held locally by
  `certifierGhgStatements`. Created period-first
  (`{ project_id, end_on }`); Isometric links Removals server-side by
  date range; reconciliation writes the FK onto local
  `certifierRemovals.ghgStatementId`.
- **[ADR 0005 — Period emissions as Project Components](../adr/0005-period-emissions-as-project-components.md)**.
  LCA-derived per-period emissions (staff travel, pyrolyzer gas, lab
  electricity, sampling consumables, miscellaneous mass) live as
  `PROJECT`-scope Components in Isometric, amortized server-side via
  `ProjectComponentAmortizationStrategy`. noma is the **LCA journal**
  (`/admin/emission-estimates` rows + drift panel), not the publisher;
  the operator posts Project Components directly in the Isometric UI.
- **[ADR 0007 — Certification workspace consolidation](../adr/0007-certification-workspace-consolidation.md)**.
  Certification is a first-class workspace. The credit-batch surfaces show
  readiness and membership context; creation/submission lives in the
  New-Removal wizard (`select ready batches -> registry requirements ->
  submit`) and GHG Statement flows.

## Phase status

| Phase | State | What it shipped |
|---|---|---|
| **0** — Foundation | ✅ | Generated client (`openapi-typescript`), three optional env vars, `client.ts` with retry + cursor pagination, smoke script. |
| **1** — Facility ↔ project mapping UI | ✅ | `/facilities` side-sheet adds Certify mapping section; N→1 facility/project allowed; production-confirm gate. |
| **2** — Template/blueprint read surfacing | ✅ | Credit-batch side-sheet Certify accordion with drift detection for stale template IDs and missing blueprint keys. |
| **3** — Removal submission | ✅ | `submitRemoval` with full idempotency ledger; supplier-ref reconciliation; pre-flight transport coverage check. Lineage via `getApplicationLineage()`. |
| **3.5** — Sources upload | ✅ | Mirrors noma documents to Isometric Sources via server-side proxy (POST `/sources` → fetch from noma storage → PUT to signed URL → INSERT `certifier_document_uploads`). Source IDs ride into every monitored Datapoint's `source_ids` and are part of the semantic hash (mirror/unmirror supersedes the Removal version). Reconciliation covers the orphan paths: `GET /sources?supplier_reference_id=…` → either `POST /sources/{id}/signed_upload_url` 200 (re-PUT) or 409 (already uploaded, insert local row only). SSRF host allowlist, advisory locks around POST+INSERT, transaction + double-check around unlink, sync-event coverage on every outbound failure. **Known compromise (v1):** removal-wide source attribution — every Datapoint receives the same `source_ids`. Per-input refinement deferred to Phase 5 (tracked `isometric/sources-per-input-attribution`). 50 MB cap per source; streaming larger files tracked `isometric/sources-stream-large-files`. |
| **3.6** — Tailored sandbox template | ✅ | `noma-mvp` Removal Template walkthrough + bootstrap script for fixed constants. Polymorphic transport-leg CRUD on delivery/sample/feedstock. |
| **3.7** — Real energy data | ✅ | Per-facility genset yield replaces energy zero stubs; ADR 0015 collapses energy to the active template's combined measurement point. `/admin/emission-estimates` + `/energy` summary route. |
| **3.7-period** — Period emissions | ✅ | Period-level inputs (staff travel, pyrolyzer gas, lab electricity, sampling consumables, miscellaneous) live as `PROJECT`-scope Components in Isometric (ADR 0005). noma extends `/admin/emission-estimates` with an LCA-journal section + read-only drift panel on `/certification/`; **noma does not POST** Project Components. The seven `zeroStub: true` families are deleted from INPUT_MAPPING; the scope-conflict `SafeError` from `lookupPeriodInputTuple` fires before the generic missing-entry error. `MAPPING_REVISION = sha256(canonicalJson(INPUT_MAPPING))` rides on every `submitRemoval` payload + sync event. Coverage check + OpenAPI regen gate land in `isometric-health.yml`. |
| **4** — GHG statement lifecycle | ❎ Superseded | Original two-phase `submitCreditBatch` removed by ADR 0003; lifecycle utilities retained and re-used by Phase 4.5. |
| **4.5** — Multi-removal GHG Statements | ✅ | Provider-neutral `/certification/` route group (hub + Removals + GHG Statements). Period-first stepper. Membership reconciliation never steals. Unlink/repoint guard widened. |
| **5** — Time-series + bulk | 🟢 Slice A shipped (2026-05-29 scoped → built), B + C deferred | **Slice A** — `DataUploadSubmission` of `biochar_pyrolysis_reactor_facility_time_series` (Parquet bulk upload of **60-second clock-aligned** aggregations of `production_run_readings`, one file per facility per Removal-window — hard cap surfaced by sandbox smoke 2026-05-29 with `AggregationPeriodDurationInvalidError: ... exceeds maximum allowed of 60 seconds`). New `certifier_sensors` table maps `(reactor × measurement_property) → externalSensorId + sensorReference`. New `certifier_projects.externalFacilityId` column (operator-pasted from Certify UI; no `POST /facilities` exists). Manual "Submit Telemetry" button on the Removal page; status badge surfaces the latest `GET /data-upload-submissions/{id}` poll. Idempotency uses journaled-step IDs in `payloadSnapshot` (no supplier-reference reconciliation path — see [ADR 0006](../adr/0006-data-upload-submission-idempotency.md)). Parquet writer locked to **`hyparquet-writer`** (validated end-to-end against sandbox 2026-05-29; explicit `SchemaElement[]` with `logical_type: { type: 'TIMESTAMP', isAdjustedToUTC: true, unit: 'NANOS' }` for the four timestamp columns; INT64 bigint values written directly without Date conversion). **Slice B** (`POST /biochar_applications`) and **Slice C** (`MonitoringSubmission`) tracked under `docs/open-questions.md`. Webhook receiver still pending Isometric publishing a contract. |
| **6** — Protocol/SOP surfacing | ⏭ Deferred | Resolved as outbound links to `registry.isometric.com` / `docs.isometric.com`. Reopen only if operators report tab-switching friction. |
| **7** — Certify workspace and readiness UX | ✅ | Credit-batch health classifier, entity certifier-readiness badges, New-Removal wizard, certifier requirements checks, deep "View on Isometric" link, and transport evidence upload UX. Facility setup is treated as incomplete unless mapping/template/protocol config is present. |

## Pre-deploy gates

Block deploy to any environment that has ever held real (non-sandbox)
registry data:

1. **Legacy ledger cutover** — run
   `SELECT count(*) FROM certification_submissions
    WHERE local_entity_type IN ('creditBatch','ghgPeriod')`
   against each target environment. ADR 0003's clean-cutover assumption
   relies on this being 0. If > 0: author a forward data migration to
   purge or remap. Note `cert_submissions_external_unique` is **not**
   scoped by `localEntityType`, so a stale `creditBatch` row sharing an
   `externalId` with a new removal would raise a unique-constraint
   violation.
2. **Destructive migration `0021`** — `DROP TABLE certifier_ghg_periods
   CASCADE`, no down-migration. `migrate.yml` auto-applies on push to
   `main`/`staging`. Confirm a DB backup exists and the table is empty
   before the workflow fires. `CASCADE` is unnecessary (no dependents)
   — harmless, left as-is.
3. **Wide id-addressable surface on Removals** —
   `submitRemovalAction` / `assignCreditBatchToRemovalAction` accept a
   raw `removalId` from the client and currently only `requireAuth`. An
   authenticated user can drive an external POST on any facility's
   removal. Acceptable single-tenant; **must be decided before a second
   facility operator is onboarded** (accept as single-tenant
   indefinitely, or land the facility-membership model and gate every
   removal/ghg-statement accessor on the resolved facility). Same
   posture applies to `certifier-ghg-statements.ts`.
4. **Period-emission Project Components present in Isometric AND noma.**
   Replaces the original "no zero-stub template" gate now that ADR 0005
   moves period inputs out of `INPUT_MAPPING` entirely. For every
   category referenced by any Removal Template a facility uses,
   confirm: (a) `/admin/emission-estimates` carries a row for the
   current LCA window with a real magnitude, (b)
   `getProject().components` returns a matching `PROJECT`-scope
   Component. The nightly coverage check (Operational health below)
   asserts both. The scope-conflict `SafeError` from ADR 0005 prevents
   any zero-stub regression at submit time.

## Architecture (file layout)

```text
src/lib/isometric/                     # PURE — no DB, no ActionResult, no auth
  ├─ client.ts                         # fetch wrapper: headers, retry, cursor paging
  ├─ generated/certify.d.ts            # openapi-typescript output (committed)
  ├─ projects.ts                       # listProjects, listRemovalTemplates,
  │                                    #   listComponentBlueprints
  ├─ ghg-statements.ts                 # GHG Statement typed wrappers
  ├─ submissions.ts                    # findRemovalBySupplierRef, findDatapointBySupplierRef
  ├─ transformers/                     # noma domain → Certify request shape
  │   ├─ datapoint.ts                  # INPUT_MAPPING table
  │   └─ removal.ts
  └─ utils/
      ├─ aggregation.ts                # mass-weighted blends; transport rollup
      ├─ payload-hash.ts               # canonicalJson + sha256
      ├─ supplier-ref.ts               # nm-rmv-…, nm-dpt-… stable refs
      ├─ submission-claim.ts           # decideSubmissionClaim (pure)
      ├─ removal-membership.ts         # GHG Statement membership decision
      ├─ ghg-statement-state.ts        # chooseGhgSubmitMode
      └─ reconciliation.ts             # stale-lock recovery

src/data-access/
  ├─ certification.ts                  # certifierProjects, sources, submissions,
  │                                    #   document uploads, sync events
  └─ certifier-ghg-statements.ts       # GHG Statement persistence + reconcile

src/fn/certification/                  # withAction-wrapped server actions
  ├─ facility-mapping.ts               # Phase 1
  ├─ certify-context.ts                # public context loaders
  ├─ certify-context-core.ts           # context assembly + bounded fan-out
  ├─ create-removal-with-batches.ts    # New-Removal wizard create step
  ├─ batch-health.ts                   # credit-batch health/readiness actions
  ├─ submit-removal.ts                 # Phase 3 (ADR 0003)
  ├─ removal-grouping.ts               # ADR 0003 (assignCreditBatchToRemoval)
  ├─ ghg-statements.ts                 # Phase 4.5 (ADR 0004)
  ├─ project-emissions.ts              # ADR 0005 journal/drift actions
  ├─ sources-transfer.ts               # evidence mirroring
  ├─ submit-telemetry.ts               # ADR 0006 telemetry upload
  ├─ shared.ts
  └─ index.ts

src/hooks/use-certification.ts         # all React Query hooks
src/schemas/certification.ts           # all Zod schemas
src/components/certification/          # all UI: facility section + dialog,
                                       #   certify-panel (read-only bridge),
                                       #   certification-settings,
                                       #   submission-status-badge, sync-event-log,
                                       #   removals-list, ghg-statements-list,
                                       #   ghg-statement-create-drawer + submit-dialog,
                                       #   new-removal-dialog/
src/app/(app)/certification/           # route group: root redirect + removals +
                                       #   ghg-statements + settings
```

**Reused, do not touch:** `src/data-access/isometric.ts` +
`src/fn/isometric.ts` are owned by the sampling/compliance code
(Method A/B + protocol-condition validators) — new work goes into
`certification.*`.

## Idempotency design

Every outbound POST follows this pattern. `certificationSubmissions`
is the lock + ledger; `certifierSyncEvents` is the append-only attempt
log.

```text
1. Compute payloadHash = sha256(canonicalJson(payload))
2. SELECT FROM certification_submissions WHERE
     localEntityType=? AND localEntityId=? AND submissionType=?
   ORDER BY version DESC LIMIT 1
3. decideSubmissionClaim(...) returns one of:
   a. create-new-version           — INSERT version=N+1, status='draft',
                                     lockedAt=now(), payloadHash. POST.
                                     On 2xx: UPDATE externalId+submitted.
                                     On 5xx/network: leave row locked.
   b. resume                       — Stale lock + matching hash. Try
                                     GET-by-supplier-reference-id; if
                                     found, claim; else re-POST.
   c. return-existing              — Matched hash + 'submitted'/'accepted';
                                     no-op, return externalId.
   d. blocked-in-flight            — Fresh lock; reject.
   e. blocked-rejected-with-external — Manual resubmit required.
   f. invalid-changed-hash         — Hash drift on a non-terminal row.
```

The `payloadHash` covers source data + resolved inputs, **not**
membership-only identifiers — a pure membership change (e.g. grouping a
batch in/out of a Removal) must not POST a duplicate Isometric Removal.

Test coverage: `tests/isometric-submission-claim.test.ts` (18 cases —
full decision matrix).

## Env vars

All three are **optional** so unrelated app boot is unaffected. Client
throws `IsometricApiError('not configured')` at call time if missing.

```ts
ISOMETRIC_CLIENT_SECRET: z.preprocess(emptyToUndefined,
  z.string().min(1).optional()),
ISOMETRIC_ACCESS_TOKEN:  z.preprocess(emptyToUndefined,
  z.string().min(1).optional()),
ISOMETRIC_ENVIRONMENT:   z.enum(['sandbox', 'production']).optional()
  .default('sandbox'),
```

`ISOMETRIC_PROJECT_ID` and `ISOMETRIC_BIOCHAR_REMOVAL_TEMPLATE_ID` are
**not** env vars — they are per-facility values held in
`certifierProjects.externalProjectId` and
`certifierProjects.defaultRemovalTemplateId`.

## Migration ledger

| # | Migration | Phase | Class | Effect |
|---|---|---|---|---|
| 0015 | `flimsy_arachne` | 0 | additive | `certifier_projects.default_removal_template_id` |
| 0016 | `panoramic_selene` | 1 | constraint drop | Drop `certifier_projects_provider_external_unique` (allow N facilities → 1 project) |
| 0017 | `glorious_night_thrasher` | 4 | additive | `certifier_ghg_periods` table (ADR 0002 model) |
| 0018 | `hesitant_nico_minoru` | storage | additive + constraints | `documents` v2 storage columns + check constraints |
| 0019 | `magical_menace` | 3.7 | additive | `certifier_projects` emission-estimate columns |
| 0020 | `noisy_rocket_raccoon` | 3 | index | `production_runs(facility_id)` |
| 0021 | `careless_prism` | ADR 0003 | **destructive** | `DROP TABLE certifier_ghg_periods CASCADE` — see Pre-deploy gates |
| 0022 | `bizarre_infant_terrible` | ADR 0003 | additive | `certifier_removals` table + `credit_batches.removal_id` |
| 0023 | `ambiguous_scarlet_spider` | 4.5 | additive | `certifier_ghg_statements` table + `certifier_removals.ghg_statement_id` |
| 0024 | `long_red_skull` | 4.5 | index | `certifier_removals(ghg_statement_id)` |
| 0025 | `lyrical_silver_sable` | 4.5 | unique | `certifier_ghg_statements_facility_period_unique(provider,facility_id,reporting_period_end_on)` |
| 0026 | `spicy_nextwave` | 4.5 | index + check | `certifier_removals(facility_id)`, `credit_batches(removal_id)`, removal date chronology |
| 0027 | `fluffy_chamber` | 3.7-period | additive | `certifier_project_emissions` table + `project_emission_category` pgEnum (ADR 0005) |
| 0028 | `demonic_harpoon` | docs upload onDelete | constraint change | `certifier_project_emissions.source_document_id` FK `ON DELETE SET NULL` (no schema-shape change) |
| 0029 | `heavy_umar` | 5 (Slice A) | additive | `certifier_sensors` table + `certifier_projects.external_facility_id` column (ADR 0006); no destructive ops |
| 0030 | `nappy_omega_sentinel` | 5 (Slice A) | constraint change | Sensor uniqueness includes provider. |
| 0031 | `lean_kronos` | certification / inventory | additive + nullable changes | Product-bin formulation metadata, nullable batch certifier, storage-location formulation linkage. |
| 0032 | `steady_warstar` | credits | constraint drop | Dropped premature durability constraints from `credit_batches`; readiness handles missing evidence. |
| 0033 | `brief_frank_castle` | transport | destructive + additive | Distance-only transport-leg model, derived legs, supplier/customer distance defaults. |
| 0034 | `peaceful_firebird` | transport readiness | destructive enum change | Transport legs attach to feedstock, biochar, or sample; delivery legs removed. |
| 0035 | `deterministic_product_bin_formulation` | inventory | data fix | Deterministic product-bin formulation backfill. |
| 0036 | `cultured_rattler` | readiness / performance | index + constraint | Reading and transport-leg indexes; nullable Isometric-only batch certifier constraint. |
| 0037 | `sour_lethal_legion` | schema slim-down | destructive cleanup | Dropped unused protocol-stub tables, removed `certifier_sources`, and removed legacy starter `projects` / `items` tables. |

## Operational health

**`.github/workflows/isometric-health.yml`** — daily 09:17 UTC sandbox
ping running `pnpm test:integration`. Hits three read endpoints:
`GET /projects`, `GET /projects/{id}/removal_templates`,
`GET /component_blueprints`. No writes, no noma DB, no app boot —
catches upstream regressions (auth, schema drift, downtime) before
users see a submit failure.

Required repo secrets (Settings → Secrets and variables → Actions):

- `ISOMETRIC_CLIENT_SECRET`
- `ISOMETRIC_ACCESS_TOKEN`
- `ISOMETRIC_DEMO_PROJECT_ID`

Missing any → workflow runs and self-skips via
`RUN_ISOMETRIC_SANDBOX_TESTS=1` gate in
`tests/isometric-sandbox.integration.test.ts`.

## Template-evolution strategy

How noma stays consistent as Isometric templates, blueprints, and
generated types drift. All four checks share `isometric-health.yml`'s
daily 09:17 UTC ping (no PR gate) — Posture B from
[ADR 0005](../adr/0005-period-emissions-as-project-components.md) makes
the consequence of mapping drift bounded, so submit-time + scope-conflict
errors are the safety net and CI is the early warning.

### B1 — Coverage check (`pnpm isometric:coverage-check`)

Asserts, for every facility's `defaultRemovalTemplateId`:

- Every `(group, blueprint, input)` tuple referenced by the live template
  is **either** present in `INPUT_MAPPING` (with matching `quantity_kind`
  + `compatible_unit`) **or** in the new `PERIOD_INPUT_TUPLES` sentinel
  set (in which case the template is wrong by construction per ADR 0005).
- Every `getProject().components` component-of-scope-`PROJECT` has a
  matching `/admin/emission-estimates` row (the Posture B drift panel,
  run headless).

Runs as a step in `isometric-health.yml` and as a standalone `pnpm`
script. Live API only — no committed fixture. Fail-loud (CI red) on any
miss, naming the exact tuple or component id.

### B2 — Generated types staleness

Adds a step to `isometric-health.yml` that runs `openapi-typescript`
against the pinned Certify spec URL and `git diff --exit-code
src/lib/isometric/generated/certify.d.ts`. Fail-loud on drift; the fix
is local regen + commit (no auto-PR bot — those rot). Spec URL pinned in
the workflow env so any upstream URL change is itself a diff.

### B3 — Mapping revision audit trail

Every outbound POST embeds `__mappingRevision` in
`certification_submissions.payloadSnapshot` (no migration; existing JSONB
column). Value is `sha256(canonicalJson(INPUT_MAPPING))` computed once at
process boot, reusing the existing `payload-hash.ts` utility. Surfaced
in `certifier_sync_events.responsePayload.mapping_revision` for every
`removal:submit:*` event so an Isometric-side issue correlates to the
specific noma mapping revision in git history. REMOVAL-scope only —
PROJECT-scope components are not noma-originated under Posture B.

### B4 — Mapping-version dimension (deferred)

`INPUT_MAPPING` stays a 3-tuple `(group, blueprint, input)`. The Certify
OpenAPI surface today does not expose any `blueprint_version` field;
versioned blueprints don't have a Certify representation to model
against. If versioning lands later, the 4-tuple vs branch-on-unit
question reopens then with concrete examples. Tracked under
`isometric/mapping-version-dimension` in `docs/open-questions.md`.

## Reuse what already exists

These files dictate the design — every implementer should know they
exist before adding a parallel surface:

- **`src/db/schema/certification.ts`** — the full certification
  persistence model lives here:
  - `certifierProjects` (facility-scoped, provider-aware project
    registration with `externalProjectId`, `protocolSlug`,
    `protocolVersion`, optional `webhookSecret`, JSONB `metadata`,
    `defaultRemovalTemplateId`, emission-estimate columns).
  - `certifierSensors` (reactor measurement-property to external sensor
    mapping).
  - `certifierProjectEmissions` (period-emission journal rows for ADR 0005).
  - `certifierDocumentUploads`, `certifierSyncEvents`.
  - `certificationSubmissions` — has everything for safe idempotency:
    `submissionType`, `localEntityType/Id`, `externalId`, `version`,
    `status`, `payloadSnapshot`, `payloadHash`, `lockedAt`,
    `supersededAt`.
  - `certifierRemovals` (ADR 0003) and `certifierGhgStatements`
    (ADR 0004).
- **`src/data-access/chain-of-custody.ts`** —
  `getApplicationLineage()` resolves the full chain with the correct
  branching (`delivery.biocharProductId ?? order.biocharProductId`;
  nullable `linkedProductionRunId`; possibly-empty feedstocks). Each
  branch emits a warning. **Submission consumes this result; it does
  not re-derive.**
- **`src/fn/with-action.ts`** — `withAction(fn)` is the canonical
  server-action wrapper. All new server actions must use it. Use
  `SafeError` (not plain `Error`) for user-visible messages.
- **`src/components/ui/entity-side-sheet/index.tsx`** —
  `viewModeChildren` mounts append content under sections in view
  mode. The credit-batch and facility Certify panels both ride this
  slot; no new detail route is needed.
- **`src/lib/certification/entity-readiness.ts`** and
  **`src/lib/certification/batch-health.ts`** — client-safe readiness
  classifiers used by badges, batch health panels, and the New-Removal
  wizard.

## What to deliberately NOT do

- **No fake-ID stubs.** If an endpoint isn't wired, the submit button
  stays disabled. (The varuna prototype's stubbed-IDs path is the
  cautionary tale.)
- **No hand-written types.** Generate from OpenAPI; commit the
  generated `.d.ts`.
- **No new sync tables.** `certificationSubmissions` +
  `certifierSyncEvents` are the source of truth.
- **No global `ISOMETRIC_PROJECT_ID` env var.** Project linkage is
  per-facility, in `certifierProjects`.
- **No required env vars for Isometric credentials** — keep them
  optional so unrelated app boot is unaffected.
- **No re-deriving lineage.** Always go through
  `getApplicationLineage()`.
- **No new files at `src/data-access/isometric.ts` or
  `src/fn/isometric.ts`** — those names are owned by the sampling /
  compliance code. Use `certification.*`.
- **No invented credit-batch / facility detail routes** — the existing
  side-sheet view mode is the surface.
- **No "skip if external ID exists" idempotency.** That leaves a
  corruption window. Use the lock + payload-hash + reconciliation
  flow.
- **No `fixed_constants` DB table or admin UI for emission factors.**
  Fixed constants are policy-level, maintained Isometric-side via
  template bindings.
- **No `submitCreditBatch` awareness of fixed constants.** They are
  consumed Certify-side from the template binding; they do not flow
  through noma's payload.
- **No auto-binding on the template via API.** Certify has no
  template-mutation endpoint by design — templates are author-time
  artefacts.
- **No extending `FIXED_CONSTANT_DEFAULTS` to monitored inputs.**
  Monitored inputs flow through `INPUT_MAPPING` and the aggregation
  pipeline; they are conceptually different.

## Deferred / next phases

- ~~**Phase 3.5 — sources upload.**~~ ✅ Shipped (see Phase status row).
- **Phase 5 Slice A — biochar reactor time-series via Parquet** (scoped
  2026-05-29). DataUploadSubmission of
  `biochar_pyrolysis_reactor_facility_time_series`. Design locked; see
  Phase 5 row above and [ADR 0006](../adr/0006-data-upload-submission-idempotency.md).
  Slices B (biochar_applications) and C (MonitoringSubmission) remain
  open in `docs/open-questions.md`. The webhook receiver is still
  pending Isometric publishing a contract. Carryover items in
  `docs/open-questions.md` continue to belong to Phase 5 broadly:
  external GHG amendment claiming, hash-changed partial-orphan cleanup.
- **Phase 6 — protocol/SOP surfacing.** Resolved as outbound links to
  authoritative pages; revisit only if operators report tab-switching
  friction.

## Pointers

- **What changed when:** `docs/isometric/changes.md`
- **Open design questions:** `docs/open-questions.md`
- **Sandbox template authoring:** `docs/isometric/sandbox-template-authoring.md`
- **OpenAPI surface inventory:** `docs/isometric/openapi-index.md`
- **Refresh workflow when Isometric versions bump:**
  `docs/isometric/update-playbook.md`
- **Requirements & schema mapping:** `docs/isometric/README.md`
  (the requirements KB index)
