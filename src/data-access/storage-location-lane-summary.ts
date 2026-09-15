import { db } from "@/db";
import {
  storageLocations
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import { deriveLaneStock } from "./lane-stock-derivation";
import { getOutputBinDryBalance } from './output-stock';
import { requireOrgScope } from "./utils";

export async function getStorageLocationLaneSummary(
  ctx: OrgContext,
  options: { facilityId?: string; archived: boolean },
): Promise<
  Record<StorageLocationType, { binCount: number; onHandKg: number }>
> {
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
  const summary: Record<
    StorageLocationType,
    { binCount: number; onHandKg: number }
  > = {
    feedstock_bin: { binCount: 0, onHandKg: 0 },
    biochar_bin: { binCount: 0, onHandKg: 0 },
    product_bin: { binCount: 0, onHandKg: 0 },
  };

  for (const bin of bins) {
    const stock = laneStockById.get(bin.id);
    summary[bin.type].binCount += 1;
    if (bin.type === "feedstock_bin") {
      summary[bin.type].onHandKg += stock?.feedstockStockWetKg ?? 0;
    } else if (!options.archived) {
      summary[bin.type].onHandKg += await getOutputBinDryBalance(ctx, bin.id);
    }
  }

  return summary;
}
