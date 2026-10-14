import { assertRowVersion, nextVersion } from "./row-version";
import { db, type DbTransaction } from '@/db';
import { biocharProducts, binMovements, deliveries, facilities, outputStockAllocations, outputStockMoistureReadings, outputStockRunAllocations, storageLocations, type BiocharProductRecord, type Delivery } from '@/db/schema';
import { toBiocharProductRecord } from './biochar-product-record';
import type { OrgContext } from '@/lib/auth/server';
import { DomainError } from '@/lib/domain-errors';
import { SafeError } from '@/lib/errors';
import { withFeedstockErrors } from '@/lib/feedstock-domain-errors';
import { add, decimal, grams, GRAMS_PER_KG, kilograms, multiply, rational, readRational, round, storeRational } from '@/lib/output-stock';
import { outputStockCommandSchema, outputStockPostSchema } from '@/schemas/output-stock';
import type { OutputStockPostInput, OutputStockPreview } from '@/types/output-stock';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { findMovementRequest, lockMovementRequest } from './bin-movement-requests';
import { assertCanMutateCertifiedLineage } from './certification-lineage-guards';
import { lockDeliveryOrderAndAssertBalance } from './delivery-order-balance';
import { assertEventTimesNotFuture } from './future-event-time';
import { lockBinStocks } from './lock-bin-stocks';
import { blockedOutputStockError, outputReferenceNotFound, StockBasisChangedError } from './output-stock-errors';
import { assertOutputLayersMutable, changedOutputLayerIds } from './output-stock-lineage';
import { postedMoisturePercent, prepareOutputStock, stockFingerprint } from './output-stock-operations';
import type { SnapshotStock } from './stock-effects';
import { lockBiocharTransportRouteTopology, syncBiocharProductTransportLegs } from './transport-legs';
import { requireOrgScope } from './utils';
import { assertLatestOutputMovement, outputReceiptMarker } from './output-stock-edit-lock';

const OUTPUT_REQUEST_CONFLICT_MESSAGE = 'This request key was already used with different values.';
const OUTPUT_BIN_NOT_FOUND_MESSAGE = 'Output bin not found or archived';
export const OUTPUT_STOCK_FUTURE_TIME_MESSAGE = 'Date and time cannot be in the future. Enter a time at or before now.';
const OUTPUT_BIN_TYPE_MESSAGE = 'Choose a biochar or product bin. Feedstock bin stock is recorded on the feedstock bin.';
const OWN_FORMS_MESSAGE = 'Save deliveries and products through their own forms.';
const OUTPUT_BIN_TYPES: ReadonlySet<string> = new Set(['biochar_bin', 'product_bin']);
/** Kinds a direct stock command posts; deliveries and products post through their own writers. */
const DIRECT_COMMAND_KINDS: ReadonlySet<string> = new Set(['loss', 'count']);

/**
 * Domain creates use current stock. Direct commands may name the stock basis
 * and product versions their preview showed; both are optional (decision 53).
 */
type StockPostingInput = Omit<OutputStockPostInput, 'expectedProductVersions' | 'basisFingerprint'> & { expectedProductVersions?: Record<string, number>; basisFingerprint?: string };

export type PostedOutputRequest = NonNullable<Awaited<ReturnType<typeof findMovementRequest>>>;
type PersistOptions = {
  deliveryId?: string;
  targetBiocharProductId?: string;
  payload?: unknown;
  /**
   * The basis stored on the movement when the caller planned on more than this
   * bin: a product create's fingerprint across its source, product and
   * ingredient bins, so a replay returns what the dry run returned.
   */
  recordedBasisFingerprint?: string;
};
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

export interface OutputStockPostingOptions {
  /** Dry-run observer: called once, after every bin lock and before any write. */
  snapshotStock?: SnapshotStock;
}

/**
 * The one way to post output stock, inside a caller's transaction (the
 * operation runner's, or `withOutputStockPosting`'s). Owns the lock order:
 * transport routes, request key, bins in sorted order, then the write's own
 * locks. A replayed key never writes and no caller can post without holding
 * the bin lock. A caller retrying the transaction re-enters the whole seam.
 */
export async function withOutputStockPostingInTransaction<T>(ctx: OrgContext, tx: DbTransaction, posting: OutputStockPosting<T>, options: OutputStockPostingOptions = {}): Promise<T> {
  requireOrgScope(ctx);
  const { input, payload = input } = posting;
  if (posting.locksTransportRoutes) await lockBiocharTransportRouteTopology(ctx, tx);
  const existing = await findPostedOutputRequest(ctx, tx, { idempotencyKey: input.idempotencyKey, payload, storageLocationId: input.storageLocationId });
  if (existing) return posting.replay(tx, existing);
  const binIds = [input.storageLocationId, ...(posting.additionalBinIds ?? [])];
  await lockBinStocks(ctx, tx, binIds);
  // One snapshot of every locked bin, so no affected bin is missing from the effects.
  await options.snapshotStock?.(tx, binIds);
  return posting.write(tx, ({ basisFingerprint, ...persist } = {}) =>
    persistOutputStock(ctx, tx, basisFingerprint ? { ...input, basisFingerprint } : input, { ...persist, payload }));
}

