/**
 * PROTOTYPE. "View map" for a route: a small text button that opens the road
 * route between the leg's two ends in a dialog. Reuses the order form's mini
 * map, which draws the facility end purple and the other end pink. Not for merge.
 */
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import { useRouteGeometries } from "@/hooks/use-geo";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import type { PrototypeLeg } from "./journey";
import { km, tonnes } from "./journey";
import type { EndpointCard } from "@/components/orders/customer-location-mini-map";

const COORDINATE_DECIMALS = 4;

// What the far end of a route is, by the goods it carries.
const OTHER_END: Record<TransportEntityTypeValue, Pick<EndpointCard, "kind" | "typeLabel">> = {
  feedstock: { kind: "supplier", typeLabel: "Supplier location" },
  biochar: { kind: "field", typeLabel: "Customer location" },
  sample: { kind: "field", typeLabel: "Lab" },
};

function coordinates(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(COORDINATE_DECIMALS)}, ${point.lng.toFixed(COORDINATE_DECIMALS)}`;
}

const ICON_PX = 16;
const MAP_HEIGHT_CLASS = "h-[420px]";
const ROUTE_ID = "prototype-route-map";

const MiniMap = dynamic(() => import("@/components/orders/customer-location-mini-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[var(--color-background-light)]" />,
});

export function RouteMapButton({
  leg,
  entityType,
}: {
  leg: PrototypeLeg;
  entityType: TransportEntityTypeValue;
}) {
  const [open, setOpen] = useState(false);
  if (!leg.originPoint || !leg.destinationPoint) return null;
  // Feedstock arrives at the facility; biochar and samples leave it.
  const facilityAtOrigin = entityType !== "feedstock";
  const facility = facilityAtOrigin ? leg.originPoint : leg.destinationPoint;
  const other = facilityAtOrigin ? leg.destinationPoint : leg.originPoint;

  return (
    <>
      <Button type="button" variant="noOutline" size="small" onClick={() => setOpen(true)}>
        <MapTrifoldIcon size={ICON_PX} />
        View map
      </Button>
      <QuickAddDialogShell
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`${leg.from} to ${leg.to}`}
        width="xl"
        testId="route-map-dialog"
      >
        {open && (
          <RouteMap
            facility={facility}
            other={other}
            cards={{
              facility: {
                kind: "facility",
                typeLabel: "Facility",
                code: facilityAtOrigin ? leg.from : leg.to,
                details: [
                  { label: "Coordinates", value: coordinates(facility) },
                  ...(leg.loadKg != null ? [{ label: "Load", value: tonnes(leg.loadKg) }] : []),
                ],
              },
              destination: {
                ...OTHER_END[entityType],
                code: facilityAtOrigin ? leg.to : leg.from,
                details: [
                  { label: "Coordinates", value: coordinates(other) },
                  { label: "One way", value: km(leg.oneWayKm) },
                  { label: "Counted", value: km(leg.countedKm) },
                  ...(leg.sourceLabel ? [{ label: "Source", value: leg.sourceLabel }] : []),
                ],
              },
            }}
          />
        )}
        <p className="mt-8 body-caption text-[var(--color-text-tertiary)]">
          Hover or click a marker for its details.
        </p>
        <p className="mt-12 body-small text-[var(--color-text-secondary)]">
          {km(leg.oneWayKm)} one way by {leg.methodLabel.toLowerCase()} · {km(leg.countedKm)} counted
        </p>
      </QuickAddDialogShell>
    </>
  );
}

function RouteMap({
  facility,
  other,
  cards,
}: {
  facility: { lat: number; lng: number };
  other: { lat: number; lng: number };
  cards: { facility: EndpointCard; destination: EndpointCard };
}) {
  const query = useRouteGeometries({ legs: [{ id: ROUTE_ID, origin: facility, destination: other }] });
  const geometry = query.isPending ? undefined : (query.data?.[ROUTE_ID] ?? null);
  return (
    <div className={`${MAP_HEIGHT_CLASS} border border-[var(--clr-dark-purple-30)]`}>
      <MiniMap facility={facility} destination={other} routeGeometry={geometry} endpointCards={cards} />
    </div>
  );
}
