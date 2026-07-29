"use client";

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
  MapControls,
  OWN_LAYER_PREFIX,
} from "@/components/map";
import type {
  GisBoundaryBbox,
  GisBoundaryCollection,
} from "@/lib/geojson/types";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}sat`;
const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}sat-layer`;
const DATA_SOURCE_ID = `${OWN_LAYER_PREFIX}boundary`;
const FILL_LAYER_ID = `${OWN_LAYER_PREFIX}boundary-fill`;
const LINE_LAYER_ID = `${OWN_LAYER_PREFIX}boundary-line`;
const SAT_TILE_SIZE = 256;
const STYLE_LOAD_TIMEOUT_MS = 12_000;
const FIT_PADDING_PX = 48;
const FIT_DURATION_MS = 600;
const ACCENT_TOKEN = "--clr-pink";
const ACCENT_FALLBACK = "#e94f9e";
const FILL_OPACITY = 0.25;
const LINE_WIDTH = 2;

function tokenColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export interface GeoJsonPreviewMapProps {
  collection: GisBoundaryCollection;
  bbox: GisBoundaryBbox;
}

export default function GeoJsonPreviewMap({
  collection,
  bbox,
}: GeoJsonPreviewMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const pendingRef = useRef({ collection, bbox });
  const [satOn, setSatOn] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !MAPTILER_KEY) return;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: maptilerStyleUrl(MAPTILER_KEY),
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        attributionControl: { compact: true },
        dragRotate: false,
      });
    } catch {
      queueMicrotask(() => setMapFailed(true));
      return;
    }
    mapRef.current = map;

    let styleLoaded = false;
    const failIfUnloaded = () => {
      if (styleLoaded) return;
      mapRef.current = null;
      queueMicrotask(() => setMapFailed(true));
    };
    const loadTimer = setTimeout(failIfUnloaded, STYLE_LOAD_TIMEOUT_MS);
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
      map.addLayer({
        id: SAT_LAYER_ID,
        type: "raster",
        source: SAT_SOURCE_ID,
        layout: { visibility: "none" },
        paint: { "raster-saturation": SAT_RASTER_SATURATION },
      });

      const accent = tokenColor(ACCENT_TOKEN, ACCENT_FALLBACK);
      map.addSource(DATA_SOURCE_ID, {
        type: "geojson",
        data: pendingRef.current.collection,
      });
      map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: DATA_SOURCE_ID,
        paint: { "fill-color": accent, "fill-opacity": FILL_OPACITY },
      });
      map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: DATA_SOURCE_ID,
        paint: { "line-color": accent, "line-width": LINE_WIDTH },
      });

      loadedRef.current = true;
      fitTo(map, pendingRef.current.bbox, false);
    });

    return () => {
      clearTimeout(loadTimer);
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    pendingRef.current = { collection, bbox };
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const source = map.getSource(DATA_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(collection);
    fitTo(map, bbox, true);
  }, [collection, bbox]);

  const toggleSat = () => {
    const map = mapRef.current;
    if (!map?.getLayer(SAT_LAYER_ID)) return;
    const next = !satOn;
    setSatOn(next);
    map.setLayoutProperty(SAT_LAYER_ID, "visibility", next ? "visible" : "none");
  };

  if (!MAPTILER_KEY || mapFailed) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background-light)] px-16 text-center">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Map preview unavailable
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-[var(--color-background-white)]"
        data-testid="geojson-preview-map"
      />
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onFit={() => {
          const map = mapRef.current;
          if (map) fitTo(map, bbox, true);
        }}
        fitAriaLabel="Recenter the map on the boundary"
        satOn={satOn}
        onToggleSat={toggleSat}
      />
    </div>
  );
}

function fitTo(
  map: maplibregl.Map,
  bbox: GisBoundaryBbox,
  animate: boolean,
): void {
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite)) return;
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: FIT_PADDING_PX, duration: animate ? FIT_DURATION_MS : 0 },
  );
}
