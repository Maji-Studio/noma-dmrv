import { confirmInspectedUpload, drainBudgetMs } from "./document-confirm";
import { z } from "zod";
import { requestUploadSchema, deleteDocumentSchema, setVisibilitySchema, updateApplicationEvidenceMetadataSchema } from "@/schemas/documents";
import { requestDocumentUploadInTransaction, type InspectedUploadFacts } from "@/data-access/document-writes";
import { deleteDocumentInTransaction, setDocumentVisibilityInTransaction, updateApplicationEvidenceMetadataInTransaction } from "@/data-access/document-mutations";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import type { DocumentRow } from "@/data-access/documents";
import type { AppConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { linkDocumentActivity } from "./activity-links";
import { describeRequestedDocument, describeConfirmedDocument, describeDeletedDocument, describeUpdatedDocument } from "./document-effects";
import type { Operation } from "./runner";

const requestInput = requestUploadSchema.safeExtend({ storageProvider: z.string(), storageBucket: z.string() });
export const requestDocumentUploadApp: Operation<typeof requestInput, DocumentRow> = {
  id: "request_document_upload_app", input: requestInput, supportsDryRun: false,
  describe: describeRequestedDocument,
  execute: async ({ ctx, tx, activity }, input) => {
    const document = await requestDocumentUploadInTransaction(ctx, tx, input);
    linkDocumentActivity(activity, document);
    return document;
  },
};
// This trusted operation is unregistered. Adapters construct facts from stored
// declarations and inspected bytes; no action accepts inspection facts as input.
const confirmInput = z.custom<InspectedUploadFacts & { cleanupDeadlineAt?: number }>();
export const confirmDocumentUploadApp: Operation<typeof confirmInput, AppConfirmOutcome & { transitioned?: boolean }> = {
  id: "confirm_document_upload_app", input: confirmInput, supportsDryRun: false,
  describe: describeConfirmedDocument,
  execute: confirmInspectedUpload,
};
const deleteInput = deleteDocumentSchema.extend({ expectedVersion: z.number().int().positive() });
export const deleteDocumentApp: Operation<typeof deleteInput, DocumentRow> = {
  id: "delete_document_app", input: deleteInput, supportsDryRun: false,
  describe: describeDeletedDocument,
  execute: async ({ ctx, tx, afterCommit, deadlineAt, activity }, input) => {
    const document = await deleteDocumentInTransaction(ctx, tx, input);
    linkDocumentActivity(activity, document);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx, { budgetMs: drainBudgetMs(deadlineAt) }); });
    return document;
  },
};
const visibilityInput = setVisibilitySchema.extend({ expectedVersion: z.number().int().positive() });
const reclassifyInput = updateApplicationEvidenceMetadataSchema.safeExtend({ expectedVersion: z.number().int().positive() });
export const setDocumentVisibilityApp: Operation<typeof visibilityInput, DocumentRow> = {
  id: "set_document_visibility_app", input: visibilityInput, supportsDryRun: false,
  describe: describeUpdatedDocument,
  execute: async ({ ctx, tx, activity }, input) => {
    const document = await setDocumentVisibilityInTransaction(ctx, tx, input);
    linkDocumentActivity(activity, document);
    return document;
  },
};
export const reclassifyApplicationEvidenceApp: Operation<typeof reclassifyInput, DocumentRow> = {
  id: "reclassify_application_evidence_app", input: reclassifyInput, supportsDryRun: false,
  describe: describeUpdatedDocument,
  execute: async ({ ctx, tx, activity }, input) => {
    const document = await updateApplicationEvidenceMetadataInTransaction(ctx, tx, input);
    linkDocumentActivity(activity, document);
    return document;
  },
};
