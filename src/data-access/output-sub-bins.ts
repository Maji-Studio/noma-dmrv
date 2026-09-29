import { db } from '@/db';
import { biocharProducts, productionRuns, storageLocations } from '@/db/schema';
import { SUB_BIN_RECENT_MOVEMENTS } from '@/config/output-stock';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';
import { rationalToNumber } from '@/lib/output-stock';
import { estimateStock } from '@/lib/output-stock/moisture-estimate';
import { subBinMovements } from '@/lib/output-stock/sub-bin-movements';
import { outputSubBinsSchema } from '@/schemas/output-stock';
import type { OutputSubBins, OutputSubBinsInput } from '@/types/output-stock';
import { and, eq, isNull } from 'drizzle-orm';
import { getBiocharOutputStockLayers, getLayerMoistureBases, getProductOutputStockLayers } from './output-stock';
import { prepareOutputCorrection } from './output-stock-corrections';
import { getOutputStockHistory } from './output-stock-history';
import { requireOrgScope } from './utils';

/**
 * The sub-bins a split bin holds at `occurredAt`, oldest first, each with its
 * own moisture estimate and latest movements. A correction reads them as they
 * were before the entry it replaces, so the operator can re-choose them. When
 * the correction itself is refused, the bin's current sub-bins still show: the
 * preview carries the refusal.
 */
export async function getOutputSubBins(ctx: OrgContext, raw: OutputSubBinsInput): Promise<OutputSubBins> {
  requireOrgScope(ctx);
  const input = outputSubBinsSchema.parse(raw);
  const [bin] = await db.select().from(storageLocations).where(and(
    eq(storageLocations.organizationId, ctx.organizationId), eq(storageLocations.id, input.storageLocationId),
    eq(storageLocations.facilityId, input.facilityId), isNull(storageLocations.archivedAt)));
  if (!bin || !['biochar_bin', 'product_bin'].includes(bin.type)) throw new SafeError('Output bin not found or archived');
  const state = bin.type === 'biochar_bin' ? await getBiocharOutputStockLayers(ctx, input) : await getProductOutputStockLayers(ctx, input);
  let layers = state.layers;
  if (input.correctsMovementId && input.kind) {
    try {
      layers = (await prepareOutputCorrection(ctx, { ...input, kind: input.kind, wetMassKg: 0 }, state.layers, db)).layers;
    } catch (error) {
      if (!(error instanceof SafeError)) throw error;
    }
  }
  const bases = await getLayerMoistureBases(ctx, bin, layers, db, { ignoreMovementId: input.correctsMovementId });
  const codes = bin.type === 'product_bin'
    ? await db.select({ id: biocharProducts.id, code: biocharProducts.code }).from(biocharProducts).where(and(eq(biocharProducts.organizationId, ctx.organizationId), eq(biocharProducts.storageLocationId, bin.id)))
    : await db.select({ id: productionRuns.id, code: productionRuns.code }).from(productionRuns).where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.biocharStorageLocationId, bin.id)));
  const codeMap = new Map(codes.map(row => [row.id, row.code]));
  const history = await getOutputStockHistory(ctx, bin.id);
  const held = layers.filter(layer => layer.placedAt <= input.occurredAt && layer.remainingSolidsKg && layer.remainingSolidsKg.numerator > BigInt(0))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt) || (a.postingSequence < b.postingSequence ? -1 : a.postingSequence > b.postingSequence ? 1 : 0));
  return {
    stockMode: bin.stockMode,
    subBins: held.map(layer => {
      const basis = bases.find(b => b.layerId === layer.id);
      const estimate = basis ? estimateStock([basis], input.occurredAt) : null;
      return {
        layerId: layer.id, code: codeMap.get(layer.id) ?? layer.id, placedAt: layer.placedAt,
        dryMassKg: Number(layer.remainingDryBiocharKg), solidsKg: rationalToNumber(layer.remainingSolidsKg!),
        wetEstimateKg: estimate?.wetKg ?? null, moisturePercent: estimate?.moisturePercent ?? null, basis: estimate?.basis ?? null,
        recentMovements: subBinMovements(history, layer.id, SUB_BIN_RECENT_MOVEMENTS),
      };
    }),
  };
}
