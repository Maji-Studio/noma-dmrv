/** Tolerance for comparing kg values derived from decimal form inputs. */
export const MASS_COMPARISON_EPSILON_KG = 0.001;
export const DRY_MASS_EXCEEDS_WET_MESSAGE =
  "Dry mass cannot exceed wet mass. Reduce the dry mass.";

export function exceedsMassWithTolerance(
  candidateMassKg: number,
  referenceMassKg: number,
): boolean {
  return candidateMassKg > referenceMassKg + MASS_COMPARISON_EPSILON_KG;
}

export function roundKg(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function deriveMassDryKg(
  deliveredWetMassKg: number,
  moisturePercent: number
): number {
  if (deliveredWetMassKg < 0) {
    throw new RangeError('deliveredWetMassKg must be >= 0');
  }

  if (moisturePercent < 0 || moisturePercent > 100) {
    throw new RangeError('moisturePercent must be between 0 and 100');
  }

  return roundKg(deliveredWetMassKg * (1 - moisturePercent / 100));
}

/**
 * Dry (carbon) solids for a product that may have had water added.
 *
 * Dry solids are determined by the product's pre-water mass and moisture only —
 * adding water raises wet mass and final moisture but cannot create dry matter.
 * `moisturePercent` is the pre-water product moisture, so `addedWaterKg` does
 * not enter the dry-mass figure (it is still validated as a non-negative input;
 * callers compute effective wet mass / final moisture separately).
 */
export function deriveMassDryKgWithAddedWater(
  wetMassKg: number,
  moisturePercent: number,
  addedWaterKg: number | null | undefined
): number {
  const waterAddedKg = addedWaterKg ?? 0;

  if (!Number.isFinite(waterAddedKg) || waterAddedKg < 0) {
    throw new RangeError('addedWaterKg must be a finite number >= 0');
  }

  return deriveMassDryKg(wetMassKg, moisturePercent);
}

/** Compute dry mass clamped to wet mass (dry can never exceed wet). */
export function computeClampedDryMass(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined
): number | null {
  if (wetMassKg == null || moisturePercent == null) return null;
  if (!Number.isFinite(wetMassKg) || !Number.isFinite(moisturePercent)) {
    return null;
  }
  if (wetMassKg < 0 || moisturePercent < 0 || moisturePercent > 100) {
    return null;
  }
  return Math.min(deriveMassDryKg(wetMassKg, moisturePercent), wetMassKg);
}

export function dryOutputExceedsDryInput(input: {
  feedstockWetMassKg?: number | null;
  feedstockMoisturePercent?: number | null;
  biocharOutputKg?: number | null;
  biocharMoisturePercent?: number | null;
}): boolean {
  if (
    input.feedstockWetMassKg == null ||
    input.feedstockMoisturePercent == null
  ) {
    return false;
  }

  const biocharDryMassKg = computeClampedDryMass(
    input.biocharOutputKg,
    input.biocharMoisturePercent,
  );
  if (biocharDryMassKg == null) return false;

  const feedstockDryMassKg = deriveMassDryKg(
    input.feedstockWetMassKg,
    input.feedstockMoisturePercent,
  );
  return exceedsMassWithTolerance(biocharDryMassKg, feedstockDryMassKg);
}
