/**
 * CustodyFlowRibbon — the dashboard's facility-wide custody flow (visual
 * design plan, Phase 5). The batch Sankey's honest mass-balance grammar
 * (`buildStageFlow` — same columns, same labeled exits, negative residuals
 * clamped to a warning) rendered as a static panel-sized ribbon: stage bars
 * on the accent ramp rose → orange → red → purple, source→target gradient
 * ribbons at 0.5 stop-opacity with the marching `.coc-flow-line` centerline.
 * Column heads link to the entity list backing each stage.
 */
"use client";

import Link from "next/link";
import { FlowArrow } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  CreditBatchSankeyData,
  SankeyColumnKey,
} from "@/lib/chain-of-custody/sankey";
import { DashboardPanel } from "./dashboard-panel";

// ViewBox geometry — scaled responsively by the wrapper.
const VIEW_W = 1120;
const VIEW_H = 240;
const BAR_W = 14;
const FLOW_TOP = 16;
const FLOW_MAX_H = 130;
const MIN_BAR_H = 3;
const EXIT_STUB_W = 10;
const EXIT_STUB_H = 18;
const EXIT_ROW_H = 36;
const COLUMN_PAD_X = 90;

const RIBBON_STOP_OPACITY = 0.5;
const FLOW_LINE_WIDTH_RATIO = 0.12;
const FLOW_LINE_MIN_WIDTH = 1;
const FLOW_LINE_MAX_WIDTH = 2.4;

/** Same stage ramp as the batch Sankey (inspiration carbon-flow ribbon). */
const COLUMN_ACCENTS: Record<SankeyColumnKey, string> = {
  feedstock: "var(--clr-rose)",
  productionRuns: "var(--clr-orange)",
  biocharLots: "var(--clr-red)",
  applied: "var(--clr-purple)",
};

const COLUMN_ROUTES: Record<SankeyColumnKey, string> = {
  feedstock: "/feedstocks",
  productionRuns: "/production-runs",
  biocharLots: "/biochar-products",
  applied: "/applications",
};

function formatMassT(massKg: number): string {
  return `${(massKg / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} t`;
}

interface CustodyFlowRibbonProps {
  flow: CreditBatchSankeyData;
  facilityId: string;
}

