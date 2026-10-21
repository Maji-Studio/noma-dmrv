import { and, eq, inArray, isNull } from "drizzle-orm";
import { storageLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { rationalToNumber } from "@/lib/output-stock";
import { isOutputBinType } from "@/schemas/storage-locations";
import { readOutputBinStockAt, withStockSnapshot } from "./output-bin-stock";
import { requireOrgScope } from "./utils";

export interface FacilityOutputStockGroup {
  wetKg: number | null;
  dryBiocharKg: number;
}

export interface FacilityOutputStock {
  biochar: FacilityOutputStockGroup | null;
  product: FacilityOutputStockGroup | null;
}

/** Sum per-bin wet estimates and known dry biochar in one snapshot, keeping unknowns. */
export async function getFacilityOutputStock(
  ctx: OrgContext,
  facilityIds: string[],
): Promise<Map<string, FacilityOutputStock>> {
  requireOrgScope(ctx);
  const totals = new Map<string, FacilityOutputStock>(facilityIds.map(id => [id, {
    biochar: { wetKg: 0, dryBiocharKg: 0 },
    product: { wetKg: 0, dryBiocharKg: 0 },
  }]));
  if (!facilityIds.length) return totals;

  return withStockSnapshot(async tx => {
    const bins = await tx.select().from(storageLocations).where(and(
      eq(storageLocations.organizationId, ctx.organizationId),
      inArray(storageLocations.facilityId, facilityIds),
      inArray(storageLocations.type, ["biochar_bin", "product_bin"]),
      isNull(storageLocations.archivedAt),
    ));
    // The lookup fixes the snapshot. Take the instant afterwards so every
    // placement visible in that snapshot is eligible for the shared read.
    const at = new Date().toISOString();
    for (const bin of bins) {
      if (!isOutputBinType(bin.type)) continue;
      const { stock } = await readOutputBinStockAt(ctx, { ...bin, type: bin.type }, at, tx, { includeArchived: false });
      const total = totals.get(bin.facilityId)!;
      const field = bin.type === "biochar_bin" ? "biochar" : "product";
      const group = total[field];
      if (group === null) continue;
      if (stock.totals === null) {
        total[field] = null;
        continue;
      }
      const { estimatedWetKg, dryBiocharKg } = stock.totals;
      group.dryBiocharKg += rationalToNumber(dryBiocharKg);
      group.wetKg = group.wetKg === null || estimatedWetKg === null
        ? null
        : group.wetKg + rationalToNumber(estimatedWetKg);
    }
    return totals;
  });
}
