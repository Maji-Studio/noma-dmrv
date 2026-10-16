import { createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "./helpers/operation-fixture";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { toActionFailure } from "@/fn/action-errors";
import { findCustomerLocationBlockers } from "@/data-access/customer-location-reference-guards";
import type { OrgContext } from "@/lib/auth/server";
let currentCtx: OrgContext;
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: () => currentCtx }));
import { createCustomerWithLocationsFn, updateCustomerFn } from "@/fn/customers";
import { createSupplierWithLocationsFn, updateSupplierFn } from "@/fn/suppliers";
import { recordOrder } from "@/lib/operations/orders";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { createSupplierInTransaction } from "@/data-access/supplier-writes";
import { withAutoCodes } from "@/data-access/code-generator";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, customerLocations, supplierLocations, supplierLocationFacilityDistances, customerLocationFacilityDistances, suppliers, customers, certifierProjects, certifierStorageLocations, feedstocks, transportLegs, orders, facilities, deliveries } from "@/db/schema";
import { createSupplier, updateSupplier, deleteSupplier } from "@/lib/operations/suppliers";
import { createCustomer, updateCustomer, deleteCustomer } from "@/lib/operations/customers";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { createOrderFixture, cleanupOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

const fixtures: OrderFixture[] = [];
const intakeFixtures: IntakeFixture[] = [];
const location = { name: "Field", country: "TZ", gpsLatitude: -8, gpsLongitude: 34 };
afterEach(async () => {
  for (const f of intakeFixtures.splice(0)) await removeIntakeFixture(f);
  for (const f of fixtures.splice(0)) {
    await db.delete(certifierStorageLocations).where(eq(certifierStorageLocations.organizationId, f.ctx.organizationId));
    await db.delete(certifierProjects).where(eq(certifierProjects.organizationId, f.ctx.organizationId));
    await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, f.ctx.organizationId));
    const referenced = await db.select({ id: feedstocks.supplierId }).from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
    await db.delete(suppliers).where(and(eq(suppliers.organizationId, f.ctx.organizationId), referenced.length ? notInArray(suppliers.id, referenced.map(row => row.id)) : undefined));
    await cleanupOrderFixture(f);
  }
});
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); currentCtx = f.ctx; return f; }
describe("party runner writes", () => {
  it.each(["supplier", "customer"] as const)("persists the same audit fields on %s and location events", async kind => {
    const f = await fixture();
    const audit = { transport: "mcp" as const, credentialId: "party-credential", requestId: "party-request", oauthClientId: "party-client" };
    const input = { name: "Audited party", locations: [location] };
    if (kind === "supplier") await runOperation(createSupplier, f.ctx, input, { audit });
    else await runOperation(createCustomer, f.ctx, input, { audit });
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    expect(events).toHaveLength(2);
    expect(events.map(event => event.entityType).sort()).toEqual([kind, `${kind}_location`]);
    for (const event of events) expect(event).toMatchObject({
      source: "mcp", credentialId: "party-credential", requestId: "party-request", oauthClientId: "party-client", operationId: `create_${kind}`,
    });
  });
  it("records persisted value changes and only names contact changes", async () => {
    const f = await fixture();
    const { supplier } = await runOperationInProcess(createSupplier, f.ctx, {
      name: "Snapshot supplier", sourceRegion: "Mbeya", contactEmail: "before@example.test", locations: [location],
    });
    const result = await runOperation(updateSupplier, f.ctx, {
      supplierId: supplier.id, expectedVersion: 1, name: supplier.name,
      sourceRegion: "Iringa", contactEmail: "after@example.test",
    });
    expect(result.effect?.changedFields).toEqual(["contactEmail", "sourceRegion"]);
    const [event] = await db.select().from(activityEvents).where(and(
      eq(activityEvents.entityId, supplier.id), eq(activityEvents.action, "updated"),
    ));
    expect(event.changedFields).toEqual(["contactEmail", "sourceRegion"]);
    expect(event.changes).toEqual({ sourceRegion: { from: "Mbeya", to: "Iringa" } });
    expect(JSON.stringify(event, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value)).not.toContain("@example.test");
  });
  it("creates three locations, keeps the last default, saves pairs and leaves locations alone on metadata edits", async () => {
    const f = await fixture();
    expect(db.$client.options.max).toBe(1);
    const intakesBefore = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
    const legsBefore = await db.select().from(transportLegs).where(eq(transportLegs.organizationId, f.ctx.organizationId));
    const result = await runOperationInProcess(createSupplier, f.ctx, {
      name: "Supplier", contactName: "Contact", contactEmail: "test@example.com", contactPhone: "123", address: "Address", location: "Region",
      locations: [true, false, true].map(isDefault => ({ ...location, isDefault, facilityDistances: [{ facilityId: f.facility.id, distanceKm: 12, distanceSource: "manual" }] })),
    });
    expect(result.locations.map(row => row.isDefault)).toEqual([false, false, true]);
    expect(result.locations.map(row => row.facilityDistances[0].distanceKm)).toEqual([12, 12, 12]);
    expect(await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId))).toEqual(intakesBefore);
    expect(await db.select().from(transportLegs).where(eq(transportLegs.organizationId, f.ctx.organizationId))).toEqual(legsBefore);
    expect(result.supplier.contactEmail).toBe("test@example.com");
    const before = await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, result.supplier.id));
    await runOperationInProcess(updateSupplier, f.ctx, { supplierId: result.supplier.id, expectedVersion: 1, name: "Renamed", contactPhone: null });
    expect(await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, result.supplier.id))).toEqual(before);
    await runOperationInProcess(deleteSupplier, f.ctx, { supplierId: result.supplier.id, expectedVersion: 2 });
    expect(await db.select().from(supplierLocations).where(eq(supplierLocations.supplierId, result.supplier.id))).toEqual([]);
    expect(await db.select().from(supplierLocationFacilityDistances).where(eq(supplierLocationFacilityDistances.locationId, result.locations[0].id))).toEqual([]);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    expect(events.filter(event => event.entityType === "supplier_location" && event.action === "created")).toHaveLength(3);
    expect(events.filter(event => event.entityType === "supplier_location" && event.action === "updated")).toMatchObject([
      { changedFields: ["isDefault"], changes: { isDefault: { from: true, to: false } } },
    ]);
    expect(events.find(event => event.entityId === result.locations[0].id && event.action === "created")?.changes).toMatchObject({
      isDefault: { from: null, to: true }, country: { from: null, to: "TZ" },
    });
    expect(events.filter(event => event.entityType === "supplier_location" && event.action === "deleted")).toHaveLength(3);
  });
  it("deletes a customer and its locations together", async () => {
    const f = await fixture();
    const result = await runOperationInProcess(createCustomer, f.ctx, { name: "New customer", locations: [location, { ...location, name: "Second" }] });
    await runOperationInProcess(deleteCustomer, f.ctx, { customerId: result.customer.id, expectedVersion: 1 });
    expect(await db.select().from(customerLocations).where(and(eq(customerLocations.organizationId, f.ctx.organizationId), eq(customerLocations.customerId, result.customer.id)))).toEqual([]);
  });
});

