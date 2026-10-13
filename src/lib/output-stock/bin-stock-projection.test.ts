import { describe, expect, it } from 'vitest';
import { decimal, rational } from './exact';
import { projectOutputBinStock, resolveStockLayers, compareStockLayers, type OutputBinStockFacts, type OutputBinStockInput } from './bin-stock-projection';
import { UnresolvedOutputStockError } from './layer-projection';
import type { LayerMoistureBasis } from './moisture-estimate';
import type { OutputStockLayer } from './planner';

const T0 = '2026-09-01T08:00:00.000Z';
const T1 = '2026-09-10T08:00:00.000Z';
const NOW = '2026-09-20T08:00:00.000Z';
const LATER = '2026-09-25T08:00:00.000Z';

const bin: OutputBinStockFacts = { storageLocationId: 'bin', code: 'OB-2', type: 'biochar_bin', facilityId: 'facility', archivedAt: null, formulationId: null };

/** A run layer of `dryKg` with solids equal to its dry biochar. */
function layer(id: string, dryKg: string, placedAt = T0, postingSequence = BigInt(1)): OutputStockLayer {
  return { id, placedAt, postingSequence, establishedDryBiocharKg: dryKg, ingredientDrySolidsKg: '0.000', remainingDryBiocharKg: dryKg,
    remainingSolidsKg: decimal(dryKg), runs: [{ productionRunId: id, establishedDryKg: dryKg, remainingDryKg: dryKg }] };
}
/** The moisture basis a layer recorded `wetKg` with. */
function basis(of: OutputStockLayer, wetKg: string | null, extra: Partial<LayerMoistureBasis> = {}): LayerMoistureBasis {
  return { layerId: of.id, placedAt: of.placedAt, remainingSolidsKg: of.remainingSolidsKg!,
    recorded: wetKg ? { solidsKg: of.remainingSolidsKg!, wetKg: decimal(wetKg) } : null, readings: [], removals: [], ...extra };
}
function input(layers: OutputStockLayer[], changes: Partial<OutputBinStockInput> = {}): OutputBinStockInput {
  const codes = new Map(layers.map(l => [l.id, `PR-${l.id}`]));
  return { bin, stockMode: 'split', at: NOW, layers, bases: layers.map(l => basis(l, String(Number(l.remainingDryBiocharKg) * 2))), codes, ...changes };
}

describe('layer order', () => {
  it('orders by placement, then posting sequence', () => {
    const a = layer('a', '10', T1, BigInt(7));
    const b = layer('b', '10', T1, BigInt(3));
    const c = layer('c', '10', T0, BigInt(9));
    expect([a, b, c].sort(compareStockLayers).map(l => l.id)).toEqual(['c', 'b', 'a']);
  });

  it('falls back to the layer id when placement and sequence tie', () => {
    // Valid projections never tie on sequence; the planner refuses duplicates. The key is defensive.
    const sorted = [layer('z', '1', T0, BigInt(1)), layer('m', '1', T0, BigInt(1))].sort(compareStockLayers);
    expect(sorted.map(l => l.id)).toEqual(['m', 'z']);
  });
});

