"use client";

/**
 * Carbon Transit map — the MapLibre half of the Carbon Viewer. Loaded via
 * next/dynamic (ssr: false) from carbon-transit-panel.tsx — never imported
 * directly, so maplibre-gl stays out of the shared client bundle.
 *
 * Suppliers fan into the facility, the facility fans out to fields. Legs are
 * real road polylines when route geometry resolved (solid + marching-ants
 * overlay) and dashed bowed arcs otherwise; chips at the line apex carry the
 * leg's STORED distance (the carbon number — never the polyline's length).
 *
 * The map instance lifecycle is the project's legitimate useEffect exception
 * (imperative DOM library). Event handlers reach React state through refs so
 * the map is created exactly once.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import "./carbon-viewer.css";
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
import { applyBrandRecolor, MapControls } from "@/components/map";
import type { ChainOfCustodyGeoData } from "@/data-access/chain-of-custody-geo";
import type { RouteGeometryByRequestId } from "@/data-access/geo-route-cache";
import {
  ANTS_DASH_SEQUENCE,
  ANTS_INTERVAL_MS,
  DASH_LINE_WIDTH,
  FALLBACK_DASHARRAY,
  FIT_DURATION_MS,
  FIT_MAX_ZOOM,
  FIT_PADDING,
  FOCUS_DIM_OPACITY,
  HIGHLIGHT_EASE_DURATION_MS,
  HIGHLIGHT_HOLD_MS,
  LEG_HIT_WIDTH,
  LEG_HOVER_DIM_OPACITY,
  LEG_HOVER_OPACITY,
  LEG_LINE_OPACITY,
  LEG_LINE_WIDTH,
  LEGS_BASE_LAYER_ID,
  LEGS_DASH_LAYER_ID,
  LEGS_HIT_LAYER_ID,
  LEGS_SOURCE_ID,
  POPUP_OFFSET_PX,
  POPUP_WIDTH_PX,
  SAT_LAYER_ID,
  SAT_SOURCE_ID,
  type ViewerMarkerKind,
} from "./viewer-constants";
import {
  createDistanceChipElement,
  createPopupCardElement,
  createSiteMarkerElement,
  type PopupCardInput,
} from "./viewer-elements";
import { chipAnchor, legLineCoordinates, resolveLegEndpoints } from "./viewer-utils";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const SAT_TILE_SIZE = 256;
const FALLBACK_LAYER_ID = `${LEGS_BASE_LAYER_ID}-fallback`;
// Extra bottom padding so a fit doesn't tuck markers under the legs strip:
// 72px strip body + 24px vertical padding + 36px breathing room.
const STRIP_FIT_BOTTOM = 132;
// CSS class toggled on out-of-focus markers / distance chips (opacity in CSS
// mirrors FOCUS_DIM_OPACITY; leg lines dim via the paint expression below).
const DIM_CLASS = "cvm-dim";

/**
 * No-basemap mode (missing NEXT_PUBLIC_MAPTILER_KEY): MapLibre still runs on
 * a blank transparent style, so markers, legs, and distance chips plot over
 * the container's tinted field — never a white void. The satellite raster is
 * key-independent, so the SAT toggle keeps working too.
 */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

/** Popup body per chain node id (codes + detail rows from the lineage DAG). */
export type PopupContentByNodeId = Record<
  string,
  Pick<PopupCardInput, "typeLabel" | "status" | "details">
>;

export interface CarbonTransitMapProps {
  geo: ChainOfCustodyGeoData;
  /** Road polylines per leg id; absent/null entries draw the dashed arc. */
  routeGeometries: RouteGeometryByRequestId | undefined;
  popupContent: PopupContentByNodeId;
  /** Side rail visible (map view) — widens the fit padding on the right. */
  railVisible: boolean;
  /** Cross-link from the DAG; nonce re-triggers for repeat clicks. */
  highlight: { nodeId: string; nonce: number } | null;
  /**
   * Active focus sub-chain — markers, distance chips, and leg lines outside
   * these sets dim. Null = nothing focused (everything full strength).
   */
  focus: { nodeIds: Set<string>; legIds: Set<string> } | null;
  /**
   * Transient hover isolation — the one leg under the pointer (map line or
   * rail card). While set, every other leg line + chip ghosts back so the
   * hovered hop reads alone. Null = nothing hovered.
   */
  hoverLegId: string | null;
  onMarkerClick?: (nodeId: string) => void;
  /** Hovering a map leg line reports up so the rail card can echo it. */
  onLegHover?: (legId: string | null) => void;
  /** Clear the shared focus (basemap click). */
  onClear?: () => void;
}

