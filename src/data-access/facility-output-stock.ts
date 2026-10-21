import { and, eq, inArray } from "drizzle-orm";
import { facilities, storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from "@/lib/errors";
import { withStockSnapshot } from "./output-bin-stock";
import { getOutputBinStocks } from "./output-stock";
import { requireOrgScope } from "./utils";

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
    const [facility] = await tx.select({ id: facilities.id }).from(facilities).where(and(
      eq(facilities.id, facilityId),
      eq(facilities.organizationId, ctx.organizationId),
    ));
    if (!facility) throw new SafeError("Facility not found");

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
      if (stock?.allLayersDryKg == null) {
        total[field] = null;
        continue;
      }
      // Lane summaries conserve every layer, including receipts placed later.
      group.dryBiocharKg += stock.allLayersDryKg;
      group.wetKg = group.wetKg === null || stock.estimatedWetMassKg === null
        ? null
        : group.wetKg + stock.estimatedWetMassKg;
    }
    return total;
  });
}
