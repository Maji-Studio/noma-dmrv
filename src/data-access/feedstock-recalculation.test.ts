import { DomainError } from '@/lib/domain-errors';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
const mocks = vi.hoisted(() => ({ locks: vi.fn(), replan: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./lock-bin-stocks', () => ({ lockBinStocks: vi.fn() }));
vi.mock('./certification-lineage-guards', () => ({ getRecordLocks: mocks.locks }));
vi.mock('./feedstock-run-allocations', async importOriginal => ({
  ...await importOriginal<typeof import('./feedstock-run-allocations')>(), reallocateRunsForBins: mocks.replan,
}));
vi.mock('./feedstock-transport-ownership', () => ({ getFeedstockTransportOwnerBatches: vi.fn() }));
import { recalculateFeedstockBin } from './feedstock-recalculation';
import { SentRunRewriteRefusedError } from './feedstock-run-allocations';
const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
const at = new Date('2026-01-01T00:00:00Z');
const runs = ['z', 'a', 'later'].map((id, index) => ({ id, code: id, drawId: id, startTime: at,
  recordedAt: index === 2 ? new Date(at.getTime() + 1) : at }));
function reader(sent = true, refusalRows: unknown[][] = [], conditions: SQL[] = []) {
  const results = [[{ code: 'bin' }], [], runs, ...(sent ? [[{ id: 'removal', code: 'RM-1' }]] : []), ...refusalRows, []];
  const select = () => {
    const rows = results.shift();
    const query = { from: () => query, where: (condition: SQL) => { conditions.push(condition); return query; }, innerJoin: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  const tx = { select, transaction: (work: (tx: unknown) => unknown) => work(tx) };
  return tx as unknown as DbTransaction;
}
beforeEach(() => { mocks.replan.mockReset().mockResolvedValue(['later']); mocks.locks.mockReset(); });
it('starts strictly after the last Sent draw, resolving ties by draw ID', async () => {
  mocks.locks.mockResolvedValue([{ level: 'sent', heldBy: [{ id: 'removal', kind: 'removal' }] }, { level: 'sent', heldBy: [{ id: 'removal', kind: 'removal' }] }, { level: 'unlocked', heldBy: [] }]);
  const result = await recalculateFeedstockBin(ctx, reader(), 'bin');
  expect(mocks.replan).toHaveBeenCalledWith(ctx, expect.anything(), ['bin'], {
    earliestEventAt: at, eventTie: { recordedAt: at, id: 'z' }, boundaryExclusive: true,
  });
  expect(result.keptSentRuns).toEqual([{ runId: 'z', code: 'z', removalCodes: ['RM-1'] }, { runId: 'a', code: 'a', removalCodes: ['RM-1'] }]);
});
it('uses the first event when no run is Sent', async () => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'unlocked', heldBy: [] })));
  const result = await recalculateFeedstockBin(ctx, reader(false), 'bin');
  expect(mocks.replan).toHaveBeenCalledWith(ctx, expect.anything(), ['bin'], {});
  expect(result.keptSentRuns).toEqual([]);
});
it('uses recorded time before draw ID for the last Sent boundary', async () => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'sent', heldBy: [{ id: 'removal', kind: 'removal' }] })));
  await recalculateFeedstockBin(ctx, reader(), 'bin');
  expect(mocks.replan.mock.calls[0][3].eventTie).toEqual({ recordedAt: runs[2].recordedAt, id: 'later' });
});

it('include-sent starts at the first event and reports only rewritten Sent runs', async () => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'sent', heldBy: [{ id: 'removal' }] })));
  mocks.replan.mockResolvedValue(['z', 'later']);
  const result = await recalculateFeedstockBin(ctx, reader(), 'bin', { allowSentRewrite: true });
  expect(mocks.replan).toHaveBeenCalledWith(ctx, expect.anything(), ['bin'], { allowSentRewrite: true });
  expect(result.keptSentRuns).toEqual([]);
  expect(result.rewrittenSentRuns).toEqual(['z', 'later'].map(code => ({ runId: code, code, removalCodes: ['RM-1'] })));
});
it('reports the actual guard target separately from kept Sent runs', async () => {
  mocks.locks.mockResolvedValueOnce(runs.map(() => ({ level: 'sent', heldBy: [{ id: 'removal' }] })))
    .mockResolvedValueOnce([{ level: 'sent', heldBy: [{ id: 'blocking-removal' }] }]);
  mocks.replan.mockRejectedValue(new SentRunRewriteRefusedError('blocking-run', 'PR-blocking', new DomainError('certification_locked', 'Blocked')));
  const conditions: SQL[] = [];
  const tx = reader(true, [[{ code: 'RM-blocking' }]], conditions);
  const result = await recalculateFeedstockBin(ctx, tx, 'bin');
  expect(result.refused).toEqual([{ runId: 'blocking-run', code: 'PR-blocking', removalCodes: ['RM-blocking'] }]);
  expect(mocks.locks).toHaveBeenNthCalledWith(2, ctx, tx, [{ entityType: 'productionRun', entityId: 'blocking-run' }], { sentOnly: true });
  expect(new PgDialect().sqlToQuery(conditions[4]).params).toEqual(['org', 'blocking-removal']);
  expect(result.keptSentRuns).toEqual(runs.map(run => ({ runId: run.id, code: run.code, removalCodes: ['RM-1'] })));
  expect(result.rewrittenRunIds).toEqual([]);
  expect(result.runsRewritten).toBe(0);
  expect(result.runsRefused).toBe(1);
});
it.each([true, false])('reports a transport ownership refusal with its feedstock code when available: %s', async found => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'unlocked', heldBy: [] })));
  mocks.replan.mockRejectedValue(new DomainError('certification_locked', 'Blocked', { issues: [{ path: [], code: 'certification_locked', message: 'Blocked',
    meta: { feedstockId: 'blocking-feedstock', removalIds: ['blocking-removal'] } }] }));
  const conditions: SQL[] = [];
  const tx = reader(false, [found ? [{ code: 'FS-blocking' }] : [], [{ code: 'RM-blocking' }]], conditions);
  const result = await recalculateFeedstockBin(ctx, tx, 'bin');
  expect(result.refused).toEqual([{ feedstockId: 'blocking-feedstock', ...(found ? { code: 'FS-blocking' } : {}), removalCodes: ['RM-blocking'] }]);
  expect(new PgDialect().sqlToQuery(conditions[3]).params).toEqual(['org', 'blocking-feedstock']);
  expect(new PgDialect().sqlToQuery(conditions[4]).params).toEqual(['org', 'blocking-removal']);
  expect(mocks.locks).toHaveBeenCalledOnce();
  expect(result.keptSentRuns).toEqual([]);
  expect(result.runsRewritten).toBe(0);
  expect(result.runsRefused).toBe(1);
});
it('reports a bin-level certification refusal when no target metadata is available', async () => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'unlocked', heldBy: [] })));
  mocks.replan.mockRejectedValue(new DomainError('certification_locked', 'Blocked'));
  const result = await recalculateFeedstockBin(ctx, reader(false), 'bin');
  expect(result.refused).toEqual([{ removalCodes: [] }]);
  expect(result.runsRefused).toBe(1);
});
