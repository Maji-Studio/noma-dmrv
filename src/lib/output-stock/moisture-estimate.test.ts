import { describe, expect, it } from 'vitest';
import { decimal } from './exact';
import { BEFORE_LEDGER_SEQUENCE } from './layer-projection';
import { estimateStock, planReadings, planWetRemovals, withMovement, type LayerMoistureBasis } from './moisture-estimate';
import { planOutputStock, type OutputStockLayer } from './planner';

const T0 = '2026-09-01T08:00:00.000Z';
const T1 = '2026-09-10T08:00:00.000Z';
const NOW = '2026-09-20T08:00:00.000Z';

/** The plan's split example: B-0412 was 1,240 kg wet at 32%, B-0419 980 kg wet at 35%. */
function layer(id: string, wetKg: string, solidsKg: string, placedAt = T0, extra: Partial<LayerMoistureBasis> = {}): LayerMoistureBasis {
  return { layerId: id, placedAt, remainingSolidsKg: decimal(solidsKg), recorded: { solidsKg: decimal(solidsKg), wetKg: decimal(wetKg) }, readings: [], removals: [], ...extra };
}

describe('estimateStock', () => {
  it('estimates untouched batches at the moisture they were recorded with', () => {
    const estimate = estimateStock([layer('B-0412', '1240', '843.2'), layer('B-0419', '980', '637')], NOW);
    expect(estimate.wetKg).toBeCloseTo(2220, 6);
    expect(estimate.moisturePercent).toBeCloseTo(33.3243, 3);
    expect(estimate.basis).toEqual({ source: 'recorded', at: T0 });
  });

  it('uses the latest count reading taken at or before the time, never a later one', () => {
    const T2 = '2026-09-15T08:00:00.000Z';
    const solidsKg = decimal('637');
    const readings = [
      { moisturePercent: 30, solidsKg, occurredAt: T1, sequence: BigInt(4) },
      { moisturePercent: 20, solidsKg, occurredAt: T2, sequence: BigInt(5) },
      { moisturePercent: 25, solidsKg, occurredAt: T1, sequence: BigInt(3) },
    ];
    const bay = layer('B-0419', '980', '637', T0, { readings });
    expect(estimateStock([bay], T0).moisturePercent).toBeCloseTo(35, 9);
    // Two readings at one instant: the later posting is the newer measurement.
    const atT1 = estimateStock([bay], T1);
    expect(atT1.moisturePercent).toBeCloseTo(30, 9);
    expect(atT1.wetKg).toBeCloseTo(910, 9);
    expect(atT1.basis).toEqual({ source: 'reading', at: T1 });
    expect(estimateStock([bay], NOW).wetKg).toBeCloseTo(796.25, 9);
  });

  it('stays finite for a bin of many partly drawn batches with unrelated moisture bases', () => {
    // Distinct prime denominators: the exact sum's numerator and denominator pass 1e308.
    const primes: number[] = [];
    for (let n = 1009; primes.length < 120; n += 2) if (primes.every(p => n % p !== 0) && [3, 5, 7, 11, 13, 17, 19, 23, 29, 31].every(p => n % p !== 0)) primes.push(n);
    const layers = primes.map((p, i) => layer(`L${i}`, '1500', '997', T0, { remainingSolidsKg: { numerator: BigInt(p * 500 + 1), denominator: BigInt(p) },
      removals: [{ wetKg: { numerator: BigInt(p * 750 - 1), denominator: BigInt(p) }, sequence: BigInt(i + 1) }] }));
    const estimate = estimateStock(layers, NOW);
    expect(estimate.wetKg).toBeCloseTo(120 * 750, 0);
    expect(estimate.moisturePercent).toBeCloseTo((1 - 997 / 1500) * 100, 6);
  });

  it('leaves the wet estimate unknown when a batch holding stock has no moisture basis, and ignores spent batches', () => {
    const unknown = layer('B-0419', '980', '637', T0, { recorded: null });
    expect(estimateStock([layer('B-0412', '1240', '843.2'), unknown], NOW)).toMatchObject({ wetKg: null, moisturePercent: null, solidsKg: 1480.2 });
    const spent = { ...unknown, remainingSolidsKg: decimal('0') };
    expect(estimateStock([layer('B-0412', '1240', '843.2'), spent], NOW).wetKg).toBeCloseTo(1240, 9);
  });
});

/** A pure-biochar sub-bin: its dry biochar is its solids. */
function stockLayer(id: string, solidsKg: string, sequence: number): OutputStockLayer {
  return { id, placedAt: T0, postingSequence: BigInt(sequence), establishedDryBiocharKg: solidsKg, ingredientDrySolidsKg: '0', remainingDryBiocharKg: solidsKg,
    runs: [{ productionRunId: id, establishedDryKg: solidsKg, remainingDryKg: solidsKg }] };
}

