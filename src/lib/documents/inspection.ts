import { isAllowedMime, isProductionReadingsCsvFormat, type DocumentType } from "@/schemas/documents";
import type { InspectedObject } from "@/lib/storage/types";
export type UploadRefusalReason = "size" | "type" | "checksum" | "format" | "certification_locked";
export interface UploadDeclaration { entityType: string; documentType: DocumentType; fileName: string; contentType: string; sizeBytes: number; sha256?: string }
export const normalizeContentType = (type: string) => type.split(";")[0].trim().toLowerCase();
const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).equals(Buffer.from("%PDF-")),
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "image/jpeg": (b) => b.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  "image/gif": (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")),
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};
export function inspectUploadBytes(declaration: UploadDeclaration, object: InspectedObject): UploadRefusalReason | null {
  if (object.sizeBytes !== declaration.sizeBytes) return "size";
  const type = normalizeContentType(declaration.contentType);
  const emptyDeclaration = type === "" && isAllowedMime(declaration.documentType, "") && normalizeContentType(object.contentType) === "application/octet-stream";
  if ((!emptyDeclaration && (!isAllowedMime(declaration.documentType, object.contentType) || normalizeContentType(object.contentType) !== type)) || (MAGIC[type] && !MAGIC[type](object.bytes))) return "type";
  if (declaration.entityType === "production_run" && declaration.documentType === "sensor_data" && !isProductionReadingsCsvFormat(declaration)) return "format";
  if (declaration.sha256 && declaration.sha256 !== object.sha256) return "checksum";
  return null;
}
