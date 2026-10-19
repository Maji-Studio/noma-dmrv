import type { OrgContext } from "@/lib/auth/server";
let currentCtx: OrgContext;
vi.mock("@/lib/auth/server", () => ({ requireOrgContext: () => currentCtx }));
import { archiveCustomerLocationFn, restoreCustomerLocationFn } from "@/fn/customers";
import { archiveCustomer } from "@/lib/operations/customers";
import { storageLocations, certifierProjects, certifierStorageLocations } from "@/db/schema";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordDelivery } from "@/lib/operations/deliveries";
import { recordApplication } from "@/lib/operations/applications";
import { getOrderWithRelationsById } from "@/data-access/orders";
import { getDeliveryWithRelations } from "@/data-access/deliveries";
import { getApplicationById } from "@/data-access/applications";
import { getCustomerWithRelations } from "@/data-access/customers";
import { getStorageLocationRegistryInput, persistStorageLocationRegistration, getStorageLocationRegistration } from "@/data-access/certifier-storage-locations";
import { buildCreateStorageLocationRequest } from "@/lib/isometric/storage-locations";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, customerLocations } from "@/db/schema";
import { addCustomerLocation, archiveCustomerLocation, restoreCustomerLocation, updateCustomerLocation, deleteCustomerLocation } from "@/lib/operations/customer-locations";
import { runOperation } from "@/lib/operations/runner";
import { recordOrder, updateOrder } from "@/lib/operations/orders";
import { getCustomerLocations, getCustomers } from "@/data-access/customers";
import { getCustomerLocationsEntity, getCustomerLocationEntityById } from "@/data-access/entities/customer-locations";
import { createPartyArchiveFixture, cleanupPartyArchiveFixture, type PartyArchiveFixture } from "./helpers/party-archive-fixture";
import { createOrderDestination, orderInput } from "./helpers/order-operation-fixture";
import { TEST_SITE_POSITION } from "./helpers/test-org";

const TIMEOUT_MS = 60_000;
const fixtures: PartyArchiveFixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupPartyArchiveFixture(f); });
async function fixture() {
  const f = await createPartyArchiveFixture(); fixtures.push(f); currentCtx = f.ctx;
  await db.update(customerLocations).set({ isDefault: true }).where(eq(customerLocations.id, f.location.id));
  return f;
}
const input = (locationId: string, expectedVersion = 1) => ({ locationId, expectedVersion });
const missing = { code: "not_found", issues: [expect.objectContaining({ path: ["customerLocationId"] })] };

