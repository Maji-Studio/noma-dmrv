"use client";

/**
 * Batch mass-balance Sankey (plan decision 3): one unit (dry kg) end to end —
 * Feedstock → Production runs → Biochar lots → Applied. Column bars are
 * proportional to their real mass (never normalized); every loss is an
 * explicit labeled exit stub below the column it leaves from. Conversion loss
 * renders as the taper of the ribbon into the production-runs column; net
 * tCO₂e is a header label, not a ribbon.
 *
 * The diagram sits on a React Flow canvas (same zoom/pan chrome as the DAG
 * view). Clicking a column or exit opens an info tooltip; columns (and the
 * record-backed exits) link through to their entity routes.
 */

import { useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { formatMassKg } from "@/lib/format-utils";
import type {
  CreditBatchSankeyData,
  SankeyColumn,
  SankeyColumnKey,
  SankeyExit,
  SankeyExitKey,
} from "@/lib/chain-of-custody/sankey";
import {
  GRAPH_CANVAS_CLASS,
  GRAPH_CONTROLS_CLASS,
  GRAPH_DOTS,
} from "../chain-constants";

// ViewBox geometry — rendered 1:1 on the canvas; React Flow handles zoom.
const VIEW_W = 1040;
const VIEW_H = 480;
const COLUMN_XS = [80, 373, 666, 960];
const BAR_W = 20;
const FLOW_TOP = 84;
const FLOW_MAX_H = 230;
/** Non-zero masses always render visibly even next to a dominant column. */
const MIN_BAR_H = 3;
const EXIT_STUB_W = 12;
const EXIT_STUB_H = 26;
const EXIT_ROW_H = 46;
/** Invisible hit zone widening each clickable column / exit target. */
const HIT_PAD_X = 40;

/**
 * Stage color ramp per the inspiration's carbon-flow ribbon: rose biomass →
 * orange production → red biochar → purple field use. Ribbons blend between
 * adjacent stage colors.
 */
const COLUMN_ACCENTS: Record<SankeyColumnKey, string> = {
  feedstock: "var(--clr-rose)",
  productionRuns: "var(--clr-orange)",
  biocharLots: "var(--clr-red)",
  applied: "var(--clr-purple)",
};

const RIBBON_STOP_OPACITY = 0.5;
/** Marching centerline width scales with the ribbon, clamped to stay quiet. */
const FLOW_LINE_WIDTH_RATIO = 0.12;
const FLOW_LINE_MIN_WIDTH = 1;
const FLOW_LINE_MAX_WIDTH = 2.4;

/** "See details" target per column — the entity list backing the column. */
const COLUMN_ROUTES: Record<SankeyColumnKey, string> = {
  feedstock: "/feedstocks",
  productionRuns: "/production-runs",
  biocharLots: "/biochar-products",
  applied: "/applications",
};

/** Exits that are backed by inspectable records get a route too. */
const EXIT_ROUTES: Partial<Record<SankeyExitKey, string>> = {
  ineligible_feedstock: "/feedstocks",
  in_storage: "/biochar-products",
};

const EXIT_NOTES: Record<SankeyExitKey, string> = {
  ineligible_feedstock:
    "Feedstock mass excluded from the eligible balance for this batch.",
  conversion_loss:
    "Pyrolysis gas and heat, which are the expected conversion loss.",
  unallocated_output:
    "Run output not allocated to any biochar lot in this batch.",
  in_storage: "Biochar produced for this batch but not yet applied.",
};

const TOOLTIP_W = 248;
// Keeps the tooltip anchor far enough above the wrapper's bottom edge that
// an estimated-height tooltip never clips outside the diagram.
const TOOLTIP_BOTTOM_CLEARANCE = 120;

function exitTone(exit: SankeyExit): string {
  return exit.tone === "alert" ? "var(--st-bad)" : "var(--color-text-tertiary)";
}

type SankeySelection =
  | { kind: "column"; column: SankeyColumn }
  | { kind: "exit"; exit: SankeyExit };

/** Tooltip anchor in wrapper-relative px, derived from the clicked target. */
interface SelectionAnchor {
  x: number;
  y: number;
}

interface SankeyDiagramProps {
  sankey: CreditBatchSankeyData;
  batchCode: string;
  onElementClick: (selection: SankeySelection, targetRect: DOMRect) => void;
}

type SankeyNodeData = SankeyDiagramProps & { [key: string]: unknown };

function interactiveProps(
  label: string,
  onActivate: (target: Element) => void
) {
  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-label": label,
    className:
      "cursor-pointer outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--color-interaction)]",
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      onActivate(event.currentTarget);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onActivate(event.currentTarget);
      }
    },
  };
}

