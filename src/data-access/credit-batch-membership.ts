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
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type { OrgContext } from "@/lib/auth/server";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { feedstocks } from "@/db/schema/feedstock";
import { productionRuns, productionRunFeedstocks } from "@/db/schema/production";
import { assertCreditBatchProductionWindow } from "./credit-batch-production-window";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { SafeError } from "@/lib/errors";

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
): Promise<void> {
  if (productionRunIds.length === 0) return;

  // Reject duplicates
  const uniqueRunIds = new Set(productionRunIds);
  if (uniqueRunIds.size !== productionRunIds.length) {
    throw new SafeError("Duplicate production run IDs are not allowed");
  }

  const rows = await tx
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      facilityId: productionRuns.facilityId,
      status: productionRuns.status,
      date: productionRunDateExpr(),
    })
    .from(productionRuns)
    .where(and(inArray(productionRuns.id, productionRunIds), eq(productionRuns.organizationId, ctx.organizationId)));

  if (rows.length !== productionRunIds.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = productionRunIds.filter((id) => !found.has(id));
    throw new SafeError(`Production run(s) not found: ${missing.join(", ")}`);
  }

  const incomplete = rows.filter((row) => row.status !== "complete");
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
  const resolved = await resolveSingleFeedstockType(ctx, tx, productionRunIds);
  if (resolved !== declaredFeedstockTypeId) {
    throw new SafeError(
      `The selected production runs are a different feedstock than the one chosen for this batch. ` +
        `A credit batch is a single feedstock (ADR 0016) — pick runs matching the chosen feedstock, ` +
        `or change the batch's feedstock type.`,
    );
  }
}
