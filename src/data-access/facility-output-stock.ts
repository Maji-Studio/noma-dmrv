import { and, eq, inArray } from "drizzle-orm";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { withStockSnapshot } from "./output-bin-stock";
import { getOutputBinStocks } from "./output-stock";
import { requireOrgFacility, requireOrgScope } from "./utils";

export interface FacilityOutputStockGroup {
  wetKg: number | null;
  dryBiocharKg: number;
}

export interface FacilityOutputStock {
  biochar: FacilityOutputStockGroup | null;
  product: FacilityOutputStockGroup | null;
}

/** Sum one facility's bins, including archived bins, through the board's batched read. */
export async function getFacilityOutputStock(
  ctx: OrgContext,
  facilityId: string,
): Promise<FacilityOutputStock> {
  requireOrgScope(ctx);
  return withStockSnapshot(async tx => {
    await requireOrgFacility(ctx, facilityId, tx);

    const bins = await tx.select({ id: storageLocations.id, type: storageLocations.type }).from(storageLocations).where(and(
      eq(storageLocations.organizationId, ctx.organizationId),
      eq(storageLocations.facilityId, facilityId),
      inArray(storageLocations.type, ["biochar_bin", "product_bin"]),
    ));
    const stocks = await getOutputBinStocks(ctx, bins.map(bin => bin.id), tx);
    const total: FacilityOutputStock = {
      biochar: { wetKg: 0, dryBiocharKg: 0 },
      product: { wetKg: 0, dryBiocharKg: 0 },
    };
    for (const bin of bins) {
      const stock = stocks.get(bin.id);
      const field = bin.type === "biochar_bin" ? "biochar" : "product";
      const group = total[field];
      if (group === null) continue;
      if (stock?.availableDryKg == null) {
        total[field] = null;
        continue;
      }
      // Only layers placed by now, as the bin cards and the wet estimate count them.
      group.dryBiocharKg += stock.availableDryKg;
      group.wetKg = group.wetKg === null || stock.estimatedWetMassKg === null
        ? null
        : group.wetKg + stock.estimatedWetMassKg;
    }
    return total;
  });
}
