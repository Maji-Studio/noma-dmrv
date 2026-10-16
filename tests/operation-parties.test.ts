import { actionFailureResponse } from "@/lib/api/problem";
import { toActionFailure } from "@/fn/action-errors";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, facilities, suppliers, customers } from "@/db/schema";
import { operationRegistry } from "@/lib/operations/registry";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { createSupplier } from "@/lib/operations/suppliers";
import { createCustomer } from "@/lib/operations/customers";
import { supplierRepresentationSchema } from "@/lib/representations/suppliers";
import { customerRepresentationSchema } from "@/lib/representations/customers";
import { supplierLocationRepresentationSchema } from "@/lib/representations/supplier-locations";
import { customerLocationRepresentationSchema } from "@/lib/representations/customer-locations";
import { readApiSupplier } from "@/lib/read-models/api-suppliers";
import { readApiCustomer } from "@/lib/read-models/api-customers";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, type PartyArchiveFixture } from "./helpers/party-archive-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";

const TIMEOUT_MS = 30_000;
const SINGLE_CONNECTION = 1;
const CONCURRENT_CONNECTIONS = 2;
const fixtures: PartyArchiveFixture[] = [];
const pool = createTestPool(CONCURRENT_CONNECTIONS);
const barrierPool = createTestPool(CONCURRENT_CONNECTIONS);
beforeAll(() => { expect(db.$client.options.max).toBe(SINGLE_CONNECTION); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f); });
afterAll(async () => { await pool.end(); await barrierPool.end(); });
async function fixture() { const f = await createPartyArchiveFixture(); fixtures.push(f); return f; }
const input = { name: "Operation party", locations: [{ name: "Source", country: "TZ", stateRegion: "Region", city: "City", gpsLatitude: -8, gpsLongitude: 34 }] };
const keyOptions = () => ({ idempotency: { credentialId: "party-test", key: crypto.randomUUID() } });
function stable(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value), (key, item) => ["id", "supplierId", "customerId", "createdAt", "updatedAt"].includes(key) ? undefined : key === "archivedAt" ? item !== null : item);
}

