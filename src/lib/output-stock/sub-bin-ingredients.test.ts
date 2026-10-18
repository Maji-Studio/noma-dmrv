import { describe, expect, it } from 'vitest';
import { splitIngredientSolids } from './sub-bin-ingredients';

describe('splitIngredientSolids', () => {
  it('splits what remains in the saved shares, in formulation order', () => {
    expect(splitIngredientSolids(35, [{ name: 'Compost', drySolidsKg: 40 }, { name: 'Clay', drySolidsKg: 30 }]))
      .toEqual([{ name: 'Compost', solidsKg: 20 }, { name: 'Clay', solidsKg: 15 }]);
  });

  it('reads two lines of the same material as one part', () => {
    expect(splitIngredientSolids(30, [{ name: 'Compost', drySolidsKg: 10 }, { name: 'Clay', drySolidsKg: 10 }, { name: 'Compost', drySolidsKg: 10 }]))
      .toEqual([{ name: 'Compost', solidsKg: 20 }, { name: 'Clay', solidsKg: 10 }]);
  });

  it('has no ingredient parts for pure biochar or lines without solids', () => {
    expect(splitIngredientSolids(0, [])).toEqual([]);
    expect(splitIngredientSolids(5, [{ name: 'Water only', drySolidsKg: 0 }])).toEqual([]);
  });

  it('never reads a negative remainder as solids', () => {
    expect(splitIngredientSolids(-1, [{ name: 'Compost', drySolidsKg: 10 }])).toEqual([{ name: 'Compost', solidsKg: 0 }]);
  });
});
