import { describe, expect, it } from 'vitest';
import { add, decimal, grams, kilograms, rationalToNumber, type Rational } from './exact';
import { estimateStock, planReadings, withReadings, type LayerMoistureBasis } from './moisture-estimate';
import { planOutputStock, type OutputStockLayer, type OutputStockRequest } from './planner';

const T0 = '2026-09-01T08:00:00.000Z';
const AT = '2026-09-15T10:00:00.000Z';

/** A pure-biochar batch in the pile: its dry biochar is its solids. */
function batch(id: string, solidsKg: string, sequence: number, placedAt = T0): OutputStockLayer {
  return { id, placedAt, postingSequence: BigInt(sequence), establishedDryBiocharKg: solidsKg, ingredientDrySolidsKg: '0', remainingDryBiocharKg: solidsKg,
    runs: [{ productionRunId: id, establishedDryKg: solidsKg, remainingDryKg: solidsKg }] };
}
/** The batch's moisture basis: the solids and wet mass recorded when it was added. */
function basis(layer: OutputStockLayer, wetKg: string): LayerMoistureBasis {
  const solids = decimal(String(layer.establishedDryBiocharKg));
  return { layerId: layer.id, placedAt: layer.placedAt, remainingSolidsKg: solids, recorded: { solidsKg: solids, wetKg: decimal(wetKg) }, readings: [] };
}
const drawn = (layers: readonly OutputStockLayer[], at: string, request: OutputStockRequest) => planOutputStock(layers, at, request, 'pro_rata');
const kg = (value: Rational | undefined) => rationalToNumber(value!);
/** Moisture bases with the plan's remaining solids, as the preview reads them after a draw. */
const afterDraw = (bases: LayerMoistureBasis[], remaining: readonly OutputStockLayer[]) =>
  bases.map(b => ({ ...b, remainingSolidsKg: remaining.find(l => l.id === b.layerId)!.remainingSolidsKg ?? b.remainingSolidsKg }));

describe('mix bins: the plan worked example, to the gram', () => {
  // 1,636.8 kg solids in batch shares of 45%, 35% and 20%, all at 31.8% (2,400 kg wet).
  const pile = () => [batch('B-0412', '736.56', 1), batch('B-0419', '572.88', 2), batch('B-0426', '327.36', 3)];
  const bases = () => { const [a, b, c] = pile(); return [basis(a, '1080'), basis(b, '840'), basis(c, '480')]; };
  const delivery = { kind: 'wet', wetKg: 1000, moisturePercent: 26.7 } as const;

  it('estimates the pile at 31.8% and 2,400 kg wet before the delivery', () => {
    const estimate = estimateStock(bases(), AT);
    expect(estimate.moisturePercent).toBeCloseTo(31.8, 9);
    expect(estimate.wetKg).toBeCloseTo(2400, 9);
  });

  it('draws 733.0 kg solids from every batch in proportion to what it holds', () => {
    const plan = drawn(pile(), AT, delivery);
    expect(plan.allocations.map(a => [a.layerId, a.dryKg])).toEqual([['B-0412', '329.850'], ['B-0419', '256.550'], ['B-0426', '146.600']]);
    expect(plan.drawnDryKg).toBe('733.000');
    expect(plan.remainingLayers.map(l => l.remainingDryBiocharKg)).toEqual(['406.710', '316.330', '180.760']);
    expect(plan.allocations.map(a => a.readingPercent)).toEqual([26.7, 26.7, 26.7]);
    // Every batch leaves at the one reading, so the wet shares close to the load.
    expect(plan.allocations.reduce((sum, a) => sum + kg(a.wetShareKg ?? undefined), 0)).toBeCloseTo(1000, 9);
  });

  it('resets the whole pile to the reading: 31.8% / 1,325 kg becomes 26.7% / 1,233 kg', () => {
    const plan = drawn(pile(), AT, delivery);
    const readings = planReadings(delivery, plan, AT, 'pro_rata');
    expect(readings.map(r => [r.layerId, r.moisturePercent])).toEqual([['B-0412', 26.7], ['B-0419', 26.7], ['B-0426', 26.7]]);
    const remaining = afterDraw(bases(), plan.remainingLayers);
    const before = estimateStock(remaining, AT);
    expect(before.solidsKg).toBeCloseTo(903.8, 9);
    expect(before.moisturePercent).toBeCloseTo(31.8, 9);
    expect(before.wetKg).toBeCloseTo(1325.22, 2);
    const after = estimateStock(withReadings(remaining, readings, AT, BigInt(10)), AT);
    expect(after.moisturePercent).toBeCloseTo(26.7, 9);
    expect(after.wetKg).toBeCloseTo(1233.02, 2);
  });

  it('a later batch of 600 kg wet at 35% brings the pile to 1,833.0 kg wet at 29.4%', () => {
    const plan = drawn(pile(), AT, delivery);
    const reset = withReadings(afterDraw(bases(), plan.remainingLayers), planReadings(delivery, plan, AT, 'pro_rata'), AT, BigInt(10));
    const added = { ...basis(batch('B-0433', '390', 4, '2026-09-16T10:00:00.000Z'), '600') };
    const estimate = estimateStock([...reset, added], '2026-09-17T10:00:00.000Z');
    expect(estimate.solidsKg).toBeCloseTo(1293.8, 9);
    expect(estimate.wetKg).toBeCloseTo(1833.02, 2);
    expect(estimate.moisturePercent).toBeCloseTo(29.417, 3);
  });
});

