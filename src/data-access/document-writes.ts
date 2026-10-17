import { bumpEmissionEntryEvidence } from "./emission-entry-lock";
import type { CaptureActivity } from "@/lib/activity-changes";
import { nextVersion } from "./row-version";
/**
 * Document write lock order:
 * 1. Discover the owner, lineage target and ancestors without row locks; lock
 *    the target's certification artifacts in sorted order.
 * 2. Ancestors FOR SHARE (sample: batch or legacy run; application: delivery;
 *    internal children: archive-bearing parent).
 * 3. Owner FOR SHARE.
 * 4. Mirror advisory lock, for delete only.
 * 5. Document FOR UPDATE, except on request.
 * 6. Revalidate parent identity, archive state and lineage against the artifact
 *    locks held. A changed parent is a retryable conflict. Never lock a newly
 *    discovered artifact after a row lock. Delete permits archived owners.
 *
 * Archive serializes on SHARE versus NO KEY UPDATE. Parent retirement takes
 * owner, mirror, document in that order; mirroring never takes an owner lock.
 * Sample and delivery writers take artifacts before rows. Legacy application,
 * feedstock, order and production-run writers still have artifact/row inversions; the
 * runner retries only its own transactions. Application update/delete are not
 * on the runner: Postgres may abort that non-retried transaction in a deadlock
 * with an application or delivery document write. See data/lock-order in
 * docs/open-questions-architecture.md for the remaining inversions.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import { documents, storageObjectDeletions } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { UPLOAD_NOT_PENDING_MESSAGE, DOCUMENT_UPLOAD_LEASE_MS, DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import { DomainError } from "@/lib/domain-errors";
import { buildUploadKey } from "@/lib/storage/keys";
import { buildDocumentMetadata, metadataRecord } from "@/lib/documents/metadata";
import { REFUSAL_MESSAGES, REFUSAL_POINTERS, type ConfirmOutcome } from "@/lib/documents/confirm-outcome";
import type { UploadRefusalReason } from "@/lib/documents/inspection";
import { requestUploadSchema, isAllowedMime, isProductionReadingsCsvFormat, maxBytesFor, type RequestUploadInput } from "@/schemas/documents";
import type { DocumentRow } from "./documents";
import { changedOwner, assertDocumentOwnerWritable, lockDocumentOwner, readDocumentForWrite } from "./document-write-scope";
import { enqueueDocumentKeys, enqueuePromotionCandidates } from "./document-storage-deletions";
import { enqueueStorageObjectDeletion } from "./storage-object-deletions";
import { requireOrgScope } from "./utils";

export interface RequestDocumentUploadInput extends RequestUploadInput { storageProvider: string; storageBucket: string }
export async function requestDocumentUploadInTransaction(ctx: OrgContext, tx: DbTransaction, input: RequestDocumentUploadInput): Promise<DocumentRow> {
  requireOrgScope(ctx);
  const data = requestUploadSchema.parse(input);
  if (!isAllowedMime(data.documentType, data.contentType)) throw new DomainError("validation_failed", "This file type is not allowed for this document. Choose another file.");
  if (data.sizeBytes > maxBytesFor(data.documentType)) throw new DomainError("validation_failed", "The document upload could not be completed. Upload the file again.");
  if (data.entityType === "production_run" && data.documentType === "sensor_data" && !isProductionReadingsCsvFormat(data)) throw new DomainError("validation_failed", "Readings files must use CSV format.");
  const scope = await lockDocumentOwner(ctx, tx, data.entityType, data.entityId);
  await assertDocumentOwnerWritable(ctx, tx, scope);
  const id = randomUUID();
  const key = buildUploadKey({ organizationId: ctx.organizationId, documentId: id });
  const [row] = await tx.insert(documents).values({
    id, organizationId: ctx.organizationId, entityType: data.entityType, entityId: data.entityId, documentType: data.documentType,
    storageProvider: input.storageProvider, storageBucket: input.storageBucket, storageKey: key, uploadStorageKey: key,
    uploadExpiresAt: new Date(Date.now() + DOCUMENT_UPLOAD_LEASE_MS), version: 1, uploadStatus: "pending", visibility: "private",
    fileName: data.fileName, fileSizeBytes: data.sizeBytes, mimeType: data.contentType,
    capturedAt: data.capturedAt ? new Date(data.capturedAt) : null, description: data.description ?? null, createdBy: ctx.userId,
    // Keep the immutable declaration separate from the inspected columns.
    metadata: { ...buildDocumentMetadata(data), uploadDeclaration: { sizeBytes: data.sizeBytes, contentType: data.contentType, sha256: data.sha256 ?? null,
      gpsLatitude: data.gpsLatitude ?? null, gpsLongitude: data.gpsLongitude ?? null } },
  }).returning();
  return row;
}

export interface InspectedUploadFacts {
  documentId: string; provider: string; bucket: string; uploadKey: string;
  entityType: string; entityId: string; documentType: DocumentRow["documentType"]; contentType: string; sizeBytes: number; sha256: string | null;
  finalKey?: string; inspectedSizeBytes?: number; inspectedSha256?: string; inspectedContentType?: string;
  refusal?: UploadRefusalReason;
}
export function uploadFactsFor(row: DocumentRow): InspectedUploadFacts {
  const declaration = metadataRecord(metadataRecord(row.metadata).uploadDeclaration);
  return { documentId: row.id, provider: row.storageProvider!, bucket: row.storageBucket!, uploadKey: row.uploadStorageKey!,
    entityType: row.entityType, entityId: row.entityId, documentType: row.documentType,
    contentType: declaration.contentType as string, sizeBytes: declaration.sizeBytes as number, sha256: declaration.sha256 as string | null };
}
export function bindingsMatch(row: DocumentRow, facts: InspectedUploadFacts): boolean {
  const actual = uploadFactsFor(row);
  return (Object.keys(actual) as (keyof InspectedUploadFacts)[]).every((key) => actual[key] === facts[key]);
}
async function cleanupFinal(ctx: OrgContext, tx: DbTransaction, facts: InspectedUploadFacts, row?: DocumentRow, liveKey?: string | null) {
  if (row) await enqueuePromotionCandidates(ctx, tx, row, liveKey, facts.finalKey);
  else if (facts.finalKey && facts.finalKey !== liveKey) await enqueueStorageObjectDeletion(ctx, tx, { storageProvider: facts.provider, storageBucket: facts.bucket, storageKey: facts.finalKey,
    notBefore: new Date(Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS) });
}
export async function confirmDocumentUploadInTransaction(ctx: OrgContext, tx: DbTransaction, facts: InspectedUploadFacts, capture?: CaptureActivity): Promise<ConfirmOutcome & { transitioned?: boolean }> {
  requireOrgScope(ctx);
  const discovered = await readDocumentForWrite(ctx, tx, facts.documentId);
  if (!discovered) { await cleanupFinal(ctx, tx, facts); return { kind: "gone" }; }
  let scope;
  try { scope = await lockDocumentOwner(ctx, tx, discovered.entityType, discovered.entityId); }
  catch (error) {
    if (!(error instanceof DomainError) || error.code !== "not_found") throw error;
    await cleanupFinal(ctx, tx, facts, discovered, discovered.uploadStatus === "uploaded" ? discovered.storageKey : null); return { kind: "gone" };
  }
  const row = await readDocumentForWrite(ctx, tx, facts.documentId, true);
  if (!row || row.entityType !== discovered.entityType || row.entityId !== discovered.entityId || !bindingsMatch(row, facts)) { await cleanupFinal(ctx, tx, facts, row, row?.uploadStatus === "uploaded" ? row.storageKey : null); return { kind: "gone" }; }
  if (row.uploadStatus === "uploaded") {
    await cleanupFinal(ctx, tx, facts, row, row.storageKey);
    return facts.finalKey && facts.finalKey !== row.storageKey ? { kind: "gone" } : { kind: "uploaded", document: row, transitioned: false };
  }
  if (row.uploadStatus !== "pending") { await cleanupFinal(ctx, tx, facts, row); return { kind: "gone" }; }
  let reason = facts.refusal;
  let pointer = reason ? REFUSAL_POINTERS[reason] : "";
  let message = reason && reason !== "certification_locked" ? REFUSAL_MESSAGES[reason] : "";
  try { await assertDocumentOwnerWritable(ctx, tx, scope); }
  catch (error) {
    if (error instanceof DomainError && error.code === "not_found") {
      await cleanupFinal(ctx, tx, facts, row);
      return { kind: "gone", pointer: `/${scope.field}` };
    }
    if (!(error instanceof DomainError) || error.code !== "certification_locked") throw error;
    reason = "certification_locked"; pointer = `/${scope.field}`; message = error.message;
  }
  // An advisory preparation refusal cannot override the authoritative locked check.
  if (reason === "certification_locked" && !message) throw changedOwner();
  if (!reason && (!facts.finalKey || !facts.inspectedSha256 || facts.inspectedSizeBytes === undefined || facts.inspectedContentType === undefined)) throw new Error("Missing inspected upload facts");
  if (!reason) {
    const [queued] = await tx.select({ id: storageObjectDeletions.id }).from(storageObjectDeletions).where(and(
      eq(storageObjectDeletions.organizationId, ctx.organizationId), eq(storageObjectDeletions.storageProvider, facts.provider),
      eq(storageObjectDeletions.storageBucket, facts.bucket), eq(storageObjectDeletions.storageKey, facts.finalKey!),
    )).limit(1);
    if (queued) throw new DomainError("conflict", UPLOAD_NOT_PENDING_MESSAGE);
  }
  const [saved] = await tx.update(documents).set({
    version: nextVersion(documents.version), updatedAt: new Date(),
    ...(reason ? { uploadStatus: "failed" as const, metadata: { ...metadataRecord(row.metadata), uploadFailure: { reason } } } : {
      uploadStatus: "uploaded" as const, storageKey: facts.finalKey, checksumSha256: facts.inspectedSha256,
      fileSizeBytes: facts.inspectedSizeBytes, mimeType: facts.inspectedContentType,
    }),
  }).where(and(eq(documents.id, row.id), eq(documents.organizationId, ctx.organizationId))).returning();
  // Keep the committed content-addressed key out of every cleanup path.
  await enqueueDocumentKeys(ctx, tx, { ...row, metadata: {}, storageKey: row.uploadStorageKey });
  await cleanupFinal(ctx, tx, facts, row, reason ? null : saved.storageKey);
  capture?.(saved.id, row, saved);
  if (reason) {
    return { kind: "refused", reason, pointer, message, document: saved };
  }
  await bumpEmissionEntryEvidence(ctx, tx, saved.entityType, saved.entityId);
  return { kind: "uploaded", document: saved, transitioned: true };
}
