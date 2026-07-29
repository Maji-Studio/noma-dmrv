"use server";

import { requireOrgRole, type OrgContext } from "@/lib/auth/server";
import { db, type DbTransaction } from "@/db";
import { acquireMirrorLock } from "@/lib/isometric/utils/source-lock";
import {
  getCertifierProjectByFacility,
  type CertificationSubmissionRow,
  type DocumentRow,
} from "@/data-access/certification";
import {
  deleteDocumentUploadByDocument,
  getDocumentUploadByDocument,
  insertOrGetDocumentUpload,
  isExternalSourceReferencedInSnapshots,
  listDocumentUploadsForDocuments,
  type CertifierDocumentUploadRow,
  type DocumentUploadMetadata,
} from "@/data-access/certifier-document-uploads";
import { getLatestSubmissionWithExecutor } from "@/data-access/certification-submissions";
import { getRegistrySourceVisibility } from "@/data-access/certifier-organization-settings";
import {
  getCertifierRemovalById,
  getCreditBatchesByRemovalId,
} from "@/data-access/certifier-removals";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import {
  getDocumentById,
  listDocumentsForEntity,
} from "@/data-access/documents";
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

const BYTES_PER_MEGABYTE = 1_000_000;
import { withSourceSyncEventOnFailure } from "./source-sync-events";
import {
  buildRemovalSourceDescription,
  classifyRemovalSourceCandidate,
  type ClassifiedRemovalSource,
} from "@/lib/certification/removal-source-bindings";

// ───────────────────────────────────────────────────────────────────────────
// Candidate-document discovery
// ───────────────────────────────────────────────────────────────────────────

// Code-owned Removal evidence roles live on the three operational lineage
// entities plus generated evidence ledgers attached to member credit batches.
// Production-run readings remain telemetry, and transport-leg documents are
// not inferred as substitutes for the direct BoL roles.
type LineageEntityType =
  | "application"
  | "delivery"
  | "feedstock"
  | "credit_batch";

export interface CandidateLineageEntity {
  entityType: LineageEntityType;
  entityId: string;
  entityLabel: string;
}

export interface CandidateDocument {
  document: DocumentRow;
  lineageEntity: CandidateLineageEntity;
  binding: ClassifiedRemovalSource;
  mirror: {
    externalDocumentId: string;
    isPublic: boolean;
    mirroredAt: Date;
  } | null;
}

export interface CandidateDocumentsForRemoval {
  removalId: string;
  facilityId: string;
  candidates: CandidateDocument[];
  // Distinct external Source IDs reachable for this removal — used by submit
  // and by the panel's files-ready counter.
  mirroredExternalIds: string[];
  // True when the facility has an Isometric mapping. Without one, the panel
  // renders an empty state with a pointer to facility settings.
  hasMapping: boolean;
}

// Walks every member credit batch's allocation-aware lineage and collects only
// the operational entities that can own an MVP Removal Source role.
async function collectLineageEntities(
  orgCtx: OrgContext,
  memberBatchIds: string[],
): Promise<CandidateLineageEntity[]> {
  if (memberBatchIds.length === 0) return [];

  const accountingByBatch = await loadCreditBatchRollups(
    orgCtx,
    memberBatchIds,
  );
  const seen = new Map<string, CandidateLineageEntity>();
  const add = (e: CandidateLineageEntity) => {
    const k = `${e.entityType}:${e.entityId}`;
    if (!seen.has(k)) seen.set(k, e);
  };

  for (const memberBatchId of memberBatchIds) {
    const accounting = accountingByBatch[memberBatchId];
    if (!accounting) continue;
    const { batch, lineageFacts } = accounting;
    add({
      entityType: "credit_batch",
      entityId: batch.id,
      entityLabel: `Credit batch ${batch.code}`,
    });

    for (const application of lineageFacts.applications) {
      add({
        entityType: "application",
        entityId: application.id,
        entityLabel: `Application ${application.code}`,
      });
      add({
        entityType: "delivery",
        entityId: application.delivery.id,
        entityLabel: `Delivery ${application.delivery.code}`,
      });
    }

    for (const run of lineageFacts.runs) {
      for (const feedstock of run.feedstocks) {
        add({
          entityType: "feedstock",
          entityId: feedstock.id,
          entityLabel: `Feedstock ${feedstock.code}`,
        });
      }
    }

  }

  return Array.from(seen.values());
}

