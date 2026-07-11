import type { OrgContext } from "@/lib/auth/server";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import {
  APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE,
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS,
  APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES,
  APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE,
  APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS,
  APPLICATION_VISUAL_EVIDENCE_ROLES,
  isApplicationBoundaryLogbookEvidenceType,
  type ApplicationVisualEvidenceRole,
} from "@/lib/certification/application-evidence";

const APPLICATION_DOCUMENT_ENTITY_TYPE = "application";
const APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPE_SET: ReadonlySet<string> =
  new Set(APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPES);

interface DocumentMetadata {
  geotagStatus?: "present" | "missing" | string;
  evidenceRole?: unknown;
  logbookEvidenceType?: unknown;
}

function documentMetadata(row: DocumentRow): DocumentMetadata {
  return row.metadata !== null &&
    !Array.isArray(row.metadata) &&
    typeof row.metadata === "object"
    ? (row.metadata as DocumentMetadata)
    : {};
}

function isUploadedDocument(row: DocumentRow): boolean {
  return row.uploadStatus === "uploaded" || row.fileUrl != null;
}

function isGeotaggedPhotoForRole(
  row: DocumentRow,
  role: ApplicationVisualEvidenceRole,
): boolean {
  const metadata = documentMetadata(row);
  return (
    row.documentType === APPLICATION_VISUAL_EVIDENCE_DOCUMENT_TYPE &&
    isUploadedDocument(row) &&
    metadata.geotagStatus === "present" &&
    metadata.evidenceRole === role
  );
}

function hasBoundaryReference(value: string | null | undefined): boolean {
  return (value?.trim() ?? "").length > 0;
}

function isBoundaryLogbook(row: DocumentRow): boolean {
  if (!isUploadedDocument(row)) return false;

  if (APPLICATION_BOUNDARY_LOGBOOK_UNCONDITIONAL_DOCUMENT_TYPE_SET.has(row.documentType)) {
    return true;
  }

  return (
    row.documentType === APPLICATION_BOUNDARY_LOGBOOK_CONDITIONAL_DOCUMENT_TYPE &&
    isApplicationBoundaryLogbookEvidenceType(
      documentMetadata(row).logbookEvidenceType,
    )
  );
}

export async function buildApplicationEvidenceGaps(
  orgCtx: OrgContext,
  lineages: ChainOfCustodyData[],
): Promise<string[]> {
  const applicationIds = lineages.map((lineage) => lineage.application.id);
  const documents = await listDocumentsForEntityIds(
    orgCtx,
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
      for (const role of APPLICATION_VISUAL_EVIDENCE_ROLES) {
        if (
          applicationDocuments.some((document) =>
            isGeotaggedPhotoForRole(document, role),
          )
        ) {
          continue;
        }
        gaps.push(
          `Application ${application.code}: geotagged ${APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[role].toLowerCase()} photo`,
        );
      }
      continue;
    }

    if (!hasBoundaryReference(application.gisBoundaryReference)) {
      gaps.push(`Application ${application.code}: GIS boundary reference`);
    }
    const hasLogbook = applicationDocuments.some(isBoundaryLogbook);
    if (!hasLogbook) {
      gaps.push(
        `Application ${application.code}: boundary logbook evidence (${Object.values(APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS).join(", ")})`,
      );
    }
  }

  return gaps;
}
