import type { CertifierProvider } from "@/schemas/credit-batches";
import { recordMembershipActivity } from "./write-activity";
/**
 * Explicit credit-batch create, update and delete lock sequence:
 * 1. Discover the batch (update/delete), current/prospective runs and artifacts
 *    without row locks.
 * 2. Lock the batch's certification artifacts. Both artifact helpers delegate
 *    to acquireCertificationArtifactLocksSorted, using one global key order.
 *    Create has no existing batch or certification lineage to guard.
 * 3. Facilities FOR SHARE, sorted, before runs and batch: facility archive and
 *    Removal create take the facility first, including before child FK checks.
 * 4. Current/prospective runs FOR UPDATE, sorted, on create or membership refresh.
 * 5. Production-process advisory scope. Keep runs before scope: auto-attachment
 *    already holds its run before requesting this scope. Other scope holders
 *    in production-processes.ts never request runs or certification artifacts.
 *    Newly matching unassigned runs use late SKIP LOCKED acquisition: it
 *    cannot wait on scope holders, these runs have no batch artifacts, and
 *    their facility is already share-locked. A missed row answers conflict.
 * 6. Batch FOR UPDATE and expected-version check (insert on create).
 * 7. Revalidate artifact set, current/prospective member sets and cohort.
 *    Changed artifacts/current membership answer a typed conflict.
 * 8. Write membership and reconcile slices, whose inserts FK-check applications
 *    with KEY SHARE. Application writers take artifacts, facility, runs SHARE,
 *    batch SHARE, delivery, application, so they serialize before slice writes.
 *
 * Removal submission and lab Sample/document writers take artifacts before
 * batch rows; lifecycle Removal row revalidation uses SKIP LOCKED. Membership
 * refresh takes artifacts before runs, opposite production-run writers. It
 * also takes artifacts before scope, opposite run auto-attachment. Both
 * writers retry transaction aborts; these residuals remain in data/lock-order
 * and data/production-run-artifact-order.
 */
import { assertRowVersion, nextVersion } from "./row-version";
/**
 * Credit Batch Membership Rules
 *
 * The integrity checks a credit batch's production-run membership must satisfy
 * before it is persisted (ADR 0016): the runs exist, belong to the batch's
 * facility and production window, are not already claimed by another batch, and
 * resolve to exactly one feedstock type (a credit batch IS the protocol
 * production batch — one feedstock). Extracted from `credit-batches.ts` to keep
 * that module under the 1000-line cap; both helpers are transaction-scoped so
 * the caller runs them atomically with the batch insert.
 */
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { feedstocks } from "@/db/schema/feedstock";
import {
  productionRuns,
  productionRunFeedstocks,
} from "@/db/schema/production";
import { assertCreditBatchProductionWindow } from "./credit-batch-production-window";
import { getFacilityCertifierWithExecutor } from "./credit-batch-accounting";
import { productionRunMembershipDateExpr } from "./production-runs/date-expr";
import { SafeError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";
import { formatCount, pluralize } from "@/lib/copy-utils";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { lockProductionProcessScope } from "./production-processes";
import { requireOrgScope } from "./utils";
import { CreditBatchLineageChangedError, isCreditBatchMembershipLockedBySubmission, lockCreditBatchArtifacts } from "./credit-batch-certification-lock";

export interface LockedCreditBatchProductionRun {
  id: string;
  code: string;
  facilityId: string;
  status: string;
  membershipDate: string | null;
}

/**
 * Lock prospective/current members after artifacts and before batch/process
 * scope, except newly matching unassigned runs acquired with SKIP LOCKED.
 * Production-run reopen takes the same row lock before checking membership,
 * so it cannot validate stale state alongside a membership write.
 */
export async function lockCreditBatchProductionRuns(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunIds: readonly string[],
  options?: { skipLocked?: boolean },
): Promise<LockedCreditBatchProductionRun[]> {
  requireOrgScope(ctx);
  const sortedRunIds = [...new Set(productionRunIds)].sort();
  if (sortedRunIds.length === 0) return [];

  const query = tx
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      status: productionRuns.status,
      membershipDate: productionRunMembershipDateExpr(),
    })
    .from(productionRuns)
    .where(and(
      inArray(productionRuns.id, sortedRunIds),
      eq(productionRuns.organizationId, ctx.organizationId),
    ))
    .orderBy(productionRuns.id);
  return options?.skipLocked
    ? query.for("update", { skipLocked: true })
    : query.for("update");
}

