"use client";

/**
 * The batch Traceability Map's canvas: a lean sibling of carbon-transit-map.tsx
 * driven by one `lighting` prop. Lit records and legs stay full strength, the
 * rest dims, and only lit legs carry a km label (one per drawn road, never all
 * at once). The camera flies to `lighting.points` whenever `frameKey` changes.
 * Loaded with next/dynamic (ssr: false).
 */

import "maplibre-gl/dist/maplibre-gl.css";
import "./carbon-viewer.css";
import "./trace-map.css";
import * as maplibregl from "maplibre-gl";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  maptilerStyleUrl,
  SAT_RASTER_SATURATION,
  SAT_TILE_ATTRIBUTION,
  SAT_TILE_URL,
} from "@/config/geo";
import { applyBrandRecolor, MapControls } from "@/components/map";
import type { ChainOfCustodyGeoData } from "@/data-access/chain-of-custody-geo";
import type { RouteGeometryByRequestId } from "@/data-access/geo-route-cache";
import { formatDistanceKm } from "@/lib/format-utils";
import {
  ANTS_DASH_SEQUENCE,
  ANTS_INTERVAL_MS,
  DASH_LINE_WIDTH,
  FALLBACK_DASHARRAY,
  FIT_DURATION_MS,
  LEG_LINE_WIDTH,
  SAT_LAYER_ID,
  SAT_SOURCE_ID,
} from "./viewer-constants";
import { createSiteMarkerElement } from "./viewer-elements";
import { chipAnchor, legLineCoordinates } from "./viewer-utils";
import { litKm, type DrawnLeg, type MapLighting } from "./trace-model";

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const SAT_TILE_SIZE = 256;
const SOURCE_ID = "noma-own-tm-legs";
const BASE_LAYER = "noma-own-tm-base";
const FALLBACK_LAYER = "noma-own-tm-fallback";
const ANTS_LAYER = "noma-own-tm-ants";
const BLANK_STYLE: maplibregl.StyleSpecification = { version: 8, sources: {}, layers: [] };
/** Resting legs are a quiet wash; lit legs read as the figure; dimmed ones ghost. */
const REST_OPACITY = 0.45;
const LIT_OPACITY = 0.95;
const DIM_OPACITY = 0.1;
const LIT_LINE_WIDTH = 2.6;
/** A single point (the facility) frames at this zoom: the plant and its yard. */
const POINT_ZOOM = 11;
const FIT_MAX_ZOOM = 9.5;
/** Points closer than this frame as one place (the facility and its yard). */
const POINT_SPAN_M = 3000;
const DIM_CLASS = "cvm-dim";
const CURRENT_CLASS = "tm-current";

export interface FramePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TraceMapCanvasProps {
  geo: ChainOfCustodyGeoData;
  /** The legs to draw, one per road. */
  legs: DrawnLeg[];
  routeGeometries: RouteGeometryByRequestId | undefined;
  lighting: MapLighting;
  /** Changes whenever the camera should fly to `lighting.points`. */
  frameKey: string;
  /** Room the panel takes over the map. */
  padding: FramePadding;
  onMarkerClick?: (nodeId: string) => void;
  onBackgroundClick?: () => void;
  controlsClassName?: string;
}

/** The camera's flight to a selection: slower than the shared FIT. */
const FLY_DURATION_MS = FIT_DURATION_MS * 1.4;

/** A km label and the two ends of its leg, to hide it when the leg is too short to carry it. */
interface ChipEntry {
  marker: maplibregl.Marker;
  ends: [[number, number], [number, number]];
}

/** A leg shorter than this on screen is left unlabelled (the label would cover its ends). */
const MIN_LABELLED_LEG_PX = 72;

function syncChipVisibility(map: maplibregl.Map, chips: ChipEntry[]) {
  for (const { marker, ends } of chips) {
    const a = map.project(ends[0]);
    const b = map.project(ends[1]);
    marker.getElement().style.visibility = Math.hypot(a.x - b.x, a.y - b.y) < MIN_LABELLED_LEG_PX ? "hidden" : "";
  }
}

/** Label box offsets from the marker point: mirror `.cvm-lbl` in carbon-viewer.css. */
const LABEL_GAP_PX = 15;
const FACILITY_LABEL_GAP_PX = 19;
const LABEL_TOP_PX = 10;
const LEFT_LABEL_CLASS = "tm-lbl-left";

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A label that finds no free side steps down one label-height, at most this many times. */
const MAX_LABEL_STEPS = 1;
const LABEL_DROP_VAR = "--tm-lbl-dy";

