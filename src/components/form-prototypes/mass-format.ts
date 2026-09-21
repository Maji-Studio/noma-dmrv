import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";

const MIN_DISPLAY_MASS_KG = 0.1;

/** Keep small positive quantities distinct from zero at the canonical precision. */
export function derivedMass(value: number | null) {
  if (value === null || !Number.isFinite(value)) return MISSING_VALUE.notAvailable;
  return value > 0 && value < MIN_DISPLAY_MASS_KG ? `<${formatMassKg(MIN_DISPLAY_MASS_KG)}` : formatMassKg(value);
}
