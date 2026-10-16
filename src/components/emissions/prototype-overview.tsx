/**
 * PROTOTYPE overview C, "Ledger", fleshed out (Kenji 2026-10-16: "C is the
 * best"). Shared by detail variants C1, C2 and C3.
 *
 * KPI strip (StatCards, each one applies its status filter) → toolbar
 * (search by batch code, status, period presets plus a custom month range,
 * sort on phones) → credit batches × line states table with sortable headers
 * and a sticky header → facility activity totals behind their button. Filter
 * and sort live in the URL (prototype-ledger-query.ts).
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  FileXIcon,
  FunnelSimpleIcon,
  ListChecksIcon,
  MagnifyingGlassIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, DataTable, EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/ui";
import { TEMPORAL_INPUT_CLASSES } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PROTOTYPE_STATE_LABELS, type PrototypeLineState } from "./prototype-emissions-data";
import { ActivityTotals, DisclosureButton, batchPeriod, type usePrototypeEmissions } from "./prototype-emissions-shared";
import {
  BATCH_SORTS,
  BATCH_STATUS_FILTERS,
  BATCH_STATUS_LABELS,
  PERIOD_LABELS,
  PERIOD_PRESETS,
  facetBatches,
  ledgerRows,
  matchesStatus,
  useLedgerHref,
  useLedgerQuery,
  type BatchSort,
  type BatchStatusFilter,
  type BatchSummary,
  type PeriodPreset,
} from "./prototype-ledger-query";

type Data = ReturnType<typeof usePrototypeEmissions>;
export const OVERVIEW_SUBTITLE = "Every line your credit batches' Removal templates ask for.";
const COUNT_COLUMNS: PrototypeLineState[] = ["needsReview", "missingEvidence", "empty", "needsSetup"];
const SORT_LABELS: Record<BatchSort, string> = { period: "Period", open: "Open lines", code: "Credit batch" };
const TH = "px-16 py-10 font-medium text-left whitespace-nowrap bg-[var(--sea)] lg:sticky lg:top-0 lg:z-[1] lg:[box-shadow:inset_0_-1px_0_var(--color-border-tertiary)]";
const TD = "px-16 py-12";
const MONTH_INPUT = `h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-12 body-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] sm:w-[168px] ${TEMPORAL_INPUT_CLASSES}`;

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function LedgerOverview({ data }: { data: Data }) {
  const router = useRouter();
  const href = useLedgerHref();
  const { query, dir, setQuery, toggleSort, clear, hasFilters } = useLedgerQuery();
  const [totalsOpen, setTotalsOpen] = useState(false);
  const facet = facetBatches(data.batches, query);
  const rows = ledgerRows(data.batches, query, dir);

  return (
    <div className="container-max page-shell">
      <PageHeader area="infrastructure" title="Emissions" subtitle={OVERVIEW_SUBTITLE} />
      <OverviewKpis facet={facet} active={query.status} />

      <div className="[border:var(--panel-border)] bg-[var(--paper)]">
        <OverviewToolbar query={query} setQuery={setQuery} hasFilters={hasFilters} clear={clear} shown={rows.length} total={data.batches.length} />
        {rows.length === 0 ? (
          <div className="p-16 [border-top:var(--panel-head-border)]">
            <FilteredEmpty data={data} query={query} setQuery={setQuery} clear={clear} />
          </div>
        ) : (
          <div className="overflow-x-auto lg:overflow-visible">
            <table className="w-full body-small" aria-label="Credit batches by line state">
              <thead className="text-[var(--color-text-secondary)]">
                <tr>
                  <SortHeader sort="code" current={query.sort} dir={dir} onSort={toggleSort} />
                  <SortHeader sort="period" current={query.sort} dir={dir} onSort={toggleSort} className="hidden xl:table-cell" />
                  <th className={cn(TH, "hidden sm:table-cell")}>Status</th>
                  {COUNT_COLUMNS.map((state) => (
                    <th key={state} className={cn(TH, "hidden text-right lg:table-cell")}>{PROTOTYPE_STATE_LABELS[state]}</th>
                  ))}
                  <SortHeader sort="open" current={query.sort} dir={dir} onSort={toggleSort} className="text-right" label="Open" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <BatchRow key={row.view.batch.id} row={row} href={href(row.view.batch.id)} onOpen={() => router.push(href(row.view.batch.id))} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-12">
        <DisclosureButton open={totalsOpen} onToggle={() => setTotalsOpen((o) => !o)} className="self-start">Facility activity totals</DisclosureButton>
        {totalsOpen && <ActivityTotals batches={data.batches} facilityName={data.facilityName} />}
      </div>
    </div>
  );
}

/* ---------- KPI strip ---------- */

