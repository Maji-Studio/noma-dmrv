import { db } from "@/db";
import {
  storageLocations
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { isStockBelowDisplay, stockBasisKg } from "@/lib/stock-display";
import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { deriveLaneStock } from "./lane-stock-derivation";
import { getOutputBinStocks, type OutputBinStock } from "./output-stock";
import { requireOrgScope } from "./utils";

/**
 * Per-lane bin count and on-hand mass. A lane's `onHandKg` is null when any of
 * its output bins has unresolved stock (a completed run without dry mass or end
 * time, a product without placement or ingredient solids): the tile for that
 * bin reads "unavailable", so the lane total cannot be known either. One such
 * bin must never fail the whole list.
 */
export type StorageLocationLaneSummary = Record<
  StorageLocationType,
  { binCount: number; onHandKg: number | null; basis: LaneMassBasis }
>;

/**
 * What a lane total measures, matching the bin cards of that lane: wet mass,
 * or dry biochar when an output bin has no wet estimate to lead with. Bins
 * whose stock is below the display minimum read "Empty" and add nothing.
 */
export type LaneMassBasis = "wet" | "dry biochar";

export async function getStorageLocationLaneSummary(
  ctx: OrgContext,
  options: { facilityId?: string; archived: boolean },
): Promise<StorageLocationLaneSummary> {
  requireOrgScope(ctx);
  const conditions: SQL[] = [
    eq(storageLocations.organizationId, ctx.organizationId),
    options.archived
      ? isNotNull(storageLocations.archivedAt)
      : isNull(storageLocations.archivedAt),
  ];
  if (options.facilityId) {
    conditions.push(eq(storageLocations.facilityId, options.facilityId));
  }

  // org-scope-ok: conditions always starts with the active organization predicate.
  const bins = await db
    .select({ id: storageLocations.id, type: storageLocations.type })
    .from(storageLocations)
    .where(and(...conditions));
  const storageLocationIds = bins.map((bin) => bin.id);
  const laneStocks = await deriveLaneStock(ctx, db, { storageLocationIds });
  const laneStockById = new Map(
    laneStocks.map((stock) => [stock.storageLocationId, stock]),
  );
  const summary: StorageLocationLaneSummary = {
    feedstock_bin: { binCount: 0, onHandKg: 0, basis: "wet" },
    biochar_bin: { binCount: 0, onHandKg: 0, basis: "wet" },
    product_bin: { binCount: 0, onHandKg: 0, basis: "wet" },
  };
  const outputWetKg = { biochar_bin: 0, product_bin: 0 };
  const outputDryKg = { biochar_bin: 0, product_bin: 0 };
  const outputUnresolved = { biochar_bin: false, product_bin: false };
  const outputWithoutWet = { biochar_bin: false, product_bin: false };

  // All-layers balance: the lane total conserves receipts placed later too.
  const outputStocks: Map<string, OutputBinStock> = options.archived
    ? new Map()
    : await getOutputBinStocks(
        ctx,
        bins.filter((bin) => bin.type !== "feedstock_bin").map((bin) => bin.id),
      );
  for (const bin of bins) {
    const stock = laneStockById.get(bin.id);
    const lane = summary[bin.type];
    lane.binCount += 1;
    if (bin.type === "feedstock_bin") {
      const wetKg = stock?.feedstockStockWetKg ?? 0;
      if (!isStockBelowDisplay(wetKg)) lane.onHandKg = (lane.onHandKg ?? 0) + wetKg;
    } else if (!options.archived) {
      const output = outputStocks.get(bin.id);
      const dryKg = output?.allLayersDryKg ?? null;
      if (dryKg == null) {
        outputUnresolved[bin.type] = true;
        continue;
      }
      const wetKg = output?.estimatedWetMassKg ?? null;
      if (isStockBelowDisplay(stockBasisKg(wetKg, dryKg))) continue;
      outputDryKg[bin.type] += dryKg;
      if (wetKg == null) outputWithoutWet[bin.type] = true;
      else outputWetKg[bin.type] += wetKg;
    }
  }
  for (const type of ["biochar_bin", "product_bin"] as const) {
    if (options.archived) continue;
    const lane = summary[type];
    // A bin without a wet estimate leads its card with dry biochar, so the
    // lane falls back to the dry sum rather than mixing the two bases.
    lane.basis = outputWithoutWet[type] ? "dry biochar" : "wet";
    lane.onHandKg = outputUnresolved[type] ? null : lane.basis === "wet" ? outputWetKg[type] : outputDryKg[type];
  }

  return summary;
}
