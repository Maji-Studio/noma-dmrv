import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { DocumentType } from "@/schemas/documents";

/** The existing dashboard/readiness definition of document-backed distance. */
export const DOCUMENT_BACKED_DISTANCE_SOURCE =
  "document" satisfies DistanceSourceValue;

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

export function hasDocumentBackedDistanceProvenance(
  source: DistanceSourceValue | null | undefined,
): boolean {
  return source === DOCUMENT_BACKED_DISTANCE_SOURCE;
}

export function isTransportEvidenceDocumentType(
  documentType: string,
): documentType is TransportEvidenceDocumentType {
  return TRANSPORT_EVIDENCE_DOCUMENT_TYPES.some(
    (candidate) => candidate === documentType,
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

/**
 * Certification's composite transport-evidence rule. Distance provenance and
 * the uploaded evidence fact remain separate inputs; neither satisfies the
 * requirement by itself.
 */
export function hasCompleteTransportEvidence(
  source: DistanceSourceValue | null | undefined,
  acceptedDocumentCount: number | null | undefined,
): boolean {
  return (
    hasDocumentBackedDistanceProvenance(source) &&
    hasAcceptedTransportEvidence(acceptedDocumentCount)
  );
}

export type TransportEvidenceCertStatus =
  | "neutral"
  | "satisfied"
  | "missing";

export function deriveTransportEvidenceCertStatus(input: {
  persisted: boolean | undefined;
  documentsLoaded: boolean;
  source: DistanceSourceValue | null | undefined;
  acceptedDocumentCount: number | null | undefined;
}): TransportEvidenceCertStatus {
  if (!input.persisted || !input.documentsLoaded) return "neutral";
  return hasCompleteTransportEvidence(
    input.source,
    input.acceptedDocumentCount,
  )
    ? "satisfied"
    : "missing";
}