function OverviewKpis({ facet, active }: { facet: BatchSummary[]; active: BatchStatusFilter | null }) {
  const searchParams = useSearchParams();
  const statusHref = (status: BatchStatusFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    if (active === status) params.delete("status");
    else params.set("status", status);
    const qs = params.toString();
    return `/emissions${qs ? `?${qs}` : ""}`;
  };
  const sum = (pick: (row: BatchSummary) => number) => facet.reduce((total, row) => total + pick(row), 0);
  const count = (status: BatchStatusFilter) => facet.filter((row) => matchesStatus(row, status)).length;
  const inBatches = (n: number) => (n ? `In ${plural(n, "credit batch", "credit batches")}` : "In no credit batch");
  const tiles: { status: BatchStatusFilter; title: string; value: number; description: string; icon: React.ReactNode }[] = [
    { status: "open", title: "Lines open", value: sum((r) => r.open), description: inBatches(count("open")), icon: <ListChecksIcon size={24} weight="bold" /> },
    { status: "files", title: "Files missing", value: sum((r) => r.filesMissing), description: inBatches(count("files")), icon: <FileXIcon size={24} weight="bold" /> },
    { status: "review", title: "Needs review", value: sum((r) => r.review), description: inBatches(count("review")), icon: <WarningIcon size={24} weight="bold" /> },
    { status: "done", title: "Done", value: count("done"), description: count("done") === 1 ? "Credit batch, all lines recorded" : "Credit batches, all lines recorded", icon: <CheckCircleIcon size={24} weight="bold" /> },
  ];
  return (
    <div className="grid grid-cols-2 gap-12 md:gap-24 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Link
          key={tile.status}
          href={statusHref(tile.status)}
          scroll={false}
          aria-current={active === tile.status ? "true" : undefined}
          aria-label={`${tile.title}: ${tile.value}. ${active === tile.status ? "Showing only these. Select to show all." : "Select to filter."}`}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        >
          <StatCard
            interactive
            title={tile.title}
            value={tile.value}
            description={tile.description}
            icon={tile.icon}
            className={cn("h-full", active === tile.status && "[border-color:var(--color-interaction)] [box-shadow:inset_0_-3px_0_var(--color-interaction)]")}
          />
        </Link>
      ))}
    </div>
  );
}

/* ---------- toolbar ---------- */

type Query = ReturnType<typeof useLedgerQuery>["query"];
type SetQuery = ReturnType<typeof useLedgerQuery>["setQuery"];

