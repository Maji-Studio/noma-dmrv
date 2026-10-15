import { z } from "zod";
import { renewDocumentUploadInTransaction, type RenewedDocumentUpload } from "@/data-access/document-upload-renewal";
import { uuidSchema } from "@/schemas/helpers";
import type { Operation } from "./runner";

const input = z.strictObject({ documentId: uuidSchema() });
/** Private, keyless bookkeeping. Renewal changes no representation or audit effect. */
export const renewDocumentUpload: Operation<typeof input, RenewedDocumentUpload> = {
  id: "renew_document_upload", input, supportsDryRun: false,
  execute: ({ ctx, tx }, { documentId }) => renewDocumentUploadInTransaction(ctx, tx, documentId),
};
