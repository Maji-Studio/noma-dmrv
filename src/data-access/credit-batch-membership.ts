/**
 * Credit Batch Membership Rules
 *
 * The integrity checks a credit batch's production-run membership must satisfy
 * before it is persisted (ADR 0016): the runs exist, belong to the batch's
 * facility and ≤1-month window, are not already claimed by another batch, and
 * resolve to exactly one feedstock type (a credit batch IS the protocol
 * production batch — one feedstock). Extracted from `credit-batches.ts` to keep
 * that module under the 1000-line cap; both helpers are transaction-scoped so
 * the caller runs them atomically with the batch insert.
 */
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { feedstocks } from "@/db/schema/feedstock";
import {
  productionRuns,
  productionRunFeedstocks,
  samples,
} from "@/db/schema/production";
import { assertCreditBatchProductionWindow } from "./credit-batch-production-window";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { SafeError } from "@/lib/errors";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { lockProductionProcessScope } from "./production-processes";

export interface LockedCreditBatchProductionRun {
  id: string;
  code: string;
  facilityId: string;
  status: string;
  date: string;
}

/**
 * Lock every prospective/current member in deterministic order before a credit
 * batch, removal, or certification lock is taken. Production-run reopen takes
 * the same row lock before checking membership, so either the membership write
 * or the reopen wins; they cannot both validate stale state.
 */
export async function lockCreditBatchProductionRuns(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunIds: readonly string[],
  options?: { skipLocked?: boolean },
): Promise<LockedCreditBatchProductionRun[]> {
  const sortedRunIds = [...new Set(productionRunIds)].sort();
  if (sortedRunIds.length === 0) return [];

  const query = tx
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      status: productionRuns.status,
      date: productionRunDateExpr(),
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
    startDate: string | Date;
    endDate: string | Date;
    requestedProductionRunIds: string[];
  },
): Promise<{
  runIds: string[];
  lockedRuns: LockedCreditBatchProductionRun[];
}> {
  const matchingBeforeLock = await findMatchingUnassignedProductionRunIds(
    ctx,
    tx,
    params,
  );
  let runIds = [
    ...new Set([
      ...params.requestedProductionRunIds,
      ...matchingBeforeLock,
    ]),
  ].sort();
  let lockedRuns = await lockCreditBatchProductionRuns(ctx, tx, runIds);

  await lockProductionProcessScope(tx, params);
  const matchingAfterLock = await findMatchingUnassignedProductionRunIds(
    ctx,
    tx,
    params,
  );
  const beforeIds = new Set(matchingBeforeLock);
  const selectedIds = new Set(runIds);
  const concurrentlyCompletedRunIds = matchingAfterLock.filter(
    (runId) => !beforeIds.has(runId) && !selectedIds.has(runId),
  );
  if (concurrentlyCompletedRunIds.length > 0) {
    const concurrentlyLocked = await lockCreditBatchProductionRuns(
      ctx,
      tx,
      concurrentlyCompletedRunIds,
      { skipLocked: true },
    );
    if (concurrentlyLocked.length !== concurrentlyCompletedRunIds.length) {
      throw new SafeError(
        "Matching production runs are being updated while this Credit batch is being declared. Refresh and retry.",
      );
    }
    runIds = [...new Set([...runIds, ...concurrentlyCompletedRunIds])].sort();
    lockedRuns = [...lockedRuns, ...concurrentlyLocked];
  }
  return { runIds, lockedRuns };
}

export interface LockedCreditBatchForUpdate {
  facilityId: string;
  startDate: string;
  endDate: string;
  removalId: string | null;
  feedstockTypeId: string;
}

export async function lockCreditBatchForUpdate(
  ctx: OrgContext,
  tx: DbTransaction,
  id: string,
  target: { facilityId?: string; feedstockTypeId?: string },
): Promise<LockedCreditBatchForUpdate> {
  const selectFields = {
    facilityId: creditBatches.facilityId,
    startDate: creditBatches.startDate,
    endDate: creditBatches.endDate,
    removalId: creditBatches.removalId,
    feedstockTypeId: creditBatches.feedstockTypeId,
  };
  const [snapshot] = await tx
    .select(selectFields)
    .from(creditBatches)
    .where(and(
      eq(creditBatches.id, id),
      eq(creditBatches.organizationId, ctx.organizationId),
    ));
  if (!snapshot) throw new SafeError("Credit batch not found");

  await lockProductionProcessScope(tx, {
    facilityId: target.facilityId ?? snapshot.facilityId,
    feedstockTypeId: target.feedstockTypeId ?? snapshot.feedstockTypeId,
  });
  const [locked] = await tx
    .select(selectFields)
    .from(creditBatches)
    .where(and(
      eq(creditBatches.id, id),
      eq(creditBatches.organizationId, ctx.organizationId),
    ))
    .for("update");
  if (!locked) throw new SafeError("Credit batch not found");
  if (
    locked.facilityId !== snapshot.facilityId ||
    locked.feedstockTypeId !== snapshot.feedstockTypeId ||
    locked.startDate !== snapshot.startDate ||
    locked.endDate !== snapshot.endDate
  ) {
    throw new SafeError(
      "The Credit batch cohort changed while this update was being prepared. Refresh and retry.",
    );
  }
  return locked;
}

/**
 * Validate that all production run IDs exist, belong to the credit batch's
 * facility and production window, and are not already assigned elsewhere.
 */