interface PlottedNode {
  nodeId: string;
  kind: ViewerMarkerKind;
  code: string;
  sub: string | null;
  lat: number;
  lng: number;
}

/** A drawn leg's GeoJSON feature — cached so focus dimming can re-flag it. */
interface LegFeature {
  type: "Feature";
  properties: {
    kind: "inbound" | "outbound";
    routed: boolean;
    legId: string;
    distanceKm: number;
    chipAnchor: [number, number];
    /** False when a focus is active and this leg is outside it (dimmed). */
    focused: boolean;
  };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}

/** Line-opacity expression: dim out-of-focus legs, full opacity otherwise. */
function focusOpacity(full: number): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "focused"], false],
    FOCUS_DIM_OPACITY,
    full,
  ] as maplibregl.ExpressionSpecification;
}

/**
 * Resolve a line layer's opacity. With a leg hovered, that leg pops to
 * `hoverFull` and every other line ghosts to {@link LEG_HOVER_DIM_OPACITY};
 * with nothing hovered it falls back to the persistent focus expression.
 */
function legLineOpacity(
  hoverLegId: string | null,
  restingFull: number,
  hoverFull: number
): maplibregl.ExpressionSpecification {
  if (!hoverLegId) return focusOpacity(restingFull);
  return [
    "case",
    ["==", ["get", "legId"], hoverLegId],
    hoverFull,
    LEG_HOVER_DIM_OPACITY,
  ] as maplibregl.ExpressionSpecification;
}

/** Marker set: facility + feedstock origins + the application field. */
function plottedNodes(geo: ChainOfCustodyGeoData): PlottedNode[] {
  const nodes: PlottedNode[] = [];
  if (geo.facility.lat != null && geo.facility.lng != null) {
    nodes.push({
      nodeId: `facility:${geo.facility.id}`,
      kind: "facility",
      code: geo.facility.code,
      sub: geo.facility.name,
      lat: geo.facility.lat,
      lng: geo.facility.lng,
    });
  }
  for (const node of geo.nodes) {
    if (node.lat == null || node.lng == null) continue;
    if (node.positionSource !== "own" && node.positionSource !== "leg_origin") continue;
    if (node.kind === "feedstock") {
      nodes.push({
        nodeId: node.id,
        kind: "supplier",
        code: node.code,
        sub: node.sub,
        lat: node.lat,
        lng: node.lng,
      });
    } else if (node.kind === "application") {
      nodes.push({
        nodeId: node.id,
        kind: "field",
        code: node.code,
        sub: node.sub,
        lat: node.lat,
        lng: node.lng,
      });
    }
  }
  return nodes;
}

function token(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
  );
}

