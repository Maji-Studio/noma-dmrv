import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, feedstocks, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { returnGrams, remainingReturnDryKg, RETURN_GRAMS_PER_KG } from '@/lib/production-run-returns/mass';
import { deriveMassDryKg } from '@/lib/calculations/mass-dry';
import { requireOrgScope } from '../utils';

type Reader = Pick<typeof db, 'select'>;
export async function getProductionRunReturnHistory(ctx: OrgContext, sourceProductionRunId: string, reader: Reader = db) {
  requireOrgScope(ctx);
  return reader.select().from(binMovements).where(and(eq(binMovements.organizationId, ctx.organizationId),
    eq(binMovements.sourceProductionRunId, sourceProductionRunId),
    inArray(binMovements.movementType, ['failed_run_return', 'failed_run_return_reversal'])))
    .orderBy(binMovements.createdAt, binMovements.postingSequence);
}

/** Both discovery and locked reads use this exact, organization-scoped basis. */
export async function readReturnSource(ctx: OrgContext, reader: Reader, sourceProductionRunId: string) {
  requireOrgScope(ctx);
  const [run] = await reader.select().from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, sourceProductionRunId)));
  if (!run) throw new SafeError('Production run not found.');
  const draws = await reader.select().from(productionRunFeedstockDraws).where(and(
    eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.productionRunId, sourceProductionRunId)))
    .orderBy(productionRunFeedstockDraws.id);
  const allocations = await reader.select({
    allocationId: productionRunFeedstocks.id, feedstockId: productionRunFeedstocks.feedstockId,
    wetMassKg: productionRunFeedstocks.wetMassUsedKg, feedstockTypeId: feedstocks.feedstockTypeId,
    storageLocationId: feedstocks.storageLocationId, facilityId: feedstocks.facilityId, status: feedstocks.status,
  }).from(productionRunFeedstocks).leftJoin(feedstocks, and(eq(feedstocks.id, productionRunFeedstocks.feedstockId), eq(feedstocks.organizationId, ctx.organizationId)))
    .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(productionRunFeedstocks.productionRunId, sourceProductionRunId)))
    .orderBy(productionRunFeedstocks.id);
  const sourceBins = draws.length ? await reader.select({ id: storageLocations.id, facilityId: storageLocations.facilityId,
    type: storageLocations.type, feedstockTypeId: storageLocations.feedstockTypeId, uncarbonized: storageLocations.uncarbonized })
    .from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId),
      inArray(storageLocations.id, draws.map(row => row.storageLocationId)))).orderBy(storageLocations.id) : [];
  return { run, draws, allocations, sourceBins };
}

/** Advisory eligibility. Writers call this again after locking the source. */
export async function getProductionRunReturnAllowance(ctx: OrgContext, sourceProductionRunId: string, reader: Reader = db) {
  requireOrgScope(ctx);
  const source = await readReturnSource(ctx, reader, sourceProductionRunId);
  const { run, draws, allocations, sourceBins } = source;
  if (run.status !== 'failed' || run.archivedAt || !run.endTime) throw new SafeError('Only an active Failed run can return material.');
  if (run.feedstockMoisturePercent === null || run.feedstockWetMassKg === null || !draws.length || !allocations.length) {
    throw new SafeError('Correct the run consumption and measured moisture before returning material.');
  }
  const wetGrams = draws.reduce((sum, draw) => sum + returnGrams(draw.wetMassKg), 0);
  if (wetGrams !== returnGrams(run.feedstockWetMassKg) || allocations.some(row => !row.feedstockTypeId || !row.storageLocationId || row.facilityId !== run.facilityId || row.status !== 'complete') ||
    allocations.some(row => !draws.some(draw => draw.storageLocationId === row.storageLocationId)) ||
    draws.some(draw => returnGrams(draw.wetMassKg) !== allocations.filter(row => row.storageLocationId === draw.storageLocationId).reduce((sum, row) => sum + returnGrams(row.wetMassKg), 0))) {
    throw new SafeError('Resolve the run consumption allocations before returning material.');
  }
  const types = new Set(allocations.map(row => row.feedstockTypeId));
  if (types.size !== 1) throw new SafeError('Returns from runs with mixed feedstock types are not supported.');
  if (sourceBins.length !== draws.length || sourceBins.some(bin => bin.facilityId !== run.facilityId || bin.type !== 'feedstock_bin' ||
      bin.uncarbonized || bin.feedstockTypeId !== allocations[0].feedstockTypeId)) {
    throw new SafeError('Correct the source bin identity before returning material.');
  }
  const consumedDryKg = deriveMassDryKg(wetGrams / RETURN_GRAMS_PER_KG, run.feedstockMoisturePercent);
  if (consumedDryKg <= 0 || run.feedstockMassDryKg === null || returnGrams(consumedDryKg) !== returnGrams(run.feedstockMassDryKg)) {
    throw new SafeError('Correct the run dry mass before returning material.');
  }
  const history = await getProductionRunReturnHistory(ctx, sourceProductionRunId, reader);
  const remainingDryKg = remainingReturnDryKg(consumedDryKg, history.map(row => row.feedstockDryDeltaKg!));
  return { ...source, history, consumedDryKg, remainingDryKg, returnedFeedstockTypeId: allocations[0].feedstockTypeId! };
}

export async function validateReturnDestination(ctx: OrgContext, reader: Reader, storageLocationId: string, facilityId: string, feedstockTypeId: string) {
  requireOrgScope(ctx);
  const [bin] = await reader.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin || bin.archivedAt || bin.type !== 'feedstock_bin' || !bin.uncarbonized || bin.facilityId !== facilityId || bin.feedstockTypeId !== feedstockTypeId) {
    throw new SafeError('Choose an active uncarbonized feedstock bin of the same type and facility.');
  }
  return bin;
}
