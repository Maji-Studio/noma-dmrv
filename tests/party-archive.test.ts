import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import type { OrgContext } from "@/lib/auth/server";
let currentCtx: OrgContext;
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: () => currentCtx }));
import * as supplierActions from "@/fn/suppliers";
import * as customerActions from "@/fn/customers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, customers, suppliers, orders, deliveries, feedstocks, storageLocations, certifierProjects, certifierStorageLocations } from "@/db/schema";
import * as supplierOps from "@/lib/operations/suppliers";
import * as customerOps from "@/lib/operations/customers";
import { recordOrder, updateOrder } from "@/lib/operations/orders";
import { runOperation, runOperationInProcess, type RunOptions } from "@/lib/operations/runner";
import { insertReadDelivery } from "./helpers/api-order-read-fixture";
import { orderInput, createOrderDestination } from "./helpers/order-operation-fixture";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, partyIntakeInput, type PartyArchiveFixture as OrderFixture } from "./helpers/party-archive-fixture";

import { getSuppliers, getSupplierById, getSupplierLocationsBySupplier } from "@/data-access/suppliers";
import { createSupplierLocation, updateSupplierLocation, deleteSupplierLocation } from "./helpers/supplier-location-operations";
import { createSupplierLocationInTransaction } from "@/data-access/supplier-writes";
import { getCustomers, getCustomerWithRelations, getCustomerLocations } from "@/data-access/customers";
import { createCustomerLocation, updateCustomerLocation, deleteCustomerLocation } from "./helpers/customer-location-operations";
import { getEntities, getEntityById } from "@/data-access/entities";
import { supplierFilterSchema } from "@/schemas/suppliers";
import { customerFilterSchema } from "@/schemas/customers";

import { logFeedstockDelivery, updateFeedstock } from "@/lib/operations/feedstocks";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordDelivery } from "@/lib/operations/deliveries";
import { recordApplication } from "@/lib/operations/applications";
import { getTransportLegsForEntity } from "@/data-access/transport-legs";
import { getOrderWithRelationsById } from "@/data-access/orders";
import { getDeliveryWithRelations } from "@/data-access/deliveries";
import { getApplicationById } from "@/data-access/applications";
import { getStorageLocationRegistryInput, persistStorageLocationRegistration, getStorageLocationRegistration } from "@/data-access/certifier-storage-locations";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";

const site = { name: "E2E Field", country: "TZ", gpsLatitude: -8, gpsLongitude: 34 };
const TIMEOUT_MS = 60_000;
const SINGLE_CONNECTION = 1;
const fixtures: OrderFixture[] = [];
beforeAll(() => { expect(db.$client.options.max).toBe(SINGLE_CONNECTION); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f); });
async function fixture() { const f = await createPartyArchiveFixture(); fixtures.push(f); currentCtx = f.ctx; return f; }
const issue = (code: string, kind: string) => ({ code, issues: [expect.objectContaining({ path: [`${kind}Id`], code })] });

