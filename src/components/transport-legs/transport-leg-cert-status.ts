import {
  resolveCertFieldStatus,
  type CertFieldStatus,
} from "@/components/forms/cert-field-status";
import { hasCompleteTransportEvidence } from "@/lib/certification/transport-evidence";
import type { DistanceSourceValue } from "@/schemas/distance-source";

interface TransportLegCertValues {
  distanceKm: number | null | undefined;
  distanceSource?: DistanceSourceValue | null;
  loadMassKg: number | null | undefined;
  /**
   * Accepted transport-evidence uploads backing this leg (absent on deferred
   * rows that were never saved). Absence keeps the evidence status missing.
   */
  transportEvidenceDocumentCount?: number | null;
}

export interface TransportLegCertStatuses {
  distance: CertFieldStatus;
  provenance: CertFieldStatus;
  evidence: CertFieldStatus;
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
        rows.every((leg) => leg.distanceSource != null),
    ),
    evidence: resolveCertFieldStatus(
      savedRowsKnown,
      hasLegs &&
        rows.every((leg) =>
          hasCompleteTransportEvidence(leg.transportEvidenceDocumentCount),
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
