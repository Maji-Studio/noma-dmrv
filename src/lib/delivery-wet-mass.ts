export const DELIVERED_WET_MASS_REQUIRED_MESSAGE =
  "Enter a wet mass greater than 0 before marking this delivery as delivered";

export function hasPositiveDeliveredWetMass(
  deliveredWetMassKg: number | null | undefined,
): deliveredWetMassKg is number {
  return (
    deliveredWetMassKg != null &&
    Number.isFinite(deliveredWetMassKg) &&
    deliveredWetMassKg > 0
  );
}
