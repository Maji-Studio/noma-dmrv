import { apiActivityWhere } from "./helpers/api-activity";
import { drizzle } from "drizzle-orm/node-postgres";
import { createTestPool } from "./helpers/operation-fixture";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, deliveries, facilities, organizationSettings, documents, activityEvents } from "@/db/schema";
import { recordOrder, updateOrder, deleteOrder } from "@/lib/operations/orders";
import { runOperation } from "@/lib/operations/runner";
import { cleanupOrderFixture, createOrderDestination, createOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

import { __setStorageProviderForTests } from "@/lib/storage";
import { certifyOutputLineage, cleanupCertifiedOutputLineage } from "./helpers/certified-output-lineage";
import { insertManagedDocument, RetirementStorageProvider } from "./helpers/document-retirement";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });

const ALLOCATED_KG = 50;
const ONE_GRAM_KG = 0.001;
async function addDelivery(f: OrderFixture, orderId: string, archived = false) {
  await db.insert(deliveries).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, orderId,
    code: `E2E-D-${f.tag}`, storageLocationId: f.bin.id, deliveryDate: new Date("2026-09-14T12:00:00Z"),
    deliveredWetMassKg: ALLOCATED_KG, massDryKg: ALLOCATED_KG, archivedAt: archived ? new Date() : null });
}
const SUITE_TIMEOUT_MS = 60_000;
const NO_SELF_WAIT_MS = 5_000;
const fixtures: OrderFixture[] = [];
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return { ...f, otherLocation: await createOrderDestination(f) }; }
afterEach(async () => { __setStorageProviderForTests(null); for (const f of fixtures.splice(0)) { await cleanupCertifiedOutputLineage(f.ctx.organizationId); await cleanupOrderFixture(f); } });
const rows = (f: OrderFixture) => db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId));
const record = (f: OrderFixture, changes: Record<string, unknown> = {}) => runOperation(recordOrder, f.ctx, orderInput(f, changes));

describe("order operations with one pooled connection", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("creates, updates and deletes without waiting on its own connection", async () => {
    const f = await fixture();
    expect(db.$client.options.max).toBe(1);
    const started = Date.now();
    const created = await record(f);
    expect(created.data).toMatchObject({ version: 1, orderDate: "2026-09-12T00:00:00.000Z" });
    expect(created.data.code).toMatch(/^OR-\d{2}-\d{3,}$/);
    const updated = await runOperation(updateOrder, f.ctx, { orderId: created.data.id, expectedVersion: 1, code: "OR-EDIT" });
    expect(updated.data).toMatchObject({ version: 2, code: "OR-EDIT" });
    await expect(runOperation(updateOrder, f.ctx, { orderId: created.data.id, expectedVersion: 1, code: "OR-LATE" }))
      .rejects.toMatchObject({ code: "stale_version" });
    await runOperation(deleteOrder, f.ctx, { orderId: created.data.id, expectedVersion: 2 });
    expect(await rows(f)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });
});

