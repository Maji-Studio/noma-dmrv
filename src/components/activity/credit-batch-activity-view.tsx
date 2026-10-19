"use client";

/**
 * The Activities view (Traceability's Activity segment and the batch page tab): every recorded change to the
 * selected credit batch and its records as a timeline on a panel, newest first, one rail per day,
 * filterable by kind and record type, loaded a page at a time.
 */
import { useId, useState } from "react";
import { ClockCounterClockwiseIcon, FunnelSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState } from "@/components/ui";
import { DataTable } from "@/components/ui/data-table";
import { ACTIVITY_LIST_PAGE_SIZE } from "@/config/activity";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@/db/schema/common";
import { useCreditBatchActivity, useCreditBatchActivitySummary } from "@/hooks/use-credit-batch-activity";
import type { ActivityFilters } from "@/lib/activity-filters";
import {
  ACTIVITY_CLEAR_FILTERS_LABEL,
  ACTIVITY_EMPTY_TITLE,
  ACTIVITY_FILTERED_EMPTY_DESCRIPTION,
  ACTIVITY_FILTERED_EMPTY_TITLE,
  ACTIVITY_LOADING,
  ACTIVITY_SHOW_MORE_LABEL,
  ACTIVITY_TITLE,
  activityEmptyDescription,
  activityHistoryStartNote,
  activityLoadedMessage,
} from "./activity-copy";
import { groupActivityByDay } from "./activity-day-groups";
import { ActivityEntry } from "./activity-entry";
import { ActivityLoadError } from "./activity-load-error";
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
const FILTER_ICON_PX = 14;
/** A quiet compact select: small text, 44px tall at every breakpoint for touch. */
const SELECT_SIZE_CLASS = "h-44 w-auto max-w-full px-8 body-caption";
/** The shared panel recipe of the credit batch page tabs: paper on a plum hairline. */
const PANEL_CLASS = "flex min-w-0 flex-col gap-20 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-16 sm:p-24";
/** The hollow marker that closes the rail where recording began. */
const RAIL_END_DOT_CLASS = "size-8 rounded-full border border-[var(--color-border-primary)] bg-[var(--paper)]";
/** Spans the list's 24px gap (`gap-24` above) from the last node down to the marker. */
const RAIL_END_LINK_CLASS = "absolute -top-24 bottom-1/2 left-16 -translate-x-1/2 border-l border-dashed border-[var(--color-border-secondary)]";

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
    <DataTable.FilterSelect
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={SELECT_SIZE_CLASS}
      data-testid={testId}
    >
      <option value={ALL_FILTER_VALUE}>{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{activityFilterOptionLabel(option)}</option>
      ))}
    </DataTable.FilterSelect>
  );
}

export function CreditBatchActivityView({
  creditBatchId,
  batchCode,
  inline = false,
}: {
  creditBatchId: string;
  /** Names the list for assistive tech; absent while the batch list loads. */
  batchCode?: string;
  /**
   * Render in page flow (a tab on the credit batch page) instead of filling the
   * Traceability canvas. Drops the overlay and the container; the panel is the same.
   */
  inline?: boolean;
}) {
  const [filters, setFilters] = useState<ActivityFilters>({});
  // Index of the first row a "Show older activity" press added; that row takes focus once.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const headingId = useId();
  const summary = useCreditBatchActivitySummary(creditBatchId);
  const activity = useCreditBatchActivity(creditBatchId, { limit: ACTIVITY_LIST_PAGE_SIZE, filters });
  const items = activity.data?.pages.flatMap((page) => page.items) ?? [];
  const dayGroups = groupActivityByDay(items);
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
      return <ActivityLoadError queries={[summary, activity]} />;
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
          // The card's action wrapper sets a 40px floor; the touch target needs 44px.
          action={<Button variant="weak" className="!min-h-44" onClick={() => setFilter({})}>{ACTIVITY_CLEAR_FILTERS_LABEL}</Button>}
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
      <div className="flex flex-col gap-24">
        <ol
          aria-label={batchCode ? `Activities for credit batch ${batchCode}` : ACTIVITY_TITLE}
          className="flex flex-col gap-24"
          data-testid="activity-list"
        >
          {dayGroups.map((group) => (
            <li key={group.key} className="flex flex-col gap-12">
              <h3 className="body-small font-medium text-[var(--color-text-secondary)]">{group.label}</h3>
              <ol className="flex flex-col">
                {group.items.map((item) => (
                  <ActivityEntry
                    key={item.id}
                    item={item}
                    creditBatchId={creditBatchId}
                    focusRef={items.indexOf(item) === focusIndex ? focusFirstNew : undefined}
                  />
                ))}
              </ol>
            </li>
          ))}
        </ol>
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
          // The rail's far end: a dashed run from the last node to a hollow
          // marker where recording began, as nothing earlier is listed.
          <p className="relative grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-12 body-caption text-[var(--color-text-tertiary)]">
            <span aria-hidden className={RAIL_END_LINK_CLASS} />
            <span aria-hidden className="relative flex justify-center">
              <span className={RAIL_END_DOT_CLASS} />
            </span>
            <span>{activityHistoryStartNote()}</span>
          </p>
        )}
      </div>
    );
  })();

  const hasAnyActivity = (summary.data?.total ?? 0) > 0;
  const content = (
    <section aria-labelledby={headingId} className={PANEL_CLASS}>
      <div className="flex min-h-40 flex-wrap items-center justify-between gap-12">
        <h2 id={headingId} className="title-heading-3">{ACTIVITY_TITLE}</h2>
        {hasAnyActivity ? (
          <div className="flex flex-wrap items-center gap-8" role="group" aria-label="Filter activity">
            <FunnelSimpleIcon size={FILTER_ICON_PX} aria-hidden className="text-[var(--color-text-tertiary)]" />
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
              <Button variant="noOutline" size="small" className="min-h-44" onClick={() => setFilter({})}>
                {ACTIVITY_CLEAR_FILTERS_LABEL}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {body}
      <p role="status" className="sr-only">{announcement}</p>
    </section>
  );
  if (inline) {
    return <div data-testid="credit-batch-activity-view">{content}</div>;
  }
  return (
    <div className="absolute inset-0 overflow-auto bg-[var(--bg)]" data-testid="credit-batch-activity-view">
      <div className="container-max flex flex-col gap-20 py-24">{content}</div>
    </div>
  );
}