for (const kind of ["supplier", "customer"] as const) {
  const noun = kind === "supplier" ? "Supplier" : "Customer";
  const table = kind === "supplier" ? suppliers : customers;
  const archive = (f: OrderFixture, id: string, expectedVersion: number) => kind === "supplier"
    ? runOperationInProcess(supplierOps.archiveSupplier, f.ctx, { supplierId: id, expectedVersion })
    : runOperationInProcess(customerOps.archiveCustomer, f.ctx, { customerId: id, expectedVersion });
  const restore = (f: OrderFixture, id: string, expectedVersion: number) => kind === "supplier"
    ? runOperationInProcess(supplierOps.restoreSupplier, f.ctx, { supplierId: id, expectedVersion })
    : runOperationInProcess(customerOps.restoreCustomer, f.ctx, { customerId: id, expectedVersion });
  async function target(f: OrderFixture) { return kind === "supplier" ? f.supplier : f.customer; }
  const command = (f: OrderFixture, id: string, expectedVersion: number, restoring = false, options: RunOptions = {}) => kind === "supplier"
    ? runOperation(restoring ? supplierOps.restoreSupplier : supplierOps.archiveSupplier, f.ctx, { supplierId: id, expectedVersion }, options)
    : runOperation(restoring ? customerOps.restoreCustomer : customerOps.archiveCustomer, f.ctx, { customerId: id, expectedVersion }, options);


  describe(`${kind} archive and restore`, { timeout: TIMEOUT_MS }, () => {
    it("runs the app archive and restore actions with the shared version input", async () => {
      const f = await fixture(); const row = await target(f);
      const archived = kind === "supplier"
        ? await supplierActions.archiveSupplierFn({ supplierId: row.id, expectedVersion: 1 })
        : await customerActions.archiveCustomerFn({ customerId: row.id, expectedVersion: 1 });
      expect(archived).toMatchObject({ success: true, data: { version: 2, archivedAt: expect.any(Date) } });
      const staleEdit = kind === "supplier"
        ? await supplierActions.updateSupplierFn({ supplierId: row.id, expectedVersion: 1, name: "E2E No edit" })
        : await customerActions.updateCustomerFn({ customerId: row.id, expectedVersion: 1, name: "E2E No edit" });
      expect(staleEdit).toMatchObject({ success: false, code: "not_found", issues: [expect.objectContaining({ path: [`${kind}Id`] })] });
      const restored = kind === "supplier"
        ? await supplierActions.restoreSupplierFn({ supplierId: row.id, expectedVersion: 2 })
        : await customerActions.restoreCustomerFn({ customerId: row.id, expectedVersion: 2 });
      expect(restored).toMatchObject({ success: true, data: { version: 3, archivedAt: null } });
    });

    it("returns archived-name conflict metadata on create and rename, retaining active clash copy", async () => {
      const f = await fixture(); const row = await target(f);
      await archive(f, row.id, 1);
      const foreign = await fixture();
      const foreignRow = kind === "supplier"
        ? (await runOperationInProcess(supplierOps.createSupplier, foreign.ctx, { name: row.name, locations: [site] })).supplier
        : (await runOperationInProcess(customerOps.createCustomer, foreign.ctx, { name: row.name, locations: [site] })).customer;
      await archive(foreign, foreignRow.id, 1);
      const clash = { code: "conflict", message: `A ${kind} named "${row.name.toUpperCase()}" is archived. Restore it, or choose another name.`,
        issues: [expect.objectContaining({ path: ["name"], meta: { [`${kind}Id`]: row.id, archived: true } })] };
      const create = (name: string) => kind === "supplier"
        ? runOperationInProcess(supplierOps.createSupplier, f.ctx, { name, locations: [site] }).then(result => result.supplier)
        : runOperationInProcess(customerOps.createCustomer, f.ctx, { name, locations: [site] }).then(result => result.customer);
      await expect(create(`  ${row.name.toUpperCase()}  `)).rejects.toMatchObject(clash);
      const other = await create("E2E Different party");
      const rename = (name: string) => kind === "supplier"
        ? runOperation(supplierOps.updateSupplier, f.ctx, { supplierId: other.id, expectedVersion: 1, name })
        : runOperation(customerOps.updateCustomer, f.ctx, { customerId: other.id, expectedVersion: 1, name });
      await expect(rename(row.name.toUpperCase())).rejects.toMatchObject(clash);
      await restore(f, row.id, 2);
      await expect(rename(row.name)).rejects.toMatchObject({ code: "conflict", message: `A ${kind} named "${row.name}" already exists. Rename the existing ${kind} to reuse this name.` });
      expect(await db.select().from(table).where(eq(table.id, other.id))).toMatchObject([{ version: 1, name: "E2E Different party" }]);
    });

    it.each([false, true])("replays a keyed command after the opposite transition, restore: %s", async restoring => {
      const f = await fixture(); const row = await target(f);
      if (restoring) await archive(f, row.id, 1);
      const version = restoring ? 2 : 1;
      const options = { idempotency: { credentialId: "party-archive-test", key: crypto.randomUUID() } };
      const first = await command(f, row.id, version, restoring, options);
      await command(f, row.id, version + 1, !restoring);
      expect(await command(f, row.id, version, restoring, options)).toMatchObject({ replayed: true, data: first.data, effect: first.effect });
      expect(await db.select().from(table).where(eq(table.id, row.id))).toMatchObject([{ version: version + 2, archivedAt: restoring ? expect.any(Date) : null }]);
      expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, row.id))).toHaveLength(restoring ? 3 : 2);
    });

    it("rolls back row, version, locations and Activity on both dry-run transitions", async () => {
      const f = await fixture(); const row = await target(f);
      const locations = kind === "supplier" ? await getSupplierLocationsBySupplier(f.ctx, row.id) : await getCustomerLocations(f.ctx, row.id);
      expect(await command(f, row.id, 1, false, { dryRun: true })).toMatchObject({ dryRun: true, data: { version: 2, archivedAt: expect.any(String) } });
      expect(await db.select().from(table).where(eq(table.id, row.id))).toMatchObject([{ version: 1, archivedAt: null }]);
      expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, row.id))).toEqual([]);
      const archived = await archive(f, row.id, 1);
      await command(f, row.id, 2, true, { dryRun: true });
      expect(await db.select().from(table).where(eq(table.id, row.id))).toMatchObject([{ version: 2, archivedAt: archived.archivedAt }]);
      expect(kind === "supplier" ? await getSupplierLocationsBySupplier(f.ctx, row.id) : await getCustomerLocations(f.ctx, row.id)).toEqual(locations);
      expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, row.id))).toHaveLength(1);
    });

    it("refuses archived PATCH before stale versions and permits archived deletes without blockers", async () => {
      const f = await fixture(); const row = await target(f);
      let customerOrder: { id: string; code: string } | undefined;
      let deliveryId: string | undefined;
      if (kind === "customer") {
        const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
        customerOrder = { id: order.id, code: order.code };
        deliveryId = (await insertReadDelivery(f, order.id, order.quantityKg, true)).id;
        await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, order.id));
      } else {
        await db.update(feedstocks).set({ archivedAt: new Date() }).where(eq(feedstocks.id, f.intake.id));
      }
      await archive(f, row.id, 1);
      for (const expectedVersion of [1, 2]) {
        const update = kind === "supplier"
          ? runOperation(supplierOps.updateSupplier, f.ctx, { supplierId: row.id, expectedVersion, name: "E2E No edit" })
          : runOperation(customerOps.updateCustomer, f.ctx, { customerId: row.id, expectedVersion, name: "E2E No edit" });
        await expect(update).rejects.toMatchObject({ ...issue("not_found", kind), message: `${noun} ${row.code} is archived. Restore it before editing it.` });
      }
      const remove = (id: string, expectedVersion: number) => kind === "supplier"
        ? runOperation(supplierOps.deleteSupplier, f.ctx, { supplierId: id, expectedVersion })
        : runOperation(customerOps.deleteCustomer, f.ctx, { customerId: id, expectedVersion });
      await expect(remove(row.id, 2)).rejects.toMatchObject(issue("conflict", kind));
      if (kind === "customer") {
        await db.delete(deliveries).where(eq(deliveries.id, deliveryId!));
        expect(await remove(row.id, 2)).toMatchObject({ data: { customer: { id: row.id }, cascade: { orders: [customerOrder] } } });
        expect(await db.select().from(orders).where(eq(orders.id, customerOrder!.id))).toEqual([]);
        expect(await db.select().from(customers).where(eq(customers.id, row.id))).toEqual([]);
      }
      const spare = kind === "supplier"
        ? (await runOperationInProcess(supplierOps.createSupplier, f.ctx, { name: "E2E Unused supplier", locations: [site] })).supplier
        : (await runOperationInProcess(customerOps.createCustomer, f.ctx, { name: "E2E Unused customer", locations: [site] })).customer;
      await archive(f, spare.id, 1);
      expect(await remove(spare.id, 2)).toMatchObject({ data: kind === "supplier" ? null : { customer: { id: spare.id }, cascade: { orders: [] }, warnings: [] } });
    });

    it("refuses missing and foreign command targets without touching foreign rows", async () => {
      const f = await fixture(); const foreign = await fixture(); const row = await target(foreign);
      for (const restoring of [false, true]) for (const id of [row.id, crypto.randomUUID()]) {
        await expect(command(f, id, 1, restoring)).rejects.toMatchObject(issue("not_found", kind));
      }
      expect(await db.select().from(table).where(eq(table.id, row.id))).toMatchObject([{ version: 1, archivedAt: null }]);
    });

    it("versions each transition, refuses stale versions before state conflicts and records one event", async () => {
      const f = await fixture(); const row = await target(f);
      expect(await archive(f, row.id, 1)).toMatchObject({ version: 2, archivedAt: expect.any(Date) });
      await expect(archive(f, row.id, 1)).rejects.toMatchObject({ code: "stale_version" });
      await expect(archive(f, row.id, 2)).rejects.toMatchObject({ ...issue("conflict", kind), message: `${noun} ${row.code} is already archived.` });
      expect(await restore(f, row.id, 2)).toMatchObject({ version: 3, archivedAt: null });
      await expect(restore(f, row.id, 2)).rejects.toMatchObject({ code: "stale_version" });
      await expect(restore(f, row.id, 3)).rejects.toMatchObject({ ...issue("conflict", kind), message: `${noun} ${row.code} is not archived.` });
      expect(await db.select().from(table).where(eq(table.id, row.id))).toMatchObject([{ version: 3, archivedAt: null }]);
      expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, row.id)).orderBy(activityEvents.sequence)).toMatchObject([
        { action: "status_changed", fromStatus: "active", toStatus: "archived", changedFields: [], changes: {}, versionBefore: 1, versionAfter: 2 },
        { action: "status_changed", fromStatus: "archived", toStatus: "active", changedFields: [], changes: {}, versionBefore: 2, versionAfter: 3 },
      ]);
    });
  });
}

