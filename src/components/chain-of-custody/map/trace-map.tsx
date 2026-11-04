"use client";

/**
 * Entry of the batch Traceability Map: loads the batch's geo payload and road
 * lines once, builds the model from the batch graph the page already holds,
 * and renders the map view at rest on the stage list.
 */

import { useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { MapTrifoldIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { ROUTE_GEOMETRY_MAX_LEGS } from "@/config/geo";
import { useCreditBatchChainGeo } from "@/hooks/use-chain-of-custody";
import { useRouteGeometries } from "@/hooks/use-geo";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ChainOfCustodyGeoData } from "@/data-access/chain-of-custody-geo";
import { lineageIdsByApplication } from "./trace-lineage";
import type { ChainWalk } from "./trace-chains";
import { buildTraceModel } from "./trace-model";
import { TraceMapView } from "./trace-map-view";
import { resolveLegEndpoints } from "./viewer-utils";

/** Road lines for the payload's plottable legs, fetched once per payload. */
export function useTraceRouteGeometries(geo: ChainOfCustodyGeoData | undefined) {
  const plottable = geo ? resolveLegEndpoints(geo).plottable : [];
  const { data } = useRouteGeometries(
    plottable.length > 0
      ? { legs: plottable.slice(0, ROUTE_GEOMETRY_MAX_LEGS).map((entry) => ({ id: entry.leg.id, origin: entry.origin, destination: entry.destination })) }
      : null,
  );
  return data;
}

/** The map while its geo payload loads, or when it failed to. */
export function TraceMapPending({ failed, message }: { failed: boolean; message?: string }) {
  if (!failed) {
    return (
      <div className="flex h-full items-center justify-center">
        <MapTrifoldIcon size={32} className="animate-pulse text-[var(--color-text-tertiary)]" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center px-16">
      <div className="w-full max-w-[520px]">
        <EmptyState
          icon={<WarningCircleIcon size={40} weight="thin" />}
          title="The map could not be loaded"
          description={message || "Refresh the page and try again."}
          padding="md"
        />
      </div>
    </div>
  );
}

export interface TraceMapProps {
  batchId: string;
  runId: string | null;
  nodes: Node[];
  edges: Edge[];
  /** The batch's application lineages: each application's own chain. */
  lineages: ChainOfCustodyData[];
  /** "Trace rollback": drill the batch into one application. */
  onTrace: (applicationId: string) => void;
}

export function TraceMap({ batchId, runId, nodes, edges, lineages, onTrace }: TraceMapProps) {
  const { data: geo, isLoading, isError, error } = useCreditBatchChainGeo(batchId, runId);
  const routeGeometries = useTraceRouteGeometries(geo);
  const [walk, setWalk] = useState<ChainWalk | null>(null);
  if (isLoading || isError || !geo) return <TraceMapPending failed={!isLoading} message={error?.message} />;
  return (
    <TraceMapView
      model={buildTraceModel(nodes, edges, geo, lineageIdsByApplication(lineages))}
      routeGeometries={routeGeometries}
      walk={walk}
      onWalkChange={setWalk}
      onTrace={onTrace}
    />
  );
}
