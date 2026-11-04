"use client";

import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { FLOW_INFERRED_DASHARRAY } from "./chain-constants";
import type { ChainEdgeBuildData } from "./chain-edge-mass";
import { flowEdgePath, LABEL_PART_SEPARATOR } from "./flow-edge-geometry";

/** Per-edge flags: build-time flow data + render-time lighting and label mode. */
export interface ChainEdgeData extends Partial<ChainEdgeBuildData> {
  /** Outside the focused record's lineage: fade back. */
  dimmed?: boolean;
  /** On the focused record's lineage: drawn dark, with its mass label. */
  lit?: boolean;
  /**
   * The chip: its text (kg or %, per the toggle) and centre, chosen and
   * placed across all lit edges (flow-edge-geometry.ts). None at rest.
   */
  labelText?: string | null;
  labelX?: number;
  labelY?: number;
  [key: string]: unknown;
}

const REST_STROKE = "var(--clr-dark-purple-30)";
const EQUIPMENT_STROKE = "var(--clr-dark-purple-20)";
const LIT_STROKE = "var(--ink)";
const REST_WIDTH = 1;
const LIT_WIDTH = 2;
const DIMMED_OPACITY = 0.12;

/**
 * A quiet line at rest. Dashed when the link is inferred (which intakes a run
 * drew follows from the bin's draw order). Only a lit edge (on the focused
 * record's lineage) carries the mass label, in kg or % per the toggle.
 */
export function ChainEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps) {
  const path = flowEdgePath(sourceX, sourceY, targetX, targetY);
  const {
    variant = "flow",
    inferred,
    dimmed,
    lit,
    labelText,
    labelX,
    labelY,
  } = (data ?? {}) as ChainEdgeData;
  const isEquipment = variant === "equipment";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: lit ? LIT_STROKE : isEquipment ? EQUIPMENT_STROKE : REST_STROKE,
          strokeWidth: lit ? LIT_WIDTH : REST_WIDTH,
          strokeDasharray: inferred ? FLOW_INFERRED_DASHARRAY : undefined,
          opacity: dimmed ? DIMMED_OPACITY : 1,
          transition: "opacity 150ms, stroke 150ms",
        }}
      />
      {labelText && labelX !== undefined && labelY !== undefined ? (
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
