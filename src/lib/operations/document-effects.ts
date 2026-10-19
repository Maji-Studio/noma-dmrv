import type { AppConfirmOutcome, ConfirmOutcome } from "@/lib/documents/confirm-outcome";
import type { OperationDescription } from "@/lib/operation-effect";

interface SavedDocument { id: string; version: number }

export const describeRequestedDocument = (input: object, document: SavedDocument): OperationDescription => ({
  outcome: "created", entityType: "document", entityIds: [document.id],
  versionBefore: null, versionAfter: document.version,
});

export function describeConfirmedDocument(_input: unknown, outcome: (ConfirmOutcome<SavedDocument> | Extract<AppConfirmOutcome, { kind: "failed" }>) & { transitioned?: boolean }): OperationDescription | null {
  if (outcome.kind === "gone" || outcome.kind === "failed" || (outcome.kind === "uploaded" && !outcome.transitioned)) return null;
  return { outcome: "updated", entityType: "document", entityIds: [outcome.document.id], versionBefore: outcome.document.version - 1,
    versionAfter: outcome.document.version };
}

export const describeDeletedDocument = (input: { documentId: string; expectedVersion: number }): OperationDescription => ({
  outcome: "deleted", entityType: "document", entityIds: [input.documentId],
  versionBefore: input.expectedVersion, versionAfter: null,
});

export const describeUpdatedDocument = (input: { expectedVersion: number }, document: SavedDocument): OperationDescription => ({
  outcome: "updated", entityType: "document", entityIds: [document.id],
  versionBefore: input.expectedVersion, versionAfter: document.version,
});
