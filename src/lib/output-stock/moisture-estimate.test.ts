import { describe, expect, it } from 'vitest';
import { decimal, rational } from './exact';
import { BEFORE_LEDGER_SEQUENCE } from './layer-projection';
import { estimateStock, estimateStockExact, postingWetSteps, planReadings, planWetRemovals, withMovement, type LayerMoistureBasis } from './moisture-estimate';
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

  it('uses the last posted count reading, whatever its time', () => {
    const T2 = '2026-09-15T08:00:00.000Z';
    const solidsKg = decimal('637');
    const readings = [
      { moisturePercent: 30, solidsKg, occurredAt: T2, sequence: BigInt(3) },
      { moisturePercent: 20, solidsKg, occurredAt: T1, sequence: BigInt(5) },
      { moisturePercent: 25, solidsKg, occurredAt: T2, sequence: BigInt(4) },
    ];
    const bay = layer('B-0419', '980', '637', T0, { readings });
    for (const at of [T0, T1, NOW]) {
      const estimate = estimateStock([bay], at);
      expect(estimate.moisturePercent).toBeCloseTo(20, 9);
      expect(estimate.wetKg).toBeCloseTo(796.25, 9);
      expect(estimate.basis).toEqual({ source: 'reading', at: T1 });
    }
  });

  it('stays finite for a bin of many partly drawn batches with unrelated moisture bases', () => {
    // Distinct prime denominators: the exact sum's numerator and denominator pass 1e308.
    const primes: number[] = [];
    for (let n = 1009; primes.length < 120; n += 2) if (primes.every(p => n % p !== 0) && [3, 5, 7, 11, 13, 17, 19, 23, 29, 31].every(p => n % p !== 0)) primes.push(n);
    const layers = primes.map((p, i) => layer(`L${i}`, '1500', '997', T0, { remainingSolidsKg: { numerator: BigInt(p * 500 + 1), denominator: BigInt(p) },
      removals: [{ solidsKg: { numerator: BigInt(p * 500 + 1), denominator: BigInt(p) }, wetKg: { numerator: BigInt(p * 750 - 1), denominator: BigInt(p) }, sequence: BigInt(i + 1) }] }));
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

describe('estimate basis and exact figures', () => {
  // B-0419 entered at T1 with its recorded wet mass; B-0412 was counted at the same instant.
  const recorded = layer('B-0419', '980', '637', T1);
  const counted = layer('B-0412', '1240', '843.2', T0, { readings: [{ moisturePercent: 30, solidsKg: decimal('843.2'), occurredAt: T1, sequence: BigInt(2) }] });

  it('prefers a reading to a recorded basis at the same instant, whatever the layer order', () => {
    expect(estimateStock([recorded, counted], NOW).basis).toEqual({ source: 'reading', at: T1 });
    expect(estimateStock([counted, recorded], NOW).basis).toEqual({ source: 'reading', at: T1 });
  });

  it('still takes the later basis over the source', () => {
    const later = layer('B-0420', '100', '70', NOW);
    expect(estimateStock([later, counted], NOW).basis).toEqual({ source: 'recorded', at: NOW });
  });

  it('keeps the figures exact until a caller converts them', () => {
    const exact = estimateStockExact([layer('B-0412', '1240', '843.2'), layer('B-0419', '980', '637')], NOW);
    expect(exact.wetKg).toEqual(decimal('2220'));
    expect(exact.solidsKg).toEqual(decimal('1480.2'));
    // 1 − 1480.2 ÷ 2220, as a percent.
    expect(exact.moisturePercent).toEqual(rational(BigInt(739800), BigInt(22200)));
    const rounded = estimateStock([layer('B-0412', '1240', '843.2'), layer('B-0419', '980', '637')], NOW);
    expect(rounded.moisturePercent).toBeCloseTo(33.3243, 3);
  });

  it('gives no wet mass, moisture or basis when no layer holds stock', () => {
    expect(estimateStockExact([layer('spent', '10', '0')], NOW)).toEqual({ solidsKg: rational(BigInt(0)), wetKg: rational(BigInt(0)), moisturePercent: null, basis: null });
  });
});

describe('removals keep the bin moisture', () => {
  // 500 kg wet at 40%: 300 kg dry biochar.
  const bin = () => [stockLayer('B-0500', '300', 1)];
  const binBasis = () => [layer('B-0500', '500', '300')];
  const after = (request: { kind: 'wet'; wetKg: number; moisturePercent: number }, layers = bin(), bases = binBasis(), sequence = 2) => {
    const plan = planOutputStock(layers, T1, request);
    const drawn = bases.map(b => ({ ...b, remainingSolidsKg: plan.remainingLayers.find(l => l.id === b.layerId)!.remainingSolidsKg! }));
    return { plan, bases: withMovement(drawn, { readings: planReadings(request, plan, T1), removals: planWetRemovals(plan) }, T1, BigInt(sequence), 'loss') };
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

  it('re-estimates remaining dry biochar when a wetter removal takes all recorded wet stock', () => {
    const { bases } = after({ kind: 'wet', wetKg: 500, moisturePercent: 60 });
    const estimate = estimateStock(bases, NOW);
    expect(estimate.solidsKg).toBeCloseTo(100, 9);
    expect(estimate.wetKg).toBe(250);
    expect(estimate.moisturePercent).toBeCloseTo(60, 9);
    expect(estimate.basis).toEqual({ source: 'draw', at: T1, kind: 'loss' });
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
    const estimate = estimateStock(withMovement(drawn, { readings: [], removals: planWetRemovals(plan) }, T1, BigInt(3), 'loss'), NOW);
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
    const counted = estimateStock(withMovement(bases, { readings, removals: planWetRemovals(plan) }, T1, BigInt(4), 'loss'), T1);
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
    const bases = withMovement([{ ...layer('B-0500', '500', '300'), remainingSolidsKg: counted.remainingLayers[0].remainingSolidsKg! }], { readings: planReadings(count, counted, T1), removals: [] }, T1, BigInt(2), 'loss');
    const removal = { kind: 'wet' as const, wetKg: 100, moisturePercent: 10 };
    const plan = planOutputStock(counted.remainingLayers, NOW, removal);
    const drawn = bases.map(b => ({ ...b, remainingSolidsKg: plan.remainingLayers[0].remainingSolidsKg! }));
    const estimate = estimateStock(withMovement(drawn, { readings: [], removals: planWetRemovals(plan) }, NOW, BigInt(3), 'loss'), NOW);
    expect(estimate.wetKg).toBeCloseTo(300, 9);
    expect(estimate.moisturePercent).toBeCloseTo(25, 9);
  });
});

describe('wet stock follows the draws the dry layers reflect', () => {
  // 500 kg wet at 40%: 300 kg solids. A removal timed after T1, posted as sequence 2, took 100 kg wet and 60 kg solids.
  const drawn = () => layer('B-0500', '500', '300', T0, { remainingSolidsKg: decimal('240'), removals: [{ wetKg: decimal('100'), solidsKg: decimal('240'), sequence: BigInt(2) }] });

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
    const later = { ...counted, remainingSolidsKg: decimal('180'), removals: [...counted.removals, { wetKg: decimal('100'), solidsKg: decimal('180'), sequence: BigInt(4) }] };
    expect(estimateStock([later], NOW).wetKg).toBeCloseTo(300, 9);
  });

  it('a preview timed before a later-timed count starts from that count', () => {
    // A count at T2 read 400 kg at 40%: 240 kg solids, as the dry layer already shows.
    const counted = layer('B-0500', '500', '300', T0, { remainingSolidsKg: decimal('240'), readings: [{ moisturePercent: 40, solidsKg: decimal('240'), occurredAt: NOW, sequence: BigInt(2) }] });
    expect(estimateStock([counted], T1).wetKg).toBeCloseTo(400, 9);
  });

  it('a backdated count posted last sets the wet mass, though an earlier-posted count is timed later', () => {
    // Posted first: a count timed NOW read 400 kg at 40% (240 kg solids). Posted second: a count timed T1 read 200 kg at 40% (120 kg solids).
    const readings = [
      { moisturePercent: 40, solidsKg: decimal('240'), occurredAt: NOW, sequence: BigInt(2) },
      { moisturePercent: 40, solidsKg: decimal('120'), occurredAt: T1, sequence: BigInt(3) },
    ];
    const counted = layer('B-0500', '500', '300', T0, { remainingSolidsKg: decimal('120'), readings });
    expect(estimateStock([counted], NOW).wetKg).toBeCloseTo(200, 9);
  });

  it('a product draw saved before the ledger counts from the recorded wet mass, never after a count', () => {
    const legacy = layer('B-0500', '500', '300', T0, { remainingSolidsKg: decimal('240'), removals: [{ wetKg: decimal('100'), solidsKg: decimal('240'), sequence: BEFORE_LEDGER_SEQUENCE }] });
    expect(estimateStock([legacy], NOW).wetKg).toBeCloseTo(400, 9);
    const counted = { ...legacy, readings: [{ moisturePercent: 25, solidsKg: decimal('240'), occurredAt: T1, sequence: BigInt(1) }] };
    expect(estimateStock([counted], NOW).wetKg).toBeCloseTo(320, 9);
  });
});


describe('wet below solids re-estimate', () => {
  function draw(wetKg = 50, policy: 'fifo' | 'pro_rata' = 'fifo', split = false) {
    const stocks = policy === 'pro_rata' ? [stockLayer('a', '40', 1), stockLayer('b', '40', 2)] : [stockLayer('a', '80', 1)];
    const bases = stocks.map(s => layer(s.id, policy === 'pro_rata' ? '50' : '100', String(s.establishedDryBiocharKg)));
    const request = split ? { kind: 'ordered' as const, wetKg, sources: [{ layerId: 'a', moisturePercent: 50 }] }
      : { kind: 'wet' as const, wetKg, moisturePercent: 50 };
    const plan = planOutputStock(stocks, T1, request, policy);
    const after = bases.map(b => ({ ...b, remainingSolidsKg: plan.remainingLayers.find(s => s.id === b.layerId)!.remainingSolidsKg! }));
    return { plan, bases: withMovement(after, { readings: [], removals: planWetRemovals(plan) }, T1, BigInt(3), 'loss') };
  }

  it.each([['fifo', false], ['pro_rata', false], ['fifo', true]] as const)('re-estimates 55 kg dry at 50%% as 110 kg wet (%s, ordered %s)', (policy, split) => {
    const { bases } = draw(50, policy, split);
    expect(estimateStock(bases, NOW)).toEqual({ wetKg: 110, solidsKg: 55, moisturePercent: 50,
      basis: { source: 'draw', at: T1, kind: 'loss' } });
    if (policy === 'pro_rata') for (const basis of bases) expect(estimateStock([basis], NOW).wetKg).toBe(55);
  });

  it('does not re-estimate equality, or an ordinary wetter draw', () => {
    for (const wet of [30, 40]) {
      const estimate = estimateStock(draw(wet).bases, NOW);
      expect(estimate.wetKg).toBe(100 - wet);
      expect(estimate.moisturePercent).toBe(20);
      expect(estimate.basis).toEqual({ source: 'recorded', at: T0 });
    }
  });

  it('clamps at remaining solids without inventing a moisture for an unmeasured removal', () => {
    const { bases } = draw();
    const unmeasured = bases.map(b => ({ ...b, removals: b.removals.map(r => ({ ...r, moisturePercent: null })) }));
    expect(estimateStock(unmeasured, NOW)).toEqual({ wetKg: 55, solidsKg: 55, moisturePercent: 20, basis: { source: 'recorded', at: T0 } });
  });

  it('subtracts later draws from the re-estimate in posting order, regardless of input or physical order', () => {
    const { bases, plan } = draw();
    const next = planOutputStock(plan.remainingLayers, T0, { kind: 'wet', wetKg: 10, moisturePercent: 20 });
    const after = withMovement(bases.map(b => ({ ...b, remainingSolidsKg: next.remainingLayers[0].remainingSolidsKg! })),
      { readings: [], removals: planWetRemovals(next) }, T0, BigInt(4), 'delivery');
    after[0].removals = [...after[0].removals].reverse();
    expect(estimateStock(after, NOW)).toEqual({ wetKg: 100, solidsKg: 47, moisturePercent: 50, basis: { source: 'draw', at: T1, kind: 'loss' } });
  });

  it('lets a later posted count override the re-estimate even when backdated', () => {
    const { bases, plan } = draw();
    const request = { kind: 'count' as const, wetKg: 60, moisturePercent: 25 };
    const count = planOutputStock(plan.remainingLayers, T0, request);
    const after = withMovement(bases.map(b => ({ ...b, remainingSolidsKg: count.remainingLayers[0].remainingSolidsKg! })),
      { readings: planReadings(request, count, T0), removals: [] }, T0, BigInt(4), 'count');
    expect(estimateStock(after, NOW)).toEqual({ wetKg: 60, solidsKg: 45, moisturePercent: 25, basis: { source: 'reading', at: T0 } });
  });
});


it('re-estimates only the partial sub-bin after emptying another at its own moisture', () => {
  const plan = planOutputStock([stockLayer('first', '20', 1), stockLayer('last', '80', 2)], T1,
    { kind: 'ordered', wetKg: 75, sources: [{ layerId: 'first', moisturePercent: 20 }, { layerId: 'last', moisturePercent: 50 }] });
  const bases = [layer('first', '25', '20'), layer('last', '100', '80')]
    .map(b => ({ ...b, remainingSolidsKg: plan.remainingLayers.find(l => l.id === b.layerId)!.remainingSolidsKg! }));
  const after = withMovement(bases, { readings: [], removals: planWetRemovals(plan) }, T1, BigInt(3), 'delivery');
  expect(estimateStock([after[0]], NOW)).toMatchObject({ wetKg: 0, solidsKg: 0, basis: null });
  expect(estimateStock([after[1]], NOW)).toEqual({ wetKg: 110, solidsKg: 55, moisturePercent: 50,
    basis: { source: 'draw', at: T1, kind: 'delivery' } });
});

it('compares wet with all solids in a blend, not just its dry biochar', () => {
  const stock = { ...stockLayer('blend', '40', 1), ingredientDrySolidsKg: '40' };
  const plan = planOutputStock([stock], T1, { kind: 'wet', wetKg: 50, moisturePercent: 50 });
  const after = withMovement([layer('blend', '100', '80', T0, { remainingSolidsKg: plan.remainingLayers[0].remainingSolidsKg! })],
    { readings: [], removals: planWetRemovals(plan) }, T1, BigInt(2), 'delivery');
  expect(plan.remainingLayers[0].remainingDryBiocharKg).toBe('27.500');
  expect(estimateStock(after, NOW)).toMatchObject({ wetKg: 110, solidsKg: 55, moisturePercent: 50 });
});

describe('postingWetSteps', () => {
  const posting = { id: 'loss', sequence: BigInt(3), occurredAt: T1 };
  const drawn = (stockMode: 'mix' | 'split' = 'mix') => layer('a', '100', '80', T0, {
    remainingSolidsKg: decimal('55'), removals: [{ wetKg: decimal('50'), solidsKg: decimal('55'),
      moisturePercent: 50, occurredAt: T1, kind: 'loss', sequence: posting.sequence, stockMode }],
  });

  it('updates a mix loss from +10 to -50 when a late run cancels its re-estimate', () => {
    expect(postingWetSteps([drawn()], [posting]).get('loss')?.deltaKg).toBe(10);
    const bases = [drawn(), layer('b', '200', '80')];
    expect(postingWetSteps(bases, [posting]).get('loss')?.deltaKg).toBe(-50);
    expect(estimateStock(bases, NOW)).toMatchObject({ wetKg: 250, solidsKg: 135 });
  });

  it('keeps a split re-estimate and ignores physically future intake', () => {
    expect(postingWetSteps([drawn('split'), layer('b', '200', '80')], [posting]).get('loss')?.deltaKg).toBe(10);
    expect(postingWetSteps([drawn(), layer('b', '200', '80', NOW)], [posting]).get('loss')?.deltaKg).toBe(10);
  });

  it('uses posting order and the solids held then, including layers now empty', () => {
    const count = { id: 'count', sequence: BigInt(4), occurredAt: T0 };
    const bases = [{ ...drawn(), remainingSolidsKg: decimal('0'), removals: [...drawn().removals,
      { wetKg: decimal('0'), solidsKg: decimal('0'), sequence: count.sequence, kind: 'count', occurredAt: T0 }] }];
    const changes = postingWetSteps(bases, [count, posting]);
    expect(changes.get('loss')?.deltaKg).toBe(10);
    expect(changes.get('count')?.deltaKg).toBe(-110);
    expect(100 + changes.get('loss')!.deltaKg! + changes.get('count')!.deltaKg!).toBe(estimateStock(bases, NOW).wetKg);
  });

  it('returns null for unknown held wet, and no entry for a posting without moisture facts', () => {
    const bases = [drawn(), layer('unknown', '10', '8', T0, { recorded: null })];
    expect(postingWetSteps(bases, [posting]).get('loss')).toEqual({ deltaKg: null, afterKg: null });
    expect(postingWetSteps(bases, [{ ...posting, sequence: BigInt(9) }]).has('loss')).toBe(false);
  });

  it('keeps an old below-solids intake recorded, without flooring its starting wet', () => {
    const bases = [layer('old', '70', '80', T0, { remainingSolidsKg: decimal('70'),
      readings: [{ sequence: posting.sequence, occurredAt: T1, solidsKg: decimal('70'), moisturePercent: 0 }] })];
    expect(postingWetSteps(bases, [posting]).get('loss')?.deltaKg).toBe(0);
  });
});
