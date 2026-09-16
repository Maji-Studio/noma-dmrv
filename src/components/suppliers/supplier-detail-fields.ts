import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";
import { positiveOrNull } from "@/lib/calculations/transport-leg";
import { MISSING_VALUE } from "@/lib/copy-utils";
import {
  resolveSupplierLocationDisplay,
  type SupplierLocationDisplayParts,
} from "@/lib/supplier-location-display";

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
      pending: true,
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
    value:
      effectiveDistanceKm !== null
        ? `${effectiveDistanceKm} km`
        : MISSING_VALUE.notSet,
  };
}

interface SupplierLocationFieldInput {
  legacySupplierLocation: string | null;
  locations: SupplierLocationDisplayParts[];
  locationsLoaded: boolean;
}

/**
 * The supplier's single-line location label. The legacy supplier column
 * resolves on its own, so a supplier that carries one shows it immediately; a
 * label that can only come from the structured locations stays pending until
 * that query settles, because "Not recorded" would blame the operator for a
 * value the app has not read yet.
 */
export function buildSupplierLocationField({
  legacySupplierLocation,
  locations,
  locationsLoaded,
}: SupplierLocationFieldInput): DetailPanelField {
  const display = resolveSupplierLocationDisplay(
    legacySupplierLocation,
    locations,
  );

  return {
    label: "Location",
    value: display,
    pending: display === null && !locationsLoaded,
  };
}