function OverviewToolbar({ query, setQuery, hasFilters, clear, shown, total }: { query: Query; setQuery: SetQuery; hasFilters: boolean; clear: () => void; shown: number; total: number }) {
  return (
    <div className="flex flex-col gap-12 px-16 py-12">
      <div className="flex flex-col gap-8 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:max-w-[280px] sm:flex-1">
          <MagnifyingGlassIcon size={18} aria-hidden className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
          <input
            type="search"
            value={query.q}
            onChange={(event) => void setQuery({ q: event.target.value || null })}
            placeholder="Search by batch code"
            aria-label="Search credit batches by code"
            className="h-40 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-36 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
          />
        </div>
        <div className="grid grid-cols-2 gap-8 sm:flex sm:flex-wrap sm:items-center">
          <DataTable.FilterSelect
            value={query.status ?? ""}
            onChange={(event) => void setQuery({ status: (event.target.value || null) as BatchStatusFilter | null })}
            aria-label="Filter credit batches by line state"
          >
            <option value="">All states</option>
            {BATCH_STATUS_FILTERS.map((status) => <option key={status} value={status}>{BATCH_STATUS_LABELS[status]}</option>)}
          </DataTable.FilterSelect>
          <DataTable.FilterSelect
            value={query.period ?? ""}
            onChange={(event) => {
              const period = (event.target.value || null) as PeriodPreset | null;
              void setQuery(period === "custom" ? { period } : { period, from: null, to: null });
            }}
            aria-label="Filter credit batches by period"
          >
            <option value="">All periods</option>
            {PERIOD_PRESETS.map((period) => <option key={period} value={period}>{PERIOD_LABELS[period]}</option>)}
          </DataTable.FilterSelect>
          <DataTable.FilterSelect
            value={`${query.sort}`}
            onChange={(event) => void setQuery({ sort: event.target.value as BatchSort, dir: null })}
            aria-label="Sort credit batches"
            className="col-span-2 sm:hidden"
          >
            {BATCH_SORTS.map((sort) => <option key={sort} value={sort}>{`Sort by ${SORT_LABELS[sort].toLowerCase()}`}</option>)}
          </DataTable.FilterSelect>
          {hasFilters && (
            <Button variant="noOutline" size="small" onClick={clear} className="col-span-2 justify-self-start">
              <XIcon size={16} weight="bold" />
              Clear
            </Button>
          )}
        </div>
        <p className="body-caption text-[var(--color-text-tertiary)] sm:ml-auto" aria-live="polite">
          {shown === total ? plural(total, "credit batch", "credit batches") : `${shown} of ${plural(total, "credit batch", "credit batches")}`}
        </p>
      </div>
      {query.period === "custom" && (
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:gap-12">
          <label className="flex flex-col gap-4">
            <span className="body-small font-medium text-[var(--color-text-secondary)]">From</span>
            <input type="month" value={query.from ?? ""} max={query.to ?? undefined} onChange={(event) => void setQuery({ from: event.target.value || null })} className={MONTH_INPUT} />
          </label>
          <label className="flex flex-col gap-4">
            <span className="body-small font-medium text-[var(--color-text-secondary)]">To</span>
            <input type="month" value={query.to ?? ""} min={query.from ?? undefined} onChange={(event) => void setQuery({ to: event.target.value || null })} className={MONTH_INPUT} />
          </label>
        </div>
      )}
    </div>
  );
}

/* ---------- table ---------- */

function SortHeader({ sort, current, dir, onSort, className, label }: { sort: BatchSort; current: BatchSort; dir: "asc" | "desc"; onSort: (sort: BatchSort) => void; className?: string; label?: string }) {
  const active = sort === current;
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={cn(TH, "p-0", className)}>
      <button
        type="button"
        onClick={() => onSort(sort)}
        className={cn("inline-flex min-h-44 w-full items-center gap-4 px-16 font-medium hover:bg-[var(--clr-dark-purple-5)]", className?.includes("text-right") && "justify-end")}
      >
        {label ?? SORT_LABELS[sort]}
        <span className="inline-flex flex-col leading-none text-[var(--color-text-tertiary)]" aria-hidden="true">
          <CaretUpIcon size={10} weight={active && dir === "asc" ? "fill" : "regular"} className={active && dir === "asc" ? "text-[var(--color-interaction)]" : ""} />
          <CaretDownIcon size={10} weight={active && dir === "desc" ? "fill" : "regular"} className={active && dir === "desc" ? "text-[var(--color-interaction)]" : ""} />
        </span>
      </button>
    </th>
  );
}

