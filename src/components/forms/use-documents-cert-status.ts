"use client";

import { useDocumentsForEntity } from "@/hooks/use-documents";
import { resolveCertFieldStatus, type CertFieldStatus } from "./cert-field-status";

/**
 * CERT-chip status for a requirement that a saved record's documents satisfy
 * (proof of delivery, lab report). Neutral while the record is unsaved or its
 * documents are loading; orange when no document qualifies; green when one does.
 */
export function useDocumentsCertStatus(
  entityType: string,
  entityId: string | null | undefined,
  qualifies: (document: { uploadStatus: string; documentType: string }) => boolean,
): CertFieldStatus {
  const { data } = useDocumentsForEntity(entityType, entityId);
  return resolveCertFieldStatus(
    entityId && data ? true : undefined,
    (data ?? []).some(qualifies),
  );
}
