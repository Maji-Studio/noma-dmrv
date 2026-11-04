import { fromCompositionMassJsonb } from "@/lib/biochar-composition/composition";
import { formatFacilityDate } from "@/lib/date-utils";

/**
 * Composition ingredients are non-biochar blend inputs. Zero-mass recipe
 * lines were not used; neither a formulation nor added water alone is a blend.
 * Pure products retain the oldest drawn run's facility-local calendar day.
 */
export function deriveBiocharProductProductionDate(input: {
  composition: unknown;
  placedAt: Date;
  facilityTimezone: string;
  sourceRunDate: string;
}): string {
  const mixed = fromCompositionMassJsonb(input.composition)
    .some(ingredient => typeof ingredient.massKg === "number" && ingredient.massKg > 0);
  return mixed
    ? formatFacilityDate(input.placedAt, input.facilityTimezone)
    : input.sourceRunDate;
}
