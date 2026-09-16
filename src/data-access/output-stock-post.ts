import { db, type DbTransaction } from '@/db';
import { binMovements, deliveries, outputStockAllocations, outputStockRunAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { add, decimal, grams, GRAMS_PER_KG, kilograms, multiply, rational, readRational, round, storeRational } from '@/lib/output-stock';
import { outputStockPostSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput } from '@/types/output-stock';
import { and, eq } from 'drizzle-orm';
import { findMovementRequest, lockMovementRequest } from './bin-movement-requests';
import { assertCanMutateCertifiedLineage } from './certification-lineage-guards';
import { lockDeliveryOrderAndAssertBalance } from './delivery-order-balance';
import { lockBinStock } from './lock-bin-stocks';
import { prepareOutputStock, stockFingerprint } from './output-stock-operations';
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs } from './transport-legs';
import { requireOrgScope } from './utils';

const OUTPUT_REQUEST_CONFLICT_MESSAGE = 'This request key was already used with different values.';

/** Serializes a request even if a reused key names a different bin. */
export async function lockOutputRequest(ctx: OrgContext, tx: DbTransaction, key: string) {
  return lockMovementRequest(ctx, tx, key);
}
/** Output-lane view of the shared replay guard. */
export async function findOutputRequest(ctx: OrgContext, tx: DbTransaction, input: OutputStockPostInput, payload: unknown = input) {
  return findMovementRequest(ctx, tx, { idempotencyKey: input.idempotencyKey, payload, storageLocationId: input.storageLocationId, conflictMessage: OUTPUT_REQUEST_CONFLICT_MESSAGE });
}

