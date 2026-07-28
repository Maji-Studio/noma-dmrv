/**
 * PROTOTYPE variant C — "Gauge grid".
 *
 * Drops grouping altogether and sorts by *attention*: bins needing
 * reconciliation first, then the fullest, then the rest. Filtering moves out of
 * the content area into a left rail that doubles as the on-hand roll-up (again,
 * no StatCards). Each tile is a silo: a vertical gauge on the left carries the
 * fill level, so a wall of tiles reads as a bar chart at a glance.
 *
 * Best at "which bin needs me right now"; loses the material-flow story.
 */
"use client";

import {
  PlusIcon,
  WarehouseIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, ListPagination, RowActionsMenu } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { formatMass, formatMassKg } from "@/lib/format-utils";
import {
  binAccentStyle,
  binCapacityPercent,
  binCurrentMassKg,
  binNeedsReconciliation,
} from "../bin-display";
import {
  ArchivedToggle,
  BoardSearch,
  binRowActions,
  contentsLabel,
  filterBinCount,
  filterLabel,
  TYPE_FILTER_ORDER,
  TYPE_META,
  type StorageBoardProps,
  type StorageTypeFilter,
} from "./board-shared";

const LOADING_TILES = 8;

/** Reconciliation first, then fullest, then everything else by code. */
function attentionOrder(
  a: StorageLocationWithFacility,
  b: StorageLocationWithFacility,
) {
  const flag = Number(binNeedsReconciliation(b)) - Number(binNeedsReconciliation(a));
  if (flag !== 0) return flag;
  const fillDelta = (binCapacityPercent(b) ?? -1) - (binCapacityPercent(a) ?? -1);
  if (fillDelta !== 0) return fillDelta;
  return a.code.localeCompare(b.code);
}

export function VariantCGaugeGrid(props: StorageBoardProps) {
  const {
    bins,
    isLoading,
    laneSummary,
    searchQuery,
    onSearchChange,
    typeFilter,
    onTypeFilterChange,
    showArchived,
    onToggleArchived,
    hasActiveFilters,
    onCreate,
    onView,
    onReconcile,
  } = props;

  const sorted = [...bins].sort(attentionOrder);

  return (
    <div className="flex flex-col gap-16 lg:flex-row lg:items-start lg:gap-24">
      {/* Filter rail — type list carries the facility-wide roll-up */}
      <aside className="flex shrink-0 flex-col gap-12 lg:w-[212px] lg:sticky lg:top-24">
        <BoardSearch value={searchQuery} onChange={onSearchChange} />
        <nav
          aria-label="Filter by bin type"
          className="flex flex-row gap-8 overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible lg:[border:var(--panel-border)] lg:bg-[var(--panel-bg)]"
        >
          {TYPE_FILTER_ORDER.map((filter) => (
            <RailFilter
              key={filter}
              filter={filter}
              isActive={filter === typeFilter}
              count={filterBinCount(laneSummary, filter)}
              onHandLabel={
                filter === "all"
                  ? `${filterBinCount(laneSummary, "all")} bins`
                  : formatMass(laneSummary?.[filter].onHandKg ?? 0)
              }
              onSelect={() => onTypeFilterChange(filter)}
            />
          ))}
        </nav>
        <ArchivedToggle
          showArchived={showArchived}
          onToggle={onToggleArchived}
          className="self-start"
        />
      </aside>

      {/* Tiles */}
      <div className="flex min-w-0 flex-1 flex-col gap-16">
        {isLoading ? (
          <div
            className="grid gap-12 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]"
            aria-busy="true"
          >
            <span className="sr-only">Loading storage bins…</span>
            {Array.from({ length: LOADING_TILES }).map((_, index) => (
              <Skeleton key={index} className="h-[92px] w-full" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            padding="md"
            icon={<WarehouseIcon size={40} />}
            title={hasActiveFilters ? "No storage bins match" : "No storage bins yet"}
            description={
              hasActiveFilters
                ? "Try clearing your search or picking another bin type."
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
          <div className="grid gap-12 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {sorted.map((bin) => (
              <GaugeTile
                key={bin.id}
                bin={bin}
                onView={onView}
                onReconcile={onReconcile}
                actions={binRowActions(bin, props)}
              />
            ))}
          </div>
        )}

        <ListPagination
          page={props.page}
          pageCount={props.pageCount}
          pageSize={props.pageSize}
          onPageChange={props.onPageChange}
          onPageSizeChange={props.onPageSizeChange}
          className="border-t border-[var(--color-border-tertiary)] pt-16 md:px-0"
        />
      </div>
    </div>
  );
}

function RailFilter({
  filter,
  isActive,
  count,
  onHandLabel,
  onSelect,
}: {
  filter: StorageTypeFilter;
  isActive: boolean;
  count: number;
  onHandLabel: string;
  onSelect: () => void;
}) {
  const meta = filter === "all" ? null : TYPE_META[filter];
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onSelect}
      className={`flex shrink-0 items-center justify-between gap-8 border-[1.5px] px-12 py-8 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] lg:border-0 lg:[border-bottom:var(--row-divider)] lg:last:[border-bottom:none] ${
        isActive
          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)] lg:bg-[var(--sea)] lg:text-[var(--color-text-primary)]"
          : "border-[var(--clr-dark-purple-20)] hover:bg-[var(--row-hover-bg)]"
      }`}
      style={
        isActive && meta
          ? ({ boxShadow: `inset 3px 0 0 ${meta.accent}` } as React.CSSProperties)
          : undefined
      }
    >
      <span className="flex items-center gap-6">
        {meta && (
          <span style={{ color: isActive ? undefined : meta.ink }}>{meta.icon}</span>
        )}
        <span className="label-micro">{filterLabel(filter)}</span>
      </span>
      <span className="flex flex-col items-end">
        <span className="body-caption font-semibold tabular-nums">{onHandLabel}</span>
        {filter !== "all" && (
          <span className="body-caption opacity-60">
            {count} {count === 1 ? "bin" : "bins"}
          </span>
        )}
      </span>
    </button>
  );
}

