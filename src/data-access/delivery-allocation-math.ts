import { splitCumulativeGrams } from "@/lib/output-stock/exact";

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

export interface DeliveryRunShare {
  deliveryId: string;
  biocharProductId: string;
  productionRunId: string;
  dryMassKg: number;
  wetMassKg: number;
}

/** Allocate against saved remaining shares, never current bin stock or FIFO. */
export function allocateApplicationShares(
  saved: DeliveryRunShare[],
  used: DeliveryRunShare[],
  requestedWetKg: number,
  requestedDryKg: number,
): DeliveryRunShare[] {
  const key = (s: DeliveryRunShare) => `${s.biocharProductId}:${s.productionRunId}`;
  const remaining = saved.map(share => {
    const prior = used.filter(s => key(s) === key(share));
    return {
      ...share,
      wet: massGrams(share.wetMassKg) - prior.reduce((n, s) => n + massGrams(s.wetMassKg), 0),
      dry: massGrams(share.dryMassKg) - prior.reduce((n, s) => n + massGrams(s.dryMassKg), 0),
    };
  });
  const wet = massGrams(requestedWetKg);
  const dry = massGrams(requestedDryKg);
  if (remaining.some(s => s.wet < 0 || s.dry < 0) || wet > remaining.reduce((n, s) => n + s.wet, 0) || dry > remaining.reduce((n, s) => n + s.dry, 0)) {
    throw new Error("Application exceeds saved delivery allocations");
  }
  // Target cumulative quotas against the original saved truck. Repeated tiny
  // applications must not repeatedly award the rounding gram to the largest
  // product. Positive deficits also handle edits/deletes without rewriting
  // existing applications. The shared monotone cumulative entitlement avoids
  // withdrawing a previously allocated gram as the total increases.
  const apportion = (requested: number, basis: "wet" | "dry") => {
    const original = saved.map(s => massGrams(basis === "wet" ? s.wetMassKg : s.dryMassKg));
    const consumed = original.map((grams, i) => grams - remaining[i][basis]);
    // Database result ordering must never decide which source wins a tie.
    const order = saved.map((share, index) => ({ index, key: key(share) }))
      .sort((left, right) => left.key.localeCompare(right.key));
    const cumulative = splitCumulativeGrams(
      BigInt(requested + consumed.reduce((n, grams) => n + grams, 0)),
      order.map(({ index }) => BigInt(original[index])),
    );
    const orderedParts = splitGrams(requested, cumulative.map((grams, i) =>
      Math.max(0, Number(grams) - consumed[order[i].index])));
    const parts = original.map(() => 0);
    order.forEach(({ index }, i) => { parts[index] = orderedParts[i]; });
    return parts;
  };
  const wetParts = apportion(wet, "wet");
  const dryParts = apportion(dry, "dry");
  return remaining.map((s, i) => ({ deliveryId: s.deliveryId, biocharProductId: s.biocharProductId,
    productionRunId: s.productionRunId, wetMassKg: wetParts[i] / GRAMS_PER_KG, dryMassKg: dryParts[i] / GRAMS_PER_KG }));
}
