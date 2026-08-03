import {
  resolveCertFieldStatus,
  type CertFieldStatus,
} from "@/components/forms/cert-field-status";
import {
  getCertifyFieldDescriptor,
  type CertifyEntityKind,
} from "@/lib/certification/certify-field-registry";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";

interface TransportLegCertValues {
  distanceKm: number | null | undefined;
  distanceSource?: DistanceSourceValue | null;
  loadMassKg: number | null | undefined;
}

export interface TransportLegCertStatuses {
  distance: CertFieldStatus;
  provenance?: {
    label: string;
    status: CertFieldStatus;
  };
  load: CertFieldStatus;
}

const ENTITY_CERTIFY_KIND: Record<TransportEntityTypeValue, CertifyEntityKind> = {
  feedstock: "feedstock",
  sample: "sample",
  biochar: "transportLeg",
};

function getProvenanceDescriptor(entityType: TransportEntityTypeValue) {
  return getCertifyFieldDescriptor(
    ENTITY_CERTIFY_KIND[entityType],
    "transportDistanceProvenance",
  );
}

/** Aggregate saved-row status used by transport-leg read-only/edit headers. */
export function deriveTransportLegCertStatuses(
  legs: readonly TransportLegCertValues[] | undefined,
  persisted: boolean,
  entityType: TransportEntityTypeValue,
): TransportLegCertStatuses {
  const savedRowsKnown = persisted && legs !== undefined ? true : undefined;
  const rows = legs ?? [];
  const hasLegs = rows.length > 0;
  const provenanceDescriptor = getProvenanceDescriptor(entityType);

  return {
    distance: resolveCertFieldStatus(
      savedRowsKnown,
      hasLegs && rows.every((leg) => Number.isFinite(leg.distanceKm)),
    ),
    provenance: provenanceDescriptor
      ? {
          label: provenanceDescriptor.label,
          status: resolveCertFieldStatus(
            savedRowsKnown,
            hasLegs && rows.every((leg) => leg.distanceSource != null),
          ),
        }
      : undefined,
    load: resolveCertFieldStatus(
      savedRowsKnown,
      hasLegs &&
        rows.every(
          (leg) => leg.loadMassKg != null && Number.isFinite(leg.loadMassKg),
        ),
    ),
  };
}
