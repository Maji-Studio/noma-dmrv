import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });

import { eq } from "drizzle-orm";
import { db, withDedicatedSessionAdvisoryLock } from "@/db";
import { activityEvents, customers, customerLocations, orders, supplierLocations } from "@/db/schema";
import { certifierStorageSiteLockKey } from "@/lib/certification/certifier-storage-site-lock";
import {
  addCustomerLocation, updateCustomerLocation, archiveCustomerLocation,
  restoreCustomerLocation, deleteCustomerLocation,
} from "@/lib/operations/customer-locations";
import { deleteCustomer } from "@/lib/operations/customers";
import { recordOrder } from "@/lib/operations/orders";
import { runOperation } from "@/lib/operations/runner";
import { addSupplierLocation, updateSupplierLocation, deleteSupplierLocation } from "@/lib/operations/supplier-locations";
import { createOrderDestination, orderInput } from "./helpers/order-operation-fixture";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, type PartyArchiveFixture } from "./helpers/party-archive-fixture";
import { TEST_SITE_POSITION } from "./helpers/test-org";

const SUITE_TIMEOUT_MS = 60_000;
const NO_SELF_WAIT_MS = 5_000;
const DISTANCE_KM = 12;
const UPDATED_DISTANCE_KM = 25;
const fixtures: PartyArchiveFixture[] = [];
const version = (row: { id: string; version: number }) => ({ locationId: row.id, expectedVersion: row.version });
async function fixture() {
  const f = await createPartyArchiveFixture();
  fixtures.push(f);
  return f;
}

beforeEach(() => { expect(db.$client.options.max).toBe(1); });
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f);
});

