import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { positiveOrNull } from "@/lib/calculations/transport-leg";

interface SupplierFallbackDistanceInput {
  defaultLocationDistanceKm: number | null;
  legacySupplierDistanceKm: number | null;
  locationsLoaded: boolean;
}

/**
 * The one derivation of a supplier's effective transport distance: the
 * default structured location wins; the supplier column remains the legacy
 * fallback. Every surface showing "distance to facility" (list side sheet,
 * detail page summary) must resolve through this, never read one column raw.
 */
export function resolveSupplierEffectiveDistanceKm({
  defaultLocationDistanceKm,
  legacySupplierDistanceKm,
}: Omit<SupplierFallbackDistanceInput, "locationsLoaded">): number | null {
  return (
    positiveOrNull(defaultLocationDistanceKm) ??
    positiveOrNull(legacySupplierDistanceKm)
  );
}

/** The default structured location wins; the supplier column remains the legacy fallback. */
export function buildSupplierFallbackDistanceField(
  {
    defaultLocationDistanceKm,
    legacySupplierDistanceKm,
    locationsLoaded,
  }: SupplierFallbackDistanceInput,
): DetailPanelField {
  if (!locationsLoaded) {
    return {
      label: "Distance to facility",
      ...certificationDetailField("supplier", "distanceToFacilityKm"),
      certifyStatus: "neutral",
      value: null,
    };
  }

  const effectiveDistanceKm = resolveSupplierEffectiveDistanceKm({
    defaultLocationDistanceKm,
    legacySupplierDistanceKm,
  });

  return {
    label: "Distance to facility",
    ...certificationDetailField("supplier", "distanceToFacilityKm"),
    certifyStatus: resolveCertFieldStatus(
      true,
      effectiveDistanceKm !== null,
    ),
    value: effectiveDistanceKm !== null ? `${effectiveDistanceKm} km` : null,
  };
}
