import { APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE } from "@/lib/certification/application-evidence";
import type { DocumentType } from "@/schemas/documents";

export const APPLICATION_SUPPORTING_EVIDENCE_FALLBACK_DOCUMENT_TYPE: DocumentType =
  "pdf";

export function resolveSupportingEvidenceDocumentType(
  file: Pick<File, "name" | "type">,
): DocumentType {
  return file.type.startsWith("image/")
    ? APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE
    : APPLICATION_SUPPORTING_EVIDENCE_FALLBACK_DOCUMENT_TYPE;
}
