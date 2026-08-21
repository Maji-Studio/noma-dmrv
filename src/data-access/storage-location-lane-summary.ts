import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import {
  biocharProducts,
  deliveries,
  orders,
  storageLocations,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { productWetMassKgSql } from "./biochar-product-source-mass";
import { deriveLaneStock } from "./lane-stock-derivation";
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
  const productBinIds = bins
    .filter((bin) => bin.type === "product_bin")
    .map((bin) => bin.id);
  const [productRows, deliveredRows] =
    productBinIds.length > 0
      ? await Promise.all([
          db
            .select({
              storageLocationId: biocharProducts.storageLocationId,
              // Delivered wet mass on the out side includes added water, so
              // product intake must use the same complete wet-mass basis.
              total: sumNumeric(
                productWetMassKgSql(
                  biocharProducts.massKg,
                  biocharProducts.waterAddedKg,
                ),
              ),
            })
            .from(biocharProducts)
            .where(
              and(
                inArray(biocharProducts.storageLocationId, productBinIds),
                eq(biocharProducts.organizationId, ctx.organizationId),
              ),
            )
            .groupBy(biocharProducts.storageLocationId),
          db
            .select({
              storageLocationId: biocharProducts.storageLocationId,
              total: sumNumeric(deliveries.deliveredWetMassKg),
            })
            .from(deliveries)
            .innerJoin(
              orders,
              and(
                eq(deliveries.orderId, orders.id),
                eq(orders.organizationId, ctx.organizationId),
              ),
            )
            .innerJoin(
              biocharProducts,
              and(
                sql`${biocharProducts.id} = COALESCE(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
                eq(biocharProducts.organizationId, ctx.organizationId),
              ),
            )
            .where(
              and(
                eq(deliveries.status, "delivered"),
                eq(deliveries.organizationId, ctx.organizationId),
                inArray(biocharProducts.storageLocationId, productBinIds),
              ),
            )
            .groupBy(biocharProducts.storageLocationId),
        ])
      : [[], []];
  const productById = new Map(
    productRows.flatMap((row) =>
      row.storageLocationId ? [[row.storageLocationId, row.total] as const] : [],
    ),
  );
  const deliveredById = new Map(
    deliveredRows.flatMap((row) =>
      row.storageLocationId ? [[row.storageLocationId, row.total] as const] : [],
    ),
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
    } else if (bin.type === "biochar_bin") {
      summary[bin.type].onHandKg += stock?.biocharStockKg ?? 0;
    } else {
      summary[bin.type].onHandKg +=
        (productById.get(bin.id) ?? 0) -
        (deliveredById.get(bin.id) ?? 0) +
        (stock?.productMovementDeltaKg ?? 0);
    }
  }

  return summary;
}
