import { deriveSourceBiocharDryMassKg } from "@/lib/biochar-composition";
import {
  MASS_COMPARISON_EPSILON_KG,
  roundKg,
} from "@/lib/calculations/mass-dry";

const MASS_PRECISION_FACTOR = 1_000;

function toMassGrams(valueKg: number): bigint {
  return BigInt(Math.round(valueKg * MASS_PRECISION_FACTOR));
}

function gramsToKg(valueGrams: bigint): number {
  return Number(valueGrams) / MASS_PRECISION_FACTOR;
}

function allocateProportionallyInGrams(
  requestedWetKg: number,
  remainingDryKg: number,
  remainingWetKg: number,
): number {
  const requestedWetGrams = toMassGrams(requestedWetKg);
  const remainingDryGrams = toMassGrams(remainingDryKg);
  const remainingWetGrams = toMassGrams(remainingWetKg);
  const numerator = requestedWetGrams * remainingDryGrams;
  return gramsToKg(
    (numerator + remainingWetGrams / BigInt(2)) / remainingWetGrams,
  );
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
    return roundKg(Math.max(0, input.sourceAllocatedDryMassKg));
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
 * Partial transfers use the composition of the remaining wet basis. The
 * transfer that consumes that basis carries the exact dry remainder,
 * preventing cumulative rounding loss. Arithmetic is rounded once in integer
 * grams so persisted credit-bearing allocations do not depend on binary
 * floating-point half-gram boundaries.
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
  const remainingDryKg = Math.max(0, totalDryKg - allocatedDryKg);
  if (
    input.hasUnresolvedDryAllocation ||
    totalDryKg > totalWetKg + MASS_COMPARISON_EPSILON_KG ||
    allocatedWetKg > totalWetKg + MASS_COMPARISON_EPSILON_KG ||
    allocatedDryKg > totalDryKg + MASS_COMPARISON_EPSILON_KG ||
    remainingDryKg > remainingWetKg + MASS_COMPARISON_EPSILON_KG ||
    requestedWetKg > remainingWetKg + MASS_COMPARISON_EPSILON_KG
  ) {
    return null;
  }
  const consumesRemainingWetBasis =
    Math.abs(requestedWetKg - remainingWetKg) <=
      MASS_COMPARISON_EPSILON_KG;

  if (consumesRemainingWetBasis) {
    return roundKg(remainingDryKg);
  }

  if (remainingWetKg <= 0) return requestedWetKg === 0 ? 0 : null;
  return allocateProportionallyInGrams(
    requestedWetKg,
    remainingDryKg,
    remainingWetKg,
  );
}
