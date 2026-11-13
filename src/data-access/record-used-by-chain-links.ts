import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, biocharProductSourceAllocations, creditBatchApplications, creditBatchProductionRuns,
  deliveries, productionRunFeedstocks, samples,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import type { RecordUsedByEdge, RecordUsedByKind } from "@/lib/record-used-by-chain";
import { usedByEdge, usedByMass } from "@/lib/record-used-by-chain-graph";
import { deletedProductIds } from "./output-stock-active-movements";
import { readUsedByStockEdges } from "./record-used-by-chain-stock";
import { requireOrgScope } from "./utils";

/** One set-based expansion per kind and depth, never per record. */
export async function readUsedByDownstreamEdges(ctx: OrgContext, kind: RecordUsedByKind, ids: string[]): Promise<RecordUsedByEdge[]> {
  requireOrgScope(ctx);
  if (!ids.length) return [];
  const org = ctx.organizationId;
  switch (kind) {
    case "feedstock": {
      const rows = await db.select({ from: productionRunFeedstocks.feedstockId, to: productionRunFeedstocks.productionRunId, kg: productionRunFeedstocks.wetMassUsedKg })
        .from(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.organizationId, org), inArray(productionRunFeedstocks.feedstockId, ids)));
      return rows.map(row => usedByEdge(kind, row.from, "productionRun", row.to, usedByMass(row.kg, "wet")));
    }
    case "productionRun": {
      const [products, batches, draws] = await Promise.all([
        db.select({ from: biocharProductSourceAllocations.productionRunId, to: biocharProductSourceAllocations.biocharProductId, kg: biocharProductSourceAllocations.allocatedDryMassKg })
          .from(biocharProductSourceAllocations)
          .where(and(eq(biocharProductSourceAllocations.organizationId, org), inArray(biocharProductSourceAllocations.productionRunId, ids),
            notInArray(biocharProductSourceAllocations.biocharProductId, deletedProductIds(ctx, db)))),
        db.select({ from: creditBatchProductionRuns.productionRunId, to: creditBatchProductionRuns.creditBatchId })
          .from(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, org), inArray(creditBatchProductionRuns.productionRunId, ids))),
        readUsedByStockEdges(ctx, kind, ids),
      ]);
      return [
        ...products.map(row => usedByEdge(kind, row.from, "biocharProduct", row.to, usedByMass(row.kg, "dryBiochar"))),
        ...batches.map(row => usedByEdge(kind, row.from, "creditBatch", row.to)), ...draws,
      ];
    }
    case "biocharProduct": return readUsedByStockEdges(ctx, kind, ids);
    case "order": {
      const rows = await db.select({ from: deliveries.orderId, to: deliveries.id, kg: deliveries.deliveredWetMassKg })
        .from(deliveries).where(and(eq(deliveries.organizationId, org), inArray(deliveries.orderId, ids)));
      return rows.map(row => usedByEdge(kind, row.from, "delivery", row.to, usedByMass(row.kg, "wet")));
    }
    case "delivery": {
      const [applied, ordered] = await Promise.all([
        db.select({ from: applications.deliveryId, to: applications.id, tonnes: applications.biocharAppliedTons })
          .from(applications).where(and(eq(applications.organizationId, org), inArray(applications.deliveryId, ids))),
        db.select({ from: deliveries.orderId, to: deliveries.id, kg: deliveries.deliveredWetMassKg })
          .from(deliveries).where(and(eq(deliveries.organizationId, org), inArray(deliveries.id, ids))),
      ]);
      // Orders are context for reached deliveries. The traversal must not expand
      // them into sibling deliveries containing unrelated source material.
      return [
        ...applied.flatMap(row => row.from ? [usedByEdge(kind, row.from, "application", row.to, usedByMass(row.tonnes * KG_PER_TONNE, "wet"))] : []),
        ...ordered.map(row => usedByEdge("order", row.from, kind, row.to, usedByMass(row.kg, "wet"))),
      ];
    }
    case "application": {
      const rows = await db.select({ from: creditBatchApplications.applicationId, to: creditBatchApplications.removalId,
        kg: sql<string>`sum(${creditBatchApplications.allocatedDryMassKg})` })
        .from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, org), inArray(creditBatchApplications.applicationId, ids), isNotNull(creditBatchApplications.removalId)))
        .groupBy(creditBatchApplications.applicationId, creditBatchApplications.removalId);
      return rows.flatMap(row => row.to ? [usedByEdge(kind, row.from, "removal", row.to, usedByMass(Number(row.kg), "dryBiochar"))] : []);
    }
    case "sample": {
      const rows = await db.selectDistinct({ from: samples.id, to: creditBatchApplications.removalId }).from(samples)
        .innerJoin(creditBatchApplications, and(eq(creditBatchApplications.organizationId, org), eq(creditBatchApplications.creditBatchId, samples.creditBatchId)))
        .where(and(eq(samples.organizationId, org), inArray(samples.id, ids), isNotNull(creditBatchApplications.removalId)));
      return rows.flatMap(row => row.to ? [usedByEdge(kind, row.from, "removal", row.to)] : []);
    }
    case "creditBatch": {
      const [batchSamples, slices] = await Promise.all([
        db.select({ from: samples.creditBatchId, to: samples.id }).from(samples)
          .where(and(eq(samples.organizationId, org), inArray(samples.creditBatchId, ids))),
        db.selectDistinct({ from: creditBatchApplications.creditBatchId, to: creditBatchApplications.removalId }).from(creditBatchApplications)
          .where(and(eq(creditBatchApplications.organizationId, org), inArray(creditBatchApplications.creditBatchId, ids), isNotNull(creditBatchApplications.removalId))),
      ]);
      return [
        ...batchSamples.map(row => usedByEdge(kind, row.from, "sample", row.to)),
        ...slices.flatMap(row => row.to ? [usedByEdge(kind, row.from, "removal", row.to)] : []),
      ];
    }
    case "removal": return [];
  }
}

