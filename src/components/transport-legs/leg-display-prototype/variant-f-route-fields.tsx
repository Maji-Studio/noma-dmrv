/**
 * PROTOTYPE F · Route fields. The same content as E, laid out as ordinary
 * label and value fields so it reads exactly like the rest of the step: Route
 * across the full width, then Distance counted and Load carried side by side.
 * Not for merge.
 */
"use client";

import type { RouteVariantProps } from "./route-parts";
import { FieldLabel, RouteLine, describeDoubling } from "./route-parts";
import { km, tonnes } from "./journey";
import { EvidenceMark } from "./evidence-mark";

function Field({ label, children, cert }: { label: string; children: React.ReactNode; cert?: RouteVariantProps["cert"] }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FieldLabel cert={cert}>{label}</FieldLabel>
      {children}
    </div>
  );
}

export function VariantRouteFields({ journey, entityType, cert }: RouteVariantProps) {
  const evidence = journey.legs.every((leg) => leg.evidenceAttached === undefined)
    ? undefined
    : journey.legs.every((leg) => leg.evidenceAttached);
  return (
    <div className="space-y-20">
      <Field label="Route" cert={cert}>
        <div className="space-y-4">
          {journey.legs.map((leg) => (
            <RouteLine key={leg.index} leg={leg} entityType={entityType} />
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-x-16 gap-y-20">
        <Field label="Distance counted">
          <p className="body-medium tabular-nums text-[var(--color-text-primary)]">{km(journey.totalCountedKm)}</p>
          <p className="body-caption text-[var(--color-text-tertiary)]">{describeDoubling(journey)}</p>
        </Field>
        {!journey.hideLoad && (
          <Field label="Load carried">
            <p className="body-medium tabular-nums text-[var(--color-text-primary)]">
              {journey.loadsVary ? journey.legs.map((leg) => tonnes(leg.loadKg)).join(", ") : tonnes(journey.sharedLoadKg)}
            </p>
          </Field>
        )}
        {evidence !== undefined && (
          <Field label="Evidence">
            <p className="body-medium">
              <EvidenceMark attached={evidence} withLabel />
            </p>
          </Field>
        )}
      </div>
    </div>
  );
}
