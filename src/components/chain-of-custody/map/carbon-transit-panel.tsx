"use client";

/**
 * Carbon Transit panel — "Geography: carbon in transit". Owns the geo data
 * fetch, route-geometry fetch, and the React overlays (legend, rails, warning
 * banner, empty state); the MapLibre half is dynamically imported so
 * maplibre-gl stays out of the route bundle.
 *
 * Graceful degradation (plan decision 5): no NEXT_PUBLIC_MAPTILER_KEY → no
 * basemap, a "map unavailable" notice with the rails still rendered; no
 * routing key → legs draw as dashed arcs (route geometries resolve to null).
 */

import dynamic from "next/dynamic";
import { MapTrifold } from "@phosphor-icons/react/dist/ssr";
import type {
  ChainGeoLeg,
  ChainOfCustodyGeoData,
} from "@/data-access/chain-of-custody-geo";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { ROUTE_GEOMETRY_MAX_LEGS } from "@/config/geo";
import {
  useChainOfCustodyGeo,
  useCreditBatchChainGeo,
} from "@/hooks/use-chain-of-custody";
import { useRouteGeometries } from "@/hooks/use-geo";
import { LINEAGE_NODE_STYLES } from "../chain-constants";
import { buildLineageNodes } from "../use-chain-graph";
import type { PopupContentByNodeId } from "./carbon-transit-map";
import {
  MapWarningBanner,
  NotGeolocatedChips,
  NotGeolocatedRail,
  TransportLegsRail,
  ViewerEmptyState,
  ViewerLegend,
} from "./viewer-rails";
import { resolveLegEndpoints } from "./viewer-utils";

// Inlined at build time — public, domain-locked key (browser-safe).
const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;

// maplibre-gl is ~250 kB gzipped — fetch it only when the map view renders.
const CarbonTransitMap = dynamic(() => import("./carbon-transit-map"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full w-full items-center justify-center bg-[var(--color-background-light)]"
      data-testid="carbon-viewer-map-loading"
    >
      <span className="label-button uppercase text-[var(--color-text-tertiary)]">
        Loading map…
      </span>
    </div>
  ),
});

/** Which anchor the panel plots: a single application or a batch roll-up. */
export type ChainGeoSource =
  | { kind: "application"; id: string }
  | { kind: "creditBatch"; id: string };

export interface CarbonTransitPanelProps {
  source: ChainGeoSource;
  /**
   * The lineage payload(s) the page already holds — feeds marker popups.
   * One entry for an application anchor; one per member for a batch.
   */
  lineages: ChainOfCustodyData[] | undefined;
  /** map = full side rails; split = collapsed not-geolocated chip box. */
  view: "map" | "split";
  /** Cross-link highlight from the DAG (nonce re-triggers repeat clicks). */
  highlight: { nodeId: string; nonce: number } | null;
  /** Marker / rail / chip selection — drives the DAG highlight upstream. */
  onNodeSelect: (nodeId: string) => void;
}

function buildPopupContent(
  lineages: ChainOfCustodyData[] | undefined
): PopupContentByNodeId {
  const content: PopupContentByNodeId = {};
  if (!lineages || lineages.length === 0) return content;
  for (const chainData of lineages) {
    for (const node of buildLineageNodes(chainData)) {
      if (content[node.id]) continue;
      content[node.id] = {
        typeLabel: LINEAGE_NODE_STYLES[node.kind].label,
        status: node.status ?? null,
        detailLines: node.detailLines,
      };
    }
  }
  const facility = lineages[0].facility;
  content[`facility:${facility.id}`] = {
    typeLabel: "Facility",
    status: null,
    detailLines: [facility.name],
  };
  return content;
}

