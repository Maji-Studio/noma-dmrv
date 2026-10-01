"use client";

/**
 * "View map" for one transport leg: opens the road route between its two ends
 * in a dialog. Hovering a marker shows that end's card (the Carbon Viewer
 * card); a click pins it. Renders nothing without a MapTiler key or unless
 * both ends have coordinates.
 */
import { useState } from "react";
import dynamic from "next/dynamic";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { QuickAddDialogShell } from "@/components/forms/entity-select/quick-add-dialog-shell";
import type { EndpointCard } from "./route-mini-map";
import { useRouteGeometries } from "@/hooks/use-geo";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDistanceKm, formatMass } from "@/lib/format-utils";
import type { TransportEntityTypeValue } from "@/schemas/transport-legs";
import type { JourneyLeg, JourneyPoint } from "./transport-journey-model";

// Inlined at build time: public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const ICON_PX = 16;
const MAP_HEIGHT_CLASS = "h-[420px]";
const ROUTE_ID = "transport-route-map";
const COORDINATE_DECIMALS = 4;

// maplibre-gl is ~250 kB gzipped: fetched only when a map is opened.
const RouteMiniMap = dynamic(() => import("./route-mini-map"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[var(--color-background-light)]" />,
});

// The end that is not the facility, named by the goods the leg carries.
// Feedstock arrives at the facility; biochar and samples leave it.
const FAR_END: Record<
  TransportEntityTypeValue,
  Pick<EndpointCard, "kind" | "typeLabel"> & { facilityAtOrigin: boolean }
> = {
  feedstock: { kind: "supplier", typeLabel: "Supplier location", facilityAtOrigin: false },
  biochar: { kind: "field", typeLabel: "Customer location", facilityAtOrigin: true },
  sample: { kind: "field", typeLabel: "Lab", facilityAtOrigin: true },
};

function formatCoordinates(point: JourneyPoint): string {
  return `${point.lat.toFixed(COORDINATE_DECIMALS)}, ${point.lng.toFixed(COORDINATE_DECIMALS)}`;
}

function endpointCards(leg: JourneyLeg, entityType: TransportEntityTypeValue, facility: JourneyPoint, far: JourneyPoint) {
  const { facilityAtOrigin, ...farEnd } = FAR_END[entityType];
  const facilityName = facilityAtOrigin ? leg.originName : leg.destinationName;
  const farName = facilityAtOrigin ? leg.destinationName : leg.originName;
  return {
    facility: {
      kind: "facility",
      typeLabel: "Facility",
      code: facilityName ?? MISSING_VALUE.notRecorded,
      details: [
        { label: "Coordinates", value: formatCoordinates(facility) },
        ...(leg.loadKg != null ? [{ label: "Load", value: formatMass(leg.loadKg) }] : []),
      ],
    },
    destination: {
      ...farEnd,
      code: farName ?? MISSING_VALUE.notRecorded,
      details: [
        { label: "Coordinates", value: formatCoordinates(far) },
        { label: "One way", value: formatDistanceKm(leg.oneWayKm) },
        { label: "Counted", value: formatDistanceKm(leg.countedKm) },
        ...(leg.sourceLabel ? [{ label: "Source", value: leg.sourceLabel }] : []),
      ],
    },
  } satisfies { facility: EndpointCard; destination: EndpointCard };
}

function RouteMap({
  facility,
  far,
  cards,
}: {
  facility: JourneyPoint;
  far: JourneyPoint;
  cards: { facility: EndpointCard; destination: EndpointCard };
}) {
  const query = useRouteGeometries({ legs: [{ id: ROUTE_ID, origin: facility, destination: far }] });
  const geometry = query.isPending ? undefined : (query.data?.[ROUTE_ID] ?? null);
  return (
    <div className={`${MAP_HEIGHT_CLASS} border border-[var(--clr-dark-purple-30)]`}>
      <RouteMiniMap facility={facility} destination={far} routeGeometry={geometry} endpointCards={cards} />
    </div>
  );
}

export function TransportRouteMapButton({
  leg,
  entityType,
}: {
  leg: JourneyLeg;
  entityType: TransportEntityTypeValue;
}) {
  const [open, setOpen] = useState(false);
  if (!MAPTILER_KEY || !leg.originPoint || !leg.destinationPoint) return null;
  const { facilityAtOrigin } = FAR_END[entityType];
  const facility = facilityAtOrigin ? leg.originPoint : leg.destinationPoint;
  const far = facilityAtOrigin ? leg.destinationPoint : leg.originPoint;
  const from = leg.originName ?? MISSING_VALUE.notRecorded;
  const to = leg.destinationName ?? MISSING_VALUE.notRecorded;

  return (
    <>
      <Button type="button" variant="noOutline" size="small" onClick={() => setOpen(true)}>
        <MapTrifoldIcon size={ICON_PX} />
        View map
      </Button>
      <QuickAddDialogShell
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`${from} to ${to}`}
        width="xl"
        testId="transport-route-map"
      >
        {open && (
          <RouteMap facility={facility} far={far} cards={endpointCards(leg, entityType, facility, far)} />
        )}
        <p className="mt-8 body-caption text-[var(--color-text-tertiary)]">
          Hover or click a marker for its details.
        </p>
      </QuickAddDialogShell>
    </>
  );
}
