/**
 * EnergySankey: estimated CO2e flowing from the six sources, through
 * production energy and transport, to credit batches. Same ribbon language as
 * the credit batch mass-balance Sankey. Credit batch nodes are buttons that
 * set the page's batch filter; the grouped and unassigned nodes are not.
 */
"use client";

import type { KeyboardEvent } from "react";
import {
  OTHER_BATCHES_KEY,
  SANKEY_CHART,
  UNASSIGNED_BATCH_KEY,
  sankeyBandPath,
  type SankeyLayout,
  type SankeyLink,
  type SankeyNode,
} from "@/lib/energy/sankey";
import { ENERGY_SOURCE_BY_KEY, ENERGY_STAGES } from "@/lib/energy/sources";
import { ENERGY_SOURCE_FILL, formatEstimate } from "./energy-display";

const LINK_OPACITY = 0.5;
const LINK_ACTIVE_OPACITY = 0.78;
const LINK_DIM_OPACITY = 0.1;
const NODE_DIM_OPACITY = 0.35;
const LABEL_OFFSET = 8;
const SECOND_LINE_OFFSET = 13;
const FIRST_LINE_LIFT = 2;
const STAGE_LABEL_LIFT = 8;
const FOCUS_RING =
  "outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]";

interface EnergySankeyProps {
  layout: SankeyLayout;
  selectedBatchKey: string | null;
  batchLabel: (key: string) => string;
  onHover: (text: string | null) => void;
  onSelectBatch: (key: string) => void;
}

function stageLabel(stage: string): string {
  return ENERGY_STAGES.find((s) => s.key === stage)?.label ?? stage;
}

export function EnergySankey({
  layout,
  selectedBatchKey,
  batchLabel,
  onHover,
  onSelectBatch,
}: EnergySankeyProps) {
  const nodeLabel = (node: SankeyNode) =>
    node.source
      ? ENERGY_SOURCE_BY_KEY[node.source].label
      : node.stage
        ? stageLabel(node.stage)
        : batchLabel(node.batchKey ?? "");
  const nodeText = (node: SankeyNode) => `${nodeLabel(node)}: ${formatEstimate(node.kg)}`;
  const linkText = (link: SankeyLink) => {
    const target =
      link.leg === "toStage"
        ? `${stageLabel(link.stage)}, ${batchLabel(link.batchKey)}`
        : batchLabel(link.batchKey);
    return `${ENERGY_SOURCE_BY_KEY[link.source].label} to ${target}: ${formatEstimate(link.kg)}`;
  };
  const linkOpacity = (link: SankeyLink) =>
    selectedBatchKey == null
      ? LINK_OPACITY
      : link.batchKey === selectedBatchKey
        ? LINK_ACTIVE_OPACITY
        : LINK_DIM_OPACITY;
  const selectable = (key: string | undefined): key is string =>
    key != null && key !== OTHER_BATCHES_KEY && key !== UNASSIGNED_BATCH_KEY;

  return (
    <svg
      viewBox={`0 0 ${SANKEY_CHART.width} ${SANKEY_CHART.height}`}
      role="img"
      aria-label="Estimated CO₂e flowing from energy sources, through production and transport, to credit batches"
      className="block h-auto w-full"
    >
      <g>
        {layout.links.map((link) => {
          const text = linkText(link);
          return (
            <path
              key={link.id}
              d={sankeyBandPath(link)}
              fill={ENERGY_SOURCE_FILL[link.source]}
              fillOpacity={linkOpacity(link)}
              onMouseEnter={() => onHover(text)}
              onMouseLeave={() => onHover(null)}
            >
              <title>{text}</title>
            </path>
          );
        })}
      </g>

      {layout.nodes.map((node) => {
        const x =
          node.column === "source"
            ? SANKEY_CHART.sourceX
            : node.column === "batch"
              ? SANKEY_CHART.batchX
              : SANKEY_CHART.stageX;
        const mid = node.y + Math.max(node.h, SANKEY_CHART.slot) / 2;
        const isSource = node.column === "source";
        const textX = isSource ? x - LABEL_OFFSET : x + SANKEY_CHART.barWidth + LABEL_OFFSET;
        const anchor = isSource ? "end" : "start";
        const fill = node.source
          ? ENERGY_SOURCE_FILL[node.source]
          : node.column === "stage"
            ? "var(--color-text-secondary)"
            : "var(--color-text-primary)";
        const batchKey = node.batchKey;
        const canSelect = node.column === "batch" && selectable(batchKey);
        const dimmed =
          node.column === "batch" && selectedBatchKey != null && batchKey !== selectedBatchKey;
        const text = nodeText(node);
        const select = () => {
          if (canSelect && batchKey) onSelectBatch(batchKey);
        };
        return (
          <g
            key={node.id}
            tabIndex={0}
            role={canSelect ? "button" : "img"}
            aria-label={text}
            aria-pressed={canSelect ? selectedBatchKey === batchKey : undefined}
            opacity={dimmed ? NODE_DIM_OPACITY : 1}
            className={`${FOCUS_RING} ${canSelect ? "cursor-pointer" : ""}`}
            onMouseEnter={() => onHover(text)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(text)}
            onBlur={() => onHover(null)}
            onClick={select}
            onKeyDown={(event: KeyboardEvent) => {
              if (canSelect && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                select();
              }
            }}
          >
            <rect x={x} y={node.y} width={SANKEY_CHART.barWidth} height={node.h} fill={fill} />
            {node.column === "stage" ? (
              <text
                x={x + SANKEY_CHART.barWidth / 2}
                y={node.y - STAGE_LABEL_LIFT}
                textAnchor="middle"
                className="fill-[var(--color-text-primary)] text-[13px] font-medium"
              >
                {nodeLabel(node)}
              </text>
            ) : (
              <>
                <text
                  x={textX}
                  y={mid - FIRST_LINE_LIFT}
                  textAnchor={anchor}
                  className="fill-[var(--color-text-primary)] text-[13px] font-medium"
                >
                  {nodeLabel(node)}
                </text>
                <text
                  x={textX}
                  y={mid + SECOND_LINE_OFFSET}
                  textAnchor={anchor}
                  className="fill-[var(--color-text-secondary)] text-[12px]"
                >
                  {formatEstimate(node.kg)}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
