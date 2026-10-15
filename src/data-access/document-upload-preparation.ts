import { and, eq } from "drizzle-orm";
import { documents, storageObjectDeletions } from "@/db/schema";
import { DOCUMENT_PROMOTION_CANDIDATE_LIMIT } from "@/config/documents";
import { documentFromConfirmOutcome, failedDocumentUpload } from "@/lib/documents/confirm-outcome";
import { DomainError } from "@/lib/domain-errors";
import { metadataRecord, promotionCandidates } from "@/lib/documents/metadata";
import { readDocumentForWrite } from "./document-write-scope";
import { db } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import type { DocumentRow } from "./documents";
import { inspectDocumentOwner } from "./document-write-scope";
import { requireOrgScope } from "./utils";

/** Unlocked owner discovery before external upload inspection. */
export async function inspectUploadOwner(ctx: OrgContext, row: DocumentRow) {
  requireOrgScope(ctx);
  return db.transaction((tx) => inspectDocumentOwner(ctx, tx, row.entityType, row.entityId));
}

/** Durable ownership before a PUT, serialized against confirm, expiry and deletion. */
export async function recordDocumentPromotionCandidate(ctx: OrgContext, documentId: string, uploadKey: string, finalKey: string): Promise<void> {
  requireOrgScope(ctx);
  await db.transaction(async (tx) => {
    const row = await readDocumentForWrite(ctx, tx, documentId, true);
    if (row?.uploadStatus === "failed" && row.uploadStorageKey === uploadKey) documentFromConfirmOutcome(failedDocumentUpload(row));
    if (!row || row.uploadStatus !== "pending" || row.uploadStorageKey !== uploadKey) {
      throw new DomainError("conflict", "This file is no longer waiting for confirmation. Upload it again.");
    }
    const [queued] = await tx.select({ id: storageObjectDeletions.id }).from(storageObjectDeletions).where(and(
      eq(storageObjectDeletions.organizationId, ctx.organizationId), eq(storageObjectDeletions.storageProvider, row.storageProvider!),
      eq(storageObjectDeletions.storageBucket, row.storageBucket!), eq(storageObjectDeletions.storageKey, finalKey),
    )).limit(1);
    if (queued) throw new DomainError("conflict", "This file is no longer waiting for confirmation. Upload it again.");
    const candidates = [...new Set([...promotionCandidates(row.metadata), finalKey])];
    if (candidates.length > DOCUMENT_PROMOTION_CANDIDATE_LIMIT) throw new DomainError("conflict", "This upload has too many confirmation attempts. Upload the file again.");
    await tx.update(documents).set({ metadata: { ...metadataRecord(row.metadata), promotionCandidates: candidates } })
      .where(and(eq(documents.id, row.id), eq(documents.organizationId, ctx.organizationId)));
  });
}
