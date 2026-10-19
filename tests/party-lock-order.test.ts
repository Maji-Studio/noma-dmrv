import type { OrgContext } from "@/lib/auth/server";
import { lockBiocharTransportRouteTopology } from "@/data-access/transport-legs";
import { createOrderInTransaction } from "@/data-access/orders";
import { updateCustomerInTransaction } from "@/data-access/customer-writes";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000"; });
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { customers, suppliers } from "@/db/schema";
import { deleteCustomer, updateCustomer } from "@/lib/operations/customers";
import { deleteSupplier } from "@/lib/operations/suppliers";
import { recordOrder } from "@/lib/operations/orders";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { runOperation } from "@/lib/operations/runner";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool, createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "./helpers/operation-fixture";
import { createOrderFixture, cleanupOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

const TIMEOUT_MS = 60_000;
const CONNECTIONS = 2;
let barriers: Pool;
let writers: Pool;
const orders: OrderFixture[] = [];
const intakes: IntakeFixture[] = [];
beforeAll(() => { barriers = createTestPool(CONNECTIONS); writers = createTestPool(CONNECTIONS); });
afterEach(async () => { for (const f of orders.splice(0)) await cleanupOrderFixture(f); for (const f of intakes.splice(0)) await removeIntakeFixture(f); });
afterAll(async () => { await barriers.end(); await writers.end(); });
const settle = (work: Promise<unknown>) => work.then(value => ({ ok: true, value }), (error: unknown) => ({ ok: false, error }));
async function queue(kind: "supplier" | "customer", organizationId: string, id: string, calls: (() => Promise<unknown>)[]) {
  const barrier = await openOperationBarrier(barriers);
  const pending: ReturnType<typeof settle>[] = [];
  try {
    const table = kind === "supplier" ? suppliers : customers;
    if (kind === "customer") await lockBiocharTransportRouteTopology({ organizationId, userId: "lock-order-barrier" } as OrgContext, barrier.tx);
    await barrier.tx.select().from(table).where(and(eq(table.organizationId, organizationId), eq(table.id, id))).for("update");
    for (const [index, call] of calls.entries()) {
      pending.push(settle(call()));
      await waitForBlockedOperations(barriers, barrier.pid, index + 1);
    }
    await barrier.commit();
  } catch (error) { await barrier.rollback(); await Promise.allSettled(pending); throw error; }
  return Promise.all(pending);
}
describe("party lock order", { timeout: TIMEOUT_MS }, () => {
  it.each([true, false])("supplier delete versus intake create, intake first: %s", async first => {
    const f = await createIntakeFixture("party-lock"); intakes.push(f);
    const create = () => runOperation(logFeedstockDelivery, f.ctx, f.input(), { pool: writers });
    const remove = () => runOperation(deleteSupplier, f.ctx, { supplierId: f.supplierId, expectedVersion: 1 }, { pool: writers });
    const results = await queue("supplier", f.ctx.organizationId, f.supplierId, first ? [create, remove] : [remove, create]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { code: first ? "conflict" : "not_found", issues: [expect.objectContaining({ path: ["supplierId"] })] } });
  });
  it.each([true, false])("customer delete versus order create, order first: %s", async first => {
    const f = await createOrderFixture(); orders.push(f);
    const create = () => runOperation(recordOrder, f.ctx, orderInput(f), { pool: writers });
    const remove = () => runOperation(deleteCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 }, { pool: writers });
    const results = await queue("customer", f.ctx.organizationId, f.customer.id, first ? [create, remove] : [remove, create]);
    expect(results[0].ok).toBe(true);
    if (first) expect(results[1].ok).toBe(true);
    else expect(results[1]).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
  it.each([false, true])("metadata edit passes a customer KEY SHARE; code edit waits: %s", async code => {
    const f = await createOrderFixture(); orders.push(f);
    const barrier = await openOperationBarrier(barriers);
    let pending: ReturnType<typeof settle> | undefined;
    try {
      await createOrderInTransaction(f.ctx, barrier.tx, { ...orderInput(f), code: "ORD-HELD", orderDate: new Date("2026-09-12"), packaging: "loose" });
      pending = settle(runOperation(updateCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1, ...(code ? { code: "CUS-NEW" } : { cropType: "Coffee" }) }, { pool: writers }));
      if (code) await waitForBlockedOperations(barriers, barrier.pid, 1);
      else expect((await pending).ok).toBe(true);
      await barrier.commit();
      expect((await pending).ok).toBe(true);
    } finally { await barrier.rollback(); await pending; }
  });
  it.each([false, true])("order create passes metadata edit but waits for code edit: %s", async code => {
    const f = await createOrderFixture(); orders.push(f);
    const barrier = await openOperationBarrier(barriers);
    let pending: ReturnType<typeof settle> | undefined;
    try {
      await updateCustomerInTransaction(f.ctx, barrier.tx, { customerId: f.customer.id, expectedVersion: 1, ...(code ? { code: "CUS-UPDATED" } : { cropType: "Coffee" }) });
      pending = settle(runOperation(recordOrder, f.ctx, orderInput(f), { pool: writers }));
      if (code) await waitForBlockedOperations(barriers, barrier.pid, 1);
      else expect((await pending).ok).toBe(true);
      await barrier.commit();
      expect((await pending).ok).toBe(true);
    } finally { await barrier.rollback(); await pending; }
  });
});
