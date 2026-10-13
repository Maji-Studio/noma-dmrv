import type { DbTransaction } from "@/db";
import {
  applications,
  biocharProducts,
  certificationSubmissions,
  certifierRemovals,
  creditBatchApplications,
  creditBatchProductionRuns,
  creditBatches,
  deliveries,
  feedstocks,
  orders,
  productionRunFeedstocks,
  productionRuns,
  samples,
} from "@/db/schema";
import { applicationOutputAllocations } from "@/db/schema/application-output-allocations";
import type { OrgContext } from "@/lib/auth/server";
import {
  formatCertificationLineageLockMessage,
  type CertificationLineageLockEntityType,
  type CertificationLineageMutation,
} from "@/lib/certification/lineage-lock-message";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import {
  acquireCertificationArtifactLocksSorted,
  certificationArtifactLockKey,
  type CertificationArtifactLock,
} from "@/lib/certification/submission-lock";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireOrgScope } from "./utils";

export type CertifiedLineageEntityType = Exclude<
  CertificationLineageLockEntityType,
  "transportLeg" | "vehicle"
>;

export interface CertifiedLineageTarget {
  entityType: CertifiedLineageEntityType;
  entityId: string;
}

const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

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
      return or(
        eq(applications.id, target.entityId),
        eq(creditBatchApplications.applicationId, target.entityId),
      )!;
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

/** Records that share one master-data reference, such as a vehicle. */
export interface CertifiedLineageTargetSet {
  feedstockIds: readonly string[];
  deliveryIds: readonly string[];
}

function targetSetCondition(targets: CertifiedLineageTargetSet): SQL | undefined {
  const conditions: SQL[] = [];
  if (targets.feedstockIds.length > 0) {
    conditions.push(inArray(feedstocks.id, [...targets.feedstockIds]));
  }
  if (targets.deliveryIds.length > 0) {
    conditions.push(inArray(deliveries.id, [...targets.deliveryIds]));
  }
  return conditions.length > 0 ? or(...conditions) : undefined;
}

function lineageQuery(
  ctx: OrgContext,
  tx: DbTransaction,
  target: CertifiedLineageTarget,
) {
  return lineageQueryWhere(ctx, tx, targetCondition(target));
}

function lineageQueryWhere(
  ctx: OrgContext,
  tx: DbTransaction,
  condition: SQL,
) {
  requireOrgScope(ctx);
  return tx
    .selectDistinct({
      removalId: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
      creditBatchId: creditBatchApplications.creditBatchId,
      applicationId: applications.id,
      removalSubmissionId: removalSubmission.id,
      removalSubmissionType: removalSubmission.submissionType,
      removalSubmissionStatus: removalSubmission.status,
      ghgStatementSubmissionId: ghgStatementSubmission.id,
    })
    .from(creditBatches)
    // Removal ownership is authoritative on the batch slice itself. Join it
    // directly so an incomplete product/delivery reconstruction cannot release
    // a production-run or sample lock.
    .innerJoin(
      creditBatchApplications,
      and(
        eq(creditBatchApplications.creditBatchId, creditBatches.id),
        eq(creditBatchApplications.organizationId, ctx.organizationId),
      ),
    )
    .innerJoin(
      creditBatchProductionRuns,
      and(eq(creditBatchProductionRuns.creditBatchId, creditBatches.id), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)),
    )
    .innerJoin(
      productionRuns,
      and(eq(productionRuns.id, creditBatchProductionRuns.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)),
    )
    .leftJoin(
      productionRunFeedstocks,
      and(eq(productionRunFeedstocks.productionRunId, productionRuns.id), eq(productionRunFeedstocks.organizationId, ctx.organizationId)),
    )
    .leftJoin(feedstocks, and(eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId)))
    // A Sample anchors on the credit batch (issue #309); the run link is legacy
    // provenance only, kept as a fallback so pre-re-grain rows stay guarded.
    .leftJoin(
      samples,
      and(
        or(
          eq(samples.creditBatchId, creditBatches.id),
          eq(samples.productionRunId, productionRuns.id),
        )!,
        eq(samples.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(applications, and(eq(applications.id, creditBatchApplications.applicationId), eq(applications.organizationId, ctx.organizationId)))
    .leftJoin(applicationOutputAllocations, and(
      eq(applicationOutputAllocations.applicationId, applications.id),
      eq(applicationOutputAllocations.productionRunId, productionRuns.id),
      eq(applicationOutputAllocations.organizationId, ctx.organizationId),
    ))
    .leftJoin(biocharProducts, and(eq(biocharProducts.id, applicationOutputAllocations.biocharProductId), eq(biocharProducts.organizationId, ctx.organizationId)))
    .leftJoin(deliveries, and(eq(deliveries.id, applications.deliveryId), eq(deliveries.organizationId, ctx.organizationId)))
    .leftJoin(orders, and(eq(orders.id, deliveries.orderId), eq(orders.organizationId, ctx.organizationId)))
    .innerJoin(
      certifierRemovals,
      and(eq(certifierRemovals.id, creditBatchApplications.removalId), eq(certifierRemovals.organizationId, ctx.organizationId)),
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
        eq(removalSubmission.organizationId, ctx.organizationId),
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
        eq(ghgStatementSubmission.organizationId, ctx.organizationId),
      ),
    )
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), condition));
}

