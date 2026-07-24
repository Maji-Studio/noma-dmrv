/**
 * AttentionList — the compact "needs attention" panel under the hero: the
 * actual open items behind the scene's badges, each row deep-linking to the
 * record to fix. The hero shows the counts; this shows the rows.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon, CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import type { DashboardStructuralGap } from "@/data-access/dashboard-structural-gaps";
import { STATUS_STATE_COLOR_TOKENS } from "@/lib/status-state";
import { deriveAttentionSummaryState } from "./dashboard-status-state";
import { DashboardPanel } from "./dashboard-panel";
import { StructuralGapList } from "./structural-gap-list";

interface AttentionListProps {
  attention: DashboardAttentionItem[];
  structuralGaps: DashboardStructuralGap[];
  /** Exact uncapped count of open items; `attention` is a capped sample of it. */
  total: number;
  /** Exact uncapped count of blocking flags (subset of `total`). */
  flagsTotal: number;
}

export function AttentionList({
  attention,
  structuralGaps,
  total,
  flagsTotal,
}: AttentionListProps) {
  const structuralGapTotal = structuralGaps.reduce(
    (sum, gap) => sum + gap.count,
    0,
  );
  const displayedOpenCount = structuralGapTotal + attention.length;
  const summaryState = deriveAttentionSummaryState({ total, flagsTotal });

  return (
    <DashboardPanel
      title="Needs attention"
      meta={
        <span
          className="label-micro"
          style={{ color: STATUS_STATE_COLOR_TOKENS[summaryState] }}
        >
          {total > 0 ? `${total} open` : "All clear"}
        </span>
      }
    >
      <StructuralGapList gaps={structuralGaps} />
      {attention.length === 0 && structuralGaps.length === 0 ? (
        <div className="flex items-center gap-10 px-20 py-20">
          <CheckCircleIcon
            size={18}
            weight="bold"
            className="text-[var(--st-ok)]"
            aria-hidden
          />
          <span className="body-small text-[var(--color-text-secondary)]">
            Every blocking check passes.
          </span>
        </div>
      ) : (
        <ul className="flex flex-col px-20 py-4" data-testid="attention-list">
          {attention.map((item, index) => (
            <li
              key={item.id}
              className={
                index > 0 ? "border-t border-[var(--color-border-tertiary)]" : undefined
              }
            >
              <Link
                href={item.href}
                className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-12 py-12"
              >
                <span className="flex min-w-0 flex-col gap-2">
                  <span className="label-micro text-[var(--color-text-tertiary)]">
                    {item.entityCode}
                  </span>
                  <span className="body-small text-[var(--color-text-primary)]">
                    {item.title}
                  </span>
                </span>
                {item.severity === "flag" ? (
                  <StatusBadge status="rejected" label="Flag" size="small" />
                ) : (
                  <StatusBadge status="pending" label="Upcoming" size="small" />
                )}
                <ArrowRightIcon
                  size={14}
                  weight="bold"
                  className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(flagsTotal > 0 || total > displayedOpenCount) && (
        <div className="flex flex-wrap items-center justify-between gap-8 border-t border-[var(--color-border-tertiary)] px-20 py-10">
          {flagsTotal > 0 ? (
            <span className="label-micro text-[var(--st-bad)]">
              {flagsTotal} {flagsTotal === 1 ? "flag" : "flags"} from blocking checks
            </span>
          ) : (
            <span />
          )}
          {total > displayedOpenCount && (
            <span className="label-micro text-[var(--color-text-tertiary)]">
              Showing first {displayedOpenCount}
            </span>
          )}
        </div>
      )}
    </DashboardPanel>
  );
}
