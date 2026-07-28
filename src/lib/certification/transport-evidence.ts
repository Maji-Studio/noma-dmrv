import type { DocumentType } from "@/schemas/documents";

export const TRANSPORT_EVIDENCE_DOCUMENT_TYPES = [
  "bill_of_lading",
  "weighbridge_ticket",
  "other_transport_evidence",
] as const satisfies readonly DocumentType[];

export type TransportEvidenceDocumentType =
  (typeof TRANSPORT_EVIDENCE_DOCUMENT_TYPES)[number];

export const TRANSPORT_EVIDENCE_DOCUMENT_LABELS: Record<
  TransportEvidenceDocumentType,
  string
> = {
  bill_of_lading: "Bill of lading",
  weighbridge_ticket: "Weigh-scale ticket",
  other_transport_evidence: "Other transport evidence",
};

export function isTransportEvidenceDocumentType(
  documentType: string,
): documentType is TransportEvidenceDocumentType {
  return TRANSPORT_EVIDENCE_DOCUMENT_TYPES.some(
    (candidate) => candidate === documentType,
  );
}

/** A transport record that has finished uploading and has a supported classification. */
export function isAcceptedTransportEvidenceDocument(document: {
  uploadStatus: string;
  documentType: string;
}): boolean {
  return (
    document.uploadStatus === "uploaded" &&
    isTransportEvidenceDocumentType(document.documentType)
  );
}

export function hasAcceptedTransportEvidence(
  acceptedDocumentCount: number | null | undefined,
): boolean {
  return (
    typeof acceptedDocumentCount === "number" &&
    Number.isFinite(acceptedDocumentCount) &&
    acceptedDocumentCount > 0
  );
}
