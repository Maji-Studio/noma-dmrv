# Isometric GHG Entry API migration

> **Status: Planned** (2026-06-10). Migrates the Certify wire layer from the
> deprecated removal-named endpoints to the new `ghg_entry` route family
> announced in Isometric's 2026-06-04 API changelog. One breaking change with
> a hard deadline; everything else in that changelog is either a free win we
> can adopt later or does not touch us. Findings verified against the live
> Certify OpenAPI document (62 paths, 187 schemas) and the Isometric MCP on
> 2026-06-10.

## Authoritative source

[Certify API changelog](https://docs.isometric.com/api-reference/certify/api-changelog),
entry **2026-06-04** — "GHG entry API rename released across Certify REST
endpoints":

> "We intend to keep old endpoints functional for a transitional period of
> 3 months (until September 2026), after which they will be removed. We
> recommend that you migrate to the new endpoints as soon as possible to
> ensure uninterrupted functionality."

The live spec corroborates: all 13 removal-named operations carry
`deprecated: true`, and both route families coexist today. (The changelog
page is client-rendered; raw markdown is at the same URL with an `.md`
suffix.)

**Deadline: September 2026.** Until then the migration can land
incrementally with zero downtime.

## What does NOT change (verified)

- **ID formats are unchanged** — templates stay `rvt_`, entries stay `rmv_`,
  statements stay `ggs_`. Every remote ID stored in our DB
  (`certifierProjects.defaultRemovalTemplateId`, ledger `remoteId`s,
  `certifierRemovals`/`certifierGhgStatements` rows) remains valid. No data
  migration.
- **`supplier_reference_id` semantics are identical** in
  `CreateGhgEntryRequest`, so our deterministic recovery flow keeps finding
  previously-created remote objects (old Removals are the same resources,
  retrievable via `/ghg_entries` — sandbox check in Phase 3).
- **`CreateGhgStatementRequest` is unchanged** (`{project_id, end_on}`).
- `listDatapoints` only passes `used_in_scope`, which is not deprecated.

## Wire renames required

| Today | New | Call site |
|---|---|---|
| `POST /removals` | `POST /ghg_entries` | `src/lib/isometric/submissions.ts:33` |
| `GET /removals?supplier_reference_id=` | `GET /ghg_entries?…` | `submissions.ts:61` |
| `GET /projects/{id}/removal_templates` | `…/ghg_entry_templates` | `src/lib/isometric/projects.ts:19` |
| `GET /components?removal_id=` | `?ghg_entry_id=` (new, non-deprecated filter) | `projects.ts:51` (`ListComponentsArgs.removalId`) |
| `removal_template_id` (create payload) | `ghg_entry_template_id` | `src/lib/isometric/transformers/removal.ts:100` |
| `removal_template_components` (create payload) | `ghg_entry_template_components` | `transformers/removal.ts:101` |
| `removal_template_component_id` (component inputs) | `ghg_entry_template_component_id` | `transformers/removal.ts:89` |
| `GhgStatement.removal_ids` (read) | `ghg_entry_ids` (`removal_ids` now `deprecated: true`) | `src/lib/isometric/utils/removal-membership.ts` |
| Types `Removal`, `RemovalTemplate*` | `GhgEntry`, `GhgEntryTemplate*` | `projects.ts`, `transformers/removal.ts`, `transformers/datapoint.ts` |

New response fields we gain for free on migrated calls: templates expose
`credit_type` (`REMOVAL` / `REDUCTION`; ours are `REMOVAL`), entries expose
`credit_type`, `risk_of_reversal_percentage`, `credit_allocation`.

## Full deprecated-surface inventory (live spec, 2026-06-10)

Operations (13 deprecated):

| Surface | Our usage | Decision |
|---|---|---|
| `POST /removals`, `GET /removals` | **Used** (`submissions.ts:33,61`) | Migrate (Phase 2) |
| `GET /projects/{id}/removal_templates` (+ `/{id}`) | **Used** (`projects.ts:19`) | Migrate (Phase 2) |
| `GET/PATCH/DELETE /removals/{id}` | Unused | Unused/deferred — adopt only the `ghg_entries` forms if ever needed |
| `GET/PATCH /removals/{id}/component_attributions` | Unused | Unused/deferred — same rule |
| `POST/DELETE /project_components/…/removal_attributions` | Unused (we never call project-component attribution endpoints) | Unused/deferred — same rule |
| `GET /datapoints/{id}/removal_template_components` | Unused | Unused/deferred |
| `GET /processes` | Unused | None |

Query parameters (3 deprecated): `GET /components ?removal_id` — **used**,
migrate; `GET /datapoints ?used_in_removal` / `?used_in_removal_template` —
unused.

Schema properties (10 deprecated): **used** — `GhgStatement.removal_ids`
(read) and `RemovalTemplateComponentInputs.removal_template_component_id`
(written); both in the rename table above. Unused — `CreateRemovalRequest.
process_key`/`steps`, `Component.removal_template_component_id`,
`ComponentAttribution.removal_id`/`.removal_template_component_id`,
`AddComponentToRemoval.process_step_key`, `PatchRemovalRequest.
add_components`/`delete_component_ids`,
`UpdateProjectComponentRemovalAttributionRequest.
attribution_factor_datapoint_id`. (`utils/aggregation.ts`'s
`removalTemplateComponentId` is internal naming fed from the template, not
parsed from the deprecated response fields.)

## Broken type-regen pipeline (fix first)

`package.json` → `regenerate-certify-types` defaults to
`https://api.isometric.com/openapi.json`, which now serves Isometric's
**internal** FastAPI spec (14 paths, no Certify routes). The checked-in
`src/lib/isometric/generated/certify.d.ts` predates 2026-06-04 (zero
`ghg_entry` occurrences). The correct Certify spec URL:

```
https://docs.isometric.com/api-reference/certify/mrv.openapi.json
```

Stale references to fix: `package.json:38`,
`docs/isometric/update-playbook.md:24,30-31`, and any CI workflow env
setting `ISOMETRIC_OPENAPI_URL`.

## Internal naming decision

"Removal" appears in ~50 files across every layer plus the DB
(`certifier_removals`, `credit_batches.removal_id`, ledger entity/submission
type `'removal'` in `src/lib/isometric/utils/constants.ts`,
`defaultRemovalTemplateId`).

**Decision: wire-only rename.** Isometric renamed to generalize for
*reduction* credits; our templates are `credit_type: REMOVAL`, so "removal"
remains the correct domain word for what we produce. The `src/lib/isometric/`
boundary adopts the API's `ghg_entry` vocabulary (file renames included,
e.g. `transformers/removal.ts` → `transformers/ghg-entry.ts`,
`utils/removal-membership.ts` → `utils/ghg-entry-membership.ts`); app-layer
and DB naming stay "Removal". The ledger keys (`'removal'`) are **our**
identifiers, not wire values — they do not change (changing them would
orphan existing ledger rows for no benefit).

