import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, biocharProductSourceAllocations, outputStockAllocations, outputStockMoistureReadings, outputStockRunAllocations, productIngredientSnapshots, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import type { OutputStockLayer } from '@/lib/output-stock';
import { outputStockBalance, projectBiocharLayers, projectMoistureBases, projectProductLayers, BEFORE_LEDGER_SEQUENCE, UnresolvedOutputStockError, type MoistureReadingRow, type WetRemovalRow } from '@/lib/output-stock/layer-projection';
import { estimateStock, type LayerMoistureBasis } from '@/lib/output-stock/moisture-estimate';
import { COMPLETED_PRODUCTION_RUN_STATUS } from '@/lib/production-runs/lifecycle';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { requireOrgScope } from './utils';

export { UnresolvedOutputStockError };

type Reader = Pick<DbTransaction, 'select'>;
type ReadOptions = { includeArchived?: boolean; excludeUnresolvedRunId?: string };
type OutputBinType = 'biochar_bin' | 'product_bin';
/** An output bin already found in scope: whose facility its layers must share, and whether archived layers count. */
interface OutputBinRef { id: string; type: OutputBinType; facilityId: string; includeArchived: boolean }

const isOutputBinType = (type: string): type is OutputBinType => type === 'biochar_bin' || type === 'product_bin';

/** Saved history, including linked reversals. Never rerun FIFO for provenance consumers. */
export async function getOutputStockAllocationProjection(ctx: OrgContext, filter: { sourceStorageLocationId?: string; sourceStorageLocationIds?: readonly string[]; deliveryId?: string }, reader: Reader = db) {
  requireOrgScope(ctx);
  const sourceIds = filter.sourceStorageLocationIds ?? (filter.sourceStorageLocationId ? [filter.sourceStorageLocationId] : undefined);
  if (!sourceIds && !filter.deliveryId) throw new SafeError('A bin or delivery is required');
  if (sourceIds && !sourceIds.length) return [];
  return reader.select({ allocation: outputStockAllocations, run: outputStockRunAllocations, movement: binMovements })
    .from(outputStockAllocations)
    .innerJoin(binMovements, and(eq(binMovements.id, outputStockAllocations.movementId), eq(binMovements.organizationId, ctx.organizationId)))
    .leftJoin(outputStockRunAllocations, and(eq(outputStockRunAllocations.allocationId, outputStockAllocations.id), eq(outputStockRunAllocations.organizationId, ctx.organizationId)))
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId),
      sourceIds ? inArray(outputStockAllocations.sourceStorageLocationId, [...sourceIds]) : undefined,
      filter.deliveryId ? eq(outputStockAllocations.deliveryId, filter.deliveryId) : undefined))
    .orderBy(asc(binMovements.postingSequence), asc(outputStockAllocations.id), asc(outputStockRunAllocations.productionRunId));
}

/**
 * Every saved row that shapes the layers of `bins`, in one query per table
 * whatever the bin count. Rows are grouped per bin in memory, where the
 * facility and archived rules of each bin apply.
 */