/**
 * Keep marker labels readable. Each label sits to the right of its marker;
 * when that would cover a label already placed (a supplier beside the
 * facility, fields close together) it flips to the left, and failing that
 * steps down below the others. Markers are placed in order, so the facility
 * claims its side first.
 */
function declutterLabels(map: maplibregl.Map, markers: maplibregl.Marker[]) {
  const placed: Box[] = [];
  for (const marker of markers) {
    const element = marker.getElement();
    const label = element.querySelector<HTMLElement>(".cvm-lbl");
    if (!label || getComputedStyle(label).display === "none") continue;
    const point = map.project(marker.getLngLat());
    const gap = element.classList.contains("cvm-mk--facility") ? FACILITY_LABEL_GAP_PX : LABEL_GAP_PX;
    const width = label.offsetWidth;
    const height = label.offsetHeight;
    const { clientWidth, clientHeight } = map.getContainer();
    const inside = (box: Box) => box.x0 >= 0 && box.x1 <= clientWidth && box.y0 >= 0 && box.y1 <= clientHeight;
    const free = (box: Box) => inside(box) && !placed.some((other) => overlaps(other, box));
    let chosen: { box: Box; left: boolean; drop: number } | null = null;
    for (let step = 0; step <= MAX_LABEL_STEPS && !chosen; step++) {
      const drop = step * height;
      const top = point.y - LABEL_TOP_PX + drop;
      const right = { x0: point.x + gap, x1: point.x + gap + width, y0: top, y1: top + height };
      const left = { x0: point.x - gap - width, x1: point.x - gap, y0: top, y1: top + height };
      if (free(right)) chosen = { box: right, left: false, drop };
      else if (free(left)) chosen = { box: left, left: true, drop };
    }
    const top = point.y - LABEL_TOP_PX;
    const fallback = { box: { x0: point.x + gap, x1: point.x + gap + width, y0: top, y1: top + height }, left: false, drop: 0 };
    const { box, left, drop } = chosen ?? fallback;
    element.classList.toggle(LEFT_LABEL_CLASS, left);
    element.style.setProperty(LABEL_DROP_VAR, `${drop}px`);
    placed.push(box);
  }
}

interface Plotted {
  nodeId: string;
  kind: "supplier" | "facility" | "field";
  code: string;
  sub: string | null;
  lat: number;
  lng: number;
}

function plotted(geo: ChainOfCustodyGeoData): Plotted[] {
  const out: Plotted[] = [];
  if (geo.facility.lat != null && geo.facility.lng != null) {
    out.push({ nodeId: `facility:${geo.facility.id}`, kind: "facility", code: geo.facility.code, sub: geo.facility.name, lat: geo.facility.lat, lng: geo.facility.lng });
  }
  for (const node of geo.nodes) {
    if (node.lat == null || node.lng == null) continue;
    if (node.positionSource !== "own" && node.positionSource !== "leg_origin") continue;
    if (node.kind !== "feedstock" && node.kind !== "application") continue;
    out.push({ nodeId: node.id, kind: node.kind === "feedstock" ? "supplier" : "field", code: node.code, sub: node.sub, lat: node.lat, lng: node.lng });
  }
  return out;
}

/** Endpoints rounded to ~1 km: legs between the same two places share a label. */
const ENDPOINT_DECIMALS = 2;
function endpointKey(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  return [a.lat, a.lng, b.lat, b.lng].map((value) => value.toFixed(ENDPOINT_DECIMALS)).join("|");
}

/** A drawn road is lit when any leg that shares it is. */
function legState(lighting: MapLighting, legIds: string[]): "lit" | "dim" | "rest" {
  if (legIds.some((id) => lighting.legIds.has(id))) return "lit";
  return lighting.nodeIds ? "dim" : "rest";
}

function opacityExpression(): maplibregl.ExpressionSpecification {
  return ["match", ["get", "state"], "lit", LIT_OPACITY, "dim", DIM_OPACITY, REST_OPACITY] as maplibregl.ExpressionSpecification;
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** The overlays may take at most this share of the map's width or height. */
const MAX_PADDING_SHARE = 0.6;

/** Scale the padding down on an axis where it would leave the map no room. */
function clampPadding(padding: FramePadding, container: HTMLElement): FramePadding {
  const fit = (before: number, after: number, size: number) => {
    const scale = Math.min(1, (size * MAX_PADDING_SHARE) / Math.max(1, before + after));
    return [before * scale, after * scale] as const;
  };
  const [left, right] = fit(padding.left, padding.right, container.clientWidth);
  const [top, bottom] = fit(padding.top, padding.bottom, container.clientHeight);
  return { top, right, bottom, left };
}

/**
 * Fly to the points. The map's own padding stays zero (cameraForBounds adds
 * it to the option padding), and a single point frames as a small box so it
 * lands at POINT_ZOOM with the same overlay padding as any other frame.
 */
function frame(map: maplibregl.Map, points: { lat: number; lng: number }[], requested: FramePadding, animate: boolean) {
  if (points.length === 0) return;
  const padding = clampPadding(requested, map.getContainer());
  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) bounds.extend([point.lng, point.lat]);
  const camera = map.cameraForBounds(bounds, { padding, maxZoom: bounds.getNorthEast().distanceTo(bounds.getSouthWest()) < POINT_SPAN_M ? POINT_ZOOM : FIT_MAX_ZOOM });
  if (!camera) return;
  map.flyTo({ ...camera, duration: animate ? FLY_DURATION_MS : 0 });
}

