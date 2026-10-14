import { describe, expect, it } from 'vitest';
import { decimal, rational } from './exact';
import { publishKg, publishPercent, roundHalfAwayFromZero } from './stock-precision';

describe('published stock numbers', () => {
  it('rounds kilograms once to grams, half away from zero', () => {
    expect(publishKg(decimal('1.0005'))).toBe(1.001);
    expect(publishKg(decimal('1.00049999'))).toBe(1);
    expect(publishKg(rational(BigInt(-10005), BigInt(10000)))).toBe(-1.001);
    expect(publishKg(rational(BigInt(2), BigInt(3)))).toBe(0.667);
    expect(publishKg(decimal('1240'))).toBe(1240);
  });

  it('rounds percent to two decimals from the exact value, never from a float', () => {
    // 0.145 is 0.14499999999999999 as a double; the exact value is a tie and rounds up.
    expect(publishPercent(decimal('0.145'))).toBe(0.15);
    expect(publishPercent(rational(BigInt(100), BigInt(3)))).toBe(33.33);
    expect(publishPercent(rational(BigInt(200), BigInt(3)))).toBe(66.67);
  });

  it('never publishes negative zero', () => {
    const tiny = rational(BigInt(-1), BigInt(1_000_000));
    expect(Object.is(publishKg(tiny), 0)).toBe(true);
    expect(Object.is(publishPercent(rational(BigInt(0))), 0)).toBe(true);
  });

  it('refuses a value too large to publish as a finite number', () => {
    expect(() => roundHalfAwayFromZero(rational(BigInt(10) ** BigInt(400)), 3)).toThrow(RangeError);
  });

  it('matches the number the decimal text parses to', () => {
    for (const text of ['0.001', '123.456', '9999999.999', '0.1', '0.3']) expect(publishKg(decimal(text))).toBe(Number(text));
  });
});