async function readLayerRows(ctx: OrgContext, bins: readonly OutputBinRef[], reader: Reader) {
  const biocharBinIds = bins.filter(bin => bin.type === 'biochar_bin').map(bin => bin.id);
  const productBinIds = bins.filter(bin => bin.type === 'product_bin').map(bin => bin.id);
  const [runs, biocharSources, products, effects] = await Promise.all([
    biocharBinIds.length ? reader.select({ id: productionRuns.id, binId: productionRuns.biocharStorageLocationId, facilityId: productionRuns.facilityId, archivedAt: productionRuns.archivedAt,
      endTime: productionRuns.endTime, dryKg: sql<string | null>`${productionRuns.biocharDryMassKg}::text`, postingSequence: productionRuns.stockPostingSequence })
      .from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.biocharStorageLocationId, biocharBinIds), eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS))) : [],
    biocharBinIds.length ? reader.select({ binId: biocharProductSourceAllocations.sourceStorageLocationId, productId: biocharProductSourceAllocations.biocharProductId, runId: biocharProductSourceAllocations.productionRunId,
      dryKg: sql<string>`${biocharProductSourceAllocations.allocatedDryMassKg}::text` }).from(biocharProductSourceAllocations)
      .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), inArray(biocharProductSourceAllocations.sourceStorageLocationId, biocharBinIds))) : [],
    productBinIds.length ? reader.select({ id: biocharProducts.id, binId: biocharProducts.storageLocationId, facilityId: biocharProducts.facilityId, archivedAt: biocharProducts.archivedAt,
      placedAt: biocharProducts.placedAt, postingSequence: biocharProducts.stockPostingSequence, composition: biocharProducts.composition })
      .from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), inArray(biocharProducts.storageLocationId, productBinIds))) : [],
    getOutputStockAllocationProjection(ctx, { sourceStorageLocationIds: bins.map(bin => bin.id) }, reader),
  ]);
  const productIds = products.map(product => product.id);
  const [productSources, ingredients] = await Promise.all([
    productIds.length ? reader.select({ productId: biocharProductSourceAllocations.biocharProductId, runId: biocharProductSourceAllocations.productionRunId, runFacilityId: productionRuns.facilityId,
      dryKg: sql<string>`${biocharProductSourceAllocations.allocatedDryMassKg}::text` })
      .from(biocharProductSourceAllocations).innerJoin(productionRuns, and(eq(productionRuns.id, biocharProductSourceAllocations.productionRunId), eq(productionRuns.organizationId, ctx.organizationId)))
      .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), inArray(biocharProductSourceAllocations.biocharProductId, productIds))).orderBy(asc(biocharProductSourceAllocations.productionRunId)) : [],
    productIds.length ? reader.select({ biocharProductId: productIngredientSnapshots.biocharProductId, formulationIngredientId: productIngredientSnapshots.formulationIngredientId, drySolidsKg: productIngredientSnapshots.drySolidsKg })
      .from(productIngredientSnapshots).where(and(eq(productIngredientSnapshots.organizationId, ctx.organizationId), inArray(productIngredientSnapshots.biocharProductId, productIds))) : [],
  ]);
  return { runs, biocharSources, products, productSources, ingredients, effects };
}

type LayerRows = Awaited<ReturnType<typeof readLayerRows>>;

/** One bin's layers from the shared rows. Throws UnresolvedOutputStockError when its facts are incomplete. */
function projectBinLayers(bin: OutputBinRef, rows: LayerRows, options: { excludeUnresolvedRunId?: string } = {}): OutputStockLayer[] {
  const inScope = (row: { binId: string | null; facilityId: string; archivedAt: Date | null }) => row.binId === bin.id && row.facilityId === bin.facilityId && (bin.includeArchived || row.archivedAt == null);
  const effects = rows.effects.filter(effect => effect.allocation.sourceStorageLocationId === bin.id);
  if (bin.type === 'biochar_bin') {
    return projectBiocharLayers({ runs: rows.runs.filter(inScope), sources: rows.biocharSources.filter(source => source.binId === bin.id), effects }, options);
  }
  const products = rows.products.filter(inScope);
  const productIds = new Set(products.map(product => product.id));
  return projectProductLayers({ products, effects,
    sources: rows.productSources.filter(source => productIds.has(source.productId) && source.runFacilityId === bin.facilityId),
    ingredients: rows.ingredients.filter(ingredient => productIds.has(ingredient.biocharProductId)) });
}

/**
 * A posting reader: the bin must be in scope, at the facility, of the lane's
 * type and (unless reading an archived bin on purpose) not archived. Save
 * callers supply their locked transaction.
 */
