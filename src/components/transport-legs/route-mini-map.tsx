"use client";

/**
 * Read-only MapLibre mini map for one transport route: facility marker,
 * far-end marker, and a cached road route when available. Hovering a marker
 * shows its card (the Carbon Viewer card); a click pins it.
 * Unresolved or unavailable geometry uses the Carbon Viewer's straight dashed
 * fallback convention.
 *
 * Loaded via next/dynamic (ssr: false) from transport-route-map.tsx, and
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
import * as maplibregl from "maplibre-gl";
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
  type MapAccent,
  OWN_LAYER_PREFIX,
} from "@/components/map";
import type { RouteGeometry } from "@/lib/geo/types";
import {
  createPopupCardElement,
  POPUP_MAX_WIDTH_PX,
  POPUP_OFFSET_PX,
  type PopupCardInput,
} from "@/components/chain-of-custody/map";
import {
  resolveRouteLine,
  type RoutePoint,
} from "./route-line";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}route-sat`;
const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}route-sat-layer`;
const SAT_TILE_SIZE = 256;
const CONNECTOR_SOURCE_ID = `${OWN_LAYER_PREFIX}route-connector`;
const CONNECTOR_ROAD_LAYER_ID = `${OWN_LAYER_PREFIX}route-connector-road`;
const CONNECTOR_FALLBACK_LAYER_ID = `${OWN_LAYER_PREFIX}route-connector-fallback`;
// Line treatments mirror the Carbon Viewer's solid-road and dashed-fallback
// convention (chain-of-custody/map/viewer-constants.ts).
const CONNECTOR_LINE_WIDTH = 1.6;
const CONNECTOR_LINE_OPACITY = 0.85;
const CONNECTOR_DASHARRAY = [2, 2];
/** Padding around the two endpoints when fitting the view (px). */
const FIT_PADDING = 48;
/** Don't zoom past street level when the endpoints are very close. */
const FIT_MAX_ZOOM = 13;

/** The Carbon Viewer card shown on hover or click of an endpoint. */
export type EndpointCard = Pick<PopupCardInput, "kind" | "typeLabel" | "code" | "details">;

export interface RouteMiniMapProps {
  /** The end drawn in the first accent (the facility, where there is one). */
  facility: RoutePoint;
  destination: RoutePoint;
  routeGeometry: RouteGeometry | null | undefined;
  /** Cards for the two endpoints, shown on hover, focus or click. */
  endpointCards: { facility: EndpointCard; destination: EndpointCard };
  /** Marker colour per end, by what the end is (supplier, facility, field). */
  accents?: { facility: MapAccent; destination: MapAccent };
}

interface MiniMapPreview {
  facility: RoutePoint;
  destination: RoutePoint;
  routeGeometry: RouteGeometry | null | undefined;
}

/** Resolve a design token at runtime — MapLibre paints to canvas, so CSS
 * variables can't be used in paint properties directly. */
function token(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

function connectorData({
  facility,
  destination,
  routeGeometry,
}: MiniMapPreview) {
  const preview = resolveRouteLine(
    facility,
    destination,
    routeGeometry
  );
  return {
    type: "Feature" as const,
    properties: { routed: preview.routed },
    geometry: {
      type: "LineString" as const,
      coordinates: preview.coordinates,
    },
  };
}

function boundsFor({
  facility,
  destination,
  routeGeometry,
}: MiniMapPreview): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  const preview = resolveRouteLine(
    facility,
    destination,
    routeGeometry
  );
  for (const coordinate of preview.boundsCoordinates) {
    bounds.extend(coordinate);
  }
  return bounds;
}

type EndpointEnd = "facility" | "destination";

/** How long a hover card waits before closing, so the pointer can reach it. */
const HOVER_GRACE_MS = 200;

interface EndpointState {
  /** The end whose card is open, if any. */
  shown: EndpointEnd | null;
  /** The end whose card stays open until dismissed. */
  pinned: EndpointEnd | null;
  hideTimer: ReturnType<typeof setTimeout> | null;
  buttons: Partial<Record<EndpointEnd, HTMLButtonElement>>;
}

interface EndpointRefs {
  cards: { current: RouteMiniMapProps["endpointCards"] };
  preview: { current: MiniMapPreview };
  popup: { current: maplibregl.Popup | null };
  state: { current: EndpointState };
}

/** The card's content as one sentence, for the marker's accessible description. */
function describeCard(card: EndpointCard): string {
  return [card.typeLabel, ...card.details.map((row) => `${row.label} ${row.value}`)].join(". ");
}

// Markers are built imperatively in a client-only map, so a module counter is
// enough to keep each description id unique on the page.
let nextDescriptionId = 0;

/**
 * The element MapLibre places for one end: the 12px marker inside a 44px
 * native button (the design system's touch target), plus a screen-reader copy
 * of its card that the button names as its description.
 */
