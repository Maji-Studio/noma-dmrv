import { aliasedTable, and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { binMovements, storageLocations, users } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { requireOrgScope } from '../utils';

type Reader = Pick<typeof db, 'select'>;
const PERCENT = 100;
const MOISTURE_PERCENT_SCALE = 10_000;

export type ProductionRunReturnState = 'active' | 'reversed' | 'replaced';
export interface ProductionRunReturnRow {
  id: string;
  storageLocationId: string;
  destinationName: string | null;
  destinationCode: string | null;
  wetMassKg: number;
  moisturePercent: number;
  dryMassKg: number;
  occurredAt: string;
  recordedAt: string;
  actorName: string | null;
  reason: string;
  state: ProductionRunReturnState;
  /** The reversal that took this entry out of the stock, with its reason. */
  reversal: { reason: string; recordedAt: string; actorName: string | null } | null;
  /** The entry that replaced this one. */
  replacementId: string | null;
  /** The earlier entry this one replaces. */
  replacesId: string | null;
}

/** A run's returns for its view: who recorded each, where it went, and what corrected it. Plain JSON values. */
export async function getProductionRunReturnRows(ctx: OrgContext, sourceProductionRunId: string, reader: Reader = db): Promise<ProductionRunReturnRow[]> {
  requireOrgScope(ctx);
  const destination = aliasedTable(storageLocations, 'destination');
  const rows = await reader.select({ movement: binMovements, actorName: users.name, destinationName: destination.name, destinationCode: destination.code })
    .from(binMovements)
    .leftJoin(users, eq(users.id, binMovements.createdBy))
    .leftJoin(destination, and(eq(destination.organizationId, ctx.organizationId), eq(destination.id, binMovements.storageLocationId)))
    .where(and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.sourceProductionRunId, sourceProductionRunId),
      inArray(binMovements.movementType, ['failed_run_return', 'failed_run_return_reversal'])))
    .orderBy(binMovements.occurredAt, binMovements.postingSequence);
  const reversals = new Map(rows.filter(row => row.movement.movementType === 'failed_run_return_reversal' && row.movement.correctsMovementId)
    .map(row => [row.movement.correctsMovementId!, row]));
  const replacements = new Map(rows.filter(row => row.movement.movementType === 'failed_run_return' && row.movement.correctsMovementId)
    .map(row => [row.movement.correctsMovementId!, row.movement.id]));
  return rows.filter(row => row.movement.movementType === 'failed_run_return').map(({ movement, actorName, destinationName, destinationCode }) => {
    const reversal = reversals.get(movement.id);
    const replacementId = replacements.get(movement.id) ?? null;
    return {
      id: movement.id, storageLocationId: movement.storageLocationId, destinationName, destinationCode,
      wetMassKg: movement.massDeltaKg, dryMassKg: movement.feedstockDryDeltaKg ?? 0,
      moisturePercent: Math.round((movement.moistureRatioUsed ?? 0) * PERCENT * MOISTURE_PERCENT_SCALE) / MOISTURE_PERCENT_SCALE,
      occurredAt: (movement.occurredAt ?? movement.createdAt).toISOString(), recordedAt: movement.createdAt.toISOString(),
      actorName, reason: movement.reason,
      state: reversal ? (replacementId ? 'replaced' : 'reversed') : 'active',
      reversal: reversal ? { reason: reversal.movement.reason, recordedAt: reversal.movement.createdAt.toISOString(), actorName: reversal.actorName } : null,
      replacementId, replacesId: movement.correctsMovementId,
    } satisfies ProductionRunReturnRow;
  });
}