async function getOutputStockLayers(ctx: OrgContext, type: OutputBinType, input: { storageLocationId: string; facilityId: string; occurredAt: string }, reader: Reader, options: ReadOptions) {
  requireOrgScope(ctx);
  const [bin] = await reader.select({ id: storageLocations.id }).from(storageLocations).where(and(
    eq(storageLocations.id, input.storageLocationId), eq(storageLocations.organizationId, ctx.organizationId),
    eq(storageLocations.facilityId, input.facilityId), eq(storageLocations.type, type), options.includeArchived ? undefined : isNull(storageLocations.archivedAt)));
  if (!bin) throw new SafeError(type === 'product_bin' ? 'Product bin not found or archived' : 'Biochar bin not found or archived');
  const ref: OutputBinRef = { id: bin.id, type, facilityId: input.facilityId, includeArchived: options.includeArchived ?? false };
  const layers = projectBinLayers(ref, await readLayerRows(ctx, [ref], reader), options);
  return { layers, ...outputStockBalance(layers, input.occurredAt) };
}

/**
 * Authoritative product-bin layers use frozen ingredient and source-run facts.
 * Unresolved composition fails closed.
 */
export function getProductOutputStockLayers(ctx: OrgContext, input: { storageLocationId: string; facilityId: string; occurredAt: string }, reader: Reader = db, options: ReadOptions = {}) {
  return getOutputStockLayers(ctx, 'product_bin', input, reader, options);
}

/**
 * Completed production layers. Missing established dry mass or completion is
 * unresolved, never inferred from wet stock.
 */
export function getBiocharOutputStockLayers(ctx: OrgContext, input: { storageLocationId: string; facilityId: string; occurredAt: string }, reader: Reader = db, options: ReadOptions = {}) {
  return getOutputStockLayers(ctx, 'biochar_bin', input, reader, options);
}

/**
 * Every layer's dry biochar, including receipts placed after now. Archive and
 * mutation guards conserve all of it; draws use dated availability instead.
 */
export async function getOutputBinAllLayersDryKg(ctx: OrgContext, storageLocationId: string, reader: Reader = db, options: ReadOptions = {}): Promise<number> {
  requireOrgScope(ctx);
  return Number((await readOutputBinAllLayers(ctx, storageLocationId, reader, options)).allLayersDryKg);
}

/** Every layer of one output bin, including receipts placed after now, with the guard balance. */
export async function readOutputBinAllLayers(ctx: OrgContext, storageLocationId: string, reader: Reader = db, options: ReadOptions = {}) {
  requireOrgScope(ctx);
  const [bin] = await reader.select({ facilityId: storageLocations.facilityId, type: storageLocations.type }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found');
  const input = { storageLocationId, facilityId: bin.facilityId, occurredAt: new Date().toISOString() };
  return getOutputStockLayers(ctx, bin.type === 'product_bin' ? 'product_bin' : 'biochar_bin', input, reader, options);
}

/** What an output bin holds now. Every figure is null when the bin's layers do not resolve. */
export interface OutputBinStock {
  /** All layers, including ones placed later than now: the guard balance. */
  allLayersDryKg: number | null;
  /** Layers placed by now: what an operator can draw. */
  availableDryKg: number | null;
  estimatedWetMassKg: number | null;
  estimatedMoisturePercent: number | null;
}

const UNRESOLVED_STOCK: OutputBinStock = { allLayersDryKg: null, availableDryKg: null, estimatedWetMassKg: null, estimatedMoisturePercent: null };

/**
 * Stock of many output bins in one pass: a fixed number of queries whatever
 * the bin count. An unresolved bin reads as unavailable and never fails the
 * others. Ids that are not output bins in scope are left out.
 */
export async function getOutputBinStocks(ctx: OrgContext, storageLocationIds: readonly string[], reader: Reader = db): Promise<Map<string, OutputBinStock>> {
  requireOrgScope(ctx);
  if (!storageLocationIds.length) return new Map();
  const found = await reader.select({ id: storageLocations.id, type: storageLocations.type, facilityId: storageLocations.facilityId, archivedAt: storageLocations.archivedAt })
    .from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), inArray(storageLocations.id, [...storageLocationIds])));
  const bins = found.flatMap(bin => isOutputBinType(bin.type) ? [{ id: bin.id, type: bin.type, facilityId: bin.facilityId, includeArchived: bin.archivedAt != null }] : []);
  if (!bins.length) return new Map();
  const at = new Date().toISOString();
  const [rows, moisture] = await Promise.all([readLayerRows(ctx, bins, reader), readMoistureRows(ctx, bins, reader)]);
  return new Map(bins.map(bin => {
    let layers: OutputStockLayer[];
    try {
      layers = projectBinLayers(bin, rows, {});
    } catch (error) {
      if (!(error instanceof UnresolvedOutputStockError)) throw error;
      return [bin.id, UNRESOLVED_STOCK] as const;
    }
    const balance = outputStockBalance(layers, at);
    const estimate = estimateStock(projectMoistureBases(layers, moistureRowsFor(bin, moisture)), at);
    return [bin.id, { allLayersDryKg: Number(balance.allLayersDryKg), availableDryKg: Number(balance.availableDryKg),
      estimatedWetMassKg: estimate.wetKg, estimatedMoisturePercent: estimate.moisturePercent }] as const;
  }));
}

