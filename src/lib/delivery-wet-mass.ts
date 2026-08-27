import { MASS_KG_STORAGE_INCREMENT } from "@/config/numeric-storage";

/** Smallest positive value retained by the `numeric(14,3)` kg column. */
export const DELIVERED_WET_MASS_MIN_KG = MASS_KG_STORAGE_INCREMENT;
export const DELIVERED_WET_MASS_RANGE_MESSAGE =
  `Wet mass must be at least ${DELIVERED_WET_MASS_MIN_KG} kg`;
export const DELIVERED_WET_MASS_REQUIRED_MESSAGE =
  `Enter a wet mass of at least ${DELIVERED_WET_MASS_MIN_KG} kg before marking this delivery as delivered`;

export function hasStorableDeliveredWetMass(
  deliveredWetMassKg: number | null | undefined,
): deliveredWetMassKg is number {
  return (
    deliveredWetMassKg != null &&
    Number.isFinite(deliveredWetMassKg) &&
    deliveredWetMassKg >= DELIVERED_WET_MASS_MIN_KG
  );
}

export function deliveryWetMassRequiredMessage(deliveryCode: string): string {
  return `Delivery ${deliveryCode} needs a wet mass of at least ${DELIVERED_WET_MASS_MIN_KG} kg before it can be marked as delivered.`;
}
