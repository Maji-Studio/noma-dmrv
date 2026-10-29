import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { customers, customerLocations, facilities, orders, productionRuns } from "@/db/schema";
import { archiveFacility } from "@/data-access/facilities";
import { getProductionRunById } from "@/data-access/production-runs";
import { getLinkedProductionRunById } from "@/data-access/production-runs";
import { recordOrder, deleteOrder } from "@/lib/operations/orders";
import { deleteCustomer } from "@/lib/operations/customers";
import { runOperation } from "@/lib/operations/runner";
import { cleanupOrderFixture, createOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";

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
  for (const value of fixtures.splice(0)) await cleanupOrderFixture(value);
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
