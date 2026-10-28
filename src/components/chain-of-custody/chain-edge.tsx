"use client";

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { FLOW_COLUMN_PITCH, FLOW_NODE_SIZE } from "./chain-constants";
import type { ChainEdgeBuildData } from "./chain-edge-mass";

/** Per-edge flags: build-time flow data + render-time lighting and label mode. */
export interface ChainEdgeData extends Partial<ChainEdgeBuildData> {
  /** Which label the kg/% toggle is showing (injected at render). */
  labelMode?: "kg" | "pct";
  /** Outside the focused record's lineage: fade back. */
  dimmed?: boolean;
  /** On the focused record's lineage: drawn dark, with its mass label. */
  lit?: boolean;
  [key: string]: unknown;
}

const REST_STROKE = "var(--clr-dark-purple-30)";
const EQUIPMENT_STROKE = "var(--clr-dark-purple-20)";
const LIT_STROKE = "var(--ink)";
const REST_WIDTH = 1;
const LIT_WIDTH = 2;
const DIMMED_OPACITY = 0.12;
const INFERRED_DASHARRAY = "4 4";
/** formatWetDryMass joins wet and dry with this. */
const LABEL_PART_SEPARATOR = " · ";

/** Bisection steps when finding the curve's height at a given x. */
const LABEL_SEARCH_STEPS = 24;
/**
 * The label sits in the gap right after the source column, so an edge that
 * skips a column (a product straight to its delivery past the orders) never
 * puts its chip on the skipped column's records.
 */
const LABEL_LEAD_X = (FLOW_COLUMN_PITCH - FLOW_NODE_SIZE) / 2;

/**
 * Cubic bezier between two columns, like the buyer journey graph: it leaves
 * the source square level, bends at the midpoint, and arrives level.
 */
export function flowEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number) {
  const midX = (sourceX + targetX) / 2;
  const point = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * u * sourceX + 3 * u * t * midX + t * t * t * targetX,
      y: (u * u * u + 3 * u * u * t) * sourceY + (3 * u * t * t + t * t * t) * targetY,
    };
  };
  // x grows monotonically along the curve, so bisect for the label's x.
  const labelAt = Math.min(sourceX + LABEL_LEAD_X, midX);
  let low = 0;
  let high = 1;
  for (let step = 0; step < LABEL_SEARCH_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (point(mid).x < labelAt) low = mid;
    else high = mid;
  }
  const label = point((low + high) / 2);
  return {
    path: `M${sourceX},${sourceY} C${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`,
    labelX: label.x,
    labelY: label.y,
  };
}

/**
 * A quiet line at rest. Dashed when the link is inferred (which intakes a run
 * drew follows from the bin's draw order). Only a lit edge (on the focused
 * record's lineage) carries the mass label, in kg or % per the toggle.
 */
export function ChainEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const { path, labelX, labelY } = flowEdgePath(sourceX, sourceY, targetX, targetY);
  const {
    variant = "flow",
    inferred,
    kgLabel,
    pctLabel,
    labelMode = "kg",
    dimmed,
    lit,
  } = (data ?? {}) as ChainEdgeData;
  const isEquipment = variant === "equipment";
  const labelText = lit && !isEquipment ? (labelMode === "pct" ? pctLabel : kgLabel) : null;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: lit ? LIT_STROKE : isEquipment ? EQUIPMENT_STROKE : REST_STROKE,
          strokeWidth: lit ? LIT_WIDTH : REST_WIDTH,
          strokeDasharray: inferred ? INFERRED_DASHARRAY : undefined,
          opacity: dimmed ? DIMMED_OPACITY : 1,
          transition: "opacity 150ms, stroke 150ms",
        }}
      />
      {labelText ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute border border-[var(--ink)] bg-[var(--paper)] px-6 py-2 font-mono text-[10px] font-medium leading-[1.4] tracking-[0.04em] text-[var(--ink)]"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {/* A wet and dry pair stacks, so the chip fits between columns. */}
            {labelText.split(LABEL_PART_SEPARATOR).map((part) => (
              <span key={part} className="block whitespace-nowrap">
                {part}
              </span>
            ))}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
