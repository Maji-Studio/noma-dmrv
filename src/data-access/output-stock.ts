import { db, type DbTransaction } from '@/db';
import { binMovements, biocharProducts, biocharProductSourceAllocations, outputStockAllocations, outputStockRunAllocations, productIngredientSnapshots, productionRuns, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { add, grams, GRAMS_PER_KG, kilograms, planOutputStock, rational, readRational, subtract, type OutputStockLayer } from '@/lib/output-stock';
import { COMPLETED_PRODUCTION_RUN_STATUS } from '@/lib/production-runs/lifecycle';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;
type ReadOptions = { includeArchived?: boolean; excludeUnresolvedRunId?: string };
export class UnresolvedOutputStockError extends SafeError {}

/** Saved history, including linked reversals. Never rerun FIFO for provenance consumers. */
export async function getOutputStockAllocationProjection(ctx: OrgContext, filter: { sourceStorageLocationId?: string; deliveryId?: string }, reader: Reader = db) {
  requireOrgScope(ctx);
  if (!filter.sourceStorageLocationId && !filter.deliveryId) throw new SafeError('A bin or delivery is required');
  return reader.select({ allocation: outputStockAllocations, run: outputStockRunAllocations, movement: binMovements })
    .from(outputStockAllocations)
    .innerJoin(binMovements, and(eq(binMovements.id, outputStockAllocations.movementId), eq(binMovements.organizationId, ctx.organizationId)))
    .leftJoin(outputStockRunAllocations, and(eq(outputStockRunAllocations.allocationId, outputStockAllocations.id), eq(outputStockRunAllocations.organizationId, ctx.organizationId)))
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId),
      filter.sourceStorageLocationId ? eq(outputStockAllocations.sourceStorageLocationId, filter.sourceStorageLocationId) : undefined,
      filter.deliveryId ? eq(outputStockAllocations.deliveryId, filter.deliveryId) : undefined))
    .orderBy(asc(binMovements.postingSequence), asc(outputStockAllocations.id), asc(outputStockRunAllocations.productionRunId));
}

/**
 * Authoritative product-bin layers use frozen ingredient and source-run facts.
 * Unresolved composition fails closed. Save callers supply their locked transaction.
 */
export async function getProductOutputStockLayers(ctx: OrgContext, input: { storageLocationId: string; facilityId: string; physicalDate: string }, reader: Reader = db, options: ReadOptions = {}) {
  requireOrgScope(ctx);
  const [bin] = await reader.select({ id: storageLocations.id }).from(storageLocations).where(and(
    eq(storageLocations.id, input.storageLocationId), eq(storageLocations.organizationId, ctx.organizationId),
    eq(storageLocations.facilityId, input.facilityId), eq(storageLocations.type, 'product_bin'), options.includeArchived ? undefined : isNull(storageLocations.archivedAt)));
  if (!bin) throw new SafeError('Product bin not found or archived');
  const products = await reader.select({ id: biocharProducts.id, placedAt: biocharProducts.placedAt, postingSequence: biocharProducts.stockPostingSequence, composition: biocharProducts.composition })
    .from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, input.storageLocationId), eq(biocharProducts.facilityId, input.facilityId), options.includeArchived ? undefined : isNull(biocharProducts.archivedAt)));
  const ids = products.map(p => p.id);
  if (!ids.length) return { layers: [] as OutputStockLayer[], expectedSolidsKg: planOutputStock([], input.physicalDate, { kind: 'count', wetKg: 0 }).expectedSolidsKg, remainingDryKg: '0.000' };
  const sources = await reader.select({ productId: biocharProductSourceAllocations.biocharProductId, runId: biocharProductSourceAllocations.productionRunId, dryKg: sql<string>`${biocharProductSourceAllocations.allocatedDryMassKg}::text` })
    .from(biocharProductSourceAllocations).innerJoin(productionRuns, and(eq(productionRuns.id, biocharProductSourceAllocations.productionRunId), eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, input.facilityId)))
    .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), inArray(biocharProductSourceAllocations.biocharProductId, ids))).orderBy(asc(biocharProductSourceAllocations.productionRunId));
  const ingredients = await reader.select().from(productIngredientSnapshots).where(and(eq(productIngredientSnapshots.organizationId, ctx.organizationId), inArray(productIngredientSnapshots.biocharProductId, ids)));
  const effects = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: input.storageLocationId }, reader);
  const layers: OutputStockLayer[] = products.map(product => {
    if (!product.placedAt) throw new UnresolvedOutputStockError('Product placement date is unresolved');
    const snapshotIngredients = ingredients.filter(i => i.biocharProductId === product.id);
    const composition = product.composition as { ingredients?: { formulationIngredientId: string; massKg: number }[] };
    const ingredientLines = composition.ingredients ?? [];
    if (ingredientLines.some(i => !Number.isFinite(i.massKg) || i.massKg < 0)) throw new UnresolvedOutputStockError('Ingredient dry solids are unresolved');
    const positiveIngredients = ingredientLines.filter(i => i.massKg > 0);
    if (positiveIngredients.length !== snapshotIngredients.length || positiveIngredients.some(line =>
      snapshotIngredients.filter(snapshot => snapshot.formulationIngredientId === line.formulationIngredientId).length !== 1,
    )) throw new UnresolvedOutputStockError('Ingredient dry solids are unresolved');
    const layerEffects = effects.filter(e => e.allocation.biocharProductId === product.id);
    const uniqueEffects = [...new Map(layerEffects.map(e => [e.allocation.id, e.allocation])).values()];
    const runs = sources.filter(s => s.productId === product.id).map(source => ({ productionRunId: source.runId, establishedDryKg: source.dryKg,
      remainingDryKg: kilograms(grams(source.dryKg) - layerEffects.filter(e => e.run?.productionRunId === source.runId).reduce((sum, e) => sum + gramsSigned(e.run!.dryMassKg), BigInt(0))) }));
    const established = runs.reduce((sum, r) => sum + grams(r.establishedDryKg), BigInt(0));
    const ingredientGrams = snapshotIngredients.reduce((sum, i) => sum + grams(i.drySolidsKg), BigInt(0));
    const consumedSolidsKg = uniqueEffects.reduce((sum, effect) => add(sum, readRational(effect.basisSnapshot.solidsKg)), rational(BigInt(0)));
    return { id: product.id, physicalDate: product.placedAt, postingSequence: product.postingSequence, establishedDryBiocharKg: kilograms(established),
      ingredientDrySolidsKg: kilograms(ingredientGrams),
      remainingSolidsKg: subtract(rational(established + ingredientGrams, GRAMS_PER_KG), consumedSolidsKg),
      remainingDryBiocharKg: kilograms(established - uniqueEffects.reduce((sum, e) => sum + gramsSigned(e.dryMassKg), BigInt(0))), runs };
  });
  // A pure closure plan validates all layer/run invariants without persisting effects.
  const validated = planOutputStock(layers, input.physicalDate, { kind: 'count', wetKg: 0 });
  return { layers, expectedSolidsKg: validated.expectedSolidsKg,
    remainingDryKg: kilograms(layers.filter(l => l.physicalDate <= input.physicalDate).reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0))) };
}

