import { z } from "zod";
import { API_DOCUMENT_OWNER_TYPES, allowsApiDocumentType } from "@/lib/documents/api-owners";
import { DOCUMENT_UPLOAD_MAX_BYTES } from "@/lib/documents/upload-policy";
import { getFutureEventFields } from "@/lib/future-event-times";
import { isAllowedMime, maxBytesFor } from "./documents";
import { API_DOCUMENT_TYPES } from "@/lib/documents/api-types";
import { offsetInstantSchema } from "./event-instant";
import { requiredLatitudeSchema, requiredLongitudeSchema, gpsPairSuperRefine, uuidSchema } from "./helpers";

const FILE_NAME_MAX_LENGTH = 255;
const CONTENT_TYPE_MAX_LENGTH = 255;
const DESCRIPTION_MAX_LENGTH = 2000;
export const DOCUMENT_CAPTURE_FUTURE_MESSAGE = "Capture time cannot be in the future. Enter a time at or before now.";

const ownerFields = {
  ownerType: z.enum(API_DOCUMENT_OWNER_TYPES).describe("Record type owning this document."),
  ownerId: uuidSchema().describe("Owning record UUID."),
};

/** Public client declaration. Storage configuration and inspection facts are server owned. */
export const requestDocumentUploadBodyInput = z.strictObject({
  documentType: z.enum(API_DOCUMENT_TYPES).describe("Document classification allowed for this owner."),
  fileName: z.string().min(1).max(FILE_NAME_MAX_LENGTH).describe("Original file name, untrusted plain text."),
  contentType: z.string().min(1).max(CONTENT_TYPE_MAX_LENGTH).describe("MIME type allowed for this document classification. Empty and text/plain are refused."),
  sizeBytes: z.number().int().min(1).max(DOCUMENT_UPLOAD_MAX_BYTES).describe("Exact declared file length in bytes."),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).describe("Required SHA-256 of the file bytes, 64 lowercase hexadecimal characters."),
  capturedAt: offsetInstantSchema().optional().describe("Capture instant with explicit offset. Cannot be in the future."),
  gpsLatitude: requiredLatitudeSchema.optional().describe("Declared latitude in decimal degrees; supply with gpsLongitude."),
  gpsLongitude: requiredLongitudeSchema.optional().describe("Declared longitude in decimal degrees; supply with gpsLatitude."),
  description: z.string().max(DESCRIPTION_MAX_LENGTH).optional().describe("Document description, untrusted plain text."),
});
export const requestDocumentUploadInput = requestDocumentUploadBodyInput.extend(ownerFields).superRefine((data, ctx) => {
  if (!allowsApiDocumentType(data.ownerType, data.documentType)) ctx.addIssue({ code: "custom", path: ["documentType"], message: "This document type is not allowed for this record. Choose another type." });
  const mime = data.contentType.split(";")[0].trim().toLowerCase();
  if (!mime || mime === "text/plain" || !isAllowedMime(data.documentType, data.contentType)) ctx.addIssue({ code: "custom", path: ["contentType"], message: "This file type is not allowed for this document. Choose another file." });
  if (data.sizeBytes > maxBytesFor(data.documentType)) ctx.addIssue({ code: "custom", path: ["sizeBytes"], message: "The file is too large. Choose a smaller file." });
  gpsPairSuperRefine(data, ctx);
  if (getFutureEventFields({ capturedAt: data.capturedAt ? new Date(data.capturedAt) : null }, new Date()).length) ctx.addIssue({ code: "custom", path: ["capturedAt"], message: DOCUMENT_CAPTURE_FUTURE_MESSAGE });
});
export type RequestDocumentUploadInput = z.infer<typeof requestDocumentUploadInput>;

export const confirmDocumentUploadInput = z.strictObject({
  ...ownerFields,
  documentId: uuidSchema().describe("Document UUID under this owner."),
});
export type ConfirmDocumentUploadInput = z.infer<typeof confirmDocumentUploadInput>;
