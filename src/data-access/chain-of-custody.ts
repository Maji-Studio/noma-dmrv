/**
 * Chain of Custody data access
 * Queries entity counts grouped by status for a given facility,
 * plus recent item codes/names for display in the DAG nodes.
 */
import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  facilities,
  reactors,
  storageLocations,
  feedstockDeliveries,
  feedstocks,
  productionRuns,
  samples,
  biocharProducts,
  orders,
  deliveries,
  applications,
  creditBatches,
} from "@/db/schema";
import { requireAuth } from "@/lib/auth/server";

// ============================================
// Types
// ============================================

const ITEMS_LIMIT = 5;

export interface EntityItem {
  code: string;
  name?: string;
}

export interface EntitySummary {
  entityType: string;
  total: number;
  byStatus: Record<string, number>;
  items: EntityItem[];
}

export interface ChainOfCustodyData {
  facility: { id: string; code: string; name: string };
  entitySummaries: EntitySummary[];
}

// ============================================
// Helpers
// ============================================

type StatusRow = { status: string | null; count: number };

function aggregateStatusRows(rows: StatusRow[]): { total: number; byStatus: Record<string, number> } {
  let total = 0;
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    total += row.count;
    if (row.status) {
      byStatus[row.status] = row.count;
    }
  }
  return { total, byStatus };
}

// ============================================
// Main query
// ============================================

