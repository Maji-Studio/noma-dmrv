"use server";

import { db, type DbTransaction } from "@/db";
import { acquireMirrorLock } from "@/lib/isometric/utils/source-lock";
import { env } from "@/config/env";
import {
  appendSyncEvent,
  getCertifierProjectByFacility,
  type DocumentRow,
} from "@/data-access/certification";
import {
  deleteDocumentUploadByDocument,
  getDocumentUploadByDocument,
  insertOrGetDocumentUpload,
  isExternalSourceReferencedInSnapshots,
  listDocumentUploadsForDocuments,
  updateDocumentUploadMetadata,
  type CertifierDocumentUploadRow,
  type DocumentUploadMetadata,
} from "@/data-access/certifier-document-uploads";
import {
  getCertifierRemovalById,
  getCreditBatchesByRemovalId,
} from "@/data-access/certifier-removals";
import { getChainOfCustodyData } from "@/data-access/chain-of-custody";
import { getCreditBatchById } from "@/data-access/credit-batches";
import { getProductionRunsWithSamples } from "@/data-access/production-runs";
import {
  getDocumentById,
  listDocumentsForEntity,
} from "@/data-access/documents";
import { SafeError } from "@/lib/errors";
import {
  buildSourceSupplierRef,
  createSource,
  findSourceBySupplierRef,
  patchSource,
  requestSignedUploadUrl,
  type CreateDocumentSourceRequest,
} from "@/lib/isometric";
import { getStorageProvider } from "@/lib/storage";
import {
  loadCandidateDocumentsForRemovalSchema,
  mirrorDocumentToSourceSchema,
  setDocumentSourceVisibilitySchema,
  SOURCES_MAX_BYTES,
  unlinkDocumentSourceSchema,
} from "@/schemas/certification-sources";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { ISOMETRIC_PROVIDER } from "./shared";

// ───────────────────────────────────────────────────────────────────────────
// Candidate-document discovery
// ───────────────────────────────────────────────────────────────────────────

// Document `entity_type` strings that participate in a Removal's chain.
// Mirrors DOCUMENT_ENTITY_TYPES in schemas/documents.ts. Kept narrow on
// purpose — facility-scope evidence (LCAs, calibration certificates) is
// handled by the PROJECT-Component flow per ADR 0005, not the Removal
// source set.
type LineageEntityType =
  | "application"
  | "delivery"
  | "order"
  | "biochar_product"
  | "production_run"
  | "production_sample"
  | "production_incident"
  | "sample"
  | "feedstock"
  | "feedstock_delivery"
  | "credit_batch"
  | "reactor";

export interface CandidateLineageEntity {
  entityType: LineageEntityType;
  entityId: string;
  entityLabel: string;
}

export interface CandidateDocument {
  document: DocumentRow;
  lineageEntity: CandidateLineageEntity;
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
  // and by the panel header (`Sources (3 of 7 mirrored)`).
  mirroredExternalIds: string[];
  // True when the facility has an Isometric mapping. Without one, the panel
  // renders an empty state with a pointer to facility settings.
  hasMapping: boolean;
}

