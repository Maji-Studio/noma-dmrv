import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { recordOrder } from "@/lib/operations/orders";
import { runOperationInProcess } from "@/lib/operations/runner";
import { cleanupOrderFixture, createOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

const CHANGED_QUANTITY_KG = 200;
const SUITE_TIMEOUT_MS = 60_000;
const fixtures: OrderFixture[] = [];
async function fixture() {
  const result = await createOrderFixture();
  fixtures.push(result);
  return result;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupOrderFixture(f);
});
const rows = (f: OrderFixture) => db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId));

describe("app create intents with the real order writer", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("replays one committed order, allows a separate equal entry, and refuses changed values", async () => {
    const f = await fixture();
    const options = { intentKey: randomUUID() };
    const first = await runOperationInProcess(recordOrder, f.ctx, orderInput(f), options);
    const replay = await runOperationInProcess(recordOrder, f.ctx, orderInput(f), options);
    expect(replay).toEqual(first);
    expect(replay.orderDate).toBeInstanceOf(Date);
    expect(await rows(f)).toMatchObject([{ id: first.id, code: first.code }]);
    expect(await rows(f)).toHaveLength(1);

    await expect(runOperationInProcess(recordOrder, f.ctx, orderInput(f, { quantityKg: CHANGED_QUANTITY_KG }), options))
      .rejects.toMatchObject({ code: "idempotency_key_reused", message: "The app already saved this record with other values. Close the form and check the list." });
    expect(await rows(f)).toHaveLength(1);

    const separate = await runOperationInProcess(recordOrder, f.ctx, orderInput(f), { intentKey: randomUUID() });
    expect(separate.id).not.toBe(first.id);
    expect(separate.code).not.toBe(first.code);
    expect(await rows(f)).toHaveLength(2);
  });

  it("isolates the same user's key across organizations", async () => {
    const firstOrg = await fixture();
    const secondOrg = await fixture();
    // Hold the credential namespace fixed so this exercises organization isolation.
    const secondContext = { ...secondOrg.ctx, userId: firstOrg.ctx.userId };
    const options = { intentKey: randomUUID() };
    const first = await runOperationInProcess(recordOrder, firstOrg.ctx, orderInput(firstOrg), options);
    const second = await runOperationInProcess(recordOrder, secondContext, orderInput(secondOrg), options);
    expect(second.id).not.toBe(first.id);
    expect(second.organizationId).toBe(secondOrg.ctx.organizationId);
    expect(await rows(firstOrg)).toHaveLength(1);
    expect(await rows(secondOrg)).toHaveLength(1);
    expect(await runOperationInProcess(recordOrder, secondContext, orderInput(secondOrg), options)).toEqual(second);
  });
});
