"use client";

/**
 * The application-anchored Traceability Map and Split. An application is
 * exactly one chain, so both open on that chain's walk (its first step) with
 * the same view the batch Map walks: no stage list, no "Whole batch", no
 * "Trace rollback" (the page already is the application).
 *
 * Split puts the Flow chart beside a narrow column of map over walk. The two
 * stay in step: a Flow pick moves the walk to that record's step with the
 * record open, and the Flow lights the records of the current step. Below
 * 1280px the Flow stacks above the walk alone: a map squeezed under both
 * would leave none of the three room. On a phone, where even the Flow over
 * the walk is too short to read, Split shows the Map.
 */

/** Split's two columns need the `xl` breakpoint; below it they stack. */
const SPLIT_COLUMNS_MIN_VIEWPORT_PX = 1280;

import { useState, type ReactNode } from "react";
import type { Edge, Node } from "@xyflow/react";
import { useChainOfCustodyGeo } from "@/hooks/use-chain-of-custody";
import { useIsMobile } from "@/hooks/use-media-query";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { applicationNodeId } from "@/lib/chain-of-custody/lineage-mass-totals";
import { lineageIdsByApplication } from "./trace-lineage";
import { buildChains, resolveWalk, walkTo, type ChainWalk } from "./trace-chains";
import { buildTraceModel } from "./trace-model";
import { TraceMapPending, useTraceRouteGeometries } from "./trace-map";
import { TraceMapView } from "./trace-map-view";

export interface ApplicationTraceMapProps {
  applicationId: string;
  /** The application's lineage the page already holds: the chain's exact records. */
  chainData: ChainOfCustodyData | undefined;
  nodes: Node[];
  edges: Edge[];
  /**
   * Split: the Flow chart beside the map and walk. It receives the records the
   * current step lights and a pick that moves the walk to a record.
   */
  renderFlow?: (focusNodeIds: Set<string> | null, onPick: (nodeId: string) => void) => ReactNode;
}

export function ApplicationTraceMap({ applicationId, chainData, nodes, edges, renderFlow }: ApplicationTraceMapProps) {
  const { data: geo, isLoading, error } = useChainOfCustodyGeo(applicationId);
  const routeGeometries = useTraceRouteGeometries(geo);
  const splitStacked = useIsMobile(SPLIT_COLUMNS_MIN_VIEWPORT_PX);
  const phone = useIsMobile();
  const split = Boolean(renderFlow) && !phone;
  const [walk, setWalk] = useState<ChainWalk | null>({
    endId: applicationNodeId(applicationId),
    stepIndex: 0,
    openRecordId: null,
  });
  const model = geo ? buildTraceModel(nodes, edges, geo, lineageIdsByApplication(chainData ? [chainData] : [])) : null;
  const view = model ? (
    <TraceMapView
      model={model}
      routeGeometries={routeGeometries}
      walk={walk}
      onWalkChange={setWalk}
      singleChain
      layout={!split ? "page" : splitStacked ? "panel" : "column"}
    />
  ) : (
    <TraceMapPending failed={!isLoading} message={error?.message} />
  );
  if (!split || !renderFlow) return view;

  const step = model ? resolveWalk(model, [], walk)?.step ?? null : null;
  const focusNodeIds = step ? new Set(step.records.map((record) => record.id)) : null;
  const pick = (nodeId: string) => {
    const next = model ? walkTo(model, buildChains(model), walk, nodeId) : null;
    if (next) setWalk(next);
  };
  return (
    <div className="grid h-full grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] xl:grid-rows-1">
      <div className="relative min-h-0 overflow-hidden">{renderFlow(focusNodeIds, pick)}</div>
      <div className="min-h-0 border-t-[1.5px] border-[var(--ink)] xl:border-l-[1.5px] xl:border-t-0">{view}</div>
    </div>
  );
}