/** Marker the rail row should highlight: the leg's chain-side anchor node. */
function legAnchorNodeId(geo: ChainOfCustodyGeoData, leg: ChainGeoLeg): string {
  if (leg.kind === "inbound") {
    const feedstock = geo.nodes.find((node) => node.entityId === leg.entityId);
    if (feedstock) return feedstock.id;
  } else {
    // Single-application chain: anchor outbound on the application. A batch
    // roll-up has N applications, so anchor on the leg's own product instead.
    const applications = geo.nodes.filter((node) => node.kind === "application");
    if (applications.length === 1) return applications[0].id;
    const product = geo.nodes.find(
      (node) => node.kind === "biocharProduct" && node.entityId === leg.entityId
    );
    if (product) return product.id;
  }
  return `facility:${geo.facility.id}`;
}

export function CarbonTransitPanel({
  source,
  lineages,
  view,
  highlight,
  onNodeSelect,
}: CarbonTransitPanelProps) {
  const applicationGeo = useChainOfCustodyGeo(
    source.kind === "application" ? source.id : null
  );
  const batchGeo = useCreditBatchChainGeo(
    source.kind === "creditBatch" ? source.id : null
  );
  const { data: geo, isLoading, isError, error } =
    source.kind === "application" ? applicationGeo : batchGeo;

  const plottableLegs = geo ? resolveLegEndpoints(geo).plottable : [];
  const { data: routeGeometries } = useRouteGeometries(
    plottableLegs.length > 0
      ? {
          legs: plottableLegs.slice(0, ROUTE_GEOMETRY_MAX_LEGS).map((entry) => ({
            id: entry.leg.id,
            origin: entry.origin,
            destination: entry.destination,
          })),
        }
      : null
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background-white)]">
        <div className="flex flex-col items-center gap-12">
          <MapTrifold size={32} className="animate-pulse text-[var(--color-text-tertiary)]" />
          <p className="body-medium text-[var(--color-text-secondary)]">Loading geography...</p>
        </div>
      </div>
    );
  }

  if (isError || !geo) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-background-white)]">
        <p className="body-medium text-[var(--color-signal-red)]">
          {error?.message || "Failed to load chain of custody map data."}
        </p>
      </div>
    );
  }

  const ungeolocated = geo.nodes.filter(
    (node) => node.positionSource === "facility" || node.positionSource === "none"
  );
  const facilityPlotted = geo.facility.lat != null && geo.facility.lng != null;
  const anythingPlotted =
    facilityPlotted ||
    geo.nodes.some(
      (node) => node.positionSource === "own" || node.positionSource === "leg_origin"
    );
  const popupContent = buildPopupContent(lineages);

  return (
    <div
      className="relative h-full overflow-hidden border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]"
      data-testid="carbon-viewer-panel"
    >
      {!anythingPlotted ? (
        <ViewerEmptyState message="No record in this chain carries GPS coordinates yet. Set a position on the facility, suppliers, or application to plot it here." />
      ) : (
        <>
          {MAPTILER_KEY ? (
            <CarbonTransitMap
              geo={geo}
              routeGeometries={routeGeometries}
              popupContent={popupContent}
              railVisible={view === "map"}
              highlight={highlight}
              onMarkerClick={onNodeSelect}
            />
          ) : (
            <div
              className="flex h-full flex-col items-center justify-center gap-6 bg-[var(--color-background-light)] px-16 text-center"
              data-testid="carbon-viewer-no-map"
            >
              <span className="label-button uppercase text-[var(--color-text-secondary)]">
                Map unavailable
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)]">
                Set NEXT_PUBLIC_MAPTILER_KEY to enable the basemap. Transport
                legs are listed in the rail.
              </span>
            </div>
          )}

          <MapWarningBanner warnings={geo.warnings} />
          <ViewerLegend />

          {view === "map" ? (
            <div className="absolute right-16 top-16 z-10 flex w-[252px] flex-col gap-12">
              <TransportLegsRail
                legs={geo.legs}
                onSelectLeg={(leg) => onNodeSelect(legAnchorNodeId(geo, leg))}
              />
              <NotGeolocatedRail
                nodes={ungeolocated}
                facilityCode={geo.facility.code}
                onSelectNode={onNodeSelect}
              />
            </div>
          ) : (
            <NotGeolocatedChips nodes={ungeolocated} onSelectNode={onNodeSelect} />
          )}
        </>
      )}
    </div>
  );
}
