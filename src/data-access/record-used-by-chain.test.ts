import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  biocharProducts, biocharProductSourceAllocations, binMovements, creditBatches, deliveries, facilities,
  organizations, outputStockAllocations, productionRuns,
} from "@/db/schema";
import { usedByNodeKey, type RecordUsedByChain, type RecordUsedByKind } from "@/lib/record-used-by-chain";
import { withLineageFixture, type LineageFixture } from "../../tests/helpers/certification-lineage-fixture";
import { deleteOutputDeliveryFixtures, deleteOutputProductFixtures, insertOutputDeliveryFixture } from "../../tests/helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "../../tests/helpers/test-org";
import { getRecordUsedByChain } from "./record-used-by-chain";

const PRODUCT_WET_KG = 300;
const PRODUCT_DRY_KG = 285;
const RESIDUAL_WET_KG = 0.001;
const RUN_START = new Date("2026-06-12T23:30:00Z");
const RUN_END = new Date("2026-06-14T12:00:00Z");
const RUN_START_DAY = "2026-06-13";
const FACILITY_TIMEZONE = "Africa/Dar_es_Salaam";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const ctx = makeTestOrgContext();

beforeAll(() => ensureTestOrg());

/** Consumer fixtures declare immutable provenance explicitly, without stock commands. */
async function withChainFixture(test: (fixture: LineageFixture) => Promise<void>) {
  await withLineageFixture(async fixture => {
    await db.insert(biocharProductSourceAllocations).values({
      organizationId: TEST_ORG_ID, biocharProductId: fixture.productId, productionRunId: fixture.productionRunId,
      sourceStorageLocationId: fixture.biocharBinId, allocatedWetMassKg: PRODUCT_WET_KG, allocatedDryMassKg: PRODUCT_DRY_KG,
    });
    await test(fixture);
  });
}

function edge(chain: RecordUsedByChain, fromKind: RecordUsedByKind, fromId: string, toKind: RecordUsedByKind, toId: string) {
  return chain.edges.find(item => item.from === usedByNodeKey(fromKind, fromId) && item.to === usedByNodeKey(toKind, toId));
}