describe("registered supplier operations", { timeout: TIMEOUT_MS }, () => {
  const create = operationRegistry.create_supplier;
  const update = operationRegistry.update_supplier;
  const archive = operationRegistry.archive_supplier;
  const restore = operationRegistry.restore_supplier;
  const remove = operationRegistry.delete_supplier;
  it.each(["json", "in-process"] as const)("returns JSON safe envelopes through %s and void for delete", async mode => {
    const f = await fixture();
    const made = mode === "json" ? (await runOperation(create, f.ctx, input)).data : await runOperationInProcess(create, f.ctx, input);
    expect(Object.keys(made)).toEqual(["supplier", "locations"]);
    expect(supplierRepresentationSchema.parse(made.supplier)).toEqual(made.supplier);
    expect(made.locations).toHaveLength(1);
    expect(supplierLocationRepresentationSchema.parse(made.locations[0])).toEqual(made.locations[0]);
    expect(made.locations[0]).toMatchObject({ id: expect.any(String), version: 1, country: "TZ", stateRegion: "Region", city: "City", isDefault: true });
    expect(JSON.parse(JSON.stringify(made))).toEqual(made);
    const first = made.supplier;
    const commands = [
      { operation: update, body: { supplierId: first.id, expectedVersion: 1, name: "Updated" } },
      { operation: archive, body: { supplierId: first.id, expectedVersion: 2 } },
      { operation: restore, body: { supplierId: first.id, expectedVersion: 3 } },
    ];
    for (const command of commands) {
      const before = await readApiSupplier(f.ctx, { id: first.id });
      const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
      const preview = await runOperation(command.operation, f.ctx, command.body, { dryRun: true });
      expect(await readApiSupplier(f.ctx, { id: first.id })).toEqual(before);
      expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id))).toEqual(events);
      const committed = mode === "json" ? (await runOperation(command.operation, f.ctx, command.body)).data : await runOperationInProcess(command.operation, f.ctx, command.body);
      expect(Object.keys(committed)).toEqual(["supplier"]);
      expect(stable(preview.data)).toEqual(stable(committed));
      expect(supplierRepresentationSchema.parse(committed.supplier)).toEqual(committed.supplier);
      expect(JSON.parse(JSON.stringify(committed))).toEqual(committed);
    }
    const body = { supplierId: first.id, expectedVersion: 4 };
    expect((await runOperation(remove, f.ctx, body, { dryRun: true })).data).toBeNull();
    expect(await readApiSupplier(f.ctx, { id: first.id })).toMatchObject({ version: 4 });
    if (mode === "json") expect((await runOperation(remove, f.ctx, body)).data).toBeNull();
    else expect(await runOperationInProcess(remove, f.ctx, body)).toBeUndefined();
    await expect(readApiSupplier(f.ctx, { id: first.id })).rejects.toMatchObject({ code: "not_found" });
  });
  it("previews without claiming keys and replays reordered bodies byte identically", async () => {
    const f = await fixture(); const options = keyOptions();
    const preview = await runOperation(create, f.ctx, input, { ...options, dryRun: true });
    await expect(readApiSupplier(f.ctx, { id: preview.data.supplier.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toEqual([]);
    const committed = await runOperation(create, f.ctx, input, options);
    expect(stable(preview.data)).toEqual(stable(committed.data));
    const reordered = { locations: [{ gpsLongitude: 34, city: "City", country: "TZ", name: "Source", gpsLatitude: -8, stateRegion: "Region" }], name: input.name };
    const replay = await runOperation(create, f.ctx, reordered, options);
    expect(replay.replayed).toBe(true);
    expect(committed.effect?.changedFields).toEqual(["code", "name"]);
    expect(preview.effect?.changedFields).toEqual(committed.effect?.changedFields);
    expect(replay.effect).toEqual(committed.effect);
    const parsed = { supplier: supplierRepresentationSchema.parse(replay.data.supplier), locations: replay.data.locations.map(row => supplierLocationRepresentationSchema.parse(row)) };
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(committed.data));
    await expect(runOperation(create, f.ctx, { ...input, name: "Other" }, options)).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(runOperation(create, f.ctx, input, { ...options, dryRun: true })).rejects.toMatchObject({ code: "key_already_used" });
  });
  it("refuses contacts and nested unknown fields while full app operations save contacts", async () => {
    const f = await fixture();
    for (const body of [{ ...input, contactEmail: "private@example.test" }, { ...input, locations: [{ ...input.locations[0], address: "Private" }] }, { ...input, locations: [{ ...input.locations[0], facilityDistances: [{ facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual", unknown: true }] }] }]) {
      const failure = await runOperation(create, f.ctx, body).then(() => { throw new Error("Expected refusal"); }, error => error);
      expect(failure).toMatchObject({ code: "validation_failed" });
      const response = actionFailureResponse(toActionFailure(failure, { fallbackMessage: "Refused", log: { message: "Party operation failed" } }), "/test", crypto.randomUUID());
      expect(response.status).toBe(422);
      expect((await response.json()).errors).toMatchObject([{ pointer: "contactEmail" in body ? "" : "facilityDistances" in body.locations[0] ? "/locations/0/facilityDistances/0" : "/locations/0", code: "unrecognized_keys" }]);
    }
    const full = await runOperationInProcess(createSupplier, f.ctx, { ...input, contactEmail: "private@example.test", contactPhone: "Private" });
    expect(full.supplier).toMatchObject({ contactEmail: "private@example.test", contactPhone: "Private" });
    const published = await readApiSupplier(f.ctx, { id: full.supplier.id });
    expect(published).not.toHaveProperty("contactEmail");
    expect(published).not.toHaveProperty("contactPhone");
  });
  it("parallel duplicate keys produce one party and one Activity set on separate connections", async () => {
    const f = await fixture(); const options = { ...keyOptions(), pool };
    vi.resetModules();
    const otherRunner = await import("@/lib/operations/runner");
    const barrier = await openOperationBarrier(barrierPool);
    const body = { ...input, locations: [{ ...input.locations[0], facilityDistances: [{ facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual" as const }] }] };
    const settle = <T>(promise: Promise<T>) => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    let first: ReturnType<typeof settle> | undefined;
    let second: ReturnType<typeof settle> | undefined;
    try {
      await barrier.tx.select().from(facilities).where(and(eq(facilities.organizationId, f.ctx.organizationId), eq(facilities.id, f.facility.id))).for("update");
      first = settle(runOperation(create, f.ctx, body, options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      second = settle(otherRunner.runOperation(create, f.ctx, body, options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 2);
      expect(await second).toMatchObject({ ok: false, error: { code: "idempotency_in_progress" } });
      await barrier.commit();
    } catch (error) {
      await barrier.rollback(); await Promise.allSettled([first, second]); throw error;
    }
    expect(await first).toMatchObject({ ok: true });
    const replay = await runOperation(create, f.ctx, body, options);
    expect(replay.replayed).toBe(true);
    expect(await db.select().from(suppliers).where(and(eq(suppliers.organizationId, f.ctx.organizationId), eq(suppliers.name, input.name)))).toHaveLength(1);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    expect(events).toHaveLength(2);
    expect(events.map(event => event.entityId).sort()).toEqual([replay.data.supplier.id, replay.data.locations[0].id].sort());
  });
});

describe("registered customer operations", { timeout: TIMEOUT_MS }, () => {
  const create = operationRegistry.create_customer;
  const update = operationRegistry.update_customer;
  const archive = operationRegistry.archive_customer;
  const restore = operationRegistry.restore_customer;
  const remove = operationRegistry.delete_customer;
  it.each(["json", "in-process"] as const)("returns JSON safe envelopes through %s and void for delete", async mode => {
    const f = await fixture();
    const made = mode === "json" ? (await runOperation(create, f.ctx, input)).data : await runOperationInProcess(create, f.ctx, input);
    expect(Object.keys(made)).toEqual(["customer", "locations"]);
    expect(customerRepresentationSchema.parse(made.customer)).toEqual(made.customer);
    expect(made.locations).toHaveLength(1);
    expect(customerLocationRepresentationSchema.parse(made.locations[0])).toEqual(made.locations[0]);
    expect(made.locations[0]).toMatchObject({ id: expect.any(String), version: 1, country: "TZ", stateRegion: "Region", city: "City", isDefault: true });
    expect(JSON.parse(JSON.stringify(made))).toEqual(made);
    const first = made.customer;
    const commands = [
      { operation: update, body: { customerId: first.id, expectedVersion: 1, name: "Updated" } },
      { operation: archive, body: { customerId: first.id, expectedVersion: 2 } },
      { operation: restore, body: { customerId: first.id, expectedVersion: 3 } },
    ];
    for (const command of commands) {
      const before = await readApiCustomer(f.ctx, { id: first.id });
      const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
      const preview = await runOperation(command.operation, f.ctx, command.body, { dryRun: true });
      expect(await readApiCustomer(f.ctx, { id: first.id })).toEqual(before);
      expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id))).toEqual(events);
      const committed = mode === "json" ? (await runOperation(command.operation, f.ctx, command.body)).data : await runOperationInProcess(command.operation, f.ctx, command.body);
      expect(Object.keys(committed)).toEqual(["customer"]);
      expect(stable(preview.data)).toEqual(stable(committed));
      expect(customerRepresentationSchema.parse(committed.customer)).toEqual(committed.customer);
      expect(JSON.parse(JSON.stringify(committed))).toEqual(committed);
    }
    const body = { customerId: first.id, expectedVersion: 4 };
    expect((await runOperation(remove, f.ctx, body, { dryRun: true })).data).toBeNull();
    expect(await readApiCustomer(f.ctx, { id: first.id })).toMatchObject({ version: 4 });
    if (mode === "json") expect((await runOperation(remove, f.ctx, body)).data).toBeNull();
    else expect(await runOperationInProcess(remove, f.ctx, body)).toBeUndefined();
    await expect(readApiCustomer(f.ctx, { id: first.id })).rejects.toMatchObject({ code: "not_found" });
  });
  it("previews without claiming keys and replays reordered bodies byte identically", async () => {
    const f = await fixture(); const options = keyOptions();
    const preview = await runOperation(create, f.ctx, input, { ...options, dryRun: true });
    await expect(readApiCustomer(f.ctx, { id: preview.data.customer.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toEqual([]);
    const committed = await runOperation(create, f.ctx, input, options);
    expect(stable(preview.data)).toEqual(stable(committed.data));
    const reordered = { locations: [{ gpsLongitude: 34, city: "City", country: "TZ", name: "Source", gpsLatitude: -8, stateRegion: "Region" }], name: input.name };
    const replay = await runOperation(create, f.ctx, reordered, options);
    expect(replay.replayed).toBe(true);
    expect(committed.effect?.changedFields).toEqual(["code", "name"]);
    expect(preview.effect?.changedFields).toEqual(committed.effect?.changedFields);
    expect(replay.effect).toEqual(committed.effect);
    const parsed = { customer: customerRepresentationSchema.parse(replay.data.customer), locations: replay.data.locations.map(row => customerLocationRepresentationSchema.parse(row)) };
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(committed.data));
    await expect(runOperation(create, f.ctx, { ...input, name: "Other" }, options)).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(runOperation(create, f.ctx, input, { ...options, dryRun: true })).rejects.toMatchObject({ code: "key_already_used" });
  });
  it("refuses contacts and nested unknown fields while full app operations save contacts", async () => {
    const f = await fixture();
    for (const body of [{ ...input, contactEmail: "private@example.test" }, { ...input, locations: [{ ...input.locations[0], address: "Private" }] }, { ...input, locations: [{ ...input.locations[0], facilityDistances: [{ facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual", unknown: true }] }] }]) {
      const failure = await runOperation(create, f.ctx, body).then(() => { throw new Error("Expected refusal"); }, error => error);
      expect(failure).toMatchObject({ code: "validation_failed" });
      const response = actionFailureResponse(toActionFailure(failure, { fallbackMessage: "Refused", log: { message: "Party operation failed" } }), "/test", crypto.randomUUID());
      expect(response.status).toBe(422);
      expect((await response.json()).errors).toMatchObject([{ pointer: "contactEmail" in body ? "" : "facilityDistances" in body.locations[0] ? "/locations/0/facilityDistances/0" : "/locations/0", code: "unrecognized_keys" }]);
    }
    const full = await runOperationInProcess(createCustomer, f.ctx, { ...input, contactEmail: "private@example.test", contactPhone: "Private" });
    expect(full.customer).toMatchObject({ contactEmail: "private@example.test", contactPhone: "Private" });
    const published = await readApiCustomer(f.ctx, { id: full.customer.id });
    expect(published).not.toHaveProperty("contactEmail");
    expect(published).not.toHaveProperty("contactPhone");
  });
  it("parallel duplicate keys produce one party and one Activity set on separate connections", async () => {
    const f = await fixture(); const options = { ...keyOptions(), pool };
    vi.resetModules();
    const otherRunner = await import("@/lib/operations/runner");
    const barrier = await openOperationBarrier(barrierPool);
    const body = { ...input, locations: [{ ...input.locations[0], facilityDistances: [{ facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual" as const }] }] };
    const settle = <T>(promise: Promise<T>) => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    let first: ReturnType<typeof settle> | undefined;
    let second: ReturnType<typeof settle> | undefined;
    try {
      await barrier.tx.select().from(facilities).where(and(eq(facilities.organizationId, f.ctx.organizationId), eq(facilities.id, f.facility.id))).for("update");
      first = settle(runOperation(create, f.ctx, body, options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      second = settle(otherRunner.runOperation(create, f.ctx, body, options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 2);
      expect(await second).toMatchObject({ ok: false, error: { code: "idempotency_in_progress" } });
      await barrier.commit();
    } catch (error) {
      await barrier.rollback(); await Promise.allSettled([first, second]); throw error;
    }
    expect(await first).toMatchObject({ ok: true });
    const replay = await runOperation(create, f.ctx, body, options);
    expect(replay.replayed).toBe(true);
    expect(await db.select().from(customers).where(and(eq(customers.organizationId, f.ctx.organizationId), eq(customers.name, input.name)))).toHaveLength(1);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    expect(events).toHaveLength(2);
    expect(events.map(event => event.entityId).sort()).toEqual([replay.data.customer.id, replay.data.locations[0].id].sort());
  });
});
