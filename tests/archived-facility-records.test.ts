import { getLinkedOutputBinInventory, getOutputSubBins } from "@/data-access/output-sub-bins";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { getFeedstockBinStock } from "@/data-access/feedstock-bin-ledger";
import { postProduct } from "./helpers/posted-output-stock-fixture";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { applications, deliveries, creditBatches, creditBatchProductionRuns, productionProcesses, feedstocks, customers, customerLocations, facilities, orders, productionRuns, storageLocations } from "@/db/schema";
import { archiveFacility } from "@/data-access/facilities";
import { getProductionRunById } from "@/data-access/production-runs";
import { getLinkedProductionRunById } from "@/data-access/production-runs";
import { recordOrder, deleteOrder } from "@/lib/operations/orders";
import { deleteCustomer } from "@/lib/operations/customers";
import { runOperation } from "@/lib/operations/runner";
import { cleanupOrderFixture, createOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";

import { getLinkedCreditBatchMembers } from "@/data-access/credit-batch-production-run-options";
import { getLinkedApplicationDelivery } from "@/data-access/applications";
import { getCreditBatchProductionRunOptions } from "@/data-access/credit-batch-production-run-options";
import { getApplicationDeliveryOptions } from "@/data-access/applications";

const TIMEOUT_MS = 60_000;
const CONNECTIONS = 4;
let pool: Pool;
beforeAll(() => { pool = createTestPool(CONNECTIONS); });
afterAll(async () => { await pool.end(); });
const settle = (promise: Promise<unknown>) => promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

const INDEPENDENT_ARCHIVE_DATE = new Date("2026-01-01T00:00:00Z");
const fixtures: OrderFixture[] = [];
async function fixture() {
  const value = await createOrderFixture();
  fixtures.push(value);
  return value;
}
afterEach(async () => {
  for (const value of fixtures.splice(0)) {
    for (const table of [creditBatchProductionRuns, creditBatches, productionProcesses]) {
      await db.delete(table).where(eq(table.organizationId, value.ctx.organizationId));
    }
    await cleanupOrderFixture(value);
  }
});

const archivedFacilityRefusal = {
  code: "not_found",
  message: "Facility was not found or is archived.",
  issues: [{ path: ["facilityId"], code: "not_found", message: "Facility was not found or is archived." }],
};

describe("archived facility linked production runs", () => {
  it("preserves the detail shape and relations through the actual facility cascade", async () => {
    const f = await fixture();
    const run = f.runs[0];
    const before = await getProductionRunById(f.ctx, run.id);
    expect(await getLinkedProductionRunById(f.ctx, run.id)).toEqual(before);
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const linked = await getLinkedProductionRunById(f.ctx, run.id);
    expect(linked).toEqual({ ...before, version: before.version + 1 });
    expect(linked.feedstocks.length).toBeGreaterThan(0);
    expect(linked.feedstockDraws.length).toBeGreaterThan(0);
    expect(linked.biocharStorageLocationCode).toBe(f.source.code);
    await expect(getProductionRunById(f.ctx, run.id)).rejects.toThrow();
  });

  it("keeps independently archived runs hidden before and after facility archive", async () => {
    const f = await fixture();
    const run = f.runs[0];
    await db.update(productionRuns).set({ archivedAt: INDEPENDENT_ARCHIVE_DATE }).where(eq(productionRuns.id, run.id));
    await expect(getLinkedProductionRunById(f.ctx, run.id)).rejects.toThrow();
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    await expect(getLinkedProductionRunById(f.ctx, run.id)).rejects.toThrow();
  });

  it("refuses foreign, missing and unscoped reads", async () => {
    const f = await fixture();
    const foreign = await fixture();
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    await expect(getLinkedProductionRunById(foreign.ctx, f.runs[0].id)).rejects.toThrow();
    await expect(getLinkedProductionRunById(f.ctx, crypto.randomUUID())).rejects.toThrow();
    await expect(getLinkedProductionRunById({ ...f.ctx, organizationId: "" }, f.runs[0].id)).rejects.toThrow();
  });
});

describe("archived facility order deletion", { timeout: TIMEOUT_MS }, () => {
  it("refuses direct order deletion with the existing facility refusal", async () => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const [archived] = await db.select().from(orders).where(eq(orders.id, order.id));
    await expect(runOperation(deleteOrder, f.ctx, { orderId: order.id, expectedVersion: archived.version }))
      .rejects.toMatchObject(archivedFacilityRefusal);
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toEqual([archived]);
  });

  it("previews and deletes the customer together with its archived facility order", async () => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const input = { customerId: f.customer.id, expectedVersion: f.customer.version };
    await runOperation(deleteCustomer, f.ctx, input, { dryRun: true });
    expect(await db.select().from(customers).where(eq(customers.id, f.customer.id))).toEqual([f.customer]);
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toHaveLength(1);
    await runOperation(deleteCustomer, f.ctx, input);
    expect(await db.select().from(customers).where(eq(customers.id, f.customer.id))).toEqual([]);
    expect(await db.select().from(customerLocations).where(eq(customerLocations.id, f.location.id))).toEqual([]);
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toEqual([]);
  });

  it.each([false, true])("serializes direct delete against archive, facility first=%s", async (facilityFirst) => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    const barrier = await openOperationBarrier(pool);
    const pending: ReturnType<typeof settle>[] = [];
    try {
      await barrier.tx.select().from(facilities).where(eq(facilities.id, f.facility.id)).for("update");
      const archive = () => archiveFacility(f.ctx, f.facility.id, f.facility.version);
      const remove = () => runOperation(deleteOrder, f.ctx, { orderId: order.id, expectedVersion: order.version }, { pool });
      for (const call of facilityFirst ? [archive, remove] : [remove, archive]) {
        pending.push(settle(call()));
        await waitForBlockedOperations(pool, barrier.pid, pending.length);
      }
      await barrier.commit();
      const results = await Promise.all(pending);
      const archived = results[facilityFirst ? 0 : 1];
      const removed = results[facilityFirst ? 1 : 0];
      expect(archived.ok).toBe(true);
      expect(removed.ok).toBe(!facilityFirst);
      if (!removed.ok) expect(removed.error).toMatchObject(archivedFacilityRefusal);
      const remaining = await db.select().from(orders).where(eq(orders.id, order.id));
      if (facilityFirst) {
        expect(remaining).toHaveLength(1);
        expect(remaining[0].archivedAt).not.toBeNull();
      } else {
        expect(remaining).toEqual([]);
      }
    } finally {
      await barrier.rollback();
      await Promise.allSettled(pending);
    }
  });
});

