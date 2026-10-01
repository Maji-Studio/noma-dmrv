/** PROTOTYPE. Pieces shared by the route variants E and F. Not for merge. */
"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { CertificationFieldTag } from "@/components/ui/certification-field-tag";
import type { CertFieldStatus } from "@/components/forms/cert-field-status";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import type { PrototypeJourney, PrototypeLeg } from "./journey";
import { km } from "./journey";
import { RouteMapButton } from "./route-map-dialog";

const ARROW_PX = 14;

export interface RouteCert {
  status: CertFieldStatus;
  description: string;
}

export interface RouteVariantProps {
  journey: PrototypeJourney;
  entityType: TransportEntityTypeValue;
  /** The route's one CERT chip, on its label. Left out where nothing is certified. */
  cert?: RouteCert;
}

/** "15 km one way × 2, manual entry" or "15 km + 20 km one way × 2". */
export function describeDoubling(journey: PrototypeJourney): string {
  const parts = journey.legs.map((leg) => km(leg.oneWayKm)).join(" + ");
  const sources = [...new Set(journey.legs.map((leg) => leg.sourceLabel).filter(Boolean))];
  const source = sources.length === 1 ? `, ${sources[0]!.toLowerCase()}` : "";
  return `${parts} one way × 2${source}`;
}

/** Field label in the read sheet's style, with the CERT chip beside it. */
export function FieldLabel({ children, cert }: { children: string; cert?: RouteCert }) {
  return (
    <span className="flex items-center gap-6 body-small text-[var(--color-text-secondary)]">
      {children}
      {cert && <CertificationFieldTag status={cert.status} description={cert.description} />}
    </span>
  );
}

/** "Origin → Destination", then the leg's map button and actions menu. */
export function RouteLine({ leg, entityType }: { leg: PrototypeLeg; entityType: TransportEntityTypeValue }) {
  return (
    <div className="flex items-start justify-between gap-8">
      <p className="min-w-0 body-medium text-[var(--color-text-primary)]">
        {leg.from}
        <ArrowRightIcon
          size={ARROW_PX}
          className="mx-6 inline align-[-1px] text-[var(--color-icon-secondary)]"
          aria-label="to"
        />
        {leg.to}
      </p>
      <span className="flex shrink-0 items-center gap-4">
        <RouteMapButton leg={leg} entityType={entityType} />
        {leg.actions}
      </span>
    </div>
  );
}
