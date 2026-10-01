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
  facility: RoutePoint;
  destination: RoutePoint;
  routeGeometry: RouteGeometry | null | undefined;
  /** Cards for the two endpoints; left out, the markers stay inert. */
  endpointCards?: { facility: EndpointCard; destination: EndpointCard };
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

interface EndpointRefs {
  cards: { current: RouteMiniMapProps["endpointCards"] };
  preview: { current: MiniMapPreview };
  popup: { current: maplibregl.Popup | null };
  pinned: { current: EndpointEnd | null };
}

/**
 * The element MapLibre places for one end. Without cards it is the bare 12px
 * marker. With cards the marker sits inside a 44px focusable button, so the
 * touch target meets the design system minimum and the keyboard reaches it.
 */
function endpointElement(
  accent: "purple" | "pink",
  card: EndpointCard | undefined,
): HTMLDivElement {
  const marker = createMarkerElement(accent);
  marker.style.cursor = "default";
  if (!card) return marker;
  marker.style.cursor = "pointer";
  const button = document.createElement("div");
  button.setAttribute("role", "button");
  button.tabIndex = 0;
  button.setAttribute("aria-label", `${card.typeLabel}: ${card.code}`);
  button.className =
    "flex size-44 cursor-pointer items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--clr-dark-purple)]";
  button.appendChild(marker);
  return button;
}

/**
 * Hover or keyboard focus shows an endpoint's card; a click, Enter or Space
 * pins it until the other marker or the map is clicked, or Escape. Same card
 * as the Carbon Viewer.
 */
function wireEndpoint(
  map: maplibregl.Map,
  el: HTMLDivElement,
  end: EndpointEnd,
  refs: EndpointRefs,
) {
  if (!refs.cards.current) return;
  const show = () => {
    const card = refs.cards.current?.[end];
    const point = refs.preview.current[end];
    if (!card || !refs.popup.current) return;
    refs.popup.current
      .setLngLat([point.lng, point.lat])
      .setDOMContent(createPopupCardElement({ ...card, status: null }))
      .addTo(map);
  };
  const hideUnlessPinned = () => {
    if (refs.pinned.current === null) refs.popup.current?.remove();
  };
  const togglePin = () => {
    if (refs.pinned.current === end) {
      refs.pinned.current = null;
      refs.popup.current?.remove();
      return;
    }
    refs.pinned.current = end;
    show();
  };
  el.addEventListener("mouseenter", () => {
    if (refs.pinned.current === null) show();
  });
  el.addEventListener("mouseleave", hideUnlessPinned);
  el.addEventListener("focus", () => {
    if (refs.pinned.current === null) show();
  });
  el.addEventListener("blur", hideUnlessPinned);
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePin();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      togglePin();
    } else if (event.key === "Escape" && refs.pinned.current !== null) {
      event.stopPropagation();
      refs.pinned.current = null;
      refs.popup.current?.remove();
    }
  });
}

export default function RouteMiniMap({
  facility,
  destination,
  routeGeometry,
  endpointCards,
}: RouteMiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef(endpointCards);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pinnedRef = useRef<EndpointEnd | null>(null);
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

  useEffect(() => {
    previewRef.current = { facility, destination, routeGeometry };
    cardsRef.current = endpointCards;
  });


  /** (Re)place both markers and the connector line on a loaded map. */
  const paintPreview = (map: maplibregl.Map, preview: MiniMapPreview) => {
    const facilityLngLat: [number, number] = [
      preview.facility.lng,
      preview.facility.lat,
    ];
    const destinationLngLat: [number, number] = [
      preview.destination.lng,
      preview.destination.lat,
    ];

    if (!facilityMarkerRef.current) {
      const el = endpointElement("purple", cardsRef.current?.facility);
      wireEndpoint(map, el, "facility", { cards: cardsRef, preview: previewRef, popup: popupRef, pinned: pinnedRef });
      facilityMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat(facilityLngLat)
        .addTo(map);
    } else {
      facilityMarkerRef.current.setLngLat(facilityLngLat);
    }

    if (!destinationMarkerRef.current) {
      const el = endpointElement("pink", cardsRef.current?.destination);
      wireEndpoint(map, el, "destination", { cards: cardsRef, preview: previewRef, popup: popupRef, pinned: pinnedRef });
      destinationMarkerRef.current = new maplibregl.Marker({ element: el })
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
    map.on("click", () => {
      pinnedRef.current = null;
      popupRef.current?.remove();
    });

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
