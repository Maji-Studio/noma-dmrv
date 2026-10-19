import type { DbTransaction } from '@/db';
import { binMovements, outputStockAllocations, outputStockRunAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { grams, kilograms, rational, readRational, storeRational } from '@/lib/output-stock';
import type { getOutputStockAllocationProjection } from './output-stock';
import { requireOrgScope } from './utils';

type Projection = Awaited<ReturnType<typeof getOutputStockAllocationProjection>>;

/** Append the exact inverse of frozen effects. Caller holds bin, lineage and owner locks. */
export async function appendOutputStockReversal(ctx: OrgContext, tx: DbTransaction, input: {
  original: typeof binMovements.$inferSelect;
  allocations: Projection[number]['allocation'][];
  rows: Projection;
  reason: string;
  occurredAt: Date;
  idempotencyKey: string;
  basisFingerprint: string;
  payloadHash: string;
  balanceBeforeDryKg: string;
}) {
  requireOrgScope(ctx);
  const { original, allocations, rows, reason, occurredAt, idempotencyKey, basisFingerprint, payloadHash, balanceBeforeDryKg } = input;
  const restoreGrams = allocations.reduce((sum, a) => sum + grams(a.dryMassKg), BigInt(0));
  // These audit balances include every layer, including physically future intakes.
  const restoredBalance = grams(balanceBeforeDryKg) + restoreGrams;
  const [reversal] = await tx.insert(binMovements).values({ organizationId: ctx.organizationId, storageLocationId: original.storageLocationId, lane: original.lane,
    movementType: 'adjustment', massDeltaKg: Number(kilograms(restoreGrams)), reason, createdBy: ctx.userId,
    outputKind: 'reversal', occurredAt, idempotencyKey, basisFingerprint,
    inputSnapshot: { ...original.inputSnapshot, actorId: ctx.userId, payloadHash }, outputDryDeltaKg: kilograms(restoreGrams), balanceBeforeDryKg: kilograms(restoredBalance - restoreGrams), balanceAfterDryKg: kilograms(restoredBalance), correctsMovementId: original.id }).returning();
  for (const a of allocations) {
    const solids = readRational(a.basisSnapshot.solidsKg);
    const [reversed] = await tx.insert(outputStockAllocations).values({ ...a, id: undefined, createdAt: undefined, organizationId: ctx.organizationId, movementId: reversal.id, reversesAllocationId: a.id,
      dryMassKg: kilograms(-grams(a.dryMassKg)), wetMassKg: a.wetMassKg === null ? null : kilograms(-grams(a.wetMassKg)),
      basisSnapshot: { ...a.basisSnapshot, solidsKg: storeRational(rational(-solids.numerator, solids.denominator)) } }).returning();
    for (const r of rows.filter(r => r.allocation.id === a.id && r.run)) await tx.insert(outputStockRunAllocations).values({ organizationId: ctx.organizationId, allocationId: reversed.id, productionRunId: r.run!.productionRunId, dryMassKg: kilograms(-grams(r.run!.dryMassKg)) });
  }
  return reversal;
}