/** A bin's wet stock (wet in minus wet out) and moisture (kept from intake or the latest count). */
export async function getOutputBinStockView(ctx: OrgContext, storageLocationId: string, reader: Reader = db) {
  const stock = (await getOutputBinStocks(ctx, [storageLocationId], reader)).get(storageLocationId);
  if (!stock) throw new SafeError('Storage bin not found');
  return { dryMassKg: stock.availableDryKg, estimatedWetMassKg: stock.estimatedWetMassKg, estimatedMoisturePercent: stock.estimatedMoisturePercent };
}

/** Recorded wet mass per layer, moisture readings and reversed movements for `bins`, one query per table. */
async function readMoistureRows(ctx: OrgContext, bins: readonly Pick<OutputBinRef, 'id' | 'type'>[], reader: Reader) {
  const biocharBinIds = bins.filter(bin => bin.type === 'biochar_bin').map(bin => bin.id);
  const productBinIds = bins.filter(bin => bin.type === 'product_bin').map(bin => bin.id);
  const binIds = bins.map(bin => bin.id);
  const [runWet, productWet, readings, removals, sourceDraws, corrections] = await Promise.all([
    biocharBinIds.length ? reader.select({ id: productionRuns.id, wet: sql<string | null>`${productionRuns.biocharOutputKg}::text` }).from(productionRuns)
      .where(and(eq(productionRuns.organizationId, ctx.organizationId), inArray(productionRuns.biocharStorageLocationId, biocharBinIds))) : [],
    productBinIds.length ? reader.select({ id: biocharProducts.id, wet: sql<string | null>`(${biocharProducts.massKg} + coalesce(${biocharProducts.waterAddedKg}, 0))::text` }).from(biocharProducts)
      .where(and(eq(biocharProducts.organizationId, ctx.organizationId), inArray(biocharProducts.storageLocationId, productBinIds))) : [],
    // Only a count's reading sets a layer's moisture; readings older removals saved are history, not a basis.
    reader.select({ reading: outputStockMoistureReadings, sequence: binMovements.postingSequence }).from(outputStockMoistureReadings)
      .innerJoin(binMovements, and(eq(binMovements.id, outputStockMoistureReadings.movementId), eq(binMovements.organizationId, ctx.organizationId)))
      .where(and(eq(outputStockMoistureReadings.organizationId, ctx.organizationId), inArray(outputStockMoistureReadings.storageLocationId, binIds),
        sql`${binMovements.inputSnapshot}->>'kind' = 'count'`)),
    reader.select({ allocation: { biocharProductId: outputStockAllocations.biocharProductId, productionRunId: outputStockAllocations.productionRunId, storageLocationId: outputStockAllocations.sourceStorageLocationId,
      movementId: outputStockAllocations.movementId, wetMassKg: outputStockAllocations.wetMassKg, reversesAllocationId: outputStockAllocations.reversesAllocationId,
      targetBiocharProductId: outputStockAllocations.targetBiocharProductId },
    sequence: binMovements.postingSequence }).from(outputStockAllocations)
      .innerJoin(binMovements, and(eq(binMovements.id, outputStockAllocations.movementId), eq(binMovements.organizationId, ctx.organizationId)))
      .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), inArray(outputStockAllocations.sourceStorageLocationId, binIds))),
    // A product draw saved before the ledger: its source row is the only record of the wet mass it took.
    biocharBinIds.length ? reader.select({ binId: biocharProductSourceAllocations.sourceStorageLocationId, productId: biocharProductSourceAllocations.biocharProductId,
      runId: biocharProductSourceAllocations.productionRunId, wetMassKg: sql<string>`${biocharProductSourceAllocations.allocatedWetMassKg}::text` })
      .from(biocharProductSourceAllocations)
      .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), inArray(biocharProductSourceAllocations.sourceStorageLocationId, biocharBinIds))) : [],
    reader.select({ binId: binMovements.storageLocationId, correctsMovementId: binMovements.correctsMovementId }).from(binMovements)
      .where(and(eq(binMovements.organizationId, ctx.organizationId), inArray(binMovements.storageLocationId, binIds), isNotNull(binMovements.correctsMovementId))),
  ]);
  return { recordedWetKg: new Map([...runWet, ...productWet].map(row => [row.id, row.wet])), readings, removals, sourceDraws, corrections };
}