describe("archived parties on new references", { timeout: TIMEOUT_MS }, () => {
  it("refuses a stale intake version before an echoed supplier archived after a repoint", async () => {
    const f = await fixture();
    const intake = (await runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f))).data.feedstocks[0];
    const other = (await runOperationInProcess(supplierOps.createSupplier, f.ctx, { name: "E2E Repoint supplier", locations: [site] })).supplier;
    const repointed = (await runOperation(updateFeedstock, f.ctx, {
      feedstockId: intake.id, expectedVersion: intake.version, supplierId: other.id,
    })).data;
    await runOperation(supplierOps.archiveSupplier, f.ctx, { supplierId: f.supplier.id, expectedVersion: 1 });

    await expect(runOperation(updateFeedstock, f.ctx, {
      feedstockId: intake.id, expectedVersion: intake.version, supplierId: intake.supplierId,
    })).rejects.toMatchObject({ code: "stale_version" });
    await expect(runOperation(updateFeedstock, f.ctx, {
      feedstockId: intake.id, expectedVersion: repointed.version, supplierId: intake.supplierId,
    })).rejects.toMatchObject(issue("not_found", "supplier"));
  });

  it("refuses intake create and supplier repoints, while omitted and echoed ids and facility edits keep the supplier", async () => {
    const f = await fixture();
    const intake = (await runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f))).data.feedstocks[0];
    const other = (await runOperationInProcess(supplierOps.createSupplier, f.ctx, { name: "E2E Other supplier", locations: [site] })).supplier;
    await createSupplierLocation(f.ctx, { ...site, supplierId: f.supplier.id, isDefault: true,
      facilityDistances: [{ facilityId: f.otherFacility.id, distanceKm: 42, distanceSource: "manual" }] });
    const [otherBin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.otherFacility.id,
      code: "E2E-OTHER-BIN", name: "E2E Other intake bin", type: "feedstock_bin", feedstockTypeId: f.intake.feedstockTypeId }).returning();
    await runOperation(supplierOps.archiveSupplier, f.ctx, { supplierId: f.supplier.id, expectedVersion: 1 });
    await expect(runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f))).rejects.toMatchObject({
      ...issue("not_found", "supplier"), message: `Supplier ${f.supplier.code} is archived. Restore it or choose another supplier.`,
    });
    await expect(runOperation(updateFeedstock, f.ctx, { feedstockId: intake.id, expectedVersion: 1, notes: "Kept" })).resolves.toMatchObject({ data: { version: 2 } });
    await expect(runOperation(updateFeedstock, f.ctx, { feedstockId: intake.id, expectedVersion: 2, supplierId: f.supplier.id, notes: "Echoed" }))
      .resolves.toMatchObject({ data: { version: 3, supplierId: f.supplier.id } });
    // The receiving bin follows the facility change; the supplier stays stored.
    await expect(runOperation(updateFeedstock, f.ctx, { feedstockId: intake.id, expectedVersion: 3, facilityId: f.otherFacility.id, storageLocationId: otherBin.id }))
      .resolves.toMatchObject({ data: { version: 4, supplierId: f.supplier.id, facilityId: f.otherFacility.id } });
    expect(await getTransportLegsForEntity(f.ctx, "feedstock", intake.id)).toMatchObject([expect.objectContaining({ distanceKm: 42, distanceSource: "manual" })]);
    const fresh = (await runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f, other.id))).data.feedstocks[0];
    await expect(runOperation(updateFeedstock, f.ctx, { feedstockId: fresh.id, expectedVersion: fresh.version, supplierId: f.supplier.id }))
      .rejects.toMatchObject(issue("not_found", "supplier"));
  });

  it("replays saved intake and order creates after party archive", async () => {
    const f = await fixture();
    const options = { idempotency: { credentialId: "party-create-test", key: crypto.randomUUID() } };
    const intake = await runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f), options);
    const orderOptions = { idempotency: { ...options.idempotency, key: crypto.randomUUID() } };
    const order = await runOperation(recordOrder, f.ctx, orderInput(f), orderOptions);
    await runOperation(supplierOps.archiveSupplier, f.ctx, { supplierId: f.supplier.id, expectedVersion: 1 });
    await runOperation(customerOps.archiveCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 });
    expect(await runOperation(logFeedstockDelivery, f.ctx, partyIntakeInput(f), options)).toMatchObject({ replayed: true, data: intake.data });
    expect(await runOperation(recordOrder, f.ctx, orderInput(f), orderOptions)).toMatchObject({ replayed: true, data: order.data });
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, intake.data.feedstocks[0].id))).toHaveLength(1);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, order.data.id))).toHaveLength(1);
  });

  it("refuses order create and destination changes but permits omitted and echoed customer references", async () => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    const destination = await createOrderDestination(f);
    const otherDestination = await createOrderDestination(f, f.otherCustomer.id);
    await runOperation(customerOps.archiveCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 });
    await expect(runOperation(recordOrder, f.ctx, orderInput(f))).rejects.toMatchObject(issue("not_found", "customer"));
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, customerLocationId: destination.id }))
      .rejects.toMatchObject({ ...issue("not_found", "customer"), message: `Customer ${f.customer.code} is archived. Restore it or choose another customer.` });
    expect((await runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 1, quantityKg: 200 })).data).toMatchObject({ version: 2, quantityKg: 200 });
    expect((await runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 2, customerId: f.customer.id, customerLocationId: f.location.id, quantityKg: 300 })).data)
      .toMatchObject({ version: 3, quantityKg: 300 });
    await runOperation(customerOps.archiveCustomer, f.ctx, { customerId: f.otherCustomer.id, expectedVersion: 1 });
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 3, customerId: f.otherCustomer.id, customerLocationId: otherDestination.id }))
      .rejects.toMatchObject(issue("not_found", "customer"));
  });
});

