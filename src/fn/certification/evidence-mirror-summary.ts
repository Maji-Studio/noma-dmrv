import type { OrgContext } from "@/lib/auth/server";
import type { CertificationSubmissionRow } from "@/data-access/certification";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { listDocumentUploadsForDocuments } from "@/data-access/certifier-document-uploads";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import { getStorageProvider } from "@/lib/storage";
import { SOURCES_MAX_BYTES } from "@/schemas/certification-sources";
import type { DocumentEntityType } from "@/schemas/documents";
import { ISOMETRIC_PROVIDER } from "./shared";
import {
  sourceCandidateEligibility,
  type CandidateLineageEntityType,
  type CandidateSourceDocument,
} from "./source-candidates";
import { filterCandidateSourcesForSubmissionLifecycle } from "./removal-source-freeze";

export interface EvidenceMirrorSummary {
  total: number;
  mirrored: number;
}

interface EvidenceRemovalScope {
  removalId: string | null;
  memberBatches: { id: string }[];
  lineages: ChainOfCustodyData[];
}

type MirrorCandidateDocument = DocumentRow & {
  storageKey: string;
  fileSizeBytes: number;
  mimeType: string;
};

function isMirrorCandidateDocument(
  document: DocumentRow,
): document is MirrorCandidateDocument {
  return (
    Boolean(document.storageKey) &&
    document.uploadStatus === "uploaded" &&
    document.fileSizeBytes !== null &&
    document.fileSizeBytes > 0 &&
    document.fileSizeBytes <= SOURCES_MAX_BYTES &&
    Boolean(document.mimeType)
  );
}

function isSummaryCandidate(candidate: CandidateSourceDocument): boolean {
  if (candidate.biocharApplicationId) return true;
  const entityType = candidate.binding?.lineage.entityType;
  return (
    entityType === "application" ||
    entityType === "delivery" ||
    entityType === "feedstock"
  );
}

/** Count source candidates from the submission scope without rebuilding it. */
export async function loadEvidenceMirrorSummaryForScope(
  orgCtx: OrgContext,
  scope: EvidenceRemovalScope,
  latestSubmission: CertificationSubmissionRow | null = null,
): Promise<EvidenceMirrorSummary> {
  if (!scope.removalId) return { total: 0, mirrored: 0 };

  const entityIds = new Map<DocumentEntityType, Set<string>>();
  const lineageLabels = new Map<string, string>();
  const add = (
    entityType: DocumentEntityType,
    entityId: string,
    entityLabel: string,
  ) => {
    const ids = entityIds.get(entityType) ?? new Set<string>();
    ids.add(entityId);
    entityIds.set(entityType, ids);
    lineageLabels.set(`${entityType}:${entityId}`, entityLabel);
  };

  for (const lineage of scope.lineages) {
    add(
      "application",
      lineage.application.id,
      `Application ${lineage.application.code}`,
    );
    add(
      "delivery",
      lineage.delivery.id,
      `Delivery ${lineage.delivery.code}`,
    );
    for (const feedstock of lineage.feedstocks) {
      add("feedstock", feedstock.id, `Feedstock ${feedstock.code}`);
    }
  }

  const documentGroups = await Promise.all(
    Array.from(entityIds, ([entityType, ids]) =>
      listDocumentsForEntityIds(orgCtx, entityType, Array.from(ids)),
    ),
  );
  const documentsById = new Map<string, MirrorCandidateDocument>();
  const liveCandidates: CandidateSourceDocument[] = [];
  for (const document of documentGroups
    .flat()
    .filter(isMirrorCandidateDocument)) {
    documentsById.set(document.id, document);
    const entityLabel = lineageLabels.get(
      `${document.entityType}:${document.entityId}`,
    );
    if (entityLabel === undefined) continue;
    const eligibility = sourceCandidateEligibility({
      document,
      lineage: {
        entityType: document.entityType as CandidateLineageEntityType,
        entityId: document.entityId,
        entityLabel,
      },
      removalId: scope.removalId ?? undefined,
    });
    if (!eligibility) continue;
    liveCandidates.push({
      documentId: document.id,
      binding: eligibility.binding,
      biocharApplicationId: eligibility.biocharApplicationId,
    });
  }
  const documentIds = Array.from(
    new Set(
      filterCandidateSourcesForSubmissionLifecycle(
        liveCandidates,
        latestSubmission,
      )
        .filter(isSummaryCandidate)
        .map(({ documentId }) => documentId),
    ),
  );
  const mirrorRows = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    documentIds,
  );
  const candidateDocumentIds = new Set(documentIds);
  const mirroredDocumentIds = new Set(
    mirrorRows
      .map((row) => row.documentId)
      .filter((documentId) => candidateDocumentIds.has(documentId)),
  );
  const provider = getStorageProvider();
  const availableDocumentIds = new Set(
    (
      await Promise.all(
        documentIds.map(async (documentId) => {
          if (mirroredDocumentIds.has(documentId)) return documentId;
          const document = documentsById.get(documentId);
          // A frozen candidate that disappeared from live discovery must stay
          // visible as pending; submission will fail closed while loading it.
          if (!document) return documentId;
          try {
            const head = await provider.headObject(document.storageKey);
            return head?.size === document.fileSizeBytes ? documentId : null;
          } catch {
            // Keep the advisory warning conservative during a provider outage.
            return documentId;
          }
        }),
      )
    ).filter((id): id is string => id !== null),
  );
  return {
    total: availableDocumentIds.size,
    mirrored: mirroredDocumentIds.size,
  };
}
