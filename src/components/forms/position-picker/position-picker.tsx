"use client";

/**
 * PositionPicker — three converging input modes over a MapLibre preview:
 * address search → geocode, map click/drag marker, manual lat/lng. Owns
 * lat/lng ONLY; it never writes the entity's `address` field. The resolved
 * place name appears as a read-only confirmation label.
 *
 * Graceful degradation (plan decision 5):
 * - no NEXT_PUBLIC_MAPTILER_KEY → no basemap; manual lat/lng still works,
 *   with a "map preview unavailable" notice.
 * - routing not configured server-side → address search + confirmation
 *   label disabled with an explanatory hint.
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import { FormField } from "@/components/forms/form-field";
import { FormInput } from "@/components/forms/form-input";
import { InfoHint } from "@/components/ui/tooltip";
import { GEOCODE_DEBOUNCE_MS } from "@/config/geo";
import { useDebounce } from "@/hooks/use-debounce";
import { useGeoCapabilities, useReverseGeocode } from "@/hooks/use-geo";
import { AddressSearch } from "./address-search";
import type { MapAccent } from "@/components/map";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const MAP_PREVIEW_HEIGHT_CLASS = "h-[260px]";

// maplibre-gl is ~250 kB gzipped — keep it out of the route bundle and only
// fetch it when a picker with a configured basemap actually renders.
const PositionPickerMap = dynamic(() => import("./position-picker-map"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full w-full items-center justify-center bg-[var(--color-background-light)]"
      data-testid="position-picker-map-loading"
    >
      <span className="label-button uppercase text-[var(--color-text-tertiary)]">
        Loading map…
      </span>
    </div>
  ),
});

export interface PositionValue {
  lat: number | null;
  lng: number | null;
}

interface PositionPickerProps {
  /** Prefix for the generated input ids (e.g. "gps" → "gps-latitude"). */
  idPrefix: string;
  /** Panel title (mono-uppercase). */
  label?: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  onPositionChange: (position: PositionValue) => void;
  latitudeError?: string;
  longitudeError?: string;
  disabled?: boolean;
  required?: boolean;
  /** Marker color per entity family: orange=supplier, purple=facility, pink=field. */
  accent?: MapAccent;
}

function formatCoord(value: number | null): string {
  return value == null ? "" : String(value);
}

