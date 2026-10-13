import { expect, it } from 'vitest';
import { feedstockPile } from './feedstock-pile';

const batches = [{ id: 'a', wetKg: 100, dryKg: 80 }, { id: 'b', wetKg: 100, dryKg: 50 }];
it('keeps saved run draws against their batch when another intake arrives later', () => {
  const pile = feedstockPile(batches, [{ feedstockId: 'a', wetKg: 60 }], 140);
  expect(pile).toEqual([{ id: 'a', wetKg: 40, dryKg: 32 }, { id: 'b', wetKg: 100, dryKg: 50 }]);
});
it('pro-rates only stock without per-batch saved effects over the remaining batches', () => {
  expect(feedstockPile(batches, [{ feedstockId: 'a', wetKg: 60 }], 70))
    .toEqual([{ id: 'a', wetKg: 20, dryKg: 16 }, { id: 'b', wetKg: 50, dryKg: 25 }]);
});