// Walks every member credit batch's chain-of-custody, collecting (entityType,
// entityId, label) tuples for each entity that can carry documents. Dedup by
// (type, id). The labels feed into the panel UI so each candidate row says
// "lab report — sample-2025-01-12.pdf (from production run XYZ)".
async function collectLineageEntities(
  userId: string,
  memberBatchIds: string[],
): Promise<CandidateLineageEntity[]> {
  if (memberBatchIds.length === 0) return [];

  const batches = await Promise.all(
    memberBatchIds.map((id) => getCreditBatchById(userId, id)),
  );
  const seen = new Map<string, CandidateLineageEntity>();
  const add = (e: CandidateLineageEntity) => {
    const k = `${e.entityType}:${e.entityId}`;
    if (!seen.has(k)) seen.set(k, e);
  };

  for (const batch of batches) {
    if (!batch) continue;
    add({
      entityType: "credit_batch",
      entityId: batch.id,
      entityLabel: `Credit batch ${batch.code}`,
    });

    const lineages = await Promise.all(
      batch.applicationIds.map((aid) => getChainOfCustodyData(userId, aid)),
    );
    const runIds = Array.from(
      new Set(
        lineages
          .map((l) => l.productionRun?.id)
          .filter((id): id is string => !!id),
      ),
    );
    const runsWithSamples =
      runIds.length > 0
        ? await getProductionRunsWithSamples(userId, runIds)
        : [];

    for (const lineage of lineages) {
      add({
        entityType: "application",
        entityId: lineage.application.id,
        entityLabel: `Application ${lineage.application.code}`,
      });
      add({
        entityType: "delivery",
        entityId: lineage.delivery.id,
        entityLabel: `Delivery ${lineage.delivery.code}`,
      });
      if (lineage.order) {
        add({
          entityType: "order",
          entityId: lineage.order.id,
          entityLabel: `Order ${lineage.order.code}`,
        });
      }
      if (lineage.biocharProduct) {
        add({
          entityType: "biochar_product",
          entityId: lineage.biocharProduct.id,
          entityLabel: `Biochar product ${lineage.biocharProduct.code}`,
        });
      }
      if (lineage.productionRun) {
        add({
          entityType: "production_run",
          entityId: lineage.productionRun.id,
          entityLabel: `Production run ${lineage.productionRun.code}`,
        });
      }
      if (lineage.reactor) {
        add({
          entityType: "reactor",
          entityId: lineage.reactor.id,
          entityLabel: `Reactor ${lineage.reactor.code}`,
        });
      }
      for (const fs of lineage.feedstocks) {
        add({
          entityType: "feedstock",
          entityId: fs.id,
          entityLabel: `Feedstock ${fs.code}`,
        });
      }
    }

    for (const run of runsWithSamples) {
      for (const sample of run.samples) {
        add({
          entityType: "sample",
          entityId: sample.id,
          entityLabel: `Lab sample for run ${run.code}`,
        });
      }
    }
  }

  return Array.from(seen.values());
}

