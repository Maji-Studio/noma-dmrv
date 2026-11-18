import { expect, it, vi } from 'vitest';
import { binMovements, outputStockAllocations, productionRuns, storageLocations } from '@/db/schema';
import { getOutputStockHistory } from '@/data-access/output-stock-history';
import * as stock from '@/data-access/output-stock';
import { decimal } from '@/lib/output-stock/exact';
import { replayStock } from '@/lib/output-stock/stock-replay';

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock('@/data-access/output-stock-edit-lock', () => ({ outputMovementLockReason: async () => null, getOutputMovementCertificationLocks: async () => new Map() }));
vi.mock('@/db', () => ({ db: { select: mocks.select } }));
const ctx = { organizationId: 'org', userId: 'user', orgRole: 'admin' as const, isPlatformAdmin: false };
const LAYER_A = '00000000-0000-4000-8000-00000000000a';
const time = '2026-09-14T12:00:00.000Z';

it('keeps replay stable after an unrelated run edit', async () => {
  const outputPostedAt = new Date('2026-09-13');
  const rows = new Map<unknown, unknown[]>([
    [storageLocations, [{ id: 'bin', type: 'biochar_bin', facilityId: 'facility' }]],
  ]);
  mocks.select.mockImplementation(() => {
    let table: unknown;
    const query = { from: (value: unknown) => { table = value; return query; },
      leftJoin: () => query, innerJoin: () => query, where: () => query, orderBy: () => query,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows.get(table) ?? []).then(resolve) };
    return query;
  });
  const run = { id: LAYER_A, code: 'A', status: 'complete', biocharStorageLocationId: 'bin',
    endTime: new Date('2026-09-12'), outputPostedAt, updatedAt: new Date('2026-09-13'),
    biocharOutputKg: 200, biocharDryMassKg: 200, biocharMoisturePercent: 0 };
  rows.set(productionRuns, [run]);
  rows.set(binMovements, [{ actorName: null, movement: {
    id: 'count', outputKind: 'count', occurredAt: new Date(time), createdAt: new Date(time),
    outputDryDeltaKg: '0', balanceBeforeDryKg: '200', balanceAfterDryKg: '200',
    correctsMovementId: null, inputSnapshot: { kind: 'count', preview: {
      beforeEstimatedWetKg: null, afterEstimatedWetKg: 250, beforeSolidsKg: 200, afterSolidsKg: 200,
    } },
  } }]);
  rows.set(outputStockAllocations, []);
  vi.spyOn(stock, 'readOutputBinAllLayers').mockResolvedValue({
    layers: [], allLayersDryKg: '0.000', availableDryKg: '0.000', expectedSolidsKg: decimal('0'),
  });
  const history = () => getOutputStockHistory(ctx, 'bin', undefined, { recomputeWet: false });
  const before = replayStock(await history());
  expect(before.at(-1)?.after.wetKg).toBe(250);
  run.updatedAt = new Date('2026-09-20');
  expect(replayStock(await history())).toEqual(before);
  expect((await history()).find(entry => entry.id === LAYER_A)?.recordedAt)
    .toBe(outputPostedAt.toISOString());
});
