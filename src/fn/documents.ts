"use server";

import { presignRequestedUpload, type RequestUploadResult } from "@/lib/documents/presign-requested-upload";


import { DOCUMENT_CONFIRM_DEADLINE_MS, DOCUMENT_CONFIRM_DB_RESERVE_MS } from "@/config/documents";
import { listDocumentsForEntity, type DocumentRow } from "@/data-access/documents";
import { getStorageProvider } from "@/lib/storage";
import { documentFromConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { prepareDocumentUpload } from "@/lib/documents/upload-preparation";
import { confirmUploadSchema, requestUploadSchema } from "@/schemas/documents";
import { confirmDocumentUploadApp, deleteDocumentApp, reclassifyApplicationEvidenceApp, requestDocumentUploadApp, setDocumentVisibilityApp } from "@/lib/operations/documents";
import { runOperationInProcess } from "@/lib/operations/runner";
import type { ActionResult } from "@/types/actions";
import { hasOrgRole } from "@/lib/auth/server";
import { withAction } from "./with-action";


export type { RequestUploadResult } from "@/lib/documents/presign-requested-upload";

export async function requestUpload(input: unknown): Promise<ActionResult<RequestUploadResult>> {
  return withAction(async (ctx) => {
    const data = requestUploadSchema.parse(input);
    const provider = getStorageProvider();
    const row = await runOperationInProcess(requestDocumentUploadApp, ctx, { ...data, storageProvider: provider.name, storageBucket: provider.bucket });
    return presignRequestedUpload(provider, row, data);
  });
}
export async function confirmUpload(input: unknown): Promise<ActionResult<DocumentRow>> {
  return withAction(async (ctx) => {
    const { documentId } = confirmUploadSchema.parse(input);
    const startedAt = Date.now();
    const prepared = await prepareDocumentUpload(ctx, documentId, undefined, startedAt + DOCUMENT_CONFIRM_DEADLINE_MS);
    if (prepared.kind !== "prepared") return documentFromConfirmOutcome(prepared);
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

export async function canChangeDocumentVisibility(): Promise<ActionResult<boolean>> {
  return withAction(async (ctx) => hasOrgRole(ctx, "admin"));
}
