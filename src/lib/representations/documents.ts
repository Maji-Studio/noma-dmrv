import { z } from "zod";
import type { DocumentRow } from "@/data-access/documents";
import { API_DOCUMENT_OWNER_TYPES, apiDocumentOwnerType } from "@/lib/documents/api-owners";
import { metadataRecord } from "@/lib/documents/metadata";
import { DOCUMENT_TYPES } from "@/schemas/documents";

export { DOCUMENT_REPRESENTATION_REVISION } from "@/config/api-rest";
export const documentOwnerTypeRepresentationSchema = z.enum(API_DOCUMENT_OWNER_TYPES).describe("Record type owning this document. The published vocabulary can grow as owners are added.");
export const documentRepresentationSchema = z.object({
  id: z.uuid().describe("Document identifier, UUID."),
  ownerType: documentOwnerTypeRepresentationSchema,
  ownerId: z.uuid().describe("Owning record identifier, UUID."),
  documentType: z.enum(DOCUMENT_TYPES).describe("Document classification."),
  fileName: z.string().describe("Original file name, untrusted plain text."),
  contentType: z.string().nullable().describe("Declared MIME type while pending; verified MIME type once uploaded, or null when unknown on legacy evidence."),
  sizeBytes: z.number().int().nullable().describe("Declared file length in bytes while pending; verified length once uploaded, or null when unknown on legacy evidence."),
  sha256: z.string().nullable().describe("Declared lowercase hexadecimal SHA-256 while pending; verified lowercase hexadecimal SHA-256 once uploaded, or null on legacy evidence."),
  uploadStatus: z.enum(["pending", "uploaded", "failed"]).describe("Upload state."),
  capturedAt: z.iso.datetime().nullable().describe("Client-declared capture instant in UTC, or null."),
  gpsLatitude: z.number().nullable().describe("Client-declared latitude in decimal degrees, or null."),
  gpsLongitude: z.number().nullable().describe("Client-declared longitude in decimal degrees, or null."),
  description: z.string().nullable().describe("Document description, untrusted plain text, or null."),
  version: z.number().int().positive().describe("Document row version."),
  createdAt: z.iso.datetime().describe("Creation instant in UTC."),
  updatedAt: z.iso.datetime().describe("Last update instant in UTC."),
});
export type DocumentRepresentation = z.infer<typeof documentRepresentationSchema>;

/** Explicit projection shared by reads and stored idempotency outcomes. */
export function representDocument(row: DocumentRow): DocumentRepresentation {
  const metadata = metadataRecord(row.metadata);
  const declaration = metadataRecord(metadata.uploadDeclaration);
  const gps = metadataRecord(metadataRecord(metadata.exif).gps);
  const declared = row.uploadStatus !== "uploaded";
  return documentRepresentationSchema.parse({
    id: row.id, ownerType: apiDocumentOwnerType(row.entityType), ownerId: row.entityId,
    documentType: row.documentType, fileName: row.fileName,
    contentType: declared ? declaration.contentType ?? row.mimeType : row.mimeType,
    sizeBytes: declared ? declaration.sizeBytes ?? row.fileSizeBytes : row.fileSizeBytes,
    sha256: declared ? declaration.sha256 ?? null : row.checksumSha256,
    uploadStatus: row.uploadStatus, capturedAt: row.capturedAt?.toISOString() ?? null,
    gpsLatitude: declaration.gpsLatitude ?? gps.latitude ?? null,
    gpsLongitude: declaration.gpsLongitude ?? gps.longitude ?? null,
    description: row.description, version: row.version,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
}