export async function loadCandidateDocumentsForRemovalForUser(
  orgCtx: OrgContext,
  removalId: string,
): Promise<CandidateDocumentsForRemoval> {
  const removal = await getCertifierRemovalById(orgCtx, removalId);
  if (!removal) throw new SafeError("Removal not found.");

  const mapping = await getCertifierProjectByFacility(
    orgCtx,
    removal.facilityId,
    ISOMETRIC_PROVIDER,
  );

  const batches = await getCreditBatchesByRemovalId(orgCtx, removalId);
  const lineageEntities = await collectLineageEntities(
    orgCtx,
    batches.map((b) => b.id),
  );

  const docsLists = await Promise.all(
    lineageEntities.map((e) =>
      listDocumentsForEntity(orgCtx, e.entityType, e.entityId).then((rows) => ({
        entity: e,
        rows,
      })),
    ),
  );

  // Dedup documents by id — a single document is rare across entities but the
  // map keeps display deterministic.
  const seenDocs = new Map<string, { doc: DocumentRow; entity: CandidateLineageEntity }>();
  for (const { entity, rows } of docsLists) {
    for (const doc of rows) {
      if (!seenDocs.has(doc.id)) seenDocs.set(doc.id, { doc, entity });
    }
  }

  const documentIds = Array.from(seenDocs.keys());
  const mirrorRows = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    documentIds,
  );
  const mirrorByDocumentId = new Map<string, CertifierDocumentUploadRow>(
    mirrorRows.map((r) => [r.documentId, r]),
  );

  const candidates: CandidateDocument[] = Array.from(seenDocs.values()).flatMap(
    ({ doc, entity }) => {
      const binding = classifyRemovalSourceCandidate({
        documentType: doc.documentType,
        metadata: doc.metadata,
        lineage: entity,
        removalId,
      });
      if (!binding) return [];
      const mirror = mirrorByDocumentId.get(doc.id);
      const meta = (mirror?.metadata ?? null) as
        | (DocumentUploadMetadata & { [k: string]: unknown })
        | null;
      return [{
        document: doc,
        lineageEntity: entity,
        binding,
        mirror: mirror
          ? {
              externalDocumentId: mirror.externalDocumentId,
              isPublic: meta?.isPublic ?? false,
              mirroredAt: mirror.createdAt,
            }
          : null,
      }];
    },
  );

  // Deterministic UI order: unmirrored first (most actionable), then by file
  // name. Stable across React Query refetches.
  candidates.sort((a, b) => {
    const aMirrored = a.mirror ? 1 : 0;
    const bMirrored = b.mirror ? 1 : 0;
    if (aMirrored !== bMirrored) return aMirrored - bMirrored;
    return a.document.fileName.localeCompare(b.document.fileName);
  });

  return {
    removalId,
    facilityId: removal.facilityId,
    candidates,
    mirroredExternalIds: Array.from(
      new Set(mirrorRows.map((r) => r.externalDocumentId)),
    ).sort(),
    hasMapping: !!mapping,
  };
}

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
  const client = await getIsometricClientForOrg(orgCtx.organizationId);

    // Pre-flight: document loadable + safe to upload ────────────────────
    const document = await getDocumentById(orgCtx, documentId);
    if (!document) throw new SafeError("Document not found.");
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

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

// Walks the lineage and returns the deduped, sorted set of candidate
// noma documentIds — the IDs every submit-path needs to acquire per-document
// mirror locks on before resolving Isometric source IDs. Sorting prevents
// two concurrent submits from acquiring locks in different orders and
// deadlocking each other.
export async function collectCandidateDocumentIdsForRemoval(
  orgCtx: OrgContext,
  args: {
    removalId: string;
    lineages: Array<{
      application: { id: string; code?: string | null };
      delivery: { id: string; code?: string | null };
      order: { id: string } | null;
      biocharProduct: { id: string } | null;
      productionRun: { id: string } | null;
      reactor: { id: string } | null;
      feedstocks: Array<{ id: string; code?: string | null }>;
    }>;
    memberBatches: Array<{ id: string; code?: string | null }>;
  },
): Promise<string[]> {
  const candidates = await collectCandidateSourceDocumentsForRemoval(orgCtx, {
    removalId: args.removalId,
    lineages: args.lineages,
    memberBatches: args.memberBatches,
  });
  return Array.from(
    new Set(candidates.map((candidate) => candidate.documentId)),
  ).sort();
}

export interface CandidateSourceDocument {
  documentId: string;
  binding: ClassifiedRemovalSource;
}

