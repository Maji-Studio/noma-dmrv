/**
 * Reference (JS twin) implementation of the application evidence-gap rule.
 *
 * It has no production caller. Application evidence stopped gating the Removal,
 * so the certification submission gate that used to call this was deleted. The
 * module is retained as the readable oracle that
 * `tests/application-evidence-gap-sql.test.ts` cross-checks the shared SQL
 * builder (`src/data-access/application-evidence-sql.ts`) against, which is what
 * keeps the two adapters from drifting. Do not wire it into a UI or a gate.
 */
import type { OrgContext } from "@/lib/auth/server";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import {
  APPLICATION_DOCUMENT_ENTITY_TYPE,
  APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS,
  getMissingApplicationEvidenceRequirements,
  type ApplicationEvidenceGapDescriptor,
} from "@/lib/certification/application-evidence";

function applicationEvidenceMissingLabel(
  gap: ApplicationEvidenceGapDescriptor,
): string {
  switch (gap.kind) {
    case "visual-role":
      return `geotagged ${APPLICATION_VISUAL_EVIDENCE_ROLE_LABELS[gap.role].toLowerCase()} photo`;
    case "boundary-reference":
      return "GIS reference";
  }
}

function applicationEvidenceGapMessage(
  applicationCode: string,
  gap: ApplicationEvidenceGapDescriptor,
): string {
  return `Application ${applicationCode}: ${applicationEvidenceMissingLabel(gap)}`;
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
