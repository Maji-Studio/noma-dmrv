# Phase 6a results

Historical implementation results for the document API phase. Read alongside
[the active data-entry API plan](../plans/2026-10-06-data-entry-api.md).

## 23. Phase 6a results (2026-10-15)

Evidence documents on REST and MCP for feedstocks, deliveries and lab samples,
on `feat/api-documents`. Decisions 87 to 103 record round 10; application API
work remains Phase 6b. [Document contracts](../api.md#documents) and
[storage lifecycle](../storage.md) describe current behavior.

**What shipped, per commit:**

1. Foundations (`f12e7290d`, schema foundation `4904d35d0`): document versions,
   upload keys and leases, deferred queue entries, bounded inspection and
   promotion to server-only content-addressed keys. App request, confirm,
   delete, visibility and reclassification use transaction writers and the
   runner, with submitted-lineage refusal and artifact-first document locks.
   Storage reads and writes stay outside the operation transaction.
1b. Read-only panels (`927baab16`): one per-record certification-lock read for
   delivery, feedstock, sample, application and production evidence panels.
   Downloads remain available while upload, delete, reclassification and retry
   controls hide on a blocking submission.
2. Services (`6bde97647`): API owner/type table, strict SHA-256 declarations,
   representations and ETags, registered upload request, locked lease renewal
   and replay capability minting, plus shared keyless confirmation.
3. Reads (`91b2be410`): nested keyset lists, document detail and private content
   redirects, archived-owner reads, owner and organization checks, OpenAPI.
4. REST writes (`368fc29ed`): six thin request/confirm routes, fresh links on
   replay, UUID paths that recover historical results after owner deletion,
   committed refusals and retryable domain errors in problem responses.
5. MCP (`546b8bb5f`): `find_documents`, `get_document_download_url`,
   `request_document_upload` and `confirm_document_upload`, owner-based tool
   visibility and invocation checks, action/REST/MCP parity and upload guidance
   in the delivery warning. No document delete route, tool or scope.
6. Agent evaluation (`428c0dc66`): `delivery-bol-upload` uses a physical PDF and
   shell PUT, requiring one verified bill of lading with the fixture hash and
   no bytes in MCP arguments. Evaluated sessions receive an allowlisted
   environment; this case has plain Bash and starts in its fixture directory.
   The supervisor recorded 11/11 eval passes before commit 7.
7. Sweep, fuzz and docs: Production cron at 03:15 UTC, bounded expiry and
   failed-row retention, and a timed cross-organization deletion drain. Fuzz
   fixtures give all three owners one physically uploaded and one pending
   document through real writers. Examples cover reads, content redirects,
   fresh upload requests, uploaded repeat confirms and a separately named
   pending-confirm refusal with an unchanged representation and ETag check.

**Decisions made during implementation:**

- The upload declaration lives in `metadata.uploadDeclaration`. Missing bytes
  return retryable `conflict` and leave the row pending. Visibility and
  reclassification remain unregistered app operations. The legacy intake
  shipment owner was subsequently retired (#1013).
- `getRecordCertificationLock` reuses `documentOwnerLineageTargets`; the
  application-only lock read was removed. `certificationKeys.recordLock` is
  invalidated with readiness. Blocking submissions include draft attempts.
  Panels allow interaction while the lock read loads; the server is decisive.
  Deferred attachments carry `retryable`.
- Confirm remains unregistered: both adapters call `confirmDocumentUpload`,
  while the facts-carrying runner operation is private. Overlapping confirms
  emit one audit event using a transition flag. E1 keeps no idempotency record;
  E2 takes no version precondition. Refusals commit state and cleanup first.
- `mintDocumentUploadCapability` handles first requests and replays with one
  signing instant. Renewal takes the row lock, caps the lease at creation plus
  one hour and does not bump the version. Uploaded, failed, deleted, expired,
  archived and submitted records return historical data without a PUT link.
  Stored outcomes include the published file name, never keys or signed URLs.
- `canAccessOwnerDocuments` wraps the existing role/scope check. Pending and
  failed representations expose declared facts. Document representation
  revision lives in `src/config/api-rest.ts`.
- Reads share `documentReadHandler` and org-scoped queries. No conditional GET
  was added. Legacy URL-only rows have null unknown size/type and content 404.
  Tampered cursor-anchor validation remains outside the shared unsigned cursor
  contract; queries stay within the organization and owner.
- Missing request keys return 400 like other creates. UUID retries skip the
  owner lookup; code paths resolve first. Confirmation ignores supplied key
  and If-Match headers. Neither upload command handles a dry run. Removed
  credential owners retain the shared 401 denial.
- Document MCP tools require scope or explicit visibility plus authorization.
  Confirmation alone gets the 25-second budget. API owner type lists constrain
  descriptions and inputs. App refusals use owner-specific field pointers;
  REST/MCP use `/ownerId`, normalized by parity tests.
- The sweep uses 100-row expiry and retention batches, 30-day failed retention
  from `updatedAt`, and a 20-second drain budget with 50-entry queue batches.
  Thirty days preserves time for troubleshooting. Existing queued keys are
  not enqueued again when failed rows retire. Production uses `vercel.json`;
  Preview staging retains request-path drains without a scheduled sweep.
- Final-key inventory cleanup was deferred: the provider has no listing seam,
  and deleting an unreferenced key needs protection against in-flight confirms.

**Verification for commit 7:** 26 offline Python hook tests and four mocked
cron route tests pass. Typecheck passes; lint reports no errors and 13 existing
warnings. OpenAPI regeneration leaves the snapshot unchanged. The supervisor
must run the DB-backed sweep tests, physical seed and fuzz harness.

**Follow-ups:** Phase 6b commit 1 must move application update/delete from
row-before-artifact locking to artifact-first runner transactions, and take
the merged #1021 topology checkpoint. Credit-batch membership ordering needs
its matching fix. Existing feedstock, order and production-run inversions
remain tracked in `data/lock-order`. `storage/orphaned-final-keys` tracks
promotion objects left before a failed transaction; `certification/post-submission-evidence`
tracks a receipt found after submission that currently needs a new record.
Both are in the open-question docs. #942 q14 is settled by decision 95 for 6b;
q10 (order site required) and q27 (price/currency removal) belong to the
#1015/#1012 successor. The 6b balance read must follow the resulting site rule.
After 6a merges, coordinate with noma-dmrv-e8 on `reflectance_histogram`
(#942 q9, PR #1048 follow-up); publishing it for API lab samples needs Kenji's
choice in `API_DOCUMENT_OWNERS`.

