"use server";

import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import { acquireMirrorLock } from "@/lib/isometric/utils/source-lock";
import {
  getCertifierProjectByFacility,
  type CertificationSubmissionRow,
} from "@/data-access/certification";
import {
  deleteDocumentUploadByDocument,
  getDocumentUploadByDocument,
  insertOrGetDocumentUpload,
  isExternalSourceReferencedInSnapshots,
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
  buildSourceRequestBody,
  downloadDocumentBlob,
  putBlobToSignedUrl,
} from "./sources-transfer";
import {
  loadCandidateDocumentsForRemovalSchema,
  mirrorDocumentToSourceSchema,
  type MirrorDocumentToSourceInput,
  SOURCES_MAX_BYTES,
  unlinkDocumentSourceSchema,
} from "@/schemas/certification-sources";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  appendSyncEventBestEffort,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "./shared";
import { withSourceSyncEventOnFailure } from "./source-sync-events";
import { buildRemovalSourceDescription } from "@/lib/certification/removal-source-bindings";
import {
  loadCandidateDocumentsForRemovalForUser,
  type CandidateDocument,
  type CandidateDocumentsForRemoval,
} from "./source-candidates";

const BYTES_PER_MEGABYTE = 1_000_000;

export async function loadCandidateDocumentsForRemoval(
  input: unknown,
): Promise<ActionResult<CandidateDocumentsForRemoval>> {
  return withAction(async (orgCtx) => {
    const parsed = loadCandidateDocumentsForRemovalSchema.parse(input);
    return loadCandidateDocumentsForRemovalForUser(orgCtx, parsed.removalId);
  });
}

// Source mutations (mirror and unlink) are anchored to a specific
// removal so the server can verify the document actually belongs to that
// removal's lineage. Without this check, any authenticated caller who knows a
// documentId UUID could mutate a Source mirrored under another removal — the
// schema-level `removalId` only documents intent; this is the enforcement.
//
// Returns the loaded candidate set (mirror needs `hasMapping`); the matching
// candidate itself is discarded — the check is side-effect-only.
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
    throw new SafeError(
      "This document is not available for this Removal. Reload the panel and try again.",
    );
  }
  return { candidates, candidate: found };
}

// ───────────────────────────────────────────────────────────────────────────
// Mirror flow
// ───────────────────────────────────────────────────────────────────────────

export interface MirrorResult {
  externalDocumentId: string;
  isPublic: boolean;
  recovered: boolean;
}

/**
 * Ensures every candidate evidence document has a persisted Isometric Source
 * mapping before the Removal snapshot is compiled. Submission is the owning
 * workflow for this transition; operators should not have to mirror files one
 * at a time in the UI.
 */
export async function mirrorCandidateSourcesForSubmission(
  orgCtx: OrgContext,
  args: { removalId: string; candidateDocumentIds: string[] },
): Promise<void> {
  const candidateDocumentIds = Array.from(
    new Set(args.candidateDocumentIds),
  ).sort();
  if (candidateDocumentIds.length === 0) return;

  const existing = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    candidateDocumentIds,
  );
  const mirroredDocumentIds = new Set(
    existing.map((row) => row.documentId),
  );

  for (const documentId of candidateDocumentIds) {
    if (mirroredDocumentIds.has(documentId)) continue;
    await mirrorDocumentToSourceForUser(
      orgCtx,
      { removalId: args.removalId, documentId },
      { enforceRemovalLifecycle: true },
    );
  }
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

// Wraps an outbound Isometric call so any failure lands in
// certifier_sync_events before bubbling up. Without this, a POST that fails
// (auth expired, 5xx, network) leaves zero audit trail — ops cannot answer
// "did we even try?" in production. Re-throws after recording so the action
// still surfaces the error to the caller.
// Thin server-action wrapper: validates input and resolves the caller from the
// session. The body lives in `mirrorDocumentToSourceForUser` so server-side
// callers that already hold a orgCtx (the submit pipeline, the transport
// evidence-ledger generator) can mirror without re-deriving the session.
export async function mirrorDocumentToSource(
  input: unknown,
): Promise<ActionResult<MirrorResult>> {
  return withAction((orgCtx) =>
    mirrorDocumentToSourceForUser(
      orgCtx,
      mirrorDocumentToSourceSchema.parse(input),
      { enforceRemovalLifecycle: true },
    ),
  );
}

