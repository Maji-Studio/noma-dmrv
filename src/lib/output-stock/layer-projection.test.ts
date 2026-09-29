import { describe, expect, it } from 'vitest';
import { rational, storeRational } from './exact';
import { outputStockBalance, projectBiocharLayers, projectMoistureBases, projectProductLayers, UnresolvedOutputStockError, type AllocationEffectRow, type CompletedRunRow } from './layer-projection';

const run: CompletedRunRow = { id: 'run', dryKg: '100.000', endTime: new Date('2026-09-01T12:00:00.000Z'), postingSequence: BigInt(1) };
const noRows = { sources: [], effects: [] };

/** A saved draw of `dryKg` from a layer, with the solids it took. */
function effect(id: string, layer: { productionRunId?: string; biocharProductId?: string }, dryKg: string, solidsKg: bigint, extra: Partial<AllocationEffectRow['allocation']> = {}): AllocationEffectRow {
  return {
    allocation: { id, productionRunId: layer.productionRunId ?? null, biocharProductId: layer.biocharProductId ?? null, targetBiocharProductId: null,
      dryMassKg: dryKg, basisSnapshot: { solidsKg: storeRational(rational(solidsKg)) }, ...extra },
    run: null,
  };
}

describe('biochar layers', () => {
  it.each([null, 'NaN', 'Infinity', '0'])('treats run dry mass %s as unresolved', dryKg => {
    expect(() => projectBiocharLayers({ runs: [{ ...run, dryKg }], ...noRows })).toThrow(UnresolvedOutputStockError);
  });

  it('treats a run with no end time as unresolved', () => {
    expect(() => projectBiocharLayers({ runs: [{ ...run, endTime: null }], ...noRows })).toThrow(UnresolvedOutputStockError);
  });

  it('counts a product draw once when both its source snapshot and ledger allocation exist', () => {
    const [layer] = projectBiocharLayers({
      runs: [run],
      sources: [{ productId: 'posted', runId: run.id, dryKg: '30.000' }, { productId: 'legacy', runId: run.id, dryKg: '10.000' }],
      effects: [effect('a1', { productionRunId: run.id }, '30.000', BigInt(30), { targetBiocharProductId: 'posted' })],
    });
    expect(layer).toMatchObject({ remainingDryBiocharKg: '60.000', establishedDryBiocharKg: '100.000' });
    expect(layer.remainingSolidsKg).toEqual(rational(BigInt(60)));
  });

  it('counts an allocation split across runs once', () => {
    const split = effect('a1', { productionRunId: run.id }, '20.000', BigInt(20));
    const [layer] = projectBiocharLayers({ runs: [run], sources: [], effects: [split, { ...split, run: { productionRunId: run.id, dryMassKg: '20.000' } }] });
    expect(layer.remainingDryBiocharKg).toBe('80.000');
  });

  describe('repair exclusion', () => {
    const unresolved = { ...run, dryKg: null };
    const options = { excludeUnresolvedRunId: run.id };

    it('drops only the unresolved run being repaired', () => {
      const other = { ...run, id: 'other' };
      expect(projectBiocharLayers({ runs: [unresolved, other], ...noRows }, options).map(layer => layer.id)).toEqual(['other']);
    });

    it('refuses to drop resolved stock', () => {
      expect(() => projectBiocharLayers({ runs: [run], ...noRows }, options)).toThrow('Only unresolved');
    });

    it('still fails on another unresolved run', () => {
      expect(() => projectBiocharLayers({ runs: [{ ...unresolved, id: 'other' }], ...noRows }, options)).toThrow(UnresolvedOutputStockError);
    });

    it('refuses to drop a run something already drew from', () => {
      expect(() => projectBiocharLayers({ runs: [unresolved], sources: [{ productId: 'p', runId: run.id, dryKg: '1.000' }], effects: [] }, options)).toThrow('downstream allocations');
      expect(() => projectBiocharLayers({ runs: [unresolved], sources: [], effects: [effect('a1', { productionRunId: run.id }, '1.000', BigInt(1))] }, options)).toThrow('downstream allocations');
    });
  });
});

