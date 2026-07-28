/**
 * PROTOTYPE — throwaway. Shared props + small pieces the three storage-board
 * variants all need. Nothing here is production code; the winning variant gets
 * rewritten properly when it's folded into `storage-location-list.tsx`.
 */
"use client";

import {
  ArrowsClockwiseIcon,
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CubeIcon,
  LeafIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { formatMass } from "@/lib/format-utils";

/** Mirrors the (unexported) `RowAction` shape of `RowActionsMenu`. */
type RowAction = {
  label: string;
  onSelect?: () => void;
  destructive?: boolean;
  icon?: React.ReactNode;
};

/** "all" is the unfiltered lane — the board's default. */
export type StorageTypeFilter = StorageLocationType | "all";

export type LaneSummary = Record<
  StorageLocationType,
  { binCount: number; onHandKg: number }
>;

export interface StorageBoardProps {
  bins: StorageLocationWithFacility[];
  isLoading: boolean;
  laneSummary: LaneSummary | undefined;
  total: number;

  searchQuery: string;
  onSearchChange: (value: string) => void;
  typeFilter: StorageTypeFilter;
  onTypeFilterChange: (value: StorageTypeFilter) => void;
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

export const TYPE_META: Record<
  StorageLocationType,
  { label: string; icon: React.ReactNode; accent: string; ink: string; soft: string }
> = {
  feedstock_bin: {
    label: "Feedstock",
    icon: <LeafIcon size={16} weight="bold" />,
    accent: "var(--acc-prod)",
    ink: "var(--acc-prod-ink)",
    soft: "var(--clr-orange-10)",
  },
  biochar_bin: {
    label: "Biochar",
    icon: <CubeIcon size={16} weight="bold" />,
    accent: "var(--acc-infra)",
    ink: "var(--acc-infra-ink)",
    soft: "var(--clr-purple-10)",
  },
  product_bin: {
    label: "Product",
    icon: <PackageIcon size={16} weight="bold" />,
    accent: "var(--acc-dist)",
    ink: "var(--acc-dist-ink)",
    soft: "var(--clr-pink-10)",
  },
};

export const TYPE_FILTER_ORDER: readonly StorageTypeFilter[] = [
  "all",
  "feedstock_bin",
  "biochar_bin",
  "product_bin",
];

/** One muted line describing what kind of material the bin holds. */
export function contentsLabel(bin: StorageLocationWithFacility): string | null {
  if (bin.type === "feedstock_bin") {
    return bin.feedstockInventory.feedstockTypes.join(", ") || null;
  }
  if (bin.type === "biochar_bin") {
    return bin.biocharInventory.downstreamFormulations.join(", ") || null;
  }
  return bin.productInventory.formulationNames.join(", ") || null;
}

/** Facility-wide bin count for a filter value, from the server lane summary. */
export function filterBinCount(
  summary: LaneSummary | undefined,
  filter: StorageTypeFilter,
): number {
  if (!summary) return 0;
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
 * On-hand roll-up label for a filter value. Facility-wide roll-ups use the
 * auto-tonne `formatMass`; per-bin figures stay fixed kg.
 */
export function filterOnHandLabel(
  summary: LaneSummary | undefined,
  filter: StorageTypeFilter,
): string {
  if (!summary) return "—";
  if (filter === "all") {
    // Feedstock is dry mass and product is packed mass — summing them is a
    // "total material on site" reading, not a certifiable figure.
    return `${formatMass(summary.feedstock_bin.onHandKg)} · ${formatMass(
      summary.biochar_bin.onHandKg,
    )} · ${formatMass(summary.product_bin.onHandKg)}`;
  }
  return formatMass(summary[filter].onHandKg);
}

export function filterLabel(filter: StorageTypeFilter): string {
  return filter === "all" ? "All bins" : TYPE_META[filter].label;
}

/** Row actions shared by every variant — reconcile is promoted into the menu. */
export function binRowActions(
  bin: StorageLocationWithFacility,
  handlers: Pick<
    StorageBoardProps,
    "onEdit" | "onArchive" | "onRestore" | "onDelete" | "onReconcile"
  >,
): RowAction[] {
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

/** The 36px search input every variant reuses (layout stays variant-owned). */
export function BoardSearch({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <MagnifyingGlassIcon
        size={16}
        className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
      />
      <input
        type="text"
        placeholder="Search by code or name…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-36 w-full border border-[var(--color-border-primary)] bg-[var(--color-background-white)] pl-32 pr-12 body-small placeholder:text-[var(--color-text-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        aria-label="Search storage"
      />
    </div>
  );
}

/** Slim archived toggle — same affordance in all three variants. */
export function ArchivedToggle({
  showArchived,
  onToggle,
  className = "",
}: {
  showArchived: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={showArchived}
      className={`inline-flex h-36 shrink-0 items-center gap-6 border-[1.5px] px-12 label-micro transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] ${
        showArchived
          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
          : "border-[var(--clr-dark-purple-20)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
      } ${className}`}
    >
      <ArchiveIcon size={14} weight="bold" />
      Archived
    </button>
  );
}
