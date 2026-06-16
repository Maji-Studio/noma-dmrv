"use client";

/**
 * Dashboard traceability map — the facility hub with its feedstock sources and
 * application fields, plus the DIRECTIONAL legs between them (inbound feedstock
 * → facility in orange, outbound facility → field in pink). Legs are bowed arcs
 * with a marching-ants overlay so the flow direction is always visible; both
 * markers AND legs are clickable, opening a brutalist popup card with the
 * record's detail and a link to navigate (the field card links straight into
 * the chain-of-custody trail — every transport step).
 *
 * Loaded via next/dynamic (ssr: false) from traceability-section.tsx so
 * maplibre-gl never enters the route bundle. The map instance lifecycle is the
 * project's legitimate imperative-DOM useEffect exception; handlers reach the
 * latest props through refs so the map is created exactly once.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import "./traceability-map.css";
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
import { applyBrandRecolor, MapControls, OWN_LAYER_PREFIX } from "@/components/map";
import { bowedArc } from "@/components/chain-of-custody/map/viewer-utils";
import {
  ANTS_DASH_SEQUENCE,
  ANTS_INTERVAL_MS,
} from "@/components/chain-of-custody/map/viewer-constants";
import type {
  DashboardMapEdge,
  DashboardMapKind,
  DashboardMapPoint,
} from "@/data-access/dashboard-overview";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

const SAT_SOURCE_ID = `${OWN_LAYER_PREFIX}dtm-sat`;
const SAT_LAYER_ID = `${OWN_LAYER_PREFIX}dtm-sat-layer`;
const LEGS_SOURCE_ID = `${OWN_LAYER_PREFIX}dtm-legs`;
const LEGS_BASE_LAYER_ID = `${OWN_LAYER_PREFIX}dtm-legs-base`;
const LEGS_DASH_LAYER_ID = `${OWN_LAYER_PREFIX}dtm-legs-dash`;
const LEGS_HIT_LAYER_ID = `${OWN_LAYER_PREFIX}dtm-legs-hit`;

const SAT_TILE_SIZE = 256;
const FIT_PADDING = 56;
const FIT_MAX_ZOOM = 11.5;
const POPUP_OFFSET_PX = 16;

/** No-key fallback: markers + legs still paint over a blank tinted field. */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

const POINT_META: Record<DashboardMapKind, { type: string; link: string }> = {
  facility: { type: "Facility", link: "Open facility" },
  feedstock: { type: "Feedstock source", link: "Open feedstock" },
  application: { type: "Application field", link: "View transport steps" },
};

function token(name: string, fallback: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

function boundsFor(points: DashboardMapPoint[]): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  for (const point of points) bounds.extend([point.lng, point.lat]);
  return bounds;
}

/** GeoJSON line features for the legs (bowed arcs between resolved points). */
function legFeatures(points: DashboardMapPoint[], edges: DashboardMapEdge[]) {
  const byId = new Map(points.map((point) => [point.id, point]));
  const features = [];
  for (const edge of edges) {
    const from = byId.get(edge.fromId);
    const to = byId.get(edge.toId);
    if (!from || !to) continue;
    features.push({
      type: "Feature" as const,
      properties: { edgeId: edge.id, kind: edge.kind },
      geometry: {
        type: "LineString" as const,
        coordinates: bowedArc(
          { lat: from.lat, lng: from.lng },
          { lat: to.lat, lng: to.lng },
        ),
      },
    });
  }
  return features;
}

// ── imperative DOM factories (createElement + textContent only) ───────────

function createMarker(point: DashboardMapPoint): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `dtm-mk dtm-mk--${point.kind}`;
  el.dataset.testid = "traceability-marker";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", `${point.label} — ${point.sublabel}`);

  const ring = document.createElement("div");
  ring.className = "dtm-ring";
  el.appendChild(ring);
  const shape = document.createElement("div");
  shape.className = "dtm-shape";
  el.appendChild(shape);
  const label = document.createElement("div");
  label.className = "dtm-lbl";
  label.textContent = point.label;
  el.appendChild(label);

  return el;
}