export default function CarbonTransitMap({
  geo,
  routeGeometries,
  popupContent,
  railVisible,
  highlight,
  focus,
  hoverLegId,
  onMarkerClick,
  onLegHover,
  onClear,
}: CarbonTransitMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const chipsRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pinnedRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest focus + leg features so the geo-sync rebuild and the focus effect
  // can each re-apply dimming without recomputing the other's work.
  const focusRef = useRef(focus);
  const legFeaturesRef = useRef<LegFeature[]>([]);
  // Latest props for handlers that live as long as the map instance.
  const onMarkerClickRef = useRef(onMarkerClick);
  const onClearRef = useRef(onClear);
  const onLegHoverRef = useRef(onLegHover);
  const railVisibleRef = useRef(railVisible);
  // Latest hover so the geo-sync rebuild re-applies the right line opacity.
  const hoverLegIdRef = useRef(hoverLegId);
  const [styleReady, setStyleReady] = useState(false);
  const [satOn, setSatOn] = useState(false);
  // WebGL can be unavailable (headless browsers, exhausted contexts) — the
  // viewer degrades to the rails instead of crashing the page.
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
    onClearRef.current = onClear;
    onLegHoverRef.current = onLegHover;
    railVisibleRef.current = railVisible;
    hoverLegIdRef.current = hoverLegId;
    // geo-sync (a separate effect) reads the latest focus to flag newly built
    // markers/chips/legs; the dedicated focus effect handles focus-only changes.
    focusRef.current = focus;
  });

  const fitToMarkers = (animate: boolean) => {
    const map = mapRef.current;
    if (!map || markersRef.current.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const marker of markersRef.current) {
      bounds.extend(marker.getLngLat());
    }
    map.fitBounds(bounds, {
      padding: {
        ...FIT_PADDING,
        // The transport-legs strip sits along the bottom in map view — keep
        // markers clear of it.
        bottom: railVisibleRef.current ? STRIP_FIT_BOTTOM : FIT_PADDING.bottom,
      },
      maxZoom: FIT_MAX_ZOOM,
      duration: animate ? FIT_DURATION_MS : 0,
    });
  };

  // Map instance lifecycle — the legitimate imperative-DOM exception.
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
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      offset: POPUP_OFFSET_PX,
      className: "cvm-pop",
      maxWidth: `${POPUP_WIDTH_PX + 8}px`,
    });

    map.once("load", () => {
      if (MAPTILER_KEY) applyBrandRecolor(map);

      // SAT raster first so the leg layers added after naturally sit above it.
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

      const inbound = token("--clr-orange", "#FF8359");
      const outbound = token("--clr-pink", "#A6216E");
      const ink = token("--clr-dark-purple", "#0F021A");
      const colorByKind = [
        "match",
        ["get", "kind"],
        "inbound",
        inbound,
        outbound,
      ] as maplibregl.ExpressionSpecification;

      map.addSource(LEGS_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Routed legs: solid base + marching-ants overlay conveying direction.
      // line-opacity is focus-aware: out-of-focus legs dim via the `focused`
      // feature flag (set in the geo-sync + focus effects).
      map.addLayer({
        id: LEGS_BASE_LAYER_ID,
        type: "line",
        source: LEGS_SOURCE_ID,
        filter: ["==", ["get", "routed"], true],
        paint: {
          "line-color": colorByKind,
          "line-width": LEG_LINE_WIDTH,
          "line-opacity": focusOpacity(LEG_LINE_OPACITY),
        },
      });
      // Unrouted legs: dashed bowed arc — an estimated path, not a road.
      map.addLayer({
        id: FALLBACK_LAYER_ID,
        type: "line",
        source: LEGS_SOURCE_ID,
        filter: ["==", ["get", "routed"], false],
        paint: {
          "line-color": colorByKind,
          "line-width": LEG_LINE_WIDTH,
          "line-opacity": focusOpacity(LEG_LINE_OPACITY),
          "line-dasharray": FALLBACK_DASHARRAY,
        },
      });
      map.addLayer({
        id: LEGS_DASH_LAYER_ID,
        type: "line",
        source: LEGS_SOURCE_ID,
        filter: ["==", ["get", "routed"], true],
        paint: {
          "line-color": ink,
          "line-width": DASH_LINE_WIDTH,
          "line-opacity": focusOpacity(1),
          "line-dasharray": ANTS_DASH_SEQUENCE[0],
        },
      });

      // Invisible wide line on top — a forgiving hover hit-target so the thin
      // visible lines don't demand pixel-perfect aim.
      map.addLayer({
        id: LEGS_HIT_LAYER_ID,
        type: "line",
        source: LEGS_SOURCE_ID,
        paint: { "line-color": ink, "line-width": LEG_HIT_WIDTH, "line-opacity": 0 },
      });
      const reportHover = (event: maplibregl.MapLayerMouseEvent) => {
        const legId = event.features?.[0]?.properties?.legId as string | undefined;
        map.getCanvas().style.cursor = legId ? "pointer" : "";
        onLegHoverRef.current?.(legId ?? null);
      };
      map.on("mousemove", LEGS_HIT_LAYER_ID, reportHover);
      map.on("mouseleave", LEGS_HIT_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        onLegHoverRef.current?.(null);
      });

      setStyleReady(true);
    });

    // Marching ants — cycling the dasharray makes the gaps appear to travel.
    let antsStep = 0;
    const antsTimer = setInterval(() => {
      if (!map.getLayer(LEGS_DASH_LAYER_ID)) return;
      antsStep = (antsStep + 1) % ANTS_DASH_SEQUENCE.length;
      map.setPaintProperty(
        LEGS_DASH_LAYER_ID,
        "line-dasharray",
        ANTS_DASH_SEQUENCE[antsStep]
      );
    }, ANTS_INTERVAL_MS);

    // Split-view toggles change the panel width under the map.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(container);

    map.on("click", () => {
      // Clicks on the basemap unpin and clear any focus; marker clicks
      // stopPropagation so they never reach here.
      pinnedRef.current = null;
      popupRef.current?.remove();
      onClearRef.current?.();
    });

    return () => {
      clearInterval(antsTimer);
      resizeObserver.disconnect();
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      popupRef.current = null;
      markersRef.current = [];
      chipsRef.current = [];
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Sync legs + markers + chips with the chain data.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const currentFocus = focusRef.current;
    const { plottable } = resolveLegEndpoints(geo);
    const features = plottable.map((entry, index): LegFeature => {
      const { coordinates, routed } = legLineCoordinates(
        entry,
        routeGeometries?.[entry.leg.id]
      );
      return {
        type: "Feature",
        properties: {
          kind: entry.leg.kind,
          routed,
          legId: entry.leg.id,
          distanceKm: entry.leg.distanceKm,
          chipAnchor: chipAnchor(coordinates, index),
          focused: currentFocus ? currentFocus.legIds.has(entry.leg.id) : true,
        },
        geometry: { type: "LineString", coordinates },
      };
    });
    legFeaturesRef.current = features;
    const source = map.getSource(LEGS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features });

    popupRef.current?.remove();
    pinnedRef.current = null;
    for (const marker of markersRef.current) marker.remove();
    for (const chip of chipsRef.current) chip.remove();
    markersRef.current = [];
    chipsRef.current = [];

    for (const feature of features) {
      const chipElement = createDistanceChipElement(feature.properties.distanceKm);
      chipElement.dataset.legId = feature.properties.legId;
      if (currentFocus && !feature.properties.focused) {
        chipElement.classList.add(DIM_CLASS);
      }
      const chip = new maplibregl.Marker({ element: chipElement })
        .setLngLat(feature.properties.chipAnchor)
        .addTo(map);
      chipsRef.current.push(chip);
    }

    const openPopup = (node: PlottedNode) => {
      const popup = popupRef.current;
      if (!popup) return;
      const content = popupContent[node.nodeId];
      popup
        .setLngLat([node.lng, node.lat])
        .setDOMContent(
          createPopupCardElement({
            kind: node.kind,
            typeLabel: content?.typeLabel ?? node.kind,
            code: node.code,
            status: content?.status ?? null,
            details:
              content?.details ??
              (node.sub ? [{ label: "Detail", value: node.sub }] : []),
          })
        )
        .addTo(map);
    };

    for (const node of plottedNodes(geo)) {
      const element = createSiteMarkerElement(node);
      element.addEventListener("mouseenter", () => {
        if (!pinnedRef.current) openPopup(node);
      });
      element.addEventListener("mouseleave", () => {
        if (!pinnedRef.current) popupRef.current?.remove();
      });
      const togglePin = (event: Event) => {
        event.stopPropagation();
        pinnedRef.current = pinnedRef.current === node.nodeId ? null : node.nodeId;
        if (pinnedRef.current) openPopup(node);
        else popupRef.current?.remove();
        onMarkerClickRef.current?.(node.nodeId);
      };
      element.addEventListener("click", togglePin);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          togglePin(event);
        }
      });
      // The facility is the pivot — never dimmed; other markers dim when a
      // focus is active and they're outside its sub-chain.
      if (
        currentFocus &&
        !node.nodeId.startsWith("facility:") &&
        !currentFocus.nodeIds.has(node.nodeId)
      ) {
        element.classList.add(DIM_CLASS);
      }
      const marker = new maplibregl.Marker({ element })
        .setLngLat([node.lng, node.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }

    fitToMarkers(false);
  }, [geo, routeGeometries, popupContent, styleReady]);

  // Cross-link highlight from the DAG (ungeolocated nodes resolve to facility).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !highlight || !styleReady) return;

    const elements = markersRef.current.map((marker) => marker.getElement());
    for (const element of elements) element.classList.remove("cvm-hl");

    const target =
      elements.find((element) => element.dataset.nodeId === highlight.nodeId) ??
      elements.find((element) => element.dataset.nodeId?.startsWith("facility:"));
    if (!target) return;

    target.classList.add("cvm-hl");
    const marker = markersRef.current[elements.indexOf(target)];
    map.easeTo({ center: marker.getLngLat(), duration: HIGHLIGHT_EASE_DURATION_MS });

    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(
      () => target.classList.remove("cvm-hl"),
      HIGHLIGHT_HOLD_MS
    );
  }, [highlight, styleReady]);

  // Cross-surface focus — dim markers, distance chips, and leg lines outside
  // the active sub-chain (driven by the shared selection, in sync with the bar
  // and DAG). Persistent: holds until the focus clears, unlike the transient
  // highlight ring above.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    for (const marker of markersRef.current) {
      const element = marker.getElement();
      const nodeId = element.dataset.nodeId ?? "";
      const dim =
        focus !== null &&
        !nodeId.startsWith("facility:") &&
        !focus.nodeIds.has(nodeId);
      element.classList.toggle(DIM_CLASS, dim);
    }

    for (const chip of chipsRef.current) {
      const element = chip.getElement();
      const legId = element.dataset.legId ?? "";
      const dim = focus !== null && !focus.legIds.has(legId);
      element.classList.toggle(DIM_CLASS, dim);
    }

    const features = legFeaturesRef.current.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        focused: focus === null || focus.legIds.has(feature.properties.legId),
      },
    }));
    legFeaturesRef.current = features;
    const source = map.getSource(LEGS_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData({ type: "FeatureCollection", features });
  }, [focus, styleReady]);

  // Transient hover isolation — the hovered leg's line + chip stay lit while
  // every other leg ghosts back. Layered over the persistent focus dimming
  // (line opacity is a layer property, so it survives a geo re-sync); reverts
  // to the focus state when the pointer leaves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const layers: ReadonlyArray<readonly [string, number, number]> = [
      [LEGS_BASE_LAYER_ID, LEG_LINE_OPACITY, LEG_HOVER_OPACITY],
      [FALLBACK_LAYER_ID, LEG_LINE_OPACITY, LEG_HOVER_OPACITY],
      [LEGS_DASH_LAYER_ID, 1, 1],
    ];
    for (const [layerId, resting, hover] of layers) {
      if (map.getLayer(layerId)) {
        map.setPaintProperty(
          layerId,
          "line-opacity",
          legLineOpacity(hoverLegId, resting, hover)
        );
      }
    }

    const currentFocus = focusRef.current;
    for (const chip of chipsRef.current) {
      const element = chip.getElement();
      const legId = element.dataset.legId ?? "";
      // Hover wins while active; otherwise the persistent focus dim applies.
      element.classList.toggle(
        "cvm-hoverdim",
        hoverLegId !== null && legId !== hoverLegId
      );
      element.classList.toggle(
        DIM_CLASS,
        hoverLegId === null && currentFocus !== null && !currentFocus.legIds.has(legId)
      );
    }
  }, [hoverLegId, styleReady]);

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
        className="cvm-field flex h-full flex-col items-center justify-center gap-6 px-16 text-center"
        data-testid="carbon-viewer-no-map"
      >
        <span className="label-button uppercase text-[var(--color-text-secondary)]">
          Map unavailable
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          The browser could not start the map renderer (WebGL). Transport legs
          are listed in the rail.
        </span>
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
      {!MAPTILER_KEY && !satOn ? (
        <div
          className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)] px-10 py-6 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]"
          data-testid="carbon-viewer-no-basemap-note"
        >
          Basemap unavailable — set NEXT_PUBLIC_MAPTILER_KEY
        </div>
      ) : null}
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onFit={() => fitToMarkers(true)}
        satOn={satOn}
        onToggleSat={toggleSat}
      />
    </div>
  );
}
