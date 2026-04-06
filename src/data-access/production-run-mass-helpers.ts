import { deriveMassDryKg } from "@/lib/calculations/mass-dry";

export { deriveMassDryKg };

/** Compute dry mass clamped to wet mass (dry can never exceed wet). */
export function computeClampedDryMass(
  wetMassKg: number | null | undefined,
  moisturePercent: number | null | undefined
): number | null {
  if (wetMassKg == null || moisturePercent == null) return null;
  return Math.min(deriveMassDryKg(wetMassKg, moisturePercent), wetMassKg);
}
