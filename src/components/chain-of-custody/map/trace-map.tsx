"use client";

/**
 * Entry of the batch Traceability Map: loads the batch's geo payload and road
 * lines once, builds the model from the batch graph the page already holds,
 * and renders the map view.
 */

import type { Edge, Node } from "@xyflow/react";
import { MapTrifoldIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { ROUTE_GEOMETRY_MAX_LEGS } from "@/config/geo";
import { useCreditBatchChainGeo } from "@/hooks/use-chain-of-custody";
import { useRouteGeometries } from "@/hooks/use-geo";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { lineageIdsByApplication } from "./trace-lineage";
import { buildTraceModel } from "./trace-model";
import { TraceMapView } from "./trace-map-view";
import { resolveLegEndpoints } from "./viewer-utils";

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
  const plottable = geo ? resolveLegEndpoints(geo).plottable : [];
  const { data: routeGeometries } = useRouteGeometries(
    plottable.length > 0
      ? { legs: plottable.slice(0, ROUTE_GEOMETRY_MAX_LEGS).map((entry) => ({ id: entry.leg.id, origin: entry.origin, destination: entry.destination })) }
      : null,
  );
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <MapTrifoldIcon size={32} className="animate-pulse text-[var(--color-text-tertiary)]" />
      </div>
    );
  }
  if (isError || !geo) {
    return (
      <div className="flex h-full items-center justify-center px-16">
        <div className="w-full max-w-[520px]">
          <EmptyState
            icon={<WarningCircleIcon size={40} weight="thin" />}
            title="The map could not be loaded"
            description={error?.message || "Refresh the page and try again."}
            padding="md"
          />
        </div>
      </div>
    );
  }
  return <TraceMapView model={buildTraceModel(nodes, edges, geo, lineageIdsByApplication(lineages))} routeGeometries={routeGeometries} onTrace={onTrace} />;
}