describe("party location writes with one pooled connection", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("previews, adds, updates and deletes a supplier location without self-waiting", async () => {
    const f = await fixture();
    const pair = { facilityId: f.facility.id, distanceKm: DISTANCE_KM, distanceSource: "manual" };
    const input = { ...TEST_SITE_POSITION, supplierId: f.supplier.id, name: "E2E Supplier site", facilityDistances: [pair] };
    const rows = () => db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, f.supplier.id));
    const started = Date.now();
    const preview = await runOperation(addSupplierLocation, f.ctx, input, { dryRun: true });
    expect(preview).toMatchObject({ dryRun: true, data: { version: 1, isDefault: true } });
    expect(await rows()).toEqual([]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, preview.data.id))).toEqual([]);
    const created = (await runOperation(addSupplierLocation, f.ctx, input)).data;
    expect(created).toMatchObject({ version: 1, isDefault: true, facilityDistances: [pair] });
    const updated = (await runOperation(updateSupplierLocation, f.ctx, {
      ...version(created), name: "E2E Updated supplier site", facilityDistances: [{ ...pair, distanceKm: UPDATED_DISTANCE_KM }],
    })).data;
    expect(updated).toMatchObject({ version: 2, isDefault: true, name: "E2E Updated supplier site",
      facilityDistances: [{ ...pair, distanceKm: UPDATED_DISTANCE_KM }] });
    expect((await runOperation(deleteSupplierLocation, f.ctx, version(updated))).data.id).toBe(created.id);
    expect(await rows()).toEqual([]);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });

  it("adds, updates, archives, restores and deletes a customer location without self-waiting", async () => {
    const f = await fixture();
    const pair = { facilityId: f.facility.id, distanceKm: DISTANCE_KM, distanceSource: "manual" };
    const rows = () => db.select().from(customerLocations).where(eq(customerLocations.customerId, f.customer.id));
    const started = Date.now();
    const created = (await runOperation(addCustomerLocation, f.ctx, {
      ...TEST_SITE_POSITION, customerId: f.customer.id, name: "E2E Customer site", isDefault: true, facilityDistances: [pair],
    })).data;
    expect(created).toMatchObject({ version: 1, isDefault: true, facilityDistances: [pair] });
    const updated = (await runOperation(updateCustomerLocation, f.ctx, {
      ...version(created), name: "E2E Updated customer site", facilityDistances: [{ ...pair, distanceKm: UPDATED_DISTANCE_KM }],
    })).data;
    expect(updated).toMatchObject({ version: 2, isDefault: true, name: "E2E Updated customer site",
      facilityDistances: [{ ...pair, distanceKm: UPDATED_DISTANCE_KM }] });
    const archived = (await runOperation(archiveCustomerLocation, f.ctx, version(updated))).data;
    expect(archived).toMatchObject({ version: 3, isDefault: false, archivedAt: expect.any(String) });
    expect((await rows()).find(row => row.id === f.location.id)).toMatchObject({ isDefault: true });
    const restored = (await runOperation(restoreCustomerLocation, f.ctx, version(archived))).data;
    expect(restored).toMatchObject({ version: 4, isDefault: false, archivedAt: null });
    expect((await runOperation(deleteCustomerLocation, f.ctx, version(restored))).data.id).toBe(created.id);
    expect(await rows()).toMatchObject([{ id: f.location.id, isDefault: true }]);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });

  it("previews and commits the customer cascade for an order without deliveries without self-waiting", async () => {
    const f = await fixture();
    const destination = await createOrderDestination(f);
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f, { customerLocationId: destination.id }))).data;
    const input = { customerId: f.customer.id, expectedVersion: f.customer.version };
    const customerRows = () => db.select().from(customers).where(eq(customers.id, f.customer.id));
    const orderRows = () => db.select().from(orders).where(eq(orders.customerId, f.customer.id));
    const locationRows = () => db.select().from(customerLocations).where(eq(customerLocations.customerId, f.customer.id));
    const started = Date.now();
    const preview = await runOperation(deleteCustomer, f.ctx, input, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.data.cascade.orders).toEqual([{ id: order.id, code: order.code }]);
    expect(preview.data.cascade.cascadeFingerprint).toMatch(/^v1:/);
    expect(await customerRows()).toMatchObject([{ id: f.customer.id, version: f.customer.version }]);
    expect(await orderRows()).toMatchObject([{ id: order.id, version: order.version }]);
    expect(await locationRows()).toHaveLength(2);
    const deleted = await runOperation(deleteCustomer, f.ctx, {
      ...input, cascadeFingerprint: preview.data.cascade.cascadeFingerprint,
    });
    expect(deleted.data).toEqual(preview.data);
    expect(await customerRows()).toEqual([]);
    expect(await orderRows()).toEqual([]);
    expect(await locationRows()).toEqual([]);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });

  it("refuses update and delete retryably at the registration fence and keeps the pool usable", async () => {
    const f = await fixture();
    const input = version(f.location);
    const busy = { code: "conflict", retryable: true, issues: [{ path: ["locationId"] }],
      message: "This location is being registered with Isometric. Try again in a moment." };
    // The helper releases the dedicated client's exclusive session fence in finally.
    await withDedicatedSessionAdvisoryLock(certifierStorageSiteLockKey(f.ctx.organizationId, f.location.id), async () => {
      const updateStarted = Date.now();
      await expect(runOperation(updateCustomerLocation, f.ctx, { ...input, name: "E2E Fenced edit" })).rejects.toMatchObject(busy);
      expect(Date.now() - updateStarted).toBeLessThan(NO_SELF_WAIT_MS);
      const deleteStarted = Date.now();
      await expect(runOperation(deleteCustomerLocation, f.ctx, input)).rejects.toMatchObject(busy);
      expect(Date.now() - deleteStarted).toBeLessThan(NO_SELF_WAIT_MS);
      expect(await db.select().from(customerLocations).where(eq(customerLocations.id, f.location.id)))
        .toMatchObject([{ id: f.location.id, name: f.location.name, version: f.location.version }]);
    });
    const started = Date.now();
    const updated = (await runOperation(updateCustomerLocation, f.ctx, { ...input, name: "E2E After fence" })).data;
    expect(updated).toMatchObject({ version: f.location.version + 1, name: "E2E After fence" });
    expect((await runOperation(deleteCustomerLocation, f.ctx, version(updated))).data.id).toBe(f.location.id);
    expect(await db.select().from(customerLocations).where(eq(customerLocations.id, f.location.id))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });
});