interface CardInput {
  variant: string;
  typeLabel: string;
  code: string;
  details: { label: string; value: string }[];
  href: string;
  linkLabel: string;
}

function createCard(input: CardInput): HTMLDivElement {
  const card = document.createElement("div");
  card.className = `dtm-card dtm-card--${input.variant}`;
  card.dataset.testid = "traceability-popup";

  const head = document.createElement("div");
  head.className = "dtm-card-head";
  const type = document.createElement("span");
  type.className = "dtm-card-type";
  type.textContent = input.typeLabel;
  head.appendChild(type);
  card.appendChild(head);

  const code = document.createElement("div");
  code.className = "dtm-card-code";
  code.textContent = input.code;
  card.appendChild(code);

  if (input.details.length > 0) {
    const details = document.createElement("div");
    details.className = "dtm-card-details";
    for (const entry of input.details) {
      const row = document.createElement("div");
      row.className = "dtm-card-dr";
      const label = document.createElement("span");
      label.className = "dtm-card-dl";
      label.textContent = entry.label;
      const value = document.createElement("span");
      value.className = "dtm-card-dv";
      value.textContent = entry.value;
      row.append(label, value);
      details.appendChild(row);
    }
    card.appendChild(details);
  }

  const link = document.createElement("a");
  link.className = "dtm-card-link";
  link.href = input.href;
  const linkText = document.createElement("span");
  linkText.textContent = input.linkLabel;
  const arrow = document.createElement("span");
  arrow.textContent = "→";
  link.append(linkText, arrow);
  card.appendChild(link);

  return card;
}

function pointCard(point: DashboardMapPoint): HTMLDivElement {
  const meta = POINT_META[point.kind];
  return createCard({
    variant: point.kind,
    typeLabel: meta.type,
    code: point.label,
    details: point.details,
    href: point.href,
    linkLabel: meta.link,
  });
}

function edgeCard(edge: DashboardMapEdge): HTMLDivElement {
  const details: { label: string; value: string }[] = [
    {
      label: "Direction",
      value: edge.kind === "inbound" ? "Source → facility" : "Facility → field",
    },
  ];
  if (edge.distanceKm != null && edge.distanceKm > 0) {
    details.push({ label: "Distance", value: `${Math.round(edge.distanceKm)} km` });
  }
  return createCard({
    variant: edge.kind,
    typeLabel: edge.kind === "inbound" ? "Inbound leg" : "Outbound leg",
    code: edge.label,
    details,
    href: edge.href,
    linkLabel: edge.kind === "inbound" ? "Open feedstocks" : "View transport steps",
  });
}

interface TraceabilityMapProps {
  points: DashboardMapPoint[];
  edges: DashboardMapEdge[];
}