describe("order PATCH guards", { timeout: SUITE_TIMEOUT_MS }, () => {
  it.each([false, true])("freezes relationships with an archived delivery: %s", async (archived) => {
    const f = await fixture();
    const order = (await record(f)).data;
    await addDelivery(f, order.id, archived);
    const patch = { orderId: order.id, expectedVersion: 1 };
    for (const [field, value] of Object.entries({ customerId: f.otherCustomer.id, customerLocationId: f.otherLocation.id,
      formulationId: f.pure.id, facilityId: f.otherFacility.id })) {
      await expect(runOperation(updateOrder, f.ctx, { ...patch, [field]: value }))
        .rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ path: [field] })] });
    }
    const saved = await runOperation(updateOrder, f.ctx, { ...patch, customerId: undefined, customerLocationId: undefined, code: "OR-KEPT" });
    expect(saved.data).toMatchObject({ customerId: f.customer.id, customerLocationId: f.location.id, code: "OR-KEPT" });
    await expect(runOperation(deleteOrder, f.ctx, { orderId: order.id, expectedVersion: 2 })).rejects.toMatchObject({ code: "conflict" });
  });

  it("moves an order without deliveries to another facility", async () => {
    const f = await fixture();
    const order = (await record(f)).data;
    const saved = await runOperation(updateOrder, f.ctx, {
      orderId: order.id, expectedVersion: 1, facilityId: f.otherFacility.id,
    });
    expect(saved.data).toMatchObject({ facilityId: f.otherFacility.id, version: 2 });
    expect(await rows(f)).toMatchObject([{ id: order.id, facilityId: f.otherFacility.id, version: 2 }]);
  });

  it("accepts exactly allocated wet mass and refuses one gram below", async () => {
    const f = await fixture();
    const order = (await record(f)).data;
    await addDelivery(f, order.id);
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, quantityKg: ALLOCATED_KG - ONE_GRAM_KG }))
      .rejects.toMatchObject({ code: "validation_failed", issues: [expect.objectContaining({ path: ["quantityKg"], meta: { allocatedWetKg: ALLOCATED_KG, unit: "kg" } })] });
    const saved = await runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, quantityKg: ALLOCATED_KG });
    expect(saved.data.quantityKg).toBe(ALLOCATED_KG);
  });

  it("keeps omitted keys and replaces an explicit location", async () => {
    const f = await fixture();
    const order = (await record(f)).data;
    const saved = await runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, customerLocationId: f.otherLocation.id });
    expect(saved.data).toMatchObject({ customerLocationId: f.otherLocation.id, customerId: order.customerId, formulationId: order.formulationId,
      facilityId: order.facilityId, orderDate: order.orderDate, quantityKg: order.quantityKg, packaging: order.packaging });
  });

  it("refuses an archived order PATCH but allows deleting it without deliveries", async () => {
    const f = await fixture();
    const order = (await record(f)).data;
    await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, order.id));
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, code: "OR-ARCHIVED" }))
      .rejects.toMatchObject({ code: "not_found", issues: [expect.objectContaining({ path: ["orderId"] })] });
    await runOperation(deleteOrder, f.ctx, { orderId: order.id, expectedVersion: 1 });
    expect(await rows(f)).toEqual([]);
  });
});

describe("order defaults and references", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("uses the organization packaging default and preserves explicit packaging", async () => {
    const f = await fixture();
    await db.insert(organizationSettings).values({ organizationId: f.ctx.organizationId, defaultPackaging: "bagged" });
    expect((await record(f)).data.packaging).toBe("bagged");
    expect((await record(f, { packaging: "loose" })).data.packaging).toBe("loose");
  });

  it.each(["customerId", "customerLocationId", "formulationId", "facilityId"] as const)("refuses foreign and unknown %s on create and PATCH without side effects", async (field) => {
    const f = await fixture();
    const foreign = await fixture();
    const ids = { customerId: foreign.customer.id, customerLocationId: foreign.location.id,
      formulationId: foreign.recipe.id, facilityId: foreign.facility.id };
    const order = (await record(f)).data;
    for (const id of [ids[field], randomUUID()]) {
      const refusal = { code: "not_found", issues: [expect.objectContaining({ path: [field] })] };
      await expect(record(f, { [field]: id })).rejects.toMatchObject(refusal);
      await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, [field]: id })).rejects.toMatchObject(refusal);
    }
    expect(await rows(f)).toMatchObject([{ id: order.id, version: 1 }]);
    expect(await rows(foreign)).toEqual([]);
  });

  it("refuses a same-organization location belonging to a different customer", async () => {
    const f = await fixture();
    await expect(record(f, { customerId: f.otherCustomer.id })).rejects.toMatchObject({ code: "validation_failed",
      issues: [expect.objectContaining({ path: ["customerLocationId"] })] });
    const order = (await record(f)).data;
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, customerId: f.otherCustomer.id }))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(await rows(f)).toMatchObject([{ id: order.id, version: 1, customerId: f.customer.id }]);
  });

  it("refuses archived facilities on create and PATCH, including a metadata-only PATCH", async () => {
    const f = await fixture();
    const order = (await record(f)).data;
    await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.organizationId, f.ctx.organizationId));
    const refusal = { code: "not_found", issues: [expect.objectContaining({ path: ["facilityId"] })] };
    await expect(record(f)).rejects.toMatchObject(refusal);
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, facilityId: f.otherFacility.id })).rejects.toMatchObject(refusal);
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, code: "OR-ARCHIVE" })).rejects.toMatchObject(refusal);
    expect(await rows(f)).toMatchObject([{ id: order.id, version: 1 }]);
  });

  it("answers duplicate PATCH codes with conflict on code", async () => {
    const f = await fixture();
    const first = (await record(f)).data;
    const second = (await record(f)).data;
    await expect(runOperation(updateOrder, f.ctx, { orderId: second.id, expectedVersion: 1, code: first.code }))
      .rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ path: ["code"] })] });
    expect(await rows(f)).toHaveLength(2);
  });
});

