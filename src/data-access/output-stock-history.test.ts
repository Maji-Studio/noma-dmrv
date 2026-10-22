import { beforeEach, expect, it, vi } from 'vitest';
import { binMovements, outputStockAllocations, productionRuns, storageLocations } from '@/db/schema';
import * as stock from './output-stock';
import { decimal } from '@/lib/output-stock/exact';
import { getOutputStockHistory } from './output-stock-history';

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('./output-stock-edit-lock', () => ({ outputMovementLockReason: async () => null, getOutputMovementCertificationLocks: async () => new Map() }));
vi.mock('@/db', () => ({ db: { select: mocks.select } }));
const ctx = { organizationId: 'org', userId: 'user', orgRole: 'admin' as const, isPlatformAdmin: false };
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
  return rows;
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

it('uses physical intake dry balances but returns recorded order', async () => {
  const rows = historyRows('fifo', ['2026-09-12', '2026-09-13'], ['1', '2']);
  rows.set(productionRuns, [
    { id: LAYER_A, code: 'A', status: 'complete', biocharStorageLocationId: 'bin',
      endTime: new Date('2026-09-10'), updatedAt: new Date('2026-09-10'), biocharOutputKg: 200, biocharDryMassKg: 200, biocharMoisturePercent: 0 },
    { id: LAYER_B, code: 'B', status: 'complete', biocharStorageLocationId: 'bin',
      endTime: new Date('2026-09-13'), updatedAt: new Date('2026-09-17'), biocharOutputKg: 50, biocharDryMassKg: 50, biocharMoisturePercent: 0 },
  ]);
  vi.spyOn(stock, 'readOutputBinAllLayers').mockResolvedValue({ layers: [], allLayersDryKg: '0.000', availableDryKg: '0.000', expectedSolidsKg: decimal('0') });
  vi.spyOn(stock, 'getLayerMoistureBases').mockResolvedValue([]);
  const history = await getOutputStockHistory(ctx, 'bin');
  expect(history.map(entry => entry.id)).toEqual([LAYER_A, 'movement', LAYER_B]);
  expect(history.find(entry => entry.id === LAYER_B)).toMatchObject({ beforeDryKg: 200, afterDryKg: 250 });
  expect(history.find(entry => entry.id === 'movement')).toMatchObject({ beforeDryKg: 200, afterDryKg: 50 });
});

it.each([true, false])('recomputes wet changes with a saved wet preview: %s', async (hasSavedWet) => {
  const rows = historyRows('pro_rata', ['2026-09-12', '2026-09-13'], ['1', '2']);
  rows.set(binMovements, [{ actorName: null, movement: {
    id: 'movement', outputKind: 'loss', occurredAt: new Date(time), createdAt: new Date(time), postingSequence: BigInt(3),
    outputDryDeltaKg: '-25', balanceBeforeDryKg: '80', balanceAfterDryKg: '55', correctsMovementId: null,
    inputSnapshot: { kind: 'loss', preview: { beforeEstimatedWetKg: hasSavedWet ? 100 : null, afterEstimatedWetKg: hasSavedWet ? 110 : null, beforeSolidsKg: 80, afterSolidsKg: 55 } },
  } }]);
  rows.set(productionRuns, [{ id: LAYER_B, code: 'B', status: 'complete', biocharStorageLocationId: 'bin',
    endTime: new Date('2026-09-13'), updatedAt: new Date('2026-09-17'), biocharOutputKg: 200, biocharDryMassKg: 80, biocharMoisturePercent: 60 }]);
  vi.spyOn(stock, 'readOutputBinAllLayers').mockResolvedValue({ layers: [], allLayersDryKg: '0.000', availableDryKg: '0.000', expectedSolidsKg: decimal('0') });
  vi.spyOn(stock, 'getLayerMoistureBases').mockResolvedValue([
    { layerId: LAYER_A, placedAt: '2026-09-12', remainingSolidsKg: decimal('55'),
      recorded: { wetKg: decimal('100'), solidsKg: decimal('80') }, readings: [],
      removals: [{ wetKg: decimal('50'), solidsKg: decimal('55'), moisturePercent: 50, occurredAt: time, kind: 'loss', sequence: BigInt(3), stockMode: 'mix' }] },
    { layerId: LAYER_B, placedAt: '2026-09-13', remainingSolidsKg: decimal('80'),
      recorded: { wetKg: decimal('200'), solidsKg: decimal('80') }, readings: [], removals: [] },
  ]);
  const history = await getOutputStockHistory(ctx, 'bin');
  expect(history.find(entry => entry.id === 'movement')).toMatchObject({ wetDeltaKg: -50, currentAfterWetKg: 250, savedWetDeltaKg: hasSavedWet ? 10 : null, afterWetKg: hasSavedWet ? 110 : null });
  expect(history.find(entry => entry.id === LAYER_B)).toMatchObject({ wetDeltaKg: 200, wetMassKg: 200 });
});

it('can omit wet recomputation for sub-bin history readers', async () => {
  historyRows('fifo', ['2026-09-12', '2026-09-13'], ['1', '2']);
  vi.spyOn(stock, 'readOutputBinAllLayers').mockResolvedValue({ layers: [], allLayersDryKg: '0.000', availableDryKg: '0.000', expectedSolidsKg: decimal('0') });
  const bases = vi.spyOn(stock, 'getLayerMoistureBases');
  const history = await getOutputStockHistory(ctx, 'bin', undefined, { recomputeWet: false });
  expect(bases).not.toHaveBeenCalled();
  expect(history.find(entry => entry.id === 'movement')).not.toHaveProperty('currentAfterWetKg');
});