describe("archived party locations and reads", { timeout: TIMEOUT_MS }, () => {
  it("refuses supplier location edits under archived parents and preserves parent versions", async () => {
    const f = await fixture();
    const supplier = (await runOperationInProcess(supplierOps.createSupplier, f.ctx, { name: "E2E Locations supplier", locations: [site] })).supplier;
    const [source] = await getSupplierLocationsBySupplier(f.ctx, supplier.id);
    await runOperation(supplierOps.archiveSupplier, f.ctx, { supplierId: supplier.id, expectedVersion: 1 });
    await runOperation(customerOps.archiveCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 });
    const pairs = [{ facilityId: f.facility.id, distanceKm: 15, distanceSource: "manual" as const }];
    for (const facilityDistances of [undefined, pairs]) {
      await expect(createSupplierLocation(f.ctx, { ...site, supplierId: supplier.id, facilityDistances, isDefault: true })).rejects.toMatchObject(issue("not_found", "supplier"));
      await expect(db.transaction(tx => createSupplierLocationInTransaction(f.ctx, tx, supplier.id, { ...site, facilityDistances, isDefault: true }))).rejects.toMatchObject(issue("not_found", "supplier"));
      await expect(updateSupplierLocation(f.ctx, source.id, { expectedVersion: source.version, isDefault: true, facilityDistances })).rejects.toMatchObject(issue("not_found", "supplier"));
      await expect(createCustomerLocation(f.ctx, { ...site, customerId: f.customer.id, facilityDistances, isDefault: true })).rejects.toMatchObject(issue("not_found", "customer"));
      await expect(updateCustomerLocation(f.ctx, f.location.id, { expectedVersion: f.location.version, isDefault: true, facilityDistances })).rejects.toMatchObject(issue("not_found", "customer"));
    }
    await expect(deleteSupplierLocation(f.ctx, source.id, source.version)).rejects.toMatchObject(issue("not_found", "supplier"));
    await expect(deleteCustomerLocation(f.ctx, f.location.id, f.location.version)).rejects.toMatchObject(issue("not_found", "customer"));
    expect(await getSupplierLocationsBySupplier(f.ctx, supplier.id)).toEqual([source]);
    expect(await getCustomerLocations(f.ctx, f.customer.id)).toMatchObject([{ id: f.location.id }]);
    expect(await getSupplierById(f.ctx, supplier.id)).toMatchObject({ version: 2, archivedAt: expect.any(Date) });
    expect(await getCustomerWithRelations(f.ctx, f.customer.id)).toMatchObject({ version: 2, archivedAt: expect.any(Date) });
  });

  it("hides archived search choices, hydrates them by id and filters app lists through the schemas", async () => {
    const f = await fixture();
    const supplier = (await runOperationInProcess(supplierOps.createSupplier, f.ctx, { name: "E2E Picker supplier", locations: [site] })).supplier;
    await runOperation(supplierOps.archiveSupplier, f.ctx, { supplierId: supplier.id, expectedVersion: 1 });
    await runOperation(customerOps.archiveCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 });
    for (const [entityType, row] of [["supplier", supplier], ["customer", f.customer]] as const) {
      expect(await getEntities(f.ctx, { entityType, search: row.code })).toEqual([]);
      expect(await getEntityById(f.ctx, entityType, row.id)).toMatchObject({ id: row.id, subtitle: "Archived", archived: true });
    }
    expect(await getEntities(f.ctx, { entityType: "customer", search: f.customer.code, filterBy: { includeArchived: "true" } }))
      .toMatchObject([expect.objectContaining({ id: f.customer.id, subtitle: "Archived", archived: true })]);
    expect(await getSuppliers(f.ctx, supplierFilterSchema.parse({ search: supplier.code }))).toMatchObject({ total: 0, items: [] });
    expect(await getSuppliers(f.ctx, supplierFilterSchema.parse({ archived: true }))).toMatchObject({ total: 1, items: [expect.objectContaining({ id: supplier.id })] });
    expect(await getCustomers(f.ctx)).toMatchObject({ total: 1, items: [expect.objectContaining({ id: f.otherCustomer.id })] });
    expect(await getCustomers(f.ctx, customerFilterSchema.parse({ archived: true }))).toMatchObject({ total: 1, items: [expect.objectContaining({ id: f.customer.id })] });
    const foreign = await fixture();
    expect(await getEntityById(foreign.ctx, "supplier", supplier.id)).toBeNull();
    expect(await getEntityById(foreign.ctx, "customer", f.customer.id)).toBeNull();
    expect(await getSuppliers(foreign.ctx, { archived: true })).toMatchObject({ total: 0 });
    expect(await getCustomers(foreign.ctx, { archived: true })).toMatchObject({ total: 0 });
  });
});


