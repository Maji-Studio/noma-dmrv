/**
 * Bin display helpers — shared derivations, accent tokens and vocabulary for
 * the storage board and its silo tiles. Kept here (not in schemas) because this
 * is pure presentation: the type order follows the material flow
 * (feedstock → biochar → product) and the accent triad reuses the
 * Production / Infrastructure / Distribution `--acc-*` tokens.
 *
 * Deliberately JSX-free so the tile, the filter rail and the reconcile sheet can
 * all read from it. Type icons are exposed as component references rather than
 * elements for the same reason.
 */
import type { CSSProperties } from "react";
import { CubeIcon, LeafIcon, PackageIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type {
  StorageLocationSortKey,
  StorageLocationType,
} from "@/schemas/storage-locations";

/** Bin types in production-flow order — feedstock in, product out. */
export const STORAGE_LANE_ORDER = [
  "feedstock_bin",
  "biochar_bin",
  "product_bin",
] as const;

/** "all" is the unfiltered board — its default. */
export type StorageBinTypeFilter = StorageLocationType | "all";

/** Filter rail order: the unfiltered board, then the material flow. */
export const BIN_TYPE_FILTER_ORDER: readonly StorageBinTypeFilter[] = [
  "all",
  ...STORAGE_LANE_ORDER,
];

/**
 * Per-type vocabulary and accents. `ink` is the text-safe variant of `accent`;
 * only the `-ink` tokens clear 4.5:1 on the warm field.
 */
export const BIN_TYPE_META: Record<
  StorageLocationType,
  { label: string; Icon: Icon; accent: string; ink: string }
> = {
  feedstock_bin: {
    label: "Feedstock",
    Icon: LeafIcon,
    accent: "var(--acc-prod)",
    ink: "var(--acc-prod-ink)",
  },
  biochar_bin: {
    label: "Biochar",
    Icon: CubeIcon,
    accent: "var(--acc-infra)",
    ink: "var(--acc-infra-ink)",
  },
  product_bin: {
    label: "Product",
    Icon: PackageIcon,
    accent: "var(--acc-dist)",
    ink: "var(--acc-dist-ink)",
  },
};

export function binTypeFilterLabel(filter: StorageBinTypeFilter): string {
  return filter === "all" ? "All bins" : BIN_TYPE_META[filter].label;
}

/**
 * Sort choices offered on the board. Every one is resolved in SQL before
 * LIMIT/OFFSET, so the order holds across pages — see `storageLocationSortKeys`.
 * `value` is the `<select>`'s wire form; `parseBinSortValue` reads it back.
 *
 * Labels are sentence case, matching every other filter control.
 */
export interface BinSortOption {
  value: string;
  label: string;
  sortBy: StorageLocationSortKey;
  sortOrder: "asc" | "desc";
}

export const BIN_SORT_OPTIONS: readonly BinSortOption[] = [
  {
    value: "lastActivityAt:desc",
    label: "Recent activity",
    sortBy: "lastActivityAt",
    sortOrder: "desc",
  },
  { value: "code:asc", label: "Bin code", sortBy: "code", sortOrder: "asc" },
  { value: "name:asc", label: "Bin name", sortBy: "name", sortOrder: "asc" },
  { value: "type:asc", label: "Bin type", sortBy: "type", sortOrder: "asc" },
  {
    value: "capacityKg:desc",
    label: "Largest capacity",
    sortBy: "capacityKg",
    sortOrder: "desc",
  },
  {
    value: "createdAt:desc",
    label: "Recently added",
    sortBy: "createdAt",
    sortOrder: "desc",
  },
];

/**
 * A storage board opens on what is moving, not on the alphabet — an operator
 * arrives to see which bins are in play right now.
 */
export const DEFAULT_BIN_SORT = BIN_SORT_OPTIONS[0];

export function parseBinSortValue(value: string): BinSortOption {
  return BIN_SORT_OPTIONS.find((option) => option.value === value) ?? DEFAULT_BIN_SORT;
}

const ACCENT: Record<
  StorageLocationType,
  { accent: string; ink: string; soft: string; track: string }
> = {
  feedstock_bin: {
    accent: "var(--acc-prod)",
    ink: "var(--acc-prod-ink)",
    soft: "var(--clr-orange-10)",
    track: "var(--clr-orange-5)",
  },
  biochar_bin: {
    accent: "var(--acc-infra)",
    ink: "var(--acc-infra-ink)",
    soft: "var(--clr-purple-10)",
    track: "var(--clr-purple-5)",
  },
  product_bin: {
    accent: "var(--acc-dist)",
    ink: "var(--acc-dist-ink)",
    soft: "var(--clr-pink-10)",
    track: "var(--clr-pink-5)",
  },
};

/**
 * Spread onto a container's `style` to expose `--bin-accent`/`--bin-ink`/
 * `--bin-soft`/`--bin-track` to its subtree, so classes can stay type-agnostic.
 */
export function binAccentStyle(type: StorageLocationType): CSSProperties {
  const a = ACCENT[type];
  return {
    "--bin-accent": a.accent,
    "--bin-ink": a.ink,
    "--bin-soft": a.soft,
    "--bin-track": a.track,
  } as CSSProperties;
}

/** Current on-hand mass for a bin, by type. */
export function binCurrentMassKg(s: StorageLocationWithFacility): number {
  if (s.type === "feedstock_bin") return s.feedstockInventory.currentWetMassKg;
  if (s.type === "biochar_bin") return s.biocharInventory.currentMassKg;
  return s.productInventory.currentMassKg;
}

/**
 * True when the bin's derived on-hand stock has gone negative — draws + losses
 * have outrun recorded intake, so the count needs reconciling (issue #194).
 */
export function binNeedsReconciliation(s: StorageLocationWithFacility): boolean {
  return binCurrentMassKg(s) < 0;
}

/** Fill level (0–100) vs capacity, or null when no capacity is set. */
export function binCapacityPercent(
  s: StorageLocationWithFacility
): number | null {
  if (!s.capacityKg || s.capacityKg <= 0) return null;
  return Math.round(
    Math.max(0, Math.min(100, (binCurrentMassKg(s) / s.capacityKg) * 100))
  );
}

/**
 * Product bins without a formulation are not missing data. An unassigned
 * product bin is the one that takes pure biochar, and the first formulated
 * product stored in it claims it (`data-access/biochar-products.ts`), so the
 * tile names what it holds today rather than reporting a blank field.
 */
const PURE_BIOCHAR_PRODUCT = "Pure biochar";

/** A feedstock bin without a type, on the other hand, is a real gap: the form
 *  requires one, so only legacy rows can reach this. */
const UNASSIGNED_FEEDSTOCK = "Unassigned";

/**
 * The tile's headline: what the bin holds, not what it is called.
 *
 * Feedstock covers ingredient bins too — per CONTEXT.md an "ingredient bin" is
 * a feedstock bin whose held type happens to have blend usage, not a distinct
 * kind, so one field names both. Biochar bins have no name in the data model
 * (they hold lots from production runs, not a named entity), so they say what
 * they hold plainly rather than borrowing a downstream formulation's name.
 */
export function binMaterialName(bin: StorageLocationWithFacility): string {
  if (bin.type === "feedstock_bin") {
    return (
      bin.feedstockTypeName ??
      bin.feedstockInventory.feedstockTypes[0] ??
      UNASSIGNED_FEEDSTOCK
    );
  }
  if (bin.type === "product_bin") {
    return (
      bin.formulationName ??
      bin.productInventory.formulationNames[0] ??
      PURE_BIOCHAR_PRODUCT
    );
  }
  return "Biochar";
}
