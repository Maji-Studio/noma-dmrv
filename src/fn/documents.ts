"use server";

import { MILLISECONDS_PER_SECOND } from "@/config/api-keys";
import { DOCUMENT_CONFIRM_DEADLINE_MS, DOCUMENT_CONFIRM_DB_RESERVE_MS } from "@/config/documents";
import { listDocumentsForEntity, type DocumentRow } from "@/data-access/documents";
import { getStorageProvider } from "@/lib/storage";
import { DomainError } from "@/lib/domain-errors";
import { documentFromConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { prepareDocumentUpload } from "@/lib/documents/upload-preparation";
import { metadataRecord } from "@/lib/documents/metadata";
import { confirmUploadSchema, requestUploadSchema } from "@/schemas/documents";
import { confirmDocumentUploadApp, deleteDocumentApp, reclassifyApplicationEvidenceApp, requestDocumentUploadApp, setDocumentVisibilityApp } from "@/lib/operations/documents";
import { runOperationInProcess } from "@/lib/operations/runner";
import type { ActionResult } from "@/types/actions";
import { withAction } from "./with-action";


export interface RequestUploadResult {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
  storageKey: string;
  metadata: Record<string, unknown>;
}
export async function requestUpload(input: unknown): Promise<ActionResult<RequestUploadResult>> {
  return withAction(async (ctx) => {
    const data = requestUploadSchema.parse(input);
    const provider = getStorageProvider();
    const row = await runOperationInProcess(requestDocumentUploadApp, ctx, { ...data, storageProvider: provider.name, storageBucket: provider.bucket });
    const expiresInSeconds = Math.floor((row.uploadExpiresAt!.getTime() - Date.now()) / MILLISECONDS_PER_SECOND);
    if (expiresInSeconds <= 0) throw new DomainError("conflict", "This file is no longer waiting for confirmation. Upload it again.", { retryable: true });
    const presign = await provider.createUploadUrl({ key: row.uploadStorageKey!, contentType: data.contentType, maxBytes: data.sizeBytes, expiresInSeconds });
    return { documentId: row.id, uploadUrl: presign.url, headers: presign.headers, expiresAt: row.uploadExpiresAt!.toISOString(), storageKey: row.uploadStorageKey!, metadata: metadataRecord(row.metadata) };
  });
}
export async function confirmUpload(input: unknown): Promise<ActionResult<DocumentRow>> {
  return withAction(async (ctx) => {
    const { documentId } = confirmUploadSchema.parse(input);
    const startedAt = Date.now();
    const prepared = await prepareDocumentUpload(ctx, documentId, undefined, startedAt + DOCUMENT_CONFIRM_DEADLINE_MS);
    if (prepared.kind === "uploaded") return prepared.document;
    const outcome = await runOperationInProcess(confirmDocumentUploadApp, ctx, { ...prepared.facts, cleanupDeadlineAt: startedAt + DOCUMENT_CONFIRM_DEADLINE_MS }, { deadlineMs: Math.max(DOCUMENT_CONFIRM_DB_RESERVE_MS, DOCUMENT_CONFIRM_DEADLINE_MS - (Date.now() - startedAt)) });
    return documentFromConfirmOutcome(outcome);
  });
}
export async function setDocumentVisibility(input: unknown): Promise<ActionResult<DocumentRow>> {
  return withAction((ctx) => runOperationInProcess(setDocumentVisibilityApp, ctx, input));
}
export async function updateApplicationEvidenceMetadata(input: unknown): Promise<ActionResult<DocumentRow>> {
  return withAction((ctx) => runOperationInProcess(reclassifyApplicationEvidenceApp, ctx, input));
}
export async function deleteDocument(input: unknown): Promise<ActionResult<{ id: string }>> {
  return withAction(async (ctx) => {
    const row = await runOperationInProcess(deleteDocumentApp, ctx, input);
    return { id: row.id };
  });
}
export async function getDocumentsForEntity(entityType: string, entityId: string): Promise<ActionResult<DocumentRow[]>> {
  return withAction((ctx) => listDocumentsForEntity(ctx, entityType, entityId));
}
