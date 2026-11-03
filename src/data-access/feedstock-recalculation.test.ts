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
function reader() {
  const results = [[{ code: 'bin' }], [], runs, []];
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
  mocks.locks.mockResolvedValue([{ level: 'sent' }, { level: 'sent' }, { level: 'unlocked' }]);
  const result = await recalculateFeedstockBin(ctx, reader(), 'bin');
  expect(mocks.replan).toHaveBeenCalledWith(ctx, expect.anything(), ['bin'], {
    earliestEventAt: at, eventTie: { recordedAt: at, id: 'z' }, boundaryExclusive: true,
  });
  expect(result.keptSentRuns).toEqual([{ runId: 'z', code: 'z' }, { runId: 'a', code: 'a' }]);
});
it('uses the first event when no run is Sent', async () => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'unlocked' })));
  const result = await recalculateFeedstockBin(ctx, reader(), 'bin');
  expect(mocks.replan).toHaveBeenCalledWith(ctx, expect.anything(), ['bin'], {});
  expect(result.keptSentRuns).toEqual([]);
});
it('uses recorded time before draw ID for the last Sent boundary', async () => {
  mocks.locks.mockResolvedValue(runs.map(() => ({ level: 'sent' })));
  await recalculateFeedstockBin(ctx, reader(), 'bin');
  expect(mocks.replan.mock.calls[0][3].eventTie).toEqual({ recordedAt: runs[2].recordedAt, id: 'later' });
});
