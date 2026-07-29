/**
 * StorageBinBoard — the storage page's content: a control rail and a grid of
 * silo tiles.
 *
 * The rail does two jobs at once, which is why the page carries no KPI strip:
 * filtering by bin type and reporting what is on hand in each. Those numbers
 * come from the server's `laneSummary`, which is computed independently of the
 * type filter, so they stay facility-wide however the grid is filtered.
 *
 * Ordering is server-side throughout (see `storageLocationSortKeys`). The board
 * never re-sorts the page it is handed: that would order twenty rows and call it
 * an order over hundreds.
 */
"use client";

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarehouseIcon,
  XIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, ListPagination } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { LIST_PAGE_SIZE_OPTIONS } from "@/config/list-controls";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { formatMass } from "@/lib/format-utils";
import {
  BIN_SORT_OPTIONS,
  BIN_TYPE_FILTER_ORDER,
  BIN_TYPE_META,
  binTypeFilterLabel,
  type StorageBinTypeFilter,
} from "./bin-display";
import { StorageBinTile, type BinRowAction } from "./storage-bin-tile";

/** Placeholder tiles while the first page loads — roughly one grid row on a
 *  laptop, enough to show the shape without pretending to know the count. */
const LOADING_TILES = 8;

/** Below this, one page holds everything and pagination has nothing to offer. */
const SMALLEST_PAGE_SIZE = Math.min(...LIST_PAGE_SIZE_OPTIONS);

const CONTROL_CLASSES =
  "h-36 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] px-10 body-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]";

export type LaneSummary = Record<
  StorageLocationType,
  { binCount: number; onHandKg: number }
>;

export interface StorageBinBoardProps {
  bins: StorageLocationWithFacility[];
  isLoading: boolean;
  /**
   * True while the grid is showing the *previous* filter's bins because the
   * current one is still in flight. Those tiles are real bins, but they are the
   * answer to a question the operator has already moved on from, so the grid
   * goes inert until the new page lands.
   */
  isStale: boolean;
  laneSummary: LaneSummary | undefined;
  /** Bins matching the current filters, across all pages. */
  total: number;

  searchQuery: string;
  onSearchChange: (value: string) => void;
  typeFilter: StorageBinTypeFilter;
  onTypeFilterChange: (value: StorageBinTypeFilter) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;

  page: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;

  onCreate: () => void;
  onView: (bin: StorageLocationWithFacility) => void;
  onEdit: (bin: StorageLocationWithFacility) => void;
  onArchive: (binId: string) => void;
  onRestore: (binId: string) => void;
  onDelete: (binId: string) => void;
  onReconcile: (bin: StorageLocationWithFacility) => void;
}

/**
 * Facility-wide bin count for a filter value, or null before the first payload
 * lands. Null rather than 0: an unanswered question is not an answer of none.
 */
function filterBinCount(
  summary: LaneSummary | undefined,
  filter: StorageBinTypeFilter,
): number | null {
  if (!summary) return null;
  if (filter === "all") {
    return (
      summary.feedstock_bin.binCount +
      summary.biochar_bin.binCount +
      summary.product_bin.binCount
    );
  }
  return summary[filter].binCount;
}

/**
 * The figure a filter row leads with: on-hand mass per type, a bin count for
 * "all". Feedstock is dry mass and product is packed mass, so their sum is not
 * a certifiable quantity and is never shown as one.
 *
 * Facility roll-ups use auto-tonne `formatMass`; per-bin figures on the tiles
 * stay fixed kg.
 */
function filterFigure(
  summary: LaneSummary | undefined,
  filter: StorageBinTypeFilter,
): string {
  if (!summary) return "Not available";
  if (filter === "all") {
    const bins = filterBinCount(summary, "all") ?? 0;
    return `${bins} ${bins === 1 ? "bin" : "bins"}`;
  }
  return formatMass(summary[filter].onHandKg);
}

/**
 * Row actions for one bin. Reconcile leads: it is the only item an operator
 * comes to this menu for in a hurry. Archive and restore are reversible, so
 * neither is marked destructive.
 */
