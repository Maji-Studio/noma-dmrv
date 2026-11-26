import { deriveMassDryKg } from '@/lib/calculations/mass-dry';
import { SafeError } from '@/lib/errors';
import { MASS_INPUT_MAX_KG } from '@/schemas/helpers';
import { RETURN_PERCENT_SCALE, RETURN_MOISTURE_PERCENT_STEP } from '@/schemas/production-run-returns';

export const RETURN_GRAMS_PER_KG = 1_000;
export const RETURN_SNAPSHOT_VERSION = 1;
export const RETURN_OVER_CAP_MESSAGE = 'This is more dry solids than the run can still return. Reduce the wet mass or check the moisture.';
export function returnGrams(kg: number): number {
  const grams = Math.round(kg * RETURN_GRAMS_PER_KG);
  if (!Number.isFinite(kg) || !Number.isSafeInteger(grams)) throw new SafeError('Enter a valid mass.');
  return grams;
}
export function returnMassBasis(wetMassKg: number, moisturePercent: number) {
  if (!Number.isFinite(wetMassKg) || wetMassKg <= 0 || wetMassKg > MASS_INPUT_MAX_KG ||
      !Number.isFinite(moisturePercent) || moisturePercent < 0 || moisturePercent >= RETURN_PERCENT_SCALE) {
    throw new SafeError('Enter positive wet mass and measured moisture below 100%.');
  }
  const wetKg = returnGrams(wetMassKg) / RETURN_GRAMS_PER_KG;
  const storedPercent = Math.round(moisturePercent / RETURN_MOISTURE_PERCENT_STEP) * RETURN_MOISTURE_PERCENT_STEP;
  const dryKg = deriveMassDryKg(wetKg, storedPercent);
  if (dryKg <= 0) throw new SafeError('Returned material must contain at least one gram of dry solids.');
  return { wetKg, dryKg, moistureRatio: storedPercent / RETURN_PERCENT_SCALE };
}
/** No display tolerance: every committed gram participates in the source cap. */
export function remainingReturnDryKg(consumedDryKg: number, signedReturns: readonly number[]): number {
  const remaining = returnGrams(consumedDryKg) - signedReturns.reduce((sum, mass) => sum + returnGrams(mass), 0);
  if (remaining < 0) throw new SafeError(RETURN_OVER_CAP_MESSAGE);
  return remaining / RETURN_GRAMS_PER_KG;
}
export function assertReturnTime(occurredAt: Date, runEnd: Date | null, now: Date): void {
  if (!runEnd || !Number.isFinite(occurredAt.getTime()) || occurredAt < runEnd || occurredAt > now) {
    throw new SafeError('Choose a return time at or after the run ended and no later than now.');
  }
}
/** Reverse persisted quantities, never recompute them using a new measurement. */
export function reverseReturnMass(original: { massDeltaKg: number; feedstockDryDeltaKg: number | null; moistureRatioUsed: number | null }) {
  if (original.feedstockDryDeltaKg === null || original.moistureRatioUsed === null) throw new SafeError('Return measurement is missing.');
  return { massDeltaKg: -original.massDeltaKg, feedstockDryDeltaKg: -original.feedstockDryDeltaKg, moistureRatioUsed: original.moistureRatioUsed };
}
