import {
  resolveCertFieldStatus,
  type CertFieldStatus,
} from "@/components/forms/cert-field-status";
import { hasDocumentBackedDistanceProvenance } from "@/lib/certification/transport-evidence";
import type { DistanceSourceValue } from "@/schemas/distance-source";

interface TransportLegCertValues {
  distanceKm: number | null | undefined;
  distanceSource?: DistanceSourceValue | null;
  loadMassKg: number | null | undefined;
}

export interface TransportLegCertStatuses {
  distance: CertFieldStatus;
  provenance: CertFieldStatus;
  load: CertFieldStatus;
}

/** Aggregate saved-row status used by transport-leg read-only/edit headers. */
export function deriveTransportLegCertStatuses(
  legs: readonly TransportLegCertValues[] | undefined,
  persisted: boolean,
): TransportLegCertStatuses {
  const savedRowsKnown = persisted && legs !== undefined ? true : undefined;
  const rows = legs ?? [];
  const hasLegs = rows.length > 0;

  return {
    distance: resolveCertFieldStatus(
      savedRowsKnown,
      hasLegs && rows.every((leg) => Number.isFinite(leg.distanceKm)),
    ),
    provenance: resolveCertFieldStatus(
      savedRowsKnown,
      hasLegs &&
        rows.every((leg) =>
          hasDocumentBackedDistanceProvenance(leg.distanceSource),
        ),
    ),
    load: resolveCertFieldStatus(
      savedRowsKnown,
      hasLegs &&
        rows.every(
          (leg) => leg.loadMassKg != null && Number.isFinite(leg.loadMassKg),
        ),
    ),
  };
}
