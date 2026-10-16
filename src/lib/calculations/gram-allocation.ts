/** Integer-gram apportionment. Stable input order breaks equal remainders. */
export const GRAMS_PER_KG = 1000;
export function massGrams(kg: number): number {
  if (!Number.isFinite(kg)) throw new Error("Invalid allocation mass");
  const grams = Math.round(kg * GRAMS_PER_KG);
  if (!Number.isSafeInteger(grams)) throw new Error("Allocation mass exceeds precision");
  return grams;
}

export function splitGrams(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) {
    throw new Error("Invalid gram allocation");
  }
  const denominator = weights.reduce((sum, w) => sum + BigInt(w), BigInt(0));
  if (denominator === BigInt(0)) {
    if (total !== 0) throw new Error("Missing allocation weights");
    return weights.map(() => 0);
  }
  const numerators = weights.map(w => BigInt(total) * BigInt(w));
  const result = numerators.map(n => Number(n / denominator));
  const order = numerators.map((n, i) => ({ i, remainder: n % denominator }))
    .sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  const remainder = total - result.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < remainder; i++) result[order[i].i]++;
  return result;
}

