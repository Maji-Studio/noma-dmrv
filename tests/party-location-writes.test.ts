import { recordOrder } from "@/lib/operations/orders";
import { orderInput } from "./helpers/order-operation-fixture";
import { orders } from "@/db/schema";
import { addCustomerLocation, updateCustomerLocation, deleteCustomerLocation } from "@/lib/operations/customer-locations";
import { archiveCustomer } from "@/lib/operations/customers";
import { getCustomerLocations } from "@/data-access/customers";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { activityEvents, suppliers, supplierLocations, customers, customerLocations } from "@/db/schema";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { addSupplierLocation, updateSupplierLocation, deleteSupplierLocation } from "@/lib/operations/supplier-locations";
import { archiveSupplier } from "@/lib/operations/suppliers";
import { getSupplierLocationsBySupplier } from "@/data-access/suppliers";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, type PartyArchiveFixture } from "./helpers/party-archive-fixture";

const fixtures: PartyArchiveFixture[] = [];
const site = { country: "TZ", gpsLatitude: -8, gpsLongitude: 34 };
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f); });
async function fixture() {
  const f = await createPartyArchiveFixture(); fixtures.push(f);
  const [parent] = await db.insert(suppliers).values({ organizationId: f.ctx.organizationId, code: `LOC-${crypto.randomUUID()}`, name: "Location writer" }).returning();
  return { ...f, parent };
}
const version = (row: { id: string; version: number }, supplierId?: string) => ({ locationId: row.id, expectedVersion: row.version, supplierId });

