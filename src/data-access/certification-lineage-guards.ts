import type { DbTransaction } from "@/db";
import {
  applications,
  biocharProducts,
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
import { recordLocks, type RecordLockRemoval } from "@/lib/record-lock";
import { DomainError } from "@/lib/domain-errors";
import {
  acquireCertificationArtifactLocksSorted,
  certificationArtifactLockKey,
  tryAcquireCertificationArtifactLocksSorted,
  type CertificationArtifactLock,
} from "@/lib/certification/submission-lock";
import { SafeError } from "@/lib/errors";
import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import { requireOrgScope } from "./utils";
import { readRecordLockLineage } from "./record-lock-lineage";
import { readRecordDependents } from "./record-lock-dependents";

export type CertifiedLineageEntityType = Exclude<
  CertificationLineageLockEntityType,
  "transportLeg" | "vehicle"
>;

export interface CertifiedLineageTarget {
  entityType: CertifiedLineageEntityType;
  entityId: string;
}

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
  fresh = false,
) {
  return resolveLineage(ctx, tx, targetCondition(target), fresh);
}

function lineageQueryWhere(
  ctx: OrgContext,
  tx: Pick<DbTransaction, "select" | "selectDistinct">,
  condition: SQL,
  targetType?: CertifiedLineageEntityType,
) {
  requireOrgScope(ctx);
  return tx
    .selectDistinct({
      removalId: certifierRemovals.id,
      creditBatchId: creditBatchApplications.creditBatchId,
      ghgStatementId: certifierRemovals.ghgStatementId,
      targetId: targetType ? LINEAGE_TARGET_COLUMNS[targetType] : certifierRemovals.id,
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
    // A Sample anchors on its credit batch.
    .leftJoin(
      samples,
      and(
        eq(samples.creditBatchId, creditBatches.id),
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
    .where(and(eq(creditBatches.organizationId, ctx.organizationId), condition));
}

/** Advisory UI read; mutations must use getLockedCertifiedLineage instead. */
export async function getCertifiedLineage(
  ctx: OrgContext,
  tx: DbTransaction,
  target: CertifiedLineageTarget,
) {
  requireOrgScope(ctx);
  return lineageQuery(ctx, tx, target, true);
}

type LineageRow = Awaited<ReturnType<ReturnType<typeof lineageQueryWhere>["execute"]>>[number];
export type LockedCertifiedLineageRow = LineageRow & { recordLockRemoval: RecordLockRemoval };

async function resolveLineage(ctx: OrgContext, tx: DbTransaction, condition: SQL, fresh = false): Promise<LockedCertifiedLineageRow[]> {
  const rows = await lineageQueryWhere(ctx, tx, condition);
  const facts = await readRecordLockLineage(ctx, tx, rows, fresh);
  const factsById = new Map(facts.map(fact => [fact.id, fact]));
  return rows.map(row => ({ ...row, recordLockRemoval: factsById.get(row.removalId)! }));
}

/** All versions and all covering statements participate in the same predicate. */
export function isSubmittedLineageRow(row: LockedCertifiedLineageRow): boolean {
  return recordLocks.removal({ dependents: [], removals: [row.recordLockRemoval] }).level === "sent";
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
    ...lineage.flatMap(row => [...new Set([
      ...(row.ghgStatementId ? [row.ghgStatementId] : []),
      ...row.recordLockRemoval.statements.map(statement => statement.id),
    ])].map(id => ({ provider: "isometric", localEntityType: "ghgStatement", localEntityId: id }))),
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
  return lockLineage(tx, (fresh) => lineageQuery(ctx, tx, target, fresh));
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
  return lockLineage(tx, (fresh) => resolveLineage(ctx, tx, condition, fresh));
}

async function lockLineage(
  tx: DbTransaction,
  resolve: (fresh?: boolean) => PromiseLike<LockedCertifiedLineageRow[]>,
): Promise<LockedCertifiedLineageRow[]> {
  const lineage = await resolve();
  const lockedArtifacts = lineageArtifactLocks(lineage);
  await acquireCertificationArtifactLocksSorted(tx, lockedArtifacts);

  const resolvedLineage = await resolve(true);
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
 * Non-blocking first half, for a caller that already holds a lock other
 * writers take after artifacts (a bin stock lock). Waiting there could
 * deadlock, so contention returns null and the caller aborts with a retryable
 * conflict. The held keys feed `getLineageUnderLockedArtifacts`.
 */
export async function tryLockCertifiedLineageArtifacts(
  ctx: OrgContext,
  tx: DbTransaction,
  targets: CertifiedLineageTarget[],
): Promise<ReadonlySet<string> | null> {
  requireOrgScope(ctx);
  const artifacts: CertificationArtifactLock[] = [];
  for (const target of targets) {
    artifacts.push(...lineageArtifactLocks(await lineageQuery(ctx, tx, target)));
  }
  if (!(await tryAcquireCertificationArtifactLocksSorted(tx, artifacts))) return null;
  return new Set(artifacts.map(certificationArtifactLockKey));
}

/**
 * Fresh lineage of one target while `lockedKeys` are held. Reaching an
 * artifact outside them (a Removal assigned after the locks were taken)
 * throws rather than locking it late.
 */
export async function getLineageUnderLockedArtifacts(
  ctx: OrgContext,
  tx: DbTransaction,
  lockedKeys: ReadonlySet<string>,
  target: CertifiedLineageTarget,
): Promise<LockedCertifiedLineageRow[]> {
  requireOrgScope(ctx);
  const lineage = await lineageQuery(ctx, tx, target, true);
  if (lineageArtifactLocks(lineage).some((artifact) => !lockedKeys.has(certificationArtifactLockKey(artifact)))) {
    throw new CertificationLineageChangedError();
  }
  return lineage;
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
    const lineage = await getLineageUnderLockedArtifacts(ctx, tx, lockedKeys, check.target);
    const lock = recordLocks[check.target.entityType]({ removals: lineage.map(row => row.recordLockRemoval), dependents: [] });
    if (lock.level !== "sent") continue;
    throw new DomainError("certification_locked", formatCertificationLineageLockMessage({
      mutation: check.mutation,
      subjectEntityType: check.subjectEntityType ?? check.target.entityType,
      lineageEntityType: check.target.entityType,
      lineageRelationship: check.lineageRelationship,
      lock,
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
  const lineage = await getLockedCertifiedLineage(ctx, tx, target);
  const lock = recordLocks[target.entityType]({ removals: lineage.map(row => row.recordLockRemoval), dependents: [] });
  if (lock.level !== "sent") return;

  throw new DomainError(
    "certification_locked",
    formatCertificationLineageLockMessage({
      mutation,
      subjectEntityType,
      lineageEntityType: target.entityType,
      lineageRelationship,
      lock,
    }),
  );
}

/** Authoritative lock facts, re-read while every certification artifact is held. */
export async function getLockedRecordLock(ctx: OrgContext, tx: DbTransaction, target: CertifiedLineageTarget) {
  requireOrgScope(ctx);
  const lineage = await getLockedCertifiedLineage(ctx, tx, target);
  return recordLocks[target.entityType]({
    removals: lineage.map(row => row.recordLockRemoval),
    dependents: await readRecordDependents(ctx, tx, target),
  });
}

/** Advisory read. Only the locked mutation read can authorize reopening. */
export async function getRecordLock(ctx: OrgContext, tx: DbTransaction, target: CertifiedLineageTarget) {
  requireOrgScope(ctx);
  const lineage = await getCertifiedLineage(ctx, tx, target);
  return recordLocks[target.entityType]({
    removals: lineage.map(row => row.recordLockRemoval),
    dependents: await readRecordDependents(ctx, tx, target),
  });
}

/** Resolve shared registry facts once for an entire advisory request. */
export async function getRecordLocks(ctx: OrgContext, tx: Pick<DbTransaction, "select" | "selectDistinct">, targets: readonly CertifiedLineageTarget[], options: { sentOnly?: boolean } = {}) {
  requireOrgScope(ctx);
  if (!targets.length) return [];
  const rowsByKind = new Map(await Promise.all([...new Set(targets.map(target => target.entityType))].map(async kind => {
    const rows = await lineageQueryWhere(ctx, tx, or(...targets.filter(target => target.entityType === kind).map(targetCondition))!, kind);
    return [kind, rows] as const;
  })));
  const groups = targets.map(target => rowsByKind.get(target.entityType)!.filter(row => row.targetId === target.entityId));
  const facts = await readRecordLockLineage(ctx, tx, groups.flat(), true);
  return Promise.all(targets.map(async (target, index) => recordLocks[target.entityType]({
    removals: facts.filter(fact => groups[index].some(row => row.removalId === fact.id)),
    dependents: options.sentOnly ? [] : await readRecordDependents(ctx, tx, target),
  })));
}

const LINEAGE_TARGET_COLUMNS = {
  creditBatch: creditBatchApplications.creditBatchId, productionRun: productionRuns.id, sample: samples.id,
  biocharProduct: biocharProducts.id, delivery: deliveries.id, order: orders.id,
  feedstock: feedstocks.id, application: creditBatchApplications.applicationId,
} as const;
