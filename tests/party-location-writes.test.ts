import { recordOrder } from "@/lib/operations/orders";
import { orderInput } from "./helpers/order-operation-fixture";
import { orders } from "@/db/schema";
import { addCustomerLocation, updateCustomerLocation, deleteCustomerLocation, archiveCustomerLocation } from "@/lib/operations/customer-locations";
import { archiveCustomer } from "@/lib/operations/customers";
import { getCustomerLocations } from "@/data-access/customers";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { activityEvents, suppliers, supplierLocations, customers, customerLocations, deliveries, feedstocks, storageObjectDeletions, transportLegs } from "@/db/schema";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { addSupplierLocation, updateSupplierLocation, deleteSupplierLocation } from "@/lib/operations/supplier-locations";
import { archiveSupplier } from "@/lib/operations/suppliers";
import { getSupplierLocationsBySupplier } from "@/data-access/suppliers";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, partyIntakeInput, type PartyArchiveFixture } from "./helpers/party-archive-fixture";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { createDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { ensureOutputFixtureActor } from "./helpers/output-contract-fixtures";
import { createCustomerLocationInTransaction } from "@/data-access/customer-create";
import { updateCustomerLocationInTransaction, deleteCustomerLocationInTransaction } from "@/data-access/customer-location-writes";
import { createSupplierLocationInTransaction, updateSupplierLocationInTransaction } from "@/data-access/supplier-location-writes";

const fixtures: PartyArchiveFixture[] = [];
const deliveryOrganizations: string[] = [];
const site = { country: "TZ", gpsLatitude: -8, gpsLongitude: 34 };
beforeAll(async () => { await ensureTestOrg(); await ensureOutputFixtureActor(makeTestOrgContext()); });
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f);
  for (const id of deliveryOrganizations.splice(0)) await cleanupOutputStockFixture(db, id);
});
async function fixture() {
  const f = await createPartyArchiveFixture(); fixtures.push(f);
  const [parent] = await db.insert(suppliers).values({ organizationId: f.ctx.organizationId, code: `LOC-${crypto.randomUUID()}`, name: "Location writer" }).returning();
  return { ...f, parent };
}
/** Events one operation recorded for an entity; callers assert exactly one. */
const operationEvents = async (organizationId: string, entityId: string, operationId: string) =>
  (await locationActivity(organizationId, entityId)).filter(event => event.operationId === operationId);
const version = (row: { id: string; version: number }, supplierId?: string) => ({ locationId: row.id, expectedVersion: row.version, supplierId });

async function locationActivity(organizationId: string, entityId: string) {
  return db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, organizationId), eq(activityEvents.entityId, entityId)))
    .orderBy(asc(activityEvents.sequence));
}

