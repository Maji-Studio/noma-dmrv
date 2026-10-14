import { getOutputBinStocks } from "@/data-access/output-stock";
import { withOutputStockErrors } from "@/lib/output-stock-domain-errors";
import { z } from "zod";
import { recordDeliveryInput } from "@/schemas/delivery-input";
import { runOperation, type Operation } from "@/lib/operations/runner";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { certifyOutputLineage, cleanupCertifiedOutputLineage } from "./helpers/certified-output-lineage";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, orders, binMovements, creditBatchApplications, apiAuditEvents, apiIdempotencyRecords, type Delivery } from "@/db/schema";
import { createDeliveryInTransaction, updateDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import { updateOrderInTransaction } from "@/data-access/orders";
import { createApiDeliveryWriteFixture, removeApiDeliveryWriteFixture, postDelivery, deliveryProblem, DELIVERY_AT } from "./helpers/api-delivery-write-fixture";
import { archiveStorageLocation } from "@/data-access/storage-locations";
import { storageLocations } from "@/db/schema";
import { archiveFacility } from "@/data-access/facilities";
import { recordOutputStockMovementInTransaction } from "@/data-access/output-stock-post";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";

const WAIT_MS = 5000;
const POLL_MS = 10;
const organizations: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const id of organizations.splice(0)) { await db.delete(apiAuditEvents).where(eq(apiAuditEvents.organizationId, id)); await db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, id)); await cleanupCertifiedOutputLineage(id); await cleanupOutputStockFixture(db, id); } });
async function fixture() { const f = await createDeliveryFixture(); organizations.push(f.ctx.organizationId); return f; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
/** Hold the first transaction just before COMMIT; prove the second waits on its connection. */
async function race<A, B>(first: () => Promise<A>, second: () => Promise<B>) {
  const entered = deferred<number>();
  const release = deferred<void>();
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementationOnce((work, config) => transaction(async tx => {
    const result = await work(tx);
    const { rows } = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    entered.resolve(rows[0].pid);
    await release.promise;
    return result;
  }, config));
  const a = first().then(value => ({ value }), error => { entered.reject(error); return { error }; });
  let b: Promise<{ value: B } | { error: unknown }> | undefined;
  try {
    const pid = await entered.promise;
    b = second().then(value => ({ value }), error => ({ error }));
    await expect.poll(async () => {
      const { rows } = await db.execute<{ count: number }>(sql`select count(*)::int as count from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`);
      return rows[0].count;
    }, { timeout: WAIT_MS, interval: POLL_MS }).toBeGreaterThan(0);
  } finally { release.resolve(); }
  return [await a, await b!] as const;
}

describe("delivery create races on separate connections", { timeout: 15000 }, () => {
  it("serializes duplicate keys into one delivery and movement", async () => {
    const f = await fixture();
    const write = () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    const [a, b] = await race(write, write);
    expect(a).toHaveProperty("value"); expect(b).toHaveProperty("value");
    if ("value" in a && "value" in b) expect(a.value.delivery.id).toBe(b.value.delivery.id);
    expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toHaveLength(1);
    const movements = await db.select().from(binMovements).where(eq(binMovements.idempotencyKey, f.input.idempotencyKey));
    expect(movements).toHaveLength(1);
  });
  it("two creates cannot exceed one order's wet quantity", async () => {
    const f = await fixture();
    const [a, b] = await race(
      () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input)),
      () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, idempotencyKey: randomUUID() })),
    );
    expect(a).toHaveProperty("value"); expect(b).toMatchObject({ error: { code: "conflict" } });
  });
  it("two creates cannot overdraw one bin", async () => {
    const f = await fixture();
    await db.update(orders).set({ quantityKg: 3000 }).where(eq(orders.id, f.order.id));
    const write = () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, deliveredWetMassKg: 700, idempotencyKey: randomUUID() }));
    const [a, b] = await race(write, write);
    expect(a).toHaveProperty("value"); expect(b).toMatchObject({ error: { code: "insufficient_stock" } });
  });
  it.each([
    ["loss", false], ["loss", true], ["count", false], ["count", true],
  ] as const)("replans concurrent %s, delivery first: %s", async (kind, deliveryFirst) => {
    const f = await fixture();
    const command = () => withOutputStockErrors(() => db.transaction(tx => recordOutputStockMovementInTransaction(f.ctx, tx, {
      storageLocationId: f.bin.id, facilityId: f.facility.id, kind, occurredAt: f.input.deliveredAt,
      wetMassKg: kind === "count" ? 0 : 1000, moisturePercent: 20, reason: "E2E emptied bin", idempotencyKey: randomUUID(),
    })));
    const delivery = () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    const [a, b] = deliveryFirst ? await race(delivery, command) : await race(command, delivery);
    expect(a).toHaveProperty("value");
    if (deliveryFirst && kind === "count") expect(b).toHaveProperty("value");
    else expect(b).toMatchObject({ error: { code: "insufficient_stock" } });
    expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toHaveLength(deliveryFirst ? 1 : 0);
    const stock = (await getOutputBinStocks(f.ctx, [f.bin.id])).get(f.bin.id)!;
    expect(stock.availableDryKg).toBe(deliveryFirst && kind === "loss" ? 648 : 0);
    expect(stock.estimatedWetMassKg).toBe(deliveryFirst && kind === "loss" ? 900 : 0);
  });
  it.each([true, false])("serializes order quantity PATCH, delivery first: %s", async deliveryFirst => {
    const f = await fixture();
    const delivery = () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    const patch = () => db.transaction(tx => updateOrderInTransaction(f.ctx, tx, { orderId: f.order.id, expectedVersion: f.order.version, quantityKg: 50 }));
    const [a, b] = deliveryFirst ? await race(delivery, patch) : await race(patch, delivery);
    expect(a).toHaveProperty("value"); expect(b).toHaveProperty("error");
  });
  it.each([true, false])("serializes facility archive, delivery first: %s", async deliveryFirst => {
    const f = await fixture();
    const delivery = () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    const archive = () => archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const [a, b] = deliveryFirst ? await race(delivery, archive) : await race(archive, delivery);
    expect(a).toHaveProperty("value");
    if (deliveryFirst) expect(b).toHaveProperty("value");
    else expect(b).toMatchObject({ error: { code: "not_found", issues: [{ path: ["orderId"] }] } });
  });
  it("returns 404 at the source bin when archive commits while create waits", async () => {
    const f = await createApiDeliveryWriteFixture();
    try {
      await db.transaction(tx => recordOutputStockMovementInTransaction(f.ctx, tx, {
        storageLocationId: f.bin.id, facilityId: f.facility.id, kind: "count", occurredAt: DELIVERY_AT,
        wetMassKg: 0, moisturePercent: 20, reason: "E2E empty before archive", idempotencyKey: randomUUID(),
      }));
      const [bin] = await db.select().from(storageLocations).where(eq(storageLocations.id, f.bin.id));
      const [archive, create] = await race(
        () => archiveStorageLocation(f.ctx, f.bin.id, bin.version),
        () => postDelivery(f),
      );
      expect(archive).toHaveProperty("value");
      expect(create).toHaveProperty("value");
      if ("value" in create) await deliveryProblem(create.value, 404, "not_found", "/storageLocationId");
      expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toHaveLength(0);
    } finally { await removeApiDeliveryWriteFixture(f); }
  });
  it.each([true, false])("serializes delivery update and archive, update first: %s", async updateFirst => {
    const f = await fixture();
    const saved = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    const update = () => db.transaction(tx => updateDeliveryInTransaction(f.ctx, tx, saved.delivery.id, { expectedVersion: saved.delivery.version, distanceNote: "Updated" }));
    const archive = () => archiveFacility(f.ctx, f.facility.id, f.facility.version);
    const [a, b] = updateFirst ? await race(update, archive) : await race(archive, update);
    expect(a).toHaveProperty("value");
    if (updateFirst) expect(b).toHaveProperty("value");
    else expect(b).toMatchObject({ error: { code: "not_found" } });
  });
});

