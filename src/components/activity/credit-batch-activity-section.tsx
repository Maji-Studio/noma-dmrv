"use client";

/**
 * The credit batch side sheet's Activity section: changes by kind, the last
 * change and who made it, the latest few entries, and the way to the full
 * Activity segment on the Traceability page.
 */
import Link from "next/link";
import { ArrowRightIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { StockRows } from "@/components/storage-locations/stock-figures";
import { ACTIVITY_SHEET_PREVIEW_LIMIT } from "@/config/activity";
import { useCreditBatchActivity, useCreditBatchActivitySummary } from "@/hooks/use-credit-batch-activity";
import { traceabilityActivityHref } from "@/lib/certification/links";
import { formatDateTime } from "@/lib/format-utils";
import {
  ACTIVITY_EMPTY_TITLE,
  ACTIVITY_LOADING,
  ACTIVITY_OPEN_ALL_LABEL,
  activityChangeCount,
  activityEmptyDescription,
} from "./activity-copy";
import { activityActorDisplay, activityActorText } from "./activity-display";
import { ActivityEntry } from "./activity-entry";
import { ActivityLoadError } from "./activity-load-error";
import { activityKindTotals } from "./activity-filter-options";

const EMPTY_ICON_PX = 32;

export function CreditBatchActivitySection({
  creditBatchId,
  facilityId,
}: {
  creditBatchId: string;
  facilityId: string;
}) {
  const summary = useCreditBatchActivitySummary(creditBatchId);
  const latest = useCreditBatchActivity(creditBatchId, { limit: ACTIVITY_SHEET_PREVIEW_LIMIT });

  if (summary.isError || latest.isError) {
    return <ActivityLoadError queries={[summary, latest]} />;
  }
  if (summary.isPending || latest.isPending) {
    return <span role="status" className="body-caption text-[var(--color-text-tertiary)]">{ACTIVITY_LOADING}</span>;
  }
  if (summary.data.total === 0 || !summary.data.latest) {
    return (
      <EmptyState
        padding="sm"
        icon={<ClockCounterClockwiseIcon size={EMPTY_ICON_PX} weight="thin" />}
        title={ACTIVITY_EMPTY_TITLE}
        description={activityEmptyDescription()}
      />
    );
  }

  const last = summary.data.latest;
  const actor = activityActorDisplay(last);
  const entries = latest.data.pages[0]?.items.slice(0, ACTIVITY_SHEET_PREVIEW_LIMIT) ?? [];
  return (
    <div className="flex flex-col gap-16" data-testid="credit-batch-activity-section">
      <StockRows
        label="Activity summary"
        rows={[
          {
            label: "Last change",
            value: `${formatDateTime(last.occurredAt)} by ${activityActorText(actor)}`,
          },
          ...activityKindTotals(summary.data.counts).map((kind) => ({ label: kind.label, value: kind.count.toLocaleString() })),
        ]}
      />
      <div className="flex flex-col gap-8">
        <h4 className="body-caption font-medium text-[var(--color-text-secondary)]">Latest changes</h4>
        <ul className="divide-y divide-[var(--color-border-tertiary)] border-y border-[var(--color-border-tertiary)]">
          {entries.map((item) => (
            <ActivityEntry key={item.id} item={item} creditBatchId={creditBatchId} showDate />
          ))}
        </ul>
      </div>
      <Link
        href={traceabilityActivityHref(creditBatchId, facilityId)}
        className="inline-flex min-h-44 items-center gap-6 self-start body-small font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
      >
        {ACTIVITY_OPEN_ALL_LABEL} ({activityChangeCount(summary.data.total)})
        <ArrowRightIcon size={14} aria-hidden />
      </Link>
    </div>
  );
}
