import { describe, expect, it } from 'vitest';
import { grams, kilograms, splitGrams } from './exact';
import { planOutputStock, type OutputStockLayer } from './planner';
const DAY = '2026-09-14';
function layer(id: string, dry: string, ingredients = '0', sequence = BigInt(1)): OutputStockLayer {
  return { id, physicalDate: DAY, postingSequence: sequence, establishedDryBiocharKg: dry, ingredientDrySolidsKg: ingredients, remainingDryBiocharKg: dry,
    runs: [{ productionRunId: id, establishedDryKg: dry, remainingDryKg: dry }] };
}
const mixes = () => [layer('A', '900', '200'), layer('B', '600', '120', BigInt(2))];
const wet = (layers: OutputStockLayer[], wetKg: number, moisturePercent: number) => planOutputStock(layers, DAY, { kind: 'wet', wetKg, moisturePercent });
const rain = () => wet(mixes(), 2000, 30);
describe('issue 756 exact FIFO', () => {
  it('rain load and half mixed application', () => {
    const plan = rain();
    expect(plan.allocations.map(a => a.dryKg)).toEqual(['900.000', '250.000']);
    expect(plan.drawnDryKg).toBe('1150.000');
    expect(plan.remainingLayers[1].remainingDryBiocharKg).toBe('350.000');
    expect(splitGrams(BigInt(575000), plan.allocations.map(a => grams(a.dryKg)))).toEqual([BigInt(450000), BigInt(125000)]);
  });
  it('dry load rounds only final partial layer and conserves remainder', () => {
    const p = wet(mixes(), 2000, 20);
    expect(p.drawnDryKg).toBe('1316.667');
    expect(p.remainingLayers[1].remainingDryBiocharKg).toBe('183.333');
  });
  it.each([[2500, 15, false], [1500, 15, true]])('blocks shortage %s', (w, m, onlyA) => {
    expect(() => wet(onlyA ? mixes().slice(0, 1) : mixes(), w, m)).toThrow('Insufficient');
  });
  it('loss and equal/zero/excess counts', () => {
    const remaining = rain().remainingLayers;
    expect(wet(remaining, 120, 30).drawnDryKg).toBe('70.000');
    expect(wet(remaining, 120, 30).remainingLayers[1].remainingDryBiocharKg).toBe('280.000');
    expect(planOutputStock(remaining, DAY, { kind: 'count', wetKg: 600, moisturePercent: 30 }).drawnDryKg).toBe('0.000');
    const zero = planOutputStock(remaining, DAY, { kind: 'count', wetKg: 0 });
    expect(zero.drawnDryKg).toBe('350.000');
    expect(zero.allocations[0].runs).toEqual([{ productionRunId: 'B', dryKg: '350.000' }]);
    const excess = planOutputStock(remaining, DAY, { kind: 'count-solids', solidsKg: 500 });
    expect(excess.drawnDryKg).toBe('0.000');
    expect(excess.remainingLayers).toEqual(remaining);
    expect(excess.discrepancySolidsKg.numerator).toBe(BigInt(80));
  });
  it('no-loss pure drying and pure FIFO source withdrawal', () => {
    expect(planOutputStock([layer('dry', '100')], DAY, { kind: 'count', wetKg: 100, moisturePercent: 0 }).drawnDryKg).toBe('0.000');
    const p = wet([layer('R1', '760'), layer('R2', '540', '0', BigInt(2))], 1000, 8);
    expect(p.allocations.map(a => a.dryKg)).toEqual(['760.000', '160.000']);
    expect(p.drawnDryKg).toBe('920.000');
    expect(p.remainingLayers[1].remainingDryBiocharKg).toBe('380.000');
  });
  it('checks subgram solids shortage before rounding', () => {
    expect(() => planOutputStock([layer('one', '0.001')], DAY, { kind: 'solids', solidsKg: '0.001000000001' })).toThrow('Insufficient');
    expect(planOutputStock([layer('one', '0.001')], DAY, { kind: 'solids', solidsKg: '0.0005' }).drawnDryKg).toBe('0.001');
  });
  it('rejects repeated nonzero draws that would round to zero dry stock', () => {
    expect(() => wet([layer('pure', '1')], 0.001, 99)).toThrow('below one gram');
    expect(() => wet([layer('blend', '1', '9')], 0.001, 0)).toThrow('below one gram');
  });
  it('carries exact residual capacity across repeated rounded partial draws', () => {
    const first = wet([layer('pure', '0.003')], 0.0014, 0);
    expect(first.drawnDryKg).toBe('0.001');
    const second = wet(first.remainingLayers, 0.0014, 0);
    expect(second.drawnDryKg).toBe('0.002');
    expect(() => wet(second.remainingLayers, 0.001, 0)).toThrow('Insufficient');
    const close = planOutputStock(second.remainingLayers, DAY, { kind: 'count', wetKg: 0 });
    expect(close.drawnDryKg).toBe('0.000');
    expect(close.remainingLayers[0].remainingSolidsKg?.numerator).toBe(BigInt(0));
  });
  it('passes an exhausted dry layer physical residual before drawing the next layer', () => {
    const first = wet([layer('A', '0.001'), layer('B', '0.002', '0', BigInt(2))], 0.0006, 0);
    const second = wet(first.remainingLayers, 0.001, 0);
    expect(second.allocations.map(allocation => allocation.dryKg)).toEqual(['0.000', '0.001']);
  });
  it('keeps frozen run proportions through hundreds of one-gram withdrawals', () => {
    let layers = [layer('mixed', '1.300')];
    layers[0].runs = [{ productionRunId: 'R1', establishedDryKg: '0.760', remainingDryKg: '0.760' },
      { productionRunId: 'R2', establishedDryKg: '0.540', remainingDryKg: '0.540' }];
    for (let index = 0; index < 220; index += 1) layers = wet(layers, 0.001, 0).remainingLayers;
    expect(layers[0].runs.map(run => run.remainingDryKg)).toEqual(['0.631', '0.449']);
    const close = planOutputStock(layers, DAY, { kind: 'count', wetKg: 0 });
    expect(close.allocations[0].runs.map(run => run.dryKg)).toEqual(['0.631', '0.449']);
  });
  it('repeated proportional run depletion and final closure', () => {
    let layers = [layer('mixed', '1.003', '0.200')];
    layers[0].runs = [{ productionRunId: 'r1', establishedDryKg: '0.500', remainingDryKg: '0.500' }, { productionRunId: 'r2', establishedDryKg: '0.503', remainingDryKg: '0.503' }];
    let drawn = BigInt(0);
    for (let i = 0; i < 10; i++) {
      const p = planOutputStock(layers, DAY, { kind: 'solids', solidsKg: '0.1' });
      expect(p.allocations.reduce((s, a) => s + a.runs.reduce((t, r) => t + grams(r.dryKg), BigInt(0)), BigInt(0))).toBe(grams(p.drawnDryKg));
      drawn += grams(p.drawnDryKg); layers = p.remainingLayers;
    }
    const final = planOutputStock(layers, DAY, { kind: 'count', wetKg: 0 });
    expect(kilograms(drawn + grams(final.drawnDryKg))).toBe('1.003');
    expect(final.remainingLayers[0].runs.every(r => grams(r.remainingDryKg) === BigInt(0))).toBe(true);
  });
  it('physical dates exclude future and same-day order uses posting sequence', () => {
    const a = layer('a', '1', '0', BigInt(2)); const b = layer('b', '1', '0', BigInt(1));
    expect(wet([a, b], 1, 0).allocations[0].layerId).toBe('b');
    b.physicalDate = '2026-09-15';
    expect(wet([a, b], 1, 0).allocations[0].layerId).toBe('a');
    expect(() => wet([a, b], 2, 0)).toThrow('Insufficient');
    b.physicalDate = '2026-09-13'; b.postingSequence = BigInt(3);
    expect(wet([a, b], 1, 0).allocations[0].layerId).toBe('b');
  });
  it.each([NaN, Infinity, -1, 100, undefined])('rejects moisture %s', m => {
    expect(() => wet(mixes(), 1, m as number)).toThrow();
  });
  it.each([NaN, Infinity, -1, 0, undefined])('rejects wet mass %s', w => {
    expect(() => wet(mixes(), w as number, 30)).toThrow();
  });
  it('rejects invalid composition, dates, duplicate ids and inconsistent provenance', () => {
    const a = layer('a', '1');
    for (const invalid of [{ ...a, ingredientDrySolidsKg: -1 }, { ...a, physicalDate: '2026-02-30' }, { ...a, remainingDryBiocharKg: 2 }, { ...a, runs: [] }, { ...a, establishedDryBiocharKg: 0 }]) {
      expect(() => wet([invalid], 1, 0)).toThrow();
    }
    expect(() => wet([a, a], 1, 0)).toThrow();
  });
});

