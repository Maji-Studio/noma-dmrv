/**
 * AttentionList — the compact "needs attention" panel under the hero: the
 * actual open items behind the scene's badges, each row deep-linking to the
 * record to fix. The hero shows the counts; this shows the rows.
 */
"use client";

import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { DashboardAttentionItem } from "@/data-access/dashboard-overview";
import type { DashboardStructuralGap } from "@/data-access/dashboard-structural-gaps";
import { STATUS_STATE_COLOR_TOKENS } from "@/lib/status-state";
import { deriveAttentionSummaryState } from "./dashboard-status-state";
import {
  DashboardAttentionRow,
  formatDashboardRecordMetadata,
} from "./dashboard-attention-row";
import { DashboardPanel } from "./dashboard-panel";
import { StructuralGapList } from "./structural-gap-list";

interface AttentionListProps {
  attention: DashboardAttentionItem[];
  structuralGaps: DashboardStructuralGap[];
  /** Exact uncapped count of open items; `attention` is a capped sample of it. */
  total: number;
}

export function AttentionList({
  attention,
  structuralGaps,
  total,
}: AttentionListProps) {
  const structuralGapTotal = structuralGaps.reduce(
    (sum, gap) => sum + gap.count,
    0,
  );
  const displayedOpenCount = structuralGapTotal + attention.length;
  const summaryState = deriveAttentionSummaryState(total);

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
            <DashboardAttentionRow
              key={item.id}
              href={item.href}
              metadata={formatDashboardRecordMetadata(item.entityCode, item.date)}
              title={item.title}
              divided={index > 0}
            />
          ))}
        </ul>
      )}
      {total > displayedOpenCount && (
        <div className="border-t border-[var(--color-border-tertiary)] px-20 py-10">
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Showing first {displayedOpenCount} of {total}
          </span>
        </div>
      )}
    </DashboardPanel>
  );
}
