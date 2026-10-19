"use client";

/**
 * The List view's controls: search stays in view, and the From, To, Feedstock
 * and Data status filters fold behind a "Filters" button that counts the active
 * ones, so a phone's first screen shows batches rather than a form.
 */
import { useId, useState } from "react";
import {
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { TEMPORAL_INPUT_CLASSES } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type CreditBatchReadinessFilter = "all" | "needs_attention" | "ready";

export interface CreditBatchFeedstockFilterOption {
  id: string;
  name: string;
}

interface CreditBatchFiltersProps {
  search: string;
  startDate: string;
  endDate: string;
  readiness: CreditBatchReadinessFilter;
  feedstocks: CreditBatchFeedstockFilterOption[];
  selectedFeedstockIds: string[];
  hasActiveFilters: boolean;
  onSearchChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onReadinessChange: (value: CreditBatchReadinessFilter) => void;
  onAddFeedstock: (id: string) => void;
  onRemoveFeedstock: (id: string) => void;
  onClear: () => void;
}

const SELECT_CLASS =
  "h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small cursor-pointer";
/** How many of the folded filters are set: From, To, Feedstock (any number of them counts once) and Data status. */
export function activeFilterCount({
  startDate,
  endDate,
  selectedFeedstockIds,
  readiness,
}: {
  startDate: string;
  endDate: string;
  selectedFeedstockIds: string[];
  readiness: CreditBatchReadinessFilter;
}): number {
  return [startDate !== "", endDate !== "", selectedFeedstockIds.length > 0, readiness !== "all"].filter(Boolean).length;
}

const DATE_CLASS =
  `h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] ${TEMPORAL_INPUT_CLASSES}`;

export function CreditBatchFilters({
  search,
  startDate,
  endDate,
  readiness,
  feedstocks,
  selectedFeedstockIds,
  hasActiveFilters,
  onSearchChange,
  onStartDateChange,
  onEndDateChange,
  onReadinessChange,
  onAddFeedstock,
  onRemoveFeedstock,
  onClear,
}: CreditBatchFiltersProps) {
  const selectedIds = new Set(selectedFeedstockIds);
  const availableFeedstocks = feedstocks.filter(
    (feedstock) => !selectedIds.has(feedstock.id),
  );
  const selectedFeedstocks = feedstocks.filter((feedstock) =>
    selectedIds.has(feedstock.id),
  );
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const activeCount = activeFilterCount({ startDate, endDate, selectedFeedstockIds, readiness });

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-center gap-8">
        <div className="relative min-w-[160px] flex-1 sm:max-w-[320px]">
          <MagnifyingGlassIcon
            size={18}
            aria-hidden
            className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search batches"
            aria-label="Search credit batches"
            className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] [&::-webkit-search-cancel-button]:mx-0"
          />
        </div>

        <Button
          variant={open ? "primary" : "default"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          <FunnelSimpleIcon size={20} weight="bold" aria-hidden />
          Filters
          {activeCount > 0 && (
            <span
              className={cn(
                "inline-flex h-20 min-w-20 items-center justify-center px-4 body-caption-fit tabular-nums",
                open ? "bg-[var(--paper)] text-[var(--ink)]" : "bg-[var(--ink)] text-[var(--paper)]",
              )}
            >
              <span className="sr-only">, </span>
              {activeCount}
              <span className="sr-only"> active</span>
            </span>
          )}
        </Button>
      </div>

      {open && (
        <section
          id={panelId}
          aria-label="Filters"
          className="flex flex-col gap-12 bg-[var(--panel-bg)] [border:var(--panel-border)] p-16"
        >
          <div className="flex flex-wrap items-end gap-12">
            <label className="flex min-w-[150px] flex-1 flex-col gap-4 sm:flex-none">
              <span className="body-small font-medium text-[var(--color-text-secondary)]">
                From
              </span>
              <input
                type="date"
                value={startDate}
                max={endDate || undefined}
                onChange={(event) => onStartDateChange(event.target.value)}
                className={DATE_CLASS}
              />
            </label>

            <label className="flex min-w-[150px] flex-1 flex-col gap-4 sm:flex-none">
              <span className="body-small font-medium text-[var(--color-text-secondary)]">
                To
              </span>
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => onEndDateChange(event.target.value)}
                className={DATE_CLASS}
              />
            </label>

            <label className="flex min-w-[190px] flex-1 flex-col gap-4 sm:flex-none">
              <span className="body-small font-medium text-[var(--color-text-secondary)]">
                Feedstock
              </span>
              <select
                value=""
                onChange={(event) => {
                  if (event.target.value) onAddFeedstock(event.target.value);
                }}
                className={SELECT_CLASS}
                aria-label="Add feedstock filter"
              >
                <option value="">
                  {selectedFeedstockIds.length === 0
                    ? "All feedstocks"
                    : availableFeedstocks.length > 0
                      ? "Add feedstock…"
                      : "All selected"}
                </option>
                {availableFeedstocks.map((feedstock) => (
                  <option key={feedstock.id} value={feedstock.id}>
                    {feedstock.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[180px] flex-1 flex-col gap-4 sm:flex-none">
              <span className="body-small font-medium text-[var(--color-text-secondary)]">
                Data status
              </span>
              <select
                value={readiness}
                onChange={(event) =>
                  onReadinessChange(
                    event.target.value as CreditBatchReadinessFilter,
                  )
                }
                className={SELECT_CLASS}
                aria-label="Filter by certification data status"
              >
                <option value="all">All batches</option>
                <option value="needs_attention">Needs attention</option>
                <option value="ready">Ready for submission</option>
              </select>
            </label>

            {hasActiveFilters && (
              <Button variant="noOutline" onClick={onClear}>
                <XIcon size={16} weight="bold" aria-hidden />
                Clear
              </Button>
            )}
          </div>

          {selectedFeedstocks.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-6"
              aria-label="Selected feedstocks"
            >
              {selectedFeedstocks.map((feedstock) => (
                <Button
                  key={feedstock.id}
                  variant="weak"
                  size="small"
                  onClick={() => onRemoveFeedstock(feedstock.id)}
                  aria-label={`Remove ${feedstock.name} filter`}
                >
                  {feedstock.name}
                  <XIcon size={12} weight="bold" aria-hidden />
                </Button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
