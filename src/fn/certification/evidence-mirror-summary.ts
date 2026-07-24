import type { OrgContext } from "@/lib/auth/server";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { listDocumentUploadsForDocuments } from "@/data-access/certifier-document-uploads";
import {
  listDocumentsForEntityIds,
  type DocumentRow,
} from "@/data-access/documents";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
import { getStorageProvider } from "@/lib/storage";
import { SOURCES_MAX_BYTES } from "@/schemas/certification-sources";
import type { DocumentEntityType } from "@/schemas/documents";
import { ISOMETRIC_PROVIDER } from "./shared";

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

/** Count source candidates from the submission scope without rebuilding it. */
export async function loadEvidenceMirrorSummaryForScope(
  orgCtx: OrgContext,
  scope: EvidenceRemovalScope,
): Promise<EvidenceMirrorSummary> {
  if (!scope.removalId) return { total: 0, mirrored: 0 };

  const entityIds = new Map<DocumentEntityType, Set<string>>();
  const add = (entityType: DocumentEntityType, entityId: string) => {
    const ids = entityIds.get(entityType) ?? new Set<string>();
    ids.add(entityId);
    entityIds.set(entityType, ids);
  };

  for (const batch of scope.memberBatches) add("credit_batch", batch.id);
  for (const lineage of scope.lineages) {
    add("application", lineage.application.id);
    add("delivery", lineage.delivery.id);
    if (lineage.order) add("order", lineage.order.id);
    if (lineage.biocharProduct) {
      add("biochar_product", lineage.biocharProduct.id);
    }
    if (lineage.productionRun) add("production_run", lineage.productionRun.id);
    if (lineage.reactor) add("reactor", lineage.reactor.id);
    for (const feedstock of lineage.feedstocks) add("feedstock", feedstock.id);
  }

  const samples = await getSamplesByCreditBatchIds(
    orgCtx,
    scope.memberBatches.map((batch) => batch.id),
  );
  for (const sample of samples) add("sample", sample.id);

  const idsOf = (entityType: DocumentEntityType) =>
    Array.from(entityIds.get(entityType) ?? []);
  const transportLegGroups = await Promise.all([
    getTransportLegsForEntities(orgCtx, "feedstock", idsOf("feedstock")),
    getTransportLegsForEntities(
      orgCtx,
      "biochar",
      idsOf("biochar_product"),
    ),
    getTransportLegsForEntities(orgCtx, "sample", idsOf("sample")),
  ]);
  for (const leg of transportLegGroups.flat()) add("transport_leg", leg.id);

  const documentGroups = await Promise.all(
    Array.from(entityIds, ([entityType, ids]) =>
      listDocumentsForEntityIds(orgCtx, entityType, Array.from(ids)),
    ),
  );
  const candidatesById = new Map(
    documentGroups
      .flat()
      .filter(isMirrorCandidateDocument)
      .map((document) => [document.id, document]),
  );
  const documentIds = Array.from(candidatesById.keys());
  const mirrorRows = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    documentIds,
  );
  const mirroredDocumentIds = new Set(
    mirrorRows.map((row) => row.documentId),
  );
  const provider = getStorageProvider();
  const availableDocumentIds = new Set(
    (
      await Promise.all(
        Array.from(candidatesById.values(), async (document) => {
          if (mirroredDocumentIds.has(document.id)) return document.id;
          try {
            const head = await provider.headObject(document.storageKey);
            return head?.size === document.fileSizeBytes ? document.id : null;
          } catch {
            // Keep the advisory warning conservative during a provider outage.
            return document.id;
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
