/**
 * The Emissions overview's toolbar: search by batch code, line state, period
 * presets plus a custom month range, and a sort select on phones (the table
 * headers sort on wider screens). Every control writes the URL.
 */
"use client";

import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, DataTable } from "@/components/ui";
import { TEMPORAL_INPUT_CLASSES } from "@/components/ui/input";
import { formatCount } from "@/lib/copy-utils";
import {
  BATCH_SORTS,
  BATCH_SORT_LABELS,
  BATCH_STATUS_FILTERS,
  BATCH_STATUS_LABELS,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  type BatchSort,
  type BatchStatusFilter,
  type EmissionsOverviewQuery,
  type PeriodPreset,
  type SetEmissionsOverviewQuery,
} from "./emissions-overview-query";

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";
const MONTH_INPUT = `h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small sm:w-[168px] ${FOCUS_RING} ${TEMPORAL_INPUT_CLASSES}`;

function isOneOf<T extends string>(options: readonly T[], value: string): value is T {
  return (options as readonly string[]).includes(value);
}

interface EmissionsOverviewToolbarProps {
  query: EmissionsOverviewQuery;
  setQuery: SetEmissionsOverviewQuery;
  hasFilters: boolean;
  onClear: () => void;
  shown: number;
  total: number;
}

export function EmissionsOverviewToolbar({ query, setQuery, hasFilters, onClear, shown, total }: EmissionsOverviewToolbarProps) {
  const totalText = formatCount(total, "credit batch", "credit batches");
  return (
    <div className="flex flex-col gap-12 px-16 py-12">
      <div className="flex flex-col gap-8 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-[280px] sm:flex-1">
          <MagnifyingGlassIcon
            size={18}
            aria-hidden
            className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          />
          <input
            type="search"
            value={query.q}
            onChange={(event) => void setQuery({ q: event.target.value || null })}
            placeholder="Search by batch code"
            aria-label="Search credit batches by code"
            className={`h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] ${FOCUS_RING}`}
          />
        </div>
        <div className="grid grid-cols-2 gap-8 sm:flex sm:flex-wrap sm:items-center">
          <DataTable.FilterSelect
            value={query.status ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              void setQuery({ status: isOneOf<BatchStatusFilter>(BATCH_STATUS_FILTERS, value) ? value : null });
            }}
            aria-label="Filter credit batches by line state"
          >
            <option value="">All states</option>
            {BATCH_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>{BATCH_STATUS_LABELS[status]}</option>
            ))}
          </DataTable.FilterSelect>
          <DataTable.FilterSelect
            value={query.period ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              const period = isOneOf<PeriodPreset>(PERIOD_PRESETS, value) ? value : null;
              void setQuery(period === "custom" ? { period } : { period, from: null, to: null });
            }}
            aria-label="Filter credit batches by period"
          >
            <option value="">All periods</option>
            {PERIOD_PRESETS.map((period) => (
              <option key={period} value={period}>{PERIOD_LABELS[period]}</option>
            ))}
          </DataTable.FilterSelect>
          <DataTable.FilterSelect
            value={query.sort}
            onChange={(event) => {
              const value = event.target.value;
              if (isOneOf<BatchSort>(BATCH_SORTS, value)) void setQuery({ sort: value, dir: null });
            }}
            aria-label="Sort credit batches"
            className="col-span-2 sm:hidden"
          >
            {BATCH_SORTS.map((sort) => (
              <option key={sort} value={sort}>{`Sort by ${BATCH_SORT_LABELS[sort].toLowerCase()}`}</option>
            ))}
          </DataTable.FilterSelect>
          {hasFilters && (
            <Button variant="noOutline" size="small" onClick={onClear} className="col-span-2 justify-self-start">
              <XIcon size={16} weight="bold" aria-hidden />
              Clear
            </Button>
          )}
        </div>
        <p className="body-caption text-[var(--color-text-tertiary)] sm:ml-auto" aria-live="polite">
          {shown === total ? totalText : `${shown} of ${totalText}`}
        </p>
      </div>
      {query.period === "custom" && (
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:gap-12">
          <label className="flex flex-col gap-4">
            <span className="body-small font-medium text-[var(--color-text-secondary)]">From</span>
            <input
              type="month"
              value={query.from ?? ""}
              max={query.to ?? undefined}
              onChange={(event) => void setQuery({ from: event.target.value || null })}
              className={MONTH_INPUT}
            />
          </label>
          <label className="flex flex-col gap-4">
            <span className="body-small font-medium text-[var(--color-text-secondary)]">To</span>
            <input
              type="month"
              value={query.to ?? ""}
              min={query.from ?? undefined}
              onChange={(event) => void setQuery({ to: event.target.value || null })}
              className={MONTH_INPUT}
            />
          </label>
        </div>
      )}
    </div>
  );
}
