import { describe, expect, it } from 'vitest';
import { decimal } from './exact';
import { estimateStock, planReadings, withReadings, type LayerMoistureBasis } from './moisture-estimate';
import { planOutputStock, type OutputStockLayer } from './planner';

const T0 = '2026-09-01T08:00:00.000Z';
const T1 = '2026-09-10T08:00:00.000Z';
const NOW = '2026-09-20T08:00:00.000Z';

/** The plan's split example: B-0412 was 1,240 kg wet at 32%, B-0419 980 kg wet at 35%. */
function layer(id: string, wetKg: string, solidsKg: string, placedAt = T0, extra: Partial<LayerMoistureBasis> = {}): LayerMoistureBasis {
  return { layerId: id, placedAt, remainingSolidsKg: decimal(solidsKg), recorded: { solidsKg: decimal(solidsKg), wetKg: decimal(wetKg) }, readings: [], ...extra };
}

describe('estimateStock', () => {
  it('estimates untouched batches at the moisture they were recorded with', () => {
    const estimate = estimateStock([layer('B-0412', '1240', '843.2'), layer('B-0419', '980', '637')], NOW);
    expect(estimate.wetKg).toBeCloseTo(2220, 6);
    expect(estimate.moisturePercent).toBeCloseTo(33.3243, 3);
    expect(estimate.basis).toEqual({ source: 'recorded', at: T0 });
  });

  it('uses the latest reading taken at or before the time, never a later one', () => {
    const T2 = '2026-09-15T08:00:00.000Z';
    const readings = [
      { moisturePercent: 30, occurredAt: T1, sequence: BigInt(4) },
      { moisturePercent: 20, occurredAt: T2, sequence: BigInt(5) },
      { moisturePercent: 25, occurredAt: T1, sequence: BigInt(3) },
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

describe('planReadings', () => {
  it('resets only the sub-bin the load leaves behind, as in the plan split example', () => {
    const request = { kind: 'ordered' as const, wetKg: 1500, sources: [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }] };
    const plan = planOutputStock([stockLayer('B-0412', '843.2', 1), stockLayer('B-0419', '637', 2)], T1, request);
    const readings = planReadings(request, plan, T1);
    // B-0412 was emptied, so it has no moisture left to reset.
    expect(readings.map(r => [r.layerId, r.moisturePercent])).toEqual([['B-0419', 33]]);
    expect(Number(readings[0].solidsKg.numerator) / Number(readings[0].solidsKg.denominator)).toBeCloseTo(439.063, 3);

    const before = [layer('B-0412', '1240', '843.2'), layer('B-0419', '980', '637')];
    const after = withReadings(before.map(l => ({ ...l, remainingSolidsKg: plan.remainingLayers.find(r => r.id === l.layerId)!.remainingSolidsKg! })), readings, T1, BigInt(3));
    const estimate = estimateStock(after, NOW);
    expect(estimate.wetKg).toBeCloseTo(655.318, 3);
    expect(estimate.moisturePercent).toBeCloseTo(33, 9);
    expect(estimate.basis).toEqual({ source: 'reading', at: T1 });
  });

  it('a count resets every sub-bin present at the counted moisture, and a later arrival keeps its own', () => {
    const later = { ...stockLayer('B-0501', '300', 3), placedAt: NOW };
    const layers = [stockLayer('B-0412', '843.2', 1), stockLayer('B-0419', '637', 2), later];
    const request = { kind: 'count' as const, wetKg: 2100, moisturePercent: 30 };
    const readings = planReadings(request, planOutputStock(layers, T1, request), T1);
    expect(readings.map(r => [r.layerId, r.moisturePercent])).toEqual([['B-0412', 30], ['B-0419', 30]]);
    const zero = { kind: 'count' as const, wetKg: 0 };
    expect(planReadings(zero, planOutputStock(layers, T1, zero), T1)).toEqual([]);
  });

  it('a FIFO draw at one reading resets only the batch it leaves partly drawn', () => {
    const request = { kind: 'wet' as const, wetKg: 1500, moisturePercent: 31 };
    const readings = planReadings(request, planOutputStock([stockLayer('B-0412', '843.2', 1), stockLayer('B-0419', '637', 2)], T1, request), T1);
    expect(readings.map(r => [r.layerId, r.moisturePercent])).toEqual([['B-0419', 31]]);
  });
});