describe("delivery placement and lineage races", { timeout: 15000 }, () => {
  it.each([true, false])("serializes product placement, delivery first: %s", async deliveryFirst => {
    const f = await fixture();
    const delivery = () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    const placement = () => createBiocharProduct(f.ctx, {
      code: `E2E-P2-${f.tag}`, facilityId: f.facility.id, formulationId: f.recipe.id,
      placedAt: "2026-09-13T12:00:00Z", sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      massKg: 500, moistureContentPercent: 10, waterAddedKg: 0, idempotencyKey: randomUUID(),
      composition: { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: 100, moistureContentPercent: 60 }] },
    });
    if (deliveryFirst) {
      const [a, b] = await race(delivery, placement);
      expect(a).toHaveProperty("value"); expect(b).toHaveProperty("value");
      if ("value" in a) expect(a.value.allocations).toHaveLength(1);
    } else {
      const [a, b] = await race(placement, delivery);
      expect(a).toHaveProperty("value"); expect(b).toHaveProperty("value");
      if ("value" in b) expect(b.value.allocations).toHaveLength(2);
    }
  });
  it("refuses an artifact assigned while waiting for the order row", async () => {
    const f = await fixture();
    await certifyOutputLineage(f, { runId: f.runs[0].id, productId: f.product.id, submitted: false });
    const [existing] = await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId));
    await db.update(orders).set({ formulationId: f.recipe.id, quantityKg: 2000 }).where(eq(orders.id, existing.orderId));
    const [slice] = await db.select().from(creditBatchApplications).where(eq(creditBatchApplications.organizationId, f.ctx.organizationId));
    await db.update(creditBatchApplications).set({ removalId: null }).where(eq(creditBatchApplications.id, slice.id));
    const [a, b] = await race(
      () => db.transaction(async tx => {
        await tx.select().from(orders).where(eq(orders.id, existing.orderId)).for("update");
        await tx.update(creditBatchApplications).set({ removalId: slice.removalId }).where(eq(creditBatchApplications.id, slice.id));
      }),
      () => db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, { ...f.input, orderId: existing.orderId })),
    );
    expect(a).toHaveProperty("value");
    expect(b).toMatchObject({ error: { code: "certification_locked", issues: [{ path: ["orderId"] }] } });
    expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toHaveLength(1);
  });
});