export default function TraceMapCanvas({
  geo,
  legs,
  routeGeometries,
  lighting,
  frameKey,
  padding,
  onMarkerClick,
  onBackgroundClick,
  controlsClassName,
}: TraceMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const chipsRef = useRef<ChipEntry[]>([]);
  const latest = useRef({ lighting, padding, onMarkerClick, onBackgroundClick });
  const [readyMap, setReadyMap] = useState<maplibregl.Map | null>(null);
  const [satOn, setSatOn] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latest.current = { lighting, padding, onMarkerClick, onBackgroundClick };
  });

  // Map lifecycle: the imperative-DOM exception.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: MAPTILER_KEY ? maptilerStyleUrl(MAPTILER_KEY) : BLANK_STYLE,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        attributionControl: false,
        dragRotate: false,
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    mapRef.current = map;
    container.dataset.mapState = "loading";
    map.once("load", () => {
      if (MAPTILER_KEY) applyBrandRecolor(map);
      map.addSource(SAT_SOURCE_ID, { type: "raster", tiles: [SAT_TILE_URL], tileSize: SAT_TILE_SIZE, attribution: SAT_TILE_ATTRIBUTION });
      map.addLayer({ id: SAT_LAYER_ID, type: "raster", source: SAT_SOURCE_ID, layout: { visibility: "none" }, paint: { "raster-saturation": SAT_RASTER_SATURATION } });
      const color = ["match", ["get", "kind"], "inbound", token("--clr-orange", "#FF8359"), token("--clr-pink", "#A6216E")] as maplibregl.ExpressionSpecification;
      const width = ["match", ["get", "state"], "lit", LIT_LINE_WIDTH, LEG_LINE_WIDTH] as maplibregl.ExpressionSpecification;
      map.addSource(SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: BASE_LAYER, type: "line", source: SOURCE_ID, filter: ["==", ["get", "routed"], true], paint: { "line-color": color, "line-width": width, "line-opacity": opacityExpression() } });
      map.addLayer({ id: FALLBACK_LAYER, type: "line", source: SOURCE_ID, filter: ["==", ["get", "routed"], false], paint: { "line-color": color, "line-width": width, "line-opacity": opacityExpression(), "line-dasharray": FALLBACK_DASHARRAY } });
      // Marching ants only on lit legs: direction where it matters.
      map.addLayer({ id: ANTS_LAYER, type: "line", source: SOURCE_ID, filter: ["all", ["==", ["get", "routed"], true], ["==", ["get", "state"], "lit"]], paint: { "line-color": token("--clr-dark-purple", "#0F021A"), "line-width": DASH_LINE_WIDTH, "line-dasharray": ANTS_DASH_SEQUENCE[0] } });
      setReadyMap(map);
    });
    map.on("render", () => {
      if (map.getLayer(BASE_LAYER) && !map.isMoving()) container.dataset.mapState = "ready";
    });
    let step = 0;
    const ants = setInterval(() => {
      if (!map.getLayer(ANTS_LAYER)) return;
      step = (step + 1) % ANTS_DASH_SEQUENCE.length;
      map.setPaintProperty(ANTS_LAYER, "line-dasharray", ANTS_DASH_SEQUENCE[step]);
    }, ANTS_INTERVAL_MS);
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container);
    map.on("click", () => latest.current.onBackgroundClick?.());
    map.on("zoom", () => syncChipVisibility(map, chipsRef.current));
    map.on("zoomend", () => declutterLabels(map, markersRef.current));
    return () => {
      clearInterval(ants);
      resize.disconnect();
      markersRef.current = [];
      chipsRef.current = [];
      mapRef.current = null;
      setReadyMap(null);
      map.remove();
    };
  }, []);

  // Legs and km labels follow the data and the lighting.
  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || readyMap !== map) return;
    for (const chip of chipsRef.current) chip.marker.remove();
    chipsRef.current = [];
    // One label per pair of endpoints: legs on the same road (product layers,
    // two intakes from one supplier) share it, so labels never pile up.
    const labels = new Map<string, { anchor: [number, number]; km: number; ends: ChipEntry["ends"] }>();
    const features = legs.map((drawn, index) => {
      const { entry, legIds } = drawn;
      const geometryId = legIds.find((id) => routeGeometries?.[id]) ?? entry.leg.id;
      const { coordinates, routed } = legLineCoordinates(entry, routeGeometries?.[geometryId]);
      const state = legState(lighting, legIds);
      if (state === "lit") {
        const key = endpointKey(entry.origin, entry.destination);
        const label = labels.get(key) ?? {
          anchor: chipAnchor(coordinates, index),
          km: 0,
          ends: [[entry.origin.lng, entry.origin.lat], [entry.destination.lng, entry.destination.lat]] as ChipEntry["ends"],
        };
        // Only the grouped legs that are lit count: one product layer selected, one layer's km.
        label.km += litKm(drawn, lighting.legIds);
        labels.set(key, label);
      }
      return {
        type: "Feature" as const,
        properties: { kind: entry.leg.kind, routed, legId: entry.leg.id, state },
        geometry: { type: "LineString" as const, coordinates },
      };
    });
    for (const { anchor, km, ends } of labels.values()) {
      const chip = document.createElement("div");
      chip.className = "tm-km";
      chip.textContent = formatDistanceKm(km);
      chipsRef.current.push({ marker: new maplibregl.Marker({ element: chip }).setLngLat(anchor).addTo(map), ends });
    }
    syncChipVisibility(map, chipsRef.current);
    (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
  }, [legs, routeGeometries, lighting, readyMap]);

  // Markers are built when the data changes, so a focused marker keeps its
  // keyboard focus while the selection moves; lighting only toggles classes.
  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || readyMap !== map) return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
    for (const node of plotted(geo)) {
      const element = createSiteMarkerElement(node);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        latest.current.onMarkerClick?.(node.nodeId);
      });
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          latest.current.onMarkerClick?.(node.nodeId);
        }
      });
      markersRef.current.push(new maplibregl.Marker({ element }).setLngLat([node.lng, node.lat]).addTo(map));
    }
  }, [geo, readyMap]);

  // The selection dims, rings and re-spaces the existing markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || readyMap !== map) return;
    for (const marker of markersRef.current) {
      const element = marker.getElement();
      const nodeId = element.dataset.nodeId ?? "";
      const isFacility = element.classList.contains("cvm-mk--facility");
      const lit = isFacility ? lighting.facilityLit : lighting.nodeIds?.has(nodeId) ?? true;
      element.classList.toggle(DIM_CLASS, Boolean(lighting.nodeIds) && !lit && !isFacility);
      element.classList.toggle("tm-quiet", Boolean(lighting.nodeIds) && !lit && !isFacility);
      element.classList.toggle(
        CURRENT_CLASS,
        nodeId === lighting.currentNodeId || (isFacility && lighting.facilityLit && Boolean(lighting.nodeIds)),
      );
    }
    declutterLabels(map, markersRef.current);
  }, [geo, lighting, readyMap]);

  // The camera follows the selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!readyMap || readyMap !== map) return;
    frame(map, latest.current.lighting.points, latest.current.padding, true);
  }, [frameKey, readyMap]);

  const toggleSat = () => {
    const map = mapRef.current;
    if (!map?.getLayer(SAT_LAYER_ID)) return;
    setSatOn(!satOn);
    map.setLayoutProperty(SAT_LAYER_ID, "visibility", satOn ? "none" : "visible");
  };

  if (failed) {
    return (
      <div className="cvm-field flex h-full items-center justify-center px-16">
        <div className="w-full max-w-[520px]">
          <EmptyState
            icon={<MapTrifoldIcon size={40} weight="thin" />}
            title="The map could not start"
            description="This browser could not start the map renderer. Reload the page or try another browser. The stages are still listed."
            padding="md"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`cvm-map relative h-full w-full${satOn ? " cvm-sat" : ""}`}>
      <div
        ref={containerRef}
        className={`h-full w-full ${MAPTILER_KEY ? "bg-[var(--color-background-white)]" : "cvm-field"}`}
        data-testid="carbon-viewer-map"
      />
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onFit={() => {
          if (mapRef.current) frame(mapRef.current, latest.current.lighting.points, latest.current.padding, true);
        }}
        fitAriaLabel="Fit map to the selection"
        satOn={satOn}
        onToggleSat={toggleSat}
        className={controlsClassName}
      />
    </div>
  );
}
