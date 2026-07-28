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
  MapControls,
  OWN_LAYER_PREFIX,
  type MapAccent,
} from "@/components/map";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}sat`;
const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}sat-layer`;
const SAT_TILE_SIZE = 256;
/** Ease animation when the position changes from outside the map (ms). */
const EASE_DURATION_MS = 600;
/**
 * If the basemap style never finishes loading within this window (a failed or
 * hanging MapTiler request — expired/domain-locked key, offline, tile 5xx),
 * fall back to manual coordinates instead of leaving a silent blank box.
 */
const STYLE_LOAD_TIMEOUT_MS = 12_000;
/** ~0.1 m precision — more than enough to pin a site. */
const COORD_DECIMALS = 6;

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS));
}

function mapPoint(
  latitude: number | null,
  longitude: number | null,
): [number, number] | null {
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [longitude, latitude];
}

export interface PositionPickerMapProps {
  latitude: number | null;
  longitude: number | null;
  accent: MapAccent;
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
  // WebGL can be unavailable (headless browsers, exhausted contexts) — the
  // picker degrades to manual lat/lng inputs instead of crashing the form.
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
    disabledRef.current = disabled;
  });

  // Map instance lifecycle — the legitimate imperative-DOM exception.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !MAPTILER_KEY) return;

    const initialPoint = mapPoint(latitude, longitude);
    const initial = initialPoint
      ? { center: initialPoint, zoom: FOCUSED_MAP_ZOOM }
      : { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM };

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: maptilerStyleUrl(MAPTILER_KEY),
        center: initial.center,
        zoom: initial.zoom,
        attributionControl: { compact: true },
        dragRotate: false,
      });
    } catch {
      // maplibre throws "Failed to initialize WebGL" when no context exists.
      // Deferred so the effect never sets state synchronously (React Compiler).
      queueMicrotask(() => setMapFailed(true));
      return;
    }
    mapRef.current = map;

    // Guard against a basemap that never paints: maplibre only throws on a
    // failed WebGL init, not on a failed *style* fetch. A bad/expired key,
    // domain-lock rejection, or offline network leaves the canvas blank with
    // no "load" event, so trip the manual-entry fallback on the first pre-load
    // error and as a timeout backstop for a silent hang.
    let styleLoaded = false;
    const failIfUnloaded = () => {
      if (styleLoaded) return;
      // Drop the ref so the marker-sync effect and sat toggle no-op; the effect
      // cleanup still removes the map exactly once via its captured local.
      mapRef.current = null;
      // Deferred so the effect never sets state synchronously (React Compiler).
      queueMicrotask(() => setMapFailed(true));
    };
    const loadTimer = setTimeout(failIfUnloaded, STYLE_LOAD_TIMEOUT_MS);
    // Tile/source requests only start once the style JSON has parsed
    // ("styledata"), so an error before that is the style fetch itself failing
    // (bad/expired key, domain-lock rejection, offline) — fatal. An error
    // after it is a transient tile 404/5xx on an otherwise-valid key and must
    // not tear the map down: "load" still fires and the errored tile just
    // stays blank. The timeout above backstops a silent post-parse hang.
    let styleParsed = false;
    map.once("styledata", () => {
      styleParsed = true;
    });
    map.on("error", () => {
      if (!styleParsed) failIfUnloaded();
    });

    map.once("load", () => {
      styleLoaded = true;
      clearTimeout(loadTimer);
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
      clearTimeout(loadTimer);
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

    const lngLat = mapPoint(latitude, longitude);
    if (!lngLat) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

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

  // Panning away from the pin is easy and there is no other way back to it.
  // With no pin set, this returns to the map's opening view.
  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    const lngLat = mapPoint(latitude, longitude);
    map.easeTo({
      center: lngLat ?? DEFAULT_MAP_CENTER,
      zoom: lngLat ? Math.max(map.getZoom(), FOCUSED_MAP_ZOOM) : DEFAULT_MAP_ZOOM,
      duration: EASE_DURATION_MS,
    });
  };

  const toggleSat = () => {
    const map = mapRef.current;
    if (!map?.getLayer(SAT_LAYER_ID)) return;
    const next = !satOn;
    setSatOn(next);
    map.setLayoutProperty(SAT_LAYER_ID, "visibility", next ? "visible" : "none");
  };

  if (mapFailed) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-6 bg-[var(--color-background-light)] px-16 text-center"
        data-testid="position-picker-map-failed"
      >
        <span className="label-button uppercase text-[var(--color-text-secondary)]">
          Map preview unavailable
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          The map preview could not load. Enter coordinates manually below —
          they still work.
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-[var(--color-background-white)]"
        data-testid="position-picker-map"
      />
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onFit={recenter}
        fitAriaLabel="Recenter the map"
        satOn={satOn}
        onToggleSat={toggleSat}
      />
    </div>
  );
}
