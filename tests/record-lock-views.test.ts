/**
 * Screen lock reads (#1119): one batched call answers Open, In use or Sent per
 * record and resolves holders into links, without crossing organizations.
 */
import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { biocharProducts, certificationSubmissions, orders, storageLocations } from "@/db/schema";
import { getRecordLockViews, getRemovalLockViews, getStorageBinLockViews } from "@/data-access/record-lock-views";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const remote = vi.hoisted(() => ({ status: null as string | null }));
vi.mock("@/lib/isometric/ghg-statements", () => ({
  getGhgStatement: async () => {
    if (!remote.status) throw new Error("No registry in this test");
    return { status: remote.status, submitted_at: "2026-10-01T12:00:00Z", ghg_entry_ids: ["entry-returned"] };
  },
}));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));

const FOREIGN_ID = "00000000-0000-4000-8000-000000000000";

beforeAll(() => ensureTestOrg());
beforeEach(() => { remote.status = null; });

describe("record lock views", () => {
  it("answers In use with linked holders while no Removal was sent", async () => {
    await withLineageFixture(async (fixture) => {
      const views = await getRecordLockViews(makeTestOrgContext(), "order", [fixture.orderId, FOREIGN_ID]);
      expect(Object.keys(views)).toEqual([fixture.orderId]);
      const order = views[fixture.orderId];
      expect(order.level).toBe("inUse");
      expect(order.freeFields).toEqual(["code", "quantityKg", "orderDate", "packaging"]);
      expect(order.heldBy).toEqual([expect.objectContaining({ kind: "delivery", id: fixture.deliveryId, facilityId: fixture.facilityId })]);
      expect(order.heldBy[0].label).toEqual(expect.any(String));
      expect(order.usedBy).toEqual(order.heldBy);
    }, "none");
  });

  it("answers Sent with the Removal and its facility, and keeps every dependent under Used by", async () => {
    await withLineageFixture(async (fixture) => {
      const views = await getRecordLockViews(makeTestOrgContext(), "productionRun", [fixture.productionRunId]);
      const run = views[fixture.productionRunId];
      expect(run.level).toBe("sent");
      expect(run.freeFields).toEqual([]);
      expect(run.heldBy).toEqual([expect.objectContaining({ kind: "removal", id: fixture.removalId, facilityId: fixture.facilityId })]);
      expect(run.usedBy.length).toBeGreaterThan(0);
      expect(run.usedBy.every((link) => link.kind !== "stockEntry" || link.label)).toBe(true);
    }, "removal");
  });

  it("answers a Sample held by a Sent Removal, the screen behind #687 item 2", async () => {
    await withLineageFixture(async (fixture) => {
      const views = await getRecordLockViews(makeTestOrgContext(), "sample", [fixture.sampleId]);
      expect(views[fixture.sampleId]).toMatchObject({ level: "sent", heldBy: [{ kind: "removal", id: fixture.removalId }] });
    }, "removal");
  });

  it("answers a storage bin with stock history as In use, counted by reference", async () => {
    await withLineageFixture(async (fixture) => {
      const views = await getStorageBinLockViews(makeTestOrgContext(), [fixture.feedstockBinId, FOREIGN_ID]);
      expect(Object.keys(views)).toEqual([fixture.feedstockBinId]);
      expect(views[fixture.feedstockBinId].level).toBe("inUse");
      expect(views[fixture.feedstockBinId].usedBy).toContainEqual(expect.objectContaining({ kind: "binReference", label: "feedstock batches", count: 1 }));
    }, "none");
  });

  it("names the returned Removal and statement once Isometric sends the statement back", async () => {
    remote.status = "FAILED_VERIFICATION";
    await withLineageFixture(async (fixture) => {
      await db.update(certificationSubmissions)
        .set({ metadata: { remoteStatus: "FAILED_VERIFICATION", submittedToVerifierAt: "2026-10-01T12:00:00Z", removalIds: ["entry-returned"] } })
        .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
      await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal", localEntityType: "removal",
        localEntityId: fixture.removalId, externalId: "entry-returned", version: 1, status: "submitted",
        payloadHash: `returned-${fixture.removalId}`, payloadSnapshot: {}, submittedAt: new Date("2026-09-01T00:00:00Z"),
      });
      const runs = await getRecordLockViews(makeTestOrgContext(), "productionRun", [fixture.productionRunId]);
      const run = runs[fixture.productionRunId];
      expect(run.level).not.toBe("sent");
      expect(run.returnedBy).toEqual([expect.objectContaining({
        removal: expect.objectContaining({ kind: "removal", id: fixture.removalId, facilityId: fixture.facilityId }),
        statement: expect.objectContaining({ kind: "ghgStatement", id: fixture.ghgStatementId, facilityId: fixture.facilityId }),
        statementStatus: "FAILED_VERIFICATION",
      })]);

      const removals = await getRemovalLockViews(makeTestOrgContext(), [fixture.removalId]);
      expect(removals[fixture.removalId]).toMatchObject({ level: "open", returnedBy: [{ statementStatus: "FAILED_VERIFICATION" }] });

      // Once the statement is back in verification, the lineage is Sent again.
      remote.status = "AWAITING_VERIFICATION";
      const sent = await getRecordLockViews(makeTestOrgContext(), "productionRun", [fixture.productionRunId]);
      expect(sent[fixture.productionRunId]).toMatchObject({ level: "sent", returnedBy: [] });
    }, "ghgStatement");
  });

  it("reads a 50-record page in as many queries as a single record", async () => {
    const PAGE = 50;
    await withLineageFixture(async (fixture) => {
      const ctx = makeTestOrgContext();
      const [order] = await db.select().from(orders).where(and(eq(orders.organizationId, TEST_ORG_ID), eq(orders.id, fixture.orderId)));
      const [bin] = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, TEST_ORG_ID), eq(storageLocations.id, fixture.feedstockBinId)));
      const orderIds = Array.from({ length: PAGE - 1 }, () => crypto.randomUUID());
      const binIds = Array.from({ length: PAGE - 1 }, () => crypto.randomUUID());
      await db.insert(orders).values(orderIds.map((id, index) => ({ ...order, id, code: `${order.code}-N${index}`, version: 1 })));
      await db.insert(storageLocations).values(binIds.map((id, index) => ({ ...bin, id, code: `${bin.code}-N${index}`, name: `${bin.name} N${index}`, version: 1 })));
      try {
        const countQueries = async (read: () => Promise<unknown>) => {
          const select = vi.spyOn(db, "select");
          const distinct = vi.spyOn(db, "selectDistinct");
          try {
            await read();
            return select.mock.calls.length + distinct.mock.calls.length;
          } finally {
            select.mockRestore();
            distinct.mockRestore();
          }
        };
        const oneOrder = await countQueries(() => getRecordLockViews(ctx, "order", [fixture.orderId]));
        const pageOfOrders = await countQueries(() => getRecordLockViews(ctx, "order", [fixture.orderId, ...orderIds]));
        expect(pageOfOrders).toBe(oneOrder);
        const views = await getRecordLockViews(ctx, "order", [fixture.orderId, ...orderIds]);
        expect(Object.keys(views)).toHaveLength(PAGE);

        const oneBin = await countQueries(() => getStorageBinLockViews(ctx, [fixture.feedstockBinId]));
        const pageOfBins = await countQueries(() => getStorageBinLockViews(ctx, [fixture.feedstockBinId, ...binIds]));
        expect(pageOfBins).toBe(oneBin);
        const bins = await getStorageBinLockViews(ctx, [fixture.feedstockBinId, ...binIds]);
        expect(bins[fixture.feedstockBinId].level).toBe("inUse");
        expect(bins[binIds[0]].level).toBe("open");
      } finally {
        await db.delete(orders).where(and(eq(orders.organizationId, TEST_ORG_ID), inArray(orders.id, orderIds)));
        await db.delete(storageLocations).where(and(eq(storageLocations.organizationId, TEST_ORG_ID), inArray(storageLocations.id, binIds)));
      }
    }, "none");
  });

  it("lists the formulations a product bin stores, which fix its formulation", async () => {
    await withLineageFixture(async (fixture) => {
      const [product] = await db.select({ binId: biocharProducts.storageLocationId, formulationId: biocharProducts.formulationId }).from(biocharProducts)
        .where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, fixture.productId)));
      const views = await getStorageBinLockViews(makeTestOrgContext(), [product.binId!, fixture.feedstockBinId]);
      expect(views[product.binId!].productFormulationIds).toEqual([product.formulationId]);
      expect(views[fixture.feedstockBinId].productFormulationIds).toEqual([]);
    }, "none");
  });
});
