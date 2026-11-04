import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatches, facilities, productionRuns, reactors } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { buildEmissionAllocation } from "@/lib/certification/emission-allocation";
import { formatFacilityDate } from "@/lib/date-utils";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { SafeError } from "@/lib/errors";
import { REMOVAL_ENTITY_TYPE, REMOVAL_SUBMISSION_TYPE } from "@/lib/isometric/utils/constants";
import type { EmissionAllocation, EmissionAllocationInput } from "@/types/emission-allocation";
import { loadCreditBatchRollups } from "./credit-batch-accounting";
import { loadAllocationFeedstocks } from "./emission-allocation-feedstocks";
import { loadAllocationDeliveries, loadAllocationManualEntries } from "./emission-allocation-sources";
import { loadAllocationRemovalLoads, loadAppliedDeliveryIds } from "./emission-allocation-removals";
import { requireOrgScope } from "./utils";

/** Facility-wide preview, read consistently with the same saved lineage as Emissions. */
export async function getEmissionAllocation(ctx: OrgContext, input: EmissionAllocationInput,
  executor: DbTransaction | typeof db = db,
): Promise<EmissionAllocation> {
  requireOrgScope(ctx);
  if (executor === db) return db.transaction(tx => getEmissionAllocation(ctx, input, tx), {
    isolationLevel: "repeatable read", accessMode: "read only",
  });
  const anchorTable = "creditBatchId" in input ? creditBatches : certifierRemovals;
  const anchorId = "creditBatchId" in input ? input.creditBatchId : input.removalId;
  const [anchor] = await executor.select({ facilityId: anchorTable.facilityId }).from(anchorTable)
    .where(and(eq(anchorTable.organizationId, ctx.organizationId), eq(anchorTable.id, anchorId)));
  if (!anchor) throw new SafeError("Credit batch or Removal was not found.");
  const { facilityId } = anchor;
  const [facility] = await executor.select({ timezone: facilities.timezone }).from(facilities)
    .where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId)));
  if (!facility) throw new SafeError("Facility was not found.");
  const batches = await executor.select({ id: creditBatches.id, code: creditBatches.code, startDate: creditBatches.startDate, endDate: creditBatches.endDate })
    .from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId)))
    .orderBy(asc(creditBatches.startDate), asc(creditBatches.code), asc(creditBatches.id));
  const batchIds = batches.map(batch => batch.id);
  const rollups = await loadCreditBatchRollups(ctx, batchIds, { includeRunForwards: true }, executor);
  const batchByRun = new Map(Object.values(rollups).flatMap(rollup => rollup.lineageFacts.runs.map(run => [run.id, rollup.batch.id] as const)));
  const memberIds = [...batchByRun.keys()];
  const [runRows, removalRows] = await Promise.all([
    executor.select({ run: productionRuns, reactorCode: reactors.code }).from(productionRuns)
      .leftJoin(reactors, and(eq(reactors.organizationId, ctx.organizationId), eq(reactors.id, productionRuns.reactorId)))
      .where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, facilityId))),
    executor.select({ id: certifierRemovals.id, code: certifierRemovals.code }).from(certifierRemovals)
      .where(and(eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.facilityId, facilityId)))
      .orderBy(asc(certifierRemovals.code), asc(certifierRemovals.id)),
  ]);
  // Include unbatched completed runs so their recorded activity has a not-yet column.
  // Members follow the exact lineage selection, including incomplete member runs.
  const runs = runRows.filter(({ run }) => batchByRun.has(run.id) || (run.status === COMPLETED_PRODUCTION_RUN_STATUS && !run.archivedAt));
  const removalIds = removalRows.map(row => row.id);
  const [removalLoads, appliedDeliveryIds] = await Promise.all([
    loadAllocationRemovalLoads(ctx, batchIds, removalRows, executor), loadAppliedDeliveryIds(ctx, batchIds, executor),
  ]);
  const [memberships, submissions, feedstocks, deliveries, manual] = await Promise.all([
    removalIds.length ? executor.select({ removalId: creditBatchApplications.removalId, creditBatchId: creditBatchApplications.creditBatchId })
      .from(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, ctx.organizationId), inArray(creditBatchApplications.removalId, removalIds))) : [],
    removalIds.length ? executor.select({ removalId: certificationSubmissions.localEntityId, status: certificationSubmissions.status })
      .from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.provider, "isometric"),
        eq(certificationSubmissions.submissionType, REMOVAL_SUBMISSION_TYPE), eq(certificationSubmissions.localEntityType, REMOVAL_ENTITY_TYPE),
        inArray(certificationSubmissions.localEntityId, removalIds))).orderBy(desc(certificationSubmissions.version)) : [],
    loadAllocationFeedstocks(ctx, facilityId, [...new Set([...memberIds, ...runs.map(({ run }) => run.id)])], facility.timezone, executor),
    loadAllocationDeliveries(ctx, batches.map(batch => ({ ...batch, lineageFacts: rollups[batch.id].lineageFacts })), executor,
      [...removalLoads.keys(), ...appliedDeliveryIds]),
    loadAllocationManualEntries(ctx, batchIds, facilityId, executor),
  ]);
  return buildEmissionAllocation({ facilityId, batches,
    removals: removalRows.map(removal => ({ ...removal, status: submissions.find(row => row.removalId === removal.id)?.status ?? "draft",
      creditBatchIds: [...new Set(memberships.filter(row => row.removalId === removal.id).map(row => row.creditBatchId))].sort() })),
    productionClaims: Object.fromEntries(Object.values(rollups).map(({ batch }) => [batch.id, batch.productionEmissionsClaimedByRemovalId])),
    feedstocks, deliveries: deliveries.map(delivery => ({ ...delivery, removalLoads: removalLoads.get(delivery.id) ?? [] })), manual,
    runs: runs.map(({ run, reactorCode }) => ({ id: run.id, code: run.code, date: formatFacilityDate(run.startTime, facility.timezone),
      creditBatchId: batchByRun.get(run.id) ?? null, reactorId: run.reactorId, reactorCode,
      dieselOperationLiters: run.dieselOperationLiters, dieselGensetLiters: run.dieselGensetLiters,
      preprocessingFuelLiters: run.preprocessingFuelLiters, electricityKwh: run.electricityKwh })),
  });
}
