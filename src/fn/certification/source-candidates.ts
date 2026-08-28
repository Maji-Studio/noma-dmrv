import type { OrgContext } from "@/lib/auth/server";
import type { DbTransaction } from "@/db";
import {
  listDocumentUploadsForDocuments,
  type CertifierDocumentUploadRow,
  type DocumentUploadMetadata,
} from "@/data-access/certifier-document-uploads";
import {
  getCertifierProjectByFacility,
  type DocumentRow,
} from "@/data-access/certification";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getSamplesByCreditBatchIds } from "@/data-access/credit-batch-samples";
import {
  getCertifierRemovalById,
  getCreditBatchesByRemovalId,
} from "@/data-access/certifier-removals";
import { listDocumentsForEntity } from "@/data-access/documents";
import {
  biocharApplicationIdForSource,
  isApplicationEvidenceDocumentReady,
} from "@/lib/certification/application-evidence";
import {
  classifyRemovalSourceCandidate,
  type ClassifiedRemovalSource,
} from "@/lib/certification/removal-source-bindings";
import { SafeError } from "@/lib/errors";
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

export interface CandidateDocument {
  document: DocumentRow;
  lineageEntity: CandidateLineageEntity;
  binding: ClassifiedRemovalSource | null;
  biocharApplicationId?: string | null;
  mirror: {
    externalDocumentId: string;
    isPublic: boolean;
    mirroredAt: Date;
  } | null;
}

export interface CandidateDocumentsForRemoval {
  removalId: string;
  facilityId: string;
  candidates: CandidateDocument[];
  mirroredExternalIds: string[];
  hasMapping: boolean;
}

async function collectLineageEntities(
  orgCtx: OrgContext,
  memberBatchIds: string[],
  removalId: string,
): Promise<CandidateLineageEntity[]> {
  if (memberBatchIds.length === 0) return [];

  const accountingByBatch = await loadCreditBatchRollups(
    orgCtx,
    memberBatchIds,
    { removalId },
  );
  const memberSamples = await getSamplesByCreditBatchIds(
    orgCtx,
    memberBatchIds,
  );
  const seen = new Map<string, CandidateLineageEntity>();
  const add = (entity: CandidateLineageEntity) => {
    const key = `${entity.entityType}:${entity.entityId}`;
    if (!seen.has(key)) seen.set(key, entity);
  };

  for (const memberBatchId of memberBatchIds) {
    const accounting = accountingByBatch[memberBatchId];
    if (!accounting) {
      throw new SafeError(`Credit batch ${memberBatchId} could not be loaded.`);
    }
    const { batch, lineageFacts } = accounting;
    add({
      entityType: "credit_batch",
      entityId: batch.id,
      entityLabel: `Credit batch ${batch.code}`,
    });

    for (const application of lineageFacts.applications) {
      add({
        entityType: "application",
        entityId: application.id,
        entityLabel: `Application ${application.code}`,
      });
      add({
        entityType: "delivery",
        entityId: application.delivery.id,
        entityLabel: `Delivery ${application.delivery.code}`,
      });
    }

    for (const run of lineageFacts.runs) {
      for (const feedstock of run.feedstocks) {
        add({
          entityType: "feedstock",
          entityId: feedstock.id,
          entityLabel: `Feedstock ${feedstock.code}`,
        });
      }
    }
  }

  for (const sample of memberSamples) {
    add({
      entityType: "sample",
      entityId: sample.id,
      entityLabel: `Sample ${sample.sampleCode || sample.id}`,
    });
  }

  return Array.from(seen.values());
}

