/**
 * PROTOTYPE ONLY (Used by section round, branch prototype/used-by-section).
 * Read-only: what a record went into, record by record, with dates and the
 * mass that moved along each link, for the three Used by variants. Delete
 * with the prototype once a variant is picked.
 */
import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications, biocharProductSourceAllocations, biocharProducts, certifierRemovals, creditBatchApplications, creditBatchProductionRuns,
  creditBatches, deliveries, feedstocks, orders, outputStockAllocations, outputStockRunAllocations, productionRunFeedstocks, productionRuns, samples,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import type {
  PrototypeUsedByBatch, PrototypeUsedByEdge, PrototypeUsedByGraph, PrototypeUsedByKind, PrototypeUsedByMass, PrototypeUsedByNode,
} from "@/lib/prototype-used-by";
import { prototypeNodeKey } from "@/lib/prototype-used-by";
import { deletedProductIds } from "./output-stock-active-movements";
import { requireOrgScope } from "./utils";

/** Feedstock to Removal is five hops; one more covers a credit batch's samples. */
const MAX_DEPTH = 6;

type Expansion = { nodes: PrototypeUsedByNode[]; edges: PrototypeUsedByEdge[] };

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
const positive = (kg: number | null) => (kg != null && kg > 0 ? kg : null);

