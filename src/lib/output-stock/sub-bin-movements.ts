import type { OutputStockHistoryEntry, SubBinMovement } from '@/types/output-stock';

const MOVEMENT_KINDS: Record<string, SubBinMovement['kind']> = {
  intake: 'added', delivery: 'removed', production_draw: 'removed', product_draw: 'removed', loss: 'loss', count: 'count',
};

/**
 * One sub-bin's latest movements from the bin's history, newest first. An
 * entry a correction replaced is left out along with its reversal, so the list
 * shows what stands; the replacement shows under the original's kind.
 */
export function subBinMovements(history: readonly OutputStockHistoryEntry[], layerId: string, limit: number): SubBinMovement[] {
  const replaced = new Set(history.flatMap(entry => entry.correctsMovementId ? [entry.correctsMovementId] : []));
  return history.flatMap(entry => {
    const kind = MOVEMENT_KINDS[entry.kind === 'replacement' ? entry.eventKind ?? '' : entry.kind];
    const allocation = entry.allocations.find(a => a.layerId === layerId);
    if (!kind || !allocation || replaced.has(entry.id)) return [];
    return [{ id: entry.id, kind, occurredAt: entry.occurredAt, wetMassKg: allocation.wetMassKg, dryMassKg: allocation.dryMassKg }];
  }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit);
}