function endpointElement(
  accent: MapAccent,
  card: EndpointCard,
): { root: HTMLDivElement; button: HTMLButtonElement } {
  nextDescriptionId += 1;
  const descriptionId = `route-endpoint-description-${nextDescriptionId}`;
  const marker = createMarkerElement(accent);
  marker.style.cursor = "pointer";
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", `${card.typeLabel}: ${card.code}`);
  button.setAttribute("aria-describedby", descriptionId);
  button.setAttribute("aria-expanded", "false");
  button.className =
    "flex size-44 cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--clr-dark-purple)]";
  button.appendChild(marker);
  const description = document.createElement("span");
  description.id = descriptionId;
  description.className = "sr-only";
  description.textContent = describeCard(card);
  const root = document.createElement("div");
  root.append(button, description);
  return { root, button };
}

function setShown(refs: EndpointRefs, end: EndpointEnd | null) {
  refs.state.current.shown = end;
  for (const [key, button] of Object.entries(refs.state.current.buttons)) {
    button?.setAttribute("aria-expanded", String(key === end));
  }
}

function clearHideTimer(refs: EndpointRefs) {
  const state = refs.state.current;
  if (state.hideTimer) clearTimeout(state.hideTimer);
  state.hideTimer = null;
}

/** Close whichever card is open and drop any pin. */
function closeCard(refs: EndpointRefs) {
  clearHideTimer(refs);
  refs.state.current.pinned = null;
  refs.popup.current?.remove();
  setShown(refs, null);
}

function showCard(map: maplibregl.Map, refs: EndpointRefs, end: EndpointEnd) {
  clearHideTimer(refs);
  const card = refs.cards.current[end];
  const point = refs.preview.current[end];
  if (!refs.popup.current) return;
  const element = createPopupCardElement({ ...card, status: null });
  // The card itself keeps a hover card open, so a magnified view can reach it.
  element.addEventListener("mouseenter", () => clearHideTimer(refs));
  element.addEventListener("mouseleave", () => scheduleHide(refs));
  refs.popup.current.setLngLat([point.lng, point.lat]).setDOMContent(element).addTo(map);
  setShown(refs, end);
}

/** Close an unpinned hover card after a grace period, unless its marker has focus. */
function scheduleHide(refs: EndpointRefs) {
  const state = refs.state.current;
  if (state.pinned !== null || state.shown === null) return;
  if (document.activeElement === state.buttons[state.shown]) return;
  clearHideTimer(refs);
  state.hideTimer = setTimeout(() => {
    if (refs.state.current.pinned === null) closeCard(refs);
  }, HOVER_GRACE_MS);
}

/**
 * Hover or focus shows an endpoint's card; a click (or Enter and Space, which
 * the native button turns into a click) pins it until the marker is pressed
 * again, the map is clicked or Escape is pressed. Same card as the Carbon
 * Viewer.
 */
function wireEndpoint(map: maplibregl.Map, button: HTMLButtonElement, end: EndpointEnd, refs: EndpointRefs) {
  refs.state.current.buttons[end] = button;
  button.addEventListener("mouseenter", () => {
    if (refs.state.current.pinned === null) showCard(map, refs, end);
  });
  button.addEventListener("mouseleave", () => scheduleHide(refs));
  button.addEventListener("focus", () => {
    // Moving focus to the other marker moves the card with it.
    if (refs.state.current.pinned !== end) {
      refs.state.current.pinned = null;
      showCard(map, refs, end);
    }
  });
  button.addEventListener("blur", () => {
    if (refs.state.current.pinned === null) closeCard(refs);
  });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (refs.state.current.pinned === end) {
      closeCard(refs);
      return;
    }
    showCard(map, refs, end);
    refs.state.current.pinned = end;
  });
  button.addEventListener("keydown", (event) => {
    // Escape closes the card first; the dialog only closes on a second press.
    if (event.key === "Escape" && refs.state.current.shown !== null) {
      event.preventDefault();
      event.stopPropagation();
      closeCard(refs);
    }
  });
}

