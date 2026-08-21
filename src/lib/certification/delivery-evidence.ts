/**
 * Delivery proof-of-delivery evidence taxonomy.
 *
 * Biochar Protocol v1.3, "Measurement of Mass of Biochar Stored",
 * "Alternative Method: Documentation-Based Verification": when truck scales
 * are unavailable at the application or delivery site, Isometric may
 * pre-approve alternative proof of delivery consisting of signed delivery
 * receipt documents, bills of lading, or photographic evidence of delivery.
 * Isometric pre-approved this pathway for this project (2026-08-21). The PDD
 * must document production-site weighing, transport protocols, and chain of
 * custody; those obligations live outside this codebase.
 *
 * Authoritative source (verify before any credit claim):
 * https://registry.isometric.com/protocol/biochar/1.3#measurement-of-mass-of-biochar-stored
 */
import type { DocumentType } from "@/schemas/documents";

/** `documents.metadata` key that carries a delivery document's evidence role. */
export const DELIVERY_EVIDENCE_ROLE_METADATA_KEY = "deliveryEvidenceRole";

/**
 * The single delivery evidence role. The uploader stamps it on a delivery
 * photo taken as photographic evidence of delivery; a bare photo without the
 * role proves nothing about delivered mass and never binds to the registry.
 */
export const PROOF_OF_DELIVERY_EVIDENCE_ROLE = "proof_of_delivery";

export type DeliveryEvidenceRole = typeof PROOF_OF_DELIVERY_EVIDENCE_ROLE;

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
  bill_of_lading: "Bill of lading",
  weighbridge_ticket: "Weighbridge ticket",
  other_transport_evidence: "Other transport",
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

export function hasProofOfDeliveryRole(metadata: unknown): boolean {
  return (
    metadata !== null &&
    !Array.isArray(metadata) &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>)[
      DELIVERY_EVIDENCE_ROLE_METADATA_KEY
    ] === PROOF_OF_DELIVERY_EVIDENCE_ROLE
  );
}

/**
 * A delivery document that classifies as protocol proof of delivery and is
 * therefore registry-bound: a delivery receipt or bill of lading counts by
 * type alone; a photo counts only with the uploader-stamped role. Weighbridge
 * tickets and other transport records stay retention-only.
 */
export function isProofOfDeliveryDocument(document: {
  documentType: string;
  metadata: unknown;
}): boolean {
  return (
    document.documentType === "delivery_receipt" ||
    document.documentType === "bill_of_lading" ||
    (document.documentType === "photo" &&
      hasProofOfDeliveryRole(document.metadata))
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
