import { expect, it } from 'vitest';
import { replayFeedstockDraws, type FeedstockReplayEvent, type FeedstockMethodChange } from '@/lib/feedstock-draw-replay';
import { assertFeedstockEmptyAtSwitch } from './feedstock-intake-boundary';

const changes: FeedstockMethodChange[] = [{ id: 'switch', previousStockMode: 'mix', stockMode: 'split',
  previousDrawOrder: 'oldest_first', drawOrder: 'oldest_first', effectiveAt: '2026-01-01T22:00:00.000Z', createdAt: '2026-01-01T22:00:00.000Z' }];
const intake: FeedstockReplayEvent = { id: 'intake', kind: 'intake', wetDeltaKg: 10,
  occurredAt: '2026-01-01T00:00:00.000Z', recordedAt: '2026-01-01T00:00:00.000Z' };
const draw: FeedstockReplayEvent = { ...intake, id: 'draw', kind: 'run_draw', wetDeltaKg: -10, occurredAt: '2026-01-01T01:00:00.000Z' };
function check(events: FeedstockReplayEvent[]) {
  const replay = replayFeedstockDraws(events, { stockMode: 'split', drawOrder: 'oldest_first' }, changes);
  assertFeedstockEmptyAtSwitch(events, replay.wetTotals, changes, 'Africa/Dar_es_Salaam', 'SL-26-001');
}
it.each(['loss', 'run_draw', 'ingredient_draw'] as const)('refuses deleting the %s that emptied the mixed bin', kind => {
  expect(() => check([intake, { ...draw, kind }])).not.toThrow();
  expect(() => check([intake, { ...draw, kind, reversed: true }])).toThrow(/Bin SL-26-001 was switched to In order at .*Jan 2, 2026.* and had to be empty then\. Keep this change after that time, or record an equal withdrawal before it\./);
  expect(() => check([intake])).toThrow(/had to be empty then/);
});
it('allows an intake moisture correction because wet deltas are unchanged', () => {
  const corrected = { ...intake, moisturePercent: 35, dryKg: 6.5 };
  expect(() => check([corrected, draw])).not.toThrow();
});
it('ignores later additions and accepts sub-gram rounding to zero', () => {
  expect(() => check([{ ...intake, wetDeltaKg: 10.0004 }, draw,
    { ...intake, id: 'later', occurredAt: '2026-01-03T00:00:00.000Z' }])).not.toThrow();
});