async function nodesOf(ctx: OrgContext, kind: PrototypeUsedByKind, ids: string[]): Promise<PrototypeUsedByNode[]> {
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
        .from(biocharProducts).where(and(eq(biocharProducts.organizationId, org), inArray(biocharProducts.id, ids)));
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

/** Signed layer allocations summed per (layer, delivery): reversals cancel, replacements count once. */
async function deliveryDraws(ctx: OrgContext, layer: "run" | "product", ids: string[]) {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const column = layer === "run" ? outputStockAllocations.productionRunId : outputStockAllocations.biocharProductId;
  const rows = await db.select({
    sourceId: column, deliveryId: outputStockAllocations.deliveryId,
    dryKg: sql<string>`sum(${outputStockAllocations.dryMassKg})`, wetKg: sql<string | null>`sum(${outputStockAllocations.wetMassKg})`,
  }).from(outputStockAllocations)
    .where(and(eq(outputStockAllocations.organizationId, org), inArray(column, ids), isNotNull(outputStockAllocations.deliveryId)))
    .groupBy(column, outputStockAllocations.deliveryId);
  return rows.flatMap(row => {
    const dryKg = positive(Number(row.dryKg));
    if (!row.sourceId || !row.deliveryId || dryKg == null) return [];
    return [{ sourceId: row.sourceId, deliveryId: row.deliveryId, dryKg, wetKg: positive(row.wetKg == null ? null : Number(row.wetKg)) }];
  });
}

/** One hop downstream from records of one kind. */
async function expand(ctx: OrgContext, kind: PrototypeUsedByKind, ids: string[]): Promise<Expansion> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const edges: PrototypeUsedByEdge[] = [];
  const wanted = new Map<PrototypeUsedByKind, Set<string>>();
  const link = (fromKind: PrototypeUsedByKind, fromId: string, toKind: PrototypeUsedByKind, toId: string, mass: PrototypeUsedByMass | null) => {
    edges.push({ from: prototypeNodeKey(fromKind, fromId), to: prototypeNodeKey(toKind, toId), mass });
    if (!wanted.has(toKind)) wanted.set(toKind, new Set());
    wanted.get(toKind)!.add(toId);
  };
  switch (kind) {
    case "feedstock": {
      const rows = await db.select({ from: productionRunFeedstocks.feedstockId, to: productionRunFeedstocks.productionRunId, wetKg: productionRunFeedstocks.wetMassUsedKg })
        .from(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.organizationId, org), inArray(productionRunFeedstocks.feedstockId, ids)));
      for (const row of rows) link(kind, row.from, "productionRun", row.to, { kg: row.wetKg, basis: "wet" });
      break;
    }
    case "productionRun": {
      const products = await db.select({ from: biocharProductSourceAllocations.productionRunId, to: biocharProductSourceAllocations.biocharProductId, dryKg: biocharProductSourceAllocations.allocatedDryMassKg })
        .from(biocharProductSourceAllocations)
        .where(and(eq(biocharProductSourceAllocations.organizationId, org), inArray(biocharProductSourceAllocations.productionRunId, ids),
          notInArray(biocharProductSourceAllocations.biocharProductId, deletedProductIds(ctx, db))));
      for (const row of products) link(kind, row.from, "biocharProduct", row.to, { kg: row.dryKg, basis: "dryBiochar" });
      for (const row of await deliveryDraws(ctx, "run", ids)) link(kind, row.sourceId, "delivery", row.deliveryId, { kg: row.dryKg, basis: "dryBiochar" });
      break;
    }
    case "biocharProduct": {
      for (const row of await deliveryDraws(ctx, "product", ids)) {
        link(kind, row.sourceId, "delivery", row.deliveryId, row.wetKg != null ? { kg: row.wetKg, basis: "wet" } : { kg: row.dryKg, basis: "dryBiochar" });
      }
      break;
    }
    case "order": {
      const rows = await db.select({ from: deliveries.orderId, to: deliveries.id, wetKg: deliveries.deliveredWetMassKg })
        .from(deliveries).where(and(eq(deliveries.organizationId, org), inArray(deliveries.orderId, ids)));
      for (const row of rows) link(kind, row.from, "delivery", row.to, { kg: row.wetKg, basis: "wet" });
      break;
    }
    case "delivery": {
      const rows = await db.select({ from: applications.deliveryId, to: applications.id, wetTonnes: applications.biocharAppliedTons })
        .from(applications).where(and(eq(applications.organizationId, org), inArray(applications.deliveryId, ids)));
      for (const row of rows) if (row.from) link(kind, row.from, "application", row.to, { kg: row.wetTonnes * KG_PER_TONNE, basis: "wet" });
      break;
    }
    case "application": {
      const rows = await db.select({ from: creditBatchApplications.applicationId, to: creditBatchApplications.removalId, dryKg: sql<string>`sum(${creditBatchApplications.allocatedDryMassKg})` })
        .from(creditBatchApplications)
        .where(and(eq(creditBatchApplications.organizationId, org), inArray(creditBatchApplications.applicationId, ids), isNotNull(creditBatchApplications.removalId)))
        .groupBy(creditBatchApplications.applicationId, creditBatchApplications.removalId);
      for (const row of rows) if (row.to) link(kind, row.from, "removal", row.to, { kg: Number(row.dryKg), basis: "dryBiochar" });
      break;
    }
    case "sample": {
      const rows = await db.selectDistinct({ from: samples.id, to: creditBatchApplications.removalId }).from(samples)
        .innerJoin(creditBatchApplications, and(eq(creditBatchApplications.organizationId, org), eq(creditBatchApplications.creditBatchId, samples.creditBatchId)))
        .where(and(eq(samples.organizationId, org), inArray(samples.id, ids), isNotNull(creditBatchApplications.removalId)));
      for (const row of rows) if (row.to) link(kind, row.from, "removal", row.to, null);
      break;
    }
    case "creditBatch": {
      const [batchSamples, slices] = await Promise.all([
        db.select({ from: samples.creditBatchId, to: samples.id }).from(samples)
          .where(and(eq(samples.organizationId, org), inArray(samples.creditBatchId, ids))),
        db.selectDistinct({ from: creditBatchApplications.creditBatchId, to: creditBatchApplications.removalId }).from(creditBatchApplications)
          .where(and(eq(creditBatchApplications.organizationId, org), inArray(creditBatchApplications.creditBatchId, ids), isNotNull(creditBatchApplications.removalId))),
      ]);
      for (const row of batchSamples) if (row.from) link(kind, row.from, "sample", row.to, null);
      for (const row of slices) if (row.to) link(kind, row.from, "removal", row.to, null);
      break;
    }
    case "removal":
      break;
  }
  const nodes = (await Promise.all([...wanted].map(([toKind, toIds]) => nodesOf(ctx, toKind, [...toIds])))).flat();
  return { nodes, edges };
}