/** Advisory UI read; mutations must use getLockedCertifiedLineage instead. */
export async function getCertifiedLineage(
  ctx: OrgContext,
  tx: DbTransaction,
  target: CertifiedLineageTarget,
) {
  requireOrgScope(ctx);
  return lineageQuery(ctx, tx, target);
}

export type LockedCertifiedLineageRow = Awaited<
  ReturnType<ReturnType<typeof lineageQueryWhere>["execute"]>
>[number];

/** True when the row's Removal or GHG Statement has a blocking submission. */
export function isSubmittedLineageRow(row: LockedCertifiedLineageRow): boolean {
  return Boolean(row.removalSubmissionId || row.ghgStatementSubmissionId);
}

function lineageArtifactLocks(
  lineage: LockedCertifiedLineageRow[],
): CertificationArtifactLock[] {
  return [
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
  ];
}

/**
 * Resolves a target's certification lineage, locks every referenced artifact in
 * deterministic order, then re-resolves under those locks. Callers that need a
 * narrowly scoped mutation exception must base it only on the returned rows.
 */
export async function getLockedCertifiedLineage(
  ctx: OrgContext,
  tx: DbTransaction,
  target: CertifiedLineageTarget,
): Promise<LockedCertifiedLineageRow[]> {
  requireOrgScope(ctx);
  return lockLineage(tx, () => lineageQuery(ctx, tx, target));
}

/**
 * The locked lineage of every feedstock and delivery in `targets`, resolved in
 * one query. Used when a shared reference (a vehicle) changes a value those
 * records were certified with. Empty sets resolve to no lineage.
 */
export async function getLockedCertifiedLineageForTargetSet(
  ctx: OrgContext,
  tx: DbTransaction,
  targets: CertifiedLineageTargetSet,
): Promise<LockedCertifiedLineageRow[]> {
  requireOrgScope(ctx);
  const condition = targetSetCondition(targets);
  if (!condition) return [];
  return lockLineage(tx, () => lineageQueryWhere(ctx, tx, condition));
}

async function lockLineage(
  tx: DbTransaction,
  resolve: () => PromiseLike<LockedCertifiedLineageRow[]>,
): Promise<LockedCertifiedLineageRow[]> {
  const lineage = await resolve();
  const lockedArtifacts = lineageArtifactLocks(lineage);
  await acquireCertificationArtifactLocksSorted(tx, lockedArtifacts);

  const resolvedLineage = await resolve();
  const lockedKeys = new Set(lockedArtifacts.map(certificationArtifactLockKey));
  const introducedUnlockedArtifact = lineageArtifactLocks(resolvedLineage).some(
    (artifact) => !lockedKeys.has(certificationArtifactLockKey(artifact)),
  );
  if (introducedUnlockedArtifact) {
    throw new SafeError(
      "Certification lineage changed while it was being locked. Refresh and retry.",
    );
  }

  return resolvedLineage;
}

