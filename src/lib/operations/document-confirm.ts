import { DOCUMENT_STORAGE_DRAIN_BUDGET_MS } from "@/config/documents";
import { confirmDocumentUploadInTransaction, type InspectedUploadFacts } from "@/data-access/document-writes";
import { readDocumentForWrite } from "@/data-access/document-write-scope";
import { processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { failedDocumentUpload } from "@/lib/documents/confirm-outcome";
import type { OperationScope } from "./runner";

export function drainBudgetMs(deadlineAt?: number, cleanupDeadlineAt?: number): number {
  return Math.max(0, Math.min(DOCUMENT_STORAGE_DRAIN_BUDGET_MS, Math.min(deadlineAt ?? Infinity, cleanupDeadlineAt ?? Infinity) - Date.now()));
}

/** Shared app/API transition and post-commit cleanup, including concurrent refusals. */
export async function confirmInspectedUpload({ ctx, tx, afterCommit, deadlineAt }: OperationScope, facts: InspectedUploadFacts & { cleanupDeadlineAt?: number }) {
  const outcome = await confirmDocumentUploadInTransaction(ctx, tx, facts);
  afterCommit(async () => { await processPendingStorageObjectDeletions(ctx, { budgetMs: drainBudgetMs(deadlineAt, facts.cleanupDeadlineAt) }); });
  if (outcome.kind === "gone") {
    const row = await readDocumentForWrite(ctx, tx, facts.documentId);
    if (row?.uploadStatus === "failed" && row.entityType === facts.entityType && row.entityId === facts.entityId) return failedDocumentUpload(row);
  }
  return outcome;
}
