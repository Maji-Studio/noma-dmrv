export const DELIVERED_WET_MASS_REQUIRED_MESSAGE =
  "Enter a wet mass greater than 0 before marking this delivery as delivered";
/** Smallest positive value retained by the `numeric(14,3)` kg column. */
export const DELIVERED_WET_MASS_MIN_KG = 0.001;

export function hasPositiveDeliveredWetMass(
  deliveredWetMassKg: number | null | undefined,
): deliveredWetMassKg is number {
  return (
    deliveredWetMassKg != null &&
    Number.isFinite(deliveredWetMassKg) &&
    deliveredWetMassKg >= DELIVERED_WET_MASS_MIN_KG
  );
}
