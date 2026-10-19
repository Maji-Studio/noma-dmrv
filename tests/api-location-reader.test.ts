import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations, customers, supplierLocations, suppliers, customerLocationFacilityDistances, supplierLocationFacilityDistances } from "@/db/schema";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { findApiCustomerLocation, listApiCustomerLocations } from "@/data-access/api-customer-locations";
import { findApiSupplierLocation, listApiSupplierLocations } from "@/data-access/api-supplier-locations";
import { readApiCustomerLocation } from "@/lib/read-models/api-customer-locations";
import { readApiSupplierLocation } from "@/lib/read-models/api-supplier-locations";
import { getCustomerLocations } from "@/data-access/customers";
import { findCustomerWithRelations } from "@/data-access/customer-detail";
import { representationEtag } from "@/lib/api/etag";
import { CUSTOMER_LOCATION_REPRESENTATION_REVISION, SUPPLIER_LOCATION_REPRESENTATION_REVISION } from "@/config/api-rest";
import { representCustomerLocation } from "@/lib/representations/customer-locations";
import { representSupplierLocation } from "@/lib/representations/supplier-locations";
import { createOrderFixture, cleanupOrderFixture, type OrderFixture } from "./helpers/order-operation-fixture";
import { TEST_SITE_POSITION } from "./helpers/test-org";

const TIMEOUT_MS = 60_000;
const LIST_LIMIT = 50;
const ARCHIVED_AT = new Date("2026-10-16T12:00:00Z");
type ReaderFixture = OrderFixture & {
  supplier: typeof suppliers.$inferSelect;
  supplierLocation: typeof supplierLocations.$inferSelect;
  otherSupplier: typeof suppliers.$inferSelect;
};
const fixtures: ReaderFixture[] = [];

async function fixture(): Promise<ReaderFixture> {
  const f = await createOrderFixture();
  const [supplier] = await db.insert(suppliers).values({ organizationId: f.ctx.organizationId,
    code: `E2E-LOCATION-${randomUUID()}`, name: `E2E Location ${randomUUID()}` }).returning();
  const [supplierLocation] = await db.insert(supplierLocations).values({ ...TEST_SITE_POSITION,
    organizationId: f.ctx.organizationId, supplierId: supplier.id, isDefault: true }).returning();
  const [otherSupplier] = await db.insert(suppliers).values({ organizationId: f.ctx.organizationId,
    code: `E2E-OTHER-${randomUUID()}`, name: `E2E Other ${randomUUID()}` }).returning();
  for (const [table, locationId] of [
    [customerLocationFacilityDistances, f.location.id],
    [supplierLocationFacilityDistances, supplierLocation.id],
  ] as const) {
    // Insert in reverse UUID order so sorting cannot depend on insertion order.
    const facilities = [f.facility, f.otherFacility].sort((a, b) => b.id.localeCompare(a.id));
    await db.insert(table).values(facilities.map(facility => ({ organizationId: f.ctx.organizationId,
      locationId, facilityId: facility.id, distanceKm: facility.id === f.facility.id ? 20 : 80,
      distanceSource: "document" as const })));
  }
  const result = { ...f, supplier, supplierLocation, otherSupplier };
  fixtures.push(result);
  return result;
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, f.ctx.organizationId));
    await db.delete(suppliers).where(and(eq(suppliers.organizationId, f.ctx.organizationId), inArray(suppliers.id, [f.supplier.id, f.otherSupplier.id])));
    await cleanupOrderFixture(f);
  }
}, TIMEOUT_MS);

