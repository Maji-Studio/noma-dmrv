import { expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
const locks = vi.hoisted(() => vi.fn());
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./certification-lineage-guards', () => ({ getRecordLocks: locks }));
import { getFeedstockTransportOwners } from './feedstock-transport-ownership';
it('chooses the first completed share owner without reading submission locks or filtering mass', async () => {
  const conditions: SQL[] = [];
  const rows = ['later', 'earlier'].map((runId, index) => ({ feedstockId: 'intake', runId,
    status: 'complete', startTime: new Date(`2026-01-0${2 - index}T00:00:00Z`) }));
  const chain = { from: () => chain,
    innerJoin: (_table: unknown, condition: SQL) => { conditions.push(condition); return chain; },
    where: (condition: SQL) => { conditions.push(condition); return chain; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
  const selectDistinct = vi.fn();
  const reader = { select: () => chain, selectDistinct } as unknown as DbTransaction;
  const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
  expect(await getFeedstockTransportOwners(ctx, ['intake'], reader)).toEqual(new Map([['intake', 'earlier']]));
  expect(locks).not.toHaveBeenCalled();
  expect(selectDistinct).not.toHaveBeenCalled();
  const sql = conditions.map(condition => new PgDialect().sqlToQuery(condition).sql).join(' ');
  expect(sql).not.toContain('wet_mass_used_kg');
  expect(sql).toContain('"production_runs"."archived_at" is null');
  expect(sql).toContain('"credit_batches"."archived_at" is null');
  expect(sql).toContain('"organization_id"');
});