Rejected alternative: full domain rename. Cheap now (no prod data —
reseed-not-migrate policy) but "GHG entry" is a worse name for a
biochar-only product UI, and it churns 50 files + 2 tables + scripts for no
behavioral gain. Revisit only if we ever submit `REDUCTION`-type entries.

## Phases

### Phase 1 — regen pipeline

1. Point `regenerate-certify-types` at the docs-hosted spec URL; update
   `docs/isometric/update-playbook.md` and CI env.
2. Regenerate `certify.d.ts` — brings in `GhgEntry*` schemas and the new
   `ghg_entries` paths while keeping legacy types for the transition.

### Phase 2 — wire-layer rename

1. `submissions.ts` — `POST /ghg_entries`, supplier-ref lookup on
   `/ghg_entries`; rename wrappers (`createRemoval` → `createGhgEntry`,
   `findRemovalBySupplierRef` → `findGhgEntryBySupplierRef`) with the
   payload typed as `CreateGhgEntryRequest`.
2. `projects.ts` — `ghg_entry_templates` route, `GhgEntryTemplate` types,
   `?ghg_entry_id` component filter; assert/log `credit_type === "REMOVAL"`
   when listing templates.
3. `transformers/removal.ts` → `transformers/ghg-entry.ts` — emit
   `ghg_entry_template_id` / `ghg_entry_template_components` /
   `ghg_entry_template_component_id`; `transformers/datapoint.ts` switches
   to `GhgEntryTemplateComponentInput*` types.
4. `utils/removal-membership.ts` — read `ghg_entry_ids` (no fallback needed;
   the field is required in the schema).
5. Update barrel exports + the contract-pinning unit tests
   (`tests/isometric-submit-removal.test.ts`, sources tests) to the new
   payload field names. `scripts/isometric-coverage-check.ts` follows the
   renamed exports.

### Phase 3 — verification

`pnpm test:integration` **does not cover this** as-is: the sandbox suite
(`tests/isometric-sandbox.integration.test.ts`) scopes out write paths and
only reads projects / templates / blueprints. Add:

1. **Fetch-mocked unit test** for `findGhgEntryBySupplierRef` asserting the
   exact `/ghg_entries` path + `supplier_reference_id` query param (style of
   `src/lib/isometric/links.test.ts`; runs in default `pnpm test`).
2. **Sandbox read tests**: migrate the existing `lists removal templates`
   test to `ghg_entry_templates` (assert `credit_type` present); add a
   `GET /ghg_entries` list test asserting `rmv_` ID shape; env-gated
   supplier-ref lookup of a known pre-rename sandbox Removal to prove old
   objects resolve through the new route.
3. One manual sandbox submit of a draft entry end-to-end before relying on
   the new write path in production.

### Phase 4 — docs hygiene

1. Re-pull `docs/isometric/openapi-index.md` and carry the
   used / unused / deferred markings from the inventory above.
2. Append a dated entry to `docs/isometric/changes.md` citing the changelog
   URL (local summaries are non-authoritative).
3. Track the September 2026 sunset in `docs/open-questions.md` until Phases
   1–3 land; resolve by recording the decision in `changes.md`.

### Follow-ups (separate PRs, not blocking)

- **Credit allocation / buffer pool** — entries and statements now expose
  `risk_of_reversal_percentage` + `credit_allocation`
  (`buffer_pool_contribution_kg` / `supplier_allocation_kg`). We capture
  neither; surfacing the split on the certify panel / credit-batch detail is
  a new capability.
- **Reporting period readback** — `GhgStatement.reporting_period_start_at` /
  `_end_at` are now returned; reading them back fixes the known
  reconciliation gap where the statement wizard's "predicted to be linked"
  preview over-promises against the server-derived period.
- **Source `description`** — optional human-readable label on
  `POST /sources`.
- Measurement-sample changelog items (DELETE endpoint, `feedstock_batch_id`,
  datapoint filters): N/A — we do not use the measurement-samples API.

## Out of scope

- Renaming app-layer / DB / ledger "removal" naming (see decision above).
- Adopting any deferred endpoint marked unused in the inventory.