describe('mix bins: why timing matters', () => {
  // 2,000 kg at 30% (1,400 kg solids); 100 kg at 50% (50 kg solids) arrives the same day.
  const pile = batch('P', '1400', 1);
  const pileBasis = basis(pile, '2000');
  const removal = (moisturePercent: number) => ({ kind: 'wet', wetKg: 1000, moisturePercent }) as const;

  it('removed at 10:00 before a 14:00 addition, it takes 700.0 kg and the pile ends at 31.8%', () => {
    const plan = drawn([pile], AT, removal(30));
    expect(plan.drawnDryKg).toBe('700.000');
    const reset = withReadings(afterDraw([pileBasis], plan.remainingLayers), planReadings(removal(30), plan, AT, 'pro_rata'), AT, BigInt(2));
    const addition = basis(batch('Q', '50', 3, '2026-09-15T14:00:00.000Z'), '100');
    const estimate = estimateStock([...reset, addition], '2026-09-15T15:00:00.000Z');
    expect(estimate.moisturePercent).toBeCloseTo(31.818, 3);
  });

  it('with the addition at 09:00, the pile reads 30.95% and the removal takes 690.5 kg', () => {
    const early = batch('Q', '50', 3, '2026-09-15T09:00:00.000Z');
    const estimate = estimateStock([pileBasis, basis(early, '100')], AT);
    expect(estimate.moisturePercent).toBeCloseTo(30.952, 3);
    const plan = drawn([pile, early], AT, removal(30.95));
    expect(plan.drawnDryKg).toBe('690.500');
    expect(plan.allocations.map(a => [a.layerId, a.dryKg])).toEqual([['P', '666.690'], ['Q', '23.810']]);
  });
});

