import { describe, expect, it } from 'vitest';
import { assertReturnTime, remainingReturnDryKg, returnMassBasis, reverseReturnMass } from './mass';

describe('failed-run return mass', () => {
  it('derives gram-resolution solids and allows wetter returns', () => {
    expect(returnMassBasis(200, 75)).toEqual({ wetKg: 200, dryKg: 50, moistureRatio: 0.75 });
    expect(returnMassBasis(0.003, 50).dryKg).toBe(0.002);
    expect(remainingReturnDryKg(50, [returnMassBasis(200, 75).dryKg])).toBe(0);
  });
  it('compares cumulative grams exactly with no display tolerance', () => {
    expect(remainingReturnDryKg(0.3, [0.1, 0.2])).toBe(0);
    expect(() => remainingReturnDryKg(0.3, [0.1, 0.201])).toThrow('exceeds');
    expect(remainingReturnDryKg(10, [7, -7, 8])).toBe(2);
  });
  it.each([[0, 20], [-1, 20], [Infinity, 20], [NaN, 20], [1, NaN], [1, -1], [1, 100], [0.001, 99.99]])('refuses invalid or zero-solids mass %s / %s', (wet, moisture) => {
    expect(() => returnMassBasis(wet, moisture)).toThrow();
  });
  it('reverses persisted measurements exactly', () => {
    expect(reverseReturnMass({ massDeltaKg: 1.001, feedstockDryDeltaKg: 0.667, moistureRatioUsed: 0.333333 }))
      .toEqual({ massDeltaKg: -1.001, feedstockDryDeltaKg: -0.667, moistureRatioUsed: 0.333333 });
  });
  it('requires a physical instant between run end and now, inclusive', () => {
    const end = new Date('2026-01-01T10:00:00Z');
    const now = new Date('2026-01-01T12:00:00Z');
    expect(() => assertReturnTime(end, end, now)).not.toThrow();
    expect(() => assertReturnTime(now, end, now)).not.toThrow();
    for (const at of [new Date('invalid'), new Date('2026-01-01T09:00:00Z'), new Date('2026-01-01T13:00:00Z')]) {
      expect(() => assertReturnTime(at, end, now)).toThrow();
    }
    expect(() => assertReturnTime(now, null, now)).toThrow();
  });
});