/** ~92px silo tile: vertical gauge rail + code, name, mass. */
function GaugeTile({
  bin,
  onView,
  onReconcile,
  actions,
}: {
  bin: StorageLocationWithFacility;
  onView: (bin: StorageLocationWithFacility) => void;
  onReconcile: (bin: StorageLocationWithFacility) => void;
  actions: ReturnType<typeof binRowActions>;
}) {
  const massKg = binCurrentMassKg(bin);
  const fill = binCapacityPercent(bin);
  const needsReconciliation = binNeedsReconciliation(bin);
  const isEmpty = massKg === 0;
  const contents = contentsLabel(bin);
  const meta = TYPE_META[bin.type];

  return (
    <article
      style={binAccentStyle(bin.type)}
      onClick={() => onView(bin)}
      className={`group flex cursor-pointer items-stretch bg-[var(--panel-bg)] [border:var(--panel-border)] transition-colors hover:[border-color:var(--bin-accent)] ${
        isEmpty ? "opacity-70" : ""
      } ${needsReconciliation ? "[border-color:var(--st-bad-border)]" : ""}`}
    >
      {/* Vertical gauge — the tile's whole left edge is the fill level */}
      <div
        className="relative w-10 shrink-0 bg-[var(--bin-track)]"
        role={fill == null ? undefined : "progressbar"}
        aria-valuenow={fill ?? undefined}
        aria-valuemin={fill == null ? undefined : 0}
        aria-valuemax={fill == null ? undefined : 100}
        aria-label={fill == null ? undefined : `${bin.name} fill level`}
        title={
          fill == null
            ? "No capacity set"
            : `${fill}% of ${formatMassKg(bin.capacityKg)}`
        }
      >
        <div
          className="absolute inset-x-0 bottom-0 bg-[var(--bin-accent)]"
          style={{ height: `${fill ?? 0}%` }}
        />
        {fill == null && (
          <div className="absolute inset-0 opacity-40 [background:repeating-linear-gradient(45deg,var(--bin-accent)_0_2px,transparent_2px_6px)]" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 px-12 py-10">
        <div className="flex items-center gap-6">
          <span style={{ color: meta.ink }} className="shrink-0">
            {meta.icon}
          </span>
          <span
            className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: meta.ink }}
          >
            {bin.code}
          </span>
          <span className="ml-auto shrink-0">
            <RowActionsMenu label={`Actions for ${bin.code}`} actions={actions} />
          </span>
        </div>

        <span className="truncate body-small font-medium text-[var(--color-text-primary)]">
          {bin.name}
        </span>

        <div className="flex items-baseline justify-between gap-8">
          <span
            className={`body-large font-semibold tabular-nums ${
              needsReconciliation
                ? "text-[var(--color-signal-red)]"
                : isEmpty
                  ? "text-[var(--color-text-tertiary)]"
                  : "text-[var(--color-text-primary)]"
            }`}
          >
            {isEmpty ? "Empty" : formatMassKg(massKg)}
          </span>
          {needsReconciliation ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onReconcile(bin);
              }}
              className="flex shrink-0 items-center gap-4 body-caption font-medium text-[var(--color-signal-red)] underline decoration-dotted underline-offset-2 hover:opacity-80"
            >
              <WarningIcon size={12} weight="fill" />
              Reconcile
            </button>
          ) : (
            <span className="min-w-0 truncate body-caption text-[var(--color-text-tertiary)]">
              {fill != null ? `${fill}%` : contents ?? "Uncapped"}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
