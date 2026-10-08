import { assertRowVersion, nextVersion } from "./row-version";
import { db, type DbTransaction } from '@/db';
import { biocharProducts, binMovements, deliveries, outputStockAllocations, outputStockMoistureReadings, outputStockRunAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { conflictCode } from '@/lib/conflict-ref';
import { STOCK_CONFLICT_ENTITY } from '@/lib/stock-conflict-entities';
import { ActionConflictError, SafeError } from '@/lib/errors';
import { add, decimal, grams, GRAMS_PER_KG, kilograms, multiply, rational, readRational, round, storeRational } from '@/lib/output-stock';
import { outputStockPostSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput } from '@/types/output-stock';
import { and, eq, inArray } from 'drizzle-orm';
import { findMovementRequest, lockMovementRequest } from './bin-movement-requests';
import { assertCanMutateCertifiedLineage } from './certification-lineage-guards';
import { lockDeliveryOrderAndAssertBalance } from './delivery-order-balance';
import { lockBinStocks } from './lock-bin-stocks';
import { postedMoisturePercent, prepareOutputStock, stockFingerprint } from './output-stock-operations';
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs } from './transport-legs';
import { requireOrgScope } from './utils';

const OUTPUT_REQUEST_CONFLICT_MESSAGE = 'This request key was already used with different values.';

/** Domain creates use current stock; direct commands require preview versions. */
type StockPostingInput = Omit<OutputStockPostInput, "expectedProductVersions"> & { expectedProductVersions?: Record<string, number> };

type PostedOutputRequest = NonNullable<Awaited<ReturnType<typeof findMovementRequest>>>;
type PersistOptions = { deliveryId?: string; targetBiocharProductId?: string; payload?: unknown };
type PostedOutputStock = Awaited<ReturnType<typeof persistOutputStock>>;

export interface OutputStockPosting<T> {
  input: StockPostingInput;
  /** Operator facts a replayed key must match. Defaults to the posting input. */
  payload?: unknown;
  /** Bins the action reads or writes besides the source bin. */
  additionalBinIds?: ReadonlyArray<string | null | undefined>;
  /** Set when the action can change product transport legs. */
  locksTransportRoutes?: boolean;
  /** The key was already posted: return the saved result without writing. */
  replay: (tx: DbTransaction, existing: PostedOutputRequest) => Promise<T>;
  /** Runs under every lock. `post` writes the draw; the domain row may need a fresher source fingerprint. */
  write: (tx: DbTransaction, post: (options?: Omit<PersistOptions, 'payload'> & { basisFingerprint?: string }) => Promise<PostedOutputStock>) => Promise<T>;
}

/**
 * The one way to post output stock. Owns the transaction and the lock order
 * (transport routes, request key, bins in sorted order), so a replayed key
 * never writes and no caller can post without holding the bin lock.
 */
export async function withOutputStockPosting<T>(ctx: OrgContext, posting: OutputStockPosting<T>): Promise<T> {
  requireOrgScope(ctx);
  const { input, payload = input } = posting;
  return db.transaction(async tx => {
    if (posting.locksTransportRoutes) await lockBiocharTransportRouteTopology(ctx, tx);
    // Serializes a request even if a reused key names a different bin.
    await lockMovementRequest(ctx, tx, input.idempotencyKey);
    const existing = await findMovementRequest(ctx, tx, { idempotencyKey: input.idempotencyKey, payload, storageLocationId: input.storageLocationId, conflictMessage: OUTPUT_REQUEST_CONFLICT_MESSAGE });
    if (existing) return posting.replay(tx, existing);
    await lockBinStocks(ctx, tx, [input.storageLocationId, ...(posting.additionalBinIds ?? [])]);
    return posting.write(tx, ({ basisFingerprint, ...options } = {}) =>
      persistOutputStock(ctx, tx, basisFingerprint ? { ...input, basisFingerprint } : input, { ...options, payload }));
  });
}