describe("supplier location operations", () => {
  it("adds a first default, leaves it on ordinary add, and demotes it on explicit add", async () => {
    const f = await fixture();
    const first = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const second = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const third = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id, isDefault: true });
    expect([first.isDefault, second.isDefault, third.isDefault]).toEqual([true, false, true]);
    const rows = await getSupplierLocationsBySupplier(f.ctx, f.parent.id);
    expect(rows.find(row => row.id === first.id)).toMatchObject({ isDefault: false, version: 2 });
    expect(rows.find(row => row.id === second.id)).toMatchObject({ isDefault: false, version: 1 });
    expect((await db.select().from(suppliers).where(eq(suppliers.id, f.parent.id)))[0].version).toBe(1);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
    expect(events).toMatchObject([{ action: "created", operationId: "add_supplier_location" }]);
  });
  it("keeps omitted fields, clears nulls, coerces the default checkbox and upserts or removes pairs", async () => {
    const f = await fixture();
    const pair = { facilityId: f.facility.id, distanceKm: 12, distanceSource: "manual" };
    const first = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id, name: "Source", city: "Town", stateRegion: "Region", address: "Gate", facilityDistances: [pair] });
    const kept = await runOperationInProcess(updateSupplierLocation, f.ctx, { ...version(first, f.parent.id), isDefault: false });
    expect(kept).toMatchObject({ name: "Source", city: "Town", stateRegion: "Region", address: "Gate", isDefault: true, version: 2, facilityDistances: [pair] });
    const changed = await runOperationInProcess(updateSupplierLocation, f.ctx, { ...version(kept), name: null, city: null, stateRegion: null, address: null, facilityDistances: [{ ...pair, distanceKm: 25 }] });
    expect(changed).toMatchObject({ name: null, city: null, stateRegion: null, address: null, facilityDistances: [{ ...pair, distanceKm: 25 }] });
    const cleared = await runOperationInProcess(updateSupplierLocation, f.ctx, { ...version(changed), facilityDistances: [{ ...pair, distanceKm: null }] });
    expect(cleared.facilityDistances).toEqual([]);
  });
  it("promotes on PATCH and bumps the demoted sibling", async () => {
    const f = await fixture();
    const first = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const second = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    expect(await runOperationInProcess(updateSupplierLocation, f.ctx, { ...version(second), isDefault: true })).toMatchObject({ isDefault: true, version: 2 });
    expect((await getSupplierLocationsBySupplier(f.ctx, f.parent.id)).find(row => row.id === first.id)).toMatchObject({ isDefault: false, version: 2 });
  });
  it("deletes the default and promotes the next location in list order with a version bump", async () => {
    const f = await fixture();
    const first = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const second = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const removed = await runOperationInProcess(deleteSupplierLocation, f.ctx, version(first));
    expect(removed.id).toBe(first.id);
    expect(await getSupplierLocationsBySupplier(f.ctx, f.parent.id)).toMatchObject([{ id: second.id, isDefault: true, version: 2 }]);
  });
  it("refuses add, update and delete under an archived parent before stale versions", async () => {
    const f = await fixture();
    const row = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    await runOperationInProcess(archiveSupplier, f.ctx, { supplierId: f.parent.id, expectedVersion: 1 });
    const referenceMessage = `Supplier ${f.parent.code} is archived. Restore it or choose another supplier.`;
    const issue = (message: string) => ({ code: "not_found", message, issues: [{ path: ["supplierId"] }] });
    await expect(runOperation(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id })).rejects.toMatchObject(issue(referenceMessage));
    await expect(runOperation(updateSupplierLocation, f.ctx, { ...version(row), expectedVersion: 99, name: "Changed" })).rejects.toMatchObject(issue(referenceMessage));
    await expect(runOperation(deleteSupplierLocation, f.ctx, { ...version(row), expectedVersion: 99 })).rejects.toMatchObject(issue(`Supplier ${f.parent.code} is archived. Restore it before editing it.`));
  });
  it("refuses wrong-parent, missing and foreign locations and stale updates/deletes", async () => {
    const f = await fixture();
    const row = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const foreign = await fixture();
    for (const operation of [updateSupplierLocation, deleteSupplierLocation]) {
      const body = { ...version(row), name: "Changed" };
      const input = operation === updateSupplierLocation ? body : version(row);
      for (const [ctx, target] of [[f.ctx, { ...input, supplierId: f.supplier.id }], [foreign.ctx, input], [f.ctx, { ...input, locationId: crypto.randomUUID() }]] as const) {
        await expect(runOperation(operation, ctx, target)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
      }
      await expect(runOperation(operation, f.ctx, { ...input, expectedVersion: 99 })).rejects.toMatchObject({ code: "stale_version" });
    }
  });
  it("rolls back rows, pairs, defaults and Activity on every dry run", async () => {
    const f = await fixture();
    const body = { ...site, supplierId: f.parent.id, facilityDistances: [{ facilityId: f.facility.id, distanceKm: 12, distanceSource: "manual" }] };
    const preview = await runOperation(addSupplierLocation, f.ctx, body, { dryRun: true });
    expect(preview.effect).toMatchObject({ outcome: "created", entityType: "supplier_location", versionAfter: 1 });
    expect(await getSupplierLocationsBySupplier(f.ctx, f.parent.id)).toEqual([]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, preview.data.id))).toEqual([]);
    const first = await runOperationInProcess(addSupplierLocation, f.ctx, body);
    const before = await getSupplierLocationsBySupplier(f.ctx, f.parent.id);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
    await runOperation(updateSupplierLocation, f.ctx, { ...version(first), name: "Preview", facilityDistances: [{ ...body.facilityDistances[0], distanceKm: null }] }, { dryRun: true });
    expect((await runOperation(deleteSupplierLocation, f.ctx, version(first), { dryRun: true })).data.id).toBe(first.id);
    expect(await getSupplierLocationsBySupplier(f.ctx, f.parent.id)).toEqual(before);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id))).toEqual(events);
    expect(await db.select().from(supplierLocations).where(and(eq(supplierLocations.organizationId, f.ctx.organizationId), eq(supplierLocations.id, preview.data.id)))).toEqual([]);
  });
});

