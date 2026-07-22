import type { DetailPanelField } from "@/components/ui/detail-panel";
import { resolveCertFieldStatus } from "@/components/forms/cert-field-status";
import { certificationDetailField } from "@/lib/certification/certify-field-registry";

/** Supplier-level distance remains the fallback when no supplier-location distance is saved. */
export function buildSupplierFallbackDistanceField(
  distanceToFacilityKm: number | null,
): DetailPanelField {
  return {
    label: "Distance to Facility",
    ...certificationDetailField("supplier", "distanceToFacilityKm"),
    certifyStatus: resolveCertFieldStatus(
      true,
      distanceToFacilityKm !== null,
    ),
    value:
      distanceToFacilityKm !== null ? `${distanceToFacilityKm} km` : null,
  };
}