function moistureRowsFor(bin: Pick<OutputBinRef, 'id'>, rows: Awaited<ReturnType<typeof readMoistureRows>>, ignoreMovementId?: string) {
  const reversedMovementIds = new Set(rows.corrections.flatMap(row => row.binId === bin.id && row.correctsMovementId ? [row.correctsMovementId] : []));
  if (ignoreMovementId) reversedMovementIds.add(ignoreMovementId);
  const readings: MoistureReadingRow[] = rows.readings.flatMap(({ reading, sequence }) => {
    const layerId = reading.biocharProductId ?? reading.productionRunId;
    return reading.storageLocationId === bin.id && layerId ? [{ layerId, movementId: reading.movementId, moisturePercent: reading.moisturePercent, solidsBasisKg: reading.solidsBasisKg, occurredAt: reading.occurredAt, sequence }] : [];
  });
  const ledger = rows.removals.filter(({ allocation }) => allocation.storageLocationId === bin.id);
  const removals: WetRemovalRow[] = ledger.flatMap(({ allocation, sequence }) => {
    const layerId = allocation.biocharProductId ?? allocation.productionRunId;
    return layerId ? [{ layerId, movementId: allocation.movementId, wetMassKg: allocation.wetMassKg, reversesAllocationId: allocation.reversesAllocationId, sequence }] : [];
  });
  // A product draw with ledger allocations is counted from the ledger, as the layer projection does.
  // Product creation posts before it saves source rows, so a source row with no ledger draw predates the ledger.
  const postedProducts = new Set(ledger.flatMap(({ allocation }) => allocation.targetBiocharProductId ? [allocation.targetBiocharProductId] : []));
  for (const draw of rows.sourceDraws) {
    if (draw.binId !== bin.id || postedProducts.has(draw.productId)) continue;
    removals.push({ layerId: draw.runId, movementId: `product:${draw.productId}`, wetMassKg: draw.wetMassKg, reversesAllocationId: null, sequence: BEFORE_LEDGER_SEQUENCE });
  }
  return { recordedWetKg: rows.recordedWetKg, readings, removals, reversedMovementIds };
}

/**
 * What each layer's wet mass and moisture are known from: the wet mass and
 * solids it was recorded with when it entered the bin, every count reading on
 * it, and the wet mass every removal took, leaving out what a correction reversed. `ignoreMovementId` drops the readings of the entry a
 * correction is replacing, so its preview starts from the stock before it.
 */
export async function getLayerMoistureBases(ctx: OrgContext, bin: { id: string; type: string }, layers: readonly OutputStockLayer[], reader: Reader = db, options: { ignoreMovementId?: string } = {}): Promise<LayerMoistureBasis[]> {
  requireOrgScope(ctx);
  const rows = await readMoistureRows(ctx, [{ id: bin.id, type: bin.type === 'product_bin' ? 'product_bin' : 'biochar_bin' }], reader);
  return projectMoistureBases(layers, moistureRowsFor(bin, rows, options.ignoreMovementId));
}
