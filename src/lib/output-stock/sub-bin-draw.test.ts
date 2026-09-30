import { describe, expect, it } from 'vitest';
import { moveSubBin, orderSubBins, planSubBinRows, subBinSources, type SubBinCapacity } from './sub-bin-draw';

// The plan's split example: B-0412 holds 843.2 kg solids, B-0419 637.0 kg.
const B0412: SubBinCapacity = { layerId: 'b0412', solidsKg: 843.2, estimatedMoisturePercent: 32 };
const B0419: SubBinCapacity = { layerId: 'b0419', solidsKg: 637, estimatedMoisturePercent: 35 };
const B0426: SubBinCapacity = { layerId: 'b0426', solidsKg: 900, estimatedMoisturePercent: 30 };

describe('planSubBinRows', () => {
  it('shows only the first sub-bin before a weight is entered', () => {
    const plan = planSubBinRows([B0412, B0419], {}, null);
    expect(plan.rows.map(r => r.layerId)).toEqual(['b0412']);
    expect(plan.complete).toBe(false);
  });

  it('keeps a load inside the first sub-bin to one row', () => {
    const plan = planSubBinRows([B0412, B0419], { b0412: 30 }, 900);
    expect(plan.rows).toEqual([{ layerId: 'b0412', emptied: false, wetKg: 900 }]);
    expect(plan.unreached).toEqual(['b0419']);
    expect(plan.complete).toBe(true);
  });

  it('reproduces the worked example: B-0412 is emptied, B-0419 takes the rest', () => {
    const plan = planSubBinRows([B0412, B0419], { b0412: 30, b0419: 33 }, 1500);
    expect(plan.rows.map(r => [r.layerId, r.emptied])).toEqual([['b0412', true], ['b0419', false]]);
    expect(plan.rows[0].wetKg).toBeCloseTo(1204.571, 3);
    expect(plan.rows[1].wetKg).toBeCloseTo(295.429, 3);
    expect(plan.shortfallWetKg).toBe(0);
  });

  it('reveals the next row from the estimate before the first reading is typed', () => {
    // 843.2 ÷ 0.68 = 1,240 kg wet at the 32% estimate.
    expect(planSubBinRows([B0412, B0419], {}, 1239).rows).toHaveLength(1);
    expect(planSubBinRows([B0412, B0419], {}, 1241).rows).toHaveLength(2);
  });

  it('lets a typed reading move the boundary', () => {
    // At 30% B-0412 holds 1,204.6 kg wet, so 1,220 kg now reaches B-0419.
    expect(planSubBinRows([B0412, B0419], { b0412: 30 }, 1220).rows).toHaveLength(2);
  });

  it('reaches the next sub-bin a gram past the boundary, as the planner does', () => {
    // At 30% B-0412 holds 843.2 ÷ 0.7 = 1,204.5714 kg wet.
    expect(planSubBinRows([B0412, B0419], { b0412: 30 }, 1204.572).rows).toHaveLength(2);
  });

  it('does not reach the next sub-bin when the load closes one exactly', () => {
    const plan = planSubBinRows([B0412, B0419], { b0412: 32 }, 1240);
    expect(plan.rows).toEqual([{ layerId: 'b0412', emptied: false, wetKg: 1240 }]);
    expect(plan.unreached).toEqual(['b0419']);
  });

  it('stops at a sub-bin whose moisture is unknown until it is read', () => {
    const unknown = { ...B0412, estimatedMoisturePercent: null };
    const plan = planSubBinRows([unknown, B0419], {}, 5000);
    expect(plan.rows).toEqual([{ layerId: 'b0412', emptied: false, wetKg: null }]);
    expect(plan.complete).toBe(false);
    expect(planSubBinRows([unknown, B0419], { b0412: 30 }, 5000).rows).toHaveLength(2);
  });

  it('reports the wet mass the chosen sub-bins cannot cover', () => {
    const plan = planSubBinRows([B0412, B0419], { b0412: 30, b0419: 33 }, 2500);
    expect(plan.rows.every(r => r.emptied)).toBe(true);
    // 1,204.571 + 950.746 = 2,155.318 kg wet.
    expect(plan.shortfallWetKg).toBeCloseTo(344.682, 3);
    expect(plan.complete).toBe(true);
  });

  it('ignores a reading that is not a usable percentage', () => {
    expect(planSubBinRows([B0412, B0419], { b0412: 100 }, 1239).rows).toHaveLength(1);
    expect(planSubBinRows([B0412, B0419], { b0412: Number.NaN }, 1241).rows).toHaveLength(2);
  });
});

describe('subBinSources', () => {
  it('sends the reached sub-bins in order once each has a reading', () => {
    const plan = planSubBinRows([B0412, B0419, B0426], { b0412: 30, b0419: 33 }, 1500);
    expect(subBinSources(plan, { b0412: 30, b0419: 33, b0426: 20 })).toEqual([
      { layerId: 'b0412', moisturePercent: 30 },
      { layerId: 'b0419', moisturePercent: 33 },
    ]);
  });

  it('sends nothing while a reached sub-bin has no reading', () => {
    const plan = planSubBinRows([B0412, B0419], { b0412: 30 }, 1500);
    expect(subBinSources(plan, { b0412: 30 })).toBeNull();
  });
});

describe('orderSubBins', () => {
  it('drains oldest first without an operator order', () => {
    expect(orderSubBins([B0412, B0419, B0426], null).map(s => s.layerId)).toEqual(['b0412', 'b0419', 'b0426']);
  });

  it('keeps only ticked sub-bins, in the operator order, that are still in the bin', () => {
    expect(orderSubBins([B0412, B0419, B0426], ['b0426', 'gone', 'b0412']).map(s => s.layerId)).toEqual(['b0426', 'b0412']);
  });
});

describe('moveSubBin', () => {
  it('moves one sub-bin up or down and leaves the ends in place', () => {
    expect(moveSubBin(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveSubBin(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveSubBin(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveSubBin(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
  });

  it('moves a sub-bin to a dropped position', () => {
    expect(moveSubBin(['a', 'b', 'c'], 'c', { to: 0 })).toEqual(['c', 'a', 'b']);
    expect(moveSubBin(['a', 'b', 'c'], 'a', { to: 2 })).toEqual(['b', 'c', 'a']);
  });
});
