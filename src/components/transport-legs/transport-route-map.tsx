"use client";

/**
 * "View map" for one transport leg: opens the road route between its two ends
 * in a dialog, in the direction the goods travelled. Hovering or focusing a
 * marker shows that end's card (the Carbon Viewer card); a click pins it.
 * Renders nothing without a MapTiler key or unless both ends have coordinates.
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
import type { JourneyLeg } from "./transport-journey-model";
import type { RoutePoint } from "./route-line";

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

type EndRole = Pick<EndpointCard, "kind" | "typeLabel">;

// What each end of a leg is, by the goods it carries. `marked` is the end
// drawn in the facility colour: feedstock arrives at the facility, biochar
// leaves it, and a sample leg is drawn from wherever it starts.
const LEG_ENDS: Record<
  TransportEntityTypeValue,
  { origin: EndRole; destination: EndRole; marked: "origin" | "destination" }
> = {
  feedstock: {
    origin: { kind: "supplier", typeLabel: "Supplier location" },
    destination: { kind: "facility", typeLabel: "Facility" },
    marked: "destination",
  },
  biochar: {
    origin: { kind: "facility", typeLabel: "Facility" },
    destination: { kind: "field", typeLabel: "Customer location" },
    marked: "origin",
  },
  sample: {
    origin: { kind: "facility", typeLabel: "Origin" },
    destination: { kind: "field", typeLabel: "Lab" },
    marked: "origin",
  },
};

function formatCoordinates(point: RoutePoint): string {
  return `${point.lat.toFixed(COORDINATE_DECIMALS)}, ${point.lng.toFixed(COORDINATE_DECIMALS)}`;
}

/** The origin card names the load; the destination card the distances. */
function legCards(
  leg: JourneyLeg,
  entityType: TransportEntityTypeValue,
  origin: RoutePoint,
  destination: RoutePoint,
): { origin: EndpointCard; destination: EndpointCard } {
  const ends = LEG_ENDS[entityType];
  return {
    origin: {
      ...ends.origin,
      code: leg.originName ?? MISSING_VALUE.notRecorded,
      details: [
        { label: "Coordinates", value: formatCoordinates(origin) },
        ...(leg.loadKg != null ? [{ label: "Load", value: formatMass(leg.loadKg) }] : []),
      ],
    },
    destination: {
      ...ends.destination,
      code: leg.destinationName ?? MISSING_VALUE.notRecorded,
      details: [
        { label: "Coordinates", value: formatCoordinates(destination) },
        { label: "One way", value: formatDistanceKm(leg.oneWayKm) },
        { label: "Counted", value: formatDistanceKm(leg.countedKm) },
        ...(leg.sourceLabel ? [{ label: "Source", value: leg.sourceLabel }] : []),
      ],
    },
  };
}

function RouteMap({
  origin,
  destination,
  entityType,
  cards,
}: {
  origin: RoutePoint;
  destination: RoutePoint;
  entityType: TransportEntityTypeValue;
  cards: { origin: EndpointCard; destination: EndpointCard };
}) {
  // The road route in the direction the goods travelled; one-way streets
  // make the reverse request a different route.
  const query = useRouteGeometries({ legs: [{ id: ROUTE_ID, origin, destination }] });
  const geometry = query.isPending ? undefined : (query.data?.[ROUTE_ID] ?? null);
  const markedAtOrigin = LEG_ENDS[entityType].marked === "origin";
  return (
    <div className={`${MAP_HEIGHT_CLASS} border border-[var(--clr-dark-purple-30)]`}>
      <RouteMiniMap
        facility={markedAtOrigin ? origin : destination}
        destination={markedAtOrigin ? destination : origin}
        routeGeometry={geometry}
        endpointCards={{
          facility: markedAtOrigin ? cards.origin : cards.destination,
          destination: markedAtOrigin ? cards.destination : cards.origin,
        }}
      />
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
  const origin = leg.originPoint;
  const destination = leg.destinationPoint;
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
          <RouteMap
            origin={origin}
            destination={destination}
            entityType={entityType}
            cards={legCards(leg, entityType, origin, destination)}
          />
        )}
        <p className="mt-8 body-caption text-[var(--color-text-tertiary)]">
          Hover or click a marker for its details.
        </p>
      </QuickAddDialogShell>
    </>
  );
}