it("parallel API keys through a test-only runner operation create one audit row", async () => {
  const f = await fixture();
  const inputSchema = recordDeliveryInput.safeExtend({ idempotencyKey: z.string() });
  const operation: Operation<typeof inputSchema, { delivery: Delivery }> = {
    id: "test_delivery_transaction", input: inputSchema, supportsDryRun: true,
    execute: async (scope, input) => {
      const result = await createDeliveryInTransaction(scope.ctx, scope.tx, input, { snapshotStock: scope.snapshotStock });
      // The app cache rows carry native bigint posting sequences. An API
      // operation returns the delivery representation, not those cache rows.
      const delivery = { ...result.delivery, savedProducts: undefined };
      return { ...result, delivery };
    },
    describe: (_input, result) => ({ outcome: "created", entityType: "delivery", entityIds: [result.delivery.id], versionBefore: null, versionAfter: result.delivery.version, changedFields: [] }),
  };
  const preview = await runOperation(operation, f.ctx, f.input, { dryRun: true });
  expect(preview.stockEffects).toMatchObject([{ storageLocationId: f.bin.id, stockKind: "product_bin", delta: { wetKg: null, dryKg: -72 } }]);
  expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toEqual([]);
  const credentialId = `delivery-key-${f.tag}`;
  const options = { idempotency: { credentialId, key: randomUUID() }, audit: { credentialId, transport: "rest" as const, requestId: randomUUID() } };
  const results = await Promise.allSettled([runOperation(operation, f.ctx, f.input, options), runOperation(operation, f.ctx, f.input, options)]);
  expect(results).toContainEqual(expect.objectContaining({ status: "fulfilled" }));
  const replay = await runOperation(operation, f.ctx, f.input, options);
  expect(replay.replayed).toBe(true);
  expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId))).toHaveLength(1);
  expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toHaveLength(1);
  expect(await db.select().from(binMovements).where(eq(binMovements.idempotencyKey, f.input.idempotencyKey))).toHaveLength(1);
});
