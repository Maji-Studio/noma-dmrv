"use client";

/**
 * MapLibre preview for PositionPicker. Loaded via next/dynamic (ssr: false)
 * from position-picker.tsx — never imported directly, so maplibre-gl stays
 * out of the shared client bundle.
 *
 * The map instance lifecycle is the project's legitimate useEffect exception
 * (imperative DOM library). Event handlers reach React state through refs so
 * the map is created exactly once.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  FOCUSED_MAP_ZOOM,
  maptilerStyleUrl,
  SAT_RASTER_SATURATION,
  SAT_TILE_ATTRIBUTION,
  SAT_TILE_URL,
} from "@/config/geo";
import {
  applyBrandRecolor,
  createMarkerElement,
  OWN_LAYER_PREFIX,
  type PickerAccent,
} from "./map-theme";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}sat`;
const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}sat-layer`;
const SAT_TILE_SIZE = 256;
/** Ease animation when the position changes from outside the map (ms). */
const EASE_DURATION_MS = 600;
/** ~0.1 m precision — more than enough to pin a site. */
const COORD_DECIMALS = 6;

/** Map control buttons (concept: vertical stack of square buttons, top-left). */
const CONTROL_BUTTON_CLASS =
  "flex size-36 items-center justify-center label-button uppercase " +
  "bg-[var(--color-background-white)] text-[var(--clr-dark-purple)] " +
  "border-b border-[var(--clr-dark-purple-30)] last:border-b-0 " +
  "hover:bg-[var(--clr-dark-purple)] hover:text-[var(--color-background-white)] " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-interaction)] " +
  "cursor-pointer transition-colors";

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS));
}

export interface PositionPickerMapProps {
  latitude: number | null;
  longitude: number | null;
  accent: PickerAccent;
  disabled?: boolean;
  /** Fired on map click and marker drag-end. */
  onPick: (lat: number, lng: number) => void;
}

export default function PositionPickerMap({
  latitude,
  longitude,
  accent,
  disabled = false,
  onPick,
}: PositionPickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Map event handlers live for the map's lifetime; route them through refs
  // so they always see the latest props without re-creating the map.
  const onPickRef = useRef(onPick);
  const disabledRef = useRef(disabled);
  /** Last position emitted by the map itself — skip easeTo for round-trips. */
  const lastPickRef = useRef<{ lat: number; lng: number } | null>(null);
  const [satOn, setSatOn] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
    disabledRef.current = disabled;
  });

  // Map instance lifecycle — the legitimate imperative-DOM exception.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !MAPTILER_KEY) return;

    const initial =
      latitude != null && longitude != null
        ? { center: [longitude, latitude] as [number, number], zoom: FOCUSED_MAP_ZOOM }
        : { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM };

    const map = new maplibregl.Map({
      container,
      style: maptilerStyleUrl(MAPTILER_KEY),
      center: initial.center,
      zoom: initial.zoom,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    mapRef.current = map;

    map.once("load", () => {
      applyBrandRecolor(map);
      map.addSource(SAT_SOURCE_ID, {
        type: "raster",
        tiles: [SAT_TILE_URL],
        tileSize: SAT_TILE_SIZE,
        attribution: SAT_TILE_ATTRIBUTION,
      });
      // Desaturated imagery under nothing else — picker has no overlays yet.
      map.addLayer({
        id: SAT_LAYER_ID,
        type: "raster",
        source: SAT_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "raster-saturation": SAT_RASTER_SATURATION },
      });
      if (!disabledRef.current) {
        map.getCanvas().style.cursor = "crosshair";
      }
    });

    map.on("click", (event) => {
      if (disabledRef.current) return;
      const lat = round(event.lngLat.lat);
      const lng = round(event.lngLat.lng);
      lastPickRef.current = { lat, lng };
      onPickRef.current(lat, lng);
    });

    return () => {
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // Initial center/zoom only — position changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the marker (and view) with the controlled position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (latitude == null || longitude == null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const lngLat: [number, number] = [longitude, latitude];
    if (!markerRef.current) {
      const marker = new maplibregl.Marker({
        element: createMarkerElement(accent),
        draggable: !disabled,
      })
        .setLngLat(lngLat)
        .addTo(map);
      marker.on("dragend", () => {
        const point = marker.getLngLat();
        const lat = round(point.lat);
        const lng = round(point.lng);
        lastPickRef.current = { lat, lng };
        onPickRef.current(lat, lng);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(lngLat);
      markerRef.current.setDraggable(!disabled);
    }

    // Ease to the point only when the change came from outside the map
    // (geocode hit, manual entry) — never on the map's own click/drag echo.
    const fromMap =
      lastPickRef.current?.lat === latitude && lastPickRef.current?.lng === longitude;
    if (!fromMap) {
      map.easeTo({
        center: lngLat,
        zoom: Math.max(map.getZoom(), FOCUSED_MAP_ZOOM),
        duration: EASE_DURATION_MS,
      });
    }
  }, [latitude, longitude, accent, disabled]);

  const toggleSat = () => {
    const map = mapRef.current;
    if (!map?.getLayer(SAT_LAYER_ID)) return;
    const next = !satOn;
    setSatOn(next);
    map.setLayoutProperty(SAT_LAYER_ID, "visibility", next ? "visible" : "none");
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-[var(--color-background-white)]"
        data-testid="position-picker-map"
      />
      <div className="absolute left-8 top-8 flex flex-col border border-[var(--clr-dark-purple-30)] shadow-[0_1px_4px_var(--color-black-10)]">
        <button
          type="button"
          aria-label="Zoom in"
          className={CONTROL_BUTTON_CLASS}
          onClick={() => mapRef.current?.zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className={CONTROL_BUTTON_CLASS}
          onClick={() => mapRef.current?.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Toggle satellite imagery"
          aria-pressed={satOn}
          className={cn(
            CONTROL_BUTTON_CLASS,
            satOn &&
              "bg-[var(--clr-dark-purple)] text-[var(--color-background-white)]"
          )}
          onClick={toggleSat}
        >
          SAT
        </button>
      </div>
    </div>
  );
}
