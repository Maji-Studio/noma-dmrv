import { describe, expect, it } from 'vitest';
import { replayFeedstockDraws, type FeedstockReplayEvent } from '@/lib/feedstock-draw-replay';
const method = { stockMode: 'split' as const, drawOrder: 'oldest_first' as const };
function event(id: string, kind: FeedstockReplayEvent['kind'], wetDeltaKg: number, hour: string, reversed = false): FeedstockReplayEvent {
  return { id, kind, wetDeltaKg, reversed, occurredAt: `2026-01-01T${hour}:00:00Z`, recordedAt: '2026-01-02T00:00:00Z' };
}
describe('return holding replay', () => {
  it('creates identity in an empty bin instead of unattributed redistribution', () => {
    const replay = replayFeedstockDraws([event('return', 'failed_run_return', 10, '10')], method);
    expect([...replay.remaining]).toEqual([['return', 10]]);
    expect(replay.unattributedWetKg).toBe(0);
  });
  it('retains separate return identities through FIFO loss and mix count reductions', () => {
    const events = [event('a', 'failed_run_return', 10, '10'), event('b', 'failed_run_return', 20, '11'), event('loss', 'loss', -5, '12')];
    expect([...replayFeedstockDraws(events, method).remaining]).toEqual([['a', 5], ['b', 20]]);
    const mixed = replayFeedstockDraws([...events.slice(0, 2), event('count', 'count', -15, '12')], { ...method, stockMode: 'mix' });
    expect([...mixed.remaining]).toEqual([['a', 5], ['b', 10]]);
  });
  it('skips reversed originals and creates a replacement identity', () => {
    const replay = replayFeedstockDraws([event('old', 'failed_run_return', 10, '10', true), event('replacement', 'failed_run_return', 8, '11')], method);
    expect([...replay.remaining]).toEqual([['replacement', 8]]);
  });
});
