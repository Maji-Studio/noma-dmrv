/**
 * PROTOTYPE — throwaway. Storage board variants, switchable via `?variant=` on
 * the real `/storage-locations` route so they're judged against the real
 * header, sidebar, data and density.
 *
 * Question being answered: what should the storage page look like once the
 * three StatCards are gone, type becomes a filter, and the bin cards shrink?
 *
 * Delete this folder (and `components/prototype/`) once a winner is folded in.
 */
"use client";

import { VariantADenseRows } from "./variant-a-dense-rows";
import { VariantBCompactLanes } from "./variant-b-compact-lanes";
import { VariantCGaugeGrid } from "./variant-c-gauge-grid";
import type { StorageBoardProps } from "./board-shared";
import type { PrototypeVariant } from "@/components/prototype/prototype-switcher";

export const STORAGE_VARIANTS: readonly PrototypeVariant[] = [
  { key: "current", name: "Current (shipped)" },
  { key: "A", name: "Dense rows" },
  { key: "B", name: "Compact lanes" },
  { key: "C", name: "Gauge grid" },
];

export function StoragePrototypeBoard({
  variant,
  ...props
}: StorageBoardProps & { variant: string }) {
  if (variant === "B") return <VariantBCompactLanes {...props} />;
  if (variant === "C") return <VariantCGaugeGrid {...props} />;
  return <VariantADenseRows {...props} />;
}

export type { StorageBoardProps, StorageTypeFilter } from "./board-shared";