/** Direct inputs only; these records are hydrated but never traversed. */
export async function readUsedByUpstreamEdges(ctx: OrgContext, kind: RecordUsedByKind, id: string): Promise<RecordUsedByEdge[]> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  switch (kind) {
    case "productionRun": {
      const rows = await db.select({ from: productionRunFeedstocks.feedstockId, kg: productionRunFeedstocks.wetMassUsedKg }).from(productionRunFeedstocks)
        .where(and(eq(productionRunFeedstocks.organizationId, org), eq(productionRunFeedstocks.productionRunId, id)));
      return rows.map(row => usedByEdge("feedstock", row.from, kind, id, usedByMass(row.kg, "wet")));
    }
    case "biocharProduct": {
      const rows = await db.select({ from: biocharProductSourceAllocations.productionRunId, kg: biocharProductSourceAllocations.allocatedDryMassKg }).from(biocharProductSourceAllocations)
        .where(and(eq(biocharProductSourceAllocations.organizationId, org), eq(biocharProductSourceAllocations.biocharProductId, id)));
      return rows.map(row => usedByEdge("productionRun", row.from, kind, id, usedByMass(row.kg, "dryBiochar")));
    }
    case "delivery": {
      const [draws, rows] = await Promise.all([
        readUsedByStockEdges(ctx, kind, [id]),
        db.select({ from: deliveries.orderId, kg: deliveries.deliveredWetMassKg }).from(deliveries)
          .where(and(eq(deliveries.organizationId, org), eq(deliveries.id, id))),
      ]);
      return [...draws, ...rows.map(row => usedByEdge("order", row.from, kind, id, usedByMass(row.kg, "wet")))];
    }
    case "application": {
      const rows = await db.select({ from: applications.deliveryId, tonnes: applications.biocharAppliedTons }).from(applications)
        .where(and(eq(applications.organizationId, org), eq(applications.id, id)));
      return rows.flatMap(row => row.from ? [usedByEdge("delivery", row.from, kind, id, usedByMass(row.tonnes * KG_PER_TONNE, "wet"))] : []);
    }
    case "sample": {
      const rows = await db.select({ from: samples.creditBatchId }).from(samples)
        .where(and(eq(samples.organizationId, org), eq(samples.id, id)));
      return rows.map(row => usedByEdge("creditBatch", row.from, kind, id));
    }
    case "creditBatch": {
      const rows = await db.select({ from: creditBatchProductionRuns.productionRunId }).from(creditBatchProductionRuns)
        .where(and(eq(creditBatchProductionRuns.organizationId, org), eq(creditBatchProductionRuns.creditBatchId, id)));
      return rows.map(row => usedByEdge("productionRun", row.from, kind, id));
    }
    case "removal": {
      const rows = await db.select({ from: creditBatchApplications.applicationId, kg: sql<string>`sum(${creditBatchApplications.allocatedDryMassKg})` }).from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, org), eq(creditBatchApplications.removalId, id)))
        .groupBy(creditBatchApplications.applicationId);
      return rows.map(row => usedByEdge("application", row.from, kind, id, usedByMass(Number(row.kg), "dryBiochar")));
    }
    case "feedstock":
    case "order": return [];
  }
}
