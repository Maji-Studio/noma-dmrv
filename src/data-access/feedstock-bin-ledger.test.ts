import { expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { db } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./output-stock-active-movements', () => ({ deletedProductIds: async () => [] }));
vi.mock('./output-stock-dates', () => ({ getOutputStockFacilityTimezone: async () => 'UTC' }));
vi.mock('./feedstock-bin-method-history', () => ({ getFeedstockMethodChanges: async () => [] }));
import { replayFeedstockBinStock } from './feedstock-bin-ledger';

it('includes only the edited cancelled draw as history and leaves later live stock available', async () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const results: unknown[] = [[{ type: 'feedstock_bin', facilityId: 'facility', stockMode: 'split', drawOrder: 'oldest_first' }],
    [{ id: 'intake', code: 'F1', deliveryDate: at, createdAt: at, wetKg: 10, dryKg: 5, moisturePercent: 50 }],
    [{ id: 'cancelled-draw', sourceId: 'cancelled', code: 'PR1', wetKg: 10, startTime: new Date('2026-01-02'), createdAt: at },
      { id: 'live-draw', sourceId: 'live', code: 'PR2', wetKg: 10, startTime: new Date('2026-01-03'), createdAt: at }], [], [], []];
  const conditions: SQL[] = [];
  const select = () => {
    const rows = results.shift();
    const query = { from: () => query, innerJoin: () => query, leftJoin: () => query,
      where: (condition: SQL) => { conditions.push(condition); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  const ledger = await replayFeedstockBinStock({ organizationId: 'org', userId: 'user' } as OrgContext, 'bin', { select } as unknown as Pick<typeof db, 'select'>,
    { historyRunId: 'cancelled', replanRunIds: new Set(['cancelled', 'live']), boundary: { occurredAt: '' } });
  expect(ledger.withdrawals.get('cancelled-draw')).toEqual([{ feedstockId: 'intake', wetKg: 10 }]);
  expect(ledger.withdrawals.get('live-draw')).toEqual([{ feedstockId: 'intake', wetKg: 10 }]);
  expect(ledger.entries.find(entry => entry.id === 'cancelled-draw')).toMatchObject({ beforeWetKg: 10, afterWetKg: 10 });
  expect(ledger.currentWetKg).toBe(0);
  const runQuery = new PgDialect().sqlToQuery(conditions[2]);
  expect(runQuery.sql).toMatch(/"status" <> .* or .*"id" =/);
  expect(runQuery.params).toEqual(['org', 'bin', 'cancelled', 'cancelled']);
});