export async function lockCreditBatchDeclarationRuns(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    facilityId: string;
    feedstockTypeId: string;
    certifier: CertifierProvider | null;
    startDate: string | Date;
    endDate: string | Date;
    requestedProductionRunIds: string[];
    currentProductionRunIds?: string[];
    matchingProductionRunIds?: string[];
  },
): Promise<{
  runIds: string[];
  lockedRuns: LockedCreditBatchProductionRun[];
}> {
  const matchingBeforeLock = params.matchingProductionRunIds ?? await findMatchingUnassignedProductionRunIds(
    ctx,
    tx,
    params,
  );
  const runIds = [
    ...new Set([
      ...params.requestedProductionRunIds,
      ...matchingBeforeLock,
    ]),
  ].sort();
  await lockMembershipFacilities(ctx, tx, [params.facilityId]);
  const lockedRuns = await lockCreditBatchProductionRuns(ctx, tx, [
    ...(params.currentProductionRunIds ?? []),
    ...runIds,
  ]);

  await lockProductionProcessScope(tx, params);
  const matchingAfterLock = await findMatchingUnassignedProductionRunIds(
    ctx,
    tx,
    params,
  );
  const lockedIds = new Set(lockedRuns.map(run => run.id));
  const lateRunIds = matchingAfterLock.filter(id => !lockedIds.has(id));
  const lateRuns = await lockCreditBatchProductionRuns(ctx, tx, lateRunIds, { skipLocked: true });
  if (lateRuns.length !== lateRunIds.length) {
    throw membershipChanged(
      "Matching production runs are being updated while this credit batch is being declared. Refresh and retry.",
    );
  }
  return {
    runIds: [...new Set([...runIds, ...lateRunIds])].sort(),
    lockedRuns: [...lockedRuns, ...lateRuns],
  };
}

export interface LockedCreditBatchForUpdate {
  row: typeof creditBatches.$inferSelect;
  lockedRemovals: Awaited<ReturnType<typeof lockCreditBatchArtifacts>>;
  version: number;
  code: string;
  facilityId: string;
  startDate: string;
  endDate: string;
  feedstockTypeId: string;
}

function membershipChanged(message = "The credit batch cohort changed while this update was being prepared. Refresh and retry.") {
  return new DomainError("conflict", message, { retryable: true });
}

function sameIds(before: readonly string[], after: readonly string[]): boolean {
  const sortedBefore = [...before].sort();
  const sortedAfter = [...after].sort();
  return sortedBefore.length === sortedAfter.length &&
    sortedBefore.every((id, index) => id === sortedAfter[index]);
}

async function lockMembershipFacilities(ctx: OrgContext, tx: DbTransaction, ids: string[]) {
  await tx.select({ id: facilities.id }).from(facilities)
    .where(and(inArray(facilities.id, [...new Set(ids)].sort()), eq(facilities.organizationId, ctx.organizationId)))
    .orderBy(facilities.id).for("share");
}

const batchMembershipFields = {
  version: creditBatches.version,
  code: creditBatches.code,
  facilityId: creditBatches.facilityId,
  startDate: creditBatches.startDate,
  endDate: creditBatches.endDate,
  feedstockTypeId: creditBatches.feedstockTypeId,
};

async function readMembershipRunIds(ctx: OrgContext, tx: DbTransaction, id: string) {
  const links = await tx.select({ id: creditBatchProductionRuns.productionRunId })
    .from(creditBatchProductionRuns)
    .where(and(eq(creditBatchProductionRuns.creditBatchId, id), eq(creditBatchProductionRuns.organizationId, ctx.organizationId)))
    .orderBy(creditBatchProductionRuns.productionRunId);
  return links.map(link => link.id);
}

