import { confirmInspectedUpload } from "./document-confirm";
import { z } from "zod";
import { type InspectedUploadFacts } from "@/data-access/document-writes";
import { type ApiConfirmOutcome } from "@/lib/documents/confirm-outcome";
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
  execute: async (scope, facts) => {
    const outcome = await confirmInspectedUpload(scope, facts);
    if (outcome.kind === "failed") return outcome;
    if (outcome.kind === "gone") return { ...outcome, ...(outcome.pointer ? { pointer: "/ownerId" } : {}) };
    return { ...outcome, document: representDocument(outcome.document), ...(outcome.kind === "refused" && outcome.reason === "certification_locked" ? { pointer: "/ownerId" } : {}) };
  },
};
