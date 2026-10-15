import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { documents } from "@/db/schema";
import { DOCUMENT_UPLOAD_LEASE_MS, DOCUMENT_UPLOAD_MAX_LIFETIME_MS } from "@/config/documents";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError } from "@/lib/domain-errors";
import { metadataRecord } from "@/lib/documents/metadata";
import { assertDocumentOwnerWritable, lockDocumentOwner, readDocumentForWrite } from "./document-write-scope";
import { requireOrgScope } from "./utils";

export type UploadUnavailableReason = "uploaded" | "failed" | "deleted" | "expired" | "owner_archived" | "certification_locked";
export type RenewedDocumentUpload = { kind: "unavailable"; reason: UploadUnavailableReason } | {
  kind: "renewed"; key: string; contentType: string; sizeBytes: number; expiresAt: string; provider: string; bucket: string;
};

/** Same artifacts, owner and document lock order as request and confirm. */
export async function renewDocumentUploadInTransaction(ctx: OrgContext, tx: DbTransaction, documentId: string): Promise<RenewedDocumentUpload> {
  requireOrgScope(ctx);
  const discovered = await readDocumentForWrite(ctx, tx, documentId);
  if (!discovered) return { kind: "unavailable", reason: "deleted" };
  let scope;
  try { scope = await lockDocumentOwner(ctx, tx, discovered.entityType, discovered.entityId); }
  catch (error) {
    if (!(error instanceof DomainError) || error.code !== "not_found") throw error;
    return { kind: "unavailable", reason: "owner_archived" };
  }
  // Renewal and the pending-upload sweep serialize on this row.
  const row = await readDocumentForWrite(ctx, tx, documentId, true);
  if (!row || row.entityType !== discovered.entityType || row.entityId !== discovered.entityId) return { kind: "unavailable", reason: "deleted" };
  if (row.uploadStatus === "uploaded") return { kind: "unavailable", reason: "uploaded" };
  const declaration = metadataRecord(metadataRecord(row.metadata).uploadDeclaration);
  const failure = metadataRecord(metadataRecord(row.metadata).uploadFailure);
  if (row.uploadStatus === "failed") return { kind: "unavailable", reason: failure.reason === "expired" ? "expired" : "failed" };
  try { await assertDocumentOwnerWritable(ctx, tx, scope); }
  catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === "not_found") return { kind: "unavailable", reason: "owner_archived" };
    if (error.code === "certification_locked") return { kind: "unavailable", reason: "certification_locked" };
    throw error;
  }
  if (!row.uploadStorageKey || !row.storageProvider || !row.storageBucket || typeof declaration.contentType !== "string" || typeof declaration.sizeBytes !== "number") return { kind: "unavailable", reason: "expired" };
  const now = Date.now();
  if (now >= row.createdAt.getTime() + DOCUMENT_UPLOAD_MAX_LIFETIME_MS) return { kind: "unavailable", reason: "expired" };
  const expiresAt = new Date(Math.min(now + DOCUMENT_UPLOAD_LEASE_MS, row.createdAt.getTime() + DOCUMENT_UPLOAD_MAX_LIFETIME_MS));
  await tx.update(documents).set({ uploadExpiresAt: expiresAt })
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, ctx.organizationId)));
  return { kind: "renewed", key: row.uploadStorageKey, contentType: declaration.contentType, sizeBytes: declaration.sizeBytes,
    expiresAt: expiresAt.toISOString(), provider: row.storageProvider, bucket: row.storageBucket };
}
