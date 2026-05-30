# Isometric Update Playbook

> This process produces non-authoritative summaries. Registry sources remain authoritative.

## Goal
Refresh local Isometric requirements docs with minimal tokens while preserving source traceability.

## 1) Check Latest Certified Versions
1. Use Isometric MCP `protocols_get_metadata` for pinned protocol/module slugs.
2. Confirm `status = CERTIFIED` and capture:
   - minor version
   - latest certified patch in that minor
   - published/certified dates
   - authoritative URL
3. If repo policy pins a specific minor version, keep that minor and only move patch if allowed.

### Regenerate the Certify TypeScript surface

If the OpenAPI spec changed (the daily `isometric-health.yml` workflow
fails on its `Detect Certify OpenAPI drift` step), run the regen
locally and commit the diff:

```bash
ISOMETRIC_OPENAPI_URL=https://api.isometric.com/openapi.json pnpm regenerate-certify-types
git diff src/lib/isometric/generated/certify.d.ts
git add src/lib/isometric/generated/certify.d.ts && git commit -m "chore: regenerate Certify OpenAPI types"
```

The URL is pinned in `package.json`'s `regenerate-certify-types` script
(default `https://api.isometric.com/openapi.json`) and in the workflow
env (`ISOMETRIC_OPENAPI_URL`). Override locally only if testing against
a non-default spec.

## 2) Re-run Requirement Extraction
1. Use `protocols_analyze` per protocol/module with targeted prompts by domain:
   - feedstock
   - production
   - storage/application
   - energy
   - transportation
   - credits/verification
   - evidence/chain of custody
2. For any weak/ambiguous result, call `protocols_get_content`.
3. If `protocols_get_content` is paginated, fetch all pages before summarizing.

## 3) Diff Old vs New Requirements
1. Compare extracted references (section IDs, equations, thresholds, cadences) to current shortlist.
2. Mark changes as:
   - added requirement
   - removed requirement
   - threshold/formula change
   - evidence/cadence change
3. Use `git diff docs/isometric/requirements-shortlist.md docs/isometric/schema-mapping.md`.

## 4) Update `versions.json` and Shortlist
1. Update `docs/isometric/versions.json` first.
2. Update source URLs to tagged authoritative URLs.
3. Refresh `requirements-shortlist.md` rows with changed fields only (keep concise).
4. Preserve the non-authoritative warning.

## 5) Refresh Schema Mapping
1. Re-scan `src/db/schema/*`.
2. Update `schema-mapping.md` coverage status (`full`, `partial`, `missing`).
3. Re-rank priorities (`P0/P1/P2`) by crediting risk and implementation impact.

## 6) Record Change Log
1. Add an entry to `docs/isometric/changes.md`:
   - date
   - old -> new versions
   - requirements changed
   - top gap changes

## PR Checklist (Protocol/Module Bump)
- `versions.json` updated first and accurately.
- Every shortlist row has section/reference + authoritative URL.
- Non-authoritative interpretation warning remains present.
- `schema-mapping.md` updated with current table/column references.
- Top priority gaps revalidated.
- `changes.md` appended.
- No database schema changes included in this docs-only update.
- If the bump changes schema, validation, or workflow behavior in the app, run `pnpm test:e2e` and keep the relevant Playwright paths green before merge.

## Quick Refresh Checklist (8 steps)
1. Pull metadata for pinned slugs.
2. Update `versions.json`.
3. Re-run targeted MCP extraction.
4. Resolve ambiguities with full content retrieval.
5. Update shortlist table rows.
6. Update schema mapping and priorities.
7. Append changelog entry.
8. Run `git diff docs/isometric` and open PR.