function binRowActions(
  bin: StorageLocationWithFacility,
  handlers: Pick<
    StorageBinBoardProps,
    "onEdit" | "onArchive" | "onRestore" | "onDelete" | "onReconcile"
  >,
): BinRowAction[] {
  if (bin.archivedAt != null) {
    return [
      {
        label: "Restore",
        icon: <ArrowCounterClockwiseIcon size={16} />,
        onSelect: () => handlers.onRestore(bin.id),
      },
    ];
  }
  return [
    {
      label: "Reconcile stock",
      icon: <ArrowsClockwiseIcon size={16} />,
      onSelect: () => handlers.onReconcile(bin),
    },
    {
      label: "Edit",
      icon: <PencilSimpleIcon size={16} />,
      onSelect: () => handlers.onEdit(bin),
    },
    {
      label: "Archive",
      icon: <ArchiveIcon size={16} />,
      onSelect: () => handlers.onArchive(bin.id),
    },
    {
      label: "Delete permanently",
      icon: <TrashIcon size={16} />,
      destructive: true,
      onSelect: () => handlers.onDelete(bin.id),
    },
  ];
}

export function StorageBinBoard(props: StorageBinBoardProps) {
  const {
    bins,
    isLoading,
    isStale,
    laneSummary,
    total,
    searchQuery,
    onSearchChange,
    typeFilter,
    onTypeFilterChange,
    sortValue,
    onSortChange,
    showArchived,
    onToggleArchived,
    hasActiveFilters,
    onClearFilters,
    onCreate,
    onView,
    onReconcile,
  } = props;

  return (
    <div className="flex flex-col gap-16 lg:flex-row lg:items-start lg:gap-24">
      <aside className="flex shrink-0 flex-col gap-16 lg:sticky lg:top-24 lg:w-[212px]">
        {/* The type filter leads, and labels itself: every row names a bin type
            and carries what is on hand in it. Below lg it collapses to one
            dropdown, because a four-cell strip at that width either wraps or
            scrolls sideways, and a sideways-scrolling filter hides options
            behind a gesture nobody performs. */}
        <select
          value={typeFilter}
          onChange={(event) =>
            onTypeFilterChange(event.target.value as StorageBinTypeFilter)
          }
          aria-label="Filter by bin type"
          className={`${CONTROL_CLASSES} lg:hidden`}
        >
          {BIN_TYPE_FILTER_ORDER.map((filter) => (
            <option key={filter} value={filter}>
              {binTypeFilterLabel(filter)} ({filterFigure(laneSummary, filter)})
            </option>
          ))}
        </select>

        <nav
          aria-label="Filter by bin type"
          className="hidden lg:flex lg:flex-col lg:[border:var(--panel-border)] lg:bg-[var(--panel-bg)]"
        >
          {BIN_TYPE_FILTER_ORDER.map((filter) => (
            <RailFilter
              key={filter}
              filter={filter}
              isActive={filter === typeFilter}
              count={filterBinCount(laneSummary, filter)}
              figure={filterFigure(laneSummary, filter)}
              onSelect={() => onTypeFilterChange(filter)}
            />
          ))}
        </nav>

        <div className="relative">
          <MagnifyingGlassIcon
            size={16}
            className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          />
          <input
            type="text"
            placeholder="Search by code or name…"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className={`${CONTROL_CLASSES} pl-32 pr-12 placeholder:text-[var(--color-text-tertiary)]`}
            aria-label="Search storage"
          />
        </div>

        {/* The select shows a value ("Recent activity"), not what it acts on,
            so this one control does need a label. */}
        <label className="flex flex-col gap-6">
          <span className="label-micro text-[var(--color-text-tertiary)]">Sort by</span>
          <select
            value={sortValue}
            onChange={(event) => onSortChange(event.target.value)}
            className={CONTROL_CLASSES}
          >
            {BIN_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center justify-between gap-8">
          <label className="flex cursor-pointer items-center gap-8 body-small text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={onToggleArchived}
              className="size-16 shrink-0 accent-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
            />
            Show archived
          </label>
          {hasActiveFilters && (
            <Button variant="noOutline" size="small" onClick={onClearFilters}>
              <XIcon size={16} weight="bold" />
              Clear
            </Button>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-16">
        {isLoading ? (
          <div
            className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-12"
            aria-busy="true"
          >
            <span className="sr-only">Loading storage bins…</span>
            {Array.from({ length: LOADING_TILES }).map((_, index) => (
              <Skeleton key={index} className="h-[96px] w-full" />
            ))}
          </div>
        ) : bins.length === 0 ? (
          <EmptyState
            padding="md"
            icon={<WarehouseIcon size={40} />}
            title={
              hasActiveFilters
                ? showArchived
                  ? "No archived storage bins match"
                  : "No storage bins match"
                : showArchived
                  ? "No archived storage bins"
                  : "No storage bins yet"
            }
            description={
              hasActiveFilters
                ? "Try clearing your search or picking another bin type."
                : showArchived
                  ? "Storage bins you archive appear here and can be restored."
                  : "Bins hold feedstock, biochar, and finished product inventory."
            }
            action={
              !hasActiveFilters && !showArchived ? (
                <Button variant="primary" onClick={onCreate}>
                  <PlusIcon size={20} weight="bold" />
                  Create your first storage bin
                </Button>
              ) : undefined
            }
          />
        ) : (
          // Inert, not hidden: keeping the previous page on screen stops the
          // board collapsing under the operator on every filter change, but a
          // tile that answers the *old* filter must not accept an archive or a
          // delete — most sharply on a facility switch, where the stale tiles
          // belong to a facility the operator has already left.
          <div
            className={`grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-12 transition-opacity ${
              isStale ? "opacity-60" : ""
            }`}
            // `inert` rather than `pointer-events-none`: the tiles are
            // keyboard-operable, so blocking the mouse alone would leave Enter
            // on a focused stale tile working.
            inert={isStale}
            aria-busy={isStale || undefined}
          >
            {/* The rail's counts are facility-wide by design, so a search is the
                one narrowing the rail cannot report. */}
            {searchQuery && (
              <p className="col-span-full body-caption text-[var(--color-text-tertiary)]">
                {total} {total === 1 ? "bin matches" : "bins match"} your search
              </p>
            )}
            {bins.map((bin) => (
              <StorageBinTile
                key={bin.id}
                bin={bin}
                actions={binRowActions(bin, props)}
                onView={onView}
                onReconcile={onReconcile}
              />
            ))}
          </div>
        )}

        {/* A rows-per-page control and four page arrows are noise on a facility
            with one page of bins. The smallest page size is the threshold, so
            the controls appear exactly when they can do something. */}
        {total > SMALLEST_PAGE_SIZE && (
          <ListPagination
            page={props.page}
            pageCount={props.pageCount}
            pageSize={props.pageSize}
            onPageChange={props.onPageChange}
            onPageSizeChange={props.onPageSizeChange}
            className="border-t border-[var(--color-border-tertiary)] pt-16 md:px-0"
          />
        )}
      </div>
    </div>
  );
}

function RailFilter({
  filter,
  isActive,
  count,
  figure,
  onSelect,
}: {
  filter: StorageBinTypeFilter;
  isActive: boolean;
  count: number | null;
  figure: string;
  onSelect: () => void;
}) {
  const meta = filter === "all" ? null : BIN_TYPE_META[filter];
  // The selected rule is the type accent, or full ink for "All bins" — without
  // it the first row reads as a section header rather than the active filter.
  const selectedRule = meta?.accent ?? "var(--ink)";

  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onSelect}
      className={`flex items-center justify-between gap-8 px-12 py-10 text-left transition-colors [border-bottom:var(--row-divider)] last:[border-bottom:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] focus-visible:ring-inset ${
        isActive
          ? "bg-[var(--sea)] text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--row-hover-bg)]"
      }`}
      style={isActive ? { boxShadow: `inset 3px 0 0 ${selectedRule}` } : undefined}
    >
      <span className="flex items-center gap-6">
        {meta && (
          <span style={{ color: meta.ink }}>
            <meta.Icon size={16} weight="bold" />
          </span>
        )}
        <span className={`label-micro ${isActive ? "" : "opacity-80"}`}>
          {binTypeFilterLabel(filter)}
        </span>
      </span>
      <span className="flex flex-col items-end">
        <span className="body-caption font-semibold tabular-nums">{figure}</span>
        {filter !== "all" && count != null && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {count} {count === 1 ? "bin" : "bins"}
          </span>
        )}
      </span>
    </button>
  );
}
