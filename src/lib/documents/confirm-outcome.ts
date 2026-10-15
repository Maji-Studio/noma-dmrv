import type { DocumentRow } from "@/data-access/documents";
import { DomainError } from "@/lib/domain-errors";
import type { UploadRefusalReason } from "./inspection";
import type { DocumentRepresentation } from "@/lib/representations/documents";
import { RECORD_FILES_LOCKED_MESSAGE } from "@/lib/certification/lineage-lock-message";
import { metadataRecord } from "./metadata";
export type ConfirmOutcome<Document = DocumentRow> = { kind: "uploaded"; document: Document } | { kind: "refused"; reason: UploadRefusalReason; pointer: string; document: Document; message: string } | { kind: "gone"; pointer?: string };
export type ApiConfirmOutcome = ConfirmOutcome<DocumentRepresentation> | { kind: "failed"; reason: string; message: string };
export const REFUSAL_POINTERS: Record<UploadRefusalReason, string> = { size: "/sizeBytes", type: "/contentType", checksum: "/sha256", format: "/fileName", certification_locked: "/entityId" };
export const REFUSAL_MESSAGES: Record<Exclude<UploadRefusalReason, "certification_locked">, string> = {
  size: "The document upload could not be completed. Upload the file again.",
  type: "The uploaded file type is not allowed for this document. Choose another file.",
  checksum: "The document upload could not be completed. Upload the file again.",
  format: "Readings files must use CSV format.",
};
const FAILED_UPLOAD_MESSAGES: Record<string, string> = { ...REFUSAL_MESSAGES, certification_locked: RECORD_FILES_LOCKED_MESSAGE, expired: "This upload expired. Request a new upload to try again." };

/** The persisted reason survives a retry without exposing raw metadata. */
export function failedDocumentUpload(row: DocumentRow): Extract<ApiConfirmOutcome, { kind: "failed" }> {
  const stored = metadataRecord(metadataRecord(row.metadata).uploadFailure).reason;
  const reason = typeof stored === "string" ? stored : "failed";
  return { kind: "failed", reason, message: Object.hasOwn(FAILED_UPLOAD_MESSAGES, reason) ? FAILED_UPLOAD_MESSAGES[reason] : "This file is no longer waiting for confirmation. Upload it again." };
}
/** Called after the runner commits: a refused transition must not roll back. */
export function documentFromConfirmOutcome(outcome: ConfirmOutcome): DocumentRow {
  if (outcome.kind === "uploaded") return outcome.document;
  if (outcome.kind === "gone") throw new DomainError("not_found", "Document not found", { issues: [{ path: [outcome.pointer?.slice(1) ?? "documentId"], code: "not_found", message: "Document not found" }] });
  const code = outcome.reason === "certification_locked" ? "certification_locked" : "validation_failed";
  throw new DomainError(code, outcome.message, { issues: [{ path: [outcome.pointer.slice(1)], code: outcome.reason, message: outcome.message }] });
}

export type MappedConfirmOutcome = { status: 200; data: DocumentRepresentation } | { status: 404 | 409 | 422; error: DomainError };

/** Both API adapters render this mapping only after the refusal transaction commits. */
export function mapConfirmOutcome(outcome: ApiConfirmOutcome): MappedConfirmOutcome {
  if (outcome.kind === "uploaded") return { status: 200, data: outcome.document };
  if (outcome.kind === "gone") return { status: 404, error: new DomainError("not_found", "Document not found", { issues: [{ path: [outcome.pointer?.slice(1) ?? "documentId"], code: "not_found", message: "Document not found" }] }) };
  if (outcome.kind === "failed") return { status: 409, error: new DomainError("conflict", outcome.message, { issues: [{ path: ["documentId"], code: outcome.reason, message: outcome.message }] }) };
  const locked = outcome.reason === "certification_locked";
  return { status: locked ? 409 : 422, error: new DomainError(locked ? "certification_locked" : "validation_failed", outcome.message, { issues: [{ path: [outcome.pointer.slice(1)], code: outcome.reason, message: outcome.message }] }) };
}