describe('removals keep the bin moisture', () => {
  // 500 kg wet at 40%: 300 kg dry biochar.
  const bin = () => [stockLayer('B-0500', '300', 1)];
  const binBasis = () => [layer('B-0500', '500', '300')];
  const after = (request: { kind: 'wet'; wetKg: number; moisturePercent: number }, layers = bin(), bases = binBasis(), sequence = 2) => {
    const plan = planOutputStock(layers, T1, request);
    const drawn = bases.map(b => ({ ...b, remainingSolidsKg: plan.remainingLayers.find(l => l.id === b.layerId)!.remainingSolidsKg! }));
    return { plan, bases: withMovement(drawn, { readings: planReadings(request, plan, T1), removals: planWetRemovals(plan) }, T1, BigInt(sequence)) };
  };

  it('removing 300 kg at another moisture leaves 200 kg wet at 40%', () => {
    const { plan, bases } = after({ kind: 'wet', wetKg: 300, moisturePercent: 20 });
    expect(plan.drawnDryKg).toBe('240.000');
    const estimate = estimateStock(bases, NOW);
    expect(estimate.wetKg).toBeCloseTo(200, 9);
    expect(estimate.moisturePercent).toBeCloseTo(40, 9);
    expect(estimate.solidsKg).toBeCloseTo(60, 9);
  });

  it('blocks a draw the dry biochar cannot cover, though wet stock still shows', () => {
    const first = after({ kind: 'wet', wetKg: 300, moisturePercent: 20 });
    expect(estimateStock(first.bases, NOW).wetKg).toBeCloseTo(200, 9);
    // 100 kg at 20% is 80 kg dry; only 60 kg is left because the biochar dried.
    expect(() => planOutputStock(first.plan.remainingLayers, T1, { kind: 'wet', wetKg: 100, moisturePercent: 20 })).toThrow('Insufficient exact dry solids');
    const rest = after({ kind: 'wet', wetKg: 75, moisturePercent: 20 }, [...first.plan.remainingLayers], first.bases, 3);
    expect(rest.plan.remainingLayers[0].remainingDryBiocharKg).toBe('0.000');
    // The bin is empty: wet stock no dry biochar backs is not shown.
    expect(estimateStock(rest.bases, NOW)).toMatchObject({ wetKg: 0, solidsKg: 0, moisturePercent: null });
  });

  it('shows no wet stock when wetter removals took it all and dry biochar is left', () => {
    const { bases } = after({ kind: 'wet', wetKg: 500, moisturePercent: 60 });
    const estimate = estimateStock(bases, NOW);
    expect(estimate.solidsKg).toBeCloseTo(100, 9);
    expect(estimate.wetKg).toBe(0);
    expect(estimate.moisturePercent).toBeCloseTo(40, 9);
  });

  it('counts a posted removal whatever time is asked, since the remaining solids already reflect it', () => {
    const { bases } = after({ kind: 'wet', wetKg: 300, moisturePercent: 20 });
    expect(estimateStock(bases, T0).wetKg).toBeCloseTo(200, 9);
    expect(estimateStock(bases, T1).wetKg).toBeCloseTo(200, 9);
  });

  it('a split draw takes each sub-bin\'s wet share and leaves every moisture as it was', () => {
    const request = { kind: 'ordered' as const, wetKg: 1500, sources: [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }] };
    const plan = planOutputStock([stockLayer('B-0412', '843.2', 1), stockLayer('B-0419', '637', 2)], T1, request);
    expect(planReadings(request, plan, T1)).toEqual([]);
    const before = [layer('B-0412', '1240', '843.2'), layer('B-0419', '980', '637')];
    const drawn = before.map(l => ({ ...l, remainingSolidsKg: plan.remainingLayers.find(r => r.id === l.layerId)!.remainingSolidsKg! }));
    const estimate = estimateStock(withMovement(drawn, { readings: [], removals: planWetRemovals(plan) }, T1, BigInt(3)), NOW);
    // B-0412 emptied at 1,204.6 kg; B-0419 gave the other 295.4 kg of 980 kg.
    expect(estimate.wetKg).toBeCloseTo(980 - (1500 - 843.2 / 0.7), 6);
    expect(estimate.moisturePercent).toBeCloseTo(35, 9);
    expect(estimate.basis).toEqual({ source: 'recorded', at: T0 });
  });
});

