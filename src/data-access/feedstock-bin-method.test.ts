import { beforeEach, expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import type { StorageLocation } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ stock: vi.fn(), history: vi.fn() }));
vi.mock('./feedstock-bin-ledger', () => ({ getFeedstockBinStock: mocks.stock }));
vi.mock('./feedstock-bin-method-history', () => ({ getFeedstockMethodChanges: mocks.history }));
vi.mock('@/db', () => ({ db: {} }));
import { applyFeedstockMethodChange } from './feedstock-bin-method';
const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
const bin = { id: 'bin', stockMode: 'split', drawOrder: 'oldest_first' } as StorageLocation;
beforeEach(() => { mocks.stock.mockResolvedValue({ entries: [], currentWetKg: 0 }); mocks.history.mockResolvedValue([]); });
it('does not record a method until a bin has events or history', async () => {
  const insert = vi.fn();
  await applyFeedstockMethodChange(ctx, { insert } as unknown as DbTransaction, bin, { drawOrder: 'newest_first' });
  expect(mocks.history).toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});
it('records a new method when only method history remains', async () => {
  mocks.history.mockResolvedValue([{ effectiveAt: '2026-01-01T00:00:00.000Z' }]);
  const values = vi.fn();
  await applyFeedstockMethodChange(ctx, { insert: () => ({ values }) } as unknown as DbTransaction, bin, { drawOrder: 'newest_first' });
  expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org', storageLocationId: 'bin', drawOrder: 'newest_first' }));
});

it.each([-1, 1])('refuses mixed-to-ordered switching with nonzero stock %s', async currentWetKg => {
  mocks.stock.mockResolvedValue({ entries: [], currentWetKg });
  mocks.history.mockResolvedValue([{ effectiveAt: '2026-01-01T00:00:00.000Z' }]);
  const insert = vi.fn();
  await expect(applyFeedstockMethodChange(ctx, { insert } as unknown as DbTransaction,
    { ...bin, stockMode: 'mix' }, { stockMode: 'split' })).rejects.toThrow('Empty this bin before switching it to In order');
  expect(insert).not.toHaveBeenCalled();
});
