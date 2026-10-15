import type { DocumentType } from "@/schemas/documents";

export function buildDocumentMetadata(input: {
  entityType: string;
  documentType: DocumentType;
  capturedAt?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  applicationEvidenceRole?: string;
  applicationLogbookEvidenceType?: string;
}): Record<string, unknown> {
  const applicationMetadata =
    input.entityType === "application"
      ? {
          ...(input.applicationEvidenceRole
            ? { evidenceRole: input.applicationEvidenceRole }
            : {}),
          ...(input.applicationLogbookEvidenceType
            ? { logbookEvidenceType: input.applicationLogbookEvidenceType }
            : {}),
        }
      : {};
  if (input.documentType !== "photo" && input.documentType !== "video") {
    return applicationMetadata;
  }

  const missingExif: string[] = [];
  if (!input.capturedAt) missingExif.push("timestamp");
  if (input.gpsLatitude == null || input.gpsLongitude == null) {
    missingExif.push("gps");
  }

  return {
    // Certification readiness uses this generated metadata to identify
    // application photos that carry both timestamp and GPS EXIF.
    geotagStatus: missingExif.length === 0 ? "present" : "missing",
    ...applicationMetadata,
    missingExif,
    exif: {
      capturedAt: input.capturedAt ?? null,
      gps:
        input.gpsLatitude != null && input.gpsLongitude != null
          ? { latitude: input.gpsLatitude, longitude: input.gpsLongitude }
          : null,
    },
  };
}

export function metadataRecord(value: unknown): Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}


/** Only server preparation writes this bounded list; never accept it from clients. */
export function promotionCandidates(metadata: unknown): string[] {
  const candidates = metadataRecord(metadata).promotionCandidates;
  return Array.isArray(candidates) ? candidates.filter((key): key is string => typeof key === "string") : [];
}