export default function TraceabilityMap({ points, edges }: TraceabilityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pointsRef = useRef(points);
  const edgesRef = useRef(edges);
  const [satOn, setSatOn] = useState(false);
  // Markers + legs paint only after the style loads (sources/layers exist).
  const [styleReady, setStyleReady] = useState(false);
  // WebGL can be unavailable (headless browsers, exhausted contexts) — keep
  // the panel rather than crashing the dashboard.
  const [mapFailed, setMapFailed] = useState(false);

  useEffect(() => {
    pointsRef.current = points;
    edgesRef.current = edges;
  });

  // Map instance lifecycle — the legitimate imperative-DOM exception.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initial = pointsRef.current;
    const view: Partial<maplibregl.MapOptions> = initial.length
      ? {
          bounds: boundsFor(initial),
          fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
        }
      : { center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM };

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: MAPTILER_KEY ? maptilerStyleUrl(MAPTILER_KEY) : BLANK_STYLE,
        attributionControl: { compact: true },
        dragRotate: false,
        ...view,
      });
    } catch (error) {
      console.error("Traceability map initialization failed", error);
      queueMicrotask(() => setMapFailed(true));
      return;
    }
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      offset: POPUP_OFFSET_PX,
      className: "dtm-pop",
      maxWidth: "230px",
    });

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
      map.addLayer({
        id: LEGS_BASE_LAYER_ID,
        type: "line",
        source: LEGS_SOURCE_ID,
        layout: { "line-cap": "round" },
        paint: { "line-color": colorByKind, "line-width": 1.8, "line-opacity": 0.85 },
      });
      // Marching-ants overlay — cycling the dasharray makes flow direction read.
      map.addLayer({
        id: LEGS_DASH_LAYER_ID,
        type: "line",
        source: LEGS_SOURCE_ID,
        paint: {
          "line-color": ink,
          "line-width": 1.5,
          "line-dasharray": ANTS_DASH_SEQUENCE[0],
        },
      });
      // Invisible fat line for forgiving click/hover hit-testing on the legs.
      map.addLayer({
        id: LEGS_HIT_LAYER_ID,
        type: "line",
        source: LEGS_SOURCE_ID,
        paint: { "line-color": ink, "line-width": 14, "line-opacity": 0 },
      });

      // Markers + legs are painted by the sync effect once this flips true.
      setStyleReady(true);
    });

    // Marching ants animation.
    let antsStep = 0;
    const antsTimer = setInterval(() => {
      if (!map.getLayer(LEGS_DASH_LAYER_ID)) return;
      antsStep = (antsStep + 1) % ANTS_DASH_SEQUENCE.length;
      map.setPaintProperty(
        LEGS_DASH_LAYER_ID,
        "line-dasharray",
        ANTS_DASH_SEQUENCE[antsStep],
      );
    }, ANTS_INTERVAL_MS);

    // One click handler: a leg under the cursor opens its card, otherwise the
    // basemap click dismisses any open popup. Marker clicks stopPropagation.
    map.on("click", (event) => {
      const hits = map.getLayer(LEGS_HIT_LAYER_ID)
        ? map.queryRenderedFeatures(event.point, { layers: [LEGS_HIT_LAYER_ID] })
        : [];
      const edgeId = hits[0]?.properties?.edgeId as string | undefined;
      const edge = edgeId
        ? edgesRef.current.find((candidate) => candidate.id === edgeId)
        : undefined;
      if (edge) {
        popupRef.current
          ?.setLngLat(event.lngLat)
          .setDOMContent(edgeCard(edge))
          .addTo(map);
      } else {
        popupRef.current?.remove();
      }
    });
    map.on("mouseenter", LEGS_HIT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LEGS_HIT_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    return () => {
      clearInterval(antsTimer);
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      popupRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Paint (and re-sync) legs + markers once the style is ready and whenever the
  // facility's trace changes. All component-scope refs are stable; the module
  // helpers (legFeatures / createMarker / pointCard) need no deps.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;

    const source = map.getSource(LEGS_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: legFeatures(points, edges),
    });

    popupRef.current?.remove();
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    for (const point of points) {
      const element = createMarker(point);
      const open = (event: Event) => {
        event.stopPropagation();
        popupRef.current
          ?.setLngLat([point.lng, point.lat])
          .setDOMContent(pointCard(point))
          .addTo(map);
      };
      element.addEventListener("click", open);
      element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open(event);
        }
      });
      markersRef.current.push(
        new maplibregl.Marker({ element })
          .setLngLat([point.lng, point.lat])
          .addTo(map),
      );
    }

    if (points.length) {
      map.fitBounds(boundsFor(points), {
        padding: FIT_PADDING,
        maxZoom: FIT_MAX_ZOOM,
        duration: 0,
      });
    }
  }, [points, edges, styleReady]);

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
        data-testid="traceability-map-failed"
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
    <div className={`dtm-map relative h-full w-full${satOn ? " dtm-sat" : ""}`}>
      <div
        ref={containerRef}
        className="h-full w-full bg-[var(--color-background-white)]"
        data-testid="traceability-map"
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
