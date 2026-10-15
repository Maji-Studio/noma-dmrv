"use client";

/**
 * The Traceability page's Activity segment: every recorded change to the
 * selected credit batch and its records, newest first, filterable by kind and
 * record type, loaded a page at a time.
 */
import { useState } from "react";
import { ClockCounterClockwiseIcon, FunnelSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { ACTIVITY_LIST_PAGE_SIZE } from "@/config/activity";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@/db/schema/common";
import { useCreditBatchActivity, useCreditBatchActivitySummary } from "@/hooks/use-credit-batch-activity";
import type { ActivityFilters } from "@/lib/activity-filters";
import {
  ACTIVITY_CLEAR_FILTERS_LABEL,
  ACTIVITY_EMPTY_TITLE,
  ACTIVITY_FILTERED_EMPTY_DESCRIPTION,
  ACTIVITY_FILTERED_EMPTY_TITLE,
  ACTIVITY_LOAD_ERROR,
  ACTIVITY_LOADING,
  ACTIVITY_SHOW_MORE_LABEL,
  ACTIVITY_TITLE,
  activityChangeCount,
  activityEmptyDescription,
  activityHistoryStartNote,
  activityLoadedMessage,
  activityRecordingStartLabel,
} from "./activity-copy";
import { ActivityEntry } from "./activity-entry";
import {
  ALL_FILTER_VALUE,
  activityFilterOptionLabel,
  activityKindOptions,
  activityRecordTypeOptions,
  hasActivityFilters,
  parseActivityFilter,
  type ActivityFilterOption,
} from "./activity-filter-options";

const EMPTY_ICON_PX = 48;
const FILTERED_ICON_PX = 40;
const SELECT_CLASS =
  "h-44 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small cursor-pointer " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] sm:w-auto sm:min-w-[200px]";

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: ActivityFilterOption[];
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <label className="flex flex-col gap-4">
      <span className="body-small font-medium text-[var(--color-text-secondary)]">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={SELECT_CLASS} data-testid={testId}>
        <option value={ALL_FILTER_VALUE}>{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{activityFilterOptionLabel(option)}</option>
        ))}
      </select>
    </label>
  );
}

