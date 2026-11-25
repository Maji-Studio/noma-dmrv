import { activeReturns, RETURN_MOVEMENT_TYPES } from '@/lib/production-run-returns/active-returns';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { calculateRunMaterialBalance } from '@/lib/production-run-returns/material-balance';
import { returnGrams, RETURN_GRAMS_PER_KG } from '@/lib/production-run-returns/mass';
import { requireOrgScope, type Executor } from './utils';

/** One statement keeps run quantities and return history on the same read snapshot. */
export async function getProductionRunMaterialBalance(ctx: OrgContext, runId: string, reader: Executor = db) {
  requireOrgScope(ctx);
  const rows = await reader.select({
    runId: productionRuns.id, code: productionRuns.code, status: productionRuns.status,
    consumedDryKg: productionRuns.feedstockMassDryKg, outputDryKg: productionRuns.biocharDryMassKg,
    movement: binMovements,
    destinationCode: storageLocations.code, destinationName: storageLocations.name,
  }).from(productionRuns)
    .leftJoin(binMovements, and(eq(binMovements.organizationId, ctx.organizationId),
      eq(binMovements.sourceProductionRunId, productionRuns.id),
      inArray(binMovements.movementType, [...RETURN_MOVEMENT_TYPES])))
    .leftJoin(storageLocations, and(eq(storageLocations.organizationId, ctx.organizationId),
      eq(storageLocations.id, binMovements.storageLocationId)))
    .where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, runId)))
    .orderBy(binMovements.occurredAt, binMovements.postingSequence);
  const run = rows[0];
  if (!run) throw new SafeError('Production run not found.');
  const activeIds = new Set(activeReturns(rows.flatMap(({ movement }) => movement ? [movement] : [])).map(row => row.id));
  const returns = rows.flatMap(({ movement, destinationCode, destinationName }) => {
    if (!movement || !activeIds.has(movement.id)) return [];
    return [{ movementId: movement.id, storageLocationId: movement.storageLocationId, destinationCode, destinationName,
      wetMassKg: movement.massDeltaKg, dryMassKg: movement.feedstockDryDeltaKg!, moistureRatio: movement.moistureRatioUsed!,
      occurredAt: movement.occurredAt!, createdAt: movement.createdAt }];
  });
  const activeReturnedDryKg = returns.reduce((sum, row) => sum + returnGrams(row.dryMassKg), 0) / RETURN_GRAMS_PER_KG;
  const usableOutputDryKg = run.status === 'failed' ? 0 : run.outputDryKg;
  const missingReason = run.consumedDryKg === null ? 'Record the consumed dry mass to see the material balance.'
    : usableOutputDryKg === null ? 'Record the usable dry output to see the material balance.' : null;
  const balance = run.consumedDryKg === null || usableOutputDryKg === null ? null
    : calculateRunMaterialBalance({ runId, consumedDryKg: run.consumedDryKg, usableOutputDryKg, activeReturnedDryKg });
  return { runId, code: run.code, status: run.status, balance, missingReason, returns };
}