/** Discover before any row locks; update then locks its prospective runs too. */
export async function prepareCreditBatchMembershipWrite(
  ctx: OrgContext,
  tx: DbTransaction,
  id: string,
  target: { facilityId?: string; feedstockTypeId?: string; startDate?: string | Date; endDate?: string | Date } = {},
  refreshMembership = false,
) {
  requireOrgScope(ctx);
  const [snapshot] = await tx.select(batchMembershipFields).from(creditBatches)
    .where(and(eq(creditBatches.id, id), eq(creditBatches.organizationId, ctx.organizationId)));
  if (!snapshot) throw new SafeError("Credit batch not found");
  const currentProductionRunIds = await readMembershipRunIds(ctx, tx, id);
  const certifier = await getFacilityCertifierWithExecutor(ctx, tx, target.facilityId ?? snapshot.facilityId);
  const matchingProductionRunIds = refreshMembership
    ? await findMatchingUnassignedProductionRunIds(ctx, tx, {
        facilityId: target.facilityId ?? snapshot.facilityId,
        feedstockTypeId: target.feedstockTypeId ?? snapshot.feedstockTypeId,
        certifier,
        startDate: target.startDate ?? snapshot.startDate,
        endDate: target.endDate ?? snapshot.endDate,
      })
    : undefined;
  const lockedRemovals = await lockCreditBatchArtifacts(ctx, tx, id);
  await lockMembershipFacilities(ctx, tx, [snapshot.facilityId, target.facilityId ?? snapshot.facilityId]);
  return { snapshot, currentProductionRunIds, matchingProductionRunIds, lockedRemovals, certifier };
}

export async function assertNoOverlappingCreditBatchCohort(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    facilityId: string;
    feedstockTypeId: string;
    certifier: CertifierProvider | null;
    startDate: string | Date;
    endDate: string | Date;
    excludeCreditBatchId?: string;
  },
): Promise<void> {
  const { startStr, endStr } = assertCreditBatchProductionWindow(
    params.startDate,
    params.endDate,
    params.certifier,
  );
  const [overlap] = await tx
    .select({ code: creditBatches.code })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.organizationId, ctx.organizationId),
        eq(creditBatches.facilityId, params.facilityId),
        eq(creditBatches.feedstockTypeId, params.feedstockTypeId),
        lte(creditBatches.startDate, endStr),
        gte(creditBatches.endDate, startStr),
        isNull(creditBatches.archivedAt),
        params.excludeCreditBatchId
          ? ne(creditBatches.id, params.excludeCreditBatchId)
          : undefined,
      ),
    )
    .orderBy(creditBatches.id)
    .limit(1);

  if (overlap) {
    throw new SafeError(
      `This production cohort overlaps credit batch ${overlap.code}. Use a non-overlapping window for the same facility and feedstock.`,
    );
  }
}

export async function lockCreditBatchForUpdate(
  ctx: OrgContext,
  tx: DbTransaction,
  id: string,
  target: { facilityId?: string; feedstockTypeId?: string; expectedVersion: number },
  prepared?: Awaited<ReturnType<typeof prepareCreditBatchMembershipWrite>>,
): Promise<LockedCreditBatchForUpdate> {
  const { snapshot, currentProductionRunIds, lockedRemovals } = prepared ??
    await prepareCreditBatchMembershipWrite(ctx, tx, id, target);
  // Membership refresh already locked the old/new run union. Scalar edits and
  // delete need no run locks: batch UPDATE serializes with applications' SHARE
  // before membership links or slices change, including delete's FK checks.
  await lockProductionProcessScope(tx, {
    facilityId: target.facilityId ?? snapshot.facilityId,
    feedstockTypeId: target.feedstockTypeId ?? snapshot.feedstockTypeId,
  });
  const [locked] = await tx
    .select()
    .from(creditBatches)
    .where(and(
      eq(creditBatches.id, id),
      eq(creditBatches.organizationId, ctx.organizationId),
    ))
    .for("update");
  if (!locked) throw new SafeError("Credit batch not found");
  assertRowVersion({ entity: "creditBatch", id, expectedVersion: target.expectedVersion, actualVersion: locked.version });
  if (
    locked.facilityId !== snapshot.facilityId ||
    locked.feedstockTypeId !== snapshot.feedstockTypeId ||
    locked.startDate !== snapshot.startDate ||
    locked.endDate !== snapshot.endDate
  ) {
    throw membershipChanged();
  }
  if (!sameIds(currentProductionRunIds, await readMembershipRunIds(ctx, tx, id))) {
    throw membershipChanged("Credit batch membership changed while this update was being prepared. Refresh and retry.");
  }
  try {
    // Revalidate artifacts under the batch lock, including SKIP LOCKED Removal
    // rows. The caller still applies its mutation-specific submission refusal.
    await isCreditBatchMembershipLockedBySubmission(ctx, tx, id, lockedRemovals);
  } catch (error) {
    if (error instanceof CreditBatchLineageChangedError) throw membershipChanged(error.message);
    throw error;
  }
  return { ...locked, lockedRemovals, row: locked };
}