describe("order rollback and storage", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("rolls back create, update and delete previews", async () => {
    const f = await fixture();
    await runOperation(recordOrder, f.ctx, orderInput(f), { dryRun: true });
    expect(await rows(f)).toEqual([]);
    const order = (await record(f)).data;
    await runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, code: "OR-PREVIEW" }, { dryRun: true });
    await runOperation(deleteOrder, f.ctx, { orderId: order.id, expectedVersion: 1 }, { dryRun: true });
    expect(await rows(f)).toMatchObject([{ id: order.id, version: 1, code: order.code }]);
  });

  it("retires documents and drains storage after commit, never on dry run or rollback", async () => {
    const f = await fixture();
    const order = (await record(f)).data;
    const provider = new RetirementStorageProvider();
    __setStorageProviderForTests(provider);
    const key = `orders/${f.tag}/evidence.pdf`;
    const documentId = await insertManagedDocument(provider, "order", order.id, key, f.ctx.organizationId);
    const input = { orderId: order.id, expectedVersion: 1 };
    await runOperation(deleteOrder, f.ctx, input, { dryRun: true });
    expect(provider.deleteCalls).toEqual([]);
    const [active] = await db.select().from(documents).where(eq(documents.id, documentId));
    expect(active.id).toBe(documentId);
    const failed: typeof deleteOrder = { ...deleteOrder, execute: async (scope, decoded) => {
      await deleteOrder.execute(scope, decoded);
      throw new Error("Failure before commit");
    } };
    await expect(runOperation(failed, f.ctx, input)).rejects.toThrow("Failure before commit");
    expect(provider.deleteCalls).toEqual([]);
    // The drain owns a new transaction, so observe the commit on another connection.
    const observerPool = createTestPool(1);
    const observer = drizzle(observerPool);
    const remove = provider.deleteObject.bind(provider);
    provider.deleteObject = async (storageKey) => {
      expect(await observer.select().from(orders).where(eq(orders.id, order.id))).toEqual([]);
      const [retired] = await observer.select().from(documents).where(eq(documents.id, documentId));
      expect(retired).toBeUndefined();
      await remove(storageKey);
    };
    try {
      await runOperation(deleteOrder, f.ctx, input);
      expect(provider.deleteCalls).toEqual([key]);
      expect(provider.objects.has(key)).toBe(false);
    } finally { await observerPool.end(); }
  });
});

