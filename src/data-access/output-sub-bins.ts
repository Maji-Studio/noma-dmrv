import type { DbTransaction } from '@/db';
import { feedstockTypes, formulationIngredients, productIngredientSnapshots, storageLocations } from '@/db/schema';
import { SUB_BIN_RECENT_MOVEMENTS } from '@/config/output-stock';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { rationalToNumber } from '@/lib/output-stock';
import { splitIngredientSolids, type SavedIngredientSolids } from '@/lib/output-stock/sub-bin-ingredients';
import { subBinMovements } from '@/lib/output-stock/sub-bin-movements';
import { outputSubBinsSchema } from '@/schemas/output-stock';
import { isOutputBinType } from '@/schemas/storage-locations';
import type { OutputSubBins, OutputSubBinsInput } from '@/types/output-stock';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { readOutputBinStockAt, withStockSnapshot } from './output-bin-stock';
import { prepareOutputCorrection } from './output-stock-corrections';
import { getOutputStockHistory } from './output-stock-history';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

/**
 * The ingredient lines each product saved when it was created, by material
 * name and in formulation order. Snapshots never change, so the read needs no
 * time filter; a biochar bin's layers are runs and have none.
 */
async function savedIngredientSolids(ctx: OrgContext, productIds: readonly string[], tx: Reader): Promise<Map<string, SavedIngredientSolids[]>> {
  const byProduct = new Map<string, SavedIngredientSolids[]>();
  if (!productIds.length) return byProduct;
  const rows = await tx.select({ productId: productIngredientSnapshots.biocharProductId, name: feedstockTypes.name, drySolidsKg: productIngredientSnapshots.drySolidsKg })
    .from(productIngredientSnapshots)
    .innerJoin(formulationIngredients, and(eq(formulationIngredients.id, productIngredientSnapshots.formulationIngredientId), eq(formulationIngredients.organizationId, ctx.organizationId)))
    .innerJoin(feedstockTypes, and(eq(feedstockTypes.id, formulationIngredients.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .where(and(eq(productIngredientSnapshots.organizationId, ctx.organizationId), inArray(productIngredientSnapshots.biocharProductId, [...productIds])))
    .orderBy(asc(productIngredientSnapshots.biocharProductId), asc(formulationIngredients.sortOrder), asc(formulationIngredients.id));
  for (const row of rows) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), { name: row.name, drySolidsKg: Number(row.drySolidsKg) }]);
  return byProduct;
}

/**
 * The sub-bins a bin holds at `occurredAt` (now when omitted), in the bin's default draw order, with the bin's mode then, each with its
 * own moisture estimate and latest movements. A correction reads them as they
 * were before the entry it replaces, so the operator can re-choose them. When
 * the correction itself is refused, the bin's current sub-bins still show: the
 * preview carries the refusal. Stock and movements come from one snapshot, the
 * same projection the API stock read uses; a mix bin's batches carry no wet
 * mass or moisture of their own.
 */
export async function getOutputSubBins(ctx: OrgContext, raw: OutputSubBinsInput, tx?: DbTransaction): Promise<OutputSubBins> {
  requireOrgScope(ctx);
  const input = outputSubBinsSchema.parse(raw);
  if (!tx) return withStockSnapshot(snapshot => getOutputSubBins(ctx, input, snapshot));
  const [bin] = await tx.select().from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, input.storageLocationId),
    eq(storageLocations.facilityId, input.facilityId), isNull(storageLocations.archivedAt)));
  if (!bin || !isOutputBinType(bin.type)) throw new SafeError('Output bin not found or archived');
  // The lookup fixed the snapshot, so "now" taken here never leaves out a batch the snapshot shows.
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const correction = input.correctsMovementId && input.kind ? { ...input, occurredAt, kind: input.kind, wetMassKg: 0 } : null;
  const { stock, unresolved } = await readOutputBinStockAt(ctx, { ...bin, type: bin.type }, occurredAt, tx, {
    includeArchived: false, ignoreMovementId: input.correctsMovementId,
    adjustLayers: correction ? async layers => {
      try {
        return (await prepareOutputCorrection(ctx, correction, layers, tx)).layers;
      } catch (error) {
        if (!(error instanceof SafeError)) throw error;
        return layers;
      }
    } : undefined,
  });
  if (unresolved) throw unresolved;
  const history = await getOutputStockHistory(ctx, bin.id, tx);
  // A product bin's layers are its products, so each layer's ingredients are that product's saved lines.
  const ingredients = bin.type === 'product_bin' ? await savedIngredientSolids(ctx, stock.subBins.map(subBin => subBin.layerId), tx) : new Map<string, SavedIngredientSolids[]>();
  // A split bin lists its sub-bins in its default draw order; the API stock read stays oldest first.
  const subBins = stock.stockMode === 'split' && bin.drawOrder === 'newest_first' ? [...stock.subBins].reverse() : stock.subBins;
  return {
    drawOrder: bin.drawOrder,
    // A merged bin was split before its merge, so a draw timed then still picks sub-bins.
    stockMode: stock.stockMode,
    subBins: subBins.map(subBin => ({
      layerId: subBin.layerId, code: subBin.code ?? subBin.layerId, placedAt: subBin.placedAt,
      dryMassKg: rationalToNumber(subBin.dryBiocharKg), solidsKg: rationalToNumber(subBin.solidsKg),
      ingredients: splitIngredientSolids(rationalToNumber(subBin.solidsKg) - rationalToNumber(subBin.dryBiocharKg), ingredients.get(subBin.layerId) ?? []),
      wetEstimateKg: subBin.estimatedWetKg ? rationalToNumber(subBin.estimatedWetKg) : null,
      moisturePercent: subBin.estimatedMoisturePercent ? rationalToNumber(subBin.estimatedMoisturePercent) : null,
      basis: subBin.moistureBasis,
      recentMovements: subBinMovements(history, subBin.layerId, SUB_BIN_RECENT_MOVEMENTS),
    })),
  };
}
