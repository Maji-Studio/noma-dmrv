import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { customerLocations, customers } from "@/db/schema";
import { archiveCustomerLocation, updateCustomerLocation, deleteCustomerLocation } from "@/lib/operations/customer-locations";
import { recordOrder, updateOrder } from "@/lib/operations/orders";
import { runOperation } from "@/lib/operations/runner";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";
import { createOrderFixture, cleanupOrderFixture, createOrderDestination, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

const TIMEOUT_MS = 60_000;
const CONNECTIONS = 2;
let barriers: Pool;
let writers: Pool;
const fixtures: OrderFixture[] = [];
beforeAll(() => { barriers = createTestPool(CONNECTIONS); writers = createTestPool(CONNECTIONS); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupOrderFixture(f); });
afterAll(async () => { await barriers.end(); await writers.end(); });
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
function settle(work: Promise<unknown>) {
  return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

// Observe both queued lock requests before releasing the barrier. Location
// barriers specifically exercise KEY SHARE versus archive's explicit UPDATE.
async function queue(f: OrderFixture, location: boolean, calls: (() => Promise<unknown>)[]) {
  const barrier = await openOperationBarrier(barriers);
  const pending: ReturnType<typeof settle>[] = [];
  try {
    if (location) await barrier.tx.select().from(customerLocations)
      .where(and(eq(customerLocations.organizationId, f.ctx.organizationId), eq(customerLocations.id, f.location.id))).for("update");
    else await barrier.tx.select().from(customers)
      .where(and(eq(customers.organizationId, f.ctx.organizationId), eq(customers.id, f.customer.id))).for("update");
    for (const [index, call] of calls.entries()) {
      pending.push(settle(call()));
      await waitForBlockedOperations(barriers, barrier.pid, index + 1);
    }
    await barrier.commit();
  } catch (error) {
    await barrier.rollback(); await Promise.allSettled(pending); throw error;
  }
  return Promise.all(pending);
}
const archive = (f: OrderFixture, locationId = f.location.id) => runOperation(archiveCustomerLocation, f.ctx, { locationId, expectedVersion: 1 }, { pool: writers });

describe("customer location archive races", { timeout: TIMEOUT_MS }, () => {
  for (const path of ["create", "repoint"] as const) it.each([true, false])(`${path}, archive first: %s`, async archiveFirst => {
    const f = await fixture(); const spare = await createOrderDestination(f);
    const order = path === "repoint" ? (await runOperation(recordOrder, f.ctx, orderInput(f, { customerLocationId: spare.id }))).data : undefined;
    const write = () => order
      ? runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, customerLocationId: f.location.id }, { pool: writers })
      : runOperation(recordOrder, f.ctx, orderInput(f), { pool: writers });
    const transition = () => archive(f);
    const results = await queue(f, true, archiveFirst ? [transition, write] : [write, transition]);
    expect(results[0].ok).toBe(true);
    if (archiveFirst) expect(results[1]).toMatchObject({ ok: false, error: { code: "not_found", issues: [expect.objectContaining({ path: ["customerLocationId"] })] } });
    else expect(results[1].ok).toBe(true);
  });

  it("serializes archives of the last two active locations, with exactly one conflict", async () => {
    const f = await fixture(); const spare = await createOrderDestination(f);
    const results = await queue(f, false, [() => archive(f), () => archive(f, spare.id)]);
    expect(results).toMatchObject([{ ok: true }, { ok: false, error: { code: "conflict" } }]);
  });

  for (const path of ["update", "delete"] as const) it.each([true, false])(`${path}, archive first: %s`, async archiveFirst => {
    const f = await fixture(); await createOrderDestination(f);
    const write = () => path === "update"
      ? runOperation(updateCustomerLocation, f.ctx, { locationId: f.location.id, expectedVersion: 1, defaultSoilTemperatureC: 25 }, { pool: writers })
      : runOperation(deleteCustomerLocation, f.ctx, { locationId: f.location.id, expectedVersion: 1 }, { pool: writers });
    const transition = () => archive(f);
    const results = await queue(f, false, archiveFirst ? [transition, write] : [write, transition]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { code: path === "update"
      ? (archiveFirst ? "not_found" : "stale_version") : (archiveFirst ? "stale_version" : "not_found") } });
  });
});
