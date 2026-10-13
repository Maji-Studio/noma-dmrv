import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import type { OutputBinStock } from '@/lib/output-stock/bin-stock-projection';
import { isOutputBinType } from '@/schemas/storage-locations';
import type { ApiLookupIdentifier } from './api-lookup-filters';
import { requireApiOutputBin } from './api-output-stock-movements';
import { readOutputBinStockAt, withStockSnapshot } from './output-bin-stock';
import { requireOrgScope } from './utils';

export interface ApiOutputBinStockInput {
  identifier: ApiLookupIdentifier;
  /** Narrows the lookup as `?facilityId=` does on the storage-location read. */
  facilityId?: string;
}

/** The API publishes codes, never ids in their place: a held layer without one is a projection bug. */
function requireLayerCodes(stock: OutputBinStock<string | null>): OutputBinStock {
  if (stock.status === 'unresolved') return stock;
  return { ...stock, subBins: stock.subBins.map(subBin => {
    if (subBin.code === null) throw new Error(`Output bin ${stock.bin.storageLocationId} layer ${subBin.layerId} has no code`);
    return { ...subBin, code: subBin.code };
  }) };
}

/**
 * What one biochar or product bin holds now, as one snapshot from the bin
 * lookup on. Archived bins answer with their archived layers; a foreign or
 * unknown bin is not found and a feedstock bin is refused, as the movement
 * history read does. Unresolved stock is an answer, not a failure; any other
 * broken invariant propagates.
 *
 * Without `tx` the read opens its own snapshot. A caller passing `tx` must
 * pass a repeatable-read transaction that has not run a statement yet, so the
 * lookup here fixes its snapshot.
 */
export async function readApiOutputBinStock(ctx: OrgContext, input: ApiOutputBinStockInput, tx?: DbTransaction): Promise<OutputBinStock> {
  requireOrgScope(ctx);
  if (!tx) return withStockSnapshot(snapshot => readApiOutputBinStock(ctx, input, snapshot));
  const bin = await requireApiOutputBin(ctx, input.identifier, { facilityId: input.facilityId, executor: tx });
  if (!isOutputBinType(bin.type)) throw new Error(`Storage location ${bin.id} is not an output bin`);
  // The lookup fixed the snapshot, so nothing it shows was placed after this instant.
  const at = new Date().toISOString();
  const { stock } = await readOutputBinStockAt(ctx, { ...bin, type: bin.type }, at, tx, { includeArchived: bin.archivedAt != null });
  return requireLayerCodes(stock);
}
