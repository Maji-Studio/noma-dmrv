import { describe, expect, it } from 'vitest';
import { grams, kilograms, splitGrams } from './exact';
import { planOutputStock, SubBinOverdrawError, UntickSubBinError, type OutputStockLayer } from './planner';
const DAY = '2026-09-14T10:00:00.000Z';
function layer(id: string, dry: string, ingredients = '0', sequence = BigInt(1)): OutputStockLayer {
  return { id, placedAt: DAY, postingSequence: sequence, establishedDryBiocharKg: dry, ingredientDrySolidsKg: ingredients, remainingDryBiocharKg: dry,
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
  it('physical instants exclude future layers and equal instants order by posting sequence', () => {
    const a = layer('a', '1', '0', BigInt(2)); const b = layer('b', '1', '0', BigInt(1));
    expect(wet([a, b], 1, 0).allocations[0].layerId).toBe('b');
    b.placedAt = '2026-09-14T10:00:00.001Z';
    expect(wet([a, b], 1, 0).allocations[0].layerId).toBe('a');
    expect(() => wet([a, b], 2, 0)).toThrow('Insufficient');
    b.placedAt = '2026-09-14T09:59:59.000Z'; b.postingSequence = BigInt(3);
    expect(wet([a, b], 1, 0).allocations[0].layerId).toBe('b');
  });
  it('orders layers placed on the same day by time, not posting sequence', () => {
    const afternoon = { ...layer('afternoon', '1', '0', BigInt(1)), placedAt: '2026-09-14T09:30:00.000Z' };
    const morning = { ...layer('morning', '1', '0', BigInt(2)), placedAt: '2026-09-14T06:00:00.000Z' };
    expect(wet([afternoon, morning], 1, 0).allocations[0].layerId).toBe('morning');
    expect(planOutputStock([afternoon, morning], '2026-09-14T08:00:00.000Z', { kind: 'count', wetKg: 0 }).expectedSolidsKg).toEqual({ numerator: BigInt(1), denominator: BigInt(1) });
  });
  it.each([NaN, Infinity, -1, 100, undefined])('rejects moisture %s', m => {
    expect(() => wet(mixes(), 1, m as number)).toThrow();
  });
  it.each([NaN, Infinity, -1, 0, undefined])('rejects wet mass %s', w => {
    expect(() => wet(mixes(), w as number, 30)).toThrow();
  });
  it('rejects invalid composition, dates, duplicate ids and inconsistent provenance', () => {
    const a = layer('a', '1');
    for (const invalid of [{ ...a, ingredientDrySolidsKg: -1 }, { ...a, placedAt: '2026-02-30T00:00:00.000Z' }, { ...a, placedAt: '2026-09-14' }, { ...a, placedAt: '2026-09-14T10:00:00Z' }, { ...a, remainingDryBiocharKg: 2 }, { ...a, runs: [] }, { ...a, establishedDryBiocharKg: 0 }]) {
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
  const receipt = { ...layer('late', '100', '0', BigInt(3)), placedAt: '2026-09-13T10:00:00.000Z' };
  expect(wet([...saved.remainingLayers, receipt], 100, 0).allocations[0].layerId).toBe('late');
  expect(saved.allocations.map(a => a.dryKg)).toEqual(['900.000', '250.000']);
});
it('rejects invalid direct demands and non-gram stored facts', () => {
  expect(() => planOutputStock(mixes(), DAY, { kind: 'solids', solidsKg: -1 })).toThrow();
  expect(() => wet([{ ...layer('a', '1'), ingredientDrySolidsKg: '0.0001' }], 1, 0)).toThrow('gram');
  expect(() => planOutputStock(mixes(), 'not-a-date', { kind: 'count', wetKg: 0 })).toThrow();
});

describe('split bins: operator order with a reading per sub-bin', () => {
  // Plan worked example: B-0412 holds 843.2 kg solids, B-0419 holds 637.0 kg.
  const bays = () => [layer('B-0412', '843.2', '0', BigInt(1)), layer('B-0419', '637', '0', BigInt(2))];
  const ordered = (layers: OutputStockLayer[], wetKg: number, sources: { layerId: string; moisturePercent: number }[]) =>
    planOutputStock(layers, DAY, { kind: 'ordered', wetKg, sources });
  it('empties every sub-bin but the last at its own reading and takes the rest from the last', () => {
    const plan = ordered(bays(), 1500, [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }]);
    // 843.2 / 0.70 = 1,204.6 kg wet empties B-0412; 295.4 kg wet at 33% takes 197.9 kg from B-0419.
    expect(plan.allocations.map(a => [a.layerId, a.dryKg])).toEqual([['B-0412', '843.200'], ['B-0419', '197.937']]);
    expect(plan.remainingLayers.find(l => l.id === 'B-0419')?.remainingDryBiocharKg).toBe('439.063');
    expect(plan.remainingLayers.find(l => l.id === 'B-0412')?.remainingDryBiocharKg).toBe('0.000');
    const [first, last] = plan.allocations.map(a => a.wetShareKg!);
    expect(Number(first.numerator) / Number(first.denominator)).toBeCloseTo(1204.571, 3);
    expect(first.numerator * last.denominator + last.numerator * first.denominator).toBe(BigInt(1500) * first.denominator * last.denominator);
    expect(plan.allocations.map(a => a.readingPercent)).toEqual([30, 33]);
  });
  it('asks to untick a sub-bin the load never reaches', () => {
    // Emptying B-0412 at 30% already takes 1,204.6 kg wet, so a 1,200 kg load never reaches B-0419.
    const sources = [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }];
    expect(() => ordered(bays(), 1200, sources)).toThrow(UntickSubBinError);
    try { ordered(bays(), 1200, sources); } catch (error) { expect((error as UntickSubBinError).layerId).toBe('B-0419'); }
  });
  it('treats a load that exactly empties the earlier sub-bins as not reaching the next', () => {
    // 700 kg solids at 30% is exactly 1,000 kg wet.
    const layers = [layer('A', '700', '0', BigInt(1)), layer('B', '100', '0', BigInt(2))];
    expect(() => ordered(layers, 1000, [{ layerId: 'A', moisturePercent: 30 }, { layerId: 'B', moisturePercent: 10 }])).toThrow(UntickSubBinError);
  });
  it('blocks when the last sub-bin would give more solids than its records hold', () => {
    const sources = [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }];
    // 1,204.6 + 637.0 / 0.67 = 2,155.3 kg wet closes both; 2,200 kg overdraws B-0419.
    expect(() => ordered(bays(), 2200, sources)).toThrow(SubBinOverdrawError);
  });
  it('closes the last sub-bin exactly when the load matches its records', () => {
    const layers = [layer('A', '700', '0', BigInt(1)), layer('B', '90', '0', BigInt(2))];
    // A empties at 1,000 kg wet (30%); B holds 90 kg solids, 100 kg wet at 10%.
    const plan = ordered(layers, 1100, [{ layerId: 'A', moisturePercent: 30 }, { layerId: 'B', moisturePercent: 10 }]);
    expect(plan.allocations.map(a => a.dryKg)).toEqual(['700.000', '90.000']);
    expect(plan.remainingLayers.every(l => l.remainingDryBiocharKg === '0.000' && l.runs.every(r => r.remainingDryKg === '0.000'))).toBe(true);
  });
  it('follows the operator order even when it is not oldest first', () => {
    const plan = ordered(bays(), 100, [{ layerId: 'B-0419', moisturePercent: 20 }]);
    expect(plan.allocations).toEqual([expect.objectContaining({ layerId: 'B-0419', dryKg: '80.000', readingPercent: 20 })]);
    // Untouched sub-bins pass through unchanged.
    expect(plan.remainingLayers.find(l => l.id === 'B-0412')).toEqual(bays()[0]);
  });
  it('applies each reading to solids, so a blended sub-bin keeps its biochar share', () => {
    // 900 dry biochar + 100 ingredient solids: 90% of drawn solids is biochar.
    const plan = ordered([layer('mix', '900', '100')], 500, [{ layerId: 'mix', moisturePercent: 20 }]);
    expect(plan.allocations[0].dryKg).toBe('360.000');
  });
  it.each([
    ['an unknown sub-bin', [{ layerId: 'nope', moisturePercent: 10 }]],
    ['a sub-bin twice', [{ layerId: 'B-0412', moisturePercent: 10 }, { layerId: 'B-0412', moisturePercent: 10 }]],
    ['no sub-bin', []],
    ['a reading of 100%', [{ layerId: 'B-0412', moisturePercent: 100 }]],
  ])('rejects %s', (_label, sources) => {
    expect(() => ordered(bays(), 10, sources)).toThrow(RangeError);
  });
  it('rejects a sub-bin placed after the draw', () => {
    const later = { ...layer('later', '10', '0', BigInt(3)), placedAt: '2026-09-15T10:00:00.000Z' };
    expect(() => ordered([...bays(), later], 5, [{ layerId: 'later', moisturePercent: 0 }])).toThrow(RangeError);
  });
  it('conserves every gram: an ordered draw followed by a zero count closes each sub-bin to its established dry mass', () => {
    const first = ordered(bays(), 1500, [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }]);
    const close = planOutputStock(first.remainingLayers, DAY, { kind: 'count', wetKg: 0 });
    const drawnGrams = [...first.allocations, ...close.allocations].reduce((sum, a) => sum + grams(a.dryKg), BigInt(0));
    expect(kilograms(drawnGrams)).toBe('1480.200');
    expect(close.remainingLayers.every(l => l.remainingDryBiocharKg === '0.000')).toBe(true);
  });
  it('keeps exact solids bounded across many chained split draws', () => {
    // Each load empties the part-drawn sub-bin and dips into the next, at readings with odd factors.
    let layers: OutputStockLayer[] = Array.from({ length: 160 }, (_, i) => layer(`S${i}`, '100', '0', BigInt(i + 1)));
    for (let i = 0; i < 150; i++) {
      const first = 17.3 + (i % 7);
      const bay = layers.find(l => l.id === `S${i}`)!;
      const solidsKg = bay.remainingSolidsKg ? Number(bay.remainingSolidsKg.numerator) / Number(bay.remainingSolidsKg.denominator) : Number(bay.remainingDryBiocharKg);
      // Enough wet to empty S{i} (rounded up to a gram) plus 30 kg taken from S{i+1}.
      const wetKg = (Math.ceil(solidsKg / (1 - first / 100) * 1000) / 1000 + 30).toFixed(3);
      layers = ordered(layers, Number(wetKg), [{ layerId: `S${i}`, moisturePercent: first }, { layerId: `S${i + 1}`, moisturePercent: 23.9 + (i % 11) }]).remainingLayers;
    }
    const denominators = layers.map(l => l.remainingSolidsKg?.denominator ?? BigInt(1));
    expect(denominators.every(d => d.toString(2).length < 128)).toBe(true);
    const total = planOutputStock(layers, DAY, { kind: 'count', wetKg: 0 }).expectedSolidsKg;
    expect(Number.isFinite(Number(total.numerator) / Number(total.denominator))).toBe(true);
  });
  it('rejects a repeated sub-bin before judging where the load stops', () => {
    expect(() => ordered(bays(), 10, [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0412', moisturePercent: 10 }])).toThrow('Choose each sub-bin once');
  });
  it('asks to untick an empty sub-bin', () => {
    const empty = { ...layer('empty', '10', '0', BigInt(3)), remainingDryBiocharKg: '0', runs: [{ productionRunId: 'empty', establishedDryKg: '10', remainingDryKg: '0' }] };
    expect(() => ordered([...bays(), empty], 5, [{ layerId: 'empty', moisturePercent: 0 }])).toThrow(UntickSubBinError);
  });
});
