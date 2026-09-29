import { describe, expect, it } from 'vitest';
import type { OutputStockHistoryEntry } from '@/types/output-stock';
import { subBinMovements } from './sub-bin-movements';

function entry(id: string, kind: string, occurredAt: string, layers: string[], extra: Partial<OutputStockHistoryEntry> = {}): OutputStockHistoryEntry {
  return { id, kind, occurredAt, recordedAt: occurredAt, actorName: null, reason: '', wetMassKg: null, moisturePercent: null, dryMassKg: 0, beforeDryKg: 0, afterDryKg: 0,
    correctsMovementId: null, deliveryId: null, allocations: layers.map(layerId => ({ layerId, code: layerId, wetMassKg: 100, dryMassKg: 60, runs: [] })), ...extra };
}

describe('subBinMovements', () => {
  const history = [
    entry('in-a', 'intake', '2026-09-19T11:10:00.000Z', ['a']),
    entry('in-b', 'intake', '2026-09-20T08:00:00.000Z', ['b']),
    entry('loss', 'loss', '2026-09-22T13:30:00.000Z', ['a'], { eventKind: 'loss' }),
    entry('del', 'delivery', '2026-09-24T08:00:00.000Z', ['a', 'b'], { eventKind: 'delivery' }),
    entry('count', 'count', '2026-09-25T08:00:00.000Z', ['a'], { eventKind: 'count' }),
  ];

  it('lists the sub-bin movements newest first, worded for the operator', () => {
    expect(subBinMovements(history, 'a', 3).map(m => [m.id, m.kind])).toEqual([['count', 'count'], ['del', 'removed'], ['loss', 'loss']]);
    expect(subBinMovements(history, 'b', 3).map(m => [m.id, m.kind])).toEqual([['del', 'removed'], ['in-b', 'added']]);
  });

  it('shows a correction once, under the kind it corrects, and drops the reversal', () => {
    const corrected = [...history,
      entry('rev', 'reversal', '2026-09-22T13:30:00.000Z', ['a']),
      entry('rep', 'replacement', '2026-09-22T13:30:00.000Z', ['a'], { eventKind: 'loss', correctsMovementId: 'loss' })];
    expect(subBinMovements(corrected, 'a', 5).map(m => [m.id, m.kind])).toEqual([['count', 'count'], ['del', 'removed'], ['rep', 'loss'], ['in-a', 'added']]);
  });

  it('skips moisture rows, which move no stock', () => {
    expect(subBinMovements([entry('m', 'moisture_update', '2026-09-26T08:00:00.000Z', ['a'])], 'a', 3)).toEqual([]);
  });
});