export async function loadCandidateDocumentsForRemovalForUser(
  orgCtx: OrgContext,
  removalId: string,
): Promise<CandidateDocumentsForRemoval> {
  const removal = await getCertifierRemovalById(orgCtx, removalId);
  if (!removal) throw new SafeError("Removal not found.");

  const mapping = await getCertifierProjectByFacility(
    orgCtx,
    removal.facilityId,
    ISOMETRIC_PROVIDER,
  );
  const batches = await getCreditBatchesByRemovalId(orgCtx, removalId);
  const lineageEntities = await collectLineageEntities(
    orgCtx,
    batches.map((batch) => batch.id),
    removalId,
  );
  const documentsByEntity = await Promise.all(
    lineageEntities.map((entity) =>
      listDocumentsForEntity(
        orgCtx,
        entity.entityType,
        entity.entityId,
      ).then((documents) => ({ entity, documents })),
    ),
  );

  const seenDocuments = new Map<
    string,
    { document: DocumentRow; entity: CandidateLineageEntity }
  >();
  for (const { entity, documents } of documentsByEntity) {
    for (const document of documents) {
      if (!seenDocuments.has(document.id)) {
        seenDocuments.set(document.id, { document, entity });
      }
    }
  }

  const mirrorRows = await listDocumentUploadsForDocuments(
    orgCtx,
    ISOMETRIC_PROVIDER,
    Array.from(seenDocuments.keys()),
  );
  const mirrorByDocumentId = new Map<string, CertifierDocumentUploadRow>(
    mirrorRows.map((row) => [row.documentId, row]),
  );
  const candidates = Array.from(seenDocuments.values()).flatMap(
    ({ document, entity }): CandidateDocument[] => {
      const eligibility = sourceCandidateEligibility({
        document,
        lineage: entity,
        removalId,
      });
      if (!eligibility) return [];
      const { binding, biocharApplicationId } = eligibility;

      const mirrorRow = mirrorByDocumentId.get(document.id);
      const metadata = (mirrorRow?.metadata ?? null) as
        | (DocumentUploadMetadata & { [key: string]: unknown })
        | null;
      return [
        {
          document,
          lineageEntity: entity,
          binding,
          biocharApplicationId,
          mirror: mirrorRow
            ? {
                externalDocumentId: mirrorRow.externalDocumentId,
                isPublic: metadata?.isPublic ?? false,
                mirroredAt: mirrorRow.createdAt,
              }
            : null,
        },
      ];
    },
  );

  candidates.sort((left, right) => {
    const mirrorOrder =
      Number(Boolean(left.mirror)) - Number(Boolean(right.mirror));
    return (
      mirrorOrder ||
      left.document.fileName.localeCompare(right.document.fileName)
    );
  });

  return {
    removalId,
    facilityId: removal.facilityId,
    candidates,
    mirroredExternalIds: Array.from(
      new Set(
        candidates.flatMap((candidate) =>
          candidate.mirror ? [candidate.mirror.externalDocumentId] : [],
        ),
      ),
    ).sort(),
    hasMapping: Boolean(mapping),
  };
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

interface SourceCandidateDocumentFacts {
  documentType: string;
  metadata: unknown;
  uploadStatus?: string | null;
  fileUrl?: string | null;
}

export interface SourceCandidateEligibility {
  binding: ClassifiedRemovalSource | null;
  biocharApplicationId: string | null;
}

/** One eligibility rule shared by candidate readback, submission, and summaries. */
export function sourceCandidateEligibility(args: {
  document: SourceCandidateDocumentFacts;
  lineage: CandidateLineageEntity;
  removalId?: string;
}): SourceCandidateEligibility | null {
  if (!isApplicationEvidenceDocumentReady(args.document)) return null;
  const binding = classifyRemovalSourceCandidate({
    documentType: args.document.documentType,
    metadata: args.document.metadata,
    lineage: args.lineage,
    removalId: args.removalId,
  });
  const biocharApplicationId = biocharApplicationIdForSource(
    args.lineage,
    args.document.documentType,
  );
  return binding || biocharApplicationId
    ? { binding, biocharApplicationId }
    : null;
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
      const eligibility = sourceCandidateEligibility({
        document,
        lineage,
        removalId: args.removalId,
      });
      if (eligibility && !candidates.has(document.id)) {
        candidates.set(document.id, {
          documentId: document.id,
          ...eligibility,
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
