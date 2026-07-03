import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbTransaction } from "@/db";
import {
  applications,
  biocharProducts,
  certifierRemovals,
  certificationSubmissions,
  creditBatchProductionRuns,
  creditBatches,
  deliveries,
  feedstocks,
  orders,
  productionRunFeedstocks,
  productionRuns,
  samples,
} from "@/db/schema";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";

export type CertifiedLineageEntityType =
  | "creditBatch"
  | "productionRun"
  | "sample"
  | "application"
  | "delivery"
  | "order"
  | "biocharProduct"
  | "feedstock";

export interface CertifiedLineageTarget {
  entityType: CertifiedLineageEntityType;
  entityId: string;
}

const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

const ENTITY_LABELS: Record<CertifiedLineageEntityType, string> = {
  creditBatch: "credit batch",
  productionRun: "production run",
  sample: "sample",
  application: "application",
  delivery: "delivery",
  order: "order",
  biocharProduct: "biochar product",
  feedstock: "feedstock",
};

const removalSubmission = alias(
  certificationSubmissions,
  "lineage_removal_submission",
);
const ghgStatementSubmission = alias(
  certificationSubmissions,
  "lineage_ghg_statement_submission",
);

function targetCondition(target: CertifiedLineageTarget): SQL {
  switch (target.entityType) {
    case "creditBatch":
      return eq(creditBatches.id, target.entityId);
    case "productionRun":
      return eq(productionRuns.id, target.entityId);
    case "sample":
      return eq(samples.id, target.entityId);
    case "application":
      return eq(applications.id, target.entityId);
    case "delivery":
      return eq(deliveries.id, target.entityId);
    case "order":
      return eq(orders.id, target.entityId);
    case "biocharProduct":
      return eq(biocharProducts.id, target.entityId);
    case "feedstock":
      return eq(feedstocks.id, target.entityId);
  }
}

function lineageQuery(tx: DbTransaction, target: CertifiedLineageTarget) {
  return tx
    .selectDistinct({
      removalId: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
      removalSubmissionId: removalSubmission.id,
      ghgStatementSubmissionId: ghgStatementSubmission.id,
    })
    .from(creditBatches)
    .innerJoin(
      creditBatchProductionRuns,
      eq(creditBatchProductionRuns.creditBatchId, creditBatches.id),
    )
    .innerJoin(
      productionRuns,
      eq(productionRuns.id, creditBatchProductionRuns.productionRunId),
    )
    .leftJoin(
      productionRunFeedstocks,
      eq(productionRunFeedstocks.productionRunId, productionRuns.id),
    )
    .leftJoin(feedstocks, eq(feedstocks.id, productionRunFeedstocks.feedstockId))
    // A Sample anchors on the credit batch (issue #309); the run link is legacy
    // provenance only, kept as a fallback so pre-re-grain rows stay guarded.
    .leftJoin(
      samples,
      or(
        eq(samples.creditBatchId, creditBatches.id),
        eq(samples.productionRunId, productionRuns.id),
      )!,
    )
    .leftJoin(
      biocharProducts,
      eq(biocharProducts.linkedProductionRunId, productionRuns.id),
    )
    .leftJoin(orders, eq(orders.biocharProductId, biocharProducts.id))
    .leftJoin(
      deliveries,
      or(
        eq(deliveries.biocharProductId, biocharProducts.id),
        eq(deliveries.orderId, orders.id),
      )!,
    )
    .leftJoin(applications, eq(applications.deliveryId, deliveries.id))
    .innerJoin(
      certifierRemovals,
      eq(certifierRemovals.id, creditBatches.removalId),
    )
    .leftJoin(
      removalSubmission,
      and(
        eq(removalSubmission.provider, "isometric"),
        eq(removalSubmission.localEntityType, "removal"),
        inArray(
          removalSubmission.submissionType,
          REMOVAL_SCOPED_SUBMISSION_TYPES,
        ),
        eq(removalSubmission.localEntityId, certifierRemovals.id),
        inArray(removalSubmission.status, BLOCKING_SUBMISSION_STATUSES),
      ),
    )
    .leftJoin(
      ghgStatementSubmission,
      and(
        eq(ghgStatementSubmission.provider, "isometric"),
        eq(ghgStatementSubmission.localEntityType, "ghgStatement"),
        eq(ghgStatementSubmission.submissionType, "ghg_statement"),
        eq(ghgStatementSubmission.localEntityId, certifierRemovals.ghgStatementId),
        inArray(ghgStatementSubmission.status, BLOCKING_SUBMISSION_STATUSES),
      ),
    )
    .where(targetCondition(target));
}

/**
 * Blocks upstream source-data mutation once the record is part of a live
 * certification artifact. The lineage path is re-derived from current DB state
 * instead of trusting UI context or stale denormalized membership.
 */
export async function assertCanMutateCertifiedLineage(
  tx: DbTransaction,
  target: CertifiedLineageTarget,
  mutation: "create" | "update" | "delete",
): Promise<void> {
  const lineage = await lineageQuery(tx, target);
  await acquireCertificationArtifactLocksSorted(tx, [
    ...lineage.map((row) => ({
      provider: "isometric",
      localEntityType: "removal",
      localEntityId: row.removalId,
    })),
    ...lineage
      .filter((row) => row.ghgStatementId)
      .map((row) => ({
        provider: "isometric",
        localEntityType: "ghgStatement",
        localEntityId: row.ghgStatementId!,
      })),
  ]);

  const hit = (await lineageQuery(tx, target)).find(
    (row) => row.removalSubmissionId || row.ghgStatementSubmissionId,
  );

  if (!hit) return;

  throw new SafeError(
    `Cannot ${mutation} ${ENTITY_LABELS[target.entityType]} because it is part of a submitted certification artifact. Create a correction instead of editing locked source data.`,
  );
}