export function CreditBatchActivityView({
  creditBatchId,
  facilityId,
  batchCode,
}: {
  creditBatchId: string;
  facilityId: string;
  /** Names the list for assistive tech; absent while the batch list loads. */
  batchCode?: string;
}) {
  const [filters, setFilters] = useState<ActivityFilters>({});
  // Index of the first row a "Show older activity" press added; that row takes focus once.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const summary = useCreditBatchActivitySummary(creditBatchId);
  const activity = useCreditBatchActivity(creditBatchId, { limit: ACTIVITY_LIST_PAGE_SIZE, filters });
  const items = activity.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = summary.data?.counts ?? [];
  const filtered = hasActivityFilters(filters);

  const setFilter = (next: ActivityFilters) => {
    setFocusIndex(null);
    setFilters(next);
  };
  const showMore = async () => {
    const before = items.length;
    const result = await activity.fetchNextPage();
    const after = result.data?.pages.flatMap((page) => page.items).length ?? before;
    if (after > before) {
      setFocusIndex(before);
      setAnnouncement(activityLoadedMessage(after - before));
    }
  };
  const focusFirstNew = (node: HTMLElement | null) => {
    if (!node) return;
    node.focus();
    setFocusIndex(null);
  };

  const body = (() => {
    if (activity.isError || summary.isError) {
      return (
        <Notice
          tone="warning"
          action={
            <Button
              variant="weak"
              size="small"
              busy={activity.isFetching || summary.isFetching}
              onClick={() => {
                void summary.refetch();
                void activity.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          {ACTIVITY_LOAD_ERROR}
        </Notice>
      );
    }
    if (activity.isPending || summary.isPending) {
      return <p role="status" className="body-small text-[var(--color-text-secondary)]">{ACTIVITY_LOADING}</p>;
    }
    if (items.length === 0 && filtered) {
      return (
        <EmptyState
          padding="md"
          icon={<FunnelSimpleIcon size={FILTERED_ICON_PX} weight="thin" />}
          title={ACTIVITY_FILTERED_EMPTY_TITLE}
          description={ACTIVITY_FILTERED_EMPTY_DESCRIPTION}
          action={<Button variant="weak" onClick={() => setFilter({})}>{ACTIVITY_CLEAR_FILTERS_LABEL}</Button>}
        />
      );
    }
    if (items.length === 0) {
      return (
        <EmptyState
          padding="lg"
          icon={<ClockCounterClockwiseIcon size={EMPTY_ICON_PX} weight="thin" />}
          title={ACTIVITY_EMPTY_TITLE}
          description={activityEmptyDescription()}
        />
      );
    }
    return (
      <div className="flex flex-col gap-16">
        <ul
          aria-label={batchCode ? `Activity for credit batch ${batchCode}` : ACTIVITY_TITLE}
          className="divide-y divide-[var(--color-border-tertiary)] border-y border-[var(--color-border-tertiary)]"
          data-testid="activity-list"
        >
          {items.map((item, index) => (
            <ActivityEntry
              key={item.id}
              item={item}
              facilityId={facilityId}
              creditBatchId={creditBatchId}
              focusRef={index === focusIndex ? focusFirstNew : undefined}
            />
          ))}
        </ul>
        {activity.hasNextPage ? (
          <Button
            variant="weak"
            className="min-h-44 w-full sm:w-auto sm:self-start"
            busy={activity.isFetchingNextPage}
            onClick={() => void showMore()}
          >
            {ACTIVITY_SHOW_MORE_LABEL}
          </Button>
        ) : (
          <p className="body-caption text-[var(--color-text-tertiary)]">{activityHistoryStartNote()}</p>
        )}
      </div>
    );
  })();

  const hasAnyActivity = (summary.data?.total ?? 0) > 0;
  return (
    <div className="absolute inset-0 overflow-auto bg-[var(--bg)]" data-testid="credit-batch-activity-view">
      <div className="container-max flex flex-col gap-20 py-24">
        <div className="content-measure-preview flex flex-col gap-20">
          <div className="flex flex-col gap-4">
            <h2 className="title-heading-3">{ACTIVITY_TITLE}</h2>
            <p className="body-small text-[var(--color-text-secondary)]">
              {hasAnyActivity
                ? `${activityChangeCount(summary.data!.total)} to this credit batch and its records since ${activityRecordingStartLabel()}. Newest first.`
                : "Changes to this credit batch and its records, newest first."}
            </p>
          </div>
          {hasAnyActivity ? (
            <div className="flex flex-col gap-12 sm:flex-row sm:flex-wrap sm:items-end" role="group" aria-label="Filter activity">
              <FilterSelect
                label="Kind"
                allLabel="All kinds"
                value={filters.action ?? ALL_FILTER_VALUE}
                options={activityKindOptions(counts, filters.action)}
                onChange={(value) => setFilter({ ...filters, action: parseActivityFilter(value, ACTIVITY_ACTIONS) })}
                testId="activity-kind-filter"
              />
              <FilterSelect
                label="Record type"
                allLabel="All record types"
                value={filters.entityType ?? ALL_FILTER_VALUE}
                options={activityRecordTypeOptions(counts, filters.entityType)}
                onChange={(value) => setFilter({ ...filters, entityType: parseActivityFilter(value, ACTIVITY_ENTITY_TYPES) })}
                testId="activity-record-type-filter"
              />
              {/* The filtered-empty card carries its own clear action; one is enough. */}
              {filtered && items.length > 0 ? (
                <Button variant="noOutline" className="min-h-44 self-start sm:self-auto" onClick={() => setFilter({})}>
                  {ACTIVITY_CLEAR_FILTERS_LABEL}
                </Button>
              ) : null}
            </div>
          ) : null}
          {body}
          <p role="status" className="sr-only">{announcement}</p>
        </div>
      </div>
    </div>
  );
}