function BatchRow({ row, href, onOpen }: { row: BatchSummary; href: string; onOpen: () => void }) {
  const { batch, lines } = row.view;
  const flags = COUNT_COLUMNS.filter((state) => row.counts[state]).map((state) => `${row.counts[state]} ${PROTOTYPE_STATE_LABELS[state].toLowerCase()}`);
  return (
    <tr onClick={onOpen} className="cursor-pointer [border-top:var(--row-divider)] hover:bg-[var(--row-hover-bg-solid)]">
      <td className={TD}>
        <Link href={href} onClick={(e) => e.stopPropagation()} className="font-medium text-[var(--acc-dist-ink)] underline-offset-4 hover:underline">{batch.code}</Link>
        <span className="block body-caption text-[var(--color-text-tertiary)] xl:hidden">{batchPeriod(batch)}</span>
        {flags.length > 0 && <span className="block body-caption text-[var(--color-text-secondary)] lg:hidden">{flags.join(", ")}</span>}
      </td>
      <td className={cn(TD, "hidden whitespace-nowrap xl:table-cell")}>{batchPeriod(batch)}</td>
      <td className={cn(TD, "hidden sm:table-cell")}><StatusBadge status={batch.status} size="small" /></td>
      {COUNT_COLUMNS.map((state) => (
        <td key={state} className={cn(TD, "hidden text-right tabular-nums lg:table-cell", !row.counts[state] && "text-[var(--color-text-tertiary)]")}>{row.counts[state]}</td>
      ))}
      <td className={cn(TD, "whitespace-nowrap text-right font-medium tabular-nums", !row.open && "font-normal text-[var(--color-text-tertiary)]")}>
        {`${row.open} of ${lines.length}`}
      </td>
    </tr>
  );
}

/* ---------- filtered empty state ---------- */

function FilteredEmpty({ data, query, setQuery, clear }: { data: Data; query: Query; setQuery: SetQuery; clear: () => void }) {
  type Key = "q" | "status" | "period";
  const active: { key: Key; name: string; text: string; reset: Partial<Query> }[] = [];
  if (query.status) active.push({ key: "status", name: "state", text: `state "${BATCH_STATUS_LABELS[query.status]}"`, reset: { status: null } });
  if (query.period) {
    const range = query.period === "custom" ? `${query.from ?? "any month"} to ${query.to ?? "any month"}` : PERIOD_LABELS[query.period];
    active.push({ key: "period", name: "period", text: `period "${range}"`, reset: { period: null, from: null, to: null } });
  }
  if (query.q) active.push({ key: "q", name: "search", text: `search "${query.q}"`, reset: { q: "" } });
  const without = active
    .map((filter) => ({ filter, count: ledgerRows(data.batches, { ...query, ...filter.reset }, "desc").length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);
  const best = without[0];
  const filters = active.map((filter) => filter.text);
  const named = filters.length > 1 ? `${filters.slice(0, -1).join(", ")} and ${filters.at(-1)}` : filters[0];
  const description = best
    ? `No credit batch matches ${named}. Without the ${best.filter.name} filter, ${plural(best.count, "credit batch matches", "credit batches match")}.`
    : `No credit batch matches ${named}.`;
  return (
    <EmptyState
      padding="md"
      icon={<FunnelSimpleIcon size={40} />}
      title="No credit batches match"
      description={description}
      action={
        <div className="flex flex-wrap justify-center gap-8">
          {best && active.length > 1 && (
            <Button variant="default" onClick={() => void setQuery(best.filter.reset)}>{`Remove ${best.filter.name} filter`}</Button>
          )}
          <Button variant={best && active.length > 1 ? "noOutline" : "default"} onClick={clear}>Clear filters</Button>
        </div>
      }
    />
  );
}
