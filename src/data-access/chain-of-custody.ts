/**
 * Chain of Custody data access
 * Queries entity counts grouped by status for a given facility,
 * plus recent item codes/names for display in the DAG nodes.
 */
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  facilities,
  reactors,
  storageLocations,
  suppliers,
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
    supplierRows,
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
    supplierItems,
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

    // Suppliers — distinct suppliers linked via feedstock deliveries (no status)
    db
      .selectDistinct({ id: suppliers.id })
      .from(suppliers)
      .innerJoin(feedstockDeliveries, eq(feedstockDeliveries.supplierId, suppliers.id))
      .where(eq(feedstockDeliveries.facilityId, facilityId))
      .then((rows) => [{ status: null as string | null, count: rows.length }]),

    // Reactors — no status field
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(reactors)
      .where(eq(reactors.facilityId, facilityId)),

    // Storage Locations — split by type (no status field)
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(storageLocations)
      .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.type, "feedstock_bin"))),
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(storageLocations)
      .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.type, "biochar_bin"))),
    db
      .select({ status: sql<string | null>`null`.as("status"), count: count() })
      .from(storageLocations)
      .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.type, "product_bin"))),

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
      .selectDistinct({ code: suppliers.code, name: suppliers.name })
      .from(suppliers)
      .innerJoin(feedstockDeliveries, eq(feedstockDeliveries.supplierId, suppliers.id))
      .where(eq(feedstockDeliveries.facilityId, facilityId))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: reactors.code })
      .from(reactors)
      .where(eq(reactors.facilityId, facilityId))
      .orderBy(desc(reactors.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: storageLocations.code, name: storageLocations.name })
      .from(storageLocations)
      .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.type, "feedstock_bin")))
      .orderBy(desc(storageLocations.createdAt))
      .limit(ITEMS_LIMIT),
    db
      .select({ code: storageLocations.code, name: storageLocations.name })
      .from(storageLocations)
      .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.type, "biochar_bin")))
      .orderBy(desc(storageLocations.createdAt))
      .limit(ITEMS_LIMIT),
    db
      .select({ code: storageLocations.code, name: storageLocations.name })
      .from(storageLocations)
      .where(and(eq(storageLocations.facilityId, facilityId), eq(storageLocations.type, "product_bin")))
      .orderBy(desc(storageLocations.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: feedstockDeliveries.code })
      .from(feedstockDeliveries)
      .where(eq(feedstockDeliveries.facilityId, facilityId))
      .orderBy(desc(feedstockDeliveries.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: feedstocks.code })
      .from(feedstocks)
      .where(eq(feedstocks.facilityId, facilityId))
      .orderBy(desc(feedstocks.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: productionRuns.code })
      .from(productionRuns)
      .where(eq(productionRuns.facilityId, facilityId))
      .orderBy(desc(productionRuns.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: samples.sampleCode })
      .from(samples)
      .innerJoin(productionRuns, eq(samples.productionRunId, productionRuns.id))
      .where(eq(productionRuns.facilityId, facilityId))
      .orderBy(desc(samples.createdAt))
      .limit(ITEMS_LIMIT)
      .then((rows) => rows.map((r) => ({ code: r.code }))),

    db
      .select({ code: biocharProducts.code })
      .from(biocharProducts)
      .where(eq(biocharProducts.facilityId, facilityId))
      .orderBy(desc(biocharProducts.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: orders.code })
      .from(orders)
      .where(eq(orders.facilityId, facilityId))
      .orderBy(desc(orders.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: deliveries.code })
      .from(deliveries)
      .where(eq(deliveries.facilityId, facilityId))
      .orderBy(desc(deliveries.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: applications.code })
      .from(applications)
      .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
      .where(eq(deliveries.facilityId, facilityId))
      .orderBy(desc(applications.createdAt))
      .limit(ITEMS_LIMIT),

    db
      .select({ code: creditBatches.code })
      .from(creditBatches)
      .where(eq(creditBatches.facilityId, facilityId))
      .orderBy(desc(creditBatches.createdAt))
      .limit(ITEMS_LIMIT),
  ]);

  const entitySummaries: EntitySummary[] = [
    { entityType: "suppliers", ...aggregateStatusRows(supplierRows), items: supplierItems },
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
