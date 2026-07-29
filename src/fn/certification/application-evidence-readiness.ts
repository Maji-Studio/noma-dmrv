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
import type { BatchEntityReadinessIssue } from "@/lib/certification/batch-health";

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
  return (await buildApplicationEvidenceReadiness(orgCtx, lineages)).gaps;
}

export interface ApplicationEvidenceReadinessResult {
  gaps: string[];
  issues: BatchEntityReadinessIssue[];
}

export async function buildApplicationEvidenceReadiness(
  orgCtx: OrgContext,
  lineages: ChainOfCustodyData[],
): Promise<ApplicationEvidenceReadinessResult> {
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
  const affectedRecords: BatchEntityReadinessIssue["affectedRecords"] = [];
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
    if (missingRequirements.length > 0) {
      affectedRecords.push({
        id: application.id,
        code: application.code,
        missing: missingRequirements.map((requirement) =>
          applicationEvidenceMissingLabel(requirement.gap),
        ),
      });
    }
  }

  return {
    gaps,
    issues:
      affectedRecords.length > 0
        ? [
            {
              key: "applications",
              label: "Application evidence",
              fixTarget: "applications",
              affectedRecords,
            },
          ]
        : [],
  };
}
