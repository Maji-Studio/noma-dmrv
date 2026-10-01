"use client";

/**
 * Read-only details panel for the order form's selected delivery location
 * (issue #196): address, stored facility distance with provenance, and a
 * mini map (facility + destination + cached road route when available).
 *
 * Graceful degradation: no MapTiler key or missing GPS on either endpoint →
 * info rows only, no map. Unresolved or unavailable route geometry keeps an
 * honest straight dashed connector.
 */

import dynamic from "next/dynamic";
import { useRouteGeometries } from "@/hooks/use-geo";
import { TransportRoutePreview } from "@/components/transport-legs";
import { useLegVariant } from "@/components/transport-legs/leg-display-prototype";
import type { DistanceSourceValue } from "@/schemas/distance-source";
import { resolveCustomerLocationRoutePreview } from "./customer-location-route-preview";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

// Same fixed height as the PositionPicker preview so map surfaces read alike.
const MINI_MAP_HEIGHT_CLASS = "h-[260px]";
const ORDER_LOCATION_ROUTE_PREVIEW_ID = "order-location-route-preview";
/** Matches the customer location form and detail surfaces. */

const ROUTE_PREVIEW_LABELS = {
  loading: "Destination · loading road route, straight line shown",
  road: "Destination · road route preview",
  fallback: "Destination · straight-line fallback",
} as const;

// maplibre-gl is ~250 kB gzipped — keep it out of the route bundle and only
// fetch it when a location with plottable endpoints is actually selected.
const CustomerLocationMiniMap = dynamic(
  () => import("./customer-location-mini-map"),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex h-full w-full items-center justify-center bg-[var(--color-background-light)]"
        data-testid="order-location-map-loading"
      >
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Loading map…
        </span>
      </div>
    ),
  }
);

export interface CustomerLocationDetailsLocation {
  name: string | null;
  address: string | null;
  city: string | null;
  stateRegion: string | null;
  country: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  distanceFromFacilityKm: number | null;
  distanceSource: DistanceSourceValue | null;
}

export interface CustomerLocationDetailsFacility {
  name: string;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
}

interface CustomerLocationDetailsProps {
  location: CustomerLocationDetailsLocation;
  /** The order's facility — distance/map origin. Undefined while loading. */
  facility: CustomerLocationDetailsFacility | undefined;
}

export function CustomerLocationDetails({
  location,
  facility,
}: CustomerLocationDetailsProps) {
  const legVariant = useLegVariant();
  const localityLine = [location.city, location.stateRegion, location.country]
    .filter(Boolean)
    .join(", ");

  // Map requires the key plus GPS on both endpoints (issue #196 degradation).
  const mapPoints =
    MAPTILER_KEY &&
    facility?.gpsLatitude != null &&
    facility.gpsLongitude != null &&
    location.gpsLatitude != null &&
    location.gpsLongitude != null
      ? {
          facility: { lat: facility.gpsLatitude, lng: facility.gpsLongitude },
          destination: { lat: location.gpsLatitude, lng: location.gpsLongitude },
        }
      : null;

  const routeRequest = mapPoints
    ? {
        legs: [
          {
            id: ORDER_LOCATION_ROUTE_PREVIEW_ID,
            origin: mapPoints.facility,
            destination: mapPoints.destination,
          },
        ],
      }
    : null;
  const routeQuery = useRouteGeometries(routeRequest);
  const routeGeometry = routeQuery.isPending
    ? undefined
    : (routeQuery.data?.[ORDER_LOCATION_ROUTE_PREVIEW_ID] ?? null);
  const routePreviewState = mapPoints
    ? resolveCustomerLocationRoutePreview(
        mapPoints.facility,
        mapPoints.destination,
        routeGeometry
      ).state
    : "fallback";

  return (
    // Unboxed like every other block in the form (layout contract): the title
    // and the map frame carry the structure, not a border around both.
    <div className="space-y-8" data-testid="order-location-details">
      {/* The location select above already names the location. */}
      <span className="body-small font-medium text-[var(--color-text-primary)]">
        Delivery location
      </span>

      <div className="space-y-12">
        <div className="space-y-2">
          {/* The site description is optional: when there is none, the
              locality line below already says where the location is, so an
              empty "Not recorded" pair would only add noise (Kenji, 2026-09-30). */}
          {location.address && (
            <p className="body-small text-[var(--color-text-primary)]">
              {location.address}
            </p>
          )}
          {localityLine && (
            <p className="body-caption text-[var(--color-text-secondary)]">
              {localityLine}
            </p>
          )}
        </div>

        {/* The route this order's deliveries will drive, drawn like every saved leg. */}
        <div data-testid="order-location-distance">
          <TransportRoutePreview
            entityType="biochar"
            title="Delivery route"
            originName={facility?.name}
            destinationName={location.name}
            distanceKm={location.distanceFromFacilityKm}
            distanceSource={location.distanceSource}
            loadMassKg={null}
            plannedRoute
            originPoint={{ lat: facility?.gpsLatitude ?? null, lng: facility?.gpsLongitude ?? null }}
            destinationPoint={{ lat: location.gpsLatitude, lng: location.gpsLongitude }}
            emptyMessage="Distance from facility not recorded."
          />
        </div>

        {/* PROTOTYPE: the route variants open the map from "View map" instead. */}
        {mapPoints && legVariant === "0" && (
          <div className="space-y-6">
            <div
              className={`${MINI_MAP_HEIGHT_CLASS} border border-[var(--clr-dark-purple-30)]`}
            >
              <CustomerLocationMiniMap
                facility={mapPoints.facility}
                destination={mapPoints.destination}
                routeGeometry={routeGeometry}
              />
            </div>
            {/* Swatches mirror the Carbon Viewer legend (viewer-rails.tsx). */}
            <p className="flex items-center gap-6 body-caption text-[var(--color-text-tertiary)]">
              <span
                className="size-[9px] shrink-0"
                style={{ background: "var(--clr-purple)" }}
                aria-hidden="true"
              />
              Facility
              <span
                className="ml-6 size-[9px] shrink-0"
                style={{ background: "var(--clr-pink)" }}
                aria-hidden="true"
              />
              {ROUTE_PREVIEW_LABELS[routePreviewState]}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