describe.each(["customer", "supplier"] as const)("%s default demotion", kind => {
  it.each(["create", "update"] as const)("%s captures the demoted default and leaves other parents and organizations unchanged", async command => {
    const f = await fixture();
    const foreign = await fixture();
    const table = kind === "customer" ? customerLocations : supplierLocations;
    const parentId = kind === "customer" ? f.customer.id : f.parent.id;
    const otherParentId = kind === "customer" ? f.otherCustomer.id : f.supplier.id;
    const foreignParentId = kind === "customer" ? foreign.customer.id : foreign.parent.id;
    const create = kind === "customer" ? createCustomerLocationInTransaction : createSupplierLocationInTransaction;
    const update = kind === "customer" ? updateCustomerLocationInTransaction : updateSupplierLocationInTransaction;
    const input = { ...site, name: "Default field", isDefault: true };
    const first = (await db.transaction(async tx => create(f.ctx, tx, parentId, input))).location;
    const second = (await db.transaction(async tx => create(f.ctx, tx, parentId, { ...input, name: "Second field", isDefault: false }))).location;
    const other = (await db.transaction(async tx => create(f.ctx, tx, otherParentId, input))).location;
    const foreignLocation = (await db.transaction(async tx => create(foreign.ctx, tx, foreignParentId, input))).location;
    const readRow = async (id: string) => (await db.select().from(table).where(eq(table.id, id)))[0];
    const before = await readRow(first.id);
    const untouched = await Promise.all([readRow(other.id), readRow(foreignLocation.id)]);
    const captureLocation = vi.fn();

    const promoted = await db.transaction(async tx => command === "create"
      ? (await create(f.ctx, tx, parentId, input, captureLocation)).location
      : update(f.ctx, tx, { locationId: second.id, expectedVersion: second.version, isDefault: true }, undefined, captureLocation));

    const demoted = await readRow(first.id);
    expect(promoted).toMatchObject({ isDefault: true, version: command === "create" ? 1 : 2 });
    expect(demoted).toMatchObject({ isDefault: false, version: 2 });
    expect(demoted.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(captureLocation.mock.calls).toEqual([[first.id, before, demoted]]);
    expect(await Promise.all([readRow(other.id), readRow(foreignLocation.id)])).toEqual(untouched);
    if (command === "create") expect(await readRow(second.id)).toMatchObject({ isDefault: false, version: 1 });

    // Reasserting the current default must not demote or capture that same row.
    captureLocation.mockClear();
    await db.transaction(async tx => update(f.ctx, tx, { locationId: promoted.id, expectedVersion: promoted.version, isDefault: true }, undefined, captureLocation));
    expect(captureLocation).not.toHaveBeenCalled();
    expect(await readRow(promoted.id)).toMatchObject({ isDefault: true, version: promoted.version + 1 });
  });
});

describe("supplier location operations", () => {
  it.each([1, 3])("warns when add fills %s intakes", async count => {
    const f = await fixture();
    for (let index = 0; index < count; index++) await runOperationInProcess(logFeedstockDelivery, f.ctx, partyIntakeInput(f, f.parent.id));
    const saved = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 35, distanceSource: "manual" }] });
    expect(saved.warnings).toEqual([count === 1 ? "Filled the missing distance on 1 intake." : "Filled the missing distance on 3 intakes."]);
  });
  it.each([1, 3])("previews and saves warnings when a pair save fills %s intakes", async count => {
    const f = await fixture();
    const location = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    for (let index = 0; index < count; index++) await runOperationInProcess(logFeedstockDelivery, f.ctx, partyIntakeInput(f, f.parent.id));
    const input = { ...version(location), facilityDistances: [{ facilityId: f.facility.id, distanceKm: 35, distanceSource: "manual" }] };
    const before = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId)).orderBy(asc(activityEvents.sequence));
    const preview = await runOperation(updateSupplierLocation, f.ctx, input, { dryRun: true });
    expect(preview.data.warnings).toEqual([count === 1 ? "Filled the missing distance on 1 intake." : "Filled the missing distance on 3 intakes."]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId)).orderBy(asc(activityEvents.sequence))).toEqual(before);
    expect((await runOperationInProcess(updateSupplierLocation, f.ctx, input)).warnings).toEqual(preview.data.warnings);
  });
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
    expect([first.warnings, second.warnings, third.warnings]).toEqual([[], [], []]);
    expect(await locationActivity(f.ctx.organizationId, first.id)).toMatchObject([
      { action: "created", operationId: "add_supplier_location" },
      { action: "updated", operationId: "add_supplier_location", versionBefore: 1, versionAfter: 2,
        changedFields: ["isDefault"], changes: { isDefault: { from: true, to: false } } },
    ]);
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
    expect(await operationEvents(f.ctx.organizationId, first.id, "update_supplier_location")).toMatchObject([{
      action: "updated", operationId: "update_supplier_location", versionBefore: 1, versionAfter: 2,
      changedFields: ["isDefault"], changes: { isDefault: { from: true, to: false } },
    }]);
    expect(await operationEvents(f.ctx.organizationId, second.id, "update_supplier_location")).toHaveLength(1);
  });
  it("deletes the default and promotes the next location in list order with a version bump", async () => {
    const f = await fixture();
    const first = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const second = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, city: "Town", supplierId: f.parent.id });
    const removed = await runOperationInProcess(deleteSupplierLocation, f.ctx, version(first));
    expect(removed.id).toBe(first.id);
    expect(removed.warnings).toEqual(["TZ is now the default location. New intakes use its distances."]);
    expect(await getSupplierLocationsBySupplier(f.ctx, f.parent.id)).toMatchObject([{ id: second.id, isDefault: true, version: 2 }]);
    expect(await operationEvents(f.ctx.organizationId, second.id, "delete_supplier_location")).toMatchObject([{
      action: "updated", operationId: "delete_supplier_location", versionBefore: 1, versionAfter: 2,
      changedFields: ["isDefault"], changes: { isDefault: { from: false, to: true } },
    }]);
    expect(await operationEvents(f.ctx.organizationId, first.id, "delete_supplier_location")).toHaveLength(1);
  });
  it("names the promoted supplier location and has no warning when deleting the last one", async () => {
    const f = await fixture();
    const first = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id, name: "North Gate" });
    const input = version(first);
    const before = await locationActivity(f.ctx.organizationId, first.id);
    const preview = await runOperation(deleteSupplierLocation, f.ctx, input, { dryRun: true });
    expect(preview.data.warnings).toEqual(["North Gate is now the default location. New intakes use its distances."]);
    expect(await locationActivity(f.ctx.organizationId, first.id)).toEqual(before);
    expect((await runOperationInProcess(deleteSupplierLocation, f.ctx, input)).warnings).toEqual(preview.data.warnings);
    const [remaining] = await getSupplierLocationsBySupplier(f.ctx, f.parent.id);
    expect((await runOperationInProcess(deleteSupplierLocation, f.ctx, version(remaining))).warnings).toEqual([]);
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
    const second = await runOperationInProcess(addSupplierLocation, f.ctx, { ...site, supplierId: f.parent.id });
    const before = await getSupplierLocationsBySupplier(f.ctx, f.parent.id);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
    const siblingEvents = await locationActivity(f.ctx.organizationId, second.id);
    await runOperation(addSupplierLocation, f.ctx, { ...body, isDefault: true }, { dryRun: true });
    await runOperation(updateSupplierLocation, f.ctx, { ...version(second), isDefault: true }, { dryRun: true });
    await runOperation(updateSupplierLocation, f.ctx, { ...version(first), name: "Preview", facilityDistances: [{ ...body.facilityDistances[0], distanceKm: null }] }, { dryRun: true });
    expect((await runOperation(deleteSupplierLocation, f.ctx, version(first), { dryRun: true })).data).toMatchObject({ id: first.id,
      warnings: ["TZ is now the default location. New intakes use its distances."] });
    expect(await getSupplierLocationsBySupplier(f.ctx, f.parent.id)).toEqual(before);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id))).toEqual(events);
    expect(await locationActivity(f.ctx.organizationId, second.id)).toEqual(siblingEvents);
    expect(await db.select().from(supplierLocations).where(and(eq(supplierLocations.organizationId, f.ctx.organizationId), eq(supplierLocations.id, preview.data.id)))).toEqual([]);
  });
});