interface SourceCandidateLineage {
  application: { id: string; code?: string | null };
  delivery: { id: string; code?: string | null };
  feedstocks: Array<{ id: string; code?: string | null }>;
}

/**
 * Discovers the three operator evidence roles and current generated ledgers.
 * Telemetry and every other lineage document stay outside both Removal Source
 * candidates and the submission requirement denominator.
 */
export async function collectCandidateSourceDocumentsForRemoval(
  orgCtx: OrgContext,
  args: {
    removalId?: string;
    lineages: SourceCandidateLineage[];
    memberBatches?: Array<{ id: string; code?: string | null }>;
  },
): Promise<CandidateSourceDocument[]> {
  const entities = new Map<string, CandidateLineageEntity>();
  const add = (entity: CandidateLineageEntity) => {
    const key = `${entity.entityType}:${entity.entityId}`;
    if (!entities.has(key)) entities.set(key, entity);
  };
  for (const lineage of args.lineages) {
    add({
      entityType: "application",
      entityId: lineage.application.id,
      entityLabel: `Application ${lineage.application.code ?? lineage.application.id}`,
    });
    add({
      entityType: "delivery",
      entityId: lineage.delivery.id,
      entityLabel: `Delivery ${lineage.delivery.code ?? lineage.delivery.id}`,
    });
    for (const feedstock of lineage.feedstocks) {
      add({
        entityType: "feedstock",
        entityId: feedstock.id,
        entityLabel: `Feedstock ${feedstock.code ?? feedstock.id}`,
      });
    }
  }
  for (const batch of args.memberBatches ?? []) {
    add({
      entityType: "credit_batch",
      entityId: batch.id,
      entityLabel: `Credit batch ${batch.code ?? batch.id}`,
    });
  }

  const documentsByEntity = await Promise.all(
    Array.from(entities.values(), async (lineage) => ({
      lineage,
      documents: await listDocumentsForEntity(
        orgCtx,
        lineage.entityType,
        lineage.entityId,
      ),
    })),
  );
  const candidates = new Map<string, CandidateSourceDocument>();
  for (const { lineage, documents } of documentsByEntity) {
    for (const document of documents) {
      const binding = classifyRemovalSourceCandidate({
        documentType: document.documentType,
        metadata: document.metadata,
        lineage,
        removalId: args.removalId,
      });
      if (binding && !candidates.has(document.id)) {
        candidates.set(document.id, { documentId: document.id, binding });
      }
    }
  }
  return Array.from(candidates.values()).sort((left, right) =>
    left.documentId.localeCompare(right.documentId),
  );
}

export interface ResolvedSourceBindingCandidate extends CandidateSourceDocument {
  sourceId: string;
}

export async function resolveSourceBindingCandidates(
  orgCtx: OrgContext,
  args: { candidates: CandidateSourceDocument[] },
  txOrDb?: DbTransaction,
): Promise<ResolvedSourceBindingCandidate[]> {
  if (args.candidates.length === 0) return [];
  const uploads = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    args.candidates.map((candidate) => candidate.documentId),
    txOrDb,
  );
  const sourceIdByDocumentId = new Map(
    uploads.map((upload) => [upload.documentId, upload.externalDocumentId]),
  );
  return args.candidates.flatMap((candidate) => {
    const sourceId = sourceIdByDocumentId.get(candidate.documentId);
    return sourceId ? [{ ...candidate, sourceId }] : [];
  });
}

// Resolves the deduped, sorted Source ID list for a removal given the set of
// candidate documentIds (from `collectCandidateDocumentIdsForRemoval`). When
// called inside a submit transaction that holds per-document mirror locks,
// the result is stable through the snapshot insert — unlink and mirror both
// block on those locks, so a concurrent unlink cannot delete a mapping after
// we read it but before we persist the reference. Pass a `tx` from the
// caller's transaction; defaults to `db` for non-locked callers.
export async function resolveSourceIdsForRemoval(
  orgCtx: OrgContext,
  args: { candidateDocumentIds: string[] },
  txOrDb?: DbTransaction,
): Promise<string[]> {
  if (args.candidateDocumentIds.length === 0) return [];
  const uploads = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    args.candidateDocumentIds,
    txOrDb,
  );
  return Array.from(new Set(uploads.map((u) => u.externalDocumentId))).sort();
}

// Re-export the input types for caller convenience.
export type {
  MirrorDocumentToSourceInput,
  UnlinkDocumentSourceInput,
  LoadCandidateDocumentsForRemovalInput,
} from "@/schemas/certification-sources";