function gramsSigned(value: string): bigint {
  return value.startsWith('-') ? -grams(value.slice(1)) : grams(value);
}

/** Completed production layers. Existing source snapshots remain facts; when a
 * product draw has ledger allocations its target ID prevents counting it twice.
 * Missing established dry mass/completion is unresolved, never inferred from wet stock.
 */
export async function getBiocharOutputStockLayers(ctx: OrgContext, input: { storageLocationId: string; facilityId: string; physicalDate: string }, reader: Reader = db, options: ReadOptions = {}) {
  requireOrgScope(ctx);
  const [bin] = await reader.select({ id: storageLocations.id }).from(storageLocations).where(and(
    eq(storageLocations.id, input.storageLocationId), eq(storageLocations.organizationId, ctx.organizationId),
    eq(storageLocations.facilityId, input.facilityId), eq(storageLocations.type, 'biochar_bin'), options.includeArchived ? undefined : isNull(storageLocations.archivedAt)));
  if (!bin) throw new SafeError('Biochar bin not found or archived');
  const runs = await reader.select({ id: productionRuns.id, physicalDate: sql<string | null>`${productionRuns.endTime}::date::text`,
    dryKg: sql<string | null>`${productionRuns.biocharDryMassKg}::text`, postingSequence: productionRuns.stockPostingSequence })
    .from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.facilityId, input.facilityId),
      eq(productionRuns.biocharStorageLocationId, input.storageLocationId), eq(productionRuns.status, COMPLETED_PRODUCTION_RUN_STATUS), options.includeArchived ? undefined : isNull(productionRuns.archivedAt)));
  const sources = await reader.select({ productId: biocharProductSourceAllocations.biocharProductId, runId: biocharProductSourceAllocations.productionRunId,
    dryKg: sql<string>`${biocharProductSourceAllocations.allocatedDryMassKg}::text` }).from(biocharProductSourceAllocations)
    .where(and(eq(biocharProductSourceAllocations.organizationId, ctx.organizationId), eq(biocharProductSourceAllocations.sourceStorageLocationId, input.storageLocationId)));
  const projections = await getOutputStockAllocationProjection(ctx, { sourceStorageLocationId: input.storageLocationId }, reader);
  const effects = [...new Map(projections.map(p => [p.allocation.id, p.allocation])).values()];
  const postedProducts = new Set(effects.flatMap(e => e.targetBiocharProductId ? [e.targetBiocharProductId] : []));
  const layers: OutputStockLayer[] = runs.filter(run => {
    if (run.id !== options.excludeUnresolvedRunId) return true;
    if (run.physicalDate && run.dryKg != null && Number.isFinite(Number(run.dryKg)) && Number(run.dryKg) > 0) throw new SafeError('Only unresolved production stock can be excluded for repair');
    if (sources.some(source => source.runId === run.id) || projections.some(effect => effect.run?.productionRunId === run.id || effect.allocation.productionRunId === run.id)) {
      throw new SafeError('Production stock has downstream allocations and cannot be excluded for repair');
    }
    return false;
  }).map(run => {
    if (!run.physicalDate || run.dryKg == null || !Number.isFinite(Number(run.dryKg)) || Number(run.dryKg) <= 0) throw new UnresolvedOutputStockError('Production dry mass or completion date is unresolved. Complete the production run mass and date.');
    const sourceDraw = sources.filter(s => s.runId === run.id && !postedProducts.has(s.productId)).reduce((sum, s) => sum + grams(s.dryKg), BigInt(0));
    const runEffects = effects.filter(e => e.productionRunId === run.id);
    const ledgerDraw = runEffects.reduce((sum, e) => sum + gramsSigned(e.dryMassKg), BigInt(0));
    const consumedSolidsKg = runEffects.reduce((sum, effect) => add(sum, readRational(effect.basisSnapshot.solidsKg)), rational(sourceDraw, GRAMS_PER_KG));
    const remainingDryBiocharKg = kilograms(grams(run.dryKg) - sourceDraw - ledgerDraw);
    return { id: run.id, physicalDate: run.physicalDate, postingSequence: run.postingSequence, establishedDryBiocharKg: run.dryKg,
      ingredientDrySolidsKg: '0.000', remainingDryBiocharKg,
      remainingSolidsKg: subtract(rational(grams(run.dryKg), GRAMS_PER_KG), consumedSolidsKg),
      runs: [{ productionRunId: run.id, establishedDryKg: run.dryKg, remainingDryKg: remainingDryBiocharKg }] };
  });
  const validated = planOutputStock(layers, input.physicalDate, { kind: 'count', wetKg: 0 });
  return { layers, expectedSolidsKg: validated.expectedSolidsKg,
    remainingDryKg: kilograms(layers.filter(l => l.physicalDate <= input.physicalDate).reduce((sum, l) => sum + grams(l.remainingDryBiocharKg), BigInt(0))) };
}

