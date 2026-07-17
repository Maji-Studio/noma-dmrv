/**
 * FlowHero — the dashboard's hero panel: the isometric traceability scene
 * (desktop) or the stacked station list (<768px), under a header carrying the
 * smart-view segmented control (Overview / Flow / Needs attention), with the
 * status legend as the panel footer. Empty and loading states ghost the art
 * rather than swapping it out — the scene "comes to life" as records land.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  DashboardMassFlowSegment,
  DashboardStation,
} from "@/data-access/dashboard-overview";
import { FlowHeroDefs } from "./flow-hero-defs";
import { FlowHeroMobile } from "./flow-hero-mobile";
import { FlowHeroScene } from "./flow-hero-scene";
import { FLOW_HERO_VIEWS, type FlowHeroView } from "./flow-hero-types";

/** Placeholder stations while loading — keeps the ghosted art fully drawn. */
const EMPTY_SEGMENT_TONNES = 0;

interface FlowHeroProps {
  stations: DashboardStation[] | undefined;
  massFlow: DashboardMassFlowSegment[] | undefined;
  runningRuns: number;
  isLoading: boolean;
  facilityId: string;
}

const LEGEND: { label: string; token: string }[] = [
  { label: "Needs attention", token: "var(--st-wait)" },
  { label: "Running", token: "var(--st-run)" },
];

const PLACEHOLDER_STATIONS: DashboardStation[] = (
  [
    ["suppliers", "Suppliers"],
    ["feedstock", "Feedstock"],
    ["production", "Production"],
    ["products", "Biochar"],
    ["deliveries", "Delivery"],
    ["applications", "Application"],
  ] as const
).map(([key, name]) => ({
  key,
  name,
  total: 0,
  totalLabel: "—",
  attention: 0,
  reasons: [],
  href: "#",
}));

const PLACEHOLDER_FLOW: DashboardMassFlowSegment[] = (
  ["delivered", "intoRuns", "produced", "bagged", "applied"] as const
).map((key) => ({ key, tonnes: EMPTY_SEGMENT_TONNES }));

export function FlowHero({
  stations,
  massFlow,
  runningRuns,
  isLoading,
  facilityId,
}: FlowHeroProps) {
  const [view, setView] = useState<FlowHeroView>("overview");

  const isEmpty =
    !isLoading && stations != null && stations.every((station) => station.total === 0);
  const ghosted = isLoading || isEmpty;
  const sceneStations = stations && !isLoading ? stations : PLACEHOLDER_STATIONS;
  const sceneFlow = massFlow && !isLoading ? massFlow : PLACEHOLDER_FLOW;

  return (
    <section
      className="flex flex-col bg-[var(--panel-bg)] [border:var(--panel-border)]"
      data-testid="flow-hero"
    >
      <FlowHeroDefs />

      {/* Head — title + smart-view segmented control. */}
      <div className="flex flex-wrap items-center justify-between gap-16 border-b border-[var(--color-border-tertiary)] px-20 py-16">
        <h2 className="label-micro text-[var(--color-text-primary)]">
          Traceability — supplier to soil
        </h2>
        <div
          role="group"
          aria-label="Hero view"
          className="hidden flex-wrap gap-8 md:flex"
        >
          {FLOW_HERO_VIEWS.map((option) => {
            const isActive = option.value === view;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setView(option.value)}
                className={[
                  "label-micro border-[1.5px] border-[var(--ink)] px-12 py-9 transition-colors",
                  isActive
                    ? "bg-[var(--ink)] text-[var(--paper)]"
                    : "bg-transparent text-[var(--ink)] hover:bg-[var(--sea)]",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* The scene (desktop) / stacked chain (mobile). */}
      <div className="relative">
        <FlowHeroScene
          stations={sceneStations}
          massFlow={sceneFlow}
          runningRuns={runningRuns}
          view={view}
          ghosted={ghosted}
        />
        {!ghosted && stations && massFlow && (
          <FlowHeroMobile stations={stations} massFlow={massFlow} />
        )}

        {/* Loading — quiet pulse over the ghosted art. */}
        {isLoading && (
          <div
            className="absolute inset-0 hidden items-center justify-center md:flex"
            aria-hidden
          >
            <div className="flex gap-10">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-12 w-12 animate-pulse rounded-full bg-[var(--clr-dark-purple-30)]"
                  style={{ animationDelay: `${dot * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}
        {isLoading && (
          <div className="flex h-160 items-center justify-center md:hidden">
            <span className="body-small text-[var(--color-text-tertiary)]">
              Loading traceability…
            </span>
          </div>
        )}

        {/* Empty — the scene comes to life as records are logged. */}
        {isEmpty && (
          <div className="flex items-center justify-center p-16 md:absolute md:inset-0 md:p-0">
            <div
              className="w-full max-w-[380px] border-[1.5px] border-[var(--ink)] bg-[var(--paper)] p-24"
              style={{ boxShadow: "6px 6px 0 var(--clr-purple-10)" }}
            >
              <p className="text-[18px] font-bold">No activity yet</p>
              <p className="body-small mt-6 text-[var(--color-text-secondary)]">
                This facility hasn&apos;t recorded any material. The scene comes to
                life as feedstock, runs and deliveries are logged.
              </p>
              <Link
                href={`/feedstocks?facility=${encodeURIComponent(facilityId)}`}
                className="label-micro mt-16 inline-block border-[1.5px] border-[var(--ink)] px-16 py-12 transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
              >
                Add your first feedstock →
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Footer legend. */}
      <div className="flex flex-wrap items-center gap-16 border-t border-[var(--color-border-tertiary)] px-20 py-12">
        {LEGEND.map((entry) => (
          <span
            key={entry.label}
            className="flex items-center gap-6 font-[family-name:var(--font-mono)] text-[9.5px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]"
          >
            <span
              className="h-8 w-8 rounded-full"
              style={{ background: entry.token }}
              aria-hidden
            />
            {entry.label}
          </span>
        ))}
        <span className="flex items-center gap-6 font-[family-name:var(--font-mono)] text-[9.5px] uppercase tracking-[0.08em] text-[var(--clr-dark-purple-60)]">
          <span
            className="w-14 border-t-[1.5px] border-dashed border-[var(--clr-dark-purple-50)]"
            aria-hidden
          />
          Mass flow (t)
        </span>
      </div>
    </section>
  );
}