describe("getRecordUsedByChain (real database)", () => {
  it("keeps a product delivery that drew only a wet residual", async () => {
    await withChainFixture(async f => {
      const [delivery] = await insertOutputDeliveryFixture(db, {
        organizationId: TEST_ORG_ID, facilityId: f.facilityId, orderId: f.orderId,
        biocharProductId: f.productId, code: `DL-RESIDUAL-${randomUUID()}`, status: "delivered",
        deliveryDate: new Date("2026-06-16T12:00:00Z"), deliveredWetMassKg: RESIDUAL_WET_KG, massDryKg: 0,
      }, row => row);
      try {
        const [allocation] = await db.select().from(outputStockAllocations)
          .where(and(eq(outputStockAllocations.organizationId, TEST_ORG_ID), eq(outputStockAllocations.deliveryId, delivery.id)));
        expect(Number(allocation.dryMassKg)).toBe(0);
        expect(Number(allocation.wetMassKg)).toBe(RESIDUAL_WET_KG);
        const product = await getRecordUsedByChain(ctx, "biocharProduct", f.productId);
        expect(product!.downstream).toContainEqual(expect.objectContaining({ kind: "delivery", id: delivery.id }));
        expect(edge(product!, "biocharProduct", f.productId, "delivery", delivery.id)).toBeTruthy();
        expect(product!.creditBatches.map(batch => batch.id)).toEqual([f.batchId]);
        const chain = await getRecordUsedByChain(ctx, "delivery", delivery.id);
        expect(chain!.self).toMatchObject({ kind: "delivery", id: delivery.id });
        expect(edge(chain!, "biocharProduct", f.productId, "delivery", delivery.id)).toBeUndefined();
      } finally {
        await deleteOutputDeliveryFixtures(db, and(eq(deliveries.organizationId, TEST_ORG_ID), eq(deliveries.id, delivery.id)));
      }
    });
  });

  it("dates run nodes by the facility-local start day, including discovered runs", async () => {
    await withChainFixture(async f => {
      await db.update(facilities).set({ timezone: FACILITY_TIMEZONE })
        .where(and(eq(facilities.organizationId, TEST_ORG_ID), eq(facilities.id, f.facilityId)));
      await db.update(productionRuns).set({ startTime: RUN_START, endTime: RUN_END })
        .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, f.productionRunId)));
      const run = await getRecordUsedByChain(ctx, "productionRun", f.productionRunId);
      expect(run!.self).toMatchObject({ at: RUN_START_DAY, calendarDay: true });
      const feedstock = await getRecordUsedByChain(ctx, "feedstock", f.feedstockId);
      expect(feedstock!.downstream).toContainEqual(expect.objectContaining({
        kind: "productionRun", id: f.productionRunId, at: RUN_START_DAY, calendarDay: true,
      }));
    });
  });

  it("reads a run's full downstream chain with cohort Samples and endpoint-only links", async () => {
    await withChainFixture(async f => {
      const chain = await getRecordUsedByChain(ctx, "productionRun", f.productionRunId);
      expect(chain).not.toBeNull();
      expect(chain!.self).toMatchObject({ kind: "productionRun", id: f.productionRunId, facilityId: f.facilityId, at: "2026-06-13", calendarDay: true });
      expect(chain).not.toHaveProperty("upstream");
      expect(chain!.downstream.map(node => [node.kind, node.id])).toEqual([
        ["biocharProduct", f.productId], ["order", f.orderId], ["delivery", f.deliveryId],
        ["application", f.applicationId], ["removal", f.removalId], ["sample", f.sampleId], ["creditBatch", f.batchId],
      ]);
      expect(edge(chain!, "feedstock", f.feedstockId, "productionRun", f.productionRunId)).toBeUndefined();
      expect(edge(chain!, "productionRun", f.productionRunId, "biocharProduct", f.productId)).toBeTruthy();
      expect(edge(chain!, "biocharProduct", f.productId, "delivery", f.deliveryId)).toBeTruthy();
      expect(edge(chain!, "order", f.orderId, "delivery", f.deliveryId)).toBeTruthy();
      expect(edge(chain!, "delivery", f.deliveryId, "application", f.applicationId)).toBeTruthy();
      expect(edge(chain!, "application", f.applicationId, "removal", f.removalId)).toBeTruthy();
      expect(edge(chain!, "productionRun", f.productionRunId, "creditBatch", f.batchId)).toBeTruthy();
      expect(edge(chain!, "sample", f.sampleId, "removal", f.removalId)).toBeTruthy();
      for (const link of chain!.edges) expect(Object.keys(link).sort()).toEqual(["from", "to"]);
      expect(chain!.creditBatches).toEqual([expect.objectContaining({ id: f.batchId, facilityId: f.facilityId, startDate: "2026-06-01", endDate: "2026-06-30" })]);
      const keys = chain!.downstream.map(node => usedByNodeKey(node.kind, node.id));
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(chain!.edges.map(item => `${item.from}>${item.to}`)).size).toBe(chain!.edges.length);
    });
  });

  it("follows a feedstock through the whole chain in custody order", async () => {
    await withChainFixture(async f => {
      const chain = await getRecordUsedByChain(ctx, "feedstock", f.feedstockId);
      expect(chain!.downstream.map(node => node.kind)).toEqual([
        "productionRun", "biocharProduct", "order", "delivery", "application", "removal", "sample", "creditBatch",
      ]);
      expect(chain!.creditBatches.map(batch => batch.id)).toEqual([f.batchId]);
    });
  });

  it("returns null for an unknown id", async () => {
    expect(await getRecordUsedByChain(ctx, "productionRun", UNKNOWN_ID)).toBeNull();
  });

  it("includes an order as context without leaking its other products' deliveries", async () => {
    await withChainFixture(async f => {
      const [source] = await db.select().from(biocharProducts)
        .where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, f.productId)));
      const [other] = await db.insert(biocharProducts).values({ ...source, organizationId: TEST_ORG_ID, id: randomUUID(), code: `${source.code}-OTHER` }).returning();
      let otherDeliveryId: string | undefined;
      try {
        const [delivery] = await insertOutputDeliveryFixture(db, { organizationId: TEST_ORG_ID, facilityId: f.facilityId,
          orderId: f.orderId, biocharProductId: other.id, code: `${source.code}-OTHER-DL`, status: "delivered",
          deliveryDate: new Date("2026-06-15T12:00:00Z"), deliveredWetMassKg: PRODUCT_WET_KG, massDryKg: PRODUCT_DRY_KG }, row => row);
        otherDeliveryId = delivery.id;
        const chain = await getRecordUsedByChain(ctx, "biocharProduct", f.productId);
        expect(chain!.downstream.filter(node => node.kind === "delivery").map(node => node.id)).toEqual([f.deliveryId]);
        expect(chain!.downstream.filter(node => node.kind === "order").map(node => node.id)).toEqual([f.orderId]);
        const order = await getRecordUsedByChain(ctx, "order", f.orderId);
        expect(order!.downstream.filter(node => node.kind === "delivery").map(node => node.id)).toEqual([f.deliveryId, delivery.id]);
      } finally {
        if (otherDeliveryId) await deleteOutputDeliveryFixtures(db, and(eq(deliveries.organizationId, TEST_ORG_ID), eq(deliveries.id, otherDeliveryId)));
        await deleteOutputProductFixtures(db, and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, other.id)));
      }
    });
  });

  it("excludes a delivery's own order and upstream links from the returned chain", async () => {
    await withChainFixture(async f => {
      const chain = await getRecordUsedByChain(ctx, "delivery", f.deliveryId);
      expect(chain!.downstream.some(node => node.kind === "order")).toBe(false);
      expect(edge(chain!, "order", f.orderId, "delivery", f.deliveryId)).toBeUndefined();
      expect(chain!.downstream.some(node => node.kind === "application" && node.id === f.applicationId)).toBe(true);
      expect(edge(chain!, "delivery", f.deliveryId, "application", f.applicationId)).toBeTruthy();
    });
  });

  it("returns null for every kind when the record belongs to another organization", async () => {
    const foreignOrgId = `org_used_by_${randomUUID()}`;
    await db.insert(organizations).values({ id: foreignOrgId, name: "Used by isolation fixture", slug: foreignOrgId });
    try {
      await withChainFixture(async f => {
        const foreignCtx = { ...ctx, organizationId: foreignOrgId };
        const targets = { feedstock: f.feedstockId, productionRun: f.productionRunId, biocharProduct: f.productId,
          order: f.orderId, delivery: f.deliveryId, application: f.applicationId, removal: f.removalId, sample: f.sampleId, creditBatch: f.batchId };
        for (const [kind, id] of Object.entries(targets)) {
          expect(await getRecordUsedByChain(foreignCtx, kind as RecordUsedByKind, id)).toBeNull();
        }
      });
    } finally {
      await db.delete(organizations).where(eq(organizations.id, foreignOrgId));
    }
  });

  it("keeps archived history, batch names and batch-scoped Sample provenance", async () => {
    await withChainFixture(async f => {
      await db.update(creditBatches).set({ archivedAt: new Date(), name: "Named cohort" })
        .where(and(eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, f.batchId)));
      const sample = await getRecordUsedByChain(ctx, "sample", f.sampleId);
      expect(sample!.creditBatches).toEqual([expect.objectContaining({ id: f.batchId, name: "Named cohort" })]);
      const batch = await getRecordUsedByChain(ctx, "creditBatch", f.batchId);
      expect(batch!.self).toMatchObject({ kind: "creditBatch", id: f.batchId, name: "Named cohort", calendarDay: true });
      expect(batch!.downstream).toContainEqual(expect.objectContaining({ kind: "sample", id: f.sampleId }));
      expect(edge(batch!, "creditBatch", f.batchId, "sample", f.sampleId)).toBeTruthy();
      expect(batch!.creditBatches.map(row => row.id)).toEqual([f.batchId]);
      const removal = await getRecordUsedByChain(ctx, "removal", f.removalId);
      expect(removal!.downstream).toEqual([]);
      expect(removal!.edges).toEqual([]);
      expect(removal!.creditBatches.map(row => row.id)).toEqual([f.batchId]);
    });
  });

  it("excludes a product with a reversed placement, even after its archive stamp is cleared", async () => {
    await withChainFixture(async f => {
      const [source] = await db.select().from(biocharProducts)
        .where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, f.productId)));
      const [deleted] = await db.insert(biocharProducts).values({ ...source, organizationId: TEST_ORG_ID, id: randomUUID(), code: `${source.code}-DELETED` }).returning();
      try {
        await db.insert(biocharProductSourceAllocations).values({ organizationId: TEST_ORG_ID, biocharProductId: deleted.id,
          productionRunId: f.productionRunId, sourceStorageLocationId: f.biocharBinId,
          allocatedWetMassKg: PRODUCT_WET_KG, allocatedDryMassKg: PRODUCT_DRY_KG });
        const [original] = await db.insert(binMovements).values({ organizationId: TEST_ORG_ID, storageLocationId: f.biocharBinId,
          lane: "biochar", movementType: "adjustment", massDeltaKg: -PRODUCT_DRY_KG, reason: "Used by product placement fixture",
          outputKind: "product_draw", occurredAt: source.placedAt, idempotencyKey: randomUUID(), basisFingerprint: "fixture",
          inputSnapshot: {}, outputDryDeltaKg: String(-PRODUCT_DRY_KG), balanceBeforeDryKg: String(PRODUCT_DRY_KG), balanceAfterDryKg: "0" }).returning();
        const [draw] = await db.insert(outputStockAllocations).values({ organizationId: TEST_ORG_ID, movementId: original.id,
          sourceStorageLocationId: f.biocharBinId, productionRunId: f.productionRunId, targetBiocharProductId: deleted.id,
          dryMassKg: String(PRODUCT_DRY_KG), wetMassKg: String(PRODUCT_WET_KG), basisSnapshot: {} }).returning();
        const [reversal] = await db.insert(binMovements).values({ ...original, organizationId: TEST_ORG_ID, id: randomUUID(), postingSequence: undefined,
          outputKind: "reversal", correctsMovementId: original.id, idempotencyKey: randomUUID(), massDeltaKg: PRODUCT_DRY_KG,
          outputDryDeltaKg: String(PRODUCT_DRY_KG), balanceBeforeDryKg: "0", balanceAfterDryKg: String(PRODUCT_DRY_KG) }).returning();
        await db.insert(outputStockAllocations).values({ ...draw, organizationId: TEST_ORG_ID, id: randomUUID(), movementId: reversal.id,
          reversesAllocationId: draw.id, dryMassKg: String(-PRODUCT_DRY_KG), wetMassKg: String(-PRODUCT_WET_KG) });
        expect(await getRecordUsedByChain(ctx, "biocharProduct", deleted.id)).toBeNull();
        const chain = await getRecordUsedByChain(ctx, "productionRun", f.productionRunId);
        expect(chain!.downstream.filter(node => node.kind === "biocharProduct").map(node => node.id)).toEqual([f.productId]);
        expect(chain!.edges.some(item => item.from === usedByNodeKey("biocharProduct", deleted.id) || item.to === usedByNodeKey("biocharProduct", deleted.id))).toBe(false);
      } finally {
        await deleteOutputProductFixtures(db, and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, deleted.id)));
      }
    });
  });

  it("excludes reversed delivery draws", async () => {
    await withChainFixture(async f => {
      const [draw] = await db.select().from(outputStockAllocations)
        .where(and(eq(outputStockAllocations.organizationId, TEST_ORG_ID), eq(outputStockAllocations.deliveryId, f.deliveryId)));
      const [original] = await db.select().from(binMovements)
        .where(and(eq(binMovements.organizationId, TEST_ORG_ID), eq(binMovements.id, draw.movementId)));
      const [reversal] = await db.insert(binMovements).values({ ...original, organizationId: TEST_ORG_ID, id: randomUUID(), postingSequence: undefined,
        correctsMovementId: original.id, idempotencyKey: randomUUID(), outputKind: "reversal", massDeltaKg: PRODUCT_DRY_KG,
        outputDryDeltaKg: String(PRODUCT_DRY_KG), balanceBeforeDryKg: "0", balanceAfterDryKg: String(PRODUCT_DRY_KG) }).returning();
      try {
        const chain = await getRecordUsedByChain(ctx, "productionRun", f.productionRunId);
        expect(chain!.downstream.some(node => node.kind === "delivery")).toBe(false);
        const delivery = await getRecordUsedByChain(ctx, "delivery", f.deliveryId);
        expect(delivery!.downstream.some(node => node.kind === "order")).toBe(false);
        expect(delivery!.edges.some(item => item.to === usedByNodeKey("delivery", f.deliveryId))).toBe(false);
      } finally {
        await db.delete(binMovements).where(and(eq(binMovements.organizationId, TEST_ORG_ID), eq(binMovements.id, reversal.id)));
      }
    });
  });
});