async function loadCandidateDocumentsForRemovalInternal(
  userId: string,
  removalId: string,
): Promise<CandidateDocumentsForRemoval> {
  const removal = await getCertifierRemovalById(userId, removalId);
  if (!removal) throw new SafeError("Removal not found.");

  const mapping = await getCertifierProjectByFacility(
    userId,
    removal.facilityId,
    ISOMETRIC_PROVIDER,
  );

  const batches = await getCreditBatchesByRemovalId(userId, removalId);
  const lineageEntities = await collectLineageEntities(
    userId,
    batches.map((b) => b.id),
  );

  const docsLists = await Promise.all(
    lineageEntities.map((e) =>
      listDocumentsForEntity(userId, e.entityType, e.entityId).then((rows) => ({
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
    userId,
    ISOMETRIC_PROVIDER,
    documentIds,
  );
  const mirrorByDocumentId = new Map<string, CertifierDocumentUploadRow>(
    mirrorRows.map((r) => [r.documentId, r]),
  );

  const candidates: CandidateDocument[] = Array.from(seenDocs.values()).map(
    ({ doc, entity }) => {
      const mirror = mirrorByDocumentId.get(doc.id);
      const meta = (mirror?.metadata ?? null) as
        | (DocumentUploadMetadata & { [k: string]: unknown })
        | null;
      return {
        document: doc,
        lineageEntity: entity,
        mirror: mirror
          ? {
              externalDocumentId: mirror.externalDocumentId,
              isPublic: meta?.isPublic ?? false,
              mirroredAt: mirror.createdAt,
            }
          : null,
      };
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
    mirroredExternalIds: mirrorRows.map((r) => r.externalDocumentId),
    hasMapping: !!mapping,
  };
}

export async function loadCandidateDocumentsForRemoval(
  input: unknown,
): Promise<ActionResult<CandidateDocumentsForRemoval>> {
  return withAction(async (userId) => {
    const parsed = loadCandidateDocumentsForRemovalSchema.parse(input);
    return loadCandidateDocumentsForRemovalInternal(userId, parsed.removalId);
  });
}

// Source mutations (mirror, unlink, set-visibility) are anchored to a specific
// removal so the server can verify the document actually belongs to that
// removal's lineage. Without this check, any authenticated caller who knows a
// documentId UUID could mutate a Source mirrored under another removal — the
// schema-level `removalId` only documents intent; this is the enforcement.
//
// Returns the loaded candidate set (mirror needs `hasMapping`); the matching
// candidate itself is discarded — the check is side-effect-only.
async function assertDocumentIsCandidateForRemoval(
  userId: string,
  removalId: string,
  documentId: string,
): Promise<CandidateDocumentsForRemoval> {
  const candidates = await loadCandidateDocumentsForRemovalInternal(
    userId,
    removalId,
  );
  const found = candidates.candidates.some((c) => c.document.id === documentId);
  if (!found) {
    // SafeError is intentionally bland — telling the caller "the doc exists
    // but isn't in this removal's lineage" leaks information they don't
    // already have. Match the not-found path's wording.
    throw new SafeError(
      "Document is not a candidate for this removal. Reload the panel and try again.",
    );
  }
  return candidates;
}

// ───────────────────────────────────────────────────────────────────────────
// Mirror flow
// ───────────────────────────────────────────────────────────────────────────

export interface MirrorResult {
  externalDocumentId: string;
  isPublic: boolean;
  recovered: boolean;
}

function buildSourceRequestBody(args: {
  externalProjectId: string;
  document: DocumentRow;
  supplierRefId: string;
  isPublic: boolean;
}): CreateDocumentSourceRequest {
  const { externalProjectId, document, supplierRefId, isPublic } = args;
  // Isometric requires non-null content_length / content_type / file_name. The
  // pre-flight check enforces this; the `!` here is post-validation.
  const contentLength = document.fileSizeBytes!;
  const contentType = document.mimeType!;
  const publishedAt = (document.capturedAt ?? document.createdAt)
    .toISOString()
    .slice(0, 10);
  return {
    __typename: "CreateDocumentSourceRequest",
    content_length: contentLength,
    content_type: contentType,
    display_name: document.fileName,
    file_name: document.fileName,
    is_public: isPublic,
    project_id: externalProjectId,
    published_at: publishedAt,
    supplier_reference_id: supplierRefId,
  };
}

async function downloadDocumentBlob(
  document: DocumentRow,
): Promise<{ blob: Blob; contentType: string }> {
  if (!document.storageKey) {
    throw new SafeError(
      "This document has no managed storage (legacy URL-only). Re-upload through noma before mirroring to Isometric.",
    );
  }
  const provider = getStorageProvider();
  const url = await provider.createDownloadUrl({ key: document.storageKey });
  const response = await fetch(url);
  if (!response.ok) {
    throw new SafeError(
      `Failed to read document from storage (${response.status}).`,
    );
  }
  const contentType = document.mimeType ?? "application/octet-stream";
  const blob = await response.blob();
  return { blob, contentType };
}

// Hosts the mirror flow is allowed to PUT bytes to. Isometric returns a
// presigned URL pointing at object storage; if a malicious / misconfigured
// API rerouted that URL at an internal address, fetch() would happily ship
// the document bytes there. Allowlist + protocol check + redirect denial
// constrain the SSRF surface to documented storage hosts.
const DEFAULT_UPLOAD_HOST_SUFFIXES = [
  ".s3.amazonaws.com",
  ".amazonaws.com",
  ".isometric.com",
  ".digitaloceanspaces.com",
] as const;

function uploadHostSuffixes(): string[] {
  const raw = env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST;
  if (!raw) return [...DEFAULT_UPLOAD_HOST_SUFFIXES];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry : `.${entry}`));
}

function assertUploadHostAllowed(uploadUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uploadUrl);
  } catch {
    throw new SafeError("Isometric returned a malformed upload URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new SafeError(
      `Refusing PUT to non-HTTPS upload URL (protocol=${parsed.protocol}).`,
    );
  }
  const hostname = `.${parsed.hostname.toLowerCase()}`;
  const allowed = uploadHostSuffixes();
  if (!allowed.some((suffix) => hostname.endsWith(suffix.toLowerCase()))) {
    throw new SafeError(
      `Refusing PUT to upload URL with host "${parsed.hostname}" — not in ISOMETRIC_UPLOAD_HOST_ALLOWLIST.`,
    );
  }
}

async function putBlobToSignedUrl(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  assertUploadHostAllowed(uploadUrl);
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: blob,
    redirect: "error",
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
    },
  });
  if (!response.ok) {
    // Do NOT echo the response body — third-party storage gateways can
    // include request fragments in error pages and this message lands in
    // certifier_sync_events. Status code alone is enough to diagnose;
    // detailed body inspection belongs in non-persistent debug logs only.
    throw new SafeError(
      `Isometric PUT upload failed (status ${response.status}).`,
    );
  }
}

