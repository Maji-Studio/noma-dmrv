import { db, type DbTransaction } from '@/db';
import { storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { conflictCode } from '@/lib/conflict-ref';
import { STOCK_CONFLICT_ENTITY } from '@/lib/stock-conflict-entities';
import { ActionConflictError, SafeError } from '@/lib/errors';
import type { BiocharProductFormData } from '@/schemas/biochar-products';
import type { AffectedStockPreview } from '@/types/output-stock';
import { and, eq, isNull } from 'drizzle-orm';
import { resolveCompositionIngredientMassBasis } from './biochar-product-composition';
import { getIngredientStockBasis } from './ingredient-moisture-basis';
import { prepareOutputStock, stockFingerprint } from './output-stock-operations';
import { requireOrgScope } from './utils';

const PERCENT_SCALE = 100;
const STOCK_CHANGED_MESSAGE = 'Stock changed since this preview. Refresh the preview and try again.';
export type ProductStockPreviewInput = Pick<BiocharProductFormData, 'facilityId' | 'formulationId' | 'placedAt' | 'sourceBiocharStorageLocationId' | 'storageLocationId' | 'massKg' | 'moistureContentPercent' | 'waterAddedKg'> & { ingredientBins?: Record<string, unknown>[] };

/** Read-only projection. Product creation still revalidates every stock draw under locks. */
export async function previewProductStock(ctx: OrgContext, input: ProductStockPreviewInput): Promise<AffectedStockPreview[]> {
  requireOrgScope(ctx);
  return db.transaction(async tx => (await prepareProductStock(ctx, input, tx)).bins);
}

/** The same request projection is recomputed under all bin locks before writes. */
export async function prepareProductStock(ctx: OrgContext, input: ProductStockPreviewInput, tx: DbTransaction) {
    requireOrgScope(ctx);
    const base = { facilityId: input.facilityId, physicalDate: input.placedAt };
    const source = await prepareOutputStock(ctx, { ...base, storageLocationId: input.sourceBiocharStorageLocationId, kind: 'production_draw', wetMassKg: input.massKg, moisturePercent: input.moistureContentPercent }, tx);
    const composition = await resolveCompositionIngredientMassBasis(ctx, tx, { ingredients: input.ingredientBins ?? [] }, undefined, undefined, input.placedAt);
    const ingredients = composition.ingredients as { formulationIngredientId: string; feedstockTypeId: string; storageLocationId?: string | null; massKg: number; massDryKg: number; moistureContentPercent: number | null; moistureSource: string; moistureSourceSnapshot?: unknown }[];
    const bins: AffectedStockPreview[] = [source.preview];
    const draws = new Map<string, number>();
    for (const ingredient of ingredients) if (ingredient.storageLocationId && ingredient.massKg > 0) draws.set(ingredient.storageLocationId, (draws.get(ingredient.storageLocationId) ?? 0) + ingredient.massKg);
    for (const [id, wetDraw] of draws) {
      const [bin] = await tx.select().from(storageLocations).where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.facilityId, input.facilityId), eq(storageLocations.id, id), eq(storageLocations.type, 'feedstock_bin'), isNull(storageLocations.archivedAt)));
      if (!bin) throw new SafeError('Ingredient bin not found or archived');
      const stock = await getIngredientStockBasis(ctx, id, input.placedAt, tx);
      if (!stock) throw new SafeError('Ingredient stock not found.');
      const beforeWet = stock.wetMassKg;
      const beforeDry = stock.dryMassKg;
      // Ingredient stock is withdrawn pro rata; an override describes the material
      // mixed into the product, not a new measurement of the remaining bin.
      const dryDraw = beforeDry === null ? null : beforeWet > 0 ? beforeDry * wetDraw / beforeWet : 0;
      const afterDry = beforeDry === null || dryDraw === null ? null : beforeDry - dryDraw;
      const allocation = (wet: number, dry: number | null) => [{ layerId: id, code: bin.code, wetMassKg: wet, dryMassKg: dry, runs: [] }];
      bins.push({ ...source.preview, storageLocationId: id, binCode: bin.code, binName: bin.name, formulationName: null, lane: 'ingredient', dryLabel: 'dry solids', wetLabel: 'wet stock',
        beforeDryKg: beforeDry, afterDryKg: afterDry, beforeSolidsKg: beforeDry, afterSolidsKg: afterDry,
        beforeEstimatedWetKg: beforeWet, afterEstimatedWetKg: beforeWet - wetDraw, removedDryKg: dryDraw, removedWetKg: wetDraw,
        estimateMoisturePercent: beforeWet > 0 && beforeDry !== null ? (1 - beforeDry / beforeWet) * PERCENT_SCALE : null,
        allocations: [], beforeAllocations: allocation(beforeWet, beforeDry), afterAllocations: allocation(beforeWet - wetDraw, afterDry),
        blockingMessage: wetDraw > beforeWet ? 'Ingredient withdrawal exceeds available wet stock.' : null, discrepancySolidsKg: 0 });
    }
    const wetAdded = input.massKg + input.waterAddedKg + ingredients.reduce((sum, ingredient) => sum + ingredient.massKg, 0);
    const solidsAdded = source.preview.removedDryKg + ingredients.reduce((sum, ingredient) => sum + (ingredient.massKg > 0 ? ingredient.massDryKg : 0), 0);
    const moisture = (1 - solidsAdded / wetAdded) * PERCENT_SCALE;
    const destination = await prepareOutputStock(ctx, { ...base, storageLocationId: input.storageLocationId, kind: 'count', wetMassKg: 0, moisturePercent: 0 }, tx);
    if (destination.lane !== 'product' || destination.bin.formulationId && destination.bin.formulationId !== input.formulationId) throw new SafeError('Choose a product bin matching the formulation.');
    const before = destination.preview;
    // A derived blend fraction is not a stored operator measurement. Read the
    // zero-moisture solids view, then estimate wet mass without rounding the basis.
    const solidsFraction = solidsAdded / wetAdded;
    const beforeWet = solidsFraction > 0 ? before.beforeSolidsKg / solidsFraction : null;
    const beforeAllocations = before.beforeAllocations?.map(layer => ({ ...layer,
      wetMassKg: solidsFraction > 0 && layer.wetMassKg !== null ? layer.wetMassKg / solidsFraction : null,
    }));
    const added = { layerId: 'proposed-product', code: 'New product', wetMassKg: wetAdded, dryMassKg: source.preview.removedDryKg, runs: source.preview.allocations.flatMap(a => a.runs) };
    bins.push({ ...before, estimateMoisturePercent: moisture, beforeEstimatedWetKg: beforeWet, beforeAllocations, afterDryKg: before.beforeDryKg + source.preview.removedDryKg, afterSolidsKg: before.beforeSolidsKg + solidsAdded,
      afterEstimatedWetKg: beforeWet === null ? null : beforeWet + wetAdded,
      afterAllocations: [...(beforeAllocations ?? []), added], allocations: [added], removedDryKg: -source.preview.removedDryKg,
      removedWetKg: -wetAdded, discrepancySolidsKg: 0, blockingMessage: source.preview.blockingMessage });
    const basisFingerprint = stockFingerprint({
      request: {
        facilityId: input.facilityId, formulationId: input.formulationId, physicalDate: input.placedAt,
        sourceStorageLocationId: input.sourceBiocharStorageLocationId, destinationStorageLocationId: input.storageLocationId,
        wetMassKg: input.massKg, moisturePercent: input.moistureContentPercent, waterAddedKg: input.waterAddedKg,
        ingredients: ingredients.map(ingredient => ({
          formulationIngredientId: ingredient.formulationIngredientId, feedstockTypeId: ingredient.feedstockTypeId,
          storageLocationId: ingredient.storageLocationId ?? null, massKg: ingredient.massKg,
          massDryKg: ingredient.massDryKg, moisturePercent: ingredient.moistureContentPercent,
          moistureSource: ingredient.moistureSource, basis: ingredient.moistureSourceSnapshot ?? null,
        })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      },
      source: source.preview.basisFingerprint,
      destination: destination.preview.basisFingerprint,
      ingredientBins: bins.filter(bin => bin.lane === 'ingredient').map(bin => ({
        storageLocationId: bin.storageLocationId, wetMassKg: bin.beforeEstimatedWetKg, dryMassKg: bin.beforeDryKg,
      })).sort((a, b) => a.storageLocationId.localeCompare(b.storageLocationId)),
    });
    return { bins: bins.map(bin => ({ ...bin, basisFingerprint })), composition, source, basisFingerprint };
}

