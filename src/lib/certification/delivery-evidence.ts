/** Delivery document classifications retained in noma's evidence store. */
import type { DocumentType } from "@/schemas/documents";
import { TRANSPORT_EVIDENCE_DOCUMENT_LABELS } from "./transport-evidence";

/** Document types the delivery evidence uploader offers as classifications. */
export const DELIVERY_EVIDENCE_DOCUMENT_TYPES = [
  "bill_of_lading",
  "weighbridge_ticket",
  "other_transport_evidence",
  "delivery_receipt",
  "photo",
] as const satisfies readonly DocumentType[];

export type DeliveryEvidenceDocumentType =
  (typeof DELIVERY_EVIDENCE_DOCUMENT_TYPES)[number];

export const DELIVERY_EVIDENCE_DOCUMENT_LABELS: Record<
  DeliveryEvidenceDocumentType,
  string
> = {
  ...TRANSPORT_EVIDENCE_DOCUMENT_LABELS,
  delivery_receipt: "Delivery receipt",
  photo: "Delivery photo",
};

export function isDeliveryEvidenceDocumentType(
  documentType: string,
): documentType is DeliveryEvidenceDocumentType {
  return DELIVERY_EVIDENCE_DOCUMENT_TYPES.some(
    (candidate) => candidate === documentType,
  );
}

/** An uploaded delivery document the evidence panel lists. */
export function isAcceptedDeliveryEvidenceDocument(document: {
  uploadStatus: string;
  documentType: string;
}): boolean {
  return (
    document.uploadStatus === "uploaded" &&
    isDeliveryEvidenceDocumentType(document.documentType)
  );
}
