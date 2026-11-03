import { expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ locks: vi.fn(), lineage: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./certification-lineage-guards', () => ({ getRecordLocks: mocks.locks,
  getLockedCertifiedLineageForBatches: mocks.lineage, isSubmittedLineageRow: () => true }));
import { readRecordDependentsBatch } from './record-lock-dependents';
import { getFeedstockTypeLinkLock, getLockedFeedstockTypeLinkLock } from './feedstock-type-link-lock';
const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
function reader(results: unknown[][]) {
  const clauses: SQL[] = [];
  const select = () => {
    const rows = results.shift();
    const query = { from: () => query, orderBy: () => query,
      innerJoin: (_table: unknown, clause: SQL) => { clauses.push(clause); return query; },
      where: (clause: SQL) => { clauses.push(clause); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  return { tx: { select, selectDistinct: select } as unknown as DbTransaction, clauses };
}
function expectNoMassFilter(clauses: SQL[]) {
  const sql = clauses.map(clause => new PgDialect().sqlToQuery(clause).sql).join(' ');
  expect(sql).not.toContain('wet_mass_used_kg');
  expect(sql).toContain('organization_id');
}
it('keeps legacy zero-share links in record freeze dependencies', async () => {
  const { tx, clauses } = reader([[{ feedstockId: 'intake', id: 'legacy-run' }]]);
  expect((await readRecordDependentsBatch(ctx, tx, 'feedstock', ['intake'])).get('intake'))
    .toEqual([{ kind: 'productionRun', id: 'legacy-run' }]);
  expectNoMassFilter(clauses);
});
it('keeps legacy zero-share links in advisory and write feedstock-type freezes', async () => {
  mocks.locks.mockResolvedValue([{ level: 'sent', heldBy: [{ kind: 'removal', id: 'removal' }] }]);
  mocks.lineage.mockResolvedValue([{ removalId: 'removal' }]);
  const removal = { id: 'removal', code: 'RM1', facilityId: 'facility' };
  const advisory = reader([[{ id: 'type' }], [{ id: 'legacy-run' }], [removal]]);
  expect(await getFeedstockTypeLinkLock(ctx, advisory.tx, 'type')).toEqual({ locked: true, removals: [removal] });
  expectNoMassFilter(advisory.clauses);
  const write = reader([[{ id: 'batch' }], [removal]]);
  expect(await getLockedFeedstockTypeLinkLock(ctx, write.tx, 'type')).toEqual({ locked: true, removals: [removal] });
  expectNoMassFilter(write.clauses);
});
