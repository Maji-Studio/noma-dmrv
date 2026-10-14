/**
 * The precision a published stock figure carries: a numeric projection of an
 * exact value, rounded once, never a ledger quantity. Exact arithmetic stays
 * exact until this one conversion, so no float rounding happens before it.
 */
import type { Rational } from './exact';

/** Kilograms publish to the gram. */
export const PUBLISHED_KG_DECIMALS = 3;
/** Percent publishes to two decimals. */
export const PUBLISHED_PERCENT_DECIMALS = 2;

const TEN = BigInt(10);
const TWO = BigInt(2);
const ZERO = BigInt(0);

/**
 * `value` rounded half away from zero to `places` decimals, as the number its
 * decimal text parses to. Never negative zero; refuses a value that is not a
 * finite number.
 */
export function roundHalfAwayFromZero(value: Rational, places: number): number {
  const scale = TEN ** BigInt(places);
  const negative = value.numerator < ZERO;
  const magnitude = negative ? -value.numerator : value.numerator;
  const units = (TWO * magnitude * scale + value.denominator) / (TWO * value.denominator);
  if (units === ZERO) return 0;
  const digits = String(units).padStart(places + 1, '0');
  const text = `${negative ? '-' : ''}${digits.slice(0, digits.length - places)}${places ? `.${digits.slice(digits.length - places)}` : ''}`;
  const result = Number(text);
  if (!Number.isFinite(result)) throw new RangeError('Stock figure is too large to publish');
  return result;
}

export const publishKg = (value: Rational) => roundHalfAwayFromZero(value, PUBLISHED_KG_DECIMALS);
export const publishPercent = (value: Rational) => roundHalfAwayFromZero(value, PUBLISHED_PERCENT_DECIMALS);