describe("order idempotency", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("parallel duplicate keys produce one order and one audit row, then replay after archive and settings changes", async () => {
    const f = await fixture();
    const credentialId = `order-key-${f.tag}`;
    const options = { idempotency: { credentialId, key: randomUUID() },
      audit: { credentialId, transport: "rest" as const, requestId: randomUUID() } };
    const input = orderInput(f);
    const results = await Promise.allSettled([runOperation(recordOrder, f.ctx, input, options), runOperation(recordOrder, f.ctx, input, options)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "idempotency_in_progress" });
    const saved = await rows(f);
    expect(saved).toHaveLength(1);
    await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, saved[0].id));
    await db.insert(organizationSettings).values({ organizationId: f.ctx.organizationId, defaultPackaging: "bagged" });
    const replay = await runOperation(recordOrder, f.ctx, input, options);
    expect(replay.replayed).toBe(true);
    expect(replay.data.packaging).toBe(saved[0].packaging);
    expect(await db.select().from(activityEvents).where(apiActivityWhere(f.ctx.organizationId))).toHaveLength(1);
    await expect(runOperation(recordOrder, f.ctx, { ...input, quantityKg: 200 }, options)).rejects.toMatchObject({ code: "idempotency_key_reused" });
  });

  it("replays keyed PATCH and DELETE after their original versions are gone", async () => {
    const f = await fixture();
    const order = (await record(f)).data;
    const options = { idempotency: { credentialId: `order-key-${f.tag}`, key: randomUUID(), target: order.id, precondition: "1" } };
    const patch = { orderId: order.id, expectedVersion: 1, code: "OR-KEYED" };
    const changed = await runOperation(updateOrder, f.ctx, patch, options);
    expect((await runOperation(updateOrder, f.ctx, patch, options)).data).toEqual(changed.data);
    const deletion = { orderId: order.id, expectedVersion: 2 };
    const deleteOptions = { idempotency: { ...options.idempotency, key: randomUUID(), precondition: "2" } };
    await runOperation(deleteOrder, f.ctx, deletion, deleteOptions);
    expect((await runOperation(deleteOrder, f.ctx, deletion, deleteOptions)).replayed).toBe(true);
    expect(await rows(f)).toEqual([]);
  });
});


describe("order target and lineage checks", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("refuses foreign and missing order targets on PATCH and DELETE", async () => {
    const f = await fixture();
    const other = await fixture();
    const order = (await record(other)).data;
    for (const orderId of [order.id, randomUUID()]) {
      const input = { orderId, expectedVersion: 1 };
      const refusal = { code: "not_found", issues: [expect.objectContaining({ path: ["orderId"] })] };
      await expect(runOperation(updateOrder, f.ctx, { ...input, code: "OR-FOREIGN" })).rejects.toMatchObject(refusal);
      await expect(runOperation(deleteOrder, f.ctx, input)).rejects.toMatchObject(refusal);
    }
    expect(await rows(other)).toMatchObject([{ id: order.id, version: 1 }]);
  });

  it("keeps the order lineage guard typed on update and delete", async () => {
    const f = await fixture();
    await certifyOutputLineage(f, { runId: f.runs[0].id, submitted: true });
    const [order] = await rows(f);
    const input = { orderId: order.id, expectedVersion: order.version };
    const refusal = { code: "certification_locked", issues: [expect.objectContaining({ path: ["orderId"] })] };
    await expect(runOperation(updateOrder, f.ctx, { ...input, code: "OR-LOCKED" })).rejects.toMatchObject(refusal);
    await expect(runOperation(deleteOrder, f.ctx, input)).rejects.toMatchObject(refusal);
    expect(await rows(f)).toMatchObject([{ id: order.id, version: order.version, code: order.code }]);
  });

  it("isolates the same idempotency key by credential", async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await runOperation(recordOrder, f.ctx, orderInput(f), { idempotency: { credentialId: "order-credential-a", key } });
    const second = await runOperation(recordOrder, f.ctx, orderInput(f), { idempotency: { credentialId: "order-credential-b", key } });
    expect(second.data.id).not.toBe(first.data.id);
    expect(await rows(f)).toHaveLength(2);
  });
});
