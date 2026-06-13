"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import { EDGE_COLOR_FALLBACK, EDGE_LABEL_MIN_ZOOM } from "./chain-constants";

/** Per-edge flags: build-time flow data + render-time hover/label state. */
export interface ChainEdgeData {
  /** Mass flow vs. the reactor's mass-less equipment link. */
  variant?: "flow" | "equipment";
  /** Source-accent stroke color (CSS var). */
  color?: string;
  /** Pre-formatted mass string ("2,125 kg"). */
  kgLabel?: string | null;
  /** Pre-formatted branch-share string ("57%"). */
  pctLabel?: string | null;
  /** Which label the kg/% toggle is showing (injected at render). */
  labelMode?: "kg" | "pct";
  /** A node outside the hovered card's lineage — fade back. */
  dimmed?: boolean;
  /** On the hovered card's lineage path — read as the highlighted route. */
  emphasized?: boolean;
  [key: string]: unknown;
}

const FLOW_CASING_WIDTH = 6;
const EQUIPMENT_CASING_WIDTH = 4;
const LINE_WIDTH = 1.5;
const EQUIPMENT_LINE_WIDTH = 1.25;
const EMPHASIZED_LINE_WIDTH = 2.5;
const DIMMED_OPACITY = 0.12;
const EQUIPMENT_OPACITY = 0.5;
const EQUIPMENT_DASHARRAY = "5 5";

/**
 * Smoothstep edge with a paper casing so crossing lines stay separable on the
 * tinted canvas. The stroke follows the source node's accent group (mass
 * traceable to origin); the reactor's equipment link draws quiet and dashed.
 * The label (mass or branch-share, per the toggle) is a mono chip that
 * declutters away below EDGE_LABEL_MIN_ZOOM.
 */
export function ChainEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const labelVisible = useStore(
    (state) => state.transform[2] >= EDGE_LABEL_MIN_ZOOM
  );
  const {
    variant = "flow",
    color = EDGE_COLOR_FALLBACK,
    kgLabel,
    pctLabel,
    labelMode = "kg",
    dimmed,
    emphasized,
  } = (data ?? {}) as ChainEdgeData;

  const isEquipment = variant === "equipment";
  const labelText = labelMode === "pct" ? pctLabel : kgLabel;
  const strokeWidth = isEquipment
    ? EQUIPMENT_LINE_WIDTH
    : emphasized
      ? EMPHASIZED_LINE_WIDTH
      : LINE_WIDTH;
  const baseOpacity = dimmed ? DIMMED_OPACITY : isEquipment ? EQUIPMENT_OPACITY : 1;

  return (
    <>
      {/* Paper casing — lifts the line off whatever it crosses. */}
      <path
        d={path}
        fill="none"
        stroke="var(--paper)"
        strokeWidth={isEquipment ? EQUIPMENT_CASING_WIDTH : FLOW_CASING_WIDTH}
        style={{ opacity: dimmed ? 0 : 0.9, transition: "opacity 150ms" }}
      />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth,
          strokeDasharray: isEquipment ? EQUIPMENT_DASHARRAY : undefined,
          opacity: baseOpacity,
          transition: "opacity 150ms, stroke-width 150ms",
        }}
      />
      {labelText && labelVisible && !isEquipment ? (
        <EdgeLabelRenderer>
          <div
            className="absolute border border-[var(--clr-dark-purple-20)] bg-[var(--paper)] px-6 py-2 font-mono text-[10px] font-medium tracking-[0.04em] text-[var(--clr-dark-purple)] transition-opacity duration-150"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: dimmed ? DIMMED_OPACITY : 1,
            }}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
