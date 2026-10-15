import type { DocumentRow } from "@/data-access/documents";
import { DomainError } from "@/lib/domain-errors";
import type { UploadRefusalReason } from "./inspection";
export type ConfirmOutcome = { kind: "uploaded"; document: DocumentRow } | { kind: "refused"; reason: UploadRefusalReason; pointer: string; document: DocumentRow; message: string } | { kind: "gone"; pointer?: string };
export const REFUSAL_POINTERS: Record<UploadRefusalReason, string> = { size: "/sizeBytes", type: "/contentType", checksum: "/sha256", format: "/fileName", certification_locked: "/entityId" };
export const REFUSAL_MESSAGES: Record<Exclude<UploadRefusalReason, "certification_locked">, string> = {
  size: "The document upload could not be completed. Upload the file again.",
  type: "The uploaded file type is not allowed for this document. Choose another file.",
  checksum: "The document upload could not be completed. Upload the file again.",
  format: "Readings files must use CSV format.",
};
/** Called after the runner commits: a refused transition must not roll back. */
export function documentFromConfirmOutcome(outcome: ConfirmOutcome): DocumentRow {
  if (outcome.kind === "uploaded") return outcome.document;
  if (outcome.kind === "gone") throw new DomainError("not_found", "Document not found", { issues: [{ path: [outcome.pointer?.slice(1) ?? "documentId"], code: "not_found", message: "Document not found" }] });
  const code = outcome.reason === "certification_locked" ? "certification_locked" : "validation_failed";
  throw new DomainError(code, outcome.message, { issues: [{ path: [outcome.pointer.slice(1)], code: outcome.reason, message: outcome.message }] });
}
