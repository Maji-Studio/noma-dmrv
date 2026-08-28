import type { OrgContext } from "@/lib/auth/server";
import type { DbTransaction } from "@/db";
import { listDocumentUploadsForDocuments } from "@/data-access/certifier-document-uploads";
import { listDocumentsForEntity } from "@/data-access/documents";
import {
  biocharApplicationIdForSource,
  isApplicationSourceDocumentReady,
} from "@/lib/certification/application-evidence";
import {
  classifyRemovalSourceCandidate,
  type ClassifiedRemovalSource,
} from "@/lib/certification/removal-source-bindings";
import { ISOMETRIC_PROVIDER } from "@/lib/isometric/utils/constants";

export type CandidateLineageEntityType =
  | "application"
  | "delivery"
  | "feedstock"
  | "credit_batch"
  | "sample";

export interface CandidateLineageEntity {
  entityType: CandidateLineageEntityType;
  entityId: string;
  entityLabel: string;
}

export interface CandidateSourceDocument {
  documentId: string;
  binding: ClassifiedRemovalSource | null;
  biocharApplicationId?: string | null;
}

interface SourceCandidateLineage {
  application: { id: string; code?: string | null };
  delivery: { id: string; code?: string | null };
  feedstocks: Array<{ id: string; code?: string | null }>;
}

export async function collectCandidateDocumentIdsForRemoval(
  orgCtx: OrgContext,
  args: {
    removalId: string;
    lineages: Array<
      SourceCandidateLineage & {
        order: { id: string } | null;
        biocharProduct: { id: string } | null;
        productionRun: { id: string } | null;
        reactor: { id: string } | null;
      }
    >;
    memberBatches: Array<{ id: string; code?: string | null }>;
  },
): Promise<string[]> {
  const candidates = await collectCandidateSourceDocumentsForRemoval(orgCtx, {
    removalId: args.removalId,
    lineages: args.lineages,
    memberBatches: args.memberBatches,
  });
  return Array.from(
    new Set(candidates.map((candidate) => candidate.documentId)),
  ).sort();
}

/** Discover operator evidence and current generated ledgers for a Removal. */
export async function collectCandidateSourceDocumentsForRemoval(
  orgCtx: OrgContext,
  args: {
    removalId?: string;
    lineages: SourceCandidateLineage[];
    memberBatches?: Array<{ id: string; code?: string | null }>;
    memberSamples?: Array<{ id: string; code?: string | null }>;
  },
): Promise<CandidateSourceDocument[]> {
  const entities = new Map<string, CandidateLineageEntity>();
  const add = (entity: CandidateLineageEntity) => {
    const key = `${entity.entityType}:${entity.entityId}`;
    if (!entities.has(key)) entities.set(key, entity);
  };
  for (const lineage of args.lineages) {
    add({
      entityType: "application",
      entityId: lineage.application.id,
      entityLabel: `Application ${lineage.application.code ?? lineage.application.id}`,
    });
    add({
      entityType: "delivery",
      entityId: lineage.delivery.id,
      entityLabel: `Delivery ${lineage.delivery.code ?? lineage.delivery.id}`,
    });
    for (const feedstock of lineage.feedstocks) {
      add({
        entityType: "feedstock",
        entityId: feedstock.id,
        entityLabel: `Feedstock ${feedstock.code ?? feedstock.id}`,
      });
    }
  }
  for (const batch of args.memberBatches ?? []) {
    add({
      entityType: "credit_batch",
      entityId: batch.id,
      entityLabel: `Credit batch ${batch.code ?? batch.id}`,
    });
  }
  for (const sample of args.memberSamples ?? []) {
    add({
      entityType: "sample",
      entityId: sample.id,
      entityLabel: `Sample ${sample.code ?? sample.id}`,
    });
  }

  const documentsByEntity = await Promise.all(
    Array.from(entities.values(), async (lineage) => ({
      lineage,
      documents: await listDocumentsForEntity(
        orgCtx,
        lineage.entityType,
        lineage.entityId,
      ),
    })),
  );
  const candidates = new Map<string, CandidateSourceDocument>();
  for (const { lineage, documents } of documentsByEntity) {
    for (const document of documents) {
      if (!isApplicationSourceDocumentReady(lineage, document)) continue;
      const binding = classifyRemovalSourceCandidate({
        documentType: document.documentType,
        metadata: document.metadata,
        lineage,
        removalId: args.removalId,
      });
      const biocharApplicationId = biocharApplicationIdForSource(
        lineage,
        document.documentType,
      );
      if ((binding || biocharApplicationId) && !candidates.has(document.id)) {
        candidates.set(document.id, {
          documentId: document.id,
          binding,
          biocharApplicationId,
        });
      }
    }
  }
  return Array.from(candidates.values()).sort((left, right) =>
    left.documentId.localeCompare(right.documentId),
  );
}

export interface ResolvedSourceBindingCandidate
  extends CandidateSourceDocument {
  sourceId: string;
}

export async function resolveSourceBindingCandidates(
  orgCtx: OrgContext,
  args: { candidates: CandidateSourceDocument[] },
  txOrDb?: DbTransaction,
): Promise<ResolvedSourceBindingCandidate[]> {
  if (args.candidates.length === 0) return [];
  const uploads = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    args.candidates.map((candidate) => candidate.documentId),
    txOrDb,
  );
  const sourceIdByDocumentId = new Map(
    uploads.map((upload) => [upload.documentId, upload.externalDocumentId]),
  );
  return args.candidates.flatMap((candidate) => {
    const sourceId = sourceIdByDocumentId.get(candidate.documentId);
    return sourceId ? [{ ...candidate, sourceId }] : [];
  });
}

export async function resolveSourceIdsForRemoval(
  orgCtx: OrgContext,
  args: { candidateDocumentIds: string[] },
  txOrDb?: DbTransaction,
): Promise<string[]> {
  if (args.candidateDocumentIds.length === 0) return [];
  const uploads = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    args.candidateDocumentIds,
    txOrDb,
  );
  return Array.from(new Set(uploads.map((u) => u.externalDocumentId))).sort();
}
