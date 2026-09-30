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

/**
 * Short operator-facing name of each certification requirement a transport leg
 * carries. The registry label ("Transport distance provenance") is written for
 * the registry, not for a caption under a leg row.
 */
const REQUIREMENT_NAMES = {
  distance: "distance",
  provenance: "distance source",
  load: "load",
} as const;

export interface TransportLegCertSummary {
  status: CertFieldStatus;
  description: string;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Collapse the per-field statuses into the one chip the section header shows.
 *
 * The three chips used to sit in table column headers, where they forced every
 * header to wrap at sheet width. One chip per section says the same thing: the
 * worst status wins, and the tooltip names the requirements that are still
 * missing, so the colour is never the only signal.
 */
export function summarizeTransportLegCertStatuses(
  statuses: TransportLegCertStatuses,
): TransportLegCertSummary {
  const entries: Array<{ name: string; status: CertFieldStatus }> = [
    { name: REQUIREMENT_NAMES.distance, status: statuses.distance },
    ...(statuses.provenance
      ? [
          {
            name: REQUIREMENT_NAMES.provenance,
            status: statuses.provenance.status,
          },
        ]
      : []),
    { name: REQUIREMENT_NAMES.load, status: statuses.load },
  ];
  const all = joinNames(entries.map((entry) => entry.name));
  const missing = entries
    .filter((entry) => entry.status === "missing")
    .map((entry) => entry.name);

  if (missing.length > 0) {
    return {
      status: "missing",
      description: `Required for certification. Not recorded: ${joinNames(missing)}.`,
    };
  }
  if (entries.every((entry) => entry.status === "satisfied")) {
    return {
      status: "satisfied",
      description: `Required for certification. Every leg records ${all}.`,
    };
  }
  return {
    status: "neutral",
    description: `Required for certification: ${all}.`,
  };
}
