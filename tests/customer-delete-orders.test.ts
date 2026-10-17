import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, customers, customerLocations, deliveries, documents, facilities, orders, storageObjectDeletions } from "@/db/schema";
import { logger } from "@/lib/log";
import { addCustomerLocation } from "@/lib/operations/customer-locations";
import { TEST_SITE_POSITION } from "./helpers/test-org";
import { deleteCustomer } from "@/lib/operations/customers";
import { recordOrder } from "@/lib/operations/orders";
import { runOperation, type Operation } from "@/lib/operations/runner";
import { runWithCascadePreview } from "@/lib/operations/cascade-preview";
import { lockBiocharTransportRouteTopology } from "@/data-access/transport-legs";
import { createDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { __setStorageProviderForTests } from "@/lib/storage";
import { cleanupOrderFixture, createOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { insertManagedDocument, RetirementStorageProvider } from "./helpers/document-retirement";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";

const TIMEOUT_MS = 60_000;
const CONNECTIONS = 4;
const LOCATION_DISTANCE_KM = 25;
const fixtures: OrderFixture[] = [];
const deliveryOrganizations: string[] = [];
let pool: Pool;
beforeAll(() => { pool = createTestPool(CONNECTIONS); });
afterAll(async () => { await pool.end(); });
afterEach(async () => {
  vi.restoreAllMocks();
  __setStorageProviderForTests(null);
  for (const f of fixtures.splice(0)) await cleanupOrderFixture(f);
  for (const id of deliveryOrganizations.splice(0)) {
    await db.delete(activityEvents).where(eq(activityEvents.organizationId, id));
    await cleanupOutputStockFixture(db, id);
  }
});
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
const input = (f: Pick<OrderFixture, "customer">) => ({ customerId: f.customer.id, expectedVersion: f.customer.version });
const record = (f: OrderFixture) => runOperation(recordOrder, f.ctx, orderInput(f));
const settle = (promise: Promise<unknown>) => promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

describe("customer delete orders", { timeout: TIMEOUT_MS }, () => {
  it("previews and cascades archived orders and documents, with exactly one event per deleted entity", async () => {
    const f = await fixture();
    const first = (await record(f)).data;
    const second = (await record(f)).data;
    await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, second.id));
    const storage = new RetirementStorageProvider();
    __setStorageProviderForTests(storage);
    const document = await insertManagedDocument(storage, "order", first.id, `test/${randomUUID()}`, f.ctx.organizationId);
    const preview = await runOperation(deleteCustomer, f.ctx, input(f), { dryRun: true });
    expect(preview.data.cascade.orders).toEqual([first, second].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, code }) => ({ id, code })));
    expect(preview.data.warnings).toEqual([`Also deleted 2 orders without deliveries: ${preview.data.cascade.orders.map(row => row.code).join(", ")}.`]);
    expect(storage.deleteCalls).toHaveLength(0);
    expect(await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId))).toHaveLength(2);
    const deletedEvents = () => db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, f.ctx.organizationId), eq(activityEvents.action, "deleted")));
    expect(await deletedEvents()).toEqual([]);
    const saved = await runOperation(deleteCustomer, f.ctx, { ...input(f), cascadeFingerprint: preview.data.cascade.cascadeFingerprint });
    expect(saved.data).toEqual(preview.data);
    expect(await db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(customerLocations).where(eq(customerLocations.customerId, f.customer.id))).toEqual([]);
    expect(await db.select().from(customers).where(eq(customers.id, f.customer.id))).toEqual([]);
    expect(await db.select().from(documents).where(eq(documents.id, document))).toEqual([]);
    expect(storage.objects.size).toBe(0);
    expect(storage.deleteCalls).toHaveLength(1);
    const queued = await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, f.ctx.organizationId));
    expect(queued).toHaveLength(1);
    expect(queued[0].completedAt).not.toBeNull();
    const events = (await deletedEvents()).filter(row => row.entityType !== "document");
    expect(events).toHaveLength(4);
    for (const [entityType, id] of [["order", first.id], ["order", second.id], ["customer_location", f.location.id], ["customer", f.customer.id]]) {
      expect(events.filter(row => row.entityType === entityType && row.entityId === id)).toHaveLength(1);
    }
    expect(events.filter(row => row.entityType === "order").every(row => row.facilityId === f.facility.id && row.source === "form")).toBe(true);
  });

  it("refuses an archived delivery with its code", async () => {
    const f = await fixture(); const order = (await record(f)).data;
    await db.insert(deliveries).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
      orderId: order.id, storageLocationId: f.bin.id, code: "DEL-ARCHIVED", deliveryDate: new Date("2026-09-14"),
      deliveredWetMassKg: 10, massDryKg: 10, archivedAt: new Date() });
    await expect(runOperation(deleteCustomer, f.ctx, input(f))).rejects.toMatchObject({ code: "conflict",
      issues: [{ path: ["customerId"], meta: { deliveryCodes: ["DEL-ARCHIVED"] } }] });
  });

  it("returns a fresh cascade on mismatch without consuming the key, and replays after deletion", async () => {
    const f = await fixture();
    const preview = await runOperation(deleteCustomer, f.ctx, input(f), { dryRun: true });
    expect(preview.data.cascade.cascadeFingerprint).toBe("v1:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    const order = (await record(f)).data;
    const options = { idempotency: { credentialId: `test-${f.tag}`, key: randomUUID() } };
    await expect(runWithCascadePreview(deleteCustomer, f.ctx, { ...input(f), cascadeFingerprint: preview.data.cascade.cascadeFingerprint }, options))
      .rejects.toMatchObject({ code: "cascade_changed", issues: [{ path: ["cascadeFingerprint"] }],
        preview: { orders: [{ id: order.id, code: order.code }], cascadeFingerprint: expect.stringMatching(/^v1:/) } });
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toEqual([]);
    const saved = await runWithCascadePreview(deleteCustomer, f.ctx, input(f), options);
    expect(saved.data.warnings).toEqual([`Also deleted 1 order without deliveries: ${order.code}.`]);
    const replay = await runWithCascadePreview(deleteCustomer, f.ctx, input(f), options);
    expect(replay.replayed).toBe(true); expect(replay.data).toEqual(saved.data);
  });

  it("checks the customer version before the cascade fingerprint", async () => {
    const f = await fixture();
    await expect(runWithCascadePreview(deleteCustomer, f.ctx, { ...input(f), expectedVersion: 2, cascadeFingerprint: "old" }))
      .rejects.toMatchObject({ code: "stale_version" });
  });

  it.each([true, false])("serializes order creation, create first: %s", async createFirst => {
    const f = await fixture(); const barrier = await openOperationBarrier(pool);
    const pending: ReturnType<typeof settle>[] = [];
    try {
      await lockBiocharTransportRouteTopology(f.ctx, barrier.tx);
      const create = () => runOperation(recordOrder, f.ctx, orderInput(f), { pool });
      const remove = () => runOperation(deleteCustomer, f.ctx, input(f), { pool });
      for (const call of createFirst ? [create, remove] : [remove, create]) {
        pending.push(settle(call())); await waitForBlockedOperations(pool, barrier.pid, pending.length);
      }
      await barrier.commit();
      const [a, b] = await Promise.all(pending);
      expect(a.ok).toBe(true);
      if (createFirst) expect(b).toMatchObject({ ok: true, value: { data: {
        cascade: { orders: [{ id: expect.any(String), code: expect.any(String) }] },
        warnings: [expect.stringMatching(/^Also deleted 1 order without deliveries:/)],
      } } });
      else expect(b).toMatchObject({ ok: false, error: { code: "not_found", issues: [{ path: ["customerId"] }] } });
      expect(await db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId))).toEqual([]);
    } finally { await barrier.rollback(); await Promise.allSettled(pending); }
  });

  it.each([true, false])("serializes delivery creation, create first: %s", async createFirst => {
    const f = await createDeliveryFixture(); deliveryOrganizations.push(f.ctx.organizationId);
    const barrier = await openOperationBarrier(pool); const pending: ReturnType<typeof settle>[] = [];
    // Keep the real delivery writer and its topology lock inside the runner.
    const delivery: Operation<typeof deleteCustomer.input, unknown> = { id: "test_delivery", input: deleteCustomer.input,
      supportsDryRun: true, execute: async scope => ({ id: (await createDeliveryInTransaction(scope.ctx, scope.tx, f.input)).delivery.id }) };
    try {
      await lockBiocharTransportRouteTopology(f.ctx, barrier.tx);
      const create = () => runOperation(delivery, f.ctx, input(f), { pool });
      const remove = () => runOperation(deleteCustomer, f.ctx, input(f), { pool });
      for (const call of createFirst ? [create, remove] : [remove, create]) {
        pending.push(settle(call())); await waitForBlockedOperations(pool, barrier.pid, pending.length);
      }
      await barrier.commit(); const [a, b] = await Promise.all(pending);
      expect(a.ok).toBe(true);
      expect(b).toMatchObject({ ok: false, error: { code: createFirst ? "conflict" : "not_found",
        issues: [{ path: [createFirst ? "customerId" : "orderId"] }] } });
    } finally { await barrier.rollback(); await Promise.allSettled(pending); }
  });

  it("finishes customer delete, location add and facility archive without a three-writer deadlock", async () => {
    const f = await fixture();
    await record(f);
    const warnings = vi.spyOn(logger, "warn");
    const errors = vi.spyOn(logger, "error");
    const barrier = await openOperationBarrier(pool);
    const pending: ReturnType<typeof settle>[] = [];
    try {
      await barrier.tx.select().from(customers).where(and(
        eq(customers.organizationId, f.ctx.organizationId), eq(customers.id, f.customer.id),
      )).for("update");
      // Queue delete before add on the customer. Add holds a facility share;
      // archive queues for that facility. A customer-first delete would then
      // wait behind archive for its facility share and close the three-way cycle.
      pending.push(settle(runOperation(deleteCustomer, f.ctx, input(f), { pool })));
      await waitForBlockedOperations(pool, barrier.pid, 1);
      pending.push(settle(runOperation(addCustomerLocation, f.ctx, {
        ...TEST_SITE_POSITION, customerId: f.customer.id, name: `E2E Concurrent ${f.tag}`, country: "CH",
        facilityDistances: [{ facilityId: f.facility.id, distanceKm: LOCATION_DISTANCE_KM, distanceSource: "manual" }],
      }, { pool })));
      await waitForBlockedOperations(pool, barrier.pid, 2);
      pending.push(settle(archiveFacility(f.ctx, f.facility.id, f.facility.version)));
      await waitForBlockedOperations(pool, barrier.pid, 3);
      await barrier.commit();
      const [removed, added, archived] = await Promise.all(pending);
      expect(removed.ok).toBe(true);
      expect(added).toMatchObject({ ok: false, error: { code: "not_found", issues: [{ path: ["customerId"] }] } });
      expect(archived.ok).toBe(true);
      // The runner can retry a deadlock into success; outcomes alone miss it.
      expect(JSON.stringify([...warnings.mock.calls, ...errors.mock.calls])).not.toContain("40P01");
    } finally { await barrier.rollback(); await Promise.allSettled(pending); }
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])("serializes facility restore=%s, facility first=%s", async (restore, facilityFirst) => {
    const f = await fixture();
    // Insert the larger UUID first, so heap order and customer lock order differ.
    const ids = [randomUUID(), randomUUID()].sort().reverse();
    for (const [index, id] of ids.entries()) await db.insert(orders).values({ id, organizationId: f.ctx.organizationId,
      facilityId: f.facility.id, customerId: f.customer.id, customerLocationId: f.location.id,
      formulationId: f.recipe.id, code: `ORD-${index}`, orderDate: new Date("2026-09-12"), quantityKg: 100, packaging: "loose" });
    if (restore) await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const [facility] = await db.select().from(facilities).where(eq(facilities.id, f.facility.id));
    const barrier = await openOperationBarrier(pool); const pending: ReturnType<typeof settle>[] = [];
    try {
      await barrier.tx.select().from(facilities).where(eq(facilities.id, f.facility.id)).for("update");
      const transition = () => (restore ? restoreFacility : archiveFacility)(f.ctx, facility.id, facility.version);
      const remove = () => runOperation(deleteCustomer, f.ctx, input(f), { pool });
      for (const call of facilityFirst ? [transition, remove] : [remove, transition]) {
        pending.push(settle(call())); await waitForBlockedOperations(pool, barrier.pid, pending.length);
      }
      await barrier.commit();
      expect((await Promise.all(pending)).map(result => result.ok)).toEqual([true, true]);
      expect(await db.select().from(orders).where(eq(orders.organizationId, f.ctx.organizationId))).toEqual([]);
    } finally { await barrier.rollback(); await Promise.allSettled(pending); }
  });
});
