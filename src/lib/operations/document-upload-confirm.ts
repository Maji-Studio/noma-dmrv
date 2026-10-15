import { z } from "zod";
import { confirmDocumentUploadInTransaction, type InspectedUploadFacts } from "@/data-access/document-writes";
import { readDocumentForWrite } from "@/data-access/document-write-scope";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { DOCUMENT_STORAGE_DRAIN_BUDGET_MS } from "@/config/documents";
import { failedDocumentUpload, type ApiConfirmOutcome } from "@/lib/documents/confirm-outcome";
import { representDocument } from "@/lib/representations/documents";
import type { Operation, OperationEffect } from "./runner";

const input = z.custom<InspectedUploadFacts & { cleanupDeadlineAt: number }>();
/** Trusted facts only. Never register this operation or publish its input schema. */
export const confirmInspectedDocumentUpload: Operation<typeof input, ApiConfirmOutcome & { transitioned?: boolean }, OperationEffect | undefined> = {
  id: "confirm_document_upload", input, supportsDryRun: false,
  describe: (_input, outcome) => {
    if (outcome.kind === "gone" || outcome.kind === "failed" || (outcome.kind === "uploaded" && !outcome.transitioned)) return undefined;
    return { outcome: "updated", entityType: "document", entityIds: [outcome.document.id], versionBefore: outcome.document.version - 1,
      versionAfter: outcome.document.version, changedFields: ["uploadStatus", "version"] };
  },
  execute: async ({ ctx, tx, afterCommit, deadlineAt }, facts) => {
    const outcome = await confirmDocumentUploadInTransaction(ctx, tx, facts);
    afterCommit(async () => { await processPendingStorageObjectDeletions(ctx, { budgetMs: Math.max(0, Math.min(DOCUMENT_STORAGE_DRAIN_BUDGET_MS, Math.min(deadlineAt ?? Infinity, facts.cleanupDeadlineAt) - Date.now())) }); });
    if (outcome.kind === "gone") {
      // Another confirmation may have committed a refusal during inspection.
      const row = await readDocumentForWrite(ctx, tx, facts.documentId);
      if (row?.uploadStatus === "failed" && row.entityType === facts.entityType && row.entityId === facts.entityId) return failedDocumentUpload(row);
      return { ...outcome, ...(outcome.pointer ? { pointer: "/ownerId" } : {}) };
    }
    return { ...outcome, document: representDocument(outcome.document), ...(outcome.kind === "refused" && outcome.reason === "certification_locked" ? { pointer: "/ownerId" } : {}) };
  },
};
