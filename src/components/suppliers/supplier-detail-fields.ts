import type { DetailPanelField } from "@/components/ui/detail-panel";
import { positiveOrNull } from "@/lib/calculations/transport-leg";
import { MISSING_VALUE } from "@/lib/copy-utils";

interface SupplierDefaultLocationDistanceInput {
  defaultLocationDistanceKm: number | null;
  locationsLoaded: boolean;
}

/** Distance recorded on the default supplier location. */
export function resolveSupplierEffectiveDistanceKm({
  defaultLocationDistanceKm,
}: Omit<SupplierDefaultLocationDistanceInput, "locationsLoaded">): number | null {
  return positiveOrNull(defaultLocationDistanceKm);
}

/** Distance recorded on the default supplier location. */
export function buildSupplierDefaultLocationDistanceField(
  {
    defaultLocationDistanceKm,
    locationsLoaded,
  }: SupplierDefaultLocationDistanceInput,
): DetailPanelField {
  if (!locationsLoaded) {
    return {
      label: "Distance to facility",
      value: null,
      pending: true,
    };
  }

  const effectiveDistanceKm = resolveSupplierEffectiveDistanceKm({
    defaultLocationDistanceKm,
  });

  return {
    label: "Distance to facility",
    value:
      effectiveDistanceKm !== null
        ? `${effectiveDistanceKm} km`
        : MISSING_VALUE.notSet,
  };
}
