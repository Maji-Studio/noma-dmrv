import { and, eq } from "drizzle-orm";
import { documents, storageObjectDeletions } from "@/db/schema";
import { UPLOAD_NOT_PENDING_MESSAGE, DOCUMENT_PROMOTION_CANDIDATE_LIMIT } from "@/config/documents";
import { bindingsMatch, type InspectedUploadFacts } from "./document-writes";
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

export type PromotionCandidateResult = { kind: "registered" } | { kind: "uploaded"; document: DocumentRow } | { kind: "failed"; document: DocumentRow } | { kind: "gone" };

/** Durable ownership before a PUT, serialized against confirm, expiry and deletion. */
export async function recordDocumentPromotionCandidate(ctx: OrgContext, facts: InspectedUploadFacts, finalKey: string): Promise<PromotionCandidateResult> {
  requireOrgScope(ctx);
  return db.transaction(async (tx): Promise<PromotionCandidateResult> => {
    const row = await readDocumentForWrite(ctx, tx, facts.documentId, true);
    if (!row || !bindingsMatch(row, facts)) return { kind: "gone" };
    if (row.uploadStatus === "uploaded" || row.uploadStatus === "failed") return { kind: row.uploadStatus, document: row };
    const [queued] = await tx.select({ id: storageObjectDeletions.id }).from(storageObjectDeletions).where(and(
      eq(storageObjectDeletions.organizationId, ctx.organizationId), eq(storageObjectDeletions.storageProvider, row.storageProvider!),
      eq(storageObjectDeletions.storageBucket, row.storageBucket!), eq(storageObjectDeletions.storageKey, finalKey),
    )).limit(1);
    if (queued) throw new DomainError("conflict", UPLOAD_NOT_PENDING_MESSAGE);
    const candidates = [...new Set([...promotionCandidates(row.metadata), finalKey])];
    if (candidates.length > DOCUMENT_PROMOTION_CANDIDATE_LIMIT) throw new DomainError("conflict", "This upload has too many confirmation attempts. Upload the file again.");
    await tx.update(documents).set({ metadata: { ...metadataRecord(row.metadata), promotionCandidates: candidates } })
      .where(and(eq(documents.id, row.id), eq(documents.organizationId, ctx.organizationId)));
    return { kind: "registered" };
  });
}