describe.each(["customer", "supplier"] as const)("API %s location reader", kind => {
  it("keeps every stored pair in facility id order and the same body/version through facility archive and restore", async () => {
    const f = await fixture();
    const read = async () => kind === "customer"
      ? (await listApiCustomerLocations(f.ctx, { customerId: f.customer.id }, LIST_LIMIT)).map(representCustomerLocation)
      : (await listApiSupplierLocations(f.ctx, { supplierId: f.supplier.id }, LIST_LIMIT)).map(representSupplierLocation);
    const before = await read();
    const detail = () => kind === "customer"
      ? readApiCustomerLocation(f.ctx, f.customer.id, f.location.id)
      : readApiSupplierLocation(f.ctx, f.supplier.id, f.supplierLocation.id);
    const beforeDetail = await detail();
    expect(beforeDetail).toEqual(before[0]);
    const rawDetail = () => kind === "customer"
      ? findApiCustomerLocation(f.ctx, f.customer.id, f.location.id)
      : findApiSupplierLocation(f.ctx, f.supplier.id, f.supplierLocation.id);
    const beforeRow = await rawDetail();
    const revision = kind === "customer" ? CUSTOMER_LOCATION_REPRESENTATION_REVISION : SUPPLIER_LOCATION_REPRESENTATION_REVISION;
    const etag = representationEtag(beforeDetail!.version, revision);
    expect(etag).toBe('"1.1"');
    expect(before).toHaveLength(1);
    expect(before[0].version).toBe(1);
    expect(before[0].facilityDistances).toEqual([f.facility, f.otherFacility]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(facility => ({ facilityId: facility.id,
        distanceKm: facility.id === f.facility.id ? 20 : 80, distanceSource: "document" })));
    const archived = await archiveFacility(f.ctx, f.facility.id, f.facility.version);
    expect(await read()).toEqual(before);
    expect(await detail()).toEqual(beforeDetail);
    expect(await rawDetail()).toEqual(beforeRow);
    expect(representationEtag((await detail())!.version, revision)).toBe(etag);
    await restoreFacility(f.ctx, f.facility.id, archived.version);
    expect(await read()).toEqual(before);
    expect(await detail()).toEqual(beforeDetail);
    expect(await rawDetail()).toEqual(beforeRow);
    expect(representationEtag((await detail())!.version, revision)).toBe(etag);
  }, TIMEOUT_MS);

  it("returns null for a missing, foreign or wrong-parent location and keeps each organization's pairs private", async () => {
    const a = await fixture();
    const b = await fixture();
    const find = kind === "customer" ? findApiCustomerLocation : findApiSupplierLocation;
    const parentId = (f: typeof a) => kind === "customer" ? f.customer.id : f.supplier.id;
    const locationId = (f: typeof a) => kind === "customer" ? f.location.id : f.supplierLocation.id;
    const wrongParent = kind === "customer" ? a.otherCustomer.id : a.otherSupplier.id;
    expect(await find(a.ctx, wrongParent, locationId(a))).toBeNull();
    expect(await find(a.ctx, parentId(a), randomUUID())).toBeNull();
    expect(await find(a.ctx, parentId(b), locationId(b))).toBeNull();
    expect(await find(a.ctx, parentId(a), locationId(b))).toBeNull();
    expect(await find(b.ctx, parentId(a), locationId(a))).toBeNull();
    for (const f of [a, b]) {
      const row = await find(f.ctx, parentId(f), locationId(f));
      expect(row?.facilityDistances).toEqual([f.facility, f.otherFacility]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(facility => ({ facilityId: facility.id, facilityName: facility.name,
          distanceKm: facility.id === f.facility.id ? 20 : 80, distanceSource: "document" })));
      const list = kind === "customer"
        ? await listApiCustomerLocations(f.ctx, { customerId: f.customer.id }, LIST_LIMIT)
        : await listApiSupplierLocations(f.ctx, { supplierId: f.supplier.id }, LIST_LIMIT);
      expect(list.map(location => location.facilityDistances)).toEqual([row!.facilityDistances]);
    }
  }, TIMEOUT_MS);

  it("returns detail under an archived party", async () => {
    const f = await fixture();
    if (kind === "customer") {
      await db.update(customers).set({ archivedAt: ARCHIVED_AT })
        .where(and(eq(customers.organizationId, f.ctx.organizationId), eq(customers.id, f.customer.id)));
      expect(await findApiCustomerLocation(f.ctx, f.customer.id, f.location.id)).toMatchObject({ id: f.location.id });
    } else {
      await db.update(suppliers).set({ archivedAt: ARCHIVED_AT })
        .where(and(eq(suppliers.organizationId, f.ctx.organizationId), eq(suppliers.id, f.supplier.id)));
      expect(await findApiSupplierLocation(f.ctx, f.supplier.id, f.supplierLocation.id)).toMatchObject({ id: f.supplierLocation.id });
    }
  }, TIMEOUT_MS);

  it("reads uncommitted locations and pairs through the caller's executor", async () => {
    const f = await fixture();
    await db.transaction(async tx => {
      if (kind === "customer") {
        const [row] = await tx.insert(customerLocations).values({ ...TEST_SITE_POSITION,
          organizationId: f.ctx.organizationId, customerId: f.customer.id, name: "E2E transaction site" }).returning();
        expect(await findApiCustomerLocation(f.ctx, f.customer.id, row.id, tx)).toMatchObject({ facilityDistances: [] });
        await tx.insert(customerLocationFacilityDistances).values({ organizationId: f.ctx.organizationId,
          locationId: row.id, facilityId: f.facility.id, distanceKm: 35, distanceSource: "manual" });
        expect(await findApiCustomerLocation(f.ctx, f.customer.id, row.id, tx)).toMatchObject({ facilityDistances: [{ distanceKm: 35 }] });
        expect(await listApiCustomerLocations(f.ctx, { customerId: f.customer.id }, LIST_LIMIT, undefined, tx))
          .toContainEqual(expect.objectContaining({ id: row.id, facilityDistances: [expect.objectContaining({ distanceKm: 35 })] }));
      } else {
        const [row] = await tx.insert(supplierLocations).values({ ...TEST_SITE_POSITION,
          organizationId: f.ctx.organizationId, supplierId: f.supplier.id }).returning();
        expect(await findApiSupplierLocation(f.ctx, f.supplier.id, row.id, tx)).toMatchObject({ facilityDistances: [] });
        await tx.insert(supplierLocationFacilityDistances).values({ organizationId: f.ctx.organizationId,
          locationId: row.id, facilityId: f.facility.id, distanceKm: 35, distanceSource: "manual" });
        expect(await findApiSupplierLocation(f.ctx, f.supplier.id, row.id, tx)).toMatchObject({ facilityDistances: [{ distanceKm: 35 }] });
        expect(await listApiSupplierLocations(f.ctx, { supplierId: f.supplier.id }, LIST_LIMIT, undefined, tx))
          .toContainEqual(expect.objectContaining({ id: row.id, facilityDistances: [expect.objectContaining({ distanceKm: 35 })] }));
      }
    });
  }, TIMEOUT_MS);
});

