import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { orders, facilities, deliveries, formulations } from "@/db/schema";
import { generateNextCodes } from "@/data-access/code-generator";
import { deleteFormulationInTransaction } from "@/data-access/formulation-writes";
import { SafeError } from "@/lib/errors";
import { orderHasDeliveries } from "@/lib/order-domain-errors";
import { archiveFacility } from "@/data-access/facilities";
import { createDelivery } from "./helpers/create-delivery";
import { lockBiocharTransportRouteTopology } from "@/data-access/transport-legs";
import { recordOrder, updateOrder, deleteOrder } from "@/lib/operations/orders";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { cleanupOrderFixture, createOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";
import { cleanupPostedStock, deliveryInput, postedStockFixture } from "./helpers/posted-output-stock-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";
import type { OrgContext } from "@/lib/auth/server";

const SUITE_TIMEOUT_MS = 60_000;
const BARRIER_POOL_SIZE = 2;
const PARALLEL_CREATE_COUNT = 5;
const WRITER_POOL_SIZE = PARALLEL_CREATE_COUNT;
const REQUESTED_KG = 100;
const PATCH_KG = 50;
const DELIVERY_KG = 75;
let barrierPool: Pool;
let writerPool: Pool;
const fixtures: OrderFixture[] = [];
const stockFixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
beforeAll(() => { barrierPool = createTestPool(BARRIER_POOL_SIZE); writerPool = createTestPool(WRITER_POOL_SIZE); });
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupOrderFixture(f);
  for (const f of stockFixtures.splice(0)) await cleanupPostedStock(f);
});
afterAll(async () => { await barrierPool.end(); await writerPool.end(); });
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
function settle<T>(work: Promise<T>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

/** Queue writers on the shared topology or facility lock, on separate connections. */
async function queue(ctx: OrgContext, writers: (() => Promise<unknown>)[], facilityId?: string, formulationId?: string, orderId?: string) {
  const barrier = await openOperationBarrier(barrierPool);
  const started: ReturnType<typeof settle>[] = [];
  try {
    if (formulationId) {
      await barrier.tx.select().from(formulations).where(and(eq(formulations.id, formulationId), eq(formulations.organizationId, ctx.organizationId))).for("update");
    } else if (facilityId) {
      await barrier.tx.select().from(facilities).where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId))).for("update");
    } else {
      await lockBiocharTransportRouteTopology(ctx, barrier.tx);
    }
    for (const [index, write] of writers.entries()) {
      started.push(settle(write()));
      await waitForBlockedOperations(barrierPool, barrier.pid, index + 1);
    }
    if (orderId) {
      // A PATCH waiting for the formulation must not already hold the order row.
      await barrier.tx.select().from(orders)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, ctx.organizationId)))
        .for("update", { noWait: true });
    }
    await barrier.commit();
  } catch (error) {
    await barrier.rollback();
    await Promise.allSettled(started);
    throw error;
  }
  return Promise.all(started);
}

