import type { OrgContext } from "@/lib/auth/server";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import {
  APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS,
  APPLICATION_DOCUMENT_ENTITY_TYPE,
  APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS,
  getMissingApplicationEvidenceRequirements,
  type ApplicationEvidenceGapDescriptor,
} from "@/lib/certification/application-evidence";

function applicationEvidenceGapMessage(
  applicationCode: string,
  gap: ApplicationEvidenceGapDescriptor,
): string {
  switch (gap.kind) {
    case "visual-role":
      return `Application ${applicationCode}: geotagged ${APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[gap.role].toLowerCase()} photo`;
    case "boundary-reference":
      return `Application ${applicationCode}: GIS boundary reference`;
    case "boundary-logbook":
      return `Application ${applicationCode}: boundary logbook evidence (${Object.values(APPLICATION_BOUNDARY_LOGBOOK_EVIDENCE_TYPE_LABELS).join(", ")})`;
  }
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
    const applicationDocuments =
      documentsByApplicationId.get(application.id) ?? [];
    const missingRequirements = getMissingApplicationEvidenceRequirements(
      application,
      applicationDocuments,
    );
    for (const requirement of missingRequirements) {
      gaps.push(
        applicationEvidenceGapMessage(application.code, requirement.gap),
      );
    }
  }

  return gaps;
}
