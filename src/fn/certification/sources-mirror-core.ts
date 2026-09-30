/**
 * Trusted-context core for mirroring noma documents to Isometric Sources.
 *
 * Directive-free on purpose: every export takes an already resolved
 * `OrgContext`, so it must never be exported from a `"use server"` module,
 * where Next.js would make it a public action accepting a forged context.
 * The session-authenticated action is `mirrorDocumentToSource` in
 * `./sources`; the submit pipeline and the evidence-ledger generator call this
 * module directly.
 *
 * The Source candidate (its binding and lineage label, which become the
 * Source description) is always derived here from server state: the live
 * lineage walk for a single document, or the submission context's candidate
 * set for the submission mirror. No caller can hand in a candidate tuple.
 */
import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import { acquireMirrorLock } from "@/lib/isometric/utils/source-lock";
import {
  getCertifierProjectByFacility,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import {
  getDocumentUploadByDocument,
  insertOrGetDocumentUpload,
  listDocumentUploadsForDocuments,
  type DocumentUploadMetadata,
} from "@/data-access/certifier-document-uploads";
import { getLatestSubmissionWithExecutor } from "@/data-access/certification-submissions";
import { getRegistrySourceVisibility } from "@/data-access/certifier-organization-settings";
import { getCertifierRemovalById } from "@/data-access/certifier-removals";
import { getDocumentById } from "@/data-access/documents";
import { SafeError } from "@/lib/errors";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import {
  buildSourceSupplierRef,
  createSource,
  findSourceBySupplierRef,
  getIsometricClientForOrg,
  requestSignedUploadUrl,
} from "@/lib/isometric";
import { getStorageProvider } from "@/lib/storage";
import {
  buildRemovalSourceDescription,
  type ClassifiedRemovalSource,
} from "@/lib/certification/removal-source-bindings";
import {
  SOURCES_MAX_BYTES,
  type MirrorDocumentToSourceInput,
} from "@/schemas/certification-sources";
import {
  buildSourceRequestBody,
  downloadDocumentBlob,
  putBlobToSignedUrl,
} from "./sources-transfer";
import {
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";
import { withSourceSyncEventOnFailure } from "./source-sync-events";
import { withStagedSyncEvents } from "./sync-event-stage";
import {
  loadCandidateDocumentsForRemovalForUser,
  type CandidateDocument,
  type CandidateDocumentsForRemoval,
} from "./source-candidates";
import {
  collectSubmissionSourceCandidates,
  type SubmissionSourceCandidateContext,
} from "./removal-source-freeze";

const BYTES_PER_MEGABYTE = 1_000_000;
const DOCUMENT_NOT_AVAILABLE_MESSAGE =
  "This document is not available for this Removal. Reload the panel and try again.";

export interface MirrorResult {
  externalDocumentId: string;
  isPublic: boolean;
  recovered: boolean;
}

/** What the Source description is built from, always derived server-side. */
interface ServerDerivedCandidate {
  binding: ClassifiedRemovalSource | null;
  lineageLabel: string | null;
}

// Source mutations (mirror and unlink) are anchored to a specific
// removal so the server can verify the document actually belongs to that
// removal's lineage. Without this check, any authenticated caller who knows a
// documentId UUID could mutate a Source mirrored under another removal — the
// schema-level `removalId` only documents intent; this is the enforcement.
//
// Returns the loaded candidate set and the matching candidate, whose binding
// and lineage label become the Source description.
async function assertDocumentIsCandidateForRemoval(
  orgCtx: OrgContext,
  removalId: string,
  documentId: string,
): Promise<{
  candidates: CandidateDocumentsForRemoval;
  candidate: CandidateDocument;
}> {
  const candidates = await loadCandidateDocumentsForRemovalForUser(
    orgCtx,
    removalId,
  );
  const found = candidates.candidates.find(
    (candidate) => candidate.document.id === documentId,
  );
  if (!found) {
    // SafeError is intentionally bland — telling the caller "the doc exists
    // but isn't in this removal's lineage" leaks information they don't
    // already have. Match the not-found path's wording.
    throw new SafeError(DOCUMENT_NOT_AVAILABLE_MESSAGE);
  }
  return { candidates, candidate: found };
}

const SOURCE_READ_ONLY_SUBMISSION_STATUSES = new Set<
  CertificationSubmissionRow["status"]
>([
  "submitted",
  "accepted",
  "superseded",
]);

async function assertRemovalSourcesEditable(
  orgCtx: OrgContext,
  removalId: string,
  facilityId: string,
  executor: DbTransaction | typeof db,
): Promise<void> {
  const latest = await getLatestSubmissionWithExecutor(
    orgCtx,
    executor,
    {
      provider: ISOMETRIC_PROVIDER,
      submissionType: REMOVAL_SUBMISSION_TYPE,
      localEntityType: REMOVAL_ENTITY_TYPE,
      localEntityId: removalId,
    },
    facilityId,
  );
  if (
    latest &&
    (SOURCE_READ_ONLY_SUBMISSION_STATUSES.has(latest.status) ||
      isLockedInFlight(latest))
  ) {
    throw new SafeError(
      "Registry value sources are read-only once a Removal is submitted or while submission is in progress. Replace or remove evidence from its owning record before submission.",
    );
  }
}

/**
 * Mirrors one document for an operator. The document must be a live Source
 * candidate for the Removal, and by default the Removal's Sources must still
 * be editable. Only a trusted server caller that owns the submission
 * lifecycle (the evidence-ledger generator) may pass
 * `enforceRemovalLifecycle: false`.
 */
export async function mirrorDocumentToSourceForUser(
  orgCtx: OrgContext,
  parsed: MirrorDocumentToSourceInput,
  options: { enforceRemovalLifecycle?: boolean } = {},
): Promise<MirrorResult> {
  requireOrgRole(orgCtx, "admin");
  const { enforceRemovalLifecycle = true } = options;
  // `assertDocumentIsCandidateForRemoval` walks the same lineage the panel
  // shows. Anchoring the mutation to the removal prevents an authenticated
  // caller from mirroring an arbitrary document UUID.
  const { candidate } = await assertDocumentIsCandidateForRemoval(
    orgCtx,
    parsed.removalId,
    parsed.documentId,
  );
  return mirrorDerivedCandidate(orgCtx, parsed, {
    enforceRemovalLifecycle,
    candidate: {
      binding: candidate.binding,
      lineageLabel: candidate.lineageEntity.entityLabel,
    },
  });
}

/**
 * Ensures every Source candidate the Removal submission owns has a persisted
 * Isometric Source mapping before the Removal snapshot is compiled.
 * Submission is the owning workflow for this transition; operators should not
 * have to mirror files one at a time in the UI.
 *
 * The candidate set is re-derived from the submission context, including the
 * immutable snapshot tuple of a blocking submission (which may no longer pass
 * today's live eligibility rule), rather than accepted from the caller. The
 * lifecycle guard is skipped because submission itself owns that transition
 * (fresh post-supersede evidence and deterministic generated ledgers).
 */
export async function mirrorCandidateSourcesForSubmission(
  orgCtx: OrgContext,
  args: {
    removalId: string;
    submissionContext: SubmissionSourceCandidateContext;
  },
): Promise<void> {
  requireOrgRole(orgCtx, "admin");
  const candidates = await collectSubmissionSourceCandidates(
    orgCtx,
    args.removalId,
    args.submissionContext,
  );
  const candidateByDocumentId = new Map(
    candidates.map((candidate) => [candidate.documentId, candidate]),
  );
  const candidateDocumentIds = Array.from(candidateByDocumentId.keys()).sort();
  if (candidateDocumentIds.length === 0) return;

  const existing = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    candidateDocumentIds,
  );
  const mirroredDocumentIds = new Set(existing.map((row) => row.documentId));

  for (const documentId of candidateDocumentIds) {
    if (mirroredDocumentIds.has(documentId)) continue;
    const candidate = candidateByDocumentId.get(documentId);
    if (!candidate) continue;
    await mirrorDerivedCandidate(
      orgCtx,
      { removalId: args.removalId, documentId },
      {
        enforceRemovalLifecycle: false,
        candidate: {
          binding: candidate.binding,
          lineageLabel: candidate.binding?.lineage.entityLabel ?? null,
        },
      },
    );
  }
}

// Every outbound Isometric call below is wrapped so a failure lands in
// certifier_sync_events before bubbling up. Without this, a POST that fails
// (auth expired, 5xx, network) leaves zero audit trail: ops cannot answer
// "did we even try?" in production. Re-throws after recording so the caller
// still sees the error.
async function mirrorDerivedCandidate(
  orgCtx: OrgContext,
  parsed: MirrorDocumentToSourceInput,
  options: {
    enforceRemovalLifecycle: boolean;
    candidate: ServerDerivedCandidate;
  },
): Promise<MirrorResult> {
  const { removalId, documentId } = parsed;
  const removal = await getCertifierRemovalById(orgCtx, removalId);
  if (!removal) throw new SafeError("Removal not found.");
  const mapping = await getCertifierProjectByFacility(
    orgCtx,
    removal.facilityId,
    ISOMETRIC_PROVIDER,
  );
  if (!mapping) {
    throw new SafeError(
      "This facility isn't linked to an Isometric project. Link it in facility settings before submitting.",
    );
  }
  if (options.enforceRemovalLifecycle) {
    await assertRemovalSourcesEditable(
      orgCtx,
      removalId,
      removal.facilityId,
      db,
    );
  }
    // Pre-flight: document loadable + safe to upload ────────────────────
    const document = await getDocumentById(orgCtx, documentId);
    if (!document) throw new SafeError("Document not found.");
    if (document.uploadStatus !== "uploaded") {
      throw new SafeError(
        "This document upload has not been confirmed. Finish or retry the upload, then submit again.",
      );
    }
    if (!document.storageKey) {
      throw new SafeError(
        "This document has no managed storage (legacy URL-only). Re-upload it through noma, then submit again.",
      );
    }
    if (!document.fileSizeBytes) {
      throw new SafeError(
        "This document has no recorded size. Re-upload it through noma, then submit again.",
      );
    }
    if (document.fileSizeBytes > SOURCES_MAX_BYTES) {
      throw new SafeError(
        `This document is larger than the ${Math.round(SOURCES_MAX_BYTES / BYTES_PER_MEGABYTE)} MB limit. Upload a smaller file.`,
      );
    }
    if (!document.mimeType) {
      throw new SafeError(
        "This document has no recorded file type. Re-upload it through noma, then submit again.",
      );
    }
    const provider = getStorageProvider();
    const head = await provider.headObject(document.storageKey);
    if (!head) {
      throw new SafeError(
        "This document's file is missing from storage. The upload may have failed; re-upload it, then submit again.",
      );
    }
    if (head.size !== document.fileSizeBytes) {
      throw new SafeError(
        "The stored file does not match this document's record. Re-upload it, then submit again.",
      );
    }
    const client = await getIsometricClientForOrg(orgCtx.organizationId);

    // After the pre-flight, these are guaranteed non-null. Lift them into
    // typed locals so the closure passed to db.transaction below carries
    // narrowed types (TS won't narrow through async callbacks).
    const fileSizeBytes: number = document.fileSizeBytes;
    const mimeType: string = document.mimeType;
    const supplierRefId = buildSourceSupplierRef(documentId);
    const sourceVisibility = await getRegistrySourceVisibility(
      orgCtx,
      ISOMETRIC_PROVIDER,
    );
    const policyIsPublic = sourceVisibility === "public";
    const sourceBinding = options.candidate.binding;
    const sourceLineageLabel =
      options.candidate.lineageLabel ??
      `${document.entityType} ${document.entityId}`;
    // Serialize concurrent mirrors of the same document with a transaction-
    // scoped advisory lock. Two operators clicking "Mirror" simultaneously
    // would otherwise both POST /sources and one Source becomes an orphan
    // (loser's externalId stays on Isometric, never linked locally). The
    // lock is keyed on (provider, documentId) so unrelated mirrors run in
    // parallel. Held across HTTP calls; acceptable for single-tenant v1.
    // Sync events are staged rather than written inline: `appendSyncEvent`
    // inserts through the root pooled `db`, so an audit write issued while
    // this transaction holds the only pooled connection can only time out.
    // `withStagedSyncEvents` flushes them once the transaction settles.
    return withStagedSyncEvents(orgCtx, (stage) =>
      db.transaction(async (tx) => {
        await acquireMirrorLock(tx, documentId);
        if (options.enforceRemovalLifecycle) {
          // Submission claims acquire the same document lock before persisting
          // their lifecycle transition. Re-decide after the lock so a mirror
          // that queued behind a claim cannot mutate the claimed Source set.
          await assertRemovalSourcesEditable(
            orgCtx,
            removalId,
            removal.facilityId,
            tx,
          );
        }

        // Idempotency short-circuit (inside the lock) ─────────────────────
        const existingLocal = await getDocumentUploadByDocument(
          orgCtx,
          ISOMETRIC_PROVIDER,
          documentId,
          tx,
        );
        if (existingLocal) {
          const meta = existingLocal.metadata as DocumentUploadMetadata;
          return {
            externalDocumentId: existingLocal.externalDocumentId,
            isPublic: meta?.isPublic ?? false,
            recovered: false,
          };
        }

        let sourceExternalId: string;
        let signedUploadUrl: string | null = null;
        let recoveredFlag = false;
        // Fresh creates use the persisted organization policy. Reconciliation
        // trusts the existing remote Source because Isometric remains the
        // registry of record for Sources created before a policy change.
        let resolvedIsPublic = policyIsPublic;

        // Reconciliation: was a Source already created in a previous attempt?
        const remoteExisting = await withSourceSyncEventOnFailure(
          orgCtx,
          {
            documentId,
            removalId,
            operation: "source:lookup",
            requestPayload: { supplierRefId, phase: "lookup" },
            stage,
          },
          () => findSourceBySupplierRef(client, supplierRefId),
        );

        if (remoteExisting) {
          sourceExternalId = remoteExisting.id;
          resolvedIsPublic = remoteExisting.is_public;
          const result = await withSourceSyncEventOnFailure(
            orgCtx,
            {
              documentId,
              removalId,
              operation: "source:create:reconciled",
              requestPayload: { supplierRefId, externalId: remoteExisting.id },
              stage,
            },
            () =>
              requestSignedUploadUrl(client, remoteExisting.id, {
                content_length: fileSizeBytes,
                content_type: mimeType,
              }),
          );
          if (result.kind === "url" && result.uploadUrl) {
            signedUploadUrl = result.uploadUrl;
          }
          recoveredFlag = true;
        } else {
          const created = await withSourceSyncEventOnFailure(
            orgCtx,
            {
              documentId,
              removalId,
              operation: "source:create",
              requestPayload: { supplierRefId },
              stage,
            },
            () =>
              createSource(
                client,
                buildSourceRequestBody({
                  externalProjectId: mapping.externalProjectId,
                  document,
                  supplierRefId,
                  isPublic: policyIsPublic,
                  sourceDescription: buildRemovalSourceDescription(
                    sourceBinding,
                    sourceLineageLabel,
                  ),
                }),
              ),
          );
          sourceExternalId = created.source.id;
          signedUploadUrl = created.signed_upload_url;
        }

        // Upload bytes if a URL was returned ───────────────────────────────
        if (signedUploadUrl) {
          await withSourceSyncEventOnFailure(
            orgCtx,
            {
              documentId,
              removalId,
              operation: "source:upload",
              requestPayload: { supplierRefId, externalId: sourceExternalId },
              stage,
            },
            async () => {
              const { blob, contentType } = await downloadDocumentBlob(document);
              await putBlobToSignedUrl(signedUploadUrl!, blob, contentType);
            },
          );
        }

        // Persist the local mapping ────────────────────────────────────────
        const metadata: DocumentUploadMetadata = {
          mirroredBy: orgCtx.userId,
          supplierRefId,
          contentLength: fileSizeBytes,
          contentType: mimeType,
          isPublic: resolvedIsPublic,
          ...(document.checksumSha256
            ? { fileChecksum: document.checksumSha256 }
            : {}),
        };
        const { row, inserted } = await insertOrGetDocumentUpload(
          orgCtx,
          {
            documentId,
            provider: ISOMETRIC_PROVIDER,
            externalDocumentId: sourceExternalId,
            metadata,
          },
          tx,
        );

        // Defense-in-depth orphan check. With `acquireMirrorLock(tx, documentId)`
        // held across the whole block, two callers cannot reach the insert
        // concurrently for the same documentId — so this branch is expected to
        // be unreachable. Kept because a future entry point that mints a Source
        // without first acquiring the lock would silently orphan the
        // externalDocumentId we just created; the sync_event lets an out-of-
        // band sweep reconcile rather than swallowing the leak.
        if (!inserted && row.externalDocumentId !== sourceExternalId) {
          stage.onCommit({
            provider: ISOMETRIC_PROVIDER,
            entityType: "document",
            entityId: documentId,
            operation: "source:create:orphaned",
            status: "failed",
            requestPayload: { supplierRefId },
            responsePayload: {
              orphan_external_id: sourceExternalId,
              winning_external_id: row.externalDocumentId,
            },
            errorMessage:
              "Lost the mirror race; the Source created by this attempt is unreferenced on Isometric.",
          });
        } else {
          stage.onCommit({
            provider: ISOMETRIC_PROVIDER,
            entityType: "document",
            entityId: documentId,
            operation: recoveredFlag
              ? "source:create:reconciled"
              : "source:create",
            status: "succeeded",
            requestPayload: { supplierRefId },
            responsePayload: {
              id: row.externalDocumentId,
              upload_skipped: signedUploadUrl === null,
              source: recoveredFlag ? "reconciliation" : "fresh",
            },
          });
        }

        const persistedMeta = row.metadata as DocumentUploadMetadata;
        return {
          externalDocumentId: row.externalDocumentId,
          isPublic: persistedMeta?.isPublic ?? resolvedIsPublic,
          recovered: recoveredFlag,
        };
      }),
    );
}
