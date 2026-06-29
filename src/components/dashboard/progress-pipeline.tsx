/**
 * ProgressPipeline — the facility's MRV funnel (restored from the operator
 * dashboard): one numbered cell per stage feedstock → … → GHG statements,
 * echoing the custody-flow ribbon's `0N` stage grammar. Each cell shows the
 * stage total and an orange share-bar for the records still needing
 * follow-through; the whole cell links to that stage's list. Hairline seams
 * come from a gap-px grid over the border colour (no double borders).
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { DashboardProgressStage } from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

const MIN_ATTENTION_BAR_PERCENT = 4;

interface ProgressPipelineProps {
  stages: DashboardProgressStage[];
}

export function ProgressPipeline({ stages }: ProgressPipelineProps) {
  const totalAttention = stages.reduce(
    (sum, stage) => sum + stage.needsAttention,
    0,
  );

  return (
    <DashboardPanel
      title="Pipeline"
      meta={
        totalAttention > 0 ? (
          <span className="label-micro text-[var(--st-wait)]">
            {totalAttention} need attention
          </span>
        ) : (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            All clear
          </span>
        )
      }
    >
      <div
        className="grid grid-cols-2 gap-px bg-[var(--color-border-tertiary)] sm:grid-cols-4"
        data-testid="progress-pipeline"
      >
        {stages.map((stage, index) => {
          const flagged = stage.needsAttention > 0;
          // Share of the stage still needing follow-through; the rest reads as
          // healthy. An empty stage has nothing to flag, so it reads clear.
          const attentionShare =
            stage.total === 0
              ? 0
              : Math.min(100, (stage.needsAttention / stage.total) * 100);
          return (
            <Link
              key={stage.key}
              href={stage.href}
              className="group flex min-h-[120px] flex-col gap-16 bg-[var(--panel-bg)] px-20 py-18 transition-colors hover:bg-[var(--color-background-medium)]"
            >
              <div className="flex items-start justify-between gap-8">
                <span className="label-micro text-[var(--color-text-tertiary)]">
                  {String(index + 1).padStart(2, "0")}{" "}
                  <span className="text-[var(--color-text-primary)]">
                    {stage.label}
                  </span>
                </span>
                <ArrowRightIcon
                  size={13}
                  weight="bold"
                  className="shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
                  aria-hidden
                />
              </div>

              <div className="flex flex-col gap-10">
                <span className="font-mono text-[28px] leading-none tabular-nums text-[var(--color-text-primary)]">
                  {stage.total}
                </span>
                {/* Health bar: purple = healthy share, orange = needs
                    attention. Clear → full purple; fully flagged → full orange. */}
                <div className="flex h-6 overflow-hidden">
                  {flagged && (
                    <div
                      className="h-full bg-[var(--st-wait)]"
                      style={{ width: `${Math.max(attentionShare, MIN_ATTENTION_BAR_PERCENT)}%` }}
                    />
                  )}
                  <div className="h-full flex-1 bg-[var(--clr-purple)]" />
                </div>
                <span
                  className={`label-micro ${
                    flagged
                      ? "text-[var(--st-wait)]"
                      : "text-[var(--color-text-tertiary)]"
                  }`}
                >
                  {flagged
                    ? `${stage.needsAttention} need attention`
                    : "All clear"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </DashboardPanel>
  );
}
