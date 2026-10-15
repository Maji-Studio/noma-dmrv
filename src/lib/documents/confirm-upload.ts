import { DOCUMENT_CONFIRM_DB_RESERVE_MS, DOCUMENT_CONFIRM_DEADLINE_MS } from "@/config/documents";
import { getDocumentById } from "@/data-access/documents";
import type { OrgContext } from "@/lib/auth/server";
import { DomainError, deadlineExceeded } from "@/lib/domain-errors";
import { confirmInspectedDocumentUpload } from "@/lib/operations/document-upload-confirm";
import { validationFailed } from "@/lib/operations/errors";
import { runOperation, type RunOptions } from "@/lib/operations/runner";
import { representDocument } from "@/lib/representations/documents";
import { confirmDocumentUploadInput } from "@/schemas/document-input";
import { API_DOCUMENT_OWNERS, allowsApiDocumentType } from "./api-owners";
import { failedDocumentUpload, type ApiConfirmOutcome } from "./confirm-outcome";
import { preparePendingDocumentUpload } from "./upload-preparation";

type ConfirmOptions = Pick<RunOptions, "audit" | "pool"> & { deadlineAt: number };

/**
 * Shared REST/MCP command. E1: deliberately forwards no idempotency option.
 * E2: immutable declarations and the locked state transition need no If-Match.
 */
export async function confirmDocumentUpload(ctx: OrgContext, input: unknown, options: ConfirmOptions): Promise<ApiConfirmOutcome> {
  const parsed = confirmDocumentUploadInput.safeParse(input);
  if (!parsed.success) throw validationFailed(parsed.error);
  const { ownerType, ownerId, documentId } = parsed.data;
  const deadlineAt = Math.min(options.deadlineAt, Date.now() + DOCUMENT_CONFIRM_DEADLINE_MS);
  if (Date.now() >= deadlineAt) throw deadlineExceeded("before confirming the upload");
  const row = await getDocumentById(ctx, documentId);
  if (!row || row.entityType !== API_DOCUMENT_OWNERS[ownerType].entityType || row.entityId !== ownerId) return { kind: "gone" };
  if (!allowsApiDocumentType(ownerType, row.documentType)) return { kind: "gone" };
  if (row.uploadStatus === "uploaded") return { kind: "uploaded", document: representDocument(row) };
  if (row.uploadStatus === "failed") return failedDocumentUpload(row);
  let prepared;
  try { prepared = await preparePendingDocumentUpload(ctx, row, undefined, deadlineAt); }
  catch (error) {
    if (error instanceof DomainError && error.code === "not_found") return { kind: "gone", pointer: "/ownerId" };
    throw error;
  }
  const deadlineMs = deadlineAt - Date.now();
  const outcome = (await runOperation(confirmInspectedDocumentUpload, ctx, { ...prepared.facts, cleanupDeadlineAt: deadlineAt }, {
    audit: options.audit, pool: options.pool, deadlineMs: Math.max(DOCUMENT_CONFIRM_DB_RESERVE_MS, deadlineMs),
  })).data;
  delete outcome.transitioned;
  return outcome;
}
