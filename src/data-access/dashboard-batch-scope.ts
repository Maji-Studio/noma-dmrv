import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { pgErrorCode } from "@/db/errors";
import { creditBatchApplications, creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { projectDashboardBatchScope } from "@/lib/dashboard-batch-scope";
import { SafeError } from "@/lib/errors";
import { logger, sanitizeErrorMessage } from "@/lib/log";
import { loadCreditBatchAccounting } from "./credit-batch-accounting";
import type { DashboardActivityItem, DashboardStationKey } from "./dashboard-overview";
import { getDashboardScopedActivity } from "./dashboard-stations";
import { requireOrgScope } from "./utils";

export interface DashboardBatchScope {
  /** Batch ids in scope (one, or every unarchived batch of the facility). */
  batchIds: string[];
  activity: DashboardActivityItem[];
  stationTotals: Record<DashboardStationKey, number>;
  kpis: {
    feedstockProcessedDryTonnes: number | null;
    biocharProducedDryTonnes: number | null;
    appliedToSoilDryTonnes: number | null;
    co2eStoredTonnes: number | null;
  };
  /** Batch ids, every record in their roll-ups, and the Removals holding them. */
  recordIds: string[];
}

/** One set-based accounting walk, including the list's existing CO₂e estimate. */
export async function getDashboardBatchScope(
  ctx: OrgContext,
  facilityId: string,
  creditBatchId: string | null,
): Promise<DashboardBatchScope> {
  requireOrgScope(ctx);
  const batches = await db.select({
    id: creditBatches.id,
    claimedByRemovalId: creditBatches.productionEmissionsClaimedByRemovalId,
  })
    .from(creditBatches)
    .where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      eq(creditBatches.facilityId, facilityId),
      // All credit batches = the batches the filter lists, so archived ones stay out.
      creditBatchId === null ? isNull(creditBatches.archivedAt) : eq(creditBatches.id, creditBatchId),
    ))
    .orderBy(asc(creditBatches.id));
  if (creditBatchId !== null && batches.length === 0) {
    throw new SafeError("Credit batch was not found.");
  }
  const accounting = await loadScopeAccounting(ctx, batches.map(({ id }) => id), creditBatchId === null, facilityId);
  const survivingBatches = batches.filter(({ id }) => {
    const rollup = accounting[id];
    if (rollup && rollup.batch.facilityId === facilityId) return true;
    // Only a selected batch must survive a concurrent deletion or facility move.
    if (creditBatchId !== null) throw new SafeError("Credit batch was not found.");
    return false;
  });
  const projected = projectDashboardBatchScope(survivingBatches.map(({ id }) => ({
    lineageFacts: accounting[id].lineageFacts,
    co2eStoredTonnes: accounting[id].co2ePreview.co2eStoredTonnes,
  })));
  const removalIds = await loadScopeRemovalIds(ctx, survivingBatches);
  const recordIds = [...new Set([...projected.recordIds, ...removalIds])].sort();
  const activity = await getDashboardScopedActivity(ctx, facilityId, recordIds);
  return { ...projected, recordIds, activity };
}

/**
 * The chosen batches' accounting with their runs' downstream records. For all
 * credit batches the downstream walk is best effort: one batch's inconsistent
 * saved allocations fail that walk closed, and the default dashboard must not
 * go dark for it, so the read falls back to the walk without run forwards
 * (products and deliveries then come from applications only). One batch keeps
 * failing closed, so its page says what is wrong.
 */
async function loadScopeAccounting(
  ctx: OrgContext,
  batchIds: string[],
  allBatches: boolean,
  facilityId: string,
) {
  if (!allBatches) return loadCreditBatchAccounting(ctx, batchIds, { includeRunForwards: true });
  try {
    return await loadCreditBatchAccounting(ctx, batchIds, { includeRunForwards: true });
  } catch (error: unknown) {
    logger.warn(
      { facilityId, errorType: error instanceof Error ? sanitizeErrorMessage(error.name) : typeof error, errorCode: pgErrorCode(error), errorMessage: sanitizeErrorMessage(error) },
      "Dashboard batch scope: run forwards failed, reading all credit batches without them",
    );
    return loadCreditBatchAccounting(ctx, batchIds);
  }
}

/**
 * The Removals that hold the chosen batches: those owning an application slice
 * of one, and those that claimed a batch's production emissions. Their ids
 * join the record ids, so a Removal's To do row follows the batch filter.
 */
async function loadScopeRemovalIds(
  ctx: OrgContext,
  batches: { id: string; claimedByRemovalId: string | null }[],
): Promise<string[]> {
  if (batches.length === 0) return [];
  const slices = await db
    .select({ removalId: creditBatchApplications.removalId })
    .from(creditBatchApplications)
    .where(and(
      eq(creditBatchApplications.organizationId, ctx.organizationId),
      inArray(creditBatchApplications.creditBatchId, batches.map(({ id }) => id)),
      isNotNull(creditBatchApplications.removalId),
    ));
  return [
    ...slices.map(({ removalId }) => removalId),
    ...batches.map(({ claimedByRemovalId }) => claimedByRemovalId),
  ].filter((id): id is string => id != null);
}
