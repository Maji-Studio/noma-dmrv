import { DomainError } from '@/lib/domain-errors';
import { beforeEach, expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ locks: vi.fn(), replan: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./lock-bin-stocks', () => ({ lockBinStocks: vi.fn() }));
vi.mock('./certification-lineage-guards', () => ({ getRecordLocks: mocks.locks }));
vi.mock('./feedstock-run-allocations', () => ({ reallocateRunsForBins: mocks.replan }));
vi.mock('./feedstock-transport-ownership', () => ({ getFeedstockTransportOwnerBatches: vi.fn() }));
import { recalculateFeedstockBin } from './feedstock-recalculation';
const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
const at = new Date('2026-01-01T00:00:00Z');
const runs = ['z', 'a', 'later'].map((id, index) => ({ id, code: id, drawId: id, startTime: at,
  recordedAt: index === 2 ? new Date(at.getTime() + 1) : at }));
function reader(sent = true, refusal = false) {
  const results = [[{ code: 'bin' }], [], runs, ...(sent ? [[{ id: 'removal', code: 'RM-1' }]] : []), ...(refusal ? [[{ code: 'RM-blocking' }]] : []), []];
  const select = () => {
    const rows = results.shift();
    const query = { from: () => query, where: () => query, innerJoin: () => query,
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
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'sent', heldBy: [{ id: 'removal' }] })));
  mocks.replan.mockRejectedValue(new DomainError('certification_locked', 'Blocked', { issues: [{ path: [], code: 'certification_locked', message: 'Blocked',
    meta: { runId: 'blocking-run', runCode: 'PR-blocking', removalIds: ['blocking-removal'] } }] }));
  const result = await recalculateFeedstockBin(ctx, reader(true, true), 'bin');
  expect(result.refused).toEqual([{ runId: 'blocking-run', code: 'PR-blocking', removalCodes: ['RM-blocking'] }]);
  expect(result.keptSentRuns).toHaveLength(3);
  expect(result.runsRefused).toBe(1);
});
it('reports a bin-level certification refusal when no target metadata is available', async () => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'unlocked', heldBy: [] })));
  mocks.replan.mockRejectedValue(new DomainError('certification_locked', 'Blocked'));
  const result = await recalculateFeedstockBin(ctx, reader(false), 'bin');
  expect(result.refused).toEqual([{ removalCodes: [] }]);
  expect(result.runsRefused).toBe(1);
});