describe("party refusals and atomic effects", () => {
  it("refuses supplier deletion when only an archived intake references it", async () => {
    const f = await createIntakeFixture("archived-supplier"); intakeFixtures.push(f);
    await runOperation(logFeedstockDelivery, f.ctx, f.input());
    const [intake] = await db.update(feedstocks).set({ archivedAt: new Date() })
      .where(eq(feedstocks.organizationId, f.ctx.organizationId)).returning();
    await expect(runOperation(deleteSupplier, f.ctx, { supplierId: f.supplierId, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ meta: { feedstockCodes: [intake.code] } })] });
    expect(await db.select().from(suppliers).where(eq(suppliers.id, f.supplierId))).toHaveLength(1);
  });
  it("keeps the feedstock supplier refusal text for foreign and unknown suppliers", async () => {
    const f = await createIntakeFixture("supplier-refusal"); intakeFixtures.push(f);
    const foreign = await createIntakeFixture("foreign-supplier"); intakeFixtures.push(foreign);
    for (const supplierId of [foreign.supplierId, crypto.randomUUID()]) {
      const failure = await runOperation(logFeedstockDelivery, f.ctx, { ...f.input(), supplierId }).catch(error => error);
      expect(failure).toMatchObject({ code: "not_found", message: "Supplier was not found.", issues: [expect.objectContaining({ path: ["supplierId"] })] });
      expect(toActionFailure(failure, { fallbackMessage: "Failed to create feedstock", log: { message: "feedstock creation failed" } })).toMatchObject({ success: false, error: "Supplier was not found." });
    }
  });
  it("refuses normalized names, duplicate codes and foreign ids with field issues", async () => {
    const f = await fixture(); const foreign = await fixture();
    const supplier = (await runOperationInProcess(createSupplier, f.ctx, { name: "Unique supplier", locations: [location] })).supplier;
    const customer = (await runOperationInProcess(createCustomer, f.ctx, { name: "Unique customer", locations: [location] })).customer;
    for (const name of ["UNIQUE SUPPLIER", "  Unique supplier  "]) {
      await expect(runOperation(createSupplier, f.ctx, { name, locations: [location] })).rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ path: ["name"] })] });
    }
    for (const name of ["UNIQUE CUSTOMER", "  Unique customer  "]) {
      await expect(runOperation(createCustomer, f.ctx, { name, locations: [location] })).rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ path: ["name"] })] });
    }
    await expect(runOperation(updateCustomer, f.ctx, { customerId: customer.id, expectedVersion: 1, code: f.customer.code })).rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ path: ["code"] })] });
    const other = (await runOperationInProcess(createSupplier, f.ctx, { name: "Other supplier", locations: [location] })).supplier;
    await expect(runOperation(updateSupplier, f.ctx, { supplierId: supplier.id, expectedVersion: 1, code: other.code })).rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ path: ["code"] })] });
    await expect(runOperation(updateSupplier, foreign.ctx, { supplierId: supplier.id, expectedVersion: 1, name: "No" })).rejects.toMatchObject({ code: "not_found" });
    await expect(runOperation(deleteCustomer, foreign.ctx, { customerId: customer.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "not_found" });
  });
  it("recovers a generated code collision by rolling back the complete savepoint", async () => {
    const f = await fixture(); let attempts = 0;
    const operation = { ...createSupplier, execute: async ({ ctx, tx }: Parameters<typeof createSupplier.execute>[0], input: Parameters<typeof createSupplier.execute>[1]) =>
      withAutoCodes(ctx, tx, "SUP", suppliers, suppliers.code, 1, async ([code], savepoint) => {
        attempts++;
        if (attempts === 1) await savepoint.insert(suppliers).values({ organizationId: ctx.organizationId, code, name: "Rolled back collision" });
        return createSupplierInTransaction(ctx, savepoint, { ...input, code });
      }) };
    const result = await runOperationInProcess(operation, f.ctx, { name: "Retry", locations: [location] });
    expect(attempts).toBe(2);
    expect(result.locations).toHaveLength(1);
    expect(await db.select().from(suppliers).where(and(eq(suppliers.organizationId, f.ctx.organizationId), eq(suppliers.name, "Rolled back collision")))).toEqual([]);
  });
  it("refuses customer deletion with an archived order and deletes nothing", async () => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, order.id));
    await expect(runOperation(deleteCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ meta: { orderCodes: [order.code] } })] });
    expect(await db.select().from(customerLocations).where(eq(customerLocations.customerId, f.customer.id))).toHaveLength(1);
    expect(await db.select().from(customers).where(eq(customers.id, f.customer.id))).toHaveLength(1);
  });
  it("refuses a registered site without an order on the second location and preserves every child", async () => {
    const f = await fixture();
    const created = await runOperationInProcess(createCustomer, f.ctx, { name: "Registered", locations: [location, { ...location, name: "Registered field" }] });
    const id = created.locations[1].id;
    const [project] = await db.insert(certifierProjects).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, provider: "isometric", externalProjectId: `prj-${id}`, externalFacilityId: `fcl-${id}` }).returning();
    await db.insert(certifierStorageLocations).values({ organizationId: f.ctx.organizationId, customerLocationId: id, certifierProjectId: project.id,
      externalProjectId: project.externalProjectId, externalStorageLocationId: `slc-${id}`, supplierReference: id, payloadHash: "test",
      submittedPayload: buildCreateStorageLocationRequest({ externalProjectId: project.externalProjectId, name: "Registered field", latitude: -8, longitude: 34, supplierReferenceId: id }),
    });
    await db.transaction(async tx => {
      expect(await findCustomerLocationBlockers(f.ctx, tx, id)).toEqual({ orderCodes: [], registeredLocationIds: [id] });
      expect(await findCustomerLocationBlockers(f.ctx, tx, created.locations[0].id)).toEqual({ orderCodes: [], registeredLocationIds: [] });
    });
    await expect(runOperation(deleteCustomer, f.ctx, { customerId: created.customer.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ meta: { locationIds: [id] } })] });
    expect(await db.select().from(customerLocations).where(eq(customerLocations.customerId, created.customer.id))).toHaveLength(2);
    expect(await db.select().from(customers).where(eq(customers.id, created.customer.id))).toHaveLength(1);
  });
  it("rolls back parents, pairs, defaults and Activity on dry run", async () => {
    const f = await fixture();
    const input = { name: "Dry run", locations: [location, { ...location, isDefault: true, facilityDistances: [{ facilityId: f.facility.id, distanceKm: 12, distanceSource: "manual" }] }] };
    const supplier = (await runOperation(createSupplier, f.ctx, input, { dryRun: true })).data;
    const customer = (await runOperation(createCustomer, f.ctx, input, { dryRun: true })).data;
    expect(await db.select().from(suppliers).where(eq(suppliers.id, supplier.supplier.id))).toEqual([]);
    expect(await db.select().from(customers).where(eq(customers.id, customer.customer.id))).toEqual([]);
    expect(await db.select().from(supplierLocationFacilityDistances).where(eq(supplierLocationFacilityDistances.locationId, supplier.locations[1].id))).toEqual([]);
    expect(await db.select().from(customerLocationFacilityDistances).where(eq(customerLocationFacilityDistances.locationId, customer.locations[1].id))).toEqual([]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toEqual([]);
  });
  it("keeps app contact fields and maps customer site description through the actions", async () => {
    const f = await fixture();
    const supplier = await createSupplierWithLocationsFn({ supplier: { name: "App supplier", contactName: "Contact", contactEmail: "test@example.com", contactPhone: "123", location: "Region", address: "Address" }, locations: [{ ...location, isDefault: true }] });
    expect(supplier.success).toBe(true); if (!supplier.success) throw new Error(supplier.error);
    expect(supplier.data).toMatchObject({ contactName: "Contact", contactEmail: "test@example.com", location: "Region", address: "Address" });
    expect(await updateSupplierFn({ supplierId: supplier.data.id, expectedVersion: 1, contactPhone: "456", contactName: null })).toMatchObject({ success: true, data: { contactPhone: "456", contactName: null } });
    const customer = await createCustomerWithLocationsFn({ customer: { name: "App customer", contactEmail: "test@example.com", contactPhone: "123", address: "Address" }, locations: [{ ...location, address: "Site description", defaultSoilTemperatureC: 25, isDefault: true }] });
    expect(customer.success).toBe(true); if (!customer.success) throw new Error(customer.error);
    expect(customer.data.customer).toMatchObject({ contactEmail: "test@example.com", address: "Address" });
    expect(customer.data.locations[0]).toMatchObject({ address: "Site description", defaultSoilTemperatureC: 25 });
    expect(await updateCustomerFn({ customerId: customer.data.customer.id, expectedVersion: 1, contactPhone: "456", address: null })).toMatchObject({ success: true, data: { contactPhone: "456", address: null } });
    expect(f.ctx.organizationId).toBe(customer.data.customer.organizationId);
  });
  it("reports missing, foreign and archived pair facilities at the nested pointer", async () => {
    const f = await fixture(); const foreign = await fixture();
    await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, f.otherFacility.id));
    for (const facilityId of [crypto.randomUUID(), foreign.facility.id, f.otherFacility.id]) {
      const input = { name: "Rejected facility", locations: [{ ...location, facilityDistances: [{ facilityId, distanceKm: 12, distanceSource: "manual" }] }] };
      const failure = { code: "not_found", issues: [expect.objectContaining({ path: ["locations", 0, "facilityDistances", 0, "facilityId"] })] };
      await expect(runOperation(createSupplier, f.ctx, input)).rejects.toMatchObject(failure);
      await expect(runOperation(createCustomer, f.ctx, input)).rejects.toMatchObject(failure);
    }
  });
  it("does not fill historical deliveries when creating a new customer with pairs", async () => {
    const f = await fixture();
    const before = await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId));
    const saved = await runOperationInProcess(createCustomer, f.ctx, { name: "Customer pairs", locations: [{ ...location, facilityDistances: [{ facilityId: f.facility.id, distanceKm: 15, distanceSource: "manual" }] }] });
    expect(saved.locations[0].facilityDistances).toMatchObject([{ facilityId: f.facility.id, distanceKm: 15 }]);
    expect(await db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId))).toEqual(before);
    const children = await db.select().from(customerLocations).where(eq(customerLocations.customerId, saved.customer.id));
    await runOperation(updateCustomer, f.ctx, { customerId: saved.customer.id, expectedVersion: 1, cropType: "Coffee" });
    expect(await db.select().from(customerLocations).where(eq(customerLocations.customerId, saved.customer.id))).toEqual(children);
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    await runOperation(updateCustomer, f.ctx, { customerId: saved.customer.id, expectedVersion: 2, cropType: null }, { dryRun: true });
    await runOperation(deleteCustomer, f.ctx, { customerId: saved.customer.id, expectedVersion: 2 }, { dryRun: true });
    expect(await db.select().from(customers).where(eq(customers.id, saved.customer.id))).toMatchObject([{ version: 2, cropType: "Coffee" }]);
    expect(await db.select().from(customerLocations).where(eq(customerLocations.customerId, saved.customer.id))).toEqual(children);
    expect(await db.select().from(customerLocationFacilityDistances).where(eq(customerLocationFacilityDistances.locationId, saved.locations[0].id))).toHaveLength(1);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toEqual(events);
  });

});
