/**
 * TraceabilityFlow — the facility's custody chain drawn as an illustrative,
 * left-to-right flow of iconed stages (feedstock → production → biochar →
 * applied) connected by animated marching-ants arrows. Replaces the abstract
 * dry-mass Sankey ribbon, which read as noise: here each stage is a tappable
 * card with its icon, dry mass, and record count, and each connector carries
 * the dominant labeled loss leaving that stage (conversion loss / ineligible /
 * in storage). Sits at the head of the Traceability section, above the map.
 */
"use client";

import { Fragment } from "react";
import Link from "next/link";
import { ArrowRight, Flame, Leaf, Plant, Stack } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import type {
  CreditBatchSankeyData,
  SankeyColumnKey,
} from "@/lib/chain-of-custody/sankey";

interface StageMeta {
  icon: Icon;
  accent: string;
  href: string;
}

/** Per-stage icon, accent (rose→orange→red→purple ramp), and list route. */
const STAGE: Record<SankeyColumnKey, StageMeta> = {
  feedstock: { icon: Leaf, accent: "var(--clr-rose)", href: "/feedstocks" },
  productionRuns: { icon: Flame, accent: "var(--clr-orange)", href: "/production-runs" },
  biocharLots: { icon: Stack, accent: "var(--clr-red)", href: "/biochar-products" },
  applied: { icon: Plant, accent: "var(--clr-purple)", href: "/applications" },
};

function formatMassT(massKg: number): string {
  return `${(massKg / 1000).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })} t`;
}

interface TraceabilityFlowProps {
  flow: CreditBatchSankeyData;
  facilityId: string;
}

export function TraceabilityFlow({ flow, facilityId }: TraceabilityFlowProps) {
  const { columns, exits } = flow;
  const maxMass = Math.max(...columns.map((column) => column.massKg), 0);

  if (maxMass <= 0) {
    return (
      <p className="px-20 py-16 body-small text-[var(--color-text-tertiary)]">
        No dry mass has moved feedstock → applied in this period yet. The chain
        will trace here as records are recorded.
      </p>
    );
  }

  // The largest labeled loss leaving a stage — shown faintly under the arrow.
  const dominantExit = (key: SankeyColumnKey) =>
    exits
      .filter((exit) => exit.fromColumn === key)
      .sort((a, b) => b.massKg - a.massKg)[0];

  return (
    <div
      className="flex items-start gap-0 overflow-x-auto px-20 py-18"
      data-testid="traceability-flow"
    >
      {columns.map((column, index) => {
        const stage = STAGE[column.key];
        const StageIcon = stage.icon;
        const exit = index < columns.length - 1 ? dominantExit(column.key) : undefined;
        return (
          <Fragment key={column.key}>
            <Link
              href={`${stage.href}?facility=${encodeURIComponent(facilityId)}`}
              className="group flex min-w-[120px] flex-1 flex-col gap-10"
            >
              <span
                className="flex h-36 w-36 items-center justify-center transition-transform duration-150 group-hover:-translate-y-[2px]"
                style={{ background: stage.accent }}
              >
                <StageIcon
                  size={20}
                  weight="bold"
                  color="var(--color-background-white)"
                  aria-hidden
                />
              </span>
              <span className="label-micro text-[var(--color-text-tertiary)]">
                {String(index + 1).padStart(2, "0")}{" "}
                <span className="text-[var(--color-text-primary)] group-hover:underline group-hover:underline-offset-2">
                  {column.label}
                </span>
              </span>
              <span className="font-mono text-[22px] leading-none tabular-nums text-[var(--color-text-primary)]">
                {formatMassT(column.massKg)}
              </span>
              <span className="label-micro text-[var(--color-text-tertiary)]">
                {column.count} {column.count === 1 ? "record" : "records"}
              </span>
            </Link>

            {index < columns.length - 1 && (
              <div className="flex w-[68px] shrink-0 flex-col items-center gap-6">
                <div className="flex h-36 w-full items-center justify-center gap-4">
                  <svg
                    viewBox="0 0 40 8"
                    className="h-8 w-full"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <line
                      className="coc-flow-line"
                      x1="0"
                      y1="4"
                      x2="40"
                      y2="4"
                      stroke="var(--clr-dark-purple-40)"
                      strokeWidth="1.5"
                    />
                  </svg>
                  <ArrowRight
                    size={13}
                    weight="bold"
                    className="shrink-0 text-[var(--clr-dark-purple-40)]"
                    aria-hidden
                  />
                </div>
                {exit && (
                  <span
                    className="text-center font-mono text-[9px] font-medium uppercase leading-tight tracking-[0.04em]"
                    style={{
                      color:
                        exit.tone === "alert"
                          ? "var(--st-bad)"
                          : "var(--color-text-tertiary)",
                    }}
                    title={`${exit.label} · −${formatMassT(exit.massKg)}`}
                  >
                    −{formatMassT(exit.massKg)}
                  </span>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
