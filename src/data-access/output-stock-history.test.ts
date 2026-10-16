import { beforeEach, expect, it, vi } from 'vitest';
import { binMovements, outputStockAllocations, storageLocations } from '@/db/schema';
import { getOutputStockHistory } from './output-stock-history';

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('./output-stock-edit-lock', () => ({ outputMovementLockReason: async () => null }));
vi.mock('@/db', () => ({ db: { select: mocks.select } }));
const ctx = { organizationId: 'org', userId: 'user', orgRole: 'owner' as const, isPlatformAdmin: false };
const LAYER_A = '00000000-0000-4000-8000-00000000000a';
const LAYER_B = '00000000-0000-4000-8000-00000000000b';
const time = '2026-09-14T12:00:00.000Z';

beforeEach(() => vi.clearAllMocks());

function historyRows(policy: string, placedAt: string[], sequences: string[], savedSources?: { layerId: string; moisturePercent: number }[]) {
  const movement = { id: 'movement', outputKind: 'loss', inputSnapshot: { kind: 'loss', sources: savedSources },
    occurredAt: new Date(time), createdAt: new Date(time), postingSequence: BigInt(3),
    outputDryDeltaKg: '-150', balanceBeforeDryKg: '200', balanceAfterDryKg: '50', correctsMovementId: null };
  // The projection orders these UUIDs A then B. Their placement facts oppose that order.
  const allocations = [LAYER_A, LAYER_B].map((layerId, index) => ({ movement, run: null, allocation: {
    id: layerId, productionRunId: layerId, biocharProductId: null, dryMassKg: '75', wetMassKg: '100',
    basisSnapshot: { policy, placedAt: placedAt[index], postingSequence: sequences[index], readingPercent: '25' },
  } }));
  const rows = new Map<unknown, unknown[]>([
    [storageLocations, [{ id: 'bin', type: 'biochar_bin', facilityId: 'facility' }]],
    [binMovements, [{ movement, actorName: null }]], [outputStockAllocations, allocations],
  ]);
  mocks.select.mockImplementation(() => {
    let table: unknown;
    const query = { from: (value: unknown) => { table = value; return query; },
      leftJoin: () => query, innerJoin: () => query, where: () => query, orderBy: () => query,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows.get(table) ?? []).then(resolve) };
    return query;
  });
}

it.each([
  ['fifo', ['2026-09-13', '2026-09-12'], ['1', '2']],
  ['fifo', ['2026-09-12', '2026-09-12'], ['10', '2']],
  ['lifo', ['2026-09-12', '2026-09-13'], ['2', '1']],
  ['lifo', ['2026-09-12', '2026-09-12'], ['2', '10']],
] as const)('rebuilds %s correction readings by placement and sequence, not allocation UUID', async (policy, dates, sequences) => {
  historyRows(policy, [...dates], [...sequences]);
  const history = await getOutputStockHistory(ctx, 'bin');
  expect(history[0].sources).toEqual([{ layerId: LAYER_B, moisturePercent: 25 }, { layerId: LAYER_A, moisturePercent: 25 }]);
});

it('keeps pro-rata draws without an ordered correction source list', async () => {
  historyRows('pro_rata', ['2026-09-12', '2026-09-13'], ['1', '2']);
  expect((await getOutputStockHistory(ctx, 'bin'))[0].sources).toBeUndefined();
});

it('keeps an explicit saved order even when placement and allocation order differ', async () => {
  const sources = [{ layerId: LAYER_A, moisturePercent: 20 }, { layerId: LAYER_B, moisturePercent: 30 }];
  historyRows('operator_order', ['2026-09-13', '2026-09-12'], ['1', '2'], sources);
  expect((await getOutputStockHistory(ctx, 'bin'))[0].sources).toEqual(sources);
});
