"use client";

/**
 * The Traceability Map: a map and one panel that holds the chain in two
 * states. The batch Map and the application's Map and Split all render it.
 *
 * At rest it is the stage list: stages with icons and counts, a stage opening
 * with its records one line each while the map frames it and lights its legs.
 * Picking a record (or a marker) starts that record's chain walk: one chain end
 * to end, Back / Next step by step, the camera following and only that chain's
 * legs lit with their km labels. "Whole batch" returns to the list.
 *
 * An application is exactly one chain (`singleChain`): its view opens on that
 * chain's walk and has no stage list to return to.
 *
 * `layout="page"`: the map takes the full width with the panel on the right,
 * stacked under the map below 1024px. `layout="column"`: always stacked, map
 * on top and the panel below, for a narrow column beside the Flow chart.
 * `layout="panel"`: the panel alone, for Split under the Flow chart on a
 * small screen, where a map would leave neither of them room.
 *
 * The walk is controlled (`walk`, `onWalkChange`) so a parent can move it from
 * outside (a Flow pick) and read which records the current step lights.
 */

import { useState } from "react";
import { MapPinLineIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import type { RouteGeometryByRequestId } from "@/data-access/geo-route-cache";
import { useIsMobile } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { LazyTraceMapCanvas } from "./lazy-trace-map-canvas";
import { buildChains, chainStepLighting, resolveWalk, walkTo, type ChainWalk } from "./trace-chains";
import { TraceChainWalk } from "./trace-chain-walk";
import { TraceStageList } from "./trace-stage-list";
import {
  groupDrawnLegs,
  happensAtFacility,
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
const STACKED_PADDING = { top: 48, right: 56, bottom: 32, left: 32 };
/** The Split column: room on the right for the controls and a label beside a marker. */
const COLUMN_PADDING = { top: 48, right: 120, bottom: 40, left: 48 };
/** A warning over the map sits on a paper card, square like the map's other chrome. */
const MAP_NOTICE_CARD_CLASS = "border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[var(--paper)] px-12 py-8";
/** Phone: the app bar (56px) sits above the page. */
const PAGE_HEIGHT_CLASS = "h-[calc(100%-56px)] md:h-full";

export type TraceMapLayout = "page" | "column" | "panel";

export interface TraceMapViewProps {
  model: TraceModel;
  routeGeometries: RouteGeometryByRequestId | undefined;
  /** The chain being walked; null = the stage list. */
  walk: ChainWalk | null;
  onWalkChange: (walk: ChainWalk | null) => void;
  /** "Trace rollback": drill the batch into one application. Absent = no such action. */
  onTrace?: (applicationId: string) => void;
  /** The model is one chain (an application's): no "Whole batch" way back to the stage list. */
  singleChain?: boolean;
  layout?: TraceMapLayout;
}

export function TraceMapView({
  model,
  routeGeometries,
  walk,
  onWalkChange,
  onTrace,
  singleChain = false,
  layout = "page",
}: TraceMapViewProps) {
  const column = layout !== "page";
  const narrowViewport = useIsMobile(SIDE_PANEL_MIN_VIEWPORT_PX);
  const stacked = column || narrowViewport;
  const [stageIndex, setStageIndex] = useState<number | null>(null);
  const chains = buildChains(model);
  const current = resolveWalk(model, chains, walk);
  const chain = current?.chain ?? null;
  const stage = stageIndex === null ? null : model.stages[stageIndex] ?? null;
  const lighting = current
    ? chainStepLighting(model, current.chain, current.step)
    : stage
      ? stageLighting(model, stage)
      : restingLighting(model);
  const frameKey = current ? `chain|${current.chain.end.id}|${current.stepIndex}` : `stage|${stageIndex ?? "rest"}`;
  const hasPlaces =
    model.facility !== null ||
    model.plottable.size > 0 ||
    [...model.records.values()].some((record) => record.position);

  const selectStage = (index: number | null) => {
    setStageIndex(index);
    onWalkChange(null);
  };
  const goTo = (recordId: string) => {
    const next = walkTo(model, chains, walk, recordId);
    if (next) onWalkChange(next);
  };
  const onMarker = (nodeId: string) => {
    if (nodeId.startsWith("facility:")) {
      if (current) {
        // The walk moves to the chain's first step at the facility (its runs).
        const atFacility = current.steps.findIndex(
          (step) => happensAtFacility(step.kind) && step.records.every((record) => !record.position),
        );
        if (atFacility >= 0) onWalkChange({ endId: current.chain.end.id, stepIndex: atFacility, openRecordId: null });
        return;
      }
      const first = model.stages.findIndex((candidate) => candidate.records.every((record) => !record.position));
      if (first >= 0) selectStage(first);
      return;
    }
    goTo(nodeId);
  };
  const onTraceRecord = onTrace
    ? (recordId: string) => {
        if (model.records.get(recordId)?.kind === "application") onTrace(recordId.slice(recordId.indexOf(":") + 1));
      }
    : undefined;

  const mapPane =
    layout === "panel" ? null : (
      <div className={cn("relative h-[42%] shrink-0", !column && "lg:absolute lg:inset-0 lg:h-auto")}>
        {hasPlaces ? (
          <LazyTraceMapCanvas
            geo={model.geo}
            legs={groupDrawnLegs(model.plottable.values())}
            routeGeometries={routeGeometries}
            lighting={lighting}
            frameKey={frameKey}
            padding={column ? COLUMN_PADDING : stacked ? STACKED_PADDING : DESKTOP_PADDING}
            onMarkerClick={onMarker}
            onBackgroundClick={chain ? undefined : () => selectStage(null)}
            nearestMarkerTaps={narrowViewport}
            controlsClassName={cn("left-auto top-auto bottom-32 right-16", !column && CONTROLS_RIGHT_CLASS, PHONE_CONTROL_SIZE_CLASS)}
          />
        ) : (
          <div className={cn("flex h-full items-center justify-center bg-[var(--color-background-light)] px-16", !column && EMPTY_STATE_RIGHT_PADDING_CLASS)}>
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
        {model.geo.warnings.length > 0 ? (
          <div className={cn("absolute left-16 top-16 z-10 flex max-w-[calc(100%-96px)] flex-col gap-8", !column && "lg:max-w-[320px]")}>
            {model.geo.warnings.map((warning) => (
              <Notice key={warning} tone="warning" className={MAP_NOTICE_CARD_CLASS}>{warning}</Notice>
            ))}
          </div>
        ) : null}
      </div>
    );

  return (
    <div className={cn("flex flex-col", column ? "h-full" : cn("lg:relative lg:block", PAGE_HEIGHT_CLASS))}>
      {mapPane}

      <aside
        className={cn(
          "flex min-h-0 flex-1 flex-col bg-[var(--paper)]",
          layout !== "panel" && "border-t-[1.5px] border-[var(--ink)]",
          !column && "lg:absolute lg:inset-y-0 lg:right-0 lg:border-l-[1.5px] lg:border-t-0",
        )}
        style={{ width: stacked ? undefined : PANEL_WIDTH_PX }}
        aria-label={chain ? `Chain to ${chain.end.shortCode}` : "Custody stages"}
      >
        {/* No map to carry the payload's warnings: they head the panel instead. */}
        {layout === "panel" && model.geo.warnings.length > 0 ? (
          <div className="flex shrink-0 flex-col gap-8 px-16 pt-12">
            {model.geo.warnings.map((warning) => (
              <Notice key={warning} tone="warning">{warning}</Notice>
            ))}
          </div>
        ) : null}
        {current && walk ? (
          <TraceChainWalk
            model={model}
            chain={current.chain}
            steps={current.steps}
            stepIndex={current.stepIndex}
            openRecordId={walk.openRecordId}
            onStep={(index) => onWalkChange({ endId: current.chain.end.id, stepIndex: index, openRecordId: null })}
            onOpenRecord={(recordId) => onWalkChange({ ...walk, openRecordId: recordId })}
            onLeave={singleChain ? undefined : () => onWalkChange(null)}
            onTrace={onTraceRecord}
          />
        ) : (
          <TraceStageList
            model={model}
            stageIndex={stageIndex}
            onSelectStage={selectStage}
            onPickRecord={goTo}
          />
        )}
      </aside>
    </div>
  );
}
