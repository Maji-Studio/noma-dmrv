import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";

const APPLICATION_DOCUMENT_ENTITY_TYPE = "application";
const APPLICATION_VISUAL_DOCUMENT_TYPE = "photo";
const APPLICATION_BOUNDARY_LOGBOOK_DOCUMENT_TYPE = "pdf";

function documentMetadata(row: DocumentRow): Record<string, unknown> {
  return row.metadata && typeof row.metadata === "object"
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function isUploadedDocument(row: DocumentRow): boolean {
  return row.uploadStatus === "uploaded" || row.fileUrl != null;
}

function isGeotaggedPhoto(row: DocumentRow): boolean {
  return (
    row.documentType === APPLICATION_VISUAL_DOCUMENT_TYPE &&
    isUploadedDocument(row) &&
    documentMetadata(row).geotagStatus === "present"
  );
}

export async function buildApplicationEvidenceGaps(
  userId: string,
  lineages: ChainOfCustodyData[],
): Promise<string[]> {
  const applicationIds = lineages.map((lineage) => lineage.application.id);
  const documents = await listDocumentsForEntityIds(
    userId,
    APPLICATION_DOCUMENT_ENTITY_TYPE,
    applicationIds,
  );
  const documentsByApplicationId = new Map<string, DocumentRow[]>();
  for (const document of documents) {
    const current = documentsByApplicationId.get(document.entityId) ?? [];
    current.push(document);
    documentsByApplicationId.set(document.entityId, current);
  }

  const gaps: string[] = [];
  for (const lineage of lineages) {
    const application = lineage.application;
    if (!application.evidenceMethod) continue;
    const applicationDocuments =
      documentsByApplicationId.get(application.id) ?? [];

    if (application.evidenceMethod === "visual") {
      if (!applicationDocuments.some(isGeotaggedPhoto)) {
        gaps.push(`Application ${application.code}: geotagged visual evidence`);
      }
      continue;
    }

    if (!application.gisBoundaryReference) {
      gaps.push(`Application ${application.code}: GIS boundary reference`);
    }
    const hasLogbook = applicationDocuments.some(
      (document) =>
        document.documentType === APPLICATION_BOUNDARY_LOGBOOK_DOCUMENT_TYPE &&
        isUploadedDocument(document),
    );
    if (!hasLogbook) {
      gaps.push(`Application ${application.code}: boundary logbook evidence`);
    }
  }

  return gaps;
}