export async function mirrorDocumentToSourceForUser(
  orgCtx: OrgContext,
  parsed: MirrorDocumentToSourceInput,
  options: { enforceRemovalLifecycle?: boolean } = {},
): Promise<MirrorResult> {
  requireOrgRole(orgCtx, "admin");
  const { removalId, documentId } = parsed;

  // Ownership + lineage scoping ───────────────────────────────────────
  // `assertDocumentIsCandidateForRemoval` walks the same lineage the panel
  // shows. Anchoring the mutation to the removal prevents an authenticated
  // caller from mirroring an arbitrary document UUID through this endpoint.
  const { candidates, candidate } = await assertDocumentIsCandidateForRemoval(
    orgCtx,
    removalId,
    documentId,
  );
  if (!candidates.hasMapping) {
    throw new SafeError(
      "This facility isn't linked to an Isometric project. Link it in facility settings before submitting.",
    );
  }
  const removal = await getCertifierRemovalById(orgCtx, removalId);
  if (!removal) throw new SafeError("Removal not found.");
  const mapping = await getCertifierProjectByFacility(
    orgCtx,
    removal.facilityId,
    ISOMETRIC_PROVIDER,
  );
  if (!mapping) {
    // Defensive: hasMapping was true above, so this is a TOCTOU edge.
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
    // Serialize concurrent mirrors of the same document with a transaction-
    // scoped advisory lock. Two operators clicking "Mirror" simultaneously
    // would otherwise both POST /sources and one Source becomes an orphan
    // (loser's externalId stays on Isometric, never linked locally). The
    // lock is keyed on (provider, documentId) so unrelated mirrors run in
    // parallel. Held across HTTP calls; acceptable for single-tenant v1.
    return db.transaction(async (tx) => {
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
                  candidate.binding,
                  candidate.lineageEntity.entityLabel,
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
        await appendSyncEventBestEffort(orgCtx, {
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
        await appendSyncEventBestEffort(orgCtx, {
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
    });
}

// ───────────────────────────────────────────────────────────────────────────
// Unlink (local-only)
// ───────────────────────────────────────────────────────────────────────────

export async function unlinkDocumentSource(
  input: unknown,
): Promise<ActionResult<{ unlinked: boolean }>> {
  return withAction(async (orgCtx) => {
    requireOrgRole(orgCtx, "admin");
    const parsed = unlinkDocumentSourceSchema.parse(input);

    // Anchor the mutation to a specific removal so the document must belong
    // to that removal's lineage. Schema-level removalId is intent; this
    // check is the enforcement.
    await assertDocumentIsCandidateForRemoval(
      orgCtx,
      parsed.removalId,
      parsed.documentId,
    );
    const removal = await getCertifierRemovalById(orgCtx, parsed.removalId);
    if (!removal) throw new SafeError("Removal not found.");

    // Wrap the snapshot-reference check + DELETE in a single transaction.
    // The advisory lock is keyed on (provider, documentId) — the same key
    // mirror uses and submit acquires per-document — so unlink, mirror, and
    // submit all interlock on the same key. This closes the window where
    // submit could read the externalDocumentId, unlink could delete the
    // mapping, and submit would then write a snapshot referencing an
    // orphaned source id.
    return db.transaction(async (tx) => {
      await acquireMirrorLock(tx, parsed.documentId);
      await assertRemovalSourcesEditable(
        orgCtx,
        parsed.removalId,
        removal.facilityId,
        tx,
      );

      const existing = await getDocumentUploadByDocument(
        orgCtx,
        ISOMETRIC_PROVIDER,
        parsed.documentId,
        tx,
      );
      if (!existing) return { unlinked: false };

      const referenced = await isExternalSourceReferencedInSnapshots(
        orgCtx,
        ISOMETRIC_PROVIDER,
        existing.externalDocumentId,
        tx,
      );
      if (referenced) {
        throw new SafeError(
          "This file is referenced by a submitted Removal. Unlinking it would break the audit trail. The file stays on Isometric and a later submission can attach it again.",
        );
      }

      await deleteDocumentUploadByDocument(
        orgCtx,
        ISOMETRIC_PROVIDER,
        parsed.documentId,
        tx,
      );

      // Defence-in-depth recheck inside the transaction. With submit now
      // acquiring the same (provider, documentId) lock before resolving
      // source IDs, this recheck should never fire — but a recheck that
      // never aborts is cheap, and it guards against future submission
      // entry points that forget to take the lock.
      const stillReferenced = await isExternalSourceReferencedInSnapshots(
        orgCtx,
        ISOMETRIC_PROVIDER,
        existing.externalDocumentId,
        tx,
      );
      if (stillReferenced) {
        throw new SafeError(
          "A Removal submission committed concurrently and now references this source. Unlink aborted; retry once the submission completes.",
        );
      }

      await appendSyncEventBestEffort(orgCtx, {
        provider: ISOMETRIC_PROVIDER,
        entityType: "document",
        entityId: parsed.documentId,
        operation: "source:unlink:local",
        status: "succeeded",
        responsePayload: {
          externalDocumentId: existing.externalDocumentId,
        },
      });
      return { unlinked: true };
    });
  });
}

export {
  collectCandidateDocumentIdsForRemoval,
  collectCandidateSourceDocumentsForRemoval,
  loadCandidateDocumentsForRemovalForUser,
  resolveSourceBindingCandidates,
  resolveSourceIdsForRemoval,
} from "./source-candidates";
export type {
  CandidateDocument,
  CandidateDocumentsForRemoval,
  CandidateLineageEntity,
  CandidateSourceDocument,
  ResolvedSourceBindingCandidate,
} from "./source-candidates";

// Re-export the input types for caller convenience.
export type {
  MirrorDocumentToSourceInput,
  UnlinkDocumentSourceInput,
  LoadCandidateDocumentsForRemovalInput,
} from "@/schemas/certification-sources";
