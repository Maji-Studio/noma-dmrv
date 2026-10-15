import { getStorageProvider } from "@/lib/storage";
import { inspectUploadOwner, recordDocumentPromotionCandidate } from "@/data-access/document-upload-preparation";
import type { OrgContext } from "@/lib/auth/server";
import type { StorageProvider } from "@/lib/storage/types";
import { StorageError } from "@/lib/storage/types";
import { buildFinalStorageKey } from "@/lib/storage/keys";
import { DOCUMENT_CONFIRM_DB_RESERVE_MS, DOCUMENT_CONFIRM_DEADLINE_MS, DOCUMENT_CONFIRM_RETRY_AFTER_SECONDS } from "@/config/documents";
import { DomainError, deadlineExceeded } from "@/lib/domain-errors";
import { getDocumentById, type DocumentRow } from "@/data-access/documents";
import { documentNotFound } from "@/data-access/document-write-scope";
import { uploadFactsFor, type InspectedUploadFacts } from "@/data-access/document-writes";
import { failedDocumentUpload, type AppConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { inspectUploadBytes } from "@/lib/documents/inspection";
export type PreparedDocumentUpload = Exclude<AppConfirmOutcome, { kind: "refused" }> | { kind: "prepared"; facts: InspectedUploadFacts };

/** External I/O finishes before the runner acquires its transaction connection. */
export async function prepareDocumentUpload(ctx: OrgContext, documentId: string, provider?: StorageProvider, deadlineAt = Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS): Promise<PreparedDocumentUpload> {
  const row = await getDocumentById(ctx, documentId);
  if (!row) throw documentNotFound();
  if (row.uploadStatus === "uploaded") return { kind: "uploaded", document: row };
  if (row.uploadStatus === "failed") {
    const { reason, message } = failedDocumentUpload(row);
    throw new DomainError("conflict", message, { issues: [{ path: ["documentId"], code: reason, message }] });
  }
  return preparePendingDocumentUpload(ctx, row, provider, deadlineAt);
}

/** Prepare a row whose pending state was already checked by the caller. */
export async function preparePendingDocumentUpload(ctx: OrgContext, row: DocumentRow, provider: StorageProvider | undefined, deadlineAt: number): Promise<PreparedDocumentUpload> {
  const facts = uploadFactsFor(row);
  if (!facts.uploadKey || !Number.isSafeInteger(facts.sizeBytes) || facts.sizeBytes <= 0) throw new DomainError("conflict", "The document is not available in storage. Upload the file again.");
  if (await inspectUploadOwner(ctx, row)) return { kind: "prepared", facts: { ...facts, refusal: "certification_locked" } };
  provider ??= getStorageProvider();
  if (provider.name !== facts.provider || provider.bucket !== facts.bucket) throw new Error("Storage configuration does not match document");
  const storageBudget = deadlineAt - Date.now() - DOCUMENT_CONFIRM_DB_RESERVE_MS;
  if (storageBudget <= 0) throw deadlineExceeded("before inspecting the upload");
  const signal = AbortSignal.timeout(storageBudget);
  try {
    const object = await provider.readObjectBounded({ key: facts.uploadKey, maxBytes: facts.sizeBytes, signal });
    if (!object) throw new DomainError("conflict", "The uploaded file could not be found. Upload it again.", { retryable: true, retryAfterSeconds: DOCUMENT_CONFIRM_RETRY_AFTER_SECONDS });
    const refusal = inspectUploadBytes({ entityType: row.entityType, documentType: row.documentType, fileName: row.fileName, contentType: facts.contentType, sizeBytes: facts.sizeBytes, sha256: facts.sha256 ?? undefined }, object);
    if (refusal) return { kind: "prepared", facts: { ...facts, refusal } };
    const finalKey = buildFinalStorageKey({ organizationId: ctx.organizationId, documentId: row.id, entityType: row.entityType, entityId: row.entityId, documentType: row.documentType, fileName: row.fileName, sha256: object.sha256 });
    const candidate = await recordDocumentPromotionCandidate(ctx, facts, finalKey);
    if (candidate.kind === "failed") return failedDocumentUpload(candidate.document);
    if (candidate.kind !== "registered") return candidate;
    signal.throwIfAborted();
    await provider.putObject(finalKey, object.bytes, object.contentType, { checksumSha256: object.sha256, signal });
    signal.throwIfAborted();
    return { kind: "prepared", facts: { ...facts, finalKey, inspectedSha256: object.sha256, inspectedSizeBytes: object.sizeBytes, inspectedContentType: object.contentType } };
  } catch (error) {
    if (signal.aborted || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))) throw deadlineExceeded("while inspecting the upload");
    if (error instanceof StorageError && error.code === "object_too_large") return { kind: "prepared", facts: { ...facts, refusal: "size" } };
    if (error instanceof DomainError) throw error;
    // Provider errors can embed filenames, keys or signed URLs. Do not propagate
    // their free text to adapter logs or retain it as a cause.
    throw new StorageError("Document storage operation failed.", "document_storage_failed");
  }
}
