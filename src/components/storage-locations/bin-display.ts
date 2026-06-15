/**
 * Bin display helpers — shared derivations + accent tokens for the storage
 * flow board and its silo tiles. Kept here (not in schemas) because this is
 * pure presentation: lane ordering follows the material flow
 * (feedstock → biochar → product) and the accent triad reuses the
 * Production / Infrastructure / Distribution `--acc-*` tokens.
 */
import type { CSSProperties } from "react";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocationType } from "@/schemas/storage-locations";

/** Lanes left-to-right in production-flow order. */
export const STORAGE_LANE_ORDER = [
  "feedstock_bin",
  "biochar_bin",
  "product_bin",
] as const;

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
  if (s.type === "feedstock_bin") return s.feedstockInventory.currentDryMassKg;
  if (s.type === "biochar_bin") return s.biocharInventory.currentMassKg;
  return s.productInventory.currentMassKg;
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
