import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { applications, biocharProducts, certifierRemovals, creditBatches, deliveries, feedstocks, orders, productionRuns, samples } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordUsedByKind, RecordUsedByNode } from "@/lib/record-used-by-chain";
import { deletedProductIds } from "./output-stock-active-movements";
import { requireOrgScope } from "./utils";

// Detail reads retain archived facility history; a reversed product is deleted.
const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export async function readUsedByNodes(ctx: OrgContext, kind: RecordUsedByKind, ids: string[]): Promise<RecordUsedByNode[]> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  if (ids.length === 0) return [];
  switch (kind) {
    case "feedstock": {
      const rows = await db.select({ id: feedstocks.id, code: feedstocks.code, facilityId: feedstocks.facilityId, at: feedstocks.deliveryDate })
        .from(feedstocks).where(and(eq(feedstocks.organizationId, org), inArray(feedstocks.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: iso(row.at), calendarDay: true }));
    }
    case "productionRun": {
      const rows = await db.select({ id: productionRuns.id, code: productionRuns.code, facilityId: productionRuns.facilityId, start: productionRuns.startTime, end: productionRuns.endTime })
        .from(productionRuns).where(and(eq(productionRuns.organizationId, org), inArray(productionRuns.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: iso(row.end ?? row.start), calendarDay: false }));
    }
    case "biocharProduct": {
      const rows = await db.select({ id: biocharProducts.id, code: biocharProducts.code, facilityId: biocharProducts.facilityId, at: biocharProducts.productionDate })
        .from(biocharProducts).where(and(eq(biocharProducts.organizationId, org), inArray(biocharProducts.id, ids),
          notInArray(biocharProducts.id, deletedProductIds(ctx, db))));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: row.at, calendarDay: true }));
    }
    case "order": {
      const rows = await db.select({ id: orders.id, code: orders.code, facilityId: orders.facilityId, at: orders.orderDate })
        .from(orders).where(and(eq(orders.organizationId, org), inArray(orders.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: iso(row.at), calendarDay: true }));
    }
    case "delivery": {
      const rows = await db.select({ id: deliveries.id, code: deliveries.code, facilityId: deliveries.facilityId, at: deliveries.deliveryDate })
        .from(deliveries).where(and(eq(deliveries.organizationId, org), inArray(deliveries.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: iso(row.at), calendarDay: false }));
    }
    case "application": {
      const rows = await db.select({ id: applications.id, code: applications.code, facilityId: deliveries.facilityId, at: applications.applicationDate })
        .from(applications)
        .leftJoin(deliveries, and(eq(deliveries.organizationId, org), eq(deliveries.id, applications.deliveryId)))
        .where(and(eq(applications.organizationId, org), inArray(applications.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: iso(row.at), calendarDay: true }));
    }
    case "sample": {
      const rows = await db.select({ id: samples.id, code: samples.sampleCode, facilityId: creditBatches.facilityId, at: samples.samplingTime })
        .from(samples)
        .leftJoin(creditBatches, and(eq(creditBatches.organizationId, org), eq(creditBatches.id, samples.creditBatchId)))
        .where(and(eq(samples.organizationId, org), inArray(samples.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: iso(row.at), calendarDay: false }));
    }
    case "removal": {
      const rows = await db.select({ id: certifierRemovals.id, code: certifierRemovals.code, facilityId: certifierRemovals.facilityId, at: certifierRemovals.completedOn })
        .from(certifierRemovals).where(and(eq(certifierRemovals.organizationId, org), inArray(certifierRemovals.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: null, facilityId: row.facilityId, at: row.at, calendarDay: true }));
    }
    case "creditBatch": {
      const rows = await db.select({ id: creditBatches.id, code: creditBatches.code, name: creditBatches.name, facilityId: creditBatches.facilityId, at: creditBatches.startDate })
        .from(creditBatches).where(and(eq(creditBatches.organizationId, org), inArray(creditBatches.id, ids)));
      return rows.map(row => ({ kind, id: row.id, code: row.code, name: row.name, facilityId: row.facilityId, at: row.at, calendarDay: true }));
    }
  }
}
