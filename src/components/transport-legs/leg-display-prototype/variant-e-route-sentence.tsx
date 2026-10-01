/**
 * PROTOTYPE E · Route sentence. One "Route" field replaces Distance and
 * Distance source: where the goods went, the distance that counts with how it
 * was reached in brackets, and the load. A map opens on demand. Not for merge.
 */
"use client";

import type { RouteVariantProps } from "./route-parts";
import { FieldLabel, RouteLine, describeDoubling } from "./route-parts";
import { km, tonnes } from "./journey";
import { EvidenceMark } from "./evidence-mark";

export function VariantRouteSentence({ journey, entityType, cert }: RouteVariantProps) {
  const evidence = journey.legs.every((leg) => leg.evidenceAttached === undefined)
    ? undefined
    : journey.legs.every((leg) => leg.evidenceAttached);
  return (
    <div className="flex flex-col gap-4">
      <FieldLabel cert={cert}>Route</FieldLabel>
      <div className="space-y-4">
        {journey.legs.map((leg) => (
          <RouteLine key={leg.index} leg={leg} entityType={entityType} />
        ))}
      </div>
      <p className="body-medium text-[var(--color-text-primary)]">
        <span className="font-medium tabular-nums">{km(journey.totalCountedKm)} counted</span>{" "}
        <span className="text-[var(--color-text-tertiary)]">({describeDoubling(journey)})</span>
      </p>
      {!journey.hideLoad && (
        <p className="body-medium text-[var(--color-text-primary)]">
          <span className="text-[var(--color-text-secondary)]">Load </span>
          <span className="tabular-nums">
            {journey.loadsVary ? journey.legs.map((leg) => tonnes(leg.loadKg)).join(", ") : tonnes(journey.sharedLoadKg)}
          </span>
        </p>
      )}
      {evidence !== undefined && (
        <p className="pt-4">
          <EvidenceMark attached={evidence} withLabel />
        </p>
      )}
    </div>
  );
}