describe("location fill warnings and delivery Activity", () => {
  it.each([1, 2])("counts %s deliveries sharing one product and preserves warnings on replay", async count => {
    const f = await createDeliveryFixture();
    deliveryOrganizations.push(f.ctx.organizationId);
    const savedDeliveries = [];
    for (let index = 0; index < count; index++) {
      const { delivery } = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, {
        ...f.input, deliveredWetMassKg: 10, idempotencyKey: crypto.randomUUID(),
      }));
      savedDeliveries.push(delivery);
    }
    const input = { ...customerVersion(f.location), facilityDistances: [{ facilityId: f.facility.id, distanceKm: 25, distanceSource: "document" }] };
    const readEvents = () => db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId)).orderBy(asc(activityEvents.sequence));
    const before = await readEvents();
    const queue = await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, f.ctx.organizationId));
    const preview = await runOperation(updateCustomerLocation, f.ctx, input, { dryRun: true });
    expect(preview.data.warnings).toEqual([count === 1 ? "Recorded the distance on 1 delivery." : "Recorded the distance on 2 deliveries."]);
    expect(await readEvents()).toEqual(before);
    expect(await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, f.ctx.organizationId))).toEqual(queue);
    for (const delivery of savedDeliveries) {
      expect((await db.select().from(deliveries).where(eq(deliveries.id, delivery.id)))[0]).toMatchObject({ version: delivery.version, recordedDistanceKm: null });
    }
    const options = { idempotency: { credentialId: "location-test", key: crypto.randomUUID() } };
    const committed = await runOperation(updateCustomerLocation, f.ctx, input, options);
    expect(committed.data.warnings).toEqual(preview.data.warnings);
    for (const delivery of savedDeliveries) {
      expect(await locationActivity(f.ctx.organizationId, delivery.id)).toMatchObject([{
        entityType: "delivery", action: "updated", operationId: "update_customer_location", facilityId: f.facility.id,
        versionBefore: delivery.version, versionAfter: delivery.version + 1,
        changedFields: ["recordedDistanceKm", "recordedDistanceSource"],
        changes: { recordedDistanceKm: { from: null, to: "25" }, recordedDistanceSource: { from: null, to: "document" } },
      }]);
    }
    expect(await db.select().from(transportLegs).where(and(eq(transportLegs.organizationId, f.ctx.organizationId), eq(transportLegs.entityId, f.product.id), eq(transportLegs.isDerived, true)))).toHaveLength(1);
    const events = await readEvents();
    expect(await runOperation(updateCustomerLocation, f.ctx, input, options)).toMatchObject({ replayed: true, data: committed.data });
    expect(await readEvents()).toEqual(events);
  });

  it.each(["removal", "ghgStatement"] as const)("warns separately for intakes and deliveries in submitted %s lineage", async blockingVia => {
    const ctx = makeTestOrgContext();
    await withLineageFixture(async f => {
      const [order] = await db.select().from(orders).where(eq(orders.id, f.orderId));
      const [location] = await db.select().from(customerLocations).where(eq(customerLocations.id, order.customerLocationId));
      await db.update(deliveries).set({ recordedDistanceKm: null, recordedDistanceSource: null }).where(eq(deliveries.id, f.deliveryId));
      const body = { ...customerVersion(location), facilityDistances: [{ facilityId: f.facilityId, distanceKm: 25, distanceSource: "document" }] };
      const events = await locationActivity(ctx.organizationId, f.deliveryId);
      const preview = await runOperation(updateCustomerLocation, ctx, body, { dryRun: true });
      expect(preview.data.warnings).toEqual(["1 delivery belongs to a submitted Removal and was left unchanged."]);
      expect((await runOperationInProcess(updateCustomerLocation, ctx, body)).warnings).toEqual(preview.data.warnings);
      expect(await locationActivity(ctx.organizationId, f.deliveryId)).toEqual(events);
      const [intake] = await db.select().from(feedstocks).where(eq(feedstocks.id, f.feedstockId));
      const input = { ...site, supplierId: intake.supplierId, facilityDistances: [{ facilityId: f.facilityId, distanceKm: 35, distanceSource: "manual" }] };
      const saved = await runOperationInProcess(addSupplierLocation, ctx, input);
      try {
        expect(saved.warnings).toEqual(["1 intake belongs to a submitted Removal and was left unchanged."]);
      } finally {
        await db.delete(supplierLocations).where(eq(supplierLocations.id, saved.id));
      }
    }, blockingVia);
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
    expect([first.warnings, second.warnings, third.warnings]).toEqual([[], [], []]);
    expect(await locationActivity(f.ctx.organizationId, first.id)).toMatchObject([
      { action: "created", operationId: "add_customer_location" },
      { action: "updated", operationId: "add_customer_location", versionBefore: 1, versionAfter: 2,
        changedFields: ["isDefault"], changes: { isDefault: { from: true, to: false } } },
    ]);
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
    expect(await operationEvents(f.ctx.organizationId, first.id, "update_customer_location")).toMatchObject([{
      action: "updated", operationId: "update_customer_location", versionBefore: 1, versionAfter: 2,
      changedFields: ["isDefault"], changes: { isDefault: { from: true, to: false } },
    }]);
    expect(await operationEvents(f.ctx.organizationId, second.id, "update_customer_location")).toHaveLength(1);
  });
  it("deletes the default and promotes the next location in list order with a version bump", async () => {
    const f = await customerFixture();
    const first = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const second = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Field", customerId: f.parent.id });
    const removed = await runOperationInProcess(deleteCustomerLocation, f.ctx, customerVersion(first));
    expect(removed.id).toBe(first.id);
    expect(removed.warnings).toEqual(["Field is now the default location."]);
    expect(await getCustomerLocations(f.ctx, f.parent.id)).toMatchObject([{ id: second.id, isDefault: true, version: 2 }]);
    expect(await operationEvents(f.ctx.organizationId, second.id, "delete_customer_location")).toMatchObject([{
      action: "updated", operationId: "delete_customer_location", versionBefore: 1, versionAfter: 2,
      changedFields: ["isDefault"], changes: { isDefault: { from: false, to: true } },
    }]);
    expect(await operationEvents(f.ctx.organizationId, first.id, "delete_customer_location")).toHaveLength(1);
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
    const second = await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Other Field", customerId: f.parent.id });
    const before = await getCustomerLocations(f.ctx, f.parent.id);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
    const siblingEvents = await locationActivity(f.ctx.organizationId, second.id);
    await runOperation(addCustomerLocation, f.ctx, { ...body, isDefault: true }, { dryRun: true });
    await runOperation(updateCustomerLocation, f.ctx, { ...customerVersion(second), isDefault: true }, { dryRun: true });
    await runOperation(updateCustomerLocation, f.ctx, { ...customerVersion(first), name: "Preview", facilityDistances: [{ ...body.facilityDistances[0], distanceKm: null }] }, { dryRun: true });
    expect((await runOperation(deleteCustomerLocation, f.ctx, customerVersion(first), { dryRun: true })).data).toMatchObject({ id: first.id,
      warnings: ["Other Field is now the default location."] });
    expect(await getCustomerLocations(f.ctx, f.parent.id)).toEqual(before);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id))).toEqual(events);
    expect(await locationActivity(f.ctx.organizationId, second.id)).toEqual(siblingEvents);
    expect(await db.select().from(customerLocations).where(and(eq(customerLocations.organizationId, f.ctx.organizationId), eq(customerLocations.id, preview.data.id)))).toEqual([]);
  });
});

describe("customer location delete blockers", () => {
  it("refuses deleting an archived location with orders without suggesting archive", async () => {
    const f = await fixture();
    const order = await runOperationInProcess(recordOrder, f.ctx, orderInput(f));
    await runOperationInProcess(addCustomerLocation, f.ctx, { ...site, name: "Other field", customerId: f.customer.id });
    const archived = await runOperationInProcess(archiveCustomerLocation, f.ctx, customerVersion(f.location));
    const before = await db.select().from(customerLocations).where(eq(customerLocations.id, archived.id));
    await expect(db.transaction(tx => deleteCustomerLocationInTransaction(f.ctx, tx, customerVersion(archived)))).rejects.toMatchObject({
      code: "conflict", message: "Customer location was not deleted because orders use it.",
      issues: [{ path: ["locationId"], meta: { orderCodes: [order.code] } }],
    });
    expect(await db.select().from(customerLocations).where(eq(customerLocations.id, archived.id))).toEqual(before);
  });

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
