"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import { EDGE_LABEL_MIN_ZOOM } from "./chain-constants";

/** Hover-focus flags derived per edge by the graph (lineage emphasis). */
export interface ChainEdgeData {
  /** A node outside the hovered card's lineage — fade back. */
  dimmed?: boolean;
  /** On the hovered card's lineage path — read as the highlighted route. */
  emphasized?: boolean;
  [key: string]: unknown;
}

const CASING_WIDTH = 6;
const LINE_WIDTH = 1.5;
const EMPHASIZED_LINE_WIDTH = 2.5;
const DIMMED_OPACITY = 0.12;

/**
 * Smoothstep edge with a paper casing so crossing lines stay separable on
 * the tinted canvas, plus the mass label as a mono chip that declutters
 * (hides) below EDGE_LABEL_MIN_ZOOM.
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
  label,
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
  const { dimmed, emphasized } = (data ?? {}) as ChainEdgeData;

  return (
    <>
      {/* Paper casing — lifts the line off whatever it crosses. */}
      <path
        d={path}
        fill="none"
        stroke="var(--paper)"
        strokeWidth={CASING_WIDTH}
        style={{ opacity: dimmed ? 0 : 0.9, transition: "opacity 150ms" }}
      />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: "var(--clr-purple)",
          strokeWidth: emphasized ? EMPHASIZED_LINE_WIDTH : LINE_WIDTH,
          opacity: dimmed ? DIMMED_OPACITY : 1,
          transition: "opacity 150ms, stroke-width 150ms",
        }}
      />
      {label && labelVisible ? (
        <EdgeLabelRenderer>
          <div
            className="absolute border border-[var(--clr-dark-purple-20)] bg-[var(--paper)] px-6 py-2 font-mono text-[10px] font-medium tracking-[0.04em] text-[var(--clr-dark-purple)] transition-opacity duration-150"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: dimmed ? DIMMED_OPACITY : 1,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
