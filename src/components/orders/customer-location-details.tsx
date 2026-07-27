"use client";

/**
 * Read-only details panel for the order form's selected delivery location
 * (issue #196): address, stored facility distance with provenance, and a
 * mini map (facility + destination + straight connector).
 *
 * Graceful degradation: no MapTiler key or missing GPS on either endpoint →
 * info rows only, no map. Route geometry is explicitly out of scope.
 */

import dynamic from "next/dynamic";
import { formatDistanceKm } from "@/lib/format-utils";
import {
  DISTANCE_SOURCE_LABELS,
  type DistanceSourceValue,
} from "@/schemas/distance-source";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

// Same fixed height as the PositionPicker preview so map surfaces read alike.
const MINI_MAP_HEIGHT_CLASS = "h-[260px]";

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
        <span className="label-button uppercase text-[var(--color-text-tertiary)]">
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

  return (
    <div
      className="border-[1.5px] border-[var(--clr-dark-purple)]"
      data-testid="order-location-details"
    >
      <div className="flex items-baseline justify-between border-b border-[var(--clr-dark-purple-30)] px-12 py-8">
        <span className="label-button uppercase text-[var(--color-text-primary)]">
          Delivery location
        </span>
        <span className="body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          {location.name ?? "Unnamed location"}
        </span>
      </div>

      <div className="space-y-12 p-12">
        <div className="space-y-2">
          {location.address ? (
            <p className="body-medium text-[var(--color-text-primary)]">
              {location.address}
            </p>
          ) : (
            <p className="body-medium text-[var(--color-text-tertiary)]">
              No street address on file
            </p>
          )}
          {localityLine && (
            <p className="body-caption text-[var(--color-text-secondary)]">
              {localityLine}
            </p>
          )}
          <p
            className="body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]"
            data-testid="order-location-distance"
          >
            {location.distanceFromFacilityKm != null
              ? `${formatDistanceKm(location.distanceFromFacilityKm)} from ${facility?.name ?? "facility"}`
              : "Distance from facility not recorded"}
            {location.distanceFromFacilityKm != null &&
              location.distanceSource != null &&
              ` · ${DISTANCE_SOURCE_LABELS[location.distanceSource]}`}
          </p>
        </div>

        {mapPoints && (
          <div className="space-y-6">
            <div
              className={`${MINI_MAP_HEIGHT_CLASS} border border-[var(--clr-dark-purple-30)]`}
            >
              <CustomerLocationMiniMap
                facility={mapPoints.facility}
                destination={mapPoints.destination}
              />
            </div>
            {/* Swatches mirror the Carbon Viewer legend (viewer-rails.tsx). */}
            <p className="flex items-center gap-6 body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
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
              Destination · straight-line preview
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