/** The full Sankey SVG, rendered as a single static React Flow node. */
function SankeyDiagramNode({ data }: NodeProps) {
  const { sankey, batchCode, onElementClick } = data as SankeyNodeData;
  const { columns, exits } = sankey;

  const exitsFor = (key: SankeyColumnKey) =>
    exits.filter((exit) => exit.fromColumn === key);

  // The taper exit (conversion loss) narrows the incoming ribbon; every other
  // exit leaves after its column's bar and reduces the outgoing ribbon.
  const postBarExitMass = (key: SankeyColumnKey) =>
    exitsFor(key)
      .filter((exit) => exit.key !== "conversion_loss")
      .reduce((sum, exit) => sum + exit.massKg, 0);

  const maxMass = Math.max(...columns.map((column) => column.massKg), 0);
  const scale = maxMass <= 0 ? 0 : FLOW_MAX_H / maxMass;
  const barHeight = (massKg: number) =>
    massKg <= 0 ? 0 : Math.max(MIN_BAR_H, massKg * scale);

  return (
    <svg
      width={VIEW_W}
      height={VIEW_H}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={`Mass balance for credit batch ${batchCode}`}
    >
      {/* Stage-blend gradients for the ribbons */}
      <defs>
        {columns.slice(0, -1).map((column, index) => (
          <linearGradient
            key={`gradient-${column.key}`}
            id={`sankey-ribbon-${column.key}`}
            x1="0"
            x2="1"
            y1="0"
            y2="0"
          >
            <stop
              offset="0%"
              stopColor={COLUMN_ACCENTS[column.key]}
              stopOpacity={RIBBON_STOP_OPACITY}
            />
            <stop
              offset="100%"
              stopColor={COLUMN_ACCENTS[columns[index + 1].key]}
              stopOpacity={RIBBON_STOP_OPACITY}
            />
          </linearGradient>
        ))}
      </defs>

      {/* Ribbons between adjacent columns */}
      {columns.slice(0, -1).map((column, index) => {
        const next = columns[index + 1];
        const outflowKg = Math.max(
          0,
          column.massKg - postBarExitMass(column.key)
        );
        if (outflowKg <= 0) return null;
        const leftH = barHeight(outflowKg);
        // The ribbon never lands taller than the destination bar — the taper
        // is the conversion loss (or a warned inconsistency).
        const rightH = Math.min(leftH, barHeight(next.massKg));
        const xLeft = COLUMN_XS[index] + BAR_W / 2;
        const xRight = COLUMN_XS[index + 1] - BAR_W / 2;
        const flowWidth = Math.max(
          FLOW_LINE_MIN_WIDTH,
          Math.min(FLOW_LINE_MAX_WIDTH, rightH * FLOW_LINE_WIDTH_RATIO)
        );
        return (
          <g key={`ribbon-${column.key}`}>
            <polygon
              points={`${xLeft},${FLOW_TOP} ${xRight},${FLOW_TOP} ${xRight},${FLOW_TOP + rightH} ${xLeft},${FLOW_TOP + leftH}`}
              fill={`url(#sankey-ribbon-${column.key})`}
            />
            {/* Marching centerline — direction of the mass flow */}
            <line
              className="traceability-flow-line"
              x1={xLeft}
              y1={FLOW_TOP + leftH / 2}
              x2={xRight}
              y2={FLOW_TOP + rightH / 2}
              stroke={COLUMN_ACCENTS[next.key]}
              strokeWidth={flowWidth}
              strokeOpacity={0.5}
            />
          </g>
        );
      })}

      {/* Column bars + heads */}
      {columns.map((column, index) => {
        const x = COLUMN_XS[index];
        const height = barHeight(column.massKg);
        const anchor =
          index === 0 ? "start" : index === columns.length - 1 ? "end" : "middle";
        const textX =
          index === 0
            ? x - BAR_W / 2
            : index === columns.length - 1
              ? x + BAR_W / 2
              : x;
        return (
          <g key={column.key}>
            <g
              data-testid={`sankey-column-${column.key}`}
              {...interactiveProps(`${column.label} details`, (target) =>
                onElementClick(
                  { kind: "column", column },
                  target.getBoundingClientRect()
                )
              )}
            >
              {/* Hit zone covering the head labels and the bar */}
              <rect
                x={x - HIT_PAD_X}
                y={12}
                width={HIT_PAD_X * 2}
                height={FLOW_TOP + FLOW_MAX_H - 12}
                fill="transparent"
              />
              <text
                x={textX}
                y={28}
                textAnchor={anchor}
                className="fill-[var(--color-text-primary)] font-mono text-[13px] font-medium uppercase tracking-[0.08em]"
              >
                {column.label}
              </text>
              <text
                x={textX}
                y={48}
                textAnchor={anchor}
                className="fill-[var(--color-text-secondary)] font-mono text-[12px]"
              >
                {formatMassKg(column.massKg)}
              </text>
              <text
                x={textX}
                y={66}
                textAnchor={anchor}
                className="fill-[var(--color-text-tertiary)] font-mono text-[11px] uppercase tracking-[0.06em]"
              >
                {column.count} {column.count === 1 ? "record" : "records"}
              </text>
              {height > 0 ? (
                <rect
                  x={x - BAR_W / 2}
                  y={FLOW_TOP}
                  width={BAR_W}
                  height={height}
                  fill={COLUMN_ACCENTS[column.key]}
                />
              ) : (
                <line
                  x1={x - BAR_W / 2}
                  x2={x + BAR_W / 2}
                  y1={FLOW_TOP}
                  y2={FLOW_TOP}
                  stroke="var(--color-border-secondary)"
                  strokeWidth={1.5}
                />
              )}
            </g>

            {/* Labeled exits below the column they leave from */}
            {exitsFor(column.key).map((exit, exitIndex) => {
              const exitTop =
                FLOW_TOP + FLOW_MAX_H + 24 + exitIndex * EXIT_ROW_H;
              const tone = exitTone(exit);
              const exitAnchor = anchor;
              const exitTextX =
                index === 0
                  ? x + EXIT_STUB_W
                  : index === columns.length - 1
                    ? x - EXIT_STUB_W
                    : x;
              return (
                <g
                  key={exit.key}
                  data-testid={`sankey-exit-${exit.key}`}
                  {...interactiveProps(`${exit.label} details`, (target) =>
                    onElementClick(
                      { kind: "exit", exit },
                      target.getBoundingClientRect()
                    )
                  )}
                >
                  <rect
                    x={x - HIT_PAD_X}
                    y={exitTop}
                    width={HIT_PAD_X * 2}
                    height={EXIT_ROW_H}
                    fill="transparent"
                  />
                  <polygon
                    points={`${x - EXIT_STUB_W / 2},${exitTop} ${x + EXIT_STUB_W / 2},${exitTop} ${x},${exitTop + EXIT_STUB_H}`}
                    fill={tone}
                  />
                  <text
                    x={exitTextX}
                    y={exitTop + EXIT_STUB_H + 16}
                    textAnchor={exitAnchor}
                    className="font-mono text-[11px] font-medium uppercase tracking-[0.06em]"
                    fill={tone}
                  >
                    {exit.label}
                  </text>
                  <text
                    x={exitTextX}
                    y={exitTop + EXIT_STUB_H + 31}
                    textAnchor={exitAnchor}
                    className="font-mono text-[11px]"
                    fill={tone}
                  >
                    −{formatMassKg(exit.massKg)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

const sankeyNodeTypes: NodeTypes = {
  sankeyDiagram: SankeyDiagramNode,
};

interface SankeyTooltipProps {
  selection: SankeySelection;
  anchor: SelectionAnchor;
  /** Share denominator — the feedstock intake column's mass. */
  intakeMassKg: number;
  facilityId: string | null;
}

function SankeyTooltip({
  selection,
  anchor,
  intakeMassKg,
  facilityId,
}: SankeyTooltipProps) {
  const isColumn = selection.kind === "column";
  const massKg = isColumn ? selection.column.massKg : selection.exit.massKg;
  // Share of intake reads as nonsense above 100% (possible when the recorded
  // masses are inconsistent — the warning box already calls that out).
  const shareRaw =
    intakeMassKg > 0 ? Math.round((massKg / intakeMassKg) * 100) : null;
  const share = shareRaw != null && shareRaw <= 100 ? shareRaw : null;
  const route = isColumn
    ? COLUMN_ROUTES[selection.column.key]
    : EXIT_ROUTES[selection.exit.key];
  const href =
    route && facilityId ? `${route}?facility=${facilityId}` : (route ?? null);

  return (
    <div
      className="absolute z-20 w-[248px] -translate-x-1/2 border-[1.5px] border-[var(--clr-dark-purple-20)] bg-[color-mix(in_srgb,var(--color-background-white)_96%,transparent)] backdrop-blur-[8px] shadow-[0_2px_12px_rgba(20,8,38,0.10)]"
      style={{ left: anchor.x, top: anchor.y }}
      data-testid="sankey-tooltip"
    >
      <div className="flex items-center justify-between gap-8 border-b border-[var(--clr-dark-purple-10)] px-[14px] py-10">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--clr-dark-purple-60)]">
          {isColumn ? "Flow column" : "Labeled exit"}
        </span>
        {!isColumn && selection.exit.tone === "alert" ? (
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--color-signal-red)]">
            Alert
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-6 px-[14px] py-12">
        <p className="title-chapter-title text-[var(--color-text-primary)]">
          {isColumn ? selection.column.label : selection.exit.label}
        </p>
        <p className="font-mono text-[12px] text-[var(--color-text-secondary)]">
          {isColumn ? "" : "−"}
          {formatMassKg(massKg)}
          {share != null ? ` · ${share}% of intake` : ""}
        </p>
        {isColumn ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
            {selection.column.count}{" "}
            {selection.column.count === 1 ? "record" : "records"}
          </p>
        ) : (
          <p className="body-caption text-[var(--color-text-secondary)]">
            {EXIT_NOTES[selection.exit.key]}
          </p>
        )}
      </div>

      {href ? (
        <Link
          href={href}
          className="flex items-center gap-6 border-t border-[var(--clr-dark-purple-10)] px-[14px] py-10 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--clr-dark-purple)] hover:bg-[var(--clr-dark-purple-1)]"
          data-testid="sankey-tooltip-details"
        >
          See details
          <ArrowRightIcon size={12} weight="bold" />
        </Link>
      ) : null}
    </div>
  );
}

export interface BatchSankeyProps {
  sankey: CreditBatchSankeyData;
  batchCode: string;
}

export function BatchSankey({ sankey, batchCode }: BatchSankeyProps) {
  const searchParams = useSearchParams();
  const facilityId = searchParams.get("facility");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<
    (SankeySelection & { anchor: SelectionAnchor }) | null
  >(null);

  const intakeMassKg = sankey.columns[0]?.massKg ?? 0;
  const isEmpty =
    Math.max(...sankey.columns.map((column) => column.massKg), 0) <= 0;

  const handleElementClick = (
    nextSelection: SankeySelection,
    targetRect: DOMRect
  ) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const bounds = wrapper.getBoundingClientRect();
    const x = Math.min(
      Math.max(targetRect.left + targetRect.width / 2 - bounds.left, TOOLTIP_W / 2 + 8),
      bounds.width - TOOLTIP_W / 2 - 8
    );
    const y = Math.min(
      targetRect.bottom - bounds.top + 8,
      bounds.height - TOOLTIP_BOTTOM_CLEARANCE
    );
    setSelection({ ...nextSelection, anchor: { x, y } });
  };

  if (isEmpty) {
    return (
      <div
        className="flex h-full items-center justify-center bg-[var(--color-background-white)]"
        data-testid="batch-sankey-empty"
      >
        <p className="body-medium max-w-[420px] text-center text-[var(--color-text-secondary)]">
          No dry mass is recorded along {batchCode}&apos;s lineage yet, so there
          is no flow to balance.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="relative h-full bg-[var(--color-background-white)]"
      data-testid="batch-sankey"
    >
      <ReactFlow
        nodes={[
          {
            id: "sankey",
            type: "sankeyDiagram",
            position: { x: 0, y: 0 },
            width: VIEW_W,
            height: VIEW_H,
            draggable: false,
            selectable: false,
            // Non-interactive nodes get pointer-events:none from React Flow;
            // the diagram's click targets need them back.
            style: { pointerEvents: "all" as const },
            data: {
              sankey,
              batchCode,
              onElementClick: handleElementClick,
            } satisfies SankeyNodeData,
          },
        ]}
        edges={[]}
        nodeTypes={sankeyNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.3}
        maxZoom={2}
        onPaneClick={() => setSelection(null)}
        onMoveStart={() => setSelection(null)}
        className={GRAPH_CANVAS_CLASS}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={GRAPH_DOTS.gap}
          size={GRAPH_DOTS.size}
          color={GRAPH_DOTS.color}
        />
        <Controls showInteractive={false} className={GRAPH_CONTROLS_CLASS} />
      </ReactFlow>

      {selection ? (
        <SankeyTooltip
          selection={selection}
          anchor={selection.anchor}
          intakeMassKg={intakeMassKg}
          facilityId={facilityId}
        />
      ) : null}

      {/* Out of the column-title row — bottom-right, clear of the controls. */}
      {sankey.warnings.length > 0 ? (
        <div className="absolute bottom-16 right-16 z-10 max-w-[480px] border-[1.5px] border-dashed border-[var(--st-wait)] bg-[var(--paper)] p-12">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--st-wait)]">
            Mass balance inconsistencies
          </p>
          <ul className="mt-8 flex flex-col gap-6">
            {sankey.warnings.map((warning) => (
              <li
                key={warning}
                className="body-caption text-[var(--color-text-secondary)]"
              >
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