describe('product layers', () => {
  const product = { id: 'product', placedAt: new Date('2026-09-01T12:00:00.000Z'), postingSequence: BigInt(1) };
  const zeroLine = { formulationIngredientId: 'zero', massKg: 0 };
  const positiveLine = { formulationIngredientId: 'positive', massKg: 50 };
  const snapshot = { biocharProductId: 'product', formulationIngredientId: 'positive', drySolidsKg: '40.000' };
  const project = (lines: unknown[], ingredients: typeof snapshot[]) => projectProductLayers({
    products: [{ ...product, composition: { ingredients: lines } }],
    sources: [{ productId: 'product', runId: 'run', dryKg: '100.000' }], ingredients, effects: [] });

  it('requires no snapshot for zero lines and sums only frozen positive solids', () => {
    expect(project([zeroLine], [])[0].ingredientDrySolidsKg).toBe('0.000');
    const [mixed] = project([zeroLine, positiveLine], [snapshot]);
    expect(mixed).toMatchObject({ ingredientDrySolidsKg: '40.000', establishedDryBiocharKg: '100.000' });
    expect(mixed.remainingSolidsKg).toEqual(rational(BigInt(140)));
  });

  it('rejects missing positive snapshots even when a zero-line snapshot fills the count', () => {
    expect(() => project([zeroLine, positiveLine], [])).toThrow('Ingredient dry solids are unresolved');
    expect(() => project([zeroLine, positiveLine], [{ ...snapshot, formulationIngredientId: 'zero' }])).toThrow('Ingredient dry solids are unresolved');
  });

  it('treats a product with no placement time as unresolved', () => {
    expect(() => projectProductLayers({ products: [{ ...product, placedAt: null, composition: {} }], sources: [], ingredients: [], effects: [] })).toThrow(UnresolvedOutputStockError);
  });

  it('reduces each source run by its share of saved draws', () => {
    const draw = effect('a1', { biocharProductId: 'product' }, '25.000', BigInt(25));
    const [layer] = projectProductLayers({ products: [{ ...product, composition: {} }], ingredients: [],
      sources: [{ productId: 'product', runId: 'r1', dryKg: '60.000' }, { productId: 'product', runId: 'r2', dryKg: '40.000' }],
      effects: [{ ...draw, run: { productionRunId: 'r1', dryMassKg: '15.000' } }, { ...draw, run: { productionRunId: 'r2', dryMassKg: '10.000' } }] });
    expect(layer.remainingDryBiocharKg).toBe('75.000');
    expect(layer.runs.map(r => r.remainingDryKg)).toEqual(['45.000', '30.000']);
  });
});

describe('balance at an instant', () => {
  const later = { ...run, id: 'later', endTime: new Date('2026-09-16T12:00:00.000Z'), postingSequence: BigInt(2) };
  const layers = projectBiocharLayers({ runs: [run, later], ...noRows });

  it('keeps later receipts in the all-layers balance but out of availability', () => {
    expect(outputStockBalance(layers, '2026-09-15T12:00:00.000Z')).toMatchObject({ allLayersDryKg: '200.000', availableDryKg: '100.000' });
  });

  it.each([['2026-09-16T11:59:00.000Z', '100.000'], ['2026-09-16T12:00:00.000Z', '200.000']])('counts a layer from the instant it was placed (%s)', (at, availableDryKg) => {
    expect(outputStockBalance(layers, at).availableDryKg).toBe(availableDryKg);
  });
});

describe('moisture bases', () => {
  const [layer] = projectBiocharLayers({ runs: [run], ...noRows });
  const reading = (movementId: string, moisturePercent: number) => ({ layerId: run.id, movementId, moisturePercent, occurredAt: new Date('2026-09-02T12:00:00.000Z'), sequence: BigInt(1) });

  it('uses the recorded wet mass and drops readings a correction reversed', () => {
    const [basis] = projectMoistureBases([layer], { recordedWetKg: new Map([[run.id, '125.000']]), readings: [reading('kept', 10), reading('reversed', 30)], reversedMovementIds: new Set(['reversed']) });
    expect(basis.recorded).toEqual({ solidsKg: rational(BigInt(100)), wetKg: rational(BigInt(125)) });
    expect(basis.readings.map(r => r.moisturePercent)).toEqual([10]);
  });

  it.each([null, 'NaN', '-1'])('has no recorded basis for wet mass %s', wet => {
    expect(projectMoistureBases([layer], { recordedWetKg: new Map([[run.id, wet]]), readings: [], reversedMovementIds: new Set() })[0].recorded).toBeNull();
  });
});
