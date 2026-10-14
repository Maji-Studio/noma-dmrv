import { beforeEach, expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import { decimal } from '@/lib/output-stock/exact';
import { projectOutputBinStock } from '@/lib/output-stock/bin-stock-projection';
import { readApiOutputBinStock } from './api-output-bin-stock';

const mocks = vi.hoisted(() => ({ bin: vi.fn(), read: vi.fn(), snapshot: vi.fn() }));
vi.mock('./api-output-stock-movements', () => ({ requireApiOutputBin: mocks.bin }));
vi.mock('./output-bin-stock', () => ({ readOutputBinStockAt: mocks.read, withStockSnapshot: mocks.snapshot }));
vi.mock('@/db', () => ({ db: {} }));

const ctx = { organizationId: 'org', userId: 'operator', orgRole: 'owner' as const, isPlatformAdmin: false };
const tx = {} as DbTransaction;
const AT = '2026-10-01T08:00:00.000Z';
const bin = { id: 'bin', code: 'OB-2', type: 'biochar_bin', facilityId: 'facility', archivedAt: null, formulationId: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.bin.mockResolvedValue(bin);
  mocks.snapshot.mockImplementation((read: (tx: DbTransaction) => unknown) => read(tx));
});

it('throws when a held layer has no code in the projection code map', async () => {
  const stock = projectOutputBinStock({
    bin: { ...bin, storageLocationId: bin.id, type: 'biochar_bin' }, stockMode: 'split', at: AT,
    layers: [{ id: 'run', placedAt: AT, postingSequence: BigInt(1), establishedDryBiocharKg: '10',
      ingredientDrySolidsKg: '0', remainingDryBiocharKg: '10', remainingSolidsKg: decimal('10'),
      runs: [{ productionRunId: 'run', establishedDryKg: '10', remainingDryKg: '10' }] }],
    bases: [], codes: new Map(),
  });
  expect(stock.subBins).toMatchObject([{ layerId: 'run', code: null }]);
  mocks.read.mockResolvedValue({ stock });
  await expect(readApiOutputBinStock(ctx, { identifier: { id: bin.id } }))
    .rejects.toThrow('Output bin bin layer run has no code');
  expect(mocks.bin).toHaveBeenCalledWith(ctx, { id: bin.id }, { facilityId: undefined, executor: tx });
  expect(mocks.read).toHaveBeenCalledWith(ctx, bin, expect.any(String), tx, { includeArchived: false });
});
