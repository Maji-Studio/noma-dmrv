"use client";

import {
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";

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
const DATE_CLASS =
  "h-40 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-10 body-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";

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

  return (
    <section className="flex flex-col gap-12 bg-[var(--panel-bg)] [border:var(--panel-border)] p-16">
      <div className="flex flex-wrap items-end gap-12">
        <div className="relative min-w-[240px] flex-1 sm:max-w-[320px]">
          <MagnifyingGlassIcon
            size={18}
            aria-hidden
            className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search by batch code or feedstock..."
            aria-label="Search credit batches"
            className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
          />
        </div>

        <label className="flex min-w-[150px] flex-1 flex-col gap-4 sm:flex-none">
          <span className="label-micro text-[var(--color-text-tertiary)]">
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
          <span className="label-micro text-[var(--color-text-tertiary)]">
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
          <span className="label-micro text-[var(--color-text-tertiary)]">
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
          <span className="label-micro text-[var(--color-text-tertiary)]">
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
            <option value="ready">Data complete</option>
          </select>
        </label>

        {hasActiveFilters && (
          <Button variant="noOutline" size="small" onClick={onClear}>
            <XIcon size={16} weight="bold" />
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
  );
}
