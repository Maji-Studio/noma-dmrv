import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { projectDashboardBatchScope } from "@/lib/dashboard-batch-scope";
import { SafeError } from "@/lib/errors";
import { loadCreditBatchAccounting } from "./credit-batch-accounting";
import type { DashboardStationKey } from "./dashboard-overview";
import { requireOrgScope } from "./utils";

export interface DashboardBatchScope {
  /** Batch ids in scope (one, or every unarchived batch of the facility). */
  batchIds: string[];
  stationTotals: Record<DashboardStationKey, number>;
  kpis: {
    feedstockProcessedDryTonnes: number | null;
    biocharProducedDryTonnes: number | null;
    appliedToSoilDryTonnes: number | null;
    co2eStoredTonnes: number | null;
  };
  recordIds: string[];
}

/** One set-based accounting walk, including the list's existing CO₂e estimate. */
export async function getDashboardBatchScope(
  ctx: OrgContext,
  facilityId: string,
  creditBatchId: string | null,
): Promise<DashboardBatchScope> {
  requireOrgScope(ctx);
  const batches = await db.select({ id: creditBatches.id })
    .from(creditBatches)
    .where(and(
      eq(creditBatches.organizationId, ctx.organizationId),
      eq(creditBatches.facilityId, facilityId),
      // All credit batches = the batches the filter lists, so archived ones stay out.
      creditBatchId === null ? isNull(creditBatches.archivedAt) : eq(creditBatches.id, creditBatchId),
    ))
    .orderBy(asc(creditBatches.id));
  if (creditBatchId !== null && batches.length === 0) {
    throw new SafeError("Credit batch not found");
  }
  const accounting = await loadCreditBatchAccounting(
    ctx,
    batches.map(({ id }) => id),
    { includeRunForwards: true },
  );
  return projectDashboardBatchScope(batches.map(({ id }) => {
    const rollup = accounting[id];
    // A concurrent deletion must not silently turn a selected batch into zero.
    if (!rollup || rollup.batch.facilityId !== facilityId) {
      throw new SafeError("Credit batch not found");
    }
    return {
      lineageFacts: rollup.lineageFacts,
      co2eStoredTonnes: rollup.co2ePreview.co2eStoredTonnes,
    };
  }));
}