/**
 * Validate that all production run IDs exist, belong to the credit batch's
 * facility, end inside its production window, and are not assigned elsewhere.
 */
export async function validateProductionRunIds(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunIds: string[],
  facilityId: string,
  certifier: CertifierProvider | null,
  startDate?: string | Date,
  endDate?: string | Date,
  excludeCreditBatchId?: string,
  lockedRows?: readonly LockedCreditBatchProductionRun[],
): Promise<void> {
  requireOrgScope(ctx);
  if (productionRunIds.length === 0) return;

  // Reject duplicates
  const uniqueRunIds = new Set(productionRunIds);
  if (uniqueRunIds.size !== productionRunIds.length) {
    throw new SafeError(
      "The selected production runs include a duplicate. Remove it and try again.",
    );
  }

  // Membership-changing callers pass rows acquired by the lock helper above.
  // Other revalidation paths retain a plain read: taking a hidden run lock
  // after their batch/removal locks would invert the documented lock order.
  const rows = lockedRows ?? await tx
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      status: productionRuns.status,
      membershipDate: productionRunMembershipDateExpr(),
    })
    .from(productionRuns)
    .where(and(
      inArray(productionRuns.id, productionRunIds),
      eq(productionRuns.organizationId, ctx.organizationId),
    ));

  if (rows.length !== productionRunIds.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = productionRunIds.filter((id) => !found.has(id));
    throw new SafeError(
      `${missing.length === 1 ? "A selected production run was" : `${missing.length} selected production runs were`} not found. Refresh the credit batch and choose its production runs again.`,
    );
  }

  const incomplete = rows.filter(
    (row) => row.status !== COMPLETED_PRODUCTION_RUN_STATUS,
  );
  if (incomplete.length > 0) {
    throw new SafeError(
      `${pluralize(incomplete.length, "Production run")} ${incomplete.map((row) => row.code).join(", ")} ${incomplete.length === 1 ? "is" : "are"} not complete. Complete ${incomplete.length === 1 ? "it" : "them"} or choose ${incomplete.length === 1 ? "another production run" : "other production runs"}.`,
    );
  }

  const crossFacility = rows.filter((r) => r.facilityId !== facilityId);
  if (crossFacility.length > 0) {
    throw new SafeError(
      `${pluralize(crossFacility.length, "Production run")} ${crossFacility.map((r) => r.code).join(", ")} ${crossFacility.length === 1 ? "does" : "do"} not belong to the selected facility. Choose production runs from this facility.`,
    );
  }

  if (startDate != null && endDate != null) {
    const { startStr, endStr } = assertCreditBatchProductionWindow(
      startDate,
      endDate,
      certifier,
    );
    const outsideWindow = rows.filter((r) => {
      return r.membershipDate == null || r.membershipDate < startStr || r.membershipDate > endStr;
    });

    if (outsideWindow.length > 0) {
      throw new SafeError(
        `${pluralize(outsideWindow.length, "Production run")} ${outsideWindow.map((r) => r.code).join(", ")} ${outsideWindow.length === 1 ? "falls" : "fall"} outside the credit batch production window (${startStr} to ${endStr}). Change the window or choose matching production runs.`,
      );
    }
  }

  const assignmentConditions = [
    inArray(creditBatchProductionRuns.productionRunId, productionRunIds),
    eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
  ];
  if (excludeCreditBatchId) {
    assignmentConditions.push(
      sql`${creditBatchProductionRuns.creditBatchId} != ${excludeCreditBatchId}`,
    );
  }

  const existingAssignments = await tx
    .select({
      productionRunId: creditBatchProductionRuns.productionRunId,
      creditBatchCode: creditBatches.code,
    })
    .from(creditBatchProductionRuns)
    .innerJoin(
      creditBatches,
      and(eq(creditBatchProductionRuns.creditBatchId, creditBatches.id), eq(creditBatches.organizationId, ctx.organizationId)),
    )
    .where(and(...assignmentConditions));

  if (existingAssignments.length > 0) {
    const runCodeById = new Map(rows.map((row) => [row.id, row.code]));
    throw new SafeError(
      `${pluralize(existingAssignments.length, "Production run")} ${existingAssignments.map((row) => `${runCodeById.get(row.productionRunId) ?? "Code not recorded"} (${row.creditBatchCode})`).join(", ")} ${existingAssignments.length === 1 ? "is" : "are"} already assigned to a credit batch. Remove the existing assignment or choose other production runs.`,
    );
  }
}

