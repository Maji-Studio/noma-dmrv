import type { DbTransaction } from '@/db';
import { outputStockMoistureReadings } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { withFeedstockErrors } from '@/lib/feedstock-domain-errors';
import { and, eq } from 'drizzle-orm';
import { assertCanMutateCertifiedLineage, type CertifiedLineageTarget } from './certification-lineage-guards';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

/** What a planned posting changes, as `prepareOutputStock` returns it. */
export interface PlannedOutputChange {
  lane: 'biochar' | 'product';
  layers: readonly { id: string }[];
  plan: { allocations: readonly { layerId: string }[] } | null;
  readings: readonly { layerId: string }[];
  correction: { original: { id: string }; allocations: readonly { biocharProductId: string | null; productionRunId: string | null }[] } | null;
}

/**
 * Every layer whose stock or moisture a posting changes (decision 51): the
 * layers it draws from, the layers a correction restores, the layers a
 * count's readings reset, and the layers whose original readings a correction
 * removes even when its replacement records none. Ordered as the bin lists
 * its layers, then any layer no longer listed, so callers keep one lock order.
 */
export async function changedOutputLayerIds(ctx: OrgContext, reader: Reader, prepared: PlannedOutputChange): Promise<string[]> {
  requireOrgScope(ctx);
  const changed = new Set<string>([
    ...(prepared.plan?.allocations.map(a => a.layerId) ?? []),
    ...(prepared.correction?.allocations.flatMap(a => a.biocharProductId ?? a.productionRunId ?? []) ?? []),
    ...prepared.readings.map(r => r.layerId),
  ]);
  if (prepared.correction) {
    const original = await reader.select({ biocharProductId: outputStockMoistureReadings.biocharProductId, productionRunId: outputStockMoistureReadings.productionRunId })
      .from(outputStockMoistureReadings)
      .where(and(eq(outputStockMoistureReadings.organizationId, ctx.organizationId), eq(outputStockMoistureReadings.movementId, prepared.correction.original.id)));
    for (const reading of original) {
      const layerId = prepared.lane === 'product' ? reading.biocharProductId : reading.productionRunId;
      if (layerId) changed.add(layerId);
    }
  }
  const listed = prepared.layers.map(l => l.id).filter(id => changed.has(id));
  const unlisted = [...changed].filter(id => !listed.includes(id)).sort();
  return [...listed, ...unlisted];
}

/** The certification-lineage target a layer of this lane stands for. */
export function outputLayerTarget(lane: PlannedOutputChange['lane'], layerId: string): CertifiedLineageTarget {
  return { entityType: lane === 'product' ? 'biocharProduct' : 'productionRun', entityId: layerId };
}

/**
 * Refuses the posting with `certification_locked` when any changed layer
 * belongs to submitted certification lineage. Runs before any write and
 * before product rows are locked, in the order `changedOutputLayerIds` gives.
 */
export async function assertOutputLayersMutable(ctx: OrgContext, tx: DbTransaction, lane: PlannedOutputChange['lane'], layerIds: readonly string[]) {
  requireOrgScope(ctx);
  for (const layerId of layerIds) {
    await withFeedstockErrors(() => assertCanMutateCertifiedLineage(ctx, tx, outputLayerTarget(lane, layerId), 'update'), 'certification_locked');
  }
}