/** One hop upstream: what the record was made from or drew on. */
async function upstreamOf(ctx: OrgContext, kind: PrototypeUsedByKind, id: string): Promise<Expansion> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const self = prototypeNodeKey(kind, id);
  switch (kind) {
    case "productionRun": {
      const rows = await db.select({ from: productionRunFeedstocks.feedstockId, wetKg: productionRunFeedstocks.wetMassUsedKg }).from(productionRunFeedstocks)
        .where(and(eq(productionRunFeedstocks.organizationId, org), eq(productionRunFeedstocks.productionRunId, id)));
      return { nodes: await nodesOf(ctx, "feedstock", rows.map(row => row.from)), edges: rows.map(row => ({ from: prototypeNodeKey("feedstock", row.from), to: self, mass: { kg: row.wetKg, basis: "wet" } })) };
    }
    case "biocharProduct": {
      const rows = await db.select({ from: biocharProductSourceAllocations.productionRunId, dryKg: biocharProductSourceAllocations.allocatedDryMassKg }).from(biocharProductSourceAllocations)
        .where(and(eq(biocharProductSourceAllocations.organizationId, org), eq(biocharProductSourceAllocations.biocharProductId, id)));
      return { nodes: await nodesOf(ctx, "productionRun", rows.map(row => row.from)), edges: rows.map(row => ({ from: prototypeNodeKey("productionRun", row.from), to: self, mass: { kg: row.dryKg, basis: "dryBiochar" } })) };
    }
    case "delivery": {
      const rows = await db.select({
        runId: outputStockAllocations.productionRunId, productId: outputStockAllocations.biocharProductId,
        dryKg: sql<string>`sum(${outputStockAllocations.dryMassKg})`, wetKg: sql<string | null>`sum(${outputStockAllocations.wetMassKg})`,
      }).from(outputStockAllocations)
        .where(and(eq(outputStockAllocations.organizationId, org), eq(outputStockAllocations.deliveryId, id)))
        .groupBy(outputStockAllocations.productionRunId, outputStockAllocations.biocharProductId);
      const live = rows.filter(row => Number(row.dryKg) > 0);
      const runIds = live.flatMap(row => (row.runId ? [row.runId] : []));
      const productIds = live.flatMap(row => (row.productId ? [row.productId] : []));
      const nodes = [...await nodesOf(ctx, "productionRun", runIds), ...await nodesOf(ctx, "biocharProduct", productIds)];
      const edges = live.map(row => ({
        from: row.runId ? prototypeNodeKey("productionRun", row.runId) : prototypeNodeKey("biocharProduct", row.productId!),
        to: self,
        mass: row.wetKg != null && Number(row.wetKg) > 0 ? { kg: Number(row.wetKg), basis: "wet" as const } : { kg: Number(row.dryKg), basis: "dryBiochar" as const },
      }));
      return { nodes, edges };
    }
    case "application": {
      const rows = await db.select({ from: applications.deliveryId }).from(applications)
        .where(and(eq(applications.organizationId, org), eq(applications.id, id)));
      const deliveryIds = rows.flatMap(row => (row.from ? [row.from] : []));
      return { nodes: await nodesOf(ctx, "delivery", deliveryIds), edges: deliveryIds.map(from => ({ from: prototypeNodeKey("delivery", from), to: self, mass: null })) };
    }
    case "sample": {
      const rows = await db.select({ from: samples.productionRunId }).from(samples)
        .where(and(eq(samples.organizationId, org), eq(samples.id, id)));
      const runIds = rows.flatMap(row => (row.from ? [row.from] : []));
      return { nodes: await nodesOf(ctx, "productionRun", runIds), edges: runIds.map(from => ({ from: prototypeNodeKey("productionRun", from), to: self, mass: null })) };
    }
    default:
      return { nodes: [], edges: [] };
  }
}

