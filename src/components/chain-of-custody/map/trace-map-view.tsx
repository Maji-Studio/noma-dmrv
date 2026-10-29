"use client";

/**
 * The batch Traceability Map. The map takes the full width; one panel on the
 * right holds the batch in two states.
 *
 * At rest it is the stage list: stages with icons and counts, a stage opening
 * with its records one line each while the map frames it and lights its legs.
 * Picking a record (or a marker) starts that record's chain walk: one chain end
 * to end, Back / Next record by record, the camera following and only that
 * chain's legs lit with their km labels. "Whole batch" returns to the list.
 *
 * Phone: map on top, the same two states in the panel below it.
 */

import { useState } from "react";
import { MapPinLineIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import type { RouteGeometryByRequestId } from "@/data-access/geo-route-cache";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { MapWarningBanner } from "./viewer-rails";
import { LazyTraceMapCanvas } from "./lazy-trace-map-canvas";
import { buildChains, chainFor, chainStepLighting, chainTo } from "./trace-chains";
import { TraceChainWalk } from "./trace-chain-walk";
import { TraceStageList } from "./trace-stage-list";
import {
  groupDrawnLegs,
  restingLighting,
  stageLighting,
  type TraceModel,
} from "./trace-model";

const PANEL_WIDTH_PX = 400;
/**
 * Below this viewport width (the `lg` breakpoint) the panel stacks under the
 * map: with the 240px sidebar, a 400px side panel would leave the map under
 * 400px wide, and the camera padding no room at all.
 */
const SIDE_PANEL_MIN_VIEWPORT_PX = 1024;
/**
 * The desktop panel plus a 16px gutter: where the map controls and the empty
 * state stop. Tailwind needs the literal, so the classes below spell it
 * `416px`; keep them equal to PANEL_WIDTH_PX + 16.
 */
const PANEL_CLEARANCE_PX = PANEL_WIDTH_PX + 16;
const CONTROLS_RIGHT_CLASS = "lg:right-[416px]";
/** Phone: every map control is a 44px target (the shared stack is 36px). */
const PHONE_CONTROL_SIZE_CLASS = "max-lg:[&_button]:h-44 max-lg:[&_button]:w-44";
const EMPTY_STATE_RIGHT_PADDING_CLASS = "lg:pr-[416px]";
/** The map frames inside the room the panel leaves: top bar, panel, controls, gutter. */
const DESKTOP_PADDING = { top: 72, right: PANEL_CLEARANCE_PX + 144, bottom: 56, left: 64 };
const PHONE_PADDING = { top: 48, right: 56, bottom: 32, left: 32 };
/**
 * Phone: the app bar (56px) sits above a page sized to the full viewport
 * height, so the map fills only what is left on screen. Desktop: the canvas.
 */
/** Phone: the app bar (56px) sits above the page. */
const ROOT_HEIGHT_CLASS = "h-[calc(100%-56px)] md:h-full";

interface Walk {
  endId: string;
  stepIndex: number;
}

export function TraceMapView({
  model,
  routeGeometries,
  onTrace,
}: {
  model: TraceModel;
  routeGeometries: RouteGeometryByRequestId | undefined;
  /** "Trace rollback": drill the batch into one application. */
  onTrace: (applicationId: string) => void;
}) {
  const stacked = useIsMobile(SIDE_PANEL_MIN_VIEWPORT_PX);
  const [stageIndex, setStageIndex] = useState<number | null>(null);
  const [walk, setWalk] = useState<Walk | null>(null);
  const chains = buildChains(model);
  const chain = walk ? chains.find((candidate) => candidate.end.id === walk.endId) ?? chainTo(model, walk.endId) : null;
  const step = chain && walk ? chain.steps[Math.min(walk.stepIndex, chain.steps.length - 1)] ?? null : null;
  const stage = stageIndex === null ? null : model.stages[stageIndex] ?? null;
  const lighting =
    chain && step
      ? chainStepLighting(model, chain, step)
      : stage
        ? stageLighting(model, stage)
        : restingLighting(model);
  const frameKey = chain && step ? `chain|${chain.end.id}|${step.id}` : `stage|${stageIndex ?? "rest"}`;
  const hasPlaces =
    model.facility !== null ||
    model.plottable.size > 0 ||
    [...model.records.values()].some((record) => record.position);

  const selectStage = (index: number | null) => {
    setStageIndex(index);
    setWalk(null);
  };
  const startWalk = (recordId: string) => {
    const next = chainFor(model, chains, recordId);
    if (!next) return;
    // A chain end starts at the supplier and walks toward the field; any other record starts at itself.
    const at = next.end.id === recordId ? 0 : next.steps.findIndex((record) => record.id === recordId);
    setWalk({ endId: next.end.id, stepIndex: Math.max(0, at) });
  };
  const onMarker = (nodeId: string) => {
    if (nodeId.startsWith("facility:")) {
      if (chain) return;
      const first = model.stages.findIndex((candidate) => candidate.records.every((record) => !record.position));
      if (first >= 0) selectStage(first);
      return;
    }
    const inChain = chain?.steps.findIndex((record) => record.id === nodeId) ?? -1;
    if (chain && inChain >= 0) setWalk({ endId: chain.end.id, stepIndex: inChain });
    else startWalk(nodeId);
  };
  const onTraceRecord = (recordId: string) => {
    if (model.records.get(recordId)?.kind === "application") onTrace(recordId.slice(recordId.indexOf(":") + 1));
  };

  return (
    <div className={cn("flex flex-col lg:relative lg:block", ROOT_HEIGHT_CLASS)}>
      <div className="relative h-[42%] shrink-0 lg:absolute lg:inset-0 lg:h-auto">
        {hasPlaces ? (
          <LazyTraceMapCanvas
            geo={model.geo}
            legs={groupDrawnLegs(model.plottable.values())}
            routeGeometries={routeGeometries}
            lighting={lighting}
            frameKey={frameKey}
            padding={stacked ? PHONE_PADDING : DESKTOP_PADDING}
            onMarkerClick={onMarker}
            onBackgroundClick={chain ? undefined : () => selectStage(null)}
            controlsClassName={cn("left-auto top-auto bottom-32 right-16", CONTROLS_RIGHT_CLASS, PHONE_CONTROL_SIZE_CLASS)}
          />
        ) : (
          <div className={cn("flex h-full items-center justify-center bg-[var(--color-background-light)] px-16", EMPTY_STATE_RIGHT_PADDING_CLASS)}>
            <div className="w-full max-w-[520px]">
              <EmptyState
                icon={<MapPinLineIcon size={40} weight="thin" />}
                title="Nothing to place on the map yet"
                description="Set a position on the facility, a supplier location or a field to see it here."
                padding="md"
              />
            </div>
          </div>
        )}
        {/* Left edge, clear of the panel and the controls on the right. */}
        <MapWarningBanner warnings={model.geo.warnings} className="left-16 top-16 max-w-[calc(100%-96px)] lg:max-w-[320px]" />
      </div>

      <aside
        className="flex min-h-0 flex-1 flex-col border-t-[1.5px] border-[var(--ink)] bg-[var(--paper)] lg:absolute lg:inset-y-0 lg:right-0 lg:border-l-[1.5px] lg:border-t-0"
        style={{ width: stacked ? undefined : PANEL_WIDTH_PX }}
        aria-label={chain ? `Chain to ${chain.end.shortCode}` : "Custody stages"}
      >
        {chain && walk && step ? (
          <TraceChainWalk
            model={model}
            chain={chain}
            stepIndex={chain.steps.indexOf(step)}
            onStep={(index) => setWalk({ endId: chain.end.id, stepIndex: index })}
            onLeave={() => setWalk(null)}
            onTrace={onTraceRecord}
          />
        ) : (
          <TraceStageList
            model={model}
            stageIndex={stageIndex}
            onSelectStage={selectStage}
            onPickRecord={startWalk}
          />
        )}
      </aside>
    </div>
  );
}