export function CustodyFlowRibbon({ flow, facilityId }: CustodyFlowRibbonProps) {
  const { columns, exits } = flow;
  const maxMass = Math.max(...columns.map((column) => column.massKg), 0);

  const meta =
    flow.warnings.length > 0 ? (
      <span className="label-micro text-[var(--st-wait)]">
        {flow.warnings.length}{" "}
        {flow.warnings.length === 1 ? "inconsistency" : "inconsistencies"}
      </span>
    ) : (
      <span className="label-micro text-[var(--color-text-tertiary)]">
        Dry-mass balance
      </span>
    );

  if (maxMass <= 0) {
    return (
      <DashboardPanel title="Custody flow" meta={meta}>
        <EmptyState
          padding="md"
          icon={<FlowArrow size={32} />}
          title="No mass flow in period"
          description="Recorded dry mass moving feedstock → runs → lots → applied will trace here."
        />
      </DashboardPanel>
    );
  }

  const scale = FLOW_MAX_H / maxMass;
  const barHeight = (massKg: number) =>
    massKg <= 0 ? 0 : Math.max(MIN_BAR_H, massKg * scale);
  const columnX = (index: number) =>
    COLUMN_PAD_X + (index * (VIEW_W - 2 * COLUMN_PAD_X)) / (columns.length - 1);

  const exitsFor = (key: SankeyColumnKey) =>
    exits.filter((exit) => exit.fromColumn === key);
  // Conversion loss is the ribbon's taper into the next column; the other
  // exits leave after the bar and reduce its outgoing ribbon.
  const postBarExitMass = (key: SankeyColumnKey) =>
    exitsFor(key)
      .filter((exit) => exit.key !== "conversion_loss")
      .reduce((sum, exit) => sum + exit.massKg, 0);

  return (
    <DashboardPanel title="Custody flow" meta={meta}>
      {/* Stage heads — linked, above the diagram */}
      <div className="grid grid-cols-2 gap-y-12 px-20 pt-16 sm:grid-cols-4">
        {columns.map((column, index) => (
          <Link
            key={column.key}
            href={`${COLUMN_ROUTES[column.key]}?facility=${facilityId}`}
            className="group flex flex-col gap-2"
          >
            <span className="label-micro text-[var(--color-text-tertiary)]">
              {String(index + 1).padStart(2, "0")}{" "}
              <span className="text-[var(--color-text-primary)] group-hover:underline group-hover:underline-offset-2">
                {column.label}
              </span>
            </span>
            <span className="font-mono text-[12px] tabular-nums text-[var(--color-text-secondary)]">
              {formatMassT(column.massKg)} · {column.count}{" "}
              {column.count === 1 ? "record" : "records"}
            </span>
          </Link>
        ))}
      </div>

      {/* The ribbon needs width to read — below `sm` the exits render as
          rows instead and the diagram is dropped, not shrunk to noise. */}
      <div
        className="hidden px-20 pb-16 pt-8 sm:block"
        data-testid="custody-flow-ribbon"
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Facility custody flow: dry mass from feedstock to applied"
        >
          <defs>
            {columns.slice(0, -1).map((column, index) => (
              <linearGradient
                key={`gradient-${column.key}`}
                id={`flow-ribbon-${column.key}`}
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
              column.massKg - postBarExitMass(column.key),
            );
            if (outflowKg <= 0) return null;
            const leftH = barHeight(outflowKg);
            const rightH = Math.min(leftH, barHeight(next.massKg));
            const xLeft = columnX(index) + BAR_W / 2;
            const xRight = columnX(index + 1) - BAR_W / 2;
            const flowWidth = Math.max(
              FLOW_LINE_MIN_WIDTH,
              Math.min(FLOW_LINE_MAX_WIDTH, rightH * FLOW_LINE_WIDTH_RATIO),
            );
            return (
              <g key={`ribbon-${column.key}`}>
                <polygon
                  points={`${xLeft},${FLOW_TOP} ${xRight},${FLOW_TOP} ${xRight},${FLOW_TOP + rightH} ${xLeft},${FLOW_TOP + leftH}`}
                  fill={`url(#flow-ribbon-${column.key})`}
                />
                <line
                  className="coc-flow-line"
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

          {/* Column bars */}
          {columns.map((column, index) => {
            const x = columnX(index);
            const height = barHeight(column.massKg);
            return height > 0 ? (
              <rect
                key={column.key}
                x={x - BAR_W / 2}
                y={FLOW_TOP}
                width={BAR_W}
                height={height}
                fill={COLUMN_ACCENTS[column.key]}
              />
            ) : (
              <line
                key={column.key}
                x1={x - BAR_W / 2}
                x2={x + BAR_W / 2}
                y1={FLOW_TOP}
                y2={FLOW_TOP}
                stroke="var(--color-border-secondary)"
                strokeWidth={1.5}
              />
            );
          })}

          {/* Labeled exits below the column they leave from */}
          {columns.map((column, index) => {
            const x = columnX(index);
            return exitsFor(column.key).map((exit, exitIndex) => {
              const exitTop = FLOW_TOP + FLOW_MAX_H + 14 + exitIndex * EXIT_ROW_H;
              const tone =
                exit.tone === "alert"
                  ? "var(--st-bad)"
                  : "var(--color-text-tertiary)";
              return (
                <g key={exit.key}>
                  <polygon
                    points={`${x - EXIT_STUB_W / 2},${exitTop} ${x + EXIT_STUB_W / 2},${exitTop} ${x},${exitTop + EXIT_STUB_H}`}
                    fill={tone}
                  />
                  <text
                    x={x + EXIT_STUB_W}
                    y={exitTop + 8}
                    className="font-mono text-[10.5px] font-medium uppercase tracking-[0.06em]"
                    fill={tone}
                  >
                    {exit.label} · −{formatMassT(exit.massKg)}
                  </text>
                </g>
              );
            });
          })}
        </svg>
      </div>

      {/* Mobile fallback: the labeled exits as rows */}
      {exits.length > 0 && (
        <ul className="flex flex-col gap-6 px-20 pb-16 pt-8 sm:hidden">
          {exits.map((exit) => (
            <li
              key={exit.key}
              className="label-micro"
              style={{
                color:
                  exit.tone === "alert"
                    ? "var(--st-bad)"
                    : "var(--color-text-tertiary)",
              }}
            >
              {exit.label} · −{formatMassT(exit.massKg)}
            </li>
          ))}
        </ul>
      )}
    </DashboardPanel>
  );
}
