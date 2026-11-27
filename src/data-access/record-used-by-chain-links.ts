import { loadBatchEmissionContributors, loadRunEmissionContributors } from "./credit-batch-emission-contributors";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, biocharProductSourceAllocations, creditBatchApplications, creditBatchProductionRuns,
  deliveries, productionRunFeedstocks, samples,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { RecordUsedByEdge, RecordUsedByKind } from "@/lib/record-used-by-chain";
import { usedByEdge } from "@/lib/record-used-by-chain-graph";
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
      const rows = await db.select({ from: productionRunFeedstocks.feedstockId, to: productionRunFeedstocks.productionRunId })
        .from(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.organizationId, org), inArray(productionRunFeedstocks.feedstockId, ids)));
      return rows.map(row => usedByEdge(kind, row.from, "productionRun", row.to));
    }
    case "productionRun": {
      const [products, batches, draws, emissions] = await Promise.all([
        db.select({ from: biocharProductSourceAllocations.productionRunId, to: biocharProductSourceAllocations.biocharProductId })
          .from(biocharProductSourceAllocations)
          .where(and(eq(biocharProductSourceAllocations.organizationId, org), inArray(biocharProductSourceAllocations.productionRunId, ids),
            notInArray(biocharProductSourceAllocations.biocharProductId, deletedProductIds(ctx, db)))),
        db.select({ from: creditBatchProductionRuns.productionRunId, to: creditBatchProductionRuns.creditBatchId })
          .from(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, org), inArray(creditBatchProductionRuns.productionRunId, ids))),
        readUsedByStockEdges(ctx, kind, ids),
        loadRunEmissionContributors(ctx, ids),
      ]);
      return [
        ...emissions.flatMap(run => run.kind === "failed" && run.creditBatchId
          ? [{ ...usedByEdge(kind, run.runId, "creditBatch", run.creditBatchId), dependency: "production-emissions" as const }] : []),
        ...products.map(row => usedByEdge(kind, row.from, "biocharProduct", row.to)),
        ...batches.map(row => usedByEdge(kind, row.from, "creditBatch", row.to)), ...draws,
      ];
    }
    case "biocharProduct": return readUsedByStockEdges(ctx, kind, ids);
    case "order": {
      const rows = await db.select({ from: deliveries.orderId, to: deliveries.id })
        .from(deliveries).where(and(eq(deliveries.organizationId, org), inArray(deliveries.orderId, ids)));
      return rows.map(row => usedByEdge(kind, row.from, "delivery", row.to));
    }
    case "delivery": {
      const [applied, ordered] = await Promise.all([
        db.select({ from: applications.deliveryId, to: applications.id })
          .from(applications).where(and(eq(applications.organizationId, org), inArray(applications.deliveryId, ids))),
        db.select({ from: deliveries.orderId, to: deliveries.id })
          .from(deliveries).where(and(eq(deliveries.organizationId, org), inArray(deliveries.id, ids))),
      ]);
      // Orders are context for reached deliveries. The traversal must not expand
      // them into sibling deliveries containing unrelated source material.
      return [
        ...applied.flatMap(row => row.from ? [usedByEdge(kind, row.from, "application", row.to)] : []),
        ...ordered.map(row => usedByEdge("order", row.from, kind, row.to)),
      ];
    }
    case "application": {
      const rows = await db.select({ from: creditBatchApplications.applicationId, to: creditBatchApplications.removalId })
        .from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, org), inArray(creditBatchApplications.applicationId, ids), isNotNull(creditBatchApplications.removalId)))
        .groupBy(creditBatchApplications.applicationId, creditBatchApplications.removalId);
      return rows.flatMap(row => row.to ? [usedByEdge(kind, row.from, "removal", row.to)] : []);
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
      const rows = await db.select({ from: productionRunFeedstocks.feedstockId }).from(productionRunFeedstocks)
        .where(and(eq(productionRunFeedstocks.organizationId, org), eq(productionRunFeedstocks.productionRunId, id)));
      return rows.map(row => usedByEdge("feedstock", row.from, kind, id));
    }
    case "biocharProduct": {
      const rows = await db.select({ from: biocharProductSourceAllocations.productionRunId }).from(biocharProductSourceAllocations)
        .where(and(eq(biocharProductSourceAllocations.organizationId, org), eq(biocharProductSourceAllocations.biocharProductId, id)));
      return rows.map(row => usedByEdge("productionRun", row.from, kind, id));
    }
    case "delivery": {
      const [draws, rows] = await Promise.all([
        readUsedByStockEdges(ctx, kind, [id]),
        db.select({ from: deliveries.orderId }).from(deliveries)
          .where(and(eq(deliveries.organizationId, org), eq(deliveries.id, id))),
      ]);
      return [...draws, ...rows.map(row => usedByEdge("order", row.from, kind, id))];
    }
    case "application": {
      const rows = await db.select({ from: applications.deliveryId }).from(applications)
        .where(and(eq(applications.organizationId, org), eq(applications.id, id)));
      return rows.flatMap(row => row.from ? [usedByEdge("delivery", row.from, kind, id)] : []);
    }
    case "sample": {
      const rows = await db.select({ from: samples.creditBatchId }).from(samples)
        .where(and(eq(samples.organizationId, org), eq(samples.id, id)));
      return rows.map(row => usedByEdge("creditBatch", row.from, kind, id));
    }
    case "creditBatch": {
      const rows = await db.select({ from: creditBatchProductionRuns.productionRunId }).from(creditBatchProductionRuns)
        .where(and(eq(creditBatchProductionRuns.organizationId, org), eq(creditBatchProductionRuns.creditBatchId, id)));
      const emissions = await loadBatchEmissionContributors(ctx, [id]);
      return [...rows.map(row => usedByEdge("productionRun", row.from, kind, id)),
        ...(emissions[id]?.failedContributors ?? []).map(run => ({
          ...usedByEdge("productionRun", run.runId, kind, id), dependency: "production-emissions" as const,
        }))];
    }
    case "removal": {
      const rows = await db.select({ from: creditBatchApplications.applicationId }).from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, org), eq(creditBatchApplications.removalId, id)))
        .groupBy(creditBatchApplications.applicationId);
      return rows.map(row => usedByEdge("application", row.from, kind, id));
    }
    case "feedstock":
    case "order": return [];
  }
}