describe("customer location archive", { timeout: TIMEOUT_MS }, () => {
  it("runs the app actions with validated versions", async () => {
    const f = await fixture(); await createOrderDestination(f);
    expect(await archiveCustomerLocationFn(input(f.location.id))).toMatchObject({ success: true, data: { version: 2, archivedAt: expect.any(Date) } });
    expect(await restoreCustomerLocationFn(input(f.location.id, 2))).toMatchObject({ success: true, data: { version: 3, archivedAt: null } });
  });

  it("refuses foreign and wrong-parent locations and edits under archived parents", async () => {
    const f = await fixture(); const foreign = await fixture();
    for (const operation of [archiveCustomerLocation, restoreCustomerLocation]) {
      for (const locationId of [crypto.randomUUID(), foreign.location.id]) {
        await expect(runOperation(operation, f.ctx, input(locationId))).rejects.toMatchObject({ code: "not_found" });
      }
      await expect(runOperation(operation, f.ctx, { ...input(f.location.id), customerId: f.otherCustomer.id })).rejects.toMatchObject({ code: "not_found" });
    }
    await runOperation(archiveCustomer, f.ctx, { customerId: f.customer.id, expectedVersion: 1 });
    for (const operation of [archiveCustomerLocation, restoreCustomerLocation]) {
      await expect(runOperation(operation, f.ctx, input(f.location.id))).rejects.toMatchObject({ code: "not_found",
        message: `Customer ${f.customer.code} is archived. Restore it before editing it.`, issues: [expect.objectContaining({ path: ["customerId"] })] });
    }
  });

  it("moves the default, records status and sibling Activity, and rolls back dry runs", async () => {
    const f = await fixture(); const sibling = await createOrderDestination(f);
    const preview = await runOperation(archiveCustomerLocation, f.ctx, input(f.location.id), { dryRun: true });
    expect(preview.data).toMatchObject({ version: 2, isDefault: false, warnings: [`${sibling.name} is now the default location.`] });
    expect(await getCustomerLocations(f.ctx, f.customer.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.location.id, version: 1, archivedAt: null })]));
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toEqual([]);
    await runOperation(archiveCustomerLocation, f.ctx, input(f.location.id));
    expect(await getCustomerLocations(f.ctx, f.customer.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: sibling.id, version: 2, isDefault: true }),
      expect.objectContaining({ id: f.location.id, version: 2, isDefault: false, archivedAt: expect.any(Date) }),
    ]));
    const events = await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId));
    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: f.location.id, action: "status_changed", fromStatus: "active", toStatus: "archived", changedFields: [], changes: {} }),
      expect.objectContaining({ entityId: sibling.id, action: "updated", changedFields: ["isDefault"] }),
    ]));
  });

  it("refuses the last active location and stale transitions, then restores without stealing a default", async () => {
    const f = await fixture();
    await expect(runOperation(archiveCustomerLocation, f.ctx, input(f.location.id))).rejects.toMatchObject({ code: "conflict", message: `${f.location.name} is this customer's only active location, so it cannot be archived. Add or restore another location first.` });
    await createOrderDestination(f);
    await runOperation(archiveCustomerLocation, f.ctx, input(f.location.id));
    await expect(runOperation(archiveCustomerLocation, f.ctx, input(f.location.id))).rejects.toMatchObject({ code: "stale_version" });
    await expect(runOperation(archiveCustomerLocation, f.ctx, input(f.location.id, 2))).rejects.toMatchObject({ code: "conflict", message: `Customer location ${f.location.name} is already archived.` });
    expect((await runOperation(restoreCustomerLocation, f.ctx, input(f.location.id, 2))).data).toMatchObject({ version: 3, archivedAt: null, isDefault: false });
    await expect(runOperation(restoreCustomerLocation, f.ctx, input(f.location.id, 3))).rejects.toMatchObject({ code: "conflict", message: `Customer location ${f.location.name} is not archived.` });
  });

  it("restores the default when none remains and enforces the database backstop", async () => {
    const f = await fixture();
    await expect(db.update(customerLocations).set({ archivedAt: new Date() }).where(eq(customerLocations.id, f.location.id))).rejects.toMatchObject({ cause: { code: "23514", constraint: "customer_locations_default_active" } });
    await db.update(customerLocations).set({ archivedAt: new Date(), isDefault: false }).where(eq(customerLocations.id, f.location.id));
    expect((await runOperation(restoreCustomerLocation, f.ctx, input(f.location.id))).data).toMatchObject({ archivedAt: null, isDefault: true, version: 2 });
  });

  it("hides archived picker destinations, keeps detail hydration, and refuses PATCH before row versions", async () => {
    const f = await fixture(); const sibling = await createOrderDestination(f);
    await runOperation(archiveCustomerLocation, f.ctx, input(f.location.id));
    expect(await getCustomerLocationsEntity(f.ctx, { customerId: f.customer.id, limit: 20 })).toMatchObject([{ id: sibling.id }]);
    expect(await getCustomerLocationEntityById(f.ctx, f.location.id)).toMatchObject({ archived: true, subtitle: "Archived" });
    expect((await getCustomers(f.ctx)).items.find(row => row.id === f.customer.id)).toMatchObject({ locationCount: 1 });
    for (const expectedVersion of [1, 2]) await expect(runOperation(updateCustomerLocation, f.ctx, { ...input(f.location.id, expectedVersion), isDefault: true })).rejects.toMatchObject({
      code: "not_found", message: `Customer location ${f.location.name} is archived. Restore it before editing it.`, issues: [expect.objectContaining({ path: ["locationId"] })],
    });
  });

  it("deletes unused archived locations and promotes only active siblings", async () => {
    const f = await fixture(); const retired = await createOrderDestination(f); const active = await createOrderDestination(f);
    await runOperation(archiveCustomerLocation, f.ctx, input(retired.id));
    await runOperation(deleteCustomerLocation, f.ctx, input(f.location.id));
    expect(await getCustomerLocations(f.ctx, f.customer.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: active.id, isDefault: true, version: 2 }),
      expect.objectContaining({ id: retired.id, isDefault: false, version: 2 }),
    ]));
    await runOperation(deleteCustomerLocation, f.ctx, input(retired.id, 2));
    expect(await getCustomerLocationEntityById(f.ctx, retired.id)).toBeNull();
  });

  it("makes an added location the default when only archived locations remain", async () => {
    const f = await fixture(); const retired = await createOrderDestination(f);
    await runOperation(archiveCustomerLocation, f.ctx, input(retired.id));
    await runOperation(deleteCustomerLocation, f.ctx, input(f.location.id));
    const added = await runOperation(addCustomerLocation, f.ctx, {
      ...TEST_SITE_POSITION, customerId: f.customer.id, name: `E2E Fresh Field ${crypto.randomUUID().slice(0, 8)}`,
    });
    expect(added).toMatchObject({ data: { isDefault: true } });
  });

  it("refuses new and changed destinations but keeps omitted and echoed references", async () => {
    const f = await fixture(); const sibling = await createOrderDestination(f);
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    const other = await createOrderDestination(f, f.otherCustomer.id);
    await createOrderDestination(f, f.otherCustomer.id);
    await runOperation(archiveCustomerLocation, f.ctx, input(f.location.id));
    await runOperation(archiveCustomerLocation, f.ctx, input(other.id));
    await expect(runOperation(recordOrder, f.ctx, orderInput(f))).rejects.toMatchObject(missing);
    let version = order.version;
    for (const patch of [{ quantityKg: 200 }, { customerId: f.customer.id, quantityKg: 200 }, { customerLocationId: f.location.id, quantityKg: 200 }, { customerId: f.customer.id, customerLocationId: f.location.id, quantityKg: 200 }]) {
      await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: version++, ...patch })).resolves.toMatchObject({ data: { customerLocationId: f.location.id } });
    }
    const activeOrder = (await runOperation(recordOrder, f.ctx, orderInput(f, { customerLocationId: sibling.id }))).data;
    for (const patch of [{ customerLocationId: f.location.id }, { customerId: f.customer.id, customerLocationId: f.location.id }, { customerId: f.otherCustomer.id, customerLocationId: other.id }]) {
      await expect(runOperation(updateOrder, f.ctx, { orderId: activeOrder.id, expectedVersion: 1, ...patch })).rejects.toMatchObject(missing);
    }
  });
});

describe("existing order continuation at an archived destination", { timeout: TIMEOUT_MS }, () => {
  it("keeps deliveries, applications, site registration and historical reads", async () => {
    const f = await fixture();
    await createOrderDestination(f);
    await db.update(storageLocations).set({ stockMode: "mix" }).where(eq(storageLocations.id, f.bin.id));
    await runOperation(makeBiocharProduct, f.ctx, {
      facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: "2026-09-12T12:00:00Z",
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: null, wetMassKg: 20, moisturePercent: 0 }],
    });
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await runOperation(archiveCustomerLocation, f.ctx, input(f.location.id));
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
    expect(await getCustomerWithRelations(f.ctx, f.customer.id)).toMatchObject({ archivedAt: null, version: 1, locations: expect.arrayContaining([expect.objectContaining({ id: f.location.id, archivedAt: expect.any(Date) })]) });
    // Archive/restore never rewrites mappings or submitted payloads.
    await runOperation(restoreCustomerLocation, f.ctx, input(f.location.id, 2));
    expect(await db.select().from(certifierStorageLocations).where(eq(certifierStorageLocations.id, mapping.id))).toEqual([mapping]);
  });
});
