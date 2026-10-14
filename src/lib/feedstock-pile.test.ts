import { expect, it } from 'vitest';
import { feedstockPile, feedstockPileTimeline } from './feedstock-pile';

const batches = [{ id: 'a', wetKg: 100, dryKg: 80 }, { id: 'b', wetKg: 100, dryKg: 50 }];
it('keeps saved run draws against their batch when another intake arrives later', () => {
  const pile = feedstockPile(batches, [{ feedstockId: 'a', wetKg: 60 }], 140);
  expect(pile).toEqual([{ id: 'a', wetKg: 40, dryKg: 32 }, { id: 'b', wetKg: 100, dryKg: 50 }]);
});

it('spreads a loss only over the batches already received at that ledger point', () => {
  const result = feedstockPileTimeline([
    { intake: batches[0], wetDeltaKg: 100 }, { wetDeltaKg: -50 }, { intake: batches[1], wetDeltaKg: 100 },
  ]);
  expect(result.batches).toEqual([{ id: 'a', wetKg: 50, dryKg: 40 }, { id: 'b', wetKg: 100, dryKg: 50 }]);
  expect(result.points.map(point => point.dryKg)).toEqual([80, 40, 90]);
});

it('uses each ordered prefix for same-time intakes and saved batch draws', () => {
  const result = feedstockPileTimeline([
    { intake: batches[0], wetDeltaKg: 100 },
    { wetDeltaKg: -60, draws: [{ feedstockId: 'a', wetKg: 60 }] },
    { intake: batches[1], wetDeltaKg: 100 },
    { wetDeltaKg: -70 },
  ]);
  expect(result.points.map(point => point.dryKg)).toEqual([80, 32, 82, 41]);
  expect(result.batches).toEqual([{ id: 'a', wetKg: 20, dryKg: 16 }, { id: 'b', wetKg: 50, dryKg: 25 }]);
});

it('retains saved shares when a run is dated before its intake', () => {
  const result = feedstockPileTimeline([
    { wetDeltaKg: -60, draws: [{ feedstockId: 'a', wetKg: 60 }] },
    { intake: batches[0], wetDeltaKg: 100 }, { intake: batches[1], wetDeltaKg: 100 },
  ]);
  expect(result.points.map(point => point.dryKg)).toEqual([null, 32, 82]);
  expect(result.batches).toEqual([{ id: 'a', wetKg: 40, dryKg: 32 }, { id: 'b', wetKg: 100, dryKg: 50 }]);
});
it('pro-rates only stock without per-batch saved effects over the remaining batches', () => {
  expect(feedstockPile(batches, [{ feedstockId: 'a', wetKg: 60 }], 70))
    .toEqual([{ id: 'a', wetKg: 20, dryKg: 16 }, { id: 'b', wetKg: 50, dryKg: 25 }]);
});
