"use client";

/**
 * Read-only MapLibre mini map for the order form's delivery-location panel:
 * facility marker, destination marker, and a straight dashed connector
 * (dashed = estimated path, not a road — the Carbon Viewer convention for
 * unrouted legs; route geometry is out of scope per issue #196).
 *
 * Loaded via next/dynamic (ssr: false) from customer-location-details.tsx —
 * never imported directly, so maplibre-gl stays out of the route bundle.
 * The map instance lifecycle is the project's legitimate useEffect exception
 * (imperative DOM library).
 *
 * The initial markers/connector are painted inside the map's own `load`
 * handler from a props ref — not from a React "style ready" state — so the
 * paint always targets the live map instance even when effects re-run
 * (Strict Mode, Fast Refresh) and replace the map underneath persistent
 * state/refs.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import {
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
} from "@/components/map";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}order-sat`;
const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}order-sat-layer`;
const SAT_TILE_SIZE = 256;
const CONNECTOR_SOURCE_ID = `${OWN_LAYER_PREFIX}order-connector`;
const CONNECTOR_LAYER_ID = `${OWN_LAYER_PREFIX}order-connector-line`;
// Line treatment mirrors the Carbon Viewer's unrouted-leg fallback
// (chain-of-custody/map/viewer-constants.ts) so the connector reads the same.
const CONNECTOR_LINE_WIDTH = 1.6;
const CONNECTOR_LINE_OPACITY = 0.85;
const CONNECTOR_DASHARRAY = [2, 2];
/** Padding around the two endpoints when fitting the view (px). */
const FIT_PADDING = 48;
/** Don't zoom past street level when the endpoints are very close. */
const FIT_MAX_ZOOM = 13;

export interface MiniMapPoint {
  lat: number;
  lng: number;
}

export interface CustomerLocationMiniMapProps {
  facility: MiniMapPoint;
  destination: MiniMapPoint;
}

interface MiniMapPoints {
  facility: MiniMapPoint;
  destination: MiniMapPoint;
}

/** Resolve a design token at runtime — MapLibre paints to canvas, so CSS
 * variables can't be used in paint properties directly. */
function token(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

function connectorData({ facility, destination }: MiniMapPoints) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: [
        [facility.lng, facility.lat],
        [destination.lng, destination.lat],
      ],
    },
  };
}

function boundsFor({ facility, destination }: MiniMapPoints): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  bounds.extend([facility.lng, facility.lat]);
  bounds.extend([destination.lng, destination.lat]);
  return bounds;
}

export default function CustomerLocationMiniMap({
  facility,
  destination,
}: CustomerLocationMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const facilityMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destinationMarkerRef = useRef<maplibregl.Marker | null>(null);
  // The load handler lives for the map's lifetime; it reads the endpoints
  // through this ref so it always paints the latest props.
  const pointsRef = useRef<MiniMapPoints>({ facility, destination });
  const [satOn, setSatOn] = useState(false);
  // WebGL can be unavailable (headless browsers, exhausted contexts) — the
  // panel keeps its textual details instead of crashing the form.
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    pointsRef.current = { facility, destination };
  });

  /** (Re)place both markers and the connector line on a loaded map. */
  const paintEndpoints = (map: maplibregl.Map, points: MiniMapPoints) => {
    const facilityLngLat: [number, number] = [
      points.facility.lng,
      points.facility.lat,
    ];
    const destinationLngLat: [number, number] = [
      points.destination.lng,
      points.destination.lat,
    ];

    if (!facilityMarkerRef.current) {
      const el = createMarkerElement("purple");
      el.style.cursor = "default";
      facilityMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(facilityLngLat)
        .addTo(map);
    } else {
      facilityMarkerRef.current.setLngLat(facilityLngLat);
    }

    if (!destinationMarkerRef.current) {
      const el = createMarkerElement("pink");
      el.style.cursor = "default";
      destinationMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(destinationLngLat)
        .addTo(map);
    } else {
      destinationMarkerRef.current.setLngLat(destinationLngLat);
    }

    const source = map.getSource(CONNECTOR_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(connectorData(points));
  };

  // Map instance lifecycle — the legitimate imperative-DOM exception.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !MAPTILER_KEY) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: maptilerStyleUrl(MAPTILER_KEY),
        bounds: boundsFor(pointsRef.current),
        fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
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

    map.once("load", () => {
      applyBrandRecolor(map);
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

      map.addSource(CONNECTOR_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: CONNECTOR_LAYER_ID,
        type: "line",
        source: CONNECTOR_SOURCE_ID,
        paint: {
          "line-color": token("--clr-pink", "#A6216E"),
          "line-width": CONNECTOR_LINE_WIDTH,
          "line-opacity": CONNECTOR_LINE_OPACITY,
          "line-dasharray": CONNECTOR_DASHARRAY,
        },
      });
      paintEndpoints(map, pointsRef.current);
    });

    return () => {
      facilityMarkerRef.current = null;
      destinationMarkerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // Initial bounds come from pointsRef; endpoint changes are synced below.
  }, []);

  // Sync endpoint changes after the initial paint. Before the map's `load`
  // the connector source doesn't exist yet — skip; the load handler paints
  // from pointsRef, which already holds these props.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource(CONNECTOR_SOURCE_ID)) return;

    const points: MiniMapPoints = { facility, destination };
    paintEndpoints(map, points);
    map.fitBounds(boundsFor(points), {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: 0,
    });
  }, [facility, destination]);

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
        data-testid="order-location-map-failed"
      >
        <span className="label-button uppercase text-[var(--color-text-secondary)]">
          Map preview unavailable
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          The browser could not start the map renderer (WebGL). The location
          details above still apply.
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-[var(--color-background-white)]"
        data-testid="order-location-map"
      />
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onFit={() =>
          mapRef.current?.fitBounds(boundsFor({ facility, destination }), {
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
