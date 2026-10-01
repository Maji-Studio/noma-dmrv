/**
 * PROTOTYPE. Picks the `?leg=` variant for a journey. Variant 0 hands back
 * null so the caller keeps drawing the current timeline. Not for merge.
 */
"use client";

import type { ReactNode } from "react";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import { buildPrototypeJourney, type PrototypeLegInput } from "./journey";
import { LegPrototypeSwitcher, useLegVariant } from "./prototype-switcher";
import type { RouteCert } from "./route-parts";
import { FieldLabel } from "./route-parts";
import { RouteMapButton } from "./route-map-dialog";
import { VariantRouteStrip } from "./variant-a-route-strip";
import { VariantItinerary } from "./variant-b-itinerary";
import { VariantLedger } from "./variant-c-ledger";
import { VariantMassDistance } from "./variant-d-mass-distance";
import { VariantRouteSentence } from "./variant-e-route-sentence";
import { VariantRouteFields } from "./variant-f-route-fields";

export { LegPrototypeSwitcher, useLegVariant };

export function PrototypeLegDisplay({
  legs,
  entityType,
  cert,
  evidence,
  actions,
  hideLoad,
}: {
  legs: readonly PrototypeLegInput[];
  entityType: TransportEntityTypeValue;
  cert?: RouteCert;
  evidence?: (index: number) => boolean | undefined;
  actions?: (index: number) => ReactNode;
  hideLoad?: boolean;
}) {
  const variant = useLegVariant();
  if (variant === "0") return null;
  const journey = buildPrototypeJourney(legs, { evidence, actions, hideLoad });
  const props = { journey, entityType, cert };
  if (variant === "E") return <VariantRouteSentence {...props} />;
  if (variant === "F") return <VariantRouteFields {...props} />;
  // A to D predate the Route field: give them the same label, CERT chip and
  // map button as E and F so only the layout differs.
  const body =
    variant === "A" ? <VariantRouteStrip journey={journey} />
    : variant === "B" ? <VariantItinerary journey={journey} />
    : variant === "C" ? <VariantLedger journey={journey} />
    : <VariantMassDistance journey={journey} />;
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-8">
        <FieldLabel cert={cert}>Route</FieldLabel>
        {journey.legs.length === 1 && <RouteMapButton leg={journey.legs[0]} entityType={entityType} />}
      </div>
      {body}
    </div>
  );
}