/**
 * The movement a request key already posted, or undefined on a first submit,
 * read under the request lock, which serializes a request even if a reused
 * key names a different bin. A changed payload is a conflict. A caller may
 * look up its key before its own checks; the posting seam takes the same
 * transaction-scoped lock again, which PostgreSQL grants to its holder.
 */
export async function findPostedOutputRequest(ctx: OrgContext, tx: DbTransaction, request: { idempotencyKey: string; payload: unknown; storageLocationId: string }) {
  requireOrgScope(ctx);
  await lockMovementRequest(ctx, tx, request.idempotencyKey);
  return findMovementRequest(ctx, tx, { ...request, conflictMessage: OUTPUT_REQUEST_CONFLICT_MESSAGE });
}

/** `withOutputStockPostingInTransaction` in a transaction of its own. */
export async function withOutputStockPosting<T>(ctx: OrgContext, posting: OutputStockPosting<T>): Promise<T> {
  requireOrgScope(ctx);
  return db.transaction(tx => withOutputStockPostingInTransaction(ctx, tx, posting));
}

/** Requires the request and bin locks held by withOutputStockPostingInTransaction. */
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
  // Without a fingerprint the command acts on current stock under the bin lock (decision 53).
  if (input.basisFingerprint !== undefined && preview.basisFingerprint !== input.basisFingerprint) throw new StockBasisChangedError({ id: input.storageLocationId, code: prepared.bin.code });
  if (!plan || preview.blockingMessage) throw blockedOutputStockError(prepared.blocking, preview.blockingMessage ?? 'Stock cannot be allocated.');
  // Drawn and restored layers, readings reset, and original readings a
  // correction removes, even when a backdated replacement records none for a layer.
  const changedLayerIds = await changedOutputLayerIds(ctx, tx, { ...prepared, plan });
  // Losses, counts and corrections change certified evidence. A delivery or a
  // product draw consumes stock under its own guards, but any reading it would
  // reset still passes the lineage guard (decision 51).
  const guardedLayerIds = correction || DIRECT_COMMAND_KINDS.has(input.kind)
    ? changedLayerIds : changedLayerIds.filter(id => prepared.readings.some(reading => reading.layerId === id));
  await assertOutputLayersMutable(ctx, tx, prepared.lane, guardedLayerIds);
  if (correction?.deliveryId) await withFeedstockErrors(() => assertCanMutateCertifiedLineage(ctx, tx, { entityType: 'delivery', entityId: correction.deliveryId! }, 'update'), 'certification_locked');
  // Bin locks precede product rows everywhere. Lock parents before inserting
  // ledger children (their foreign keys acquire parent key-share locks).
  const productIds = new Set(prepared.lane === 'product' ? changedLayerIds : []);
  const savedProducts = [];
  const savedDeliveries = [];
  for (const productId of [...productIds].sort()) {
    const [product] = await tx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.id, productId))).for('update');
    if (!product) throw new SafeError('Biochar product not found');
    // Direct loss/count/correction forms check their preview. Delivery creates
    // deliberately consume current stock under the bin lock and bump below.
    if (input.expectedProductVersions) assertRowVersion({ entity: 'biocharProduct', id: product.id, expectedVersion: input.expectedProductVersions[product.id], actualVersion: product.version });
  }
  const payloadHash = stockFingerprint(options.payload ?? input);
  // The basis the posting was planned on, whether or not the caller named one.
  const basisFingerprint = options.recordedBasisFingerprint ?? input.basisFingerprint ?? preview.basisFingerprint;
  if (correction) {
    const restoreGrams = correction.allocations.reduce((sum, a) => sum + grams(a.dryMassKg), BigInt(0));
    // These audit balances include every layer, including physically future intakes.
    const restoredBalance = prepared.layers.reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0));
    const [reversal] = await tx.insert(binMovements).values({ organizationId: ctx.organizationId, storageLocationId: input.storageLocationId, lane: prepared.lane,
      movementType: 'adjustment', massDeltaKg: Number(kilograms(restoreGrams)), reason: input.reason, createdBy: ctx.userId,
      outputKind: 'reversal', occurredAt: new Date(input.occurredAt), idempotencyKey: `${input.idempotencyKey}:reversal`, basisFingerprint,
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
    basisFingerprint, inputSnapshot: { ...input, sources: prepared.sources, receiptMarker: await outputReceiptMarker(ctx, input.storageLocationId, tx),
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
        policy, defaultDrawOrder: preview.stockMode === 'split' ? prepared.bin.drawOrder : null, order, readingPercent: a.readingPercent == null ? null : String(a.readingPercent) } }).returning();
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
    savedDeliveries.push(...await tx.update(deliveries).set({ version: nextVersion(deliveries.version), deliveredWetMassKg: input.wetMassKg, moistureContentPercent: postedMoisturePercent(prepared), massDryKg: Number(plan.drawnDryKg), deliveryDate: new Date(input.occurredAt), updatedAt: new Date() }).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, delivery.id))).returning());
    await syncBiocharProductTransportLegs(ctx, tx, [...productIds]);
  }
  if (productIds.size) savedProducts.push(...await tx.update(biocharProducts)
    .set({ version: nextVersion(biocharProducts.version), updatedAt: new Date() })
    .where(and(eq(biocharProducts.organizationId, ctx.organizationId), inArray(biocharProducts.id, [...productIds]))).returning());
  return { movement, preview, savedProducts, savedDeliveries, moisturePercent: postedMoisturePercent(prepared) };
}
export interface RecordedOutputStockMovement {
  movementId: string;
  /** The stock basis the movement was planned on; a dry run's value is what a write may send back. */
  basisFingerprint: string;
  preview: OutputStockPreview;
  savedProducts: BiocharProductRecord[];
  savedDeliveries: Delivery[];
}

