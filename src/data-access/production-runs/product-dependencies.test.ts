import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { assertProductionRunOutputBasisChange } from './product-dependencies';
const ctx: OrgContext = { organizationId: 'org', userId: 'user', orgRole: 'owner', isPlatformAdmin: false };

describe('unresolved production repair dependencies', () => {
  it('blocks a balance-dependent count even when the old completion date is missing', async () => {
    let predicate = '';
    const query = { from: () => query, innerJoin: () => query,
      where: (sql: SQL) => { predicate = new PgDialect().sqlToQuery(sql).sql; return query; },
      limit: async () => [{ reason: 'Recorded count', date: '2026-09-12' }] };
    const tx = { select: () => query } as unknown as DbTransaction;
    await expect(assertProductionRunOutputBasisChange(ctx, tx, 'run', { endTime: null }, { endTime: new Date('2026-09-01') })).rejects.toThrow('covered by count');
    expect(predicate).toContain('"end_time" is null or');
    expect(predicate).toContain('"organization_id"');
  });
  it('keeps metadata edits outside the stock dependency gate', async () => {
    const tx = { select: vi.fn() } as unknown as DbTransaction;
    await expect(assertProductionRunOutputBasisChange(ctx, tx, 'run', { code: 'old', endTime: null }, { code: 'new' })).resolves.toBeUndefined();
    expect(tx.select).not.toHaveBeenCalled();
  });
});
