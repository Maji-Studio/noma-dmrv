import { describe, expect, it } from 'vitest';
import { pileFigures, stockParts, subBinFigures, type StockFigures } from './stock-parts';

const figures = (values: Partial<StockFigures> = {}): StockFigures => ({ dryKg: 80, solidsKg: 90, wetKg: 100, ingredients: new Map(), ...values });

describe('stockParts', () => {
  it('keeps unknown wet and solids honest, without losing recorded wet', () => {
    expect(stockParts(figures({ wetKg: null }))).toMatchObject({ waterKg: null, wetKg: null, sizeKg: 90 });
    expect(stockParts(figures({ solidsKg: null }))).toMatchObject({ waterKg: null, ingredientSolidsKg: null, wetKg: 100, sizeKg: 80 });
    expect(stockParts(figures({ wetKg: 85 }))).toMatchObject({ waterKg: null, wetKg: 85, sizeKg: 90 });
    expect(stockParts(figures({ solidsKg: 79, wetKg: 80 }))).toMatchObject({ ingredientSolidsKg: 0, waterKg: 1 });
  });

  it('keeps a tiny dry-only sub-bin unrounded and sized by its actual mass', () => {
    const parts = stockParts(subBinFigures({ dryMassKg: 0.04, solidsKg: 0.04, wetEstimateKg: null, ingredients: [] }));
    expect(parts).toEqual({ dryBiocharKg: 0.04, ingredientSolidsKg: 0, waterKg: null, wetKg: null,
      sizeKg: 0.04, rows: [{ kind: 'dry', kg: 0.04 }] });
  });

  it('filters named parts before calculating the unnamed rest, with dry always last', () => {
    const parts = stockParts(figures({ ingredients: new Map([['compost', 9.94], ['dust', 0.04]]) }));
    expect(parts.rows.slice(0, 2)).toEqual([{ kind: 'water', kg: 10 }, { kind: 'ingredient', name: 'compost', kg: 9.94 }]);
    expect(parts.rows[2]).toMatchObject({ kind: 'ingredient', name: null });
    expect(parts.rows[2].kg).toBeCloseTo(0.06);
    expect(parts.rows[3]).toEqual({ kind: 'dry', kg: 80 });
    expect(parts.ingredientSolidsKg).toBe(10);
  });

  it('sums duplicate names and reads wet only from the pile argument', () => {
    const layers = [
      { dryMassKg: 80, solidsKg: 120, ingredients: [{ name: 'compost', solidsKg: 40 }], wetEstimateKg: null },
      { dryMassKg: 80, solidsKg: 120, ingredients: [{ name: 'compost', solidsKg: 40 }], wetEstimateKg: null },
    ];
    expect(pileFigures(layers, 400)).toEqual({ dryKg: 160, solidsKg: 240, wetKg: 400, ingredients: new Map([['compost', 80]]) });
    expect(stockParts(pileFigures(layers, 400))).toMatchObject({ waterKg: 160, sizeKg: 400 });
  });
});