/** Caller owns the bin/request locks and cross-entity transaction. */
export async function persistOutputStock(ctx: OrgContext, tx: DbTransaction, input: OutputStockPostInput, options: { deliveryId?: string; targetBiocharProductId?: string; payload?: unknown } = {}) {
  requireOrgScope(ctx);
  // Applications serialize on the delivery row. Acquire that same lock before
  // discovering dependencies so an application cannot appear after the check.
  if (input.correctsMovementId) {
    const [effect] = await tx.select({ deliveryId: outputStockAllocations.deliveryId }).from(outputStockAllocations)
      .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.movementId, input.correctsMovementId)));
    if (effect?.deliveryId) await tx.select({ id: deliveries.id }).from(deliveries)
      .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, effect.deliveryId))).for('update');
  }
  const prepared = await prepareOutputStock(ctx, input, tx);
  const { plan, preview, correction } = prepared;
  if (preview.basisFingerprint !== input.basisFingerprint) throw new ActionConflictError('Stock changed since this preview. Refresh the preview and try again.', { entity: 'storageLocation', id: input.storageLocationId, code: prepared.bin.code });
  if (!plan || preview.blockingMessage) throw new SafeError(preview.blockingMessage ?? 'Stock cannot be allocated.');
  const productIds = new Set<string>();
  for (const layer of prepared.layers.filter(l => plan.allocations.some(a => a.layerId === l.id) || correction?.allocations.some(a => (a.biocharProductId ?? a.productionRunId) === l.id))) {
    if (correction || ['loss', 'count'].includes(input.kind)) await assertCanMutateCertifiedLineage(ctx, tx, { entityType: prepared.lane === 'product' ? 'biocharProduct' : 'productionRun', entityId: layer.id }, 'update');
    if (prepared.lane === 'product') productIds.add(layer.id);
  }
  if (correction?.deliveryId) await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: correction.deliveryId }, 'update');
  const payloadHash = stockFingerprint(options.payload ?? input);
  if (correction) {
    const restoreGrams = correction.allocations.reduce((sum, a) => sum + grams(a.dryMassKg), BigInt(0));
    // These audit balances include every layer, including physically future intakes.
    const restoredBalance = prepared.layers.reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0));
    const [reversal] = await tx.insert(binMovements).values({ organizationId: ctx.organizationId, storageLocationId: input.storageLocationId, lane: prepared.lane,
      movementType: 'adjustment', massDeltaKg: Number(kilograms(restoreGrams)), reason: input.reason, createdBy: ctx.userId,
      outputKind: 'reversal', physicalDate: input.physicalDate, idempotencyKey: `${input.idempotencyKey}:reversal`, basisFingerprint: input.basisFingerprint,
      inputSnapshot: { ...correction.original.inputSnapshot, actorId: ctx.userId, payloadHash }, outputDryDeltaKg: kilograms(restoreGrams), balanceBeforeDryKg: kilograms(restoredBalance - restoreGrams), balanceAfterDryKg: kilograms(restoredBalance), correctsMovementId: correction.original.id }).returning();
    for (const a of correction.allocations) {
      const solids = readRational(a.basisSnapshot.solidsKg);
      const [reversed] = await tx.insert(outputStockAllocations).values({ ...a, id: undefined, createdAt: undefined, organizationId: ctx.organizationId, movementId: reversal.id, reversesAllocationId: a.id,
        dryMassKg: kilograms(-grams(a.dryMassKg)), wetMassKg: a.wetMassKg === null ? null : kilograms(-grams(a.wetMassKg)),
        basisSnapshot: { ...a.basisSnapshot, solidsKg: storeRational(rational(-solids.numerator, solids.denominator)) } }).returning();
      for (const r of correction.rows.filter(r => r.allocation.id === a.id && r.run)) await tx.insert(outputStockRunAllocations).values({ organizationId: ctx.organizationId, allocationId: reversed.id, productionRunId: r.run!.productionRunId, dryMassKg: kilograms(-grams(r.run!.dryMassKg)) });
    }
  }
  const beforeGrams = prepared.layers.reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0));
  const [movement] = await tx.insert(binMovements).values({ organizationId: ctx.organizationId, storageLocationId: input.storageLocationId, lane: prepared.lane,
    movementType: 'adjustment', massDeltaKg: -Number(plan.drawnDryKg), reason: input.reason, createdBy: ctx.userId,
    outputKind: correction ? 'replacement' : input.kind, physicalDate: input.physicalDate, idempotencyKey: input.idempotencyKey,
    basisFingerprint: input.basisFingerprint, inputSnapshot: { ...input, actorId: ctx.userId, payloadHash, targetBiocharProductId: options.targetBiocharProductId, deliveryId: options.deliveryId ?? correction?.deliveryId, discrepancySolidsKg: storeRational(plan.discrepancySolidsKg), preview },
    outputDryDeltaKg: kilograms(-grams(plan.drawnDryKg)), balanceBeforeDryKg: kilograms(beforeGrams), balanceAfterDryKg: kilograms(beforeGrams - grams(plan.drawnDryKg)), correctsMovementId: correction?.original.id ?? null }).returning();
  let cumulativeWet = rational(BigInt(0));
  let allocatedWetGrams = BigInt(0);
  for (const [index, a] of plan.allocations.entries()) {
    let wetMassKg: string | null = null;
    if (a.wetShareKg) {
      cumulativeWet = add(cumulativeWet, a.wetShareKg);
      const next = index === plan.allocations.length - 1 ? round(multiply(decimal(input.wetMassKg), rational(GRAMS_PER_KG))) : round(multiply(cumulativeWet, rational(GRAMS_PER_KG)));
      wetMassKg = kilograms(next - allocatedWetGrams); allocatedWetGrams = next;
    }
    const layer = prepared.layers.find(l => l.id === a.layerId)!;
    const [allocation] = await tx.insert(outputStockAllocations).values({ organizationId: ctx.organizationId, movementId: movement.id, sourceStorageLocationId: input.storageLocationId,
      biocharProductId: prepared.lane === 'product' ? a.layerId : null, productionRunId: prepared.lane === 'biochar' ? a.layerId : null,
      deliveryId: options.deliveryId ?? correction?.deliveryId ?? null, targetBiocharProductId: options.targetBiocharProductId ?? null,
      dryMassKg: a.dryKg, wetMassKg, basisSnapshot: { solidsKg: storeRational(a.solidsKg), wetShareKg: a.wetShareKg ? storeRational(a.wetShareKg) : null,
        establishedDryBiocharKg: layer.establishedDryBiocharKg, ingredientDrySolidsKg: layer.ingredientDrySolidsKg, physicalDate: layer.physicalDate, postingSequence: String(layer.postingSequence), code: preview.allocations[index].code } }).returning();
    for (const run of a.runs) await tx.insert(outputStockRunAllocations).values({ organizationId: ctx.organizationId, allocationId: allocation.id, productionRunId: run.productionRunId, dryMassKg: run.dryKg });
  }
  if (correction?.deliveryId) {
    const [delivery] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, correction.deliveryId))).for('update');
    if (!delivery || delivery.storageLocationId !== input.storageLocationId || delivery.facilityId !== input.facilityId) throw new SafeError('Delivery source changed. Refresh and retry.');
    await lockDeliveryOrderAndAssertBalance(ctx, tx, { orderId: delivery.orderId, requestedWetKg: input.wetMassKg, excludeDeliveryId: delivery.id });
    await tx.update(deliveries).set({ deliveredWetMassKg: input.wetMassKg, moistureContentPercent: input.moisturePercent, massDryKg: Number(plan.drawnDryKg), deliveryDate: new Date(`${input.physicalDate}T00:00:00.000Z`), updatedAt: new Date() }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, delivery.id)));
    await syncBiocharProductTransportLegs(ctx, tx, [...productIds]);
  }
  return { movement, preview };
}
export async function postOutputStock(ctx: OrgContext, raw: OutputStockPostInput) {
  requireOrgScope(ctx);
  const input = outputStockPostSchema.parse(raw);
  if (!['loss', 'count'].includes(input.kind) && !(input.kind === 'delivery' && input.correctsMovementId)) throw new SafeError('Save deliveries and products through their own forms.');
  return db.transaction(async tx => {
    await lockBiocharTransportRouteTopology(ctx, tx);
    await lockOutputRequest(ctx, tx, input.idempotencyKey);
    const existing = await findOutputRequest(ctx, tx, input);
    if (existing) return { movementId: existing.id, preview: existing.inputSnapshot!.preview as unknown as Awaited<ReturnType<typeof prepareOutputStock>>['preview'] };
    await lockBinStock(ctx, tx, input.storageLocationId);
    const result = await persistOutputStock(ctx, tx, input);
    return { movementId: result.movement.id, preview: result.preview };
  });
}