async function customerFixture() {
  const f = await createPartyArchiveFixture(); fixtures.push(f);
  const [parent] = await db.insert(customers).values({ organizationId: f.ctx.organizationId, code: `LOC-${crypto.randomUUID()}`, name: "Location writer" }).returning();
  return { ...f, parent };
}
const customerVersion = (row: { id: string; version: number }, customerId?: string) => ({ locationId: row.id, expectedVersion: row.version, customerId });
describe("customer location operations", () => {
  it("adds a first default, leaves it on ordinary add, and demotes it on explicit add", async () => {
    const f = await customerFixture();
    const first = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const second = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const third = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id, isDefault: true });
    expect([first.isDefault, second.isDefault, third.isDefault]).toEqual([true, false, true]);
    const rows = await getCustomerLocations(f.ctx, f.parent.id);
    expect(rows.find(row => row.id === first.id)).toMatchObject({ isDefault: false, version: 2 });
    expect(rows.find(row => row.id === second.id)).toMatchObject({ isDefault: false, version: 1 });
    expect((await db.select().from(customers).where(eq(customers.id, f.parent.id)))[0].version).toBe(1);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
    expect(events).toMatchObject([{ action: "created", operationId: "add_customer_location" }]);
  });
  it("keeps omitted fields, clears nulls, coerces the default checkbox and upserts or removes pairs", async () => {
    const f = await customerFixture();
    const pair = { facilityId: f.facility.id, distanceKm: 12, distanceSource: "manual" };
    const first = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, customerId: f.parent.id, name: "Source", city: "Town", stateRegion: "Region", address: "Gate", facilityDistances: [pair] });
    const kept = await runOperationInProcess(updateCustomerLocation, f.ctx, { ...customerVersion(first, f.parent.id), isDefault: false });
    expect(kept).toMatchObject({ name: "Source", city: "Town", stateRegion: "Region", address: "Gate", isDefault: true, version: 2, facilityDistances: [pair] });
    const changed = await runOperationInProcess(updateCustomerLocation, f.ctx, { ...customerVersion(kept), name: "Renamed", city: null, stateRegion: null, address: null, facilityDistances: [{ ...pair, distanceKm: 25 }] });
    expect(changed).toMatchObject({ name: "Renamed", city: null, stateRegion: null, address: null, facilityDistances: [{ ...pair, distanceKm: 25 }] });
    const cleared = await runOperationInProcess(updateCustomerLocation, f.ctx, { ...customerVersion(changed), facilityDistances: [{ ...pair, distanceKm: null }] });
    expect(cleared.facilityDistances).toEqual([]);
  });
  it("promotes on PATCH and bumps the demoted sibling", async () => {
    const f = await customerFixture();
    const first = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const second = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    expect(await runOperationInProcess(updateCustomerLocation, f.ctx, { ...customerVersion(second), isDefault: true })).toMatchObject({ isDefault: true, version: 2 });
    expect((await getCustomerLocations(f.ctx, f.parent.id)).find(row => row.id === first.id)).toMatchObject({ isDefault: false, version: 2 });
  });
  it("deletes the default and promotes the next location in list order with a version bump", async () => {
    const f = await customerFixture();
    const first = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const second = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const removed = await runOperationInProcess(deleteCustomerLocation, f.ctx, customerVersion(first));
    expect(removed.id).toBe(first.id);
    expect(await getCustomerLocations(f.ctx, f.parent.id)).toMatchObject([{ id: second.id, isDefault: true, version: 2 }]);
  });
  it("refuses add, update and delete under an archived parent before stale versions", async () => {
    const f = await customerFixture();
    const row = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    await runOperationInProcess(archiveCustomer, f.ctx, { customerId: f.parent.id, expectedVersion: 1 });
    const referenceMessage = `Customer ${f.parent.code} is archived. Restore it or choose another customer.`;
    const issue = (message: string) => ({ code: "not_found", message, issues: [{ path: ["customerId"] }] });
    await expect(runOperation(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id })).rejects.toMatchObject(issue(referenceMessage));
    await expect(runOperation(updateCustomerLocation, f.ctx, { ...customerVersion(row), expectedVersion: 99, name: "Changed" })).rejects.toMatchObject(issue(referenceMessage));
    await expect(runOperation(deleteCustomerLocation, f.ctx, { ...customerVersion(row), expectedVersion: 99 })).rejects.toMatchObject(issue(`Customer ${f.parent.code} is archived. Restore it before editing it.`));
  });
  it("refuses wrong-parent, missing and foreign locations and stale updates/deletes", async () => {
    const f = await customerFixture();
    const row = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const foreign = await customerFixture();
    for (const operation of [updateCustomerLocation, deleteCustomerLocation]) {
      const body = { ...customerVersion(row), name: "Changed" };
      const input = operation === updateCustomerLocation ? body : customerVersion(row);
      for (const [ctx, target] of [[f.ctx, { ...input, customerId: f.customer.id }], [foreign.ctx, input], [f.ctx, { ...input, locationId: crypto.randomUUID() }]] as const) {
        await expect(runOperation(operation, ctx, target)).rejects.toMatchObject({ code: "not_found", issues: [{ path: ["locationId"] }] });
      }
      await expect(runOperation(operation, f.ctx, { ...input, expectedVersion: 99 })).rejects.toMatchObject({ code: "stale_version" });
    }
  });
  it("rolls back rows, pairs, defaults and Activity on every dry run", async () => {
    const f = await customerFixture();
    const body = { ...site, name: "Field", customerId: f.parent.id, facilityDistances: [{ facilityId: f.facility.id, distanceKm: 12, distanceSource: "manual" }] };
    const preview = await runOperation(addCustomerLocation, f.ctx, body, { dryRun: true });
    expect(preview.effect).toMatchObject({ outcome: "created", entityType: "customer_location", versionAfter: 1 });
    expect(await getCustomerLocations(f.ctx, f.parent.id)).toEqual([]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, preview.data.id))).toEqual([]);
    const first = await runOperationInProcess(addCustomerLocation, f.ctx, body);
    const before = await getCustomerLocations(f.ctx, f.parent.id);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
    await runOperation(updateCustomerLocation, f.ctx, { ...customerVersion(first), name: "Preview", facilityDistances: [{ ...body.facilityDistances[0], distanceKm: null }] }, { dryRun: true });
    expect((await runOperation(deleteCustomerLocation, f.ctx, customerVersion(first), { dryRun: true })).data.id).toBe(first.id);
    expect(await getCustomerLocations(f.ctx, f.parent.id)).toEqual(before);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id))).toEqual(events);
    expect(await db.select().from(customerLocations).where(and(eq(customerLocations.organizationId, f.ctx.organizationId), eq(customerLocations.id, preview.data.id)))).toEqual([]);
  });
});

describe("customer location delete blockers", () => {
  it("includes archived orders and returns the first five codes without deleting anything", async () => {
    const f = await fixture();
    const codes: string[] = [];
    const ORDER_COUNT = 6;
    const BLOCKER_COUNT = 5;
    for (let index = 0; index < ORDER_COUNT; index++) {
      const order = await runOperationInProcess(recordOrder, f.ctx, orderInput(f));
      codes.push(order.code);
      await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, order.id));
    }
    await expect(runOperationInProcess(deleteCustomerLocation, f.ctx, customerVersion(f.location))).rejects.toMatchObject({
      code: "conflict", message: "Customer location was not deleted because orders use it. Archive it instead.",
      issues: [{ path: ["locationId"], meta: { orderCodes: codes.sort().slice(0, BLOCKER_COUNT) } }],
    });
    expect(await getCustomerLocations(f.ctx, f.customer.id)).toMatchObject([{ id: f.location.id, version: f.location.version }]);
  });
});