describe('mix bins: pro-rata invariants', () => {
  it('spreads a loss the same way as a delivery', () => {
    const plan = drawn([batch('A', '600', 1), batch('B', '400', 2)], AT, { kind: 'wet', wetKg: 100, moisturePercent: 0 });
    expect(plan.allocations.map(a => a.dryKg)).toEqual(['60.000', '40.000']);
  });

  it('spreads a count shortfall pro-rata, and a positive difference draws nothing', () => {
    const layers = [batch('A', '600', 1), batch('B', '400', 2)];
    // 900 kg wet at 10% is 810 kg solids: 190 kg short of the records.
    const short = drawn(layers, AT, { kind: 'count', wetKg: 900, moisturePercent: 10 });
    expect(short.allocations.map(a => a.dryKg)).toEqual(['114.000', '76.000']);
    expect(kg(short.discrepancySolidsKg)).toBeCloseTo(-190, 9);
    const over = drawn(layers, AT, { kind: 'count', wetKg: 1200, moisturePercent: 10 });
    expect(over.allocations).toEqual([]);
    expect(kg(over.discrepancySolidsKg)).toBeCloseTo(80, 9);
  });

  it('a zero count closes every batch exactly', () => {
    const plan = drawn([batch('A', '600.001', 1), batch('B', '0.333', 2)], AT, { kind: 'count', wetKg: 0 });
    expect(plan.allocations.map(a => a.dryKg)).toEqual(['600.001', '0.333']);
    expect(plan.remainingLayers.every(l => l.remainingDryBiocharKg === '0.000' && l.remainingSolidsKg!.numerator === BigInt(0))).toBe(true);
  });

  it('a load of exactly the pile closes every batch', () => {
    const plan = drawn([batch('A', '700', 1), batch('B', '0.7', 2)], AT, { kind: 'wet', wetKg: 1001, moisturePercent: 30 });
    expect(plan.drawnDryKg).toBe('700.700');
    expect(plan.remainingLayers.every(l => l.remainingSolidsKg!.numerator === BigInt(0))).toBe(true);
  });

  it('draws solids that sum to the measured load exactly', () => {
    const plan = drawn([batch('A', '100', 1), batch('B', '100', 2), batch('C', '100', 3)], AT, { kind: 'wet', wetKg: 100, moisturePercent: 0 });
    const total = plan.allocations.reduce((sum, a) => add(sum, a.solidsKg), decimal('0'));
    expect(total).toEqual(decimal('100'));
    expect(plan.allocations.map(a => a.dryKg)).toEqual(['33.333', '33.333', '33.333']);
  });

  it('blocks a load holding more solids than the pile', () => {
    expect(() => drawn([batch('A', '600', 1), batch('B', '400', 2)], AT, { kind: 'wet', wetKg: 1000.001, moisturePercent: 0 })).toThrow('Insufficient');
  });

  it('only draws batches present at the time of the removal', () => {
    const plan = drawn([batch('A', '600', 1), batch('late', '400', 2, '2026-09-15T10:00:00.001Z')], AT, { kind: 'wet', wetKg: 100, moisturePercent: 0 });
    expect(plan.allocations.map(a => [a.layerId, a.dryKg])).toEqual([['A', '100.000']]);
  });

  it('takes solids pro-rata, so a blended batch keeps its biochar share', () => {
    // 900 dry biochar + 100 ingredient solids beside 1,000 pure: each gives 500 kg solids.
    const blended = { ...batch('blend', '900', 1), ingredientDrySolidsKg: '100' };
    const plan = drawn([blended, batch('pure', '1000', 2)], AT, { kind: 'wet', wetKg: 1000, moisturePercent: 0 });
    expect(plan.allocations.map(a => a.dryKg)).toEqual(['450.000', '500.000']);
  });

  it('keeps each batch\'s source-run proportions', () => {
    const mixed = { ...batch('mixed', '1300', 1), runs: [{ productionRunId: 'r1', establishedDryKg: '760', remainingDryKg: '760' }, { productionRunId: 'r2', establishedDryKg: '540', remainingDryKg: '540' }] };
    const plan = drawn([mixed, batch('other', '1300', 2)], AT, { kind: 'wet', wetKg: 1300, moisturePercent: 0 });
    expect(plan.allocations[0].runs.map(r => r.dryKg)).toEqual(['380.000', '270.000']);
  });

  it('refuses a sub-bin order', () => {
    expect(() => drawn([batch('A', '600', 1)], AT, { kind: 'ordered', wetKg: 10, sources: [{ layerId: 'A', moisturePercent: 10 }] })).toThrow(RangeError);
  });

  it('keeps exact solids bounded and conserves every gram across many removals at odd readings', () => {
    let layers: OutputStockLayer[] = Array.from({ length: 40 }, (_, i) => ({ ...batch(`L${i}`, (97.123 + i * 13.007).toFixed(3), i + 1), ingredientDrySolidsKg: (i % 3 === 0 ? '11.111' : '0') }));
    const established = layers.reduce((sum, l) => sum + grams(l.establishedDryBiocharKg), BigInt(0));
    let removed = BigInt(0);
    for (let i = 0; i < 120; i++) {
      const plan = drawn(layers, AT, { kind: 'wet', wetKg: (17.321 + (i % 5)).toFixed(3), moisturePercent: (23.917 + (i % 7) * 1.013).toFixed(3) });
      removed += grams(plan.drawnDryKg);
      layers = plan.remainingLayers;
    }
    expect(layers.every(l => (l.remainingSolidsKg?.denominator ?? BigInt(1)).toString(2).length < 128)).toBe(true);
    const close = drawn(layers, AT, { kind: 'count', wetKg: 0 });
    expect(kilograms(removed + grams(close.drawnDryKg))).toBe(kilograms(established));
    expect(close.remainingLayers.every(l => l.runs.every(r => r.remainingDryKg === '0.000'))).toBe(true);
  });
});

describe('mix bins: readings', () => {
  it('a reading resets every batch in the pile, even one too small to share in the draw', () => {
    const layers = [batch('A', '1000', 1), batch('dust', '0.001', 2), batch('late', '10', 3, '2026-09-16T10:00:00.000Z')];
    // 1 g of solids: the dust's share is below the planner's microgram grid.
    const request = { kind: 'wet', wetKg: 0.00125, moisturePercent: 20 } as const;
    const plan = drawn(layers, AT, request);
    expect(plan.allocations.map(a => a.layerId)).toEqual(['A']);
    expect(planReadings(request, plan, AT, 'pro_rata').map(r => r.layerId)).toEqual(['A', 'dust']);
  });

  it('a count resets the pile at the counted moisture', () => {
    const layers = [batch('A', '600', 1), batch('B', '400', 2)];
    const request = { kind: 'count', wetKg: 900, moisturePercent: 10 } as const;
    expect(planReadings(request, drawn(layers, AT, request), AT, 'pro_rata').map(r => [r.layerId, r.moisturePercent])).toEqual([['A', 10], ['B', 10]]);
  });
});
