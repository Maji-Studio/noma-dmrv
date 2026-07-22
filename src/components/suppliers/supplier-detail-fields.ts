import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";

interface SupplierFallbackDistanceInput {
  defaultLocationDistanceKm: number | null;
  legacySupplierDistanceKm: number | null;
}

/** The default structured location wins; the supplier column remains the legacy fallback. */
export function buildSupplierFallbackDistanceField(
  {
    defaultLocationDistanceKm,
    legacySupplierDistanceKm,
  }: SupplierFallbackDistanceInput,
): DetailPanelField {
  const effectiveDistanceKm =
    defaultLocationDistanceKm ?? legacySupplierDistanceKm;

  return {
    label: "Distance to Facility",
    ...certificationDetailField("supplier", "distanceToFacilityKm"),
    certifyStatus: resolveCertFieldStatus(
      true,
      effectiveDistanceKm !== null,
    ),
    value: effectiveDistanceKm !== null ? `${effectiveDistanceKm} km` : null,
  };
}