describe("existing order continuation under an archived customer", { timeout: TIMEOUT_MS }, () => {
  it("keeps deliveries, applications, site registration and historical reads", async () => {
    const f = await fixture();
    await db.update(storageLocations).set({ stockMode: "mix" }).where(eq(storageLocations.id, f.bin.id));
    await runOperation(makeBiocharProduct, f.ctx, {
      facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: "2026-09-12T12:00:00Z",
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: null, wetMassKg: 20, moisturePercent: 0 }],
    });
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await runOperation(customerOps.archiveCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 });
    const delivery = (await runOperation(recordDelivery, f.ctx, {
      orderId: order.id, storageLocationId: f.bin.id, deliveredAt: "2026-09-14T12:00:00Z", deliveredWetMassKg: 20, moisturePercent: 20,
    })).data.delivery;
    const application = (await runOperation(recordApplication, f.ctx, {
      deliveryId: delivery.id, applicationDate: "2026-09-15", appliedWetMassKg: 10, fieldSizeHa: 1,
      gpsLatitude: f.location.gpsLatitude, gpsLongitude: f.location.gpsLongitude, soilTemperatureC: null,
    })).data.application;
    const [project] = await db.insert(certifierProjects).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
      provider: "isometric", externalProjectId: `prj-${f.tag}`, externalFacilityId: `fcl-${f.tag}` }).returning();
    expect(await getStorageLocationRegistryInput(f.ctx, application.id)).toMatchObject({ customerLocationId: f.location.id, certifierProjectId: project.id });
    const payload = buildCreateStorageLocationRequest({ externalProjectId: project.externalProjectId, name: f.location.name,
      latitude: f.location.gpsLatitude, longitude: f.location.gpsLongitude, supplierReferenceId: f.location.id });
    const mapping = await persistStorageLocationRegistration(f.ctx, { customerLocationId: f.location.id, certifierProjectId: project.id,
      externalProjectId: project.externalProjectId, externalStorageLocationId: `slc-${f.tag}`, supplierReference: f.location.id, submittedPayload: payload, payloadHash: "test" });
    expect(await getStorageLocationRegistration(f.ctx, f.location.id, project.externalProjectId)).toMatchObject({ id: mapping.id, submittedPayload: payload });
    expect(await getOrderWithRelationsById(f.ctx, order.id)).toMatchObject({ customerId: f.customer.id, customerName: f.customer.name });
    expect(await getDeliveryWithRelations(f.ctx, delivery.id)).toMatchObject({ orderId: order.id });
    expect(await getApplicationById(f.ctx, application.id)).toMatchObject({ deliveryId: delivery.id, biocharAppliedTons: 0.01 });
    expect(await getCustomerWithRelations(f.ctx, f.customer.id)).toMatchObject({ archivedAt: expect.any(Date), version: 2, locations: [expect.objectContaining({ id: f.location.id })] });
    await expect(runOperation(customerOps.deleteCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 2 })).rejects.toMatchObject(issue("conflict", "customer"));
    // Archive/restore never rewrites mappings or submitted payloads.
    await runOperation(customerOps.restoreCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 2 });
    expect(await db.select().from(certifierStorageLocations).where(eq(certifierStorageLocations.id, mapping.id))).toEqual([mapping]);
  });
});