export function assertProductStockBasis(expected: string, prepared: Awaited<ReturnType<typeof prepareProductStock>>) {
  if (expected !== prepared.basisFingerprint) throw new ActionConflictError(
    STOCK_CHANGED_MESSAGE,
    { entity: STOCK_CONFLICT_ENTITY.storageLocation, id: prepared.source.bin.id, code: conflictCode(prepared.source.bin.code) },
  );
}

/** A previously previewable request becoming unavailable is also a refresh conflict. */
export async function revalidateProductStock(ctx: OrgContext, input: ProductStockPreviewInput, tx: DbTransaction, expectedFingerprint: string) {
  requireOrgScope(ctx);
  try {
    const prepared = await prepareProductStock(ctx, input, tx);
    assertProductStockBasis(expectedFingerprint, prepared);
    return prepared;
  } catch (error) {
    if (!(error instanceof SafeError) || error instanceof ActionConflictError) throw error;
    // The bin is the refresh target; when it no longer exists the original
    // refusal is the honest answer.
    const [bin] = await tx.select({ code: storageLocations.code }).from(storageLocations)
      .where(and(eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, input.storageLocationId)));
    if (!bin) throw error;
    throw new ActionConflictError(STOCK_CHANGED_MESSAGE,
      { entity: STOCK_CONFLICT_ENTITY.storageLocation, id: input.storageLocationId, code: conflictCode(bin.code) });
  }
}
