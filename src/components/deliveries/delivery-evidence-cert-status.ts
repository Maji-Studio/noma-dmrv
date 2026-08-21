import {
  resolveCertFieldStatus,
  type CertFieldStatus,
} from "@/components/forms/cert-field-status";
import { isProofOfDeliveryDocument } from "@/lib/certification/delivery-evidence";

interface DeliveryEvidenceDocumentFacts {
  uploadStatus: string;
  documentType: string;
  metadata: unknown;
}

/**
 * Saved-state CERT status for the delivery evidence section: satisfied once
 * the saved delivery carries at least one uploaded proof-of-delivery
 * document (delivery receipt, bill of lading, or role-stamped photo).
 * Neutral while creating or while the saved document list is still loading.
 * Informational only; it never blocks saving or submission.
 */
export function deriveDeliveryEvidenceCertStatus(
  documents: readonly DeliveryEvidenceDocumentFacts[] | undefined,
  persisted: boolean,
): CertFieldStatus {
  const savedRowsKnown = persisted && documents !== undefined ? true : undefined;
  return resolveCertFieldStatus(
    savedRowsKnown,
    (documents ?? []).some(
      (document) =>
        document.uploadStatus === "uploaded" &&
        isProofOfDeliveryDocument(document),
    ),
  );
}
