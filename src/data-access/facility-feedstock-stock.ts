import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { deriveLaneStock } from "./lane-stock-derivation";
import { requireOrgScope } from "./utils";

/** Wet feedstock on hand in all feedstock bins, including archived bins. */
export async function getFacilityFeedstockWetStock(
  ctx: OrgContext,
  facilityIds: string[],
): Promise<Map<string, number>> {
  requireOrgScope(ctx);
  const stockByFacility = new Map<string, number>();
  if (facilityIds.length === 0) return stockByFacility;

  const bins = await db.select({
    id: storageLocations.id,
    facilityId: storageLocations.facilityId,
  }).from(storageLocations).where(and(
    inArray(storageLocations.facilityId, facilityIds),
    eq(storageLocations.type, "feedstock_bin"),
    eq(storageLocations.organizationId, ctx.organizationId),
  ));
  const stocks = await deriveLaneStock(ctx, db, {
    storageLocationIds: bins.map((bin) => bin.id),
    lanes: "feedstock",
  });
  const facilityByBinId = new Map(bins.map((bin) => [bin.id, bin.facilityId]));
  for (const stock of stocks) {
    const facilityId = facilityByBinId.get(stock.storageLocationId);
    if (!facilityId) continue;
    stockByFacility.set(
      facilityId,
      (stockByFacility.get(facilityId) ?? 0) + stock.feedstockStockWetKg,
    );
  }
  return stockByFacility;
}