export interface RecordOutputStockMovementOptions extends OutputStockPostingOptions {
  /** Own-form edits require the entry to be the bin's latest, regardless of layer dependencies. */
  requireLatestCorrection?: boolean;
  /** Injectable server clock for exact-boundary tests. */
  now?: Date;
}

/**
 * The output bin a stock command names, read in `tx` with its facility and
 * that facility's time zone. An archived or foreign bin, or one outside the
 * facility the caller named, is not found; a feedstock bin is refused.
 */
export async function readOutputStockBin(ctx: OrgContext, tx: DbTransaction, target: { storageLocationId: string; facilityId?: string }) {
  requireOrgScope(ctx);
  const [bin] = await tx.select({ id: storageLocations.id, facilityId: storageLocations.facilityId, type: storageLocations.type, timeZone: facilities.timezone })
    .from(storageLocations)
    .innerJoin(facilities, and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, storageLocations.facilityId)))
    .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, target.storageLocationId), isNull(storageLocations.archivedAt)));
  if (!bin || (target.facilityId && target.facilityId !== bin.facilityId)) throw outputReferenceNotFound(OUTPUT_BIN_NOT_FOUND_MESSAGE, ['storageLocationId']);
  if (!OUTPUT_BIN_TYPES.has(bin.type)) {
    throw new DomainError('validation_failed', OUTPUT_BIN_TYPE_MESSAGE, { issues: [{ path: ['storageLocationId'], code: 'validation_failed', message: OUTPUT_BIN_TYPE_MESSAGE }] });
  }
  return { id: bin.id, facilityId: bin.facilityId, timeZone: bin.timeZone };
}

/**
 * Posts a loss, a count or a UI correction inside the caller's transaction.
 * A future `occurredAt` is refused (decision 56), corrections included;
 * backdating stays allowed.
 */
export async function recordOutputStockMovementInTransaction(ctx: OrgContext, tx: DbTransaction, command: z.input<typeof outputStockCommandSchema>, options: RecordOutputStockMovementOptions = {}): Promise<RecordedOutputStockMovement> {
  requireOrgScope(ctx);
  if (!DIRECT_COMMAND_KINDS.has(command.kind) && !(command.kind === 'delivery' && command.correctsMovementId)) {
    throw new DomainError('validation_failed', OWN_FORMS_MESSAGE, { issues: [{ path: ['kind'], code: 'validation_failed', message: OWN_FORMS_MESSAGE }] });
  }
  const input = outputStockCommandSchema.parse(command);
  assertEventTimesNotFuture({ occurredAt: new Date(input.occurredAt) }, { occurredAt: OUTPUT_STOCK_FUTURE_TIME_MESSAGE }, options.now ?? new Date());
  return withOutputStockPostingInTransaction(ctx, tx, {
    input,
    locksTransportRoutes: true,
    replay: async (replayTx, existing) => {
      const preview = existing.inputSnapshot!.preview as unknown as OutputStockPreview;
      return { savedDeliveries: existing.inputSnapshot?.deliveryId
        ? await replayTx.select().from(deliveries).where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, String(existing.inputSnapshot.deliveryId))))
        : [], movementId: existing.id, basisFingerprint: existing.basisFingerprint ?? preview.basisFingerprint, preview,
        savedProducts: (await replayTx.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, input.storageLocationId)))).map(toBiocharProductRecord) };
    },
    write: async (writeTx, post) => {
      if (options.requireLatestCorrection && input.correctsMovementId) await assertLatestOutputMovement(ctx, input.storageLocationId, input.correctsMovementId, writeTx);
      const result = await post();
      return { movementId: result.movement.id, basisFingerprint: result.preview.basisFingerprint, preview: result.preview, savedProducts: result.savedProducts.map(toBiocharProductRecord), savedDeliveries: result.savedDeliveries };
    },
  }, options);
}

/** A stock form's command in a transaction of its own, without the operation runner. */
export async function postOutputStock(ctx: OrgContext, raw: OutputStockPostInput): Promise<RecordedOutputStockMovement> {
  requireOrgScope(ctx);
  const input = outputStockPostSchema.parse(raw);
  return db.transaction(tx => recordOutputStockMovementInTransaction(ctx, tx, input));
}
