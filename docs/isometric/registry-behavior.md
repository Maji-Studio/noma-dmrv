# Isometric registry behavior

Read this before debugging evidence links, reconciliation or API drift. These
are dated observations with limited scope, not protocol authority. Code was
checked against staging `5eb7aa111` on 2026-10-30. Direct sandbox reads and public
registry sources were also checked; authenticated MCP access was unavailable.
The [verification record](../archive/2026-10-30-isometric-verification.md) records
request variations, results and limits. Historical observations keep their dates.

## Environment and authority

- Sandbox project: `prj_1K9YJ33RKSBX9FFF`. Direct reads on 2026-10-30 confirmed
  visibility with local `.env.local` sandbox credentials. The handoff records
  that the MCP GraphQL account saw production only; that account view was not rechecked. A missing MCP result does not prove sandbox
  absence. Confirm the account and environment before interpreting an empty list.
- Call official MCP `how_to` before registry/protocol work, then use its relevant
  docs/schema tools. Sandbox GraphQL introspection is disabled confirmed by direct reads on
  2026-10-30; the historical MCP workflow uses `graphql_analyze_type` for schema information.
- Protocol/module pins are historical observations in [versions.json](./versions.json).
  `GET /projects` supplies no protocol version in the committed REST contract.
  Do not infer a new pin from component support or a successful submission.

## Application Source readback

| Observation | Evidence date and limit | Consequence |
|---|---|---|
| REST accepts Application `source_ids` but omits them on create and GET | Create acceptance: 2026-10-19; GET omission rechecked 2026-10-30 | Omitted REST data is not proof of attachment or absence |
| GraphQL `biocharSpreadEventSources` reads the Application Source links; REST `bse_...` is the event ID | Readback and identity rechecked 2026-10-30 | Compare the exact returned event ID and Source set |
| GraphQL authentication behavior changed from the historical report: Bearer alone returned events in the direct probe; secret alone returned `ObjectNotFoundError`, both HTTP 200 | 2026-10-30 direct read; older 2026-10-19 report said missing secret returned 401 | Keep both configured headers; inspect GraphQL data/errors, not HTTP status alone |
| `BiocharSpreadEventFilter.idIn` is ignored, including inline literals and a fabricated ID | Direct sandbox reads, 2026-10-30; inline and variable cases | Never treat the first returned event as the requested event, or an ID filter as proof of identity |
| `storageLocationId` narrows results; the root has no `node(id:)` lookup | Direct sandbox reads, 2026-10-30 | Narrow by location, paginate as needed and match the exact event ID locally |

The older "verified query" in [API index](./openapi-index.md#graphql-evidence-read-outside-openapi)
and the open-question query proved Source readback, **not that `idIn` filters**.
Their historical authentication statement is also superseded by the scoped
probe above. Those sections are reserved for the separate `fix/application-readback-match-by-id`
change and must be reconciled after it merges. The full evidence-bearing Removal
submission on staging remains an open retest. Do not mark that retest complete
from an isolated GraphQL probe.

The implementation owner is
`src/lib/isometric/biochar-application-source-readback.ts`; orchestration and
mismatch persistence are in
`src/fn/certification/biochar-application-source-readback.ts`.

## Source PATCH and failure visibility

The 2026-10-30 investigation recorded Datapoint Source PATCH as **full-list
replacement**, not append. PR [#1510](https://github.com/Maji-Studio/noma-dmrv/pull/1510)
implements GET, skip-if-present, then sorted-union PATCH in
`src/fn/certification/durability-measurement-samples.ts`. Retry the idempotent
union without dropping existing Sources. This code behavior was checked during
the cleanup; the provider semantics were not probed again.

That investigation found PATCH 429 responses in `vercel logs --level error`
while sync events showed none. An empty sync-event failure list therefore does
not rule out a boundary failure. Inspect server errors as well; never include
credentials or PII in saved evidence. This is a historical incident observation,
not a claim that every 429 is absent from sync events.

## Reconciliation limits

The committed clients encode these bounds, checked 2026-10-30:

| Resource | Search scope and bound | Owner under `src/lib/isometric/` |
|---|---|---|
| Storage Locations | Project-scoped list, up to 1,000 records | `storage-locations.ts` |
| Biochar Applications | Account-visible list, up to 1,000 records | `biochar-applications.ts` |
| Other paginated reads | Default up to 10,000 records | `client.ts` |

The first two have no supplier-reference filter in the committed API. Exceeding
a bound fails closed rather than risking duplicate creation. Production Batch
and measurement-sample reconciliation/deletion can hit the client default.
An auth/network failure never establishes a missing record.

## Recording a new quirk

Record the exact environment/account scope, date, request variation and observed
response. Distinguish a code check, isolated registry probe and full submission
retest. Keep credentials and raw operator data out of docs. Link the owning code
and unresolved follow-up; replace a superseded observation explicitly rather
than silently widening its claim.
