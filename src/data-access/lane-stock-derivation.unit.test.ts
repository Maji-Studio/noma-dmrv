import { expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import { feedstocks, storageLocations } from '@/db/schema';
import { deriveLaneStock } from './lane-stock-derivation';

const replay = vi.hoisted(() => vi.fn());
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./feedstock-bin-ledger', () => ({ replayFeedstockBinStock: replay }));

it('uses replay dry stock for feedstock bins and forwards exclusions and the transaction', async () => {
  const ctx = { organizationId: 'org', userId: 'user', orgRole: 'admin' as const, isPlatformAdmin: false };
  const tx = { select: () => {
    let table: unknown;
    const query = {
      from: (value: unknown) => { table = value; return query; },
      where: () => query, innerJoin: () => query, groupBy: () => query,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(table === storageLocations
        ? [{ id: 'bin' }] : table === feedstocks
          ? [{ storageLocationId: 'bin', total: 180, totalWet: 200 }] : []).then(resolve),
    };
    return query;
  } } as unknown as DbTransaction;
  replay.mockResolvedValue({ remainingDryKg: 116 });
  const rows = await deriveLaneStock(ctx, tx, { storageLocationIds: ['bin', 'output'], excludeRunId: 'run', excludeProductId: 'product' });
  expect(rows[0].feedstockEstimatedDryKg).toBe(116);
  expect(rows[1].feedstockEstimatedDryKg).toBe(0);
  expect(replay).toHaveBeenCalledExactlyOnceWith(ctx, 'bin', tx, { excludeRunId: 'run', excludeProductId: 'product' });
});
