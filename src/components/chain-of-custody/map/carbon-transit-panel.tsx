"use client";

/**
 * Carbon Transit panel — "Geography: carbon in transit". Owns the geo data
 * fetch, route-geometry fetch, and the React overlays (stage rail, legend,
 * rails, warning banner, empty state, docked record panel); the MapLibre half
 * is dynamically imported so maplibre-gl stays out of the route bundle.
 *
 * Two layouts off one fetch: `view="map"` is the full surface — the custody
 * stages rail beside the map, with a record's details docking over the map's
 * left edge; `view="split"` is the compact half beside the DAG, which keeps the
 * legend and the collapsed not-geolocated chip box.
 *
 * Graceful degradation (plan decision 5): no NEXT_PUBLIC_MAPTILER_KEY → the
 * map still runs on a blank style over a tinted field (markers/legs/chips
 * plotted, "basemap unavailable" note); no routing key → legs draw as dashed
 * arcs (route geometries resolve to null).
 */

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/ssr";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { ROUTE_GEOMETRY_MAX_LEGS } from "@/config/geo";
import {
  useChainOfCustodyGeo,
  useCreditBatchChainGeo,
} from "@/hooks/use-chain-of-custody";
import { useRouteGeometries } from "@/hooks/use-geo";
import { LINEAGE_NODE_STYLES } from "../chain-constants";
import type { ChainNodeSheetNode } from "../chain-node-sheet";
import { buildLineageNodes } from "../use-chain-graph";
import type { PopupContentByNodeId } from "./carbon-transit-map";
import { CustodyStagesRail } from "./custody-stages-rail";
import { RecordDetailPanel } from "./record-detail-panel";
import {
  MapWarningBanner,
  NotGeolocatedChips,
  ViewerEmptyState,
  ViewerLegend,
} from "./viewer-rails";
import { legAnchorNodeId, resolveLegEndpoints } from "./viewer-utils";

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

/**
 * Map controls (zoom / fit / satellite), pushed out of the top-left corner the
 * docked record panel owns in map view. `bottom-32` clears the maplibre
 * attribution strip.
 */
const MAP_VIEW_CONTROLS_CLASS = "left-auto top-auto right-16 bottom-32";

/** The panel's outer frame — the same box in both layouts. */
const PANEL_FRAME_CLASS =
  "h-full overflow-hidden border-[1.5px] border-[var(--clr-dark-purple-40)] bg-[var(--paper)]";

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
  /**
   * Map view only: a stage-rail row click focuses the sub-chain AND opens the
   * record in the docked detail panel. Absent = rows fall back to onNodeSelect.
   */
  onNodeDetails?: (nodeId: string) => void;
  /** Map view only: the docked panel's payload; null = closed (page-owned). */
  detailNode?: ChainNodeSheetNode | null;
  /** Map view only: closes the docked panel and releases the shared focus. */
  onDetailClose?: () => void;
  /** Map view only: "Trace rollback" — drills into the member application. */
  onDetailTrace?: (nodeId: string) => void;
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
    // Blank/whitespace-only names (legacy/manual data — the schema now trims
    // on every write) fall back to the always-present code (#378).
    details: [{ label: "Name", value: facility.name?.trim() || facility.code }],
  };
  return content;
}

export function CarbonTransitPanel({
  source,
  lineages,
  view,
  highlight,
  focusNodeIds,
  onNodeSelect,
  onClearSelection,
  onNodeDetails,
  detailNode,
  onDetailClose,
  onDetailTrace,
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
          {error?.message || "The traceability map data could not be loaded. Refresh the page and try again."}
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

  if (!anythingPlotted) {
    return (
      <div
        className={`relative ${PANEL_FRAME_CLASS}`}
        data-testid="carbon-viewer-panel"
      >
        <ViewerEmptyState message="No record in this chain carries GPS coordinates yet. Set a position on the facility, suppliers, or application to plot it here." />
      </div>
    );
  }

  // Keyless mode degrades inside the map: tinted field, markers still plotted,
  // a visible "basemap unavailable" note.
  const mapElement = (
    <CarbonTransitMap
      geo={geo}
      routeGeometries={routeGeometries}
      popupContent={popupContent}
      highlight={highlight}
      focus={mapFocus}
      hoverLegId={hoverLegId}
      onMarkerClick={onNodeSelect}
      onLegHover={setHoverLegId}
      onClear={onClearSelection}
      controlsClassName={view === "map" ? MAP_VIEW_CONTROLS_CLASS : undefined}
    />
  );

  if (view === "map") {
    // A rail row goes one step further than a marker click: it opens the record.
    const openNode = onNodeDetails ?? onNodeSelect;
    // Extra context for the docked record panel: the leg this record anchors
    // (so the panel can draw the From→To thread and the transport numbers) and
    // its position-resolved geo node. Both are absent for records off the
    // transport path, and the panel simply drops those sections.
    const detailLeg =
      geo.legs.find((leg) => legAnchorNodeId(geo, leg) === detailNode?.id) ?? null;
    const detailGeoNode =
      geo.nodes.find((node) => node.id === detailNode?.id) ?? null;

    return (
      <div
        className={`flex ${PANEL_FRAME_CLASS}`}
        data-testid="carbon-viewer-panel"
      >
        {/* Keyed on the plotted source: a batch/application change remounts the
            rail, collapsing both sides and returning the scroll to the top,
            which matches the map refitting to the new chain. */}
        <CustodyStagesRail
          key={sourceKey}
          geo={geo}
          focusNodeIds={focusNodeIds}
          focusLegIds={focusLegIds}
          hoverLegId={hoverLegId}
          onHoverLeg={setHoverLegId}
          onSelectNode={openNode}
        />
        <div className="relative min-w-0 flex-1">
          {mapElement}
          <MapWarningBanner warnings={geo.warnings} />
          {detailNode && onDetailClose ? (
            <RecordDetailPanel
              node={detailNode}
              onClose={onDetailClose}
              onTrace={onDetailTrace}
              leg={detailLeg}
              geoNode={detailGeoNode}
              facilityName={geo.facility.code}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative ${PANEL_FRAME_CLASS}`}
      data-testid="carbon-viewer-panel"
    >
      {mapElement}
      <MapWarningBanner warnings={geo.warnings} />
      <ViewerLegend />
      <NotGeolocatedChips nodes={ungeolocated} onSelectNode={onNodeSelect} />
    </div>
  );
}