/** Lineage gained an artifact after its locks were taken; a writer never locks it late. */
export class CertificationLineageChangedError extends SafeError {
  constructor() {
    super("Certification lineage changed while it was being locked. Refresh and retry.");
    this.name = "CertificationLineageChangedError";
  }
}

/** One target a writer checks after its row locks, with the copy a lock hit shows. */
export interface CertifiedLineageCheck {
  target: CertifiedLineageTarget;
  mutation: CertificationLineageMutation;
  subjectEntityType?: CertificationLineageLockEntityType;
  lineageRelationship?: "linked" | "selected";
}

/**
 * First half of the shared write order (artifacts, then rows): resolves every
 * target's lineage and locks the union of their artifacts in one sorted pass.
 * Returns the keys held, for `assertLockedLineagesAllowMutation` to compare
 * against once the caller holds its row locks.
 */
export async function lockCertifiedLineageArtifacts(
  ctx: OrgContext,
  tx: DbTransaction,
  targets: CertifiedLineageTarget[],
): Promise<ReadonlySet<string>> {
  requireOrgScope(ctx);
  const artifacts: CertificationArtifactLock[] = [];
  for (const target of targets) {
    artifacts.push(...lineageArtifactLocks(await lineageQuery(ctx, tx, target)));
  }
  await acquireCertificationArtifactLocksSorted(tx, artifacts);
  return new Set(artifacts.map(certificationArtifactLockKey));
}

/**
 * Second half, after the caller's row locks: re-resolves each target. An
 * artifact that was not locked up front (a Removal assigned while the writer
 * waited on a row) refuses the write rather than being locked out of order;
 * a blocking submission on any target refuses with that target's copy.
 */
export async function assertLockedLineagesAllowMutation(
  ctx: OrgContext,
  tx: DbTransaction,
  lockedKeys: ReadonlySet<string>,
  checks: CertifiedLineageCheck[],
): Promise<void> {
  requireOrgScope(ctx);
  for (const check of checks) {
    const lineage = await lineageQuery(ctx, tx, check.target);
    if (lineageArtifactLocks(lineage).some((artifact) => !lockedKeys.has(certificationArtifactLockKey(artifact)))) {
      throw new CertificationLineageChangedError();
    }
    if (!lineage.some((row) => row.removalSubmissionId || row.ghgStatementSubmissionId)) continue;
    throw new SafeError(formatCertificationLineageLockMessage({
      mutation: check.mutation,
      subjectEntityType: check.subjectEntityType ?? check.target.entityType,
      lineageEntityType: check.target.entityType,
      lineageRelationship: check.lineageRelationship,
    }));
  }
}

/**
 * Blocks upstream source-data mutation once the record is part of a live
 * certification artifact. The lineage path is re-derived from current DB state
 * instead of trusting UI context or stale denormalized membership. When the
 * initial lineage is empty there are no artifact rows to lock, so this falls
 * back to the caller's ordinary transaction isolation.
 */
export async function assertCanMutateCertifiedLineage(
  ctx: OrgContext,
  tx: DbTransaction,
  target: CertifiedLineageTarget,
  mutation: CertificationLineageMutation,
  subjectEntityType: CertificationLineageLockEntityType = target.entityType,
  lineageRelationship?: "linked" | "selected",
): Promise<void> {
  requireOrgScope(ctx);
  const hit = (await getLockedCertifiedLineage(ctx, tx, target)).find(
    isSubmittedLineageRow,
  );

  if (!hit) return;

  throw new SafeError(
    formatCertificationLineageLockMessage({
      mutation,
      subjectEntityType,
      lineageEntityType: target.entityType,
      lineageRelationship,
    }),
  );
}
