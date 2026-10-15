import type { DetailPanelField } from "@/components/ui/detail-panel";
import { positiveOrNull } from "@/lib/calculations/transport-leg";
import { MISSING_VALUE } from "@/lib/copy-utils";

interface SupplierDefaultLocationDistanceInput {
  defaultLocationDistanceKm: number | null;
  locationsLoaded: boolean;
  locationsError?: boolean;
}

/** Distance recorded on the default supplier location. */
export function resolveSupplierEffectiveDistanceKm({
  defaultLocationDistanceKm,
}: Pick<SupplierDefaultLocationDistanceInput, "defaultLocationDistanceKm">): number | null {
  return positiveOrNull(defaultLocationDistanceKm);
}

/** Distance recorded on the default supplier location. */
export function buildSupplierDefaultLocationDistanceField(
  {
    defaultLocationDistanceKm,
    locationsLoaded,
    locationsError,
  }: SupplierDefaultLocationDistanceInput,
): DetailPanelField {
  if (!locationsLoaded) {
    if (locationsError) {
      return {
        label: "Distance to facility",
        value: null,
        emptySituation: "notAvailable",
      };
    }

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