describe('planReadings', () => {
  it('a count sets every sub-bin present at the counted moisture and wet mass, and a later arrival keeps its own', () => {
    const later = { ...stockLayer('B-0501', '300', 3), placedAt: NOW };
    const layers = [stockLayer('B-0412', '843.2', 1), stockLayer('B-0419', '637', 2), later];
    const request = { kind: 'count' as const, wetKg: 2100, moisturePercent: 30 };
    const plan = planOutputStock(layers, T1, request);
    const readings = planReadings(request, plan, T1);
    expect(readings.map(r => [r.layerId, r.moisturePercent])).toEqual([['B-0412', 30], ['B-0419', 30]]);
    const bases = [layer('B-0412', '1240', '843.2'), layer('B-0419', '980', '637')]
      .map(l => ({ ...l, remainingSolidsKg: plan.remainingLayers.find(r => r.id === l.layerId)!.remainingSolidsKg ?? l.remainingSolidsKg }));
    const counted = estimateStock(withMovement(bases, { readings, removals: planWetRemovals(plan) }, T1, BigInt(4)), T1);
    expect(counted.wetKg).toBeCloseTo(2100, 6);
    expect(counted.moisturePercent).toBeCloseTo(30, 9);
    expect(counted.basis).toEqual({ source: 'reading', at: T1 });
    const zero = { kind: 'count' as const, wetKg: 0 };
    expect(planReadings(zero, planOutputStock(layers, T1, zero), T1)).toEqual([]);
  });

  it('a removal records no reading, whatever moisture it was measured at', () => {
    const request = { kind: 'wet' as const, wetKg: 1500, moisturePercent: 31 };
    expect(planReadings(request, planOutputStock([stockLayer('B-0412', '843.2', 1), stockLayer('B-0419', '637', 2)], T1, request), T1)).toEqual([]);
  });

  it('a removal after a count subtracts from the counted wet mass', () => {
    const count = { kind: 'count' as const, wetKg: 400, moisturePercent: 25 };
    const layers = [stockLayer('B-0500', '300', 1)];
    const counted = planOutputStock(layers, T1, count);
    const bases = withMovement([{ ...layer('B-0500', '500', '300'), remainingSolidsKg: counted.remainingLayers[0].remainingSolidsKg! }], { readings: planReadings(count, counted, T1), removals: [] }, T1, BigInt(2));
    const removal = { kind: 'wet' as const, wetKg: 100, moisturePercent: 10 };
    const plan = planOutputStock(counted.remainingLayers, NOW, removal);
    const drawn = bases.map(b => ({ ...b, remainingSolidsKg: plan.remainingLayers[0].remainingSolidsKg! }));
    const estimate = estimateStock(withMovement(drawn, { readings: [], removals: planWetRemovals(plan) }, NOW, BigInt(3)), NOW);
    expect(estimate.wetKg).toBeCloseTo(300, 9);
    expect(estimate.moisturePercent).toBeCloseTo(25, 9);
  });
});

describe('wet stock follows the draws the dry layers reflect', () => {
  // 500 kg wet at 40%: 300 kg solids. A removal timed after T1, posted as sequence 2, took 100 kg wet and 60 kg solids.
  const drawn = () => layer('B-0500', '500', '300', T0, { remainingSolidsKg: decimal('240'), removals: [{ wetKg: decimal('100'), sequence: BigInt(2) }] });

  it('a preview timed before a posted removal subtracts it, as the dry stock does', () => {
    const estimate = estimateStock([drawn()], T1);
    expect(estimate.wetKg).toBeCloseTo(400, 9);
    expect(estimate.moisturePercent).toBeCloseTo(40, 9);
  });

  it('a count timed before a removal posted earlier does not subtract that removal again', () => {
    // The count's solids, 240 kg, already reflect the removal posted before it.
    const counted = { ...drawn(), readings: [{ moisturePercent: 40, solidsKg: decimal('240'), occurredAt: T1, sequence: BigInt(3) }] };
    expect(estimateStock([counted], NOW).wetKg).toBeCloseTo(400, 9);
    // A removal posted after the count subtracts, even when timed before it.
    const later = { ...counted, remainingSolidsKg: decimal('180'), removals: [...counted.removals, { wetKg: decimal('100'), sequence: BigInt(4) }] };
    expect(estimateStock([later], NOW).wetKg).toBeCloseTo(300, 9);
  });

  it('a product draw saved before the ledger counts from the recorded wet mass, never after a count', () => {
    const legacy = layer('B-0500', '500', '300', T0, { remainingSolidsKg: decimal('240'), removals: [{ wetKg: decimal('100'), sequence: BEFORE_LEDGER_SEQUENCE }] });
    expect(estimateStock([legacy], NOW).wetKg).toBeCloseTo(400, 9);
    const counted = { ...legacy, readings: [{ moisturePercent: 25, solidsKg: decimal('240'), occurredAt: T1, sequence: BigInt(1) }] };
    expect(estimateStock([counted], NOW).wetKg).toBeCloseTo(320, 9);
  });
});