/**
 * Derive the SINGLE feedstock type shared by a set of production runs, resolved
 * through productionRunFeedstocks → feedstocks.feedstockTypeId (ADR 0016: a
 * credit batch is the protocol production batch — one feedstock). Throws loudly
 * if the runs resolve to zero or to more than one feedstock type: a run blending
 * >1 feedstock type, or a cohort mixing feedstocks, is rejected rather than
 * silently coerced (consistent-blend modelling is deferred). The returned type
 * populates `credit_batches.feedstockTypeId` and keys the production process.
 */
export async function resolveSingleFeedstockType(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunIds: string[],
): Promise<string> {
  if (productionRunIds.length === 0) {
    throw new SafeError(
      "A credit batch must include at least one production run so its feedstock can be derived.",
    );
  }

  const uniqueRunIds = [...new Set(productionRunIds)];
  const rows = await tx
    .selectDistinct({
      productionRunId: productionRunFeedstocks.productionRunId,
      feedstockTypeId: feedstocks.feedstockTypeId,
    })
    .from(productionRunFeedstocks)
    .innerJoin(
      feedstocks,
      and(eq(productionRunFeedstocks.feedstockId, feedstocks.id), eq(feedstocks.organizationId, ctx.organizationId)),
    )
    .where(and(
      inArray(productionRunFeedstocks.productionRunId, uniqueRunIds),
      eq(productionRunFeedstocks.organizationId, ctx.organizationId),
    ));

  const mappedRunIds = new Set(
    rows
      .filter((r) => r.feedstockTypeId != null)
      .map((r) => r.productionRunId),
  );
  const missingFeedstockRunIds = uniqueRunIds.filter(
    (id) => !mappedRunIds.has(id),
  );
  if (missingFeedstockRunIds.length > 0) {
    throw new SafeError(
      `${formatCount(missingFeedstockRunIds.length, "Production run")} ${missingFeedstockRunIds.length === 1 ? "has" : "have"} no linked feedstock. Link feedstock to each production run before adding it to a credit batch.`,
    );
  }

  const typeIds = [
    ...new Set(
      rows
        .map((r) => r.feedstockTypeId)
        .filter((feedstockTypeId): feedstockTypeId is string => feedstockTypeId != null),
    ),
  ];

  if (typeIds.length === 0) {
    throw new SafeError(
      "The selected production runs have no linked feedstock. Link the feedstock before adding the production runs to a credit batch.",
    );
  }
  if (typeIds.length > 1) {
    throw new SafeError(
      "A credit batch must contain one feedstock. " +
        `The selected production runs use ${typeIds.length} feedstock types. Create one credit batch for each feedstock type.`,
    );
  }

  return typeIds[0];
}

