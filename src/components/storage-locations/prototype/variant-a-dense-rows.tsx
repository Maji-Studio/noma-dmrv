/**
 * PROTOTYPE variant A — "Dense rows".
 *
 * Throws out the lane board entirely. One flat, scannable list of ~44px rows
 * inside a single framed panel, the way every other entity list in the app
 * reads. Type is a segmented filter in the toolbar (which also carries the
 * on-hand roll-up that used to need three StatCards), so the operator picks a
 * material class instead of the layout picking it for them.
 *
 * Highest density of the three; weakest at "how full is my site right now".
 */
"use client";

import { WarehouseIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react/dist/ssr";
import { Button, EmptyState, ListPagination, RowActionsMenu } from "@/components/ui";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { formatDateTime, formatMassKg } from "@/lib/format-utils";
import { Skeleton } from "@/components/ui/loading-skeleton";
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
  filterOnHandLabel,
  TYPE_FILTER_ORDER,
  TYPE_META,
  type StorageBoardProps,
} from "./board-shared";

const LOADING_ROWS = 6;

export function VariantADenseRows(props: StorageBoardProps) {
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

  return (
    <div className="flex flex-col gap-16">
      {/* Toolbar — search, segmented type filter, on-hand readout */}
      <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-12">
          <BoardSearch
            value={searchQuery}
            onChange={onSearchChange}
            className="w-full sm:w-[280px]"
          />
          <div
            role="group"
            aria-label="Filter by bin type"
            className="flex border-[1.5px] border-[var(--clr-dark-purple-20)]"
          >
            {TYPE_FILTER_ORDER.map((filter, index) => {
              const isActive = filter === typeFilter;
              return (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onTypeFilterChange(filter)}
                  className={`label-micro flex h-36 items-center gap-6 px-12 transition-colors ${
                    index < TYPE_FILTER_ORDER.length - 1
                      ? "border-r-[1.5px] border-[var(--clr-dark-purple-20)]"
                      : ""
                  } ${
                    isActive
                      ? "bg-[var(--ink)] text-[var(--paper)]"
                      : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  {filter !== "all" && TYPE_META[filter].icon}
                  {filterLabel(filter)}
                  <span className={isActive ? "opacity-60" : "opacity-70"}>
                    {filterBinCount(laneSummary, filter)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-12">
          <span className="body-caption text-[var(--color-text-tertiary)]">
            <span className="font-mono">{filterOnHandLabel(laneSummary, typeFilter)}</span>{" "}
            on hand
          </span>
          <ArchivedToggle showArchived={showArchived} onToggle={onToggleArchived} />
        </div>
      </div>

      {/* Rows */}
      {isLoading ? (
        <div
          className="flex flex-col bg-[var(--panel-bg)] [border:var(--panel-border)]"
          aria-busy="true"
        >
          <span className="sr-only">Loading storage bins…</span>
          {Array.from({ length: LOADING_ROWS }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-16 px-16 py-12 [border-bottom:var(--row-divider)]"
            >
              <Skeleton className="h-16 w-[88px]" />
              <Skeleton className="h-16 flex-1" />
              <Skeleton className="h-16 w-[80px]" />
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
        <div className="bg-[var(--panel-bg)] [border:var(--panel-border)]">
          {/* Column header */}
          <div className="hidden items-center gap-12 bg-[var(--panel-head-bg)] px-16 py-8 label-micro text-[var(--color-text-tertiary)] md:flex">
            <span className="w-[120px] shrink-0">Bin</span>
            <span className="flex-1">Name</span>
            <span className="hidden w-[180px] shrink-0 lg:block">Contents</span>
            <span className="w-[132px] shrink-0">Fill</span>
            <span className="w-[100px] shrink-0 text-right">On hand</span>
            <span className="hidden w-[128px] shrink-0 text-right xl:block">
              Last move
            </span>
            <span className="w-32 shrink-0" />
          </div>

          {bins.map((bin) => (
            <DenseRow
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
  );
}

function DenseRow({
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
  const meta = TYPE_META[bin.type];
  const massKg = binCurrentMassKg(bin);
  const fill = binCapacityPercent(bin);
  const needsReconciliation = binNeedsReconciliation(bin);
  const isEmpty = massKg === 0;
  const contents = contentsLabel(bin);
  const { lastActivity } = bin;

  return (
    <div
      style={binAccentStyle(bin.type)}
      onClick={() => onView(bin)}
      className="group flex cursor-pointer items-center gap-12 border-l-[3px] px-16 py-10 transition-colors [border-bottom:var(--row-divider)] hover:bg-[var(--row-hover-bg)] last:[border-bottom:none]"
    >
      {/* Code — carries the type accent, so no separate type column is needed */}
      <span className="flex w-[120px] shrink-0 items-center gap-6">
        <span style={{ color: meta.ink }} className="shrink-0">
          {meta.icon}
        </span>
        <span
          className="truncate font-mono text-[11px] uppercase tracking-[0.08em]"
          style={{ color: meta.ink }}
          title={`${meta.label} bin`}
        >
          {bin.code}
        </span>
      </span>

      {/* Name */}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate body-small font-medium text-[var(--color-text-primary)]">
          {bin.name}
        </span>
        <span className="truncate body-caption text-[var(--color-text-tertiary)] lg:hidden">
          {contents ?? "—"}
        </span>
      </span>

      {/* Contents */}
      <span className="hidden w-[180px] shrink-0 truncate body-caption text-[var(--color-text-secondary)] lg:block">
        {contents ?? "—"}
      </span>

      {/* Fill — meter + percent, or a dash for uncapped stores */}
      <span className="flex w-[132px] shrink-0 items-center gap-8">
        {fill == null ? (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            Uncapped
          </span>
        ) : (
          <>
            <span
              className="h-4 w-[84px] bg-[var(--bin-track)]"
              role="progressbar"
              aria-valuenow={fill}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${bin.name} fill level`}
            >
              <span
                className="block h-full bg-[var(--bin-accent)]"
                style={{ width: `${fill}%` }}
              />
            </span>
            <span className="font-mono text-[11px] text-[var(--color-text-tertiary)]">
              {fill}%
            </span>
          </>
        )}
      </span>

      {/* On hand */}
      <span
        className={`w-[100px] shrink-0 text-right body-small font-semibold tabular-nums ${
          needsReconciliation
            ? "text-[var(--color-signal-red)]"
            : isEmpty
              ? "text-[var(--color-text-tertiary)]"
              : "text-[var(--color-text-primary)]"
        }`}
      >
        {isEmpty ? "Empty" : formatMassKg(massKg)}
      </span>

      {/* Last move, or the reconcile alert when stock has gone negative */}
      <span className="hidden w-[128px] shrink-0 justify-end xl:flex">
        {needsReconciliation ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onReconcile(bin);
            }}
            className="flex items-center gap-4 body-caption font-medium text-[var(--color-signal-red)] underline decoration-dotted underline-offset-2 hover:opacity-80"
          >
            <WarningIcon size={12} weight="fill" />
            Reconcile
          </button>
        ) : lastActivity ? (
          <span
            className={`flex items-center gap-4 body-caption ${
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
        ) : (
          <span className="body-caption text-[var(--color-text-tertiary)]">—</span>
        )}
      </span>

      <RowActionsMenu label={`Actions for ${bin.code}`} actions={actions} />
    </div>
  );
}
