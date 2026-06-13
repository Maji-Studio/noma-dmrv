"use client";

/**
 * Read-only MapLibre site map for the dashboard: the facility plus its
 * application fields and feedstock sources, each a square accent marker
 * (purple facility / pink field / orange source — the Carbon Viewer token
 * mapping). Loaded via next/dynamic (ssr: false) from map-preview.tsx so
 * maplibre-gl never enters the route bundle.
 *
 * Markers are (re)painted inside the map's own `load` handler from a props
 * ref — the project's Strict-Mode-safe paint pattern (see
 * customer-location-mini-map.tsx) — and re-synced when the point set changes.
 * Without a MapTiler key the map falls back to a blank tinted field; the
 * markers still plot, so relative geography stays legible.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
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
import type {
  DashboardMapKind,
  DashboardMapPoint,
} from "@/data-access/dashboard-overview";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}dash-sat`;
const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}dash-sat-layer`;
const SAT_TILE_SIZE = 256;
const FIT_PADDING = 56;
const FIT_MAX_ZOOM = 12;
const FACILITY_MARKER_SIZE_PX = 16;

/** No-key fallback: markers still paint over a blank tinted field. */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

const KIND_ACCENT: Record<DashboardMapKind, MapAccent> = {
  facility: "purple",
  feedstock: "orange",
  application: "pink",
};

function boundsFor(points: DashboardMapPoint[]): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) bounds.extend([point.lng, point.lat]);
  return bounds;
}

interface DashboardMapProps {
  points: DashboardMapPoint[];
}

export default function DashboardMap({ points }: DashboardMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pointsRef = useRef<DashboardMapPoint[]>(points);
  const [satOn, setSatOn] = useState(false);
  // WebGL can be unavailable (headless browsers, exhausted contexts) — keep
  // the panel rather than crashing the dashboard.
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    pointsRef.current = points;
  });

  const paintMarkers = (map: maplibregl.Map, pts: DashboardMapPoint[]) => {
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
    for (const point of pts) {
      const el = createMarkerElement(KIND_ACCENT[point.kind]);
      el.style.cursor = "default";
      if (point.kind === "facility") {
        // The facility is the hub — slightly larger with a soft ring.
        el.style.width = `${FACILITY_MARKER_SIZE_PX}px`;
        el.style.height = `${FACILITY_MARKER_SIZE_PX}px`;
        el.style.outline = "3px solid var(--clr-purple-20)";
      }
      el.title = point.sublabel ? `${point.label} · ${point.sublabel}` : point.label;
      markersRef.current.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([point.lng, point.lat])
          .addTo(map),
      );
    }
  };

  // Map instance lifecycle — the legitimate imperative-DOM exception.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initial = pointsRef.current;
    const baseOptions: maplibregl.MapOptions = {
      container,
      style: MAPTILER_KEY ? maptilerStyleUrl(MAPTILER_KEY) : BLANK_STYLE,
      attributionControl: { compact: true },
      dragRotate: false,
    };
    const viewOptions: Partial<maplibregl.MapOptions> = initial.length
      ? {
          bounds: boundsFor(initial),
          fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
        }
      : { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM };

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({ ...baseOptions, ...viewOptions });
    } catch {
      // maplibre throws "Failed to initialize WebGL" when no context exists.
      // Deferred so the effect never sets state synchronously (React Compiler).
      queueMicrotask(() => setMapFailed(true));
      return;
    }
    mapRef.current = map;

    map.once("load", () => {
      if (MAPTILER_KEY) applyBrandRecolor(map);
      map.addSource(SAT_SOURCE_ID, {
        type: "raster",
        tiles: [SAT_TILE_URL],
        tileSize: SAT_TILE_SIZE,
        attribution: SAT_TILE_ATTRIBUTION,
      });
      map.addLayer({
        id: SAT_LAYER_ID,
        type: "raster",
        source: SAT_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "raster-saturation": SAT_RASTER_SATURATION },
      });
      paintMarkers(map, pointsRef.current);
    });

    return () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Re-sync when the facility's point set changes. Before `load` the sat layer
  // doesn't exist yet — skip; the load handler paints from pointsRef.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer(SAT_LAYER_ID)) return;
    paintMarkers(map, points);
    if (points.length) {
      map.fitBounds(boundsFor(points), {
        padding: FIT_PADDING,
        maxZoom: FIT_MAX_ZOOM,
        duration: 0,
      });
    }
  }, [points]);

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
        data-testid="dashboard-map-failed"
      >
        <span className="label-button uppercase text-[var(--color-text-secondary)]">
          Map unavailable
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          The browser could not start the map renderer (WebGL).
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-[var(--color-background-white)]"
        data-testid="dashboard-map"
      />
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onFit={() =>
          points.length &&
          mapRef.current?.fitBounds(boundsFor(points), {
            padding: FIT_PADDING,
            maxZoom: FIT_MAX_ZOOM,
          })
        }
        satOn={satOn}
        onToggleSat={toggleSat}
      />
    </div>
  );
}
