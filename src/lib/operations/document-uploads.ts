import { requestDocumentUploadInTransaction } from "@/data-access/document-writes";
import { API_DOCUMENT_OWNERS } from "@/lib/documents/api-owners";
import { representDocument, type DocumentRepresentation } from "@/lib/representations/documents";
import { getStorageProvider } from "@/lib/storage";
import { DomainError } from "@/lib/domain-errors";
import { requestDocumentUploadInput } from "@/schemas/document-input";
import { linkDocumentActivity } from "./activity-links";
import { describeRequestedDocument } from "./document-effects";
import type { Operation } from "./runner";

export const requestDocumentUpload: Operation<typeof requestDocumentUploadInput, DocumentRepresentation> = {
  id: "request_document_upload",
  input: requestDocumentUploadInput,
  supportsDryRun: false,
  describe: describeRequestedDocument,
  execute: async ({ ctx, tx, activity }, { ownerType, ownerId, capturedAt, ...declaration }) => {
    const provider = getStorageProvider();
    try {
      const document = await requestDocumentUploadInTransaction(ctx, tx, {
        ...declaration, entityType: API_DOCUMENT_OWNERS[ownerType].entityType, entityId: ownerId,
        capturedAt: capturedAt ? new Date(capturedAt).toISOString() : undefined,
        storageProvider: provider.name, storageBucket: provider.bucket,
      });
      linkDocumentActivity(activity, document);
      return representDocument(document);
    } catch (error) {
      if (error instanceof DomainError && (error.code === "not_found" || error.code === "certification_locked")) {
        throw new DomainError(error.code, error.message, { issues: [{ path: ["ownerId"], code: error.code, message: error.message }] });
      }
      throw error;
    }
  },
};