it('partial layer splits proportionally rather than FIFO between its source runs', () => {
  const mixed = layer('mixed', '1300');
  mixed.runs = [{ productionRunId: 'r1', establishedDryKg: '760', remainingDryKg: '760' }, { productionRunId: 'r2', establishedDryKg: '540', remainingDryKg: '540' }];
  expect(wet([mixed], 650, 0).allocations[0].runs.map(r => r.dryKg)).toEqual(['380.000', '270.000']);
});
it('exact wet shares sum to measured load without changing inputs', () => {
  const original = mixes();
  const before = original.map(l => ({ ...l }));
  const p = wet(original, 2000, 30);
  expect(original).toEqual(before);
  const [a, b] = p.allocations.map(a => a.wetShareKg!);
  expect(a.numerator * b.denominator + b.numerator * a.denominator).toBe(BigInt(2000) * a.denominator * b.denominator);
});
it('saved allocations stay unchanged after a late physical receipt', () => {
  const saved = rain();
  const receipt = { ...layer('late', '100', '0', BigInt(3)), physicalDate: '2026-09-13' };
  expect(wet([...saved.remainingLayers, receipt], 100, 0).allocations[0].layerId).toBe('late');
  expect(saved.allocations.map(a => a.dryKg)).toEqual(['900.000', '250.000']);
});
it('rejects invalid direct demands and non-gram stored facts', () => {
  expect(() => planOutputStock(mixes(), DAY, { kind: 'solids', solidsKg: -1 })).toThrow();
  expect(() => wet([{ ...layer('a', '1'), ingredientDrySolidsKg: '0.0001' }], 1, 0)).toThrow('gram');
  expect(() => planOutputStock(mixes(), 'not-a-date', { kind: 'count', wetKg: 0 })).toThrow();
});