/** Authoritative dry balance for existing stock summaries and archive guards. */
export async function getOutputBinDryBalance(ctx: OrgContext, storageLocationId: string, reader: Reader = db, options: ReadOptions = {}): Promise<number> {
  requireOrgScope(ctx);
  const [bin] = await reader.select({ facilityId: storageLocations.facilityId, type: storageLocations.type }).from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found');
  const input = { storageLocationId, facilityId: bin.facilityId, physicalDate: new Date().toISOString().slice(0, 10) };
  const state = bin.type === 'product_bin' ? await getProductOutputStockLayers(ctx, input, reader, options) : await getBiocharOutputStockLayers(ctx, input, reader, options);
  return Number(state.remainingDryKg);
}

/** Wet estimates retain each layer's creation basis; shipment moisture never edits it. */
export async function getOutputBinStockView(ctx: OrgContext, storageLocationId: string, reader: Reader = db) {
  requireOrgScope(ctx);
  const [bin] = await reader.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, storageLocationId)));
  if (!bin) throw new SafeError('Storage bin not found');
  const input = { storageLocationId, facilityId: bin.facilityId, physicalDate: new Date().toISOString().slice(0, 10) };
  let state;
  try {
    state = bin.type === 'product_bin' ? await getProductOutputStockLayers(ctx, input, reader, { includeArchived: bin.archivedAt != null }) : await getBiocharOutputStockLayers(ctx, input, reader, { includeArchived: bin.archivedAt != null });
  } catch (error) {
    if (!(error instanceof UnresolvedOutputStockError)) throw error;
    return { dryMassKg: null, recordedWetMassKg: null, estimatedWetMassKg: null };
  }
  const wetRows = bin.type === 'product_bin'
    ? await reader.select({ id: biocharProducts.id, wet: sql<number>`coalesce(${biocharProducts.massKg}, 0) + coalesce(${biocharProducts.waterAddedKg}, 0)`.mapWith(Number) }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, storageLocationId)))
    : await reader.select({ id: productionRuns.id, wet: productionRuns.biocharOutputKg }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, storageLocationId)));
  const eligible = state.layers.filter(l => l.physicalDate <= input.physicalDate);
  const recordedWetMassKg = eligible.reduce((sum, l) => sum + Number(wetRows.find(r => r.id === l.id)?.wet ?? 0), 0);
  const estimatedWetMassKg = eligible.reduce((sum, l) => {
    const establishedSolids = Number(l.establishedDryBiocharKg) + Number(l.ingredientDrySolidsKg);
    const solids = l.remainingSolidsKg!;
    return sum + Number(wetRows.find(r => r.id === l.id)?.wet ?? 0) * (Number(solids.numerator) / Number(solids.denominator)) / establishedSolids;
  }, 0);
  return { dryMassKg: Number(state.remainingDryKg), recordedWetMassKg, estimatedWetMassKg };
}
