/** Exact rational quantities; JSON snapshots serialize numerator/denominator as strings. */
export interface Rational { numerator: bigint; denominator: bigint }
export interface StoredRational { numerator: string; denominator: string }
export function storeRational(value: Rational): StoredRational {
  return { numerator: String(value.numerator), denominator: String(value.denominator) };
}
export function readRational(value: unknown): Rational {
  if (!value || typeof value !== 'object' || !('numerator' in value) || !('denominator' in value) ||
    typeof value.numerator !== 'string' || typeof value.denominator !== 'string' ||
    !/^-?\d+$/.test(value.numerator) || !/^\d+$/.test(value.denominator)) {
    throw new RangeError('Exact solids snapshot is missing or invalid');
  }
  return rational(BigInt(value.numerator), BigInt(value.denominator));
}
export type Decimal = string | number;
export const GRAMS_PER_KG = BigInt(1000);
const MAX_DECIMAL_PLACES = 12;
export function rational(numerator: bigint, denominator = BigInt(1)): Rational {
  if (denominator <= BigInt(0)) throw new RangeError('Invalid denominator');
  let a = numerator < BigInt(0) ? -numerator : numerator;
  let b = denominator;
  while (b) { const r = a % b; a = b; b = r; }
  const divisor = a || BigInt(1);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
export function decimal(value: Decimal): Rational {
  if (typeof value !== 'string' && typeof value !== 'number') throw new RangeError('Missing decimal');
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new RangeError('Expected a nonnegative finite decimal');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > MAX_DECIMAL_PLACES) throw new RangeError('Too many decimal places');
  return rational(BigInt(whole + fraction), BigInt(10) ** BigInt(fraction.length));
}
export const add = (a: Rational, b: Rational) => rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
export const subtract = (a: Rational, b: Rational) => add(a, rational(-b.numerator, b.denominator));
export const multiply = (a: Rational, b: Rational) => rational(a.numerator * b.numerator, a.denominator * b.denominator);
export function divide(a: Rational, b: Rational): Rational {
  if (b.numerator <= BigInt(0)) throw new RangeError('Divisor must be positive');
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}
export const compare = (a: Rational, b: Rational) => a.numerator * b.denominator - b.numerator * a.denominator;
export const round = (a: Rational) => (a.numerator * BigInt(2) + a.denominator) / (BigInt(2) * a.denominator);
export function grams(value: Decimal): bigint {
  const result = multiply(decimal(value), rational(GRAMS_PER_KG));
  if (result.denominator !== BigInt(1)) throw new RangeError('Stored mass must have gram precision');
  return result.numerator;
}
export function kilograms(value: bigint): string {
  const sign = value < BigInt(0) ? '-' : '';
  const absolute = value < BigInt(0) ? -value : value;
  return `${sign}${absolute / GRAMS_PER_KG}.${String(absolute % GRAMS_PER_KG).padStart(3, '0')}`;
}
/** Largest remainders, stable input order. Also reusable for mixed delivery applications. */
export function splitGrams(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, BigInt(0));
  if (total < BigInt(0) || weights.some(w => w < BigInt(0)) || total > sum) throw new RangeError('Allocation exceeds provenance');
  if (!sum) return weights.map(() => BigInt(0));
  const shares = weights.map(w => total * w / sum);
  const order = weights.map((w, index) => ({ index, remainder: total * w % sum }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  const remainder = total - shares.reduce((a, b) => a + b, BigInt(0));
  for (let i = 0; BigInt(i) < remainder; i++) shares[order[i].index]++;
  return shares;
}

/**
 * Cumulative proportional entitlement using the Jefferson divisor rule.
 * Unlike largest remainders, increasing the total cannot reduce a run's
 * entitlement. Start at lower quotas, then assign fewer than run-count grams
 * by highest next-seat quotient. This avoids per-draw rounding bias.
 */
export function splitCumulativeGrams(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, BigInt(0));
  if (total < BigInt(0) || weights.some(weight => weight < BigInt(0)) || total > sum) {
    throw new RangeError('Allocation exceeds provenance');
  }
  if (sum === BigInt(0)) return weights.map(() => BigInt(0));
  const shares = weights.map(weight => total * weight / sum);
  let remainder = total - shares.reduce((a, b) => a + b, BigInt(0));
  while (remainder > BigInt(0)) {
    let winner = 0;
    for (let index = 1; index < weights.length; index += 1) {
      if (weights[index] * (shares[winner] + BigInt(1)) >
        weights[winner] * (shares[index] + BigInt(1))) winner = index;
    }
    shares[winner] += BigInt(1);
    remainder -= BigInt(1);
  }
  return shares;
}
