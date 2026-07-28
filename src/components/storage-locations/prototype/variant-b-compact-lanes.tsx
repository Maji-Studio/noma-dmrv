/**
 * PROTOTYPE variant B — "Compact lanes".
 *
 * Keeps the material-flow board (feedstock → biochar → product) because the
 * spatial model is the thing operators learn — but the lane headers become the
 * filter *and* the KPI strip (count + on-hand per lane, no StatCards), and the
 * tiles drop from ~200px to ~78px: one identity line, one figure line, one
 * meter. Picking a lane collapses the board to that single lane, full width.
 *
 * Keeps the "state of the site" read; less scannable than a flat list once a
 * facility has 20+ bins.
 */
"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  WarehouseIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, ListPagination, RowActionsMenu } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { formatDateTime, formatMass, formatMassKg } from "@/lib/format-utils";
import { STORAGE_LANE_ORDER } from "../bin-display";
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
  TYPE_META,
  type StorageBoardProps,
} from "./board-shared";

const LOADING_TILES_PER_LANE = 3;

export function VariantBCompactLanes(props: StorageBoardProps) {
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

  const visibleLanes =
    typeFilter === "all" ? STORAGE_LANE_ORDER : ([typeFilter] as const);
  const isSingleLane = visibleLanes.length === 1;

  return (
    <div className="flex flex-col gap-16">
      {/* Lane strip — filter and roll-up in one control, replacing the KPI row */}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
        {STORAGE_LANE_ORDER.map((type) => {
          const meta = TYPE_META[type];
          const isActive = typeFilter === type;
          return (
            <button
              key={type}
              type="button"
              aria-pressed={isActive}
              onClick={() => onTypeFilterChange(isActive ? "all" : type)}
              className={`flex items-center justify-between gap-12 border-b-[3px] px-14 py-10 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] ${
                isActive
                  ? "bg-[var(--panel-bg)] [border-top:var(--panel-border)] [border-left:var(--panel-border)] [border-right:var(--panel-border)]"
                  : "hover:bg-[var(--row-hover-bg)]"
              }`}
              style={{ borderBottomColor: meta.accent }}
            >
              <span className="flex items-center gap-8" style={{ color: meta.ink }}>
                {meta.icon}
                <span className="label-micro">{meta.label}</span>
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {filterBinCount(laneSummary, type)}
                </span>
              </span>
              <span className="body-small font-semibold tabular-nums text-[var(--color-text-primary)]">
                {formatMass(laneSummary?.[type].onHandKg ?? 0)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-12">
        <BoardSearch
          value={searchQuery}
          onChange={onSearchChange}
          className="w-full sm:w-[300px]"
        />
        {typeFilter !== "all" && (
          <Button variant="noOutline" size="small" onClick={() => onTypeFilterChange("all")}>
            Show all lanes
          </Button>
        )}
        <ArchivedToggle
          showArchived={showArchived}
          onToggle={onToggleArchived}
          className="ml-auto"
        />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-24 lg:flex-row lg:gap-16" aria-busy="true">
          <span className="sr-only">Loading storage bins…</span>
          {visibleLanes.map((type) => (
            <div key={type} className="flex flex-1 flex-col gap-8">
              {Array.from({ length: LOADING_TILES_PER_LANE }).map((_, index) => (
                <Skeleton key={index} className="h-[78px] w-full" />
              ))}
            </div>
          ))}
        </div>
      ) : bins.length === 0 ? (
        <EmptyState
          padding="md"
          icon={<WarehouseIcon size={40} />}
          title={hasActiveFilters ? "No storage bins match" : "No storage bins yet"}
          description={
            hasActiveFilters
              ? "Try clearing your search or picking another lane."
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
        <div
          className={
            isSingleLane
              ? "grid gap-8 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]"
              : "flex flex-col gap-24 lg:flex-row lg:items-start lg:gap-16"
          }
        >
          {isSingleLane
            ? bins.map((bin) => (
                <CompactTile
                  key={bin.id}
                  bin={bin}
                  onView={onView}
                  onReconcile={onReconcile}
                  actions={binRowActions(bin, props)}
                />
              ))
            : visibleLanes.map((type) => {
                const laneBins = bins.filter((bin) => bin.type === type);
                const meta = TYPE_META[type];
                return (
                  <div key={type} className="flex flex-1 flex-col gap-8">
                    {laneBins.length === 0 ? (
                      <div className="border border-dashed border-[var(--color-border-tertiary)] px-12 py-20 text-center body-caption text-[var(--color-text-tertiary)]">
                        No {meta.label.toLowerCase()} bins on this page
                      </div>
                    ) : (
                      laneBins.map((bin) => (
                        <CompactTile
                          key={bin.id}
                          bin={bin}
                          onView={onView}
                          onReconcile={onReconcile}
                          actions={binRowActions(bin, props)}
                        />
                      ))
                    )}
                  </div>
                );
              })}
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
  );
}

/** ~78px tile: identity line, figure line, meter. Nothing else. */
function CompactTile({
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
  const { lastActivity } = bin;
  const isArchived = bin.archivedAt != null;

  return (
    <article
      style={binAccentStyle(bin.type)}
      onClick={() => onView(bin)}
      className={`group flex cursor-pointer flex-col bg-[var(--panel-bg)] [border:var(--panel-border)] [border-left:3px_solid_var(--bin-accent)] transition-colors hover:[border-color:var(--bin-accent)] ${
        isEmpty ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-col gap-6 px-12 pt-8 pb-6">
        {/* Identity line */}
        <div className="flex items-center gap-8">
          <span
            className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em]"
            style={{ color: "var(--bin-ink)" }}
          >
            {bin.code}
          </span>
          <span className="min-w-0 flex-1 truncate body-small font-medium text-[var(--color-text-primary)]">
            {bin.name}
          </span>
          {isArchived && (
            <span className="shrink-0 label-micro text-[var(--color-text-tertiary)]">
              Archived
            </span>
          )}
          <RowActionsMenu label={`Actions for ${bin.code}`} actions={actions} />
        </div>

        {/* Figure line */}
        <div className="flex items-baseline justify-between gap-8">
          <span
            className={`shrink-0 whitespace-nowrap title-heading-3 tabular-nums ${
              needsReconciliation
                ? "text-[var(--color-signal-red)]"
                : isEmpty
                  ? "text-[var(--color-text-tertiary)]"
                  : "text-[var(--color-text-primary)]"
            }`}
          >
            {isEmpty ? "Empty" : formatMassKg(massKg)}
          </span>
          <span className="flex min-w-0 flex-1 items-center justify-end gap-8">
            {contents && (
              <span className="truncate body-caption text-[var(--color-text-tertiary)]">
                {contents}
              </span>
            )}
            {lastActivity && (
              <span
                className={`flex shrink-0 items-center gap-2 body-caption ${
                  lastActivity.type === "in"
                    ? "text-[var(--st-ok)]"
                    : "text-[var(--color-signal-orange)]"
                }`}
                title={`${lastActivity.label} · ${
                  lastActivity.type === "in" ? "+" : "−"
                }${formatMassKg(lastActivity.massKg)}`}
              >
                {lastActivity.type === "in" ? (
                  <ArrowUpIcon size={11} weight="bold" />
                ) : (
                  <ArrowDownIcon size={11} weight="bold" />
                )}
                {formatDateTime(lastActivity.date)}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Meter as the tile's baseline — capacity context lives in its tooltip */}
      {fill == null ? (
        <div className="h-3 w-full bg-[var(--bin-track)]" />
      ) : (
        <div
          className="h-3 w-full bg-[var(--bin-track)]"
          role="progressbar"
          aria-valuenow={fill}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${bin.name} fill level`}
          title={`${fill}% of ${formatMassKg(bin.capacityKg)}`}
        >
          <div className="h-full bg-[var(--bin-accent)]" style={{ width: `${fill}%` }} />
        </div>
      )}

      {needsReconciliation && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onReconcile(bin);
          }}
          className="flex items-center gap-4 bg-[var(--st-bad-bg)] px-12 py-4 body-caption font-medium text-[var(--color-signal-red)] hover:opacity-80"
        >
          <WarningIcon size={12} weight="fill" />
          Needs reconciliation
        </button>
      )}
    </article>
  );
}