async function linkedFixture() {
  const f = await fixture();
  const organizationId = f.ctx.organizationId;
  const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, organizationId));
  const [process] = await db.insert(productionProcesses).values({ organizationId, facilityId: f.facility.id, feedstockTypeId: intake.feedstockTypeId }).returning();
  const [batch] = await db.insert(creditBatches).values({ organizationId, facilityId: f.facility.id,
    code: `E2E-CB-${f.tag}`, feedstockTypeId: intake.feedstockTypeId, productionProcessId: process.id,
    startDate: "2026-09-01", endDate: "2026-09-30" }).returning();
  await db.insert(creditBatchProductionRuns).values({ organizationId, creditBatchId: batch.id, productionRunId: f.runs[0].id });
  const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
  const [delivery] = await db.insert(deliveries).values({ organizationId, facilityId: f.facility.id,
    code: `E2E-DL-${f.tag}`, orderId: order.id, storageLocationId: f.bin.id,
    deliveryDate: new Date("2026-09-12T12:00:00Z"), deliveredWetMassKg: 100, massDryKg: 80 }).returning();
  const [application] = await db.insert(applications).values({ organizationId, deliveryId: delivery.id,
    code: `E2E-AP-${f.tag}`, applicationDate: new Date("2026-09-13T00:00:00Z"),
    biocharAppliedTons: 0.05, biocharAppliedDryTons: 0.04, fieldSizeHa: 1 }).returning();
  return { ...f, batch, delivery, application };
}

