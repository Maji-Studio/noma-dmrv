import { resolveUploadContentType } from "@/lib/documents/content-type";
import type { DocumentType } from "@/schemas/documents";

export function resolveSupportingEvidenceDocumentType(
  file: Pick<File, "name" | "type">,
): DocumentType {
  const contentType = resolveUploadContentType({
    fileName: file.name,
    contentType: file.type,
  });
  return contentType.startsWith("image/") ? "photo" : "pdf";
}