/** Requires the request and bin locks held by withOutputStockPosting. */
async function persistOutputStock(ctx: OrgContext, tx: DbTransaction, input: StockPostingInput, options: PersistOptions = {}) {
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
  if (preview.basisFingerprint !== input.basisFingerprint) throw new ActionConflictError('Stock changed since this preview. Refresh the preview and try again.', { entity: STOCK_CONFLICT_ENTITY.storageLocation, id: input.storageLocationId, code: conflictCode(prepared.bin.code) });
  if (!plan || preview.blockingMessage) throw new SafeError(preview.blockingMessage ?? 'Stock cannot be allocated.');
  const productIds = new Set<string>();
  for (const layer of prepared.layers.filter(l => plan.allocations.some(a => a.layerId === l.id) || correction?.allocations.some(a => (a.biocharProductId ?? a.productionRunId) === l.id))) {
    if (correction || ['loss', 'count'].includes(input.kind)) await assertCanMutateCertifiedLineage(ctx, tx, { entityType: prepared.lane === 'product' ? 'biocharProduct' : 'productionRun', entityId: layer.id }, 'update');
    if (prepared.lane === 'product') productIds.add(layer.id);
  }
  if (correction?.deliveryId) await assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: correction.deliveryId }, 'update');
  // Bin locks precede product rows everywhere. Lock parents before inserting
  // ledger children (their foreign keys acquire parent key-share locks).
  for (const reading of prepared.readings) if (prepared.lane === 'product') productIds.add(reading.layerId);
  // Reversal removes the original readings even when a backdated replacement
  // predates a product's placement and generates no new reading for it.
  if (correction && prepared.lane === 'product') {
    const originalReadings = await tx.select({ productId: outputStockMoistureReadings.biocharProductId }).from(outputStockMoistureReadings)
      .where(and(eq(outputStockMoistureReadings.organizationId, ctx.organizationId), eq(outputStockMoistureReadings.movementId, correction.original.id)));
    for (const reading of originalReadings) if (reading.productId) productIds.add(reading.productId);
  }
  const savedProducts = [];
  for (const productId of [...productIds].sort()) {
    const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId))).for('update');
    if (!product) throw new SafeError('Biochar product not found');
    // Direct loss/count/correction forms check their preview. Delivery creates
    // deliberately consume current stock under the bin lock and bump below.
    if (input.expectedProductVersions) assertRowVersion({ entity: 'biocharProduct', id: product.id, expectedVersion: input.expectedProductVersions[product.id], actualVersion: product.version });
  }
  const payloadHash = stockFingerprint(options.payload ?? input);
  if (correction) {
    const restoreGrams = correction.allocations.reduce((sum, a) => sum + grams(a.dryMassKg), BigInt(0));
    // These audit balances include every layer, including physically future intakes.
    const restoredBalance = prepared.layers.reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0));
    const [reversal] = await tx.insert(binMovements).values({ organizationId: ctx.organizationId, storageLocationId: input.storageLocationId, lane: prepared.lane,
      movementType: 'adjustment', massDeltaKg: Number(kilograms(restoreGrams)), reason: input.reason, createdBy: ctx.userId,
      outputKind: 'reversal', occurredAt: new Date(input.occurredAt), idempotencyKey: `${input.idempotencyKey}:reversal`, basisFingerprint: input.basisFingerprint,
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
    outputKind: correction ? 'replacement' : input.kind, occurredAt: new Date(input.occurredAt), idempotencyKey: input.idempotencyKey,
    basisFingerprint: input.basisFingerprint, inputSnapshot: { ...input, sources: prepared.sources,
      // A split draw has no single reading; history shows its overall moisture, 1 − solids ÷ wet.
      moisturePercent: postedMoisturePercent(prepared), actorId: ctx.userId, payloadHash, targetBiocharProductId: options.targetBiocharProductId, deliveryId: options.deliveryId ?? correction?.deliveryId, discrepancySolidsKg: storeRational(plan.discrepancySolidsKg), preview },
    outputDryDeltaKg: kilograms(-grams(plan.drawnDryKg)), balanceBeforeDryKg: kilograms(beforeGrams), balanceAfterDryKg: kilograms(beforeGrams - grams(plan.drawnDryKg)), correctsMovementId: correction?.original.id ?? null }).returning();
  // Every allocation records how it was drawn, so provenance never needs the planner again.
  const policy = prepared.sources ? 'operator_order' : prepared.policy;
  const order = prepared.sources?.map(source => source.layerId) ?? null;
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
        establishedDryBiocharKg: layer.establishedDryBiocharKg, ingredientDrySolidsKg: layer.ingredientDrySolidsKg, placedAt: layer.placedAt, postingSequence: String(layer.postingSequence), code: preview.allocations[index].code,
        policy, order, readingPercent: a.readingPercent == null ? null : String(a.readingPercent) } }).returning();
    for (const run of a.runs) await tx.insert(outputStockRunAllocations).values({ organizationId: ctx.organizationId, allocationId: allocation.id, productionRunId: run.productionRunId, dryMassKg: run.dryKg });
  }
  // A count's reading sets the wet stock and moisture of every layer it
  // weighed; the saved preview keeps the before and after the operator saw.
  for (const reading of prepared.readings) {
    await tx.insert(outputStockMoistureReadings).values({ organizationId: ctx.organizationId, storageLocationId: input.storageLocationId, movementId: movement.id,
      biocharProductId: prepared.lane === 'product' ? reading.layerId : null, productionRunId: prepared.lane === 'biochar' ? reading.layerId : null,
      moisturePercent: reading.moisturePercent, solidsBasisKg: storeRational(reading.solidsKg), occurredAt: new Date(input.occurredAt) });
  }
  if (correction?.deliveryId) {
    const [delivery] = await tx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, correction.deliveryId))).for('update');
    if (!delivery || delivery.storageLocationId !== input.storageLocationId || delivery.facilityId !== input.facilityId) throw new SafeError('Delivery source changed. Refresh and retry.');
    await lockDeliveryOrderAndAssertBalance(ctx, tx, { orderId: delivery.orderId, requestedWetKg: input.wetMassKg, excludeDeliveryId: delivery.id });
    await tx.update(deliveries).set({ deliveredWetMassKg: input.wetMassKg, moistureContentPercent: postedMoisturePercent(prepared), massDryKg: Number(plan.drawnDryKg), deliveryDate: new Date(input.occurredAt), updatedAt: new Date() }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, delivery.id)));
    await syncBiocharProductTransportLegs(ctx, tx, [...productIds]);
  }
  if (productIds.size) savedProducts.push(...await tx.update(biocharProducts)
    .set({ version: nextVersion(biocharProducts.version), updatedAt: new Date() })
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), inArray(biocharProducts.id, [...productIds]))).returning());
  return { movement, preview, savedProducts, moisturePercent: postedMoisturePercent(prepared) };
}
export async function postOutputStock(ctx: OrgContext, raw: OutputStockPostInput) {
  requireOrgScope(ctx);
  const input = outputStockPostSchema.parse(raw);
  if (!['loss', 'count'].includes(input.kind) && !(input.kind === 'delivery' && input.correctsMovementId)) throw new SafeError('Save deliveries and products through their own forms.');
  return withOutputStockPosting(ctx, {
    input,
    locksTransportRoutes: true,
    replay: async (tx, existing) => ({ movementId: existing.id, preview: existing.inputSnapshot!.preview as unknown as PostedOutputStock['preview'],
      savedProducts: await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, input.storageLocationId))) }),
    write: async (_tx, post) => {
      const result = await post();
      return { movementId: result.movement.id, preview: result.preview, savedProducts: result.savedProducts };
    },
  });
}
