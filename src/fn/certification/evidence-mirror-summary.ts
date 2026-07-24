import type { OrgContext } from "@/lib/auth/server";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import { listDocumentUploadsForDocuments } from "@/data-access/certifier-document-uploads";
import { listDocumentsForEntityIds } from "@/data-access/documents";
import { getTransportLegsForEntities } from "@/data-access/transport-legs";
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
  const documentIds = Array.from(
    new Set(
      documentGroups
        .flat()
        .filter(
          (document) =>
            document.storageKey !== null &&
            document.uploadStatus === "uploaded",
        )
        .map((document) => document.id),
    ),
  );
  const mirrorRows = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    documentIds,
  );
  return {
    total: documentIds.length,
    mirrored: new Set(mirrorRows.map((row) => row.documentId)).size,
  };
}
