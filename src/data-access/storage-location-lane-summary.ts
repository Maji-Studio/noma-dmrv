import { db } from "@/db";
import {
  storageLocations
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { deriveLaneStock } from "./lane-stock-derivation";
import {
  getOutputBinDryBalance,
  UnresolvedOutputStockError,
} from "./output-stock";
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
  { binCount: number; onHandKg: number | null }
>;

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
    feedstock_bin: { binCount: 0, onHandKg: 0 },
    biochar_bin: { binCount: 0, onHandKg: 0 },
    product_bin: { binCount: 0, onHandKg: 0 },
  };

  for (const bin of bins) {
    const stock = laneStockById.get(bin.id);
    const lane = summary[bin.type];
    lane.binCount += 1;
    if (bin.type === "feedstock_bin") {
      lane.onHandKg = (lane.onHandKg ?? 0) + (stock?.feedstockStockWetKg ?? 0);
    } else if (!options.archived && lane.onHandKg != null) {
      try {
        lane.onHandKg += await getOutputBinDryBalance(ctx, bin.id);
      } catch (error) {
        if (!(error instanceof UnresolvedOutputStockError)) throw error;
        lane.onHandKg = null;
      }
    }
  }

  return summary;
}
