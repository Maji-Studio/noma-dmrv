import { expect, it } from 'vitest';
import { earliestFeedstockEventTie } from './feedstock-event-boundary';
it('uses millisecond timestamps then IDs, independently of input order', () => {
  const a = { id: 'a', recordedAt: new Date('2026-01-01T00:00:00.123999Z') };
  const b = { id: 'b', recordedAt: new Date('2026-01-01T00:00:00.123001Z') };
  expect(earliestFeedstockEventTie([b, a])).toEqual(a);
  expect(earliestFeedstockEventTie([a, { id: 'z', recordedAt: new Date('2026-01-01T00:00:00.122Z') }])?.id).toBe('z');
  expect(earliestFeedstockEventTie([])).toBeUndefined();
});