/** Empty → null; parseable → number; anything else → undefined (keep draft). */
function parseDraft(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidPoint(lat: number | null, lng: number | null): boolean {
  return (
    lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

export function PositionPicker({
  idPrefix,
  label = "Position",
  latitude,
  longitude,
  onPositionChange,
  latitudeError,
  longitudeError,
  disabled = false,
  required = false,
  accent = "purple",
}: PositionPickerProps) {
  const lat = latitude ?? null;
  const lng = longitude ?? null;

  const { data: capabilities } = useGeoCapabilities();
  const routingConfigured = capabilities?.routingConfigured ?? false;

  // Manual inputs hold a text draft so in-flight typing ("-", "3.") survives.
  // When the position changes from outside (map click, geocode), resync the
  // draft — the documented adjust-state-during-render pattern.
  const [draft, setDraft] = useState({ lat: formatCoord(lat), lng: formatCoord(lng) });
  const [synced, setSynced] = useState({ lat, lng });
  if (lat !== synced.lat || lng !== synced.lng) {
    setSynced({ lat, lng });
    setDraft({
      lat: parseDraft(draft.lat) === lat ? draft.lat : formatCoord(lat),
      lng: parseDraft(draft.lng) === lng ? draft.lng : formatCoord(lng),
    });
  }

  const handleDraftChange = (axis: "lat" | "lng", raw: string) => {
    setDraft((current) => ({ ...current, [axis]: raw }));
    const parsed = parseDraft(raw);
    if (parsed === undefined) return; // unparseable in-flight text — wait
    // Compose from `synced` (not props) so a quick edit on the other axis
    // isn't clobbered while its prop echo is still in flight.
    const next =
      axis === "lat" ? { lat: parsed, lng: synced.lng } : { lat: synced.lat, lng: parsed };
    if (next.lat !== synced.lat || next.lng !== synced.lng) {
      // Keep `synced` ahead of the prop echo so the draft isn't clobbered.
      setSynced(next);
      onPositionChange(next);
    }
  };

  // Read-only confirmation label — debounced so manual typing doesn't burn
  // the geocode rate limit on every keystroke.
  const point = isValidPoint(lat, lng) ? { lat: lat as number, lng: lng as number } : null;
  const debouncedPoint = useDebounce(point, GEOCODE_DEBOUNCE_MS);
  const { data: resolvedLabel } = useReverseGeocode(
    debouncedPoint,
    routingConfigured && !disabled
  );

  const searchId = `${idPrefix}-address-search`;

  return (
    <div className="border-[1.5px] border-[var(--clr-dark-purple)]">
      {/* Panel head — hairline chrome, mono-uppercase microcopy */}
      <div className="flex items-baseline justify-between border-b border-[var(--clr-dark-purple-30)] px-12 py-8">
        <span className="label-button uppercase text-[var(--color-text-primary)]">
          {label}
          {required && (
            <>
              <span className="text-[var(--color-signal-red)] ml-2" aria-hidden="true">
                *
              </span>
              <span className="sr-only">Required</span>
            </>
          )}
        </span>
        <span className="body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
          Search · click map · type
        </span>
      </div>

      <div className="space-y-12 p-12">
        <div className="flex items-center gap-6">
          <div className="grow">
            <AddressSearch
              id={searchId}
              disabled={disabled}
              routingConfigured={routingConfigured}
              onSelect={(hit) => onPositionChange({ lat: hit.lat, lng: hit.lng })}
            />
          </div>
          {!routingConfigured && (
            <InfoHint side="top">
              Address search needs the geocoding service. Add
              OPENROUTESERVICE_API_KEY to the environment to enable it — map
              click and manual coordinates still work.
            </InfoHint>
          )}
        </div>

        {MAPTILER_KEY ? (
          <div className={`${MAP_PREVIEW_HEIGHT_CLASS} border border-[var(--clr-dark-purple-30)]`}>
            <PositionPickerMap
              latitude={lat}
              longitude={lng}
              accent={accent}
              disabled={disabled}
              onPick={(pickedLat, pickedLng) =>
                onPositionChange({ lat: pickedLat, lng: pickedLng })
              }
            />
          </div>
        ) : (
          <div
            className="flex h-[120px] flex-col items-center justify-center gap-6 border border-dashed border-[var(--clr-dark-purple-30)] bg-[var(--color-background-light)] px-16 text-center"
            data-testid="position-picker-no-map"
          >
            <span className="label-button uppercase text-[var(--color-text-secondary)]">
              Map preview unavailable
            </span>
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Set NEXT_PUBLIC_MAPTILER_KEY to enable the map. Manual
              coordinates below still work.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-16 gap-y-12 md:grid-cols-2">
          <FormField
            id={`${idPrefix}-latitude`}
            label="GPS Latitude"
            error={latitudeError}
            helperText="-90 to 90"
            required={required}
          >
            <FormInput
              id={`${idPrefix}-latitude`}
              type="number"
              step="any"
              placeholder="e.g., -3.3349"
              disabled={disabled}
              error={!!latitudeError}
              value={draft.lat}
              onChange={(event) => handleDraftChange("lat", event.target.value)}
            />
          </FormField>

          <FormField
            id={`${idPrefix}-longitude`}
            label="GPS Longitude"
            error={longitudeError}
            helperText="-180 to 180"
            required={required}
          >
            <FormInput
              id={`${idPrefix}-longitude`}
              type="number"
              step="any"
              placeholder="e.g., 37.3404"
              disabled={disabled}
              error={!!longitudeError}
              value={draft.lng}
              onChange={(event) => handleDraftChange("lng", event.target.value)}
            />
          </FormField>
        </div>

        {point && routingConfigured && resolvedLabel && (
          <p
            className="body-caption uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]"
            data-testid="position-picker-resolved-label"
          >
            ≈ {resolvedLabel}
          </p>
        )}
      </div>
    </div>
  );
}