// Wraps an outbound Isometric call so any failure lands in
// certifier_sync_events before bubbling up. Without this, a POST that fails
// (auth expired, 5xx, network) leaves zero audit trail — ops cannot answer
// "did we even try?" in production. Re-throws after recording so the action
// still surfaces the error to the caller.
async function withSyncEventOnFailure<T>(
  userId: string,
  args: {
    documentId: string;
    operation: string;
    requestPayload?: unknown;
  },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await safeAppendSyncEvent(userId, {
      provider: ISOMETRIC_PROVIDER,
      entityType: "document",
      entityId: args.documentId,
      operation: args.operation,
      status: "failed",
      requestPayload: args.requestPayload,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function mirrorDocumentToSource(
  input: unknown,
): Promise<ActionResult<MirrorResult>> {
  return withAction(async (userId) => {
    const parsed = mirrorDocumentToSourceSchema.parse(input);
    const { removalId, documentId, isPublic } = parsed;

    // Ownership + lineage scoping ───────────────────────────────────────
    // `assertDocumentIsCandidateForRemoval` walks the same lineage the panel
    // shows. Anchoring the mutation to the removal prevents an authenticated
    // caller from mirroring an arbitrary document UUID through this endpoint.
    const candidates = await assertDocumentIsCandidateForRemoval(
      userId,
      removalId,
      documentId,
    );
    if (!candidates.hasMapping) {
      throw new SafeError(
        "This facility isn't linked to an Isometric project. Link it in facility settings before mirroring sources.",
      );
    }
    const removal = await getCertifierRemovalById(userId, removalId);
    if (!removal) throw new SafeError("Removal not found.");
    const mapping = await getCertifierProjectByFacility(
      userId,
      removal.facilityId,
      ISOMETRIC_PROVIDER,
    );
    if (!mapping) {
      // Defensive: hasMapping was true above, so this is a TOCTOU edge.
      throw new SafeError(
        "This facility isn't linked to an Isometric project. Link it in facility settings before mirroring sources.",
      );
    }

    // Pre-flight: document loadable + safe to upload ────────────────────
    const document = await getDocumentById(userId, documentId);
    if (!document) throw new SafeError("Document not found.");
    if (!document.storageKey) {
      throw new SafeError(
        "This document has no managed storage (legacy URL-only). Re-upload through noma before mirroring.",
      );
    }
    if (!document.fileSizeBytes) {
      throw new SafeError(
        "This document has no recorded size. Re-upload through noma before mirroring.",
      );
    }
    if (document.fileSizeBytes > SOURCES_MAX_BYTES) {
      throw new SafeError(
        `Document is ${document.fileSizeBytes} bytes; the current Phase 3.5 limit is ${SOURCES_MAX_BYTES} bytes (streaming larger files is a follow-up).`,
      );
    }
    if (!document.mimeType) {
      throw new SafeError(
        "This document has no recorded MIME type. Re-upload through noma before mirroring.",
      );
    }
    const provider = getStorageProvider();
    const head = await provider.headObject(document.storageKey);
    if (!head) {
      throw new SafeError(
        "Document bytes not found in storage. The upload may have failed; re-upload before mirroring.",
      );
    }
    if (head.size !== document.fileSizeBytes) {
      throw new SafeError(
        "Stored object size does not match the document record. Re-upload before mirroring.",
      );
    }

    // After the pre-flight, these are guaranteed non-null. Lift them into
    // typed locals so the closure passed to db.transaction below carries
    // narrowed types (TS won't narrow through async callbacks).
    const fileSizeBytes: number = document.fileSizeBytes;
    const mimeType: string = document.mimeType;
    const supplierRefId = buildSourceSupplierRef(documentId);
    // Serialize concurrent mirrors of the same document with a transaction-
    // scoped advisory lock. Two operators clicking "Mirror" simultaneously
    // would otherwise both POST /sources and one Source becomes an orphan
    // (loser's externalId stays on Isometric, never linked locally). The
    // lock is keyed on (provider, documentId) so unrelated mirrors run in
    // parallel. Held across HTTP calls; acceptable for single-tenant v1.
    return db.transaction(async (tx) => {
      await acquireMirrorLock(tx, documentId);

      // Idempotency short-circuit (inside the lock) ─────────────────────
      const existingLocal = await getDocumentUploadByDocument(
        userId,
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
      // Resolved visibility persisted into local metadata. For a fresh
      // create, the caller's `isPublic` is authoritative. For reconciliation
      // we trust the remote Source's `is_public` — the previous attempt may
      // have created it with a different value, and Isometric is the
      // registry of record.
      let resolvedIsPublic = isPublic;

      // Reconciliation: was a Source already created in a previous attempt?
      const remoteExisting = await withSyncEventOnFailure(
        userId,
        {
          documentId,
          operation: "source:lookup",
          requestPayload: { supplierRefId, phase: "lookup" },
        },
        () => findSourceBySupplierRef(supplierRefId),
      );

      if (remoteExisting) {
        sourceExternalId = remoteExisting.id;
        resolvedIsPublic = remoteExisting.is_public;
        const result = await withSyncEventOnFailure(
          userId,
          {
            documentId,
            operation: "source:create:reconciled",
            requestPayload: { supplierRefId, externalId: remoteExisting.id },
          },
          () =>
            requestSignedUploadUrl(remoteExisting.id, {
              content_length: fileSizeBytes,
              content_type: mimeType,
            }),
        );
        if (result.kind === "url" && result.uploadUrl) {
          signedUploadUrl = result.uploadUrl;
        }
        recoveredFlag = true;
      } else {
        const created = await withSyncEventOnFailure(
          userId,
          {
            documentId,
            operation: "source:create",
            requestPayload: { supplierRefId },
          },
          () =>
            createSource(
              buildSourceRequestBody({
                externalProjectId: mapping.externalProjectId,
                document,
                supplierRefId,
                isPublic,
              }),
            ),
        );
        sourceExternalId = created.source.id;
        signedUploadUrl = created.signed_upload_url;
      }

      // Upload bytes if a URL was returned ───────────────────────────────
      if (signedUploadUrl) {
        await withSyncEventOnFailure(
          userId,
          {
            documentId,
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
        mirroredBy: userId,
        supplierRefId,
        contentLength: fileSizeBytes,
        contentType: mimeType,
        isPublic: resolvedIsPublic,
        ...(document.checksumSha256
          ? { fileChecksum: document.checksumSha256 }
          : {}),
      };
      const { row, inserted } = await insertOrGetDocumentUpload(
        userId,
        {
          documentId,
          provider: ISOMETRIC_PROVIDER,
          externalDocumentId: sourceExternalId,
          metadata,
        },
        tx,
      );

      // Orphan-detection: if we POSTed a fresh Source but lost the local
      // insert race, the externalDocumentId we created is now an orphan on
      // Isometric. Emit a sync_event so an out-of-band sweep can clean up.
      if (!inserted && row.externalDocumentId !== sourceExternalId) {
        await safeAppendSyncEvent(userId, {
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
        await safeAppendSyncEvent(userId, {
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
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Unlink (local-only) + visibility toggle
// ───────────────────────────────────────────────────────────────────────────

export async function unlinkDocumentSource(
  input: unknown,
): Promise<ActionResult<{ unlinked: boolean }>> {
  return withAction(async (userId) => {
    const parsed = unlinkDocumentSourceSchema.parse(input);

    // Anchor the mutation to a specific removal so the document must belong
    // to that removal's lineage. Schema-level removalId is intent; this
    // check is the enforcement.
    await assertDocumentIsCandidateForRemoval(
      userId,
      parsed.removalId,
      parsed.documentId,
    );

    // Wrap the snapshot-reference check + DELETE in a single transaction.
    // The advisory lock is keyed on (provider, documentId) — the same key
    // mirror uses and submit acquires per-document — so unlink, mirror, and
    // submit all interlock on the same key. This closes the window where
    // submit could read the externalDocumentId, unlink could delete the
    // mapping, and submit would then write a snapshot referencing an
    // orphaned source id.
    return db.transaction(async (tx) => {
      await acquireMirrorLock(tx, parsed.documentId);

      const existing = await getDocumentUploadByDocument(
        userId,
        ISOMETRIC_PROVIDER,
        parsed.documentId,
        tx,
      );
      if (!existing) return { unlinked: false };

      const referenced = await isExternalSourceReferencedInSnapshots(
        userId,
        ISOMETRIC_PROVIDER,
        existing.externalDocumentId,
        tx,
      );
      if (referenced) {
        throw new SafeError(
          "This source is referenced by a submitted Removal payload. Unlinking would break the audit trail. The Source remains on Isometric; future submissions can re-attach by re-mirroring.",
        );
      }

      await deleteDocumentUploadByDocument(
        userId,
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
        userId,
        ISOMETRIC_PROVIDER,
        existing.externalDocumentId,
        tx,
      );
      if (stillReferenced) {
        throw new SafeError(
          "A Removal submission committed concurrently and now references this source. Unlink aborted; retry once the submission completes.",
        );
      }

      await safeAppendSyncEvent(userId, {
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

export async function setDocumentSourceVisibility(
  input: unknown,
): Promise<ActionResult<{ isPublic: boolean }>> {
  return withAction(async (userId) => {
    const parsed = setDocumentSourceVisibilitySchema.parse(input);

    // Anchor the mutation to the removal so the document must belong to
    // that removal's lineage before any cross-system call is made.
    await assertDocumentIsCandidateForRemoval(
      userId,
      parsed.removalId,
      parsed.documentId,
    );

    // Open a transaction and take the per-document mirror lock so this PATCH
    // serializes against concurrent mirror / unlink on the same document.
    // Without the lock, an unlink racing between the remote PATCH and the
    // local UPDATE would leave the remote visibility flipped but the local
    // row deleted — confusing on the next mirror reconciliation. The lock
    // is held across the Isometric PATCH, matching the tradeoff
    // mirrorDocumentToSource accepts (single-tenant v1).
    return db.transaction(async (tx) => {
      await acquireMirrorLock(tx, parsed.documentId);

      const existing = await getDocumentUploadByDocument(
        userId,
        ISOMETRIC_PROVIDER,
        parsed.documentId,
        tx,
      );
      if (!existing) {
        throw new SafeError(
          "Document is not mirrored yet; mirror it before changing visibility.",
        );
      }

      // PATCH remote first — Isometric is the source of truth for is_public
      // on the registry; local metadata is just a cache. The generated
      // PatchSourceRequest treats every field as required-with-sentinel;
      // `{ __typename: "Undefined" }` leaves unchanged fields alone.
      const undefinedField = { __typename: "Undefined" as const };
      const updatedSource = await withSyncEventOnFailure(
        userId,
        {
          documentId: parsed.documentId,
          operation: "source:patch:visibility",
          requestPayload: {
            externalDocumentId: existing.externalDocumentId,
            is_public: parsed.isPublic,
          },
        },
        () =>
          patchSource(existing.externalDocumentId, {
            display_name: undefinedField,
            is_public: parsed.isPublic,
            published_at: undefinedField,
            supplier_reference_id: undefinedField,
          }),
      );

      // Use the registry's response (not the requested value) as
      // authoritative for the local cache — closes the race where two
      // concurrent toggles diverge remote vs local.
      const remoteIsPublic = updatedSource.is_public;

      const existingMeta = (existing.metadata as DocumentUploadMetadata) ?? {
        mirroredBy: userId,
        supplierRefId: buildSourceSupplierRef(parsed.documentId),
        contentLength: 0,
        contentType: "",
        isPublic: false,
      };
      const nextMeta: DocumentUploadMetadata = {
        ...existingMeta,
        isPublic: remoteIsPublic,
      };
      await updateDocumentUploadMetadata(userId, existing.id, nextMeta, tx);

      await safeAppendSyncEvent(userId, {
        provider: ISOMETRIC_PROVIDER,
        entityType: "document",
        entityId: parsed.documentId,
        operation: "source:patch:visibility",
        status: "succeeded",
        requestPayload: { is_public: parsed.isPublic },
        responsePayload: {
          externalDocumentId: existing.externalDocumentId,
          remote_is_public: remoteIsPublic,
        },
      });

      return { isPublic: remoteIsPublic };
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

async function safeAppendSyncEvent(
  userId: string,
  input: Parameters<typeof appendSyncEvent>[1],
): Promise<void> {
  try {
    await appendSyncEvent(userId, input);
  } catch (err) {
    console.warn("Failed to record certifier sync event", {
      operation: input.operation,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Walks the lineage and returns the deduped, sorted set of candidate
// noma documentIds — the IDs every submit-path needs to acquire per-document
// mirror locks on before resolving Isometric source IDs. Sorting prevents
// two concurrent submits from acquiring locks in different orders and
// deadlocking each other.
export async function collectCandidateDocumentIdsForRemoval(
  userId: string,
  args: {
    lineages: Array<{
      application: { id: string };
      delivery: { id: string };
      order: { id: string } | null;
      biocharProduct: { id: string } | null;
      productionRun: { id: string } | null;
      reactor: { id: string } | null;
      feedstocks: Array<{ id: string }>;
    }>;
    runs: Array<{ id: string; samples: Array<{ id: string }> }>;
    memberBatchIds: string[];
  },
): Promise<string[]> {
  const entitySet = new Map<string, { entityType: LineageEntityType; entityId: string }>();
  const add = (entityType: LineageEntityType, entityId: string) => {
    const k = `${entityType}:${entityId}`;
    if (!entitySet.has(k)) entitySet.set(k, { entityType, entityId });
  };
  for (const id of args.memberBatchIds) add("credit_batch", id);
  for (const lineage of args.lineages) {
    add("application", lineage.application.id);
    add("delivery", lineage.delivery.id);
    if (lineage.order) add("order", lineage.order.id);
    if (lineage.biocharProduct) add("biochar_product", lineage.biocharProduct.id);
    if (lineage.productionRun) add("production_run", lineage.productionRun.id);
    if (lineage.reactor) add("reactor", lineage.reactor.id);
    for (const fs of lineage.feedstocks) add("feedstock", fs.id);
  }
  for (const run of args.runs) {
    for (const sample of run.samples) add("sample", sample.id);
  }
  const entityList = Array.from(entitySet.values());
  if (entityList.length === 0) return [];

  const docsLists = await Promise.all(
    entityList.map((e) => listDocumentsForEntity(userId, e.entityType, e.entityId)),
  );
  return Array.from(
    new Set(docsLists.flatMap((rows) => rows.map((r) => r.id))),
  ).sort();
}

// Resolves the deduped, sorted Source ID list for a removal given the set of
// candidate documentIds (from `collectCandidateDocumentIdsForRemoval`). When
// called inside a submit transaction that holds per-document mirror locks,
// the result is stable through the snapshot insert — unlink and mirror both
// block on those locks, so a concurrent unlink cannot delete a mapping after
// we read it but before we persist the reference. Pass a `tx` from the
// caller's transaction; defaults to `db` for non-locked callers.
export async function resolveSourceIdsForRemoval(
  userId: string,
  args: { candidateDocumentIds: string[] },
  txOrDb?: DbTransaction,
): Promise<string[]> {
  if (args.candidateDocumentIds.length === 0) return [];
  const uploads = await listDocumentUploadsForDocuments(
    userId,
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
  SetDocumentSourceVisibilityInput,
  LoadCandidateDocumentsForRemovalInput,
} from "@/schemas/certification-sources";