describe("order writer races", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("serializes five parallel generated codes before allocation", async () => {
    const f = await fixture();
    const results = await queue(f.ctx, Array.from({ length: PARALLEL_CREATE_COUNT }, () =>
      () => runOperation(recordOrder, f.ctx, orderInput(f), { pool: writerPool })));
    expect(results.every(result => result.ok)).toBe(true);
    const saved = await db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId));
    expect(saved).toHaveLength(PARALLEL_CREATE_COUNT);
    expect(new Set(saved.map(order => order.code)).size).toBe(PARALLEL_CREATE_COUNT);
  });

  it.each([true, false])("formulation delete versus explicit formulation PATCH, PATCH first: %s", async (patchFirst) => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    const patch = () => runOperation(updateOrder, f.ctx, {
      orderId: order.id, expectedVersion: 1, formulationId: f.recipe.id,
    }, { pool: writerPool });
    // The recipe's bin makes deletion a safe refusal after taking its row lock.
    const remove = () => db.transaction(tx => deleteFormulationInTransaction(f.ctx, tx, { formulationId: f.recipe.id, expectedVersion: f.recipe.version }));
    const results = await queue(f.ctx, patchFirst ? [patch, remove] : [remove, patch], undefined, f.recipe.id, order.id);
    const patched = results[patchFirst ? 0 : 1];
    const deleted = results[patchFirst ? 1 : 0];
    expect(patched.ok).toBe(true);
    expect(deleted.ok).toBe(false);
    if (!deleted.ok) {
      expect(deleted.error).toBeInstanceOf(SafeError);
      expect(deleted.error).toMatchObject({ message: "Formulation was not deleted because product bins use it. Keep this formulation." });
    }
    expect(await db.select().from(orders).where(eq(orders.id, order.id)))
      .toMatchObject([{ version: 2, formulationId: f.recipe.id }]);
  });

  it.each([true, false])("delete versus UI delivery create, delete first: %s", async (deleteFirst) => {
    const f = await postedStockFixture({ quantityKg: REQUESTED_KG });
    stockFixtures.push(f);
    const delivery = await deliveryInput(f, DELIVERY_KG);
    const remove = () => runOperation(deleteOrder, f.ctx, { orderId: f.order.id, expectedVersion: 1 }, { pool: writerPool });
    const deliver = () => createDelivery(f.ctx, delivery);
    const [first, second] = await queue(f.ctx, deleteFirst ? [remove, deliver] : [deliver, remove]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      if (deleteFirst) {
        expect(second.error).toBeInstanceOf(SafeError);
        expect(second.error).toMatchObject({ message: new SafeError("Order not found").message });
      } else {
        expect(second.error).toMatchObject({ code: "certification_locked", issues: orderHasDeliveries((await db.select().from(deliveries).where(eq(deliveries.orderId, f.order.id)))[0]).issues });
      }
    }
    expect(await db.select().from(orders).where(eq(orders.id, f.order.id))).toHaveLength(deleteFirst ? 0 : 1);
    expect(await db.select().from(deliveries).where(eq(deliveries.orderId, f.order.id))).toHaveLength(deleteFirst ? 0 : 1);
  });

  it.each([true, false])("UI update versus operation update, UI first: %s", async (uiFirst) => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    const input = { orderId: order.id, expectedVersion: 1 };
    const ui = () => runOperationInProcess(updateOrder, f.ctx, { ...input, code: "OR-UI" }, { pool: writerPool });
    const api = () => runOperation(updateOrder, f.ctx, { ...input, code: "OR-API" }, { pool: writerPool });
    const [first, second] = await queue(f.ctx, uiFirst ? [ui, api] : [api, ui]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { code: "stale_version" } });
    expect(await db.select().from(orders).where(eq(orders.id, order.id))).toMatchObject([{ version: 2, code: uiFirst ? "OR-UI" : "OR-API" }]);
  });

  it.each([true, false])("update versus delete, update first: %s", async (updateFirst) => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    const input = { orderId: order.id, expectedVersion: 1 };
    const update = () => runOperation(updateOrder, f.ctx, { ...input, code: "OR-EDIT" }, { pool: writerPool });
    const remove = () => runOperation(deleteOrder, f.ctx, input, { pool: writerPool });
    const [first, second] = await queue(f.ctx, updateFirst ? [update, remove] : [remove, update]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { code: updateFirst ? "stale_version" : "not_found" } });
    const saved = await db.select().from(orders).where(eq(orders.id, order.id));
    if (updateFirst) expect(saved).toMatchObject([{ version: 2, code: "OR-EDIT" }]);
    else expect(saved).toEqual([]);
  });

  it.each([true, false])("quantity PATCH versus the UI delivery writer, PATCH first: %s", async (patchFirst) => {
    const f = await postedStockFixture({ quantityKg: REQUESTED_KG });
    stockFixtures.push(f);
    const delivery = await deliveryInput(f, DELIVERY_KG);
    const patch = () => runOperation(updateOrder, f.ctx, { orderId: f.order.id, expectedVersion: 1, quantityKg: PATCH_KG }, { pool: writerPool });
    const deliver = () => createDelivery(f.ctx, delivery);
    const [first, second] = await queue(f.ctx, patchFirst ? [patch, deliver] : [deliver, patch]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!patchFirst) expect(second).toMatchObject({ error: { code: "validation_failed", issues: [expect.objectContaining({ meta: { allocatedWetKg: DELIVERY_KG, unit: "kg" } })] } });
    const [saved] = await db.select().from(orders).where(eq(orders.id, f.order.id));
    const allocated = await db.select().from(deliveries).where(eq(deliveries.orderId, f.order.id));
    expect(saved.quantityKg).toBe(patchFirst ? PATCH_KG : REQUESTED_KG);
    expect(allocated).toHaveLength(patchFirst ? 0 : 1);
    expect(allocated.reduce((total, row) => total + (row.deliveredWetMassKg ?? 0), 0)).toBeLessThanOrEqual(saved.quantityKg);
  });

  it.each([true, false])("create versus facility archive, create first: %s", async (createFirst) => {
    const f = await fixture();
    const create = () => runOperation(recordOrder, f.ctx, orderInput(f), { pool: writerPool });
    const archive = () => archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const [first, second] = await queue(f.ctx, createFirst ? [create, archive] : [archive, create], f.facility.id);
    expect(first.ok).toBe(true);
    const saved = await db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId));
    if (createFirst) {
      expect(second.ok).toBe(true);
      expect(saved).toHaveLength(1);
      expect(saved[0].archivedAt).not.toBeNull();
    } else {
      expect(second).toMatchObject({ ok: false, error: { code: "not_found", issues: [expect.objectContaining({ path: ["facilityId"] })] } });
      expect(saved).toEqual([]);
    }
  });

  it.each([true, false])("PATCH versus facility archive, PATCH first: %s", async (patchFirst) => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    const patch = () => runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, code: "OR-EDIT" }, { pool: writerPool });
    const archive = () => archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const [first, second] = await queue(f.ctx, patchFirst ? [patch, archive] : [archive, patch], f.facility.id);
    expect(first.ok).toBe(true);
    if (patchFirst) expect(second.ok).toBe(true);
    else expect(second).toMatchObject({ ok: false, error: { code: "not_found" } });
    const [saved] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(saved.archivedAt).not.toBeNull();
    expect(saved.code).toBe(patchFirst ? "OR-EDIT" : order.code);
  });

  it("retries a generated code collision inside its savepoint", async () => {
    const f = await fixture();
    const [taken] = await generateNextCodes(f.ctx, "OR", orders, orders.code, 1);
    const barrier = await openOperationBarrier(barrierPool);
    let pending: ReturnType<typeof runOperation<typeof recordOrder.input, Awaited<ReturnType<typeof recordOrder.execute>>>> | undefined;
    try {
      // An uncommitted code is invisible to MAX; its unique index blocks the insert.
      await barrier.tx.insert(orders).values({ ...orderInput(f), orderDate: new Date("2026-09-12"), code: taken,
        packaging: "loose", organizationId: f.ctx.organizationId });
      pending = runOperation(recordOrder, f.ctx, orderInput(f), { pool: writerPool });
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      await barrier.commit();
    } catch (error) {
      await barrier.rollback();
      await Promise.allSettled([pending]);
      throw error;
    }
    const created = (await pending!).data;
    expect(created.code).not.toBe(taken);
    expect(await db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId))).toHaveLength(2);
  });
});
