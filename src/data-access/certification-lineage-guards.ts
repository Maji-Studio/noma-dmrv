import { and, eq, inArray, isNotNull, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbTransaction } from "@/db";
import {
  applications,
  biocharProducts,
  certifierRemovals,
  certificationSubmissions,
  creditBatchApplications,
  creditBatches,
  deliveries,
  feedstocks,
  orders,
  productionRunFeedstocks,
  productionRuns,
  samples,
} from "@/db/schema";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";

type Executor = typeof db | DbTransaction;

export type CertifiedLineageEntityType =
  | "productionRun"
  | "sample"
  | "delivery"
  | "biocharProduct"
  | "feedstock";

export interface CertifiedLineageTarget {
  entityType: CertifiedLineageEntityType;
  entityId: string;
}

const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

const ENTITY_LABELS: Record<CertifiedLineageEntityType, string> = {
  productionRun: "production run",
  sample: "sample",
  delivery: "delivery",
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
    case "productionRun":
      return eq(productionRuns.id, target.entityId);
    case "sample":
      return eq(samples.id, target.entityId);
    case "delivery":
      return eq(deliveries.id, target.entityId);
    case "biocharProduct":
      return eq(biocharProducts.id, target.entityId);
    case "feedstock":
      return eq(feedstocks.id, target.entityId);
  }
}

/**
 * Blocks upstream source-data mutation once the record is part of a live
 * certification artifact. The lineage path is re-derived from current DB state
 * instead of trusting UI context or stale denormalized membership.
 */
export async function assertCanMutateCertifiedLineage(
  executor: Executor,
  target: CertifiedLineageTarget,
  mutation: "create" | "update" | "delete",
): Promise<void> {
  const [hit] = await executor
    .select({ id: creditBatches.id })
    .from(creditBatches)
    .innerJoin(
      creditBatchApplications,
      eq(creditBatchApplications.creditBatchId, creditBatches.id),
    )
    .innerJoin(
      applications,
      eq(applications.id, creditBatchApplications.applicationId),
    )
    .innerJoin(deliveries, eq(deliveries.id, applications.deliveryId))
    .leftJoin(orders, eq(orders.id, deliveries.orderId))
    .leftJoin(
      biocharProducts,
      or(
        eq(biocharProducts.id, deliveries.biocharProductId),
        eq(biocharProducts.id, orders.biocharProductId),
      )!,
    )
    .leftJoin(
      productionRuns,
      eq(productionRuns.id, biocharProducts.linkedProductionRunId),
    )
    .leftJoin(
      productionRunFeedstocks,
      eq(productionRunFeedstocks.productionRunId, productionRuns.id),
    )
    .leftJoin(feedstocks, eq(feedstocks.id, productionRunFeedstocks.feedstockId))
    .leftJoin(samples, eq(samples.productionRunId, productionRuns.id))
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
    .where(
      and(
        targetCondition(target),
        or(
          isNotNull(removalSubmission.id),
          isNotNull(ghgStatementSubmission.id),
        )!,
      ),
    )
    .limit(1);

  if (!hit) return;

  throw new SafeError(
    `Cannot ${mutation} ${ENTITY_LABELS[target.entityType]} because it is part of a submitted certification artifact. Create a correction instead of editing locked source data.`,
  );
}
