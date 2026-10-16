import type { AppConfirmOutcome, ConfirmOutcome } from "@/lib/documents/confirm-outcome";
import type { OperationEffect } from "./runner";

interface SavedDocument { id: string; version: number }

export const describeRequestedDocument = (input: object, document: SavedDocument): OperationEffect => ({
  outcome: "created", entityType: "document", entityIds: [document.id],
  versionBefore: null, versionAfter: document.version, changedFields: [],
});

export function describeConfirmedDocument(_input: unknown, outcome: (ConfirmOutcome<SavedDocument> | Extract<AppConfirmOutcome, { kind: "failed" }>) & { transitioned?: boolean }): OperationEffect | null {
  if (outcome.kind === "gone" || outcome.kind === "failed" || (outcome.kind === "uploaded" && !outcome.transitioned)) return null;
  return { outcome: "updated", entityType: "document", entityIds: [outcome.document.id], versionBefore: outcome.document.version - 1,
    versionAfter: outcome.document.version, changedFields: [] };
}

export const describeDeletedDocument = (input: { documentId: string; expectedVersion: number }): OperationEffect => ({
  outcome: "deleted", entityType: "document", entityIds: [input.documentId],
  versionBefore: input.expectedVersion, versionAfter: null, changedFields: [],
});

export const describeUpdatedDocument = (input: { expectedVersion: number }, document: SavedDocument): OperationEffect => ({
  outcome: "updated", entityType: "document", entityIds: [document.id],
  versionBefore: input.expectedVersion, versionAfter: document.version, changedFields: [],
});
