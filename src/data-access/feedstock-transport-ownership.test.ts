import { expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
const locks = vi.hoisted(() => vi.fn());
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./certification-lineage-guards', () => ({ getRecordLocks: locks }));
import { getFeedstockTransportOwners } from './feedstock-transport-ownership';
it.each(['sent-zero', 'sent-positive', 'unlocked'])('preserves the old candidate set for %s lineage', async scenario => {
  locks.mockResolvedValue([{ level: scenario === 'sent-zero' ? 'sent' : 'unlocked' }, { level: scenario === 'sent-positive' ? 'sent' : 'unlocked' }]);
  const conditions: SQL[] = [];
  function query(rows: unknown[]) {
    const chain = { from: () => chain, innerJoin: () => chain,
      where: (condition: SQL) => { conditions.push(condition); return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return chain;
  }
  const candidates = [[{ feedstockId: 'intake' }], [{ feedstockId: 'intake', runId: 'legacy' }, { feedstockId: 'intake', runId: 'positive' }]];
  const reader = { selectDistinct: () => query(candidates.shift()!), select: () => query([]) } as unknown as DbTransaction;
  await getFeedstockTransportOwners({ organizationId: 'org', userId: 'user' } as OrgContext, ['intake'], reader);
  expect(locks).toHaveBeenCalledWith(expect.anything(), reader, [{ entityType: 'productionRun', entityId: 'legacy' }, { entityType: 'productionRun', entityId: 'positive' }], { sentOnly: true });
  const sql = new PgDialect().sqlToQuery(conditions[2]);
  expect(sql.sql).toContain('"wet_mass_used_kg" >');
  expect(sql.params.filter(value => value === 'intake')).toHaveLength(scenario === 'unlocked' ? 1 : 2);
});
