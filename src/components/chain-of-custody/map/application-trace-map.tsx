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
 * 1280px (phones included) the Flow stacks above the walk panel alone, a map
 * squeezed under both would leave none of the three room, and the page
 * scrolls: the Flow keeps a fixed share of the viewport, the walk runs on
 * below it.
 */

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

/** Split's two columns need the `xl` breakpoint; below it they stack. */
const SPLIT_COLUMNS_MIN_VIEWPORT_PX = 1280;
/** Stacked Split: the Flow's share of the viewport height (svh), tall enough to pan and pick in. */
const STACKED_FLOW_HEIGHT_SVH = 45;

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
      layout={!renderFlow ? "page" : splitStacked ? "panel" : "column"}
    />
  ) : (
    <TraceMapPending failed={!isLoading} message={error?.message} />
  );
  if (!renderFlow) return view;

  const step = model ? resolveWalk(model, [], walk)?.step ?? null : null;
  const focusNodeIds = step ? new Set(step.records.map((record) => record.id)) : null;
  const pick = (nodeId: string) => {
    const next = model ? walkTo(model, buildChains(model), walk, nodeId) : null;
    if (next) setWalk(next);
  };
  const flow = renderFlow(focusNodeIds, pick);
  if (splitStacked) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="relative overflow-hidden" style={{ height: `${STACKED_FLOW_HEIGHT_SVH}svh` }}>{flow}</div>
        <div className="border-t-[1.5px] border-[var(--ink)]" style={{ minHeight: `${100 - STACKED_FLOW_HEIGHT_SVH}svh` }}>
          {view}
        </div>
      </div>
    );
  }
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="relative min-h-0 overflow-hidden">{flow}</div>
      <div className="min-h-0 border-l-[1.5px] border-[var(--ink)]">{view}</div>
    </div>
  );
}
