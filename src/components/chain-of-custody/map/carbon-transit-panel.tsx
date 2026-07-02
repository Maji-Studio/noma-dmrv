"use client";

/**
 * Carbon Transit panel — "Geography: carbon in transit". Owns the geo data
 * fetch, route-geometry fetch, and the React overlays (legend, rails, warning
 * banner, empty state); the MapLibre half is dynamically imported so
 * maplibre-gl stays out of the route bundle.
 *
 * Graceful degradation (plan decision 5): no NEXT_PUBLIC_MAPTILER_KEY → the
 * map still runs on a blank style over a tinted field (markers/legs/chips
 * plotted, "basemap unavailable" note); no routing key → legs draw as dashed
 * arcs (route geometries resolve to null).
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
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
  TransportLegsRail,
  ViewerEmptyState,
  ViewerLegend,
} from "./viewer-rails";
import { resolveLegEndpoints } from "./viewer-utils";

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
  /**
   * Reachable sub-chain node ids for the active focus (the shared selection's
   * lineage); null = nothing focused, everything full strength.
   */
  focusNodeIds: Set<string> | null;
  /** Marker / rail / chip selection — drives the DAG highlight upstream. */
  onNodeSelect: (nodeId: string) => void;
  /** Clear the shared focus (hub click / basemap click). */
  onClearSelection: () => void;
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
        details: [
          ...(node.date ? [{ label: "Date", value: node.date }] : []),
          ...node.details,
        ],
      };
    }
  }
  const facility = lineages[0].facility;
  content[`facility:${facility.id}`] = {
    typeLabel: "Facility",
    status: null,
    details: [{ label: "Name", value: facility.name }],
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
  focusNodeIds,
  onNodeSelect,
  onClearSelection,
}: CarbonTransitPanelProps) {
  // Transient hover isolation, shared between the map (line hover) and the rail
  // (dropdown-row hover): whichever sets it, both surfaces ghost back the rest.
  const [hoverLegId, setHoverLegId] = useState<string | null>(null);
  // Drop the hovered leg whenever the plotted source changes — a leftover hover
  // from the previous application/batch points at a leg that no longer exists,
  // which would pin the whole map in isolation mode. Reset during render (the
  // React-recommended reset-on-prop-change) rather than via useEffect.
  const sourceKey = `${source.kind}:${source.id}`;
  const [hoverSourceKey, setHoverSourceKey] = useState(sourceKey);
  if (hoverSourceKey !== sourceKey) {
    setHoverSourceKey(sourceKey);
    setHoverLegId(null);
  }

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
          <MapTrifoldIcon size={32} className="animate-pulse text-[var(--color-text-tertiary)]" />
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

  // A leg belongs to the focus when its chain-side anchor node sits in the
  // reachable sub-chain. Single-app view dims the sibling inbound legs (they
  // share one downstream); a batch roll-up isolates the focused sub-chain.
  const focusLegIds = focusNodeIds
    ? new Set(
        geo.legs
          .filter((leg) => focusNodeIds.has(legAnchorNodeId(geo, leg)))
          .map((leg) => leg.id)
      )
    : null;
  const mapFocus =
    focusNodeIds && focusLegIds
      ? { nodeIds: focusNodeIds, legIds: focusLegIds }
      : null;

  return (
    <div
      className="relative h-full overflow-hidden border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]"
      data-testid="carbon-viewer-panel"
    >
      {!anythingPlotted ? (
        <ViewerEmptyState message="No record in this chain carries GPS coordinates yet. Set a position on the facility, suppliers, or application to plot it here." />
      ) : (
        <>
          {/* Keyless mode degrades inside the map: tinted field, markers
              still plotted, a visible "basemap unavailable" note. */}
          <CarbonTransitMap
            geo={geo}
            routeGeometries={routeGeometries}
            popupContent={popupContent}
            railVisible={view === "map"}
            highlight={highlight}
            focus={mapFocus}
            hoverLegId={hoverLegId}
            onMarkerClick={onNodeSelect}
            onLegHover={setHoverLegId}
            onClear={onClearSelection}
          />

          <MapWarningBanner warnings={geo.warnings} />
          <ViewerLegend />

          {view === "map" ? (
            <div className="absolute bottom-16 left-16 right-16 z-10">
              <TransportLegsRail
                legs={geo.legs}
                facility={{ code: geo.facility.code, name: geo.facility.name }}
                focusLegIds={focusLegIds}
                onFocusLeg={(leg) => onNodeSelect(legAnchorNodeId(geo, leg))}
                onClearFocus={onClearSelection}
                onHoverLeg={setHoverLegId}
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