async function resolveSingleRunFeedstockTypeOrNull(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunId: string,
): Promise<string | null> {
  const rows = await tx
    .selectDistinct({ feedstockTypeId: feedstocks.feedstockTypeId })
    .from(productionRunFeedstocks)
    .innerJoin(
      feedstocks,
      and(
        eq(productionRunFeedstocks.feedstockId, feedstocks.id),
        eq(feedstocks.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(productionRunFeedstocks.productionRunId, productionRunId),
        eq(productionRunFeedstocks.organizationId, ctx.organizationId),
      ),
    );

  return rows.length === 1 ? rows[0].feedstockTypeId : null;
}

/**
 * Guard that a batch's member runs match the feedstock type declared on the
 * form (ADR 0016 amendment 2026-07-04: feedstock type is now a declared input,
 * not derived from the runs). Resolves the runs' single feedstock type — reusing
 * the >1-type / no-feedstock assertions above — then requires it to equal the
 * declared type. Keeps the one-feedstock grain while letting the UI scope the
 * process/Method-A-B context up front.
 */
export async function assertDeclaredFeedstockType(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunIds: string[],
  declaredFeedstockTypeId: string,
): Promise<void> {
  // A batch may be declared before production starts. Its facility, feedstock,
  // and date window are enough to identify the cohort; completed matching runs
  // attach as they are recorded.
  if (productionRunIds.length === 0) return;

  const resolved = await resolveSingleFeedstockType(ctx, tx, productionRunIds);
  if (resolved !== declaredFeedstockTypeId) {
    throw new SafeError(
      `The selected production runs are a different feedstock than the one chosen for this batch. ` +
        "A credit batch contains one feedstock. Choose production runs that use the selected feedstock, " +
        `or change the batch's feedstock type.`,
    );
  }
}

/**
 * Find every unassigned completed run whose end date is inside the cohort window.
 * Feedstock identity is resolved from the run's actual feedstock links; empty
 * and mixed-feedstock runs stay unassigned because they cannot belong to a
 * single-feedstock credit batch.
 */
export async function findMatchingUnassignedProductionRunIds(
  ctx: OrgContext,
  tx: DbTransaction,
  params: {
    facilityId: string;
    feedstockTypeId: string;
    certifier: CertifierProvider | null;
    startDate: string | Date;
    endDate: string | Date;
  },
): Promise<string[]> {
  requireOrgScope(ctx);
  const { startStr, endStr } = assertCreditBatchProductionWindow(
    params.startDate,
    params.endDate,
    params.certifier,
  );
  const rows = await tx
    .selectDistinct({
      productionRunId: productionRuns.id,
      feedstockTypeId: feedstocks.feedstockTypeId,
    })
    .from(productionRuns)
    .innerJoin(
      productionRunFeedstocks,
      and(
        eq(productionRunFeedstocks.productionRunId, productionRuns.id),
        eq(
          productionRunFeedstocks.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .innerJoin(
      feedstocks,
      and(
        eq(feedstocks.id, productionRunFeedstocks.feedstockId),
        eq(feedstocks.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      creditBatchProductionRuns,
      and(
        eq(
          creditBatchProductionRuns.productionRunId,
          productionRuns.id,
        ),
        eq(
          creditBatchProductionRuns.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(productionRuns.organizationId, ctx.organizationId),
        eq(productionRuns.facilityId, params.facilityId),
        eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS),
        gte(productionRunMembershipDateExpr(), startStr),
        lte(productionRunMembershipDateExpr(), endStr),
        isNull(productionRuns.archivedAt),
        isNull(creditBatchProductionRuns.creditBatchId),
      ),
    );

  const typesByRun = new Map<string, Set<string>>();
  for (const row of rows) {
    const types = typesByRun.get(row.productionRunId) ?? new Set<string>();
    types.add(row.feedstockTypeId);
    typesByRun.set(row.productionRunId, types);
  }

  return Array.from(typesByRun.entries())
    .filter(
      ([, typeIds]) =>
        typeIds.size === 1 && typeIds.has(params.feedstockTypeId),
    )
    .map(([productionRunId]) => productionRunId)
    .sort();
}

/**
 * Attach one completed run to the credit batch identified by its facility,
 * single feedstock type, and end date. Called inside the production-run
 * write transaction after feedstock allocation is final, so membership and
 * sample back-filling commit atomically with completion.
 */
export async function attachProductionRunToMatchingCreditBatch(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunId: string,
): Promise<string | null> {
  requireOrgScope(ctx);
  const [run] = await tx
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      status: productionRuns.status,
      membershipDate: productionRunMembershipDateExpr(),
    })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.id, productionRunId),
        eq(productionRuns.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  if (!run || run.status !== COMPLETED_PRODUCTION_RUN_STATUS || run.membershipDate == null) return null;

  const [existingMembership] = await tx
    .select({
      creditBatchId: creditBatchProductionRuns.creditBatchId,
      creditBatchCode: creditBatches.code,
      facilityId: creditBatches.facilityId,
      feedstockTypeId: creditBatches.feedstockTypeId,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
    })
    .from(creditBatchProductionRuns)
    .innerJoin(
      creditBatches,
      and(
        eq(
          creditBatches.id,
          creditBatchProductionRuns.creditBatchId,
        ),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        eq(creditBatchProductionRuns.productionRunId, productionRunId),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  const feedstockTypeId = await resolveSingleRunFeedstockTypeOrNull(
    ctx,
    tx,
    productionRunId,
  );
  if (
    existingMembership &&
    (
      run.facilityId !== existingMembership.facilityId ||
      run.membershipDate < existingMembership.startDate ||
      run.membershipDate > existingMembership.endDate ||
      feedstockTypeId !== existingMembership.feedstockTypeId
    )
  ) {
    throw new SafeError(
      `Production run ${run.code} cannot be edited outside its declared cohort while it belongs to credit batch ${existingMembership.creditBatchCode}.`,
    );
  }
  if (existingMembership) return existingMembership.creditBatchId;
  if (!feedstockTypeId) return null;
  // Batch declarations and run completions share this predicate lock. The
  // production-run transaction already holds the run row. Explicit membership
  // writers take artifacts before runs/scope, while attachment takes run,
  // scope, then batch artifacts. Both writers retry the residual inversions
  // tracked in data/production-run-artifact-order and data/lock-order.
  await lockProductionProcessScope(tx, {
    facilityId: run.facilityId,
    feedstockTypeId,
  });
  const matchingBatches = await tx
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
    })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.organizationId, ctx.organizationId),
        eq(creditBatches.facilityId, run.facilityId),
        eq(creditBatches.feedstockTypeId, feedstockTypeId),
        lte(creditBatches.startDate, run.membershipDate),
        gte(creditBatches.endDate, run.membershipDate),
        isNull(creditBatches.archivedAt),
      ),
    )
    .orderBy(creditBatches.id);

  if (matchingBatches.length === 0) return null;
  if (matchingBatches.length > 1) {
    // Legacy cohorts may predate overlap validation. Keep routine production
    // recording available and leave ambiguous membership for explicit repair.
    return null;
  }

  const [batch] = matchingBatches;
  const lockedRemovals = await lockCreditBatchArtifacts(ctx, tx, batch.id);
  const [lockedBatch] = await tx.select({ id: creditBatches.id })
    .from(creditBatches)
    .where(and(eq(creditBatches.id, batch.id), eq(creditBatches.organizationId, ctx.organizationId),
      eq(creditBatches.facilityId, run.facilityId), eq(creditBatches.feedstockTypeId, feedstockTypeId),
      lte(creditBatches.startDate, run.membershipDate), gte(creditBatches.endDate, run.membershipDate), isNull(creditBatches.archivedAt)))
    .for("update");
  if (!lockedBatch) return null;
  try {
    if (
      await isCreditBatchMembershipLockedBySubmission(
        ctx,
        tx,
        batch.id,
        lockedRemovals,
      )
    ) {
      return null;
    }
  } catch (error) {
    // Routine production recording can continue without attaching uncertain
    // membership. Explicit batch edits still refuse this lineage race.
    if (error instanceof CreditBatchLineageChangedError) return null;
    throw error;
  }

  await tx.insert(creditBatchProductionRuns).values({
    organizationId: ctx.organizationId,
    creditBatchId: batch.id,
    productionRunId,
  });
  // The edit form includes membership, so auto-attachment also invalidates an
  // already-open batch form even though no scalar batch field was edited.
  await tx.update(creditBatches)
    .set({ version: nextVersion(creditBatches.version), updatedAt: new Date() })
    .where(and(eq(creditBatches.id, batch.id), eq(creditBatches.organizationId, ctx.organizationId)));

  await recordMembershipActivity(ctx, tx, batch.id, [], [productionRunId], { source: "system" });
  return batch.id;
}