export async function getChainOfCustodyData(
  userId: string,
  facilityId: string
): Promise<ChainOfCustodyData> {
  await requireAuth();

  // Verify facility exists
  const [facility] = await db
    .select({ id: facilities.id, code: facilities.code, name: facilities.name })
    .from(facilities)
    .where(eq(facilities.id, facilityId))
    .limit(1);

  if (!facility) {
    throw new Error("Facility not found");
  }

  // Run all count queries + item queries in parallel
  const [
    reactorRows,
    slFeedstockBinRows,
    slBiocharBinRows,
    slProductBinRows,
    feedstockDeliveryRows,
    feedstockRows,
    productionRunRows,
    sampleRows,
    biocharProductRows,
    orderRows,
    deliveryRows,
    applicationRows,
    creditBatchRows,
    // Item queries
    reactorItems,
    slFeedstockBinItems,
    slBiocharBinItems,
    slProductBinItems,
    feedstockDeliveryItems,
    feedstockItems,
    productionRunItems,
    sampleItems,
    biocharProductItems,
    orderItems,
    deliveryItems,
    applicationItems,
    creditBatchItems,
  ] = await Promise.all([
    // --- Status count queries ---

    // Reactors — no status field
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(reactors)
      .where(eq(reactors.facilityId, facilityId)),

    // Storage Locations — split by type (no status field)
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(storageLocations)
      .where(sql`${storageLocations.facilityId} = ${facilityId} AND ${storageLocations.type} = 'feedstock_bin'`),
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(storageLocations)
      .where(sql`${storageLocations.facilityId} = ${facilityId} AND ${storageLocations.type} = 'biochar_bin'`),
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(storageLocations)
      .where(sql`${storageLocations.facilityId} = ${facilityId} AND ${storageLocations.type} = 'product_bin'`),

    // Feedstock Deliveries — has status
    db
      .select({ status: feedstockDeliveries.status, count: count() })
      .from(feedstockDeliveries)
      .where(eq(feedstockDeliveries.facilityId, facilityId))
      .groupBy(feedstockDeliveries.status),

    // Feedstocks — has status
    db
      .select({ status: feedstocks.status, count: count() })
      .from(feedstocks)
      .where(eq(feedstocks.facilityId, facilityId))
      .groupBy(feedstocks.status),

    // Production Runs — has status
    db
      .select({ status: productionRuns.status, count: count() })
      .from(productionRuns)
      .where(eq(productionRuns.facilityId, facilityId))
      .groupBy(productionRuns.status),

    // Samples — no status, join via productionRuns
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(samples)
      .innerJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
      .where(eq(productionRuns.facilityId, facilityId)),

    // Biochar Products — has status
    db
      .select({ status: biocharProducts.status, count: count() })
      .from(biocharProducts)
      .where(eq(biocharProducts.facilityId, facilityId))
      .groupBy(biocharProducts.status),

    // Orders — has status
    db
      .select({ status: orders.status, count: count() })
      .from(orders)
      .where(eq(orders.facilityId, facilityId))
      .groupBy(orders.status),

    // Deliveries — has status
    db
      .select({ status: deliveries.status, count: count() })
      .from(deliveries)
      .where(eq(deliveries.facilityId, facilityId))
      .groupBy(deliveries.status),

    // Applications — has status, join via deliveries
    db
      .select({ status: applications.status, count: count() })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(eq(deliveries.facilityId, facilityId))
      .groupBy(applications.status),

    // Credit Batches — has status
    db
      .select({ status: creditBatches.status, count: count() })
      .from(creditBatches)
      .where(eq(creditBatches.facilityId, facilityId))
      .groupBy(creditBatches.status),

    // --- Item queries (code + optional name, limited) ---

    db
      .select({ code: reactors.code })
      .from(reactors)
      .where(eq(reactors.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: storageLocations.code, name: storageLocations.name })
      .from(storageLocations)
      .where(sql`${storageLocations.facilityId} = ${facilityId} AND ${storageLocations.type} = 'feedstock_bin'`)
      .limit(ITEMS_LIMIT),
    db
      .select({ code: storageLocations.code, name: storageLocations.name })
      .from(storageLocations)
      .where(sql`${storageLocations.facilityId} = ${facilityId} AND ${storageLocations.type} = 'biochar_bin'`)
      .limit(ITEMS_LIMIT),
    db
      .select({ code: storageLocations.code, name: storageLocations.name })
      .from(storageLocations)
      .where(sql`${storageLocations.facilityId} = ${facilityId} AND ${storageLocations.type} = 'product_bin'`)
      .limit(ITEMS_LIMIT),

    db
      .select({ code: feedstockDeliveries.code })
      .from(feedstockDeliveries)
      .where(eq(feedstockDeliveries.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: feedstocks.code })
      .from(feedstocks)
      .where(eq(feedstocks.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: productionRuns.code })
      .from(productionRuns)
      .where(eq(productionRuns.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: samples.sampleCode })
      .from(samples)
      .innerJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
      .where(eq(productionRuns.facilityId, facilityId))
      .limit(ITEMS_LIMIT)
      .then((rows) => rows.map((r) => ({ code: r.code }))),

    db
      .select({ code: biocharProducts.code })
      .from(biocharProducts)
      .where(eq(biocharProducts.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: orders.code })
      .from(orders)
      .where(eq(orders.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: deliveries.code })
      .from(deliveries)
      .where(eq(deliveries.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: applications.code })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(eq(deliveries.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: creditBatches.code })
      .from(creditBatches)
      .where(eq(creditBatches.facilityId, facilityId))
      .limit(ITEMS_LIMIT),
  ]);

  const entitySummaries: EntitySummary[] = [
    { entityType: "reactors", ...aggregateStatusRows(reactorRows), items: reactorItems },
    { entityType: "feedstockBin", ...aggregateStatusRows(slFeedstockBinRows), items: slFeedstockBinItems },
    { entityType: "biocharBin", ...aggregateStatusRows(slBiocharBinRows), items: slBiocharBinItems },
    { entityType: "productBin", ...aggregateStatusRows(slProductBinRows), items: slProductBinItems },
    { entityType: "feedstockDeliveries", ...aggregateStatusRows(feedstockDeliveryRows), items: feedstockDeliveryItems },
    { entityType: "feedstocks", ...aggregateStatusRows(feedstockRows), items: feedstockItems },
    { entityType: "productionRuns", ...aggregateStatusRows(productionRunRows), items: productionRunItems },
    { entityType: "samples", ...aggregateStatusRows(sampleRows), items: sampleItems },
    { entityType: "biocharProducts", ...aggregateStatusRows(biocharProductRows), items: biocharProductItems },
    { entityType: "orders", ...aggregateStatusRows(orderRows), items: orderItems },
    { entityType: "deliveries", ...aggregateStatusRows(deliveryRows), items: deliveryItems },
    { entityType: "applications", ...aggregateStatusRows(applicationRows), items: applicationItems },
    { entityType: "creditBatches", ...aggregateStatusRows(creditBatchRows), items: creditBatchItems },
  ];

  return { facility, entitySummaries };
}