export async function validateProductionRunIds(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunIds: string[],
  facilityId: string,
  startDate?: string | Date,
  endDate?: string | Date,
  excludeCreditBatchId?: string,
  lockedRows?: readonly LockedCreditBatchProductionRun[],
): Promise<void> {
  if (productionRunIds.length === 0) return;

  // Reject duplicates
  const uniqueRunIds = new Set(productionRunIds);
  if (uniqueRunIds.size !== productionRunIds.length) {
    throw new SafeError("Duplicate production run IDs are not allowed");
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
      date: productionRunDateExpr(),
    })
    .from(productionRuns)
    .where(and(
      inArray(productionRuns.id, productionRunIds),
      eq(productionRuns.organizationId, ctx.organizationId),
    ));

  if (rows.length !== productionRunIds.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = productionRunIds.filter((id) => !found.has(id));
    throw new SafeError(`Production run(s) not found: ${missing.join(", ")}`);
  }

  const incomplete = rows.filter(
    (row) => row.status !== COMPLETED_PRODUCTION_RUN_STATUS,
  );
  if (incomplete.length > 0) {
    throw new SafeError(
      `Only complete production runs can be added to a Credit batch: ${incomplete.map((row) => row.id).join(", ")}`,
    );
  }

  const crossFacility = rows.filter((r) => r.facilityId !== facilityId);
  if (crossFacility.length > 0) {
    throw new SafeError(
      `Production run(s) do not belong to the selected facility: ${crossFacility.map((r) => r.id).join(", ")}`
    );
  }

  if (startDate != null && endDate != null) {
    const { startStr, endStr } = assertCreditBatchProductionWindow(
      startDate,
      endDate,
    );
    const outsideWindow = rows.filter((r) => {
      return r.date < startStr || r.date > endStr;
    });

    if (outsideWindow.length > 0) {
      throw new SafeError(
        `Production run(s) fall outside the credit batch production window (${startStr} – ${endStr}): ${outsideWindow.map((r) => r.id).join(", ")}`
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
    throw new SafeError(
      `Production run(s) already assigned to credit batches: ${existingAssignments.map((row) => `${row.productionRunId} (${row.creditBatchCode})`).join(", ")}`,
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
      `Cannot derive the credit batch feedstock: production run(s) have no linked feedstock: ${missingFeedstockRunIds.join(", ")}.`,
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
      "Cannot derive the credit batch feedstock: the selected production run(s) have no linked feedstock.",
    );
  }
  if (typeIds.length > 1) {
    throw new SafeError(
      `A credit batch must be a single feedstock (ADR 0016 — the protocol production batch). ` +
        `The selected production run(s) span ${typeIds.length} feedstock types; split them into one credit batch per feedstock.`,
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
        `A credit batch is a single feedstock (ADR 0016) — pick runs matching the chosen feedstock, ` +
        `or change the batch's feedstock type.`,
    );
  }
}

/**
 * Find every currently unassigned completed run inside a declared cohort.
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
    startDate: string | Date;
    endDate: string | Date;
  },
): Promise<string[]> {
  const { startStr, endStr } = assertCreditBatchProductionWindow(
    params.startDate,
    params.endDate,
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
        gte(productionRunDateExpr(), startStr),
        lte(productionRunDateExpr(), endStr),
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
 * single feedstock type, and production date. Called inside the production-run
 * write transaction after feedstock allocation is final, so membership and
 * sample back-filling commit atomically with completion.
 */
export async function attachProductionRunToMatchingCreditBatch(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunId: string,
): Promise<string | null> {
  const [run] = await tx
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      status: productionRuns.status,
      date: productionRunDateExpr(),
    })
    .from(productionRuns)
    .where(
      and(
        eq(productionRuns.id, productionRunId),
        eq(productionRuns.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  if (!run || run.status !== COMPLETED_PRODUCTION_RUN_STATUS) return null;

  const [existingMembership] = await tx
    .select({ creditBatchId: creditBatchProductionRuns.creditBatchId })
    .from(creditBatchProductionRuns)
    .where(
      and(
        eq(creditBatchProductionRuns.productionRunId, productionRunId),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (existingMembership) return existingMembership.creditBatchId;

  const feedstockTypeId = await resolveSingleRunFeedstockTypeOrNull(
    ctx,
    tx,
    productionRunId,
  );
  if (!feedstockTypeId) return null;
  // Batch declarations and run completions share this predicate lock. The
  // production-run transaction already holds the run row, so both paths order
  // their locks run -> process scope before reading/writing membership.
  await lockProductionProcessScope(tx, {
    facilityId: run.facilityId,
    feedstockTypeId,
  });
  const matchingBatches = await tx
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      removalId: creditBatches.removalId,
    })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.organizationId, ctx.organizationId),
        eq(creditBatches.facilityId, run.facilityId),
        eq(creditBatches.feedstockTypeId, feedstockTypeId),
        lte(creditBatches.startDate, run.date),
        gte(creditBatches.endDate, run.date),
        isNull(creditBatches.archivedAt),
      ),
    )
    .orderBy(creditBatches.id)
    .for("update");

  if (matchingBatches.length === 0) return null;
  if (matchingBatches.length > 1) {
    throw new SafeError(
      `Production run ${run.code} matches multiple Credit batches (${matchingBatches.map((batch) => batch.code).join(", ")}). Adjust the overlapping production windows before completing the run.`,
    );
  }

  const [batch] = matchingBatches;
  if (batch.removalId) {
    throw new SafeError(
      `Production run ${run.code} matches Credit batch ${batch.code}, but that batch is already grouped into a Removal. Ungroup it before completing the run.`,
    );
  }

  await tx.insert(creditBatchProductionRuns).values({
    organizationId: ctx.organizationId,
    creditBatchId: batch.id,
    productionRunId,
  });
  await tx
    .update(samples)
    .set({ creditBatchId: batch.id, updatedAt: new Date() })
    .where(
      and(
        eq(samples.productionRunId, productionRunId),
        eq(samples.organizationId, ctx.organizationId),
      ),
    );

  return batch.id;
}
