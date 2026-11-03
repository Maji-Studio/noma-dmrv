import { expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ replay: vi.fn(), freeze: vi.fn(), lock: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./lock-bin-stocks', () => ({ lockBinStocks: mocks.lock, assertStockLockSnapshot: (valid: boolean) => { if (!valid) throw new Error('changed'); } }));
vi.mock('./feedstock-bin-ledger', () => ({ replayFeedstockBinStock: mocks.replay }));
vi.mock('./feedstock-transport-ownership-freeze', () => ({ prepareFeedstockTransportOwnershipFreeze: mocks.freeze }));
vi.mock('./certification-lineage-guards', () => ({ tryLockCertifiedLineageArtifacts: async () => [], assertLockedLineagesAllowMutation: vi.fn() }));
import { reallocateRunsForBins, reallocateRunsForFacility } from './feedstock-run-allocations';

it('clears stale shares on an explicitly edited cancelled run, excluding other cancelled runs', async () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const draw = { id: 'draw', productionRunId: 'cancelled-run', storageLocationId: 'new-bin', createdAt: at };
  const results: unknown[] = [[{ startTime: at, status: 'cancelled' }], [{ recordedAt: at, id: 'draw' }], [],
    [draw], [{ id: 'cancelled-run', status: 'cancelled' }], [draw], [{ feedstockId: 'old-intake', wetMassUsedKg: 5 }]];
  const conditions: SQL[] = [];
  const select = () => {
    const rows = results.shift();
    const query = { from: () => query, innerJoin: () => query, orderBy: () => query, for: () => query,
      where: (condition: SQL) => { conditions.push(condition); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  const remove = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const insert = vi.fn();
  mocks.replay.mockResolvedValue({ entries: [], withdrawals: new Map() });
  mocks.freeze.mockResolvedValue(async (work: () => Promise<void>) => work());
  const tx = { select, delete: remove, insert } as unknown as DbTransaction;
  const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
  await expect(reallocateRunsForBins(ctx, tx, ['old-bin', 'new-bin'], { onlyRunId: 'cancelled-run' })).resolves.toEqual(['cancelled-run']);
  expect(remove).toHaveBeenCalledOnce();
  expect(insert).not.toHaveBeenCalled();
  const affected = new PgDialect().sqlToQuery(conditions[2]);
  expect(affected.sql).toMatch(/"status" <> .* or .*"id" =/);
  expect(affected.params).toContain('cancelled-run');
  expect(affected.params).toContain('cancelled');
});

it('replaces a cancelled run’s moved-bin shares with replayed history', async () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const draw = { id: 'draw', productionRunId: 'cancelled-run', storageLocationId: 'new-bin', createdAt: at };
  const results: unknown[] = [[{ startTime: at, status: 'cancelled' }], [{ recordedAt: at, id: 'draw' }], [],
    [draw], [{ id: 'cancelled-run', status: 'cancelled' }], [draw], [{ feedstockId: 'old-intake', wetMassUsedKg: 5 }]];
  const select = () => {
    const rows = results.shift();
    const query = { from: () => query, innerJoin: () => query, orderBy: () => query, for: () => query, where: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  const remove = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const values = vi.fn();
  mocks.replay.mockReset().mockResolvedValueOnce({ entries: [], withdrawals: new Map() })
    .mockResolvedValueOnce({ entries: [{ kind: 'run_draw', sourceId: 'cancelled-run', id: 'draw' }],
      withdrawals: new Map([['draw', [{ feedstockId: 'new-intake', wetKg: 5 }]]]) });
  mocks.freeze.mockResolvedValue(async (work: () => Promise<void>) => work());
  const tx = { select, delete: remove, insert: () => ({ values }) } as unknown as DbTransaction;
  const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
  await reallocateRunsForBins(ctx, tx, ['old-bin', 'new-bin'], { onlyRunId: 'cancelled-run' });
  expect(remove).toHaveBeenCalledOnce();
  expect(values).toHaveBeenCalledWith([{ organizationId: 'org', productionRunId: 'cancelled-run', feedstockId: 'new-intake', wetMassUsedKg: 5 }]);
  expect(mocks.replay).toHaveBeenCalledWith(ctx, 'new-bin', tx, expect.objectContaining({ historyRunId: 'cancelled-run' }));
});

it.each(['empty-at-switch', 'non-run overdraw'])('validates every facility bin even without draws: %s', async reason => {
  const results: unknown[] = [[{ binId: 'no-draw-bin' }], [], [], [], []];
  const conditions: SQL[] = [];
  const select = () => {
    const rows = results.shift();
    const query = { from: () => query, innerJoin: () => query, orderBy: () => query, for: () => query,
      where: (condition: SQL) => { conditions.push(condition); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  const tx = { select } as unknown as DbTransaction;
  const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
  const failure = new Error(reason);
  mocks.replay.mockReset().mockRejectedValue(failure);
  mocks.lock.mockClear();
  await expect(reallocateRunsForFacility(ctx, tx, 'facility')).rejects.toBe(failure);
  expect(mocks.lock).toHaveBeenCalledWith(ctx, tx, ['no-draw-bin'], { allowArchived: true });
  expect(mocks.replay).toHaveBeenCalledWith(ctx, 'no-draw-bin', tx, expect.objectContaining({ boundary: expect.objectContaining({ occurredAt: '' }) }));
  const inventory = new PgDialect().sqlToQuery(conditions[0]);
  expect(inventory.params).toEqual(['org', 'facility', 'feedstock_bin']);
});
