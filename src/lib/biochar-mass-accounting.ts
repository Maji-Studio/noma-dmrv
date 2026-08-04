import { deriveSourceBiocharDryMassKg } from "@/lib/biochar-composition";

const MASS_PRECISION_FACTOR = 1_000;
export const MASS_ALLOCATION_EPSILON_KG = 0.001;

function roundMassKg(value: number): number {
  return Math.round(value * MASS_PRECISION_FACTOR) / MASS_PRECISION_FACTOR;
}

export interface ProductDryBiocharInput {
  sourceAllocatedDryMassKg?: number | null;
  blendMassKg: number | null | undefined;
  biocharMoisturePercent: number | null | undefined;
  ingredients: readonly { massKg?: unknown; massDryKg?: unknown }[];
}

/**
 * Resolve a product's conserved dry biochar. New products use immutable source
 * allocation rows. Legacy products without allocation rows fall back to the
 * source-biochar wet mass and its biochar-only moisture measurement.
 */
export function resolveProductDryBiocharKg(
  input: ProductDryBiocharInput,
): number | null {
  if (input.sourceAllocatedDryMassKg != null) {
    return roundMassKg(Math.max(0, input.sourceAllocatedDryMassKg));
  }

  return deriveSourceBiocharDryMassKg(
    input.blendMassKg,
    input.biocharMoisturePercent,
    input.ingredients,
  );
}

export interface TrackedDryAllocationInput {
  totalWetKg: number | null | undefined;
  totalDryBiocharKg: number | null | undefined;
  requestedWetKg: number | null | undefined;
  allocatedWetKg?: number | null;
  allocatedDryBiocharKg?: number | null;
  hasUnresolvedDryAllocation?: boolean;
}

/**
 * Allocate conserved dry biochar on the homogeneous recorded-wet-mass basis.
 * Partial transfers use the original product ratio. The transfer that consumes
 * the entire remaining wet basis carries the exact dry remainder, preventing
 * cumulative rounding loss.
 */
export function allocateTrackedDryBiocharKg(
  input: TrackedDryAllocationInput,
): number | null {
  const totalWetKg = input.totalWetKg;
  const totalDryKg = input.totalDryBiocharKg;
  const requestedWetKg = input.requestedWetKg;
  if (
    totalWetKg == null ||
    totalDryKg == null ||
    requestedWetKg == null ||
    !Number.isFinite(totalWetKg) ||
    !Number.isFinite(totalDryKg) ||
    !Number.isFinite(requestedWetKg) ||
    totalWetKg <= 0 ||
    totalDryKg < 0 ||
    requestedWetKg < 0
  ) {
    return null;
  }

  const allocatedWetKg = Math.max(0, input.allocatedWetKg ?? 0);
  const allocatedDryKg = Math.max(0, input.allocatedDryBiocharKg ?? 0);
  const remainingWetKg = Math.max(0, totalWetKg - allocatedWetKg);
  const consumesRemainingWetBasis =
    !input.hasUnresolvedDryAllocation &&
    Math.abs(requestedWetKg - remainingWetKg) <= MASS_ALLOCATION_EPSILON_KG;

  if (consumesRemainingWetBasis) {
    return roundMassKg(Math.max(0, totalDryKg - allocatedDryKg));
  }

  return roundMassKg(requestedWetKg * (totalDryKg / totalWetKg));
}
