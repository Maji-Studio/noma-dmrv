import { GRAMS_PER_KG, massGrams } from "@/lib/calculations/gram-allocation";

// Five kg rounds up to the smallest visible amount at two-decimal tonne precision.
export const MIN_VISIBLE_NOT_APPLIED_DRY_KG = 5;

/** Carry requires no remaining mass at gram precision; unknown mass stays closed. */
export function isCreditBatchFullyApplied(notAppliedDryKg: number | null) {
  return notAppliedDryKg !== null && massGrams(notAppliedDryKg) === 0;
}

/** Shared page and carry gate: saved application slices are the dry-mass authority. */
export function creditBatchApplicationMass(
  runs: readonly { biocharDryMassKg: number | null }[],
  slices: readonly { dryKg: number }[],
) {
  const producedDryGrams = runs.length > 0 && runs.every(run => run.biocharDryMassKg !== null)
    ? runs.reduce((sum, run) => sum + massGrams(run.biocharDryMassKg!), 0) : null;
  const appliedDryGrams = slices.reduce((sum, slice) => sum + massGrams(slice.dryKg), 0);
  return {
    producedDryKg: producedDryGrams === null ? null : producedDryGrams / GRAMS_PER_KG,
    appliedDryKg: appliedDryGrams / GRAMS_PER_KG,
    notAppliedDryKg: producedDryGrams === null ? null : Math.max(0, producedDryGrams - appliedDryGrams) / GRAMS_PER_KG,
  };
}