describe('bin stock projection', () => {
  const old = layer('old', '100', T0, BigInt(1));
  const sameTimeFirst = layer('same-1', '40', T1, BigInt(2));
  const sameTimeSecond = layer('same-2', '60', T1, BigInt(3));

  it('lists held sub-bins oldest first with exact figures', () => {
    const stock = projectOutputBinStock(input([sameTimeSecond, old, sameTimeFirst]));
    expect(stock.status).toBe('resolved');
    expect(stock.subBins.map(s => s.layerId)).toEqual(['old', 'same-1', 'same-2']);
    expect(stock.subBins[0]).toEqual({ layerId: 'old', layerKind: 'production_run', code: 'PR-old', placedAt: T0,
      dryBiocharKg: decimal('100'), solidsKg: decimal('100'), estimatedWetKg: decimal('200'), estimatedMoisturePercent: decimal('50'),
      moistureBasis: { source: 'recorded', at: T0 } });
    expect(stock.totals).toEqual({ dryBiocharKg: decimal('200'), solidsKg: decimal('200'), estimatedWetKg: decimal('400'),
      estimatedMoisturePercent: decimal('50'), moistureBasis: { source: 'recorded', at: T1 } });
  });

  it('gives identical results for shuffled rows', () => {
    const layers = [old, sameTimeFirst, sameTimeSecond];
    const expected = projectOutputBinStock(input(layers));
    for (const order of [[2, 1, 0], [1, 0, 2], [0, 2, 1]]) {
      const shuffled = order.map(i => layers[i]);
      const base = input(layers);
      expect(projectOutputBinStock({ ...base, layers: shuffled, bases: [...base.bases].reverse() })).toEqual(expected);
    }
  });

  it('takes the reading over a recorded basis at the same instant for the totals, whatever the order', () => {
    const counted = basis(old, '200', { readings: [{ moisturePercent: 20, solidsKg: decimal('100'), occurredAt: T1, sequence: BigInt(5) }] });
    const layers = [old, sameTimeFirst];
    const forward = projectOutputBinStock(input(layers, { bases: [counted, basis(sameTimeFirst, '80')] }));
    const backward = projectOutputBinStock(input([...layers].reverse(), { bases: [basis(sameTimeFirst, '80'), counted] }));
    expect(forward.totals?.moistureBasis).toEqual({ source: 'reading', at: T1 });
    expect(backward).toEqual(forward);
  });

  it('holds only layers placed by the instant that still hold solids', () => {
    const future = layer('future', '10', LATER, BigInt(4));
    const spent = { ...layer('spent', '10', T0, BigInt(5)), remainingDryBiocharKg: '0.000', remainingSolidsKg: rational(BigInt(0)) };
    const stock = projectOutputBinStock(input([old, future, spent]));
    expect(stock.subBins.map(s => s.layerId)).toEqual(['old']);
    expect(stock.totals?.dryBiocharKg).toEqual(decimal('100'));
  });

  it('keeps solids a blend holds after its dry biochar reads zero', () => {
    const residual = { ...layer('residual', '10', T0, BigInt(6)), remainingDryBiocharKg: '0.000', remainingSolidsKg: rational(BigInt(1), BigInt(10_000)) };
    expect(projectOutputBinStock(input([residual])).subBins.map(s => s.layerId)).toEqual(['residual']);
  });

  it('gives a mix bin the pile wet mass and moisture only in its totals', () => {
    const stock = projectOutputBinStock(input([old, sameTimeFirst], { stockMode: 'mix' }));
    expect(stock.subBins.map(s => [s.layerId, s.dryBiocharKg, s.solidsKg, s.estimatedWetKg, s.estimatedMoisturePercent, s.moistureBasis]))
      .toEqual([['old', decimal('100'), decimal('100'), null, null, null], ['same-1', decimal('40'), decimal('40'), null, null, null]]);
    expect(stock.totals).toMatchObject({ estimatedWetKg: decimal('280'), estimatedMoisturePercent: decimal('50') });
  });

  it('leaves the wet totals unknown when one held layer has no wet basis', () => {
    const stock = projectOutputBinStock(input([old, sameTimeFirst], { bases: [basis(old, '200'), basis(sameTimeFirst, null)] }));
    expect(stock.subBins[1]).toMatchObject({ estimatedWetKg: null, estimatedMoisturePercent: null, moistureBasis: null });
    expect(stock.totals).toMatchObject({ estimatedWetKg: null, estimatedMoisturePercent: null, moistureBasis: { source: 'recorded', at: T0 } });
  });

  it('answers an empty bin as resolved with zero totals and no moisture, as the bins list does', () => {
    const stock = projectOutputBinStock(input([]));
    expect(stock).toEqual({ bin, stockMode: 'split', status: 'resolved', unresolvedReason: null, subBins: [],
      totals: { dryBiocharKg: rational(BigInt(0)), solidsKg: rational(BigInt(0)), estimatedWetKg: rational(BigInt(0)), estimatedMoisturePercent: null, moistureBasis: null } });
  });

  it('names product layers as biochar products and leaves a missing code for the caller to judge', () => {
    const stock = projectOutputBinStock(input([old], { bin: { ...bin, type: 'product_bin', formulationId: 'formulation' }, codes: new Map() }));
    expect(stock.subBins[0]).toMatchObject({ layerKind: 'biochar_product', code: null });
    expect(stock.bin.formulationId).toBe('formulation');
  });
});

describe('resolving layers', () => {
  it('reports unresolved stock with its reason', () => {
    const outcome = resolveStockLayers(() => { throw new UnresolvedOutputStockError('run_incomplete', 'unresolved'); }, NOW);
    expect(outcome).toMatchObject({ status: 'unresolved', error: { reason: 'run_incomplete' } });
  });

  it('lets any other failure through, such as duplicate posting sequences', () => {
    const twins = [layer('a', '10', T0, BigInt(1)), layer('b', '10', T1, BigInt(1))];
    expect(() => resolveStockLayers(() => twins, NOW)).toThrow(RangeError);
    expect(() => resolveStockLayers(() => { throw new Error('connection lost'); }, NOW)).toThrow('connection lost');
  });

  it('validates resolved layers through the planner', () => {
    expect(resolveStockLayers(() => [layer('a', '10')], NOW)).toMatchObject({ status: 'resolved', layers: [{ id: 'a' }] });
  });
});