it("publishes customer location archive state, lists it only with archived=true, and keeps archived-facility pairs hidden in app readers", async () => {
  const f = await fixture();
  await db.update(customerLocations).set({ archivedAt: ARCHIVED_AT, isDefault: false })
    .where(and(eq(customerLocations.organizationId, f.ctx.organizationId), eq(customerLocations.id, f.location.id)));
  expect(await readApiCustomerLocation(f.ctx, f.customer.id, f.location.id)).toMatchObject({ archivedAt: ARCHIVED_AT.toISOString() });
  expect((await listApiCustomerLocations(f.ctx, { customerId: f.customer.id }, LIST_LIMIT)).map(row => row.id)).not.toContain(f.location.id);
  expect((await listApiCustomerLocations(f.ctx, { customerId: f.customer.id, archived: true }, LIST_LIMIT)).map(representCustomerLocation))
    .toContainEqual(expect.objectContaining({ id: f.location.id, archivedAt: ARCHIVED_AT.toISOString() }));
  await archiveFacility(f.ctx, f.facility.id, f.facility.version);
  for (const locations of [await getCustomerLocations(f.ctx, f.customer.id), (await findCustomerWithRelations(f.ctx, f.customer.id))!.locations]) {
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({ archivedAt: ARCHIVED_AT, facilityDistances: [{ facilityId: f.otherFacility.id, distanceKm: 80 }] });
  }
}, TIMEOUT_MS);
