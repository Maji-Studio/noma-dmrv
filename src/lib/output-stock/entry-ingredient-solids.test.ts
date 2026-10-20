import { describe, expect, it } from 'vitest';
import { entryIngredientSolids } from './entry-ingredient-solids';

const productDryKg = new Map([['p1', 200], ['p2', 100]]);
const saved = new Map([
  ['p1', [{ name: 'Compost', drySolidsKg: 100 }, { name: 'Wood ash', drySolidsKg: 20 }]],
  ['p2', [{ name: 'Compost', drySolidsKg: 50 }]],
]);

describe('entryIngredientSolids', () => {
  it('gives a placed product its saved lines', () => {
    expect(entryIngredientSolids({ dryChangeKg: 200, solidsChangeKg: 320, draws: [{ layerId: 'p1', dryMassKg: 200 }], productDryKg, saved }))
      .toEqual([{ name: 'Compost', solidsKg: 100 }, { name: 'Wood ash', solidsKg: 20 }]);
  });

  it('takes each batch in its own saved shares and sums one material across batches', () => {
    const parts = entryIngredientSolids({ dryChangeKg: -150, solidsChangeKg: null,
      draws: [{ layerId: 'p1', dryMassKg: 100 }, { layerId: 'p2', dryMassKg: 50 }], productDryKg, saved });
    expect(parts).toEqual([{ name: 'Compost', solidsKg: -75 }, { name: 'Wood ash', solidsKg: -10 }]);
  });

  it('splits the posted solids change when it is on record, so the parts add up', () => {
    const parts = entryIngredientSolids({ dryChangeKg: -100, solidsChangeKg: -172, draws: [{ layerId: 'p1', dryMassKg: 100 }], productDryKg, saved });
    expect(parts.map(part => part.name)).toEqual(['Compost', 'Wood ash']);
    expect(parts.reduce((sum, part) => sum + part.solidsKg, 0)).toBeCloseTo(-72);
    expect(parts[0].solidsKg).toBeCloseTo(-60);
  });

  it('has nothing for biochar runs or products without saved lines', () => {
    expect(entryIngredientSolids({ dryChangeKg: -50, solidsChangeKg: -50, draws: [{ layerId: 'run', dryMassKg: 50 }], productDryKg, saved })).toEqual([]);
    expect(entryIngredientSolids({ dryChangeKg: 0, solidsChangeKg: 0, draws: [], productDryKg, saved })).toEqual([]);
  });
});