describe("archived facility linked members and application source", () => {
  it("preserves member and delivery shapes after the cascade without broadening form options", async () => {
    const f = await linkedFixture();
    const members = await getLinkedCreditBatchMembers(f.ctx, f.batch.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ id: f.runs[0].id, biocharStorageName: f.source.name,
      feedstockMassDryKg: f.runs[0].feedstockMassDryKg, assignedCreditBatchId: f.batch.id });
    expect(members[0].feedstockTypeIds).toHaveLength(1);
    const source = await getLinkedApplicationDelivery(f.ctx, f.application.id);
    expect(source).toMatchObject({ id: f.delivery.id, productBinName: f.bin.name,
      alreadyAppliedWetKg: 50, alreadyAppliedDryKg: 40 });
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    expect(await getLinkedCreditBatchMembers(f.ctx, f.batch.id)).toEqual(members);
    expect(await getLinkedApplicationDelivery(f.ctx, f.application.id)).toEqual(source);
    expect(await getCreditBatchProductionRunOptions(f.ctx, { facilityId: f.facility.id })).toEqual([]);
    expect(await getApplicationDeliveryOptions(f.ctx, f.facility.id)).toEqual([]);
  });

  it("hides independently archived member runs and deliveries before and after the cascade", async () => {
    const f = await linkedFixture();
    await db.update(productionRuns).set({ archivedAt: INDEPENDENT_ARCHIVE_DATE }).where(eq(productionRuns.id, f.runs[0].id));
    await db.update(deliveries).set({ archivedAt: INDEPENDENT_ARCHIVE_DATE }).where(eq(deliveries.id, f.delivery.id));
    expect(await getLinkedCreditBatchMembers(f.ctx, f.batch.id)).toEqual([]);
    expect(await getLinkedApplicationDelivery(f.ctx, f.application.id)).toBeNull();
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    expect(await getLinkedCreditBatchMembers(f.ctx, f.batch.id)).toEqual([]);
    expect(await getLinkedApplicationDelivery(f.ctx, f.application.id)).toBeNull();
  });

  it("hides members of an independently archived batch", async () => {
    const f = await linkedFixture();
    await db.update(creditBatches).set({ archivedAt: INDEPENDENT_ARCHIVE_DATE }).where(eq(creditBatches.id, f.batch.id));
    expect(await getLinkedCreditBatchMembers(f.ctx, f.batch.id)).toEqual([]);
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    expect(await getLinkedCreditBatchMembers(f.ctx, f.batch.id)).toEqual([]);
  });

  it("refuses foreign organizations and missing IDs, and rejects unscoped reads", async () => {
    const f = await linkedFixture();
    const foreign = await fixture();
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    for (const ctx of [foreign.ctx, f.ctx]) {
      const batchId = ctx === foreign.ctx ? f.batch.id : crypto.randomUUID();
      const applicationId = ctx === foreign.ctx ? f.application.id : crypto.randomUUID();
      expect(await getLinkedCreditBatchMembers(ctx, batchId)).toEqual([]);
      expect(await getLinkedApplicationDelivery(ctx, applicationId)).toBeNull();
    }
    const unscoped = { ...f.ctx, organizationId: "" };
    await expect(getLinkedCreditBatchMembers(unscoped, f.batch.id)).rejects.toThrow();
    await expect(getLinkedApplicationDelivery(unscoped, f.application.id)).rejects.toThrow();
  });
});


describe("archived facility output inventory", () => {
  it.each(["biochar", "product"] as const)("preserves %s stock and sub-bins through facility archive", async (lane) => {
    const f = await fixture();
    await db.update(storageLocations).set({ formulationId: f.pure.id }).where(eq(storageLocations.id, f.bin.id));
    await postProduct(f);
    const bin = lane === "biochar" ? f.source : f.bin;
    const input = { storageLocationId: bin.id, facilityId: f.facility.id };
    const before = await getLinkedOutputBinInventory(f.ctx, input);
    expect(before.contents).toEqual(await getOutputSubBins(f.ctx, input));
    expect(before.contents.subBins.length).toBeGreaterThan(0);
    expect(before.balance.beforeDryKg).toBeGreaterThan(0);
    expect(before.balance.beforeEstimatedWetKg).toBeGreaterThan(0);
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    expect(await getLinkedOutputBinInventory(f.ctx, input)).toEqual(before);
    await expect(getOutputSubBins(f.ctx, input)).rejects.toThrow("Output bin was not found or is archived.");
    await expect(previewOutputStock(f.ctx, { ...input, occurredAt: new Date().toISOString(), kind: "count", wetMassKg: 0, moisturePercent: null })).rejects.toThrow("Output bin was not found or is archived.");
  });

  it.each(["biochar", "product"] as const)("hides independently archived %s bins before and after facility archive", async (lane) => {
    const f = await fixture();
    const bin = lane === "biochar" ? f.source : f.bin;
    const input = { storageLocationId: bin.id, facilityId: f.facility.id };
    await db.update(storageLocations).set({ archivedAt: INDEPENDENT_ARCHIVE_DATE }).where(eq(storageLocations.id, bin.id));
    await expect(getLinkedOutputBinInventory(f.ctx, input)).rejects.toThrow("Output bin was not found or is archived.");
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    await expect(getLinkedOutputBinInventory(f.ctx, input)).rejects.toThrow("Output bin was not found or is archived.");
  });

  it("refuses foreign organizations, wrong facilities, missing bins and unscoped reads", async () => {
    const f = await fixture();
    const foreign = await fixture();
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    for (const bin of [f.source, f.bin]) {
      const input = { storageLocationId: bin.id, facilityId: f.facility.id };
      await expect(getLinkedOutputBinInventory(foreign.ctx, input)).rejects.toThrow();
      await expect(getLinkedOutputBinInventory(f.ctx, { ...input, facilityId: f.otherFacility.id })).rejects.toThrow();
      await expect(getLinkedOutputBinInventory(f.ctx, { ...input, storageLocationId: crypto.randomUUID() })).rejects.toThrow();
      await expect(getLinkedOutputBinInventory({ ...f.ctx, organizationId: "" }, input)).rejects.toThrow();
    }
  });

  it("preserves feedstock balance and history with the existing read", async () => {
    const f = await fixture();
    const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
    const before = await getFeedstockBinStock(f.ctx, intake.storageLocationId!);
    expect(before.entries.length).toBeGreaterThan(0);
    await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    expect(await getFeedstockBinStock(f.ctx, intake.storageLocationId!)).toEqual(before);
  });
});