export default function RouteMiniMap({
  facility,
  destination,
  routeGeometry,
  endpointCards,
  accents = { facility: "purple", destination: "pink" },
}: RouteMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef(endpointCards);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const endpointStateRef = useRef<EndpointState>({
    shown: null,
    pinned: null,
    hideTimer: null,
    buttons: {},
  });
  const mapRef = useRef<maplibregl.Map | null>(null);
  const facilityMarkerRef = useRef<maplibregl.Marker | null>(null);
  const destinationMarkerRef = useRef<maplibregl.Marker | null>(null);
  // The load handler lives for the map's lifetime; it reads the endpoints and
  // route through this ref so it always paints the latest props.
  const previewRef = useRef<MiniMapPreview>({
    facility,
    destination,
    routeGeometry,
  });
  const [satOn, setSatOn] = useState(false);
  // WebGL can be unavailable (headless browsers, exhausted contexts) — the
  // panel keeps its textual details instead of crashing the form.
  const [mapFailed, setMapFailed] = useState(false);

  const accentsRef = useRef(accents);

  useEffect(() => {
    previewRef.current = { facility, destination, routeGeometry };
    cardsRef.current = endpointCards;
    accentsRef.current = accents;
  });

  /** (Re)place both markers and the connector line on a loaded map. */
  const paintPreview = (map: maplibregl.Map, preview: MiniMapPreview) => {
    const endpointRefs: EndpointRefs = {
      cards: cardsRef,
      preview: previewRef,
      popup: popupRef,
      state: endpointStateRef,
    };
    const facilityLngLat: [number, number] = [
      preview.facility.lng,
      preview.facility.lat,
    ];
    const destinationLngLat: [number, number] = [
      preview.destination.lng,
      preview.destination.lat,
    ];

    if (!facilityMarkerRef.current) {
      const { root, button } = endpointElement(
        accentsRef.current.facility,
        cardsRef.current.facility,
      );
      wireEndpoint(map, button, "facility", endpointRefs);
      facilityMarkerRef.current = new maplibregl.Marker({ element: root })
        .setLngLat(facilityLngLat)
        .addTo(map);
    } else {
      facilityMarkerRef.current.setLngLat(facilityLngLat);
    }

    if (!destinationMarkerRef.current) {
      const { root, button } = endpointElement(
        accentsRef.current.destination,
        cardsRef.current.destination,
      );
      wireEndpoint(map, button, "destination", endpointRefs);
      destinationMarkerRef.current = new maplibregl.Marker({ element: root })
        .setLngLat(destinationLngLat)
        .addTo(map);
    } else {
      destinationMarkerRef.current.setLngLat(destinationLngLat);
    }

    const source = map.getSource(CONNECTOR_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData(connectorData(preview));
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
        bounds: boundsFor(previewRef.current),
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
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: POPUP_OFFSET_PX,
      className: "cvm-pop",
      maxWidth: `${POPUP_MAX_WIDTH_PX}px`,
    });
    const endpointRefs: EndpointRefs = {
      cards: cardsRef,
      preview: previewRef,
      popup: popupRef,
      state: endpointStateRef,
    };
    const endpointState = endpointStateRef.current;
    map.on("click", () => closeCard(endpointRefs));

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
        id: CONNECTOR_ROAD_LAYER_ID,
        type: "line",
        source: CONNECTOR_SOURCE_ID,
        filter: ["==", ["get", "routed"], true],
        paint: {
          "line-color": token("--clr-pink", "#A6216E"),
          "line-width": CONNECTOR_LINE_WIDTH,
          "line-opacity": CONNECTOR_LINE_OPACITY,
        },
      });
      map.addLayer({
        id: CONNECTOR_FALLBACK_LAYER_ID,
        type: "line",
        source: CONNECTOR_SOURCE_ID,
        filter: ["==", ["get", "routed"], false],
        paint: {
          "line-color": token("--clr-pink", "#A6216E"),
          "line-width": CONNECTOR_LINE_WIDTH,
          "line-opacity": CONNECTOR_LINE_OPACITY,
          "line-dasharray": CONNECTOR_DASHARRAY,
        },
      });
      paintPreview(map, previewRef.current);
    });

    return () => {
      clearHideTimer(endpointRefs);
      endpointState.buttons = {};
      popupRef.current?.remove();
      popupRef.current = null;
      facilityMarkerRef.current = null;
      destinationMarkerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
    // Initial bounds come from previewRef; later prop changes are synced below.
  }, []);

  // Sync endpoint or route changes after the initial paint. Before the map's
  // `load` the connector source doesn't exist yet; the load handler paints
  // from previewRef, which already holds the latest props.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource(CONNECTOR_SOURCE_ID)) return;

    const preview: MiniMapPreview = {
      facility,
      destination,
      routeGeometry,
    };
    paintPreview(map, preview);
    map.fitBounds(boundsFor(preview), {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: 0,
    });
  }, [facility, destination, routeGeometry]);

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
        data-testid="transport-route-map-failed"
      >
        <span className="body-small font-medium text-[var(--color-text-secondary)]">
          Map preview unavailable
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          The browser could not start the map renderer (WebGL). The route
          details still apply.
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full bg-[var(--color-background-white)]"
        data-testid="transport-route-map-canvas"
      />
      <MapControls
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
        onFit={() =>
          mapRef.current?.fitBounds(
            boundsFor({ facility, destination, routeGeometry }),
            {
              padding: FIT_PADDING,
              maxZoom: FIT_MAX_ZOOM,
            }
          )
        }
        satOn={satOn}
        onToggleSat={toggleSat}
      />
    </div>
  );
}
