import { describe, expect, it } from 'vitest';
import { startOfFacilityDay } from './date-utils';
import { feedstockMethodAt, FeedstockReplayOverdrawError, replayFeedstockDraws, type FeedstockDrawMethod, type FeedstockMethodChange, type FeedstockReplayEvent } from './feedstock-draw-replay';

const oldest: FeedstockDrawMethod = { stockMode: 'split', drawOrder: 'oldest_first' };
const newest: FeedstockDrawMethod = { stockMode: 'split', drawOrder: 'newest_first' };
const mix: FeedstockDrawMethod = { stockMode: 'mix', drawOrder: 'oldest_first' };
const at = (day: number) => `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
function event(id: string, day: number, wetDeltaKg: number, kind: FeedstockReplayEvent['kind'] = 'intake'): FeedstockReplayEvent {
  return { id, occurredAt: at(day), recordedAt: at(day), kind, wetDeltaKg };
}
const shares = (events: FeedstockReplayEvent[], method = oldest) => replayFeedstockDraws(events, method).withdrawals.get('run');

describe('feedstock wet replay', () => {
  it.each([
    [oldest, [{ feedstockId: 'a', wetKg: 10 }, { feedstockId: 'b', wetKg: 2 }]],
    [newest, [{ feedstockId: 'b', wetKg: 12 }]],
    [mix, [{ feedstockId: 'a', wetKg: 4 }, { feedstockId: 'b', wetKg: 8 }]],
  ])('draws by the selected method %j', (method, expected) => {
    expect(shares([event('b', 2, 20), event('run', 3, -12, 'run_draw'), event('a', 1, 10)], method)).toEqual(expected);
  });
  it('weights remaining mass, never the original intake', () => {
    const result = replayFeedstockDraws([event('a', 1, 10), event('first', 2, -9, 'run_draw'), event('b', 3, 10), event('run', 4, -11, 'run_draw')], mix);
    expect(result.withdrawals.get('run')).toEqual([{ feedstockId: 'a', wetKg: 1 }, { feedstockId: 'b', wetKg: 10 }]);
    expect([...result.remaining.values()]).toEqual([0, 0]);
  });
  it('apportions every gram with largest remainder and delivery-order ties', () => {
    expect(shares([event('a', 1, 0.001), event('b', 2, 0.001), event('c', 3, 0.001), event('run', 4, -0.002, 'run_draw')], mix))
      .toEqual([{ feedstockId: 'a', wetKg: 0.001 }, { feedstockId: 'b', wetKg: 0.001 }]);
  });
  it('keeps large products exact and conserves repeated fractional draws', () => {
    const inputs = [event('a', 1, 99999999999.999), event('b', 2, 0.003), event('run', 3, -99999999999.999, 'run_draw')];
    const result = replayFeedstockDraws(inputs, mix);
    expect(result.withdrawals.get('run')!.reduce((sum, row) => sum + Math.round(row.wetKg * 1000), 0)).toBe(99999999999999);
    expect([...result.remaining.values()].reduce((a, b) => a + b, 0)).toBe(0.003);
  });
  it('losses and ingredients shift later run provenance without becoming run shares', () => {
    const result = replayFeedstockDraws([event('a', 1, 10), event('b', 2, 10), event('loss', 3, -7, 'loss'), event('ingredient', 4, -3, 'ingredient_draw'), event('run', 5, -4, 'run_draw')], oldest);
    expect(result.withdrawals.get('loss')).toEqual([{ feedstockId: 'a', wetKg: 7 }]);
    expect(result.withdrawals.get('ingredient')).toEqual([{ feedstockId: 'a', wetKg: 3 }]);
    expect(result.withdrawals.get('run')).toEqual([{ feedstockId: 'b', wetKg: 4 }]);
  });
  it('adds count gains to present deliveries proportionally', () => {
    const result = replayFeedstockDraws([event('a', 1, 10), event('b', 2, 20), event('count', 3, 6, 'count')], newest);
    expect([...result.remaining]).toEqual([['a', 12], ['b', 24]]);
    expect(result.withdrawals.get('count')).toEqual([{ feedstockId: 'a', wetKg: -2 }, { feedstockId: 'b', wetKg: -4 }]);
  });
  it('takes attributed holdings before gains without an intake', () => {
    const result = replayFeedstockDraws([event('count', 1, 10, 'count'), event('a', 2, 2), event('run', 3, -5, 'run_draw')], mix);
    expect(result.withdrawals.get('run')).toEqual([{ feedstockId: 'a', wetKg: 2 }]);
    expect(result.unattributedWetKg).toBe(7);
  });
  it('refuses run overdraws and caps other withdrawals', () => {
    expect(() => shares([event('a', 1, 1), event('run', 2, -2, 'run_draw')])).toThrow(FeedstockReplayOverdrawError);
    expect(replayFeedstockDraws([event('a', 1, 1), event('loss', 2, -2, 'loss')], oldest).withdrawals.get('loss')).toEqual([{ feedstockId: 'a', wetKg: 1 }]);
  });
  it('uses saved earlier shares without recomputing a protected run', () => {
    const first = { ...event('first', 3, -5, 'run_draw'), savedShares: [{ feedstockId: 'b', wetKg: 5 }] };
    expect(shares([event('a', 1, 5), event('b', 2, 5), first, event('run', 4, -5, 'run_draw')])).toEqual([{ feedstockId: 'a', wetKg: 5 }]);
  });
  it('ignores reversed losses and deleted ingredient draws', () => {
    expect(shares([event('a', 1, 5), { ...event('loss', 2, -5, 'loss'), reversed: true }, event('run', 3, -5, 'run_draw')])).toEqual([{ feedstockId: 'a', wetKg: 5 }]);
  });
  it('makes a delivery available at the start of its facility day', () => {
    const intake = { ...event('a', 1, 5), occurredAt: startOfFacilityDay('2026-01-02', 'Africa/Dar_es_Salaam').toISOString(), recordedAt: at(5) };
    const draw = { ...event('run', 2, -5, 'run_draw'), occurredAt: '2026-01-01T22:00:00.000Z' };
    expect(shares([draw, intake])).toEqual([{ feedstockId: 'a', wetKg: 5 }]);
  });
  it('uses ledger recorded time then id for ties', () => {
    expect(shares([event('b', 1, 5), event('a', 1, 5), event('run', 2, -5, 'run_draw')])).toEqual([{ feedstockId: 'a', wetKg: 5 }]);
  });
  it('keeps Oldest first before merge and Newest first after emptying', () => {
    const changes: FeedstockMethodChange[] = [
      { ...mix, id: 'merge', effectiveAt: at(4), createdAt: at(4), previousStockMode: 'split', previousDrawOrder: 'oldest_first' },
      { ...newest, id: 'split', effectiveAt: at(6), createdAt: at(6), previousStockMode: 'mix', previousDrawOrder: 'oldest_first' },
    ];
    const result = replayFeedstockDraws([event('a', 1, 10), event('b', 2, 10), event('first', 3, -5, 'run_draw'),
      event('second', 5, -15, 'run_draw'), event('c', 7, 10), event('d', 8, 10), event('run', 9, -5, 'run_draw')], newest, changes);
    expect(result.withdrawals.get('first')).toEqual([{ feedstockId: 'a', wetKg: 5 }]);
    expect(result.withdrawals.get('second')).toEqual([{ feedstockId: 'a', wetKg: 5 }, { feedstockId: 'b', wetKg: 10 }]);
    expect(result.withdrawals.get('run')).toEqual([{ feedstockId: 'd', wetKg: 5 }]);
    expect(feedstockMethodAt(newest, changes, at(3))).toEqual(oldest);
  });
});

it('retains an immutable saved share until its intake arrives', () => {
  const result = replayFeedstockDraws([{ ...event('saved', 1, -4, 'run_draw'), savedShares: [{ feedstockId: 'a', wetKg: 4 }] }, event('a', 2, 10)], oldest);
  expect(result.remaining.get('a')).toBe(6);
});

it.each([oldest, newest, mix])('charges legacy saved-share deficits without rewriting provenance: %j', method => {
  const savedShares = [{ feedstockId: 'a', wetKg: 5 }, { feedstockId: 'b', wetKg: 5 }];
  const result = replayFeedstockDraws([
    event('a', 1, 10), { ...event('first', 2, -10, 'run_draw'), savedShares: [{ feedstockId: 'a', wetKg: 10 }] },
    event('b', 3, 10), { ...event('second', 4, -10, 'run_draw'), savedShares },
    event('c', 5, 5), event('run', 6, -5, 'run_draw'),
  ], method);
  expect(result.withdrawals.get('second')).toEqual(savedShares);
  expect(result.withdrawals.get('run')).toEqual([{ feedstockId: 'c', wetKg: 5 }]);
  expect([...result.remaining.values()]).toEqual([0, 0, 0]);
  expect(result.unattributedWetKg).toBe(0);
});

it('charges saved-share deficits to unattributed stock after deliveries are exhausted', () => {
  const result = replayFeedstockDraws([event('a', 1, 5), event('first', 2, -5, 'run_draw'),
    event('count', 3, 5, 'count'), { ...event('saved', 4, -5, 'run_draw'), savedShares: [{ feedstockId: 'a', wetKg: 5 }] }], oldest);
  expect(result.unattributedWetKg).toBe(0);
  expect(result.withdrawals.get('saved')).toEqual([{ feedstockId: 'a', wetKg: 5 }]);
});

it.each(['loss', 'ingredient_draw', 'count'] as const)('refuses an affected %s overdraw but preserves earlier history', kind => {
  const events = [event('a', 1, 10), event('run', 2, -5, 'run_draw'), event('withdrawal', 3, -10, kind), event('b', 4, 10)];
  expect(() => replayFeedstockDraws(events, oldest, [], { occurredAt: at(2) })).toThrow(FeedstockReplayOverdrawError);
  expect(() => replayFeedstockDraws(events, oldest, [], { occurredAt: at(4) })).not.toThrow();
  expect(() => replayFeedstockDraws(events, oldest, [], { occurredAt: at(3), recordedAt: at(3), id: 'withdrawal' })).toThrow(FeedstockReplayOverdrawError);
  expect(() => replayFeedstockDraws(events, oldest, [], { occurredAt: at(3), recordedAt: at(3), id: 'z' })).not.toThrow();
});

it('keeps a holdings point for a reversed loss in the middle of history', () => {
  const result = replayFeedstockDraws([event('a', 1, 10), { ...event('loss', 2, -5, 'loss'), reversed: true }, event('b', 3, 10)], oldest);
  expect([...result.points.get('loss')!]).toEqual([['a', 10]]);
  expect(result.points.size).toBe(3);
});

it.each([oldest, newest, mix])('conserves a positive saved draw with empty shares: %j', method => {
  const result = replayFeedstockDraws([event('a', 1, 100),
    { ...event('saved', 2, -20, 'run_draw'), savedShares: [] }, event('loss', 3, -10, 'loss')], method);
  expect(result.withdrawals.get('saved')).toEqual([]);
  expect([...result.remaining]).toEqual([['a', 70]]);
  expect(result.unattributedWetKg).toBe(0);
});

it.each([
  [oldest, [0, 10]], [newest, [10, 0]], [mix, [5, 5]],
] as const)('charges partially covered saved draws by the active method: %j', (method, remaining) => {
  const savedShares = [{ feedstockId: 'a', wetKg: 10 }];
  const result = replayFeedstockDraws([event('a', 1, 20), event('b', 2, 10),
    { ...event('saved', 3, -20, 'run_draw'), savedShares }], method);
  expect(result.withdrawals.get('saved')).toEqual(savedShares);
  expect([...result.remaining.values()]).toEqual(remaining);
  expect(result.unattributedWetKg).toBe(0);
});