/** The credit batches the record sits in, through the production runs its biochar came from. */
async function creditBatchesOf(ctx: OrgContext, kind: PrototypeUsedByKind, id: string, graph: Expansion, upstream: Expansion): Promise<PrototypeUsedByBatch[]> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  let batchIds: string[] = [];
  if (kind === "application") {
    const rows = await db.select({ id: creditBatchApplications.creditBatchId }).from(creditBatchApplications)
      .where(and(eq(creditBatchApplications.organizationId, org), eq(creditBatchApplications.applicationId, id)));
    batchIds = rows.map(row => row.id);
  } else if (kind === "sample") {
    const rows = await db.select({ id: samples.creditBatchId }).from(samples).where(and(eq(samples.organizationId, org), eq(samples.id, id)));
    batchIds = rows.flatMap(row => (row.id ? [row.id] : []));
  } else if (kind !== "creditBatch" && kind !== "removal") {
    let runIds: string[] = [];
    if (kind === "productionRun") runIds = [id];
    else if (kind === "feedstock") runIds = graph.nodes.filter(node => node.kind === "productionRun").map(node => node.id);
    else if (kind === "biocharProduct") runIds = upstream.nodes.filter(node => node.kind === "productionRun").map(node => node.id);
    else {
      // Deliveries (and an order's deliveries) carry each run's share, whichever layer they drew from.
      const deliveryIds = kind === "delivery" ? [id] : graph.nodes.filter(node => node.kind === "delivery").map(node => node.id);
      if (deliveryIds.length) {
        const rows = await db.selectDistinct({ runId: outputStockRunAllocations.productionRunId }).from(outputStockRunAllocations)
          .innerJoin(outputStockAllocations, and(eq(outputStockAllocations.organizationId, org), eq(outputStockAllocations.id, outputStockRunAllocations.allocationId)))
          .where(and(eq(outputStockRunAllocations.organizationId, org), inArray(outputStockAllocations.deliveryId, deliveryIds)));
        runIds = rows.map(row => row.runId);
      }
    }
    if (runIds.length) {
      const rows = await db.selectDistinct({ id: creditBatchProductionRuns.creditBatchId }).from(creditBatchProductionRuns)
        .where(and(eq(creditBatchProductionRuns.organizationId, org), inArray(creditBatchProductionRuns.productionRunId, runIds)));
      batchIds = rows.map(row => row.id);
    }
  }
  if (batchIds.length === 0) return [];
  const rows = await db.select({ id: creditBatches.id, code: creditBatches.code, name: creditBatches.name, facilityId: creditBatches.facilityId, startDate: creditBatches.startDate, endDate: creditBatches.endDate })
    .from(creditBatches).where(and(eq(creditBatches.organizationId, org), inArray(creditBatches.id, [...new Set(batchIds)])));
  return rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * The mass a run gave each delivery its stock reached, through any product
 * layer in between (the run's share, dry biochar only).
 */
async function runShareByDelivery(ctx: OrgContext, runId: string): Promise<Record<string, PrototypeUsedByMass>> {
  requireOrgScope(ctx);
  const org = ctx.organizationId;
  const rows = await db.select({ deliveryId: outputStockAllocations.deliveryId, dryKg: sql<string>`sum(${outputStockRunAllocations.dryMassKg})` })
    .from(outputStockRunAllocations)
    .innerJoin(outputStockAllocations, and(eq(outputStockAllocations.organizationId, org), eq(outputStockAllocations.id, outputStockRunAllocations.allocationId)))
    .where(and(eq(outputStockRunAllocations.organizationId, org), eq(outputStockRunAllocations.productionRunId, runId), isNotNull(outputStockAllocations.deliveryId)))
    .groupBy(outputStockAllocations.deliveryId);
  return Object.fromEntries(rows.flatMap(row => {
    const kg = positive(Number(row.dryKg));
    return row.deliveryId && kg != null ? [[prototypeNodeKey("delivery", row.deliveryId), { kg, basis: "dryBiochar" as const }]] : [];
  }));
}

export async function getPrototypeUsedByGraph(ctx: OrgContext, kind: PrototypeUsedByKind, id: string): Promise<PrototypeUsedByGraph | null> {
  requireOrgScope(ctx);
  const [self] = await nodesOf(ctx, kind, [id]);
  if (!self) return null;
  const nodes = new Map<string, PrototypeUsedByNode>();
  const edges: PrototypeUsedByEdge[] = [];
  let frontier: PrototypeUsedByNode[] = [self];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const byKind = new Map<PrototypeUsedByKind, string[]>();
    for (const node of frontier) byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node.id]);
    const expansions = await Promise.all([...byKind].map(([nodeKind, ids]) => expand(ctx, nodeKind, ids)));
    const next: PrototypeUsedByNode[] = [];
    for (const expansion of expansions) {
      edges.push(...expansion.edges);
      for (const node of expansion.nodes) {
        const key = prototypeNodeKey(node.kind, node.id);
        if (nodes.has(key) || key === prototypeNodeKey(kind, id)) continue;
        nodes.set(key, node);
        next.push(node);
      }
    }
    frontier = next;
  }
  const downstream: Expansion = { nodes: [...nodes.values()], edges };
  const upstream = await upstreamOf(ctx, kind, id);
  const creditBatchRows = await creditBatchesOf(ctx, kind, id, downstream, upstream);
  // What this record gave each record that uses it directly.
  const took: Record<string, PrototypeUsedByMass> = {};
  const selfKey = prototypeNodeKey(kind, id);
  for (const edge of edges) if (edge.from === selfKey && edge.mass) took[edge.to] = edge.mass;
  if (kind === "productionRun") Object.assign(took, await runShareByDelivery(ctx, id));
  return { self, upstream: upstream.nodes, downstream: downstream.nodes, edges: [...upstream.edges, ...edges], creditBatches: creditBatchRows, took };
}
