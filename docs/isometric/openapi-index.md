# Isometric Certify API index

Use this to find the owning wrapper and its application consumer, not as API
authority. The committed contract is `src/lib/isometric/generated/certify.d.ts`.
Code checked 2026-10-30. Before trusting live behavior, read the dated
[registry observations](./registry-behavior.md), especially the GraphQL filter
correction that supersedes the old query assumption below.

## Code lookup

Wrapper paths below are relative to `src/lib/isometric/`; consumer paths are
relative to `src/fn/certification/`. A wrapper's presence alone does not prove
that an operation is invoked by the app.

| Resource | Wrapper | Application consumer and boundary |
|---|---|---|
| Projects, templates, blueprints | `projects.ts` | `facility-mapping.ts`, `certify-context-core.ts`; read/select/validate |
| Feedstock catalog | `feedstock-types.ts` | `feedstock-types.ts`; read only |
| Datapoints, Components, GHG Entries and attributions | `submissions.ts` | `submit-removal.ts`, `durability-measurement-samples.ts`, `removal-breakdown.ts`; Source verification in `src/lib/isometric/source-binding-verification.ts` |
| GHG Statements | `ghg-statements.ts` | `ghg-statements.ts`, `ghg-statement-reconciliation.ts`, `ghg-statement-reports.ts`; discover/create/read/submit/resubmit |
| Sources and signed uploads | `sources.ts` | `sources.ts`, `sources-transfer.ts`; reconcile/create/upload |
| Measurement samples | `measurement-samples.ts` | `durability-measurement-samples.ts`; sampled 1,000-year sandbox creation; exact lookup also supports deletion |
| Production Batches | `production-batches.ts` | `production-batches.ts`; list/create/read/reconcile |
| Storage Locations | `storage-locations.ts` | `storage-locations.ts`, `storage-location-actions.ts`; project-scoped list/create/read/recover |
| Biochar Applications | `biochar-applications.ts` | `biochar-applications.ts`; list/create/read/reconcile per immutable slice |
| Registry cleanup | The resource wrappers above | `delete-removal.ts`; GHG Entry first, then Applications, measurements, unshared batches and released Sources |

Noma uses `/ghg_entries`, not the deprecated `/removals` aliases still present in
the committed types. Measurement lookup scans the list; there is no committed
single-measurement GET or supplier-reference filter. Storage Location and
Application reconciliation are bounded; see [registry behavior](./registry-behavior.md).

Source visibility is an organization policy applied at creation. Changing it
does not rewrite remote Sources. Live immutable snapshot references retain
Sources; Removal deletion can delete released, unshared ones. The historical
2026-09-10 probe recorded irreversible Source deletion and refusal while locked
Datapoints or a verified statement use the Source. Failed cleanup is audited.

Datapoint Source PATCH is a full-list replacement. The durability path GETs the
current set, skips when all intended IDs exist, otherwise PATCHes the sorted
union. Preserve this when changing retry behavior; see
`durability-measurement-samples.ts` and [registry behavior](./registry-behavior.md).

## GraphQL evidence read (outside OpenAPI)

`POST /graphql` at the Certify origin is wired through
`src/lib/isometric/biochar-application-source-readback.ts:readBiocharApplicationSources`,
consumed by `src/fn/certification/biochar-application-source-readback.ts` on
submission and Removal summary refresh. It reads
`project.biocharSpreadEvents(first: 50, after: $after, filter: { idIn: $ids, storageLocationId: $storageLocationId })`
with `nodes { id biocharSpreadEventSources { source { id } } }` and
`pageInfo { hasNextPage endCursor }`. Variables include the requested Application
id in `ids` and its registered external Storage Location id in `storageLocationId`.
Verified on the sandbox (2026-10-30): `BiocharSpreadEventFilter.idIn` is ignored,
`storageLocationId` narrows correctly, and the root has no `node(id:)` field.
The client matches the node by id and follows cursors when absent, up to 10 pages.
Duplicate matching ids are garbled; no match within that bound stays unconfirmed.
Verified on the sandbox (2026-10-19): both Certify authentication headers are
required, the REST Biochar Application id (`bse_...`) is the
`BiocharSpreadEvent.id`, and the Source list matches the `source_ids` sent on
create. This call is not generated from REST types; see
[open questions](../open-questions-isometric.md).

## Unwired boundaries

Generated types include APIs that the app does not use: reactor sensors and
bulk time series, monitoring submissions, storage units, feedstock batches,
measurement locations, standalone Component/attribution mutations, Datapoint
deletion/reverse lookups, Source updates/private URLs and other resource deletes.
`POST /components` has a wrapper but no non-test consumer. Storage Location PATCH
and Application corrections are also unwired. The issued-credit Registry API
has no parallel committed client.

## Refresh

1. Run `pnpm regenerate-certify-types` and inspect the generated diff.
2. Find HTTP calls and their non-test consumers:

   ```bash
   rg -n 'client\.(get|post|patch|delete)|client\.paginate(All)?|findRegistryRecord' src/lib/isometric src/fn/certification
   ```

3. Check live template compatibility with
   `pnpm isometric:coverage-check -- --source=fixture`.
4. Update this index for committed code only. Record external observations,
   environment, date and verification limits in [registry behavior](./registry-behavior.md).

The drift workflow is `.github/workflows/isometric-health.yml`; the schema URL
and version refresh process are owned by [update playbook](./update-playbook.md).
