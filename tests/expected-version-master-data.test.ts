import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { feedstocks, transportLegs, organizations, facilities, reactors, storageLocations, suppliers, supplierLocations, customers, customerLocations, formulations, feedstockTypes, facilityEmissionFactors } from "@/db/schema";
import { createFeedstockInTransaction } from "@/data-access/feedstocks";
import { updateFacility } from "@/data-access/facility-mutations";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { updateReactor, deleteReactor } from "@/data-access/reactors";
import { updateStorageLocation, archiveStorageLocation, restoreStorageLocation, deleteStorageLocation } from "@/data-access/storage-locations";
import { updateSupplier, deleteSupplier, createSupplierLocation, updateSupplierLocation, deleteSupplierLocation } from "@/data-access/suppliers";
import { updateCustomer, deleteCustomer, createCustomerLocation, updateCustomerLocation, deleteCustomerLocation } from "@/data-access/customers";
import { updateFormulation, deleteFormulation } from "@/data-access/formulations";
import { updateFeedstockType, archiveFeedstockType, unarchiveFeedstockType, deleteFeedstockType } from "@/data-access/feedstock-types";
import { upsertFacilityEmissionFactors } from "@/data-access/facility-emission-factors";
import { makeTestOrgContext } from "./helpers/test-org";

const INITIAL_VERSION = 1;
const VERSION_STEP = 1;
const DELIVERY_MASS_KG = 100;
const MOISTURE_PERCENT = 20;
const STALE = { code: "stale_version" };
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];

async function fixture({ unclaimedBin = false } = {}) {
  const tag = randomUUID();
  const ctx = { ...makeTestOrgContext(), organizationId: `master-version-${tag}` };
  await db.insert(organizations).values({ id: ctx.organizationId, name: "Version test", slug: `master-version-${tag}` });
  const [facility] = await db.insert(facilities).values({ organizationId: ctx.organizationId, code: `FAC-${tag}`, name: `Facility ${tag}`, country: "Tanzania" }).returning();
  const [reactor] = await db.insert(reactors).values({ organizationId: ctx.organizationId, facilityId: facility.id, code: `REA-${tag}`, identifier: "Reactor", reactorType: "batch" }).returning();
  const [feedstockType] = await db.insert(feedstockTypes).values({ organizationId: ctx.organizationId, code: `FST-${tag}`, name: "Feedstock type", category: "forestry", usage: "pyrolysis" }).returning();
  const [bin] = await db.insert(storageLocations).values({ organizationId: ctx.organizationId, facilityId: facility.id, code: `BIN-${tag}`, name: "Bin", type: "feedstock_bin", feedstockTypeId: unclaimedBin ? null : feedstockType.id }).returning();
  const [supplier] = await db.insert(suppliers).values({ organizationId: ctx.organizationId, code: `SUP-${tag}`, name: "Supplier" }).returning();
  const [supplierLocation] = await db.insert(supplierLocations).values({ organizationId: ctx.organizationId, supplierId: supplier.id, country: "Tanzania", isDefault: true }).returning();
  const [customer] = await db.insert(customers).values({ organizationId: ctx.organizationId, code: `CUS-${tag}`, name: "Customer" }).returning();
  const [customerLocation] = await db.insert(customerLocations).values({ organizationId: ctx.organizationId, customerId: customer.id, name: "Location", country: "Tanzania", isDefault: true }).returning();
  const [formulation] = await db.insert(formulations).values({ organizationId: ctx.organizationId, code: `FOR-${tag}`, name: "Formulation" }).returning();
  const factors = await upsertFacilityEmissionFactors(ctx, { facilityId: facility.id, expectedVersion: null, dieselKgCo2ePerLitre: 2, gridKgCo2ePerKwh: 1, roadFreightKgCo2ePerTonneKm: 1, sourceNote: null });
  return { ctx, facility, reactor, bin, supplier, supplierLocation, customer, customerLocation, formulation, feedstockType, factors };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seed(options: Parameters<typeof fixture>[0] = {}) { const f = await fixture(options); fixtures.push(f); return f; }
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    for (const table of [transportLegs, feedstocks, facilityEmissionFactors, supplierLocations, customerLocations, reactors, storageLocations, formulations, feedstockTypes, suppliers, customers, facilities]) {
      await db.delete(table).where(eq(table.organizationId, f.ctx.organizationId));
    }
    await db.delete(organizations).where(eq(organizations.id, f.ctx.organizationId));
  }
});

interface VersionCase {
  name: string;
  update: (f: Fixture, expectedVersion: number, label: string) => Promise<{ version: number }>;
  remove?: (f: Fixture, expectedVersion: number) => Promise<unknown>;
}
const cases: VersionCase[] = [
  { name: "facility", update: (f, expectedVersion, location) => updateFacility(f.ctx, f.facility.id, { expectedVersion, location }), remove: (f, v) => archiveFacility(f.ctx, f.facility.id, v) },
  { name: "reactor", update: (f, expectedVersion, identifier) => updateReactor(f.ctx, f.reactor.id, { expectedVersion, identifier }), remove: (f, v) => deleteReactor(f.ctx, f.reactor.id, v) },
  { name: "bin", update: (f, expectedVersion, storageDescription) => updateStorageLocation(f.ctx, f.bin.id, { expectedVersion, storageDescription }), remove: (f, v) => deleteStorageLocation(f.ctx, f.bin.id, v) },
  { name: "supplier", update: (f, expectedVersion, address) => updateSupplier(f.ctx, f.supplier.id, { expectedVersion, address }), remove: (f, v) => deleteSupplier(f.ctx, f.supplier.id, v) },
  { name: "supplier location", update: (f, expectedVersion, address) => updateSupplierLocation(f.ctx, f.supplierLocation.id, { expectedVersion, address }), remove: (f, v) => deleteSupplierLocation(f.ctx, f.supplierLocation.id, v) },
  { name: "customer", update: (f, expectedVersion, address) => updateCustomer(f.ctx, f.customer.id, { expectedVersion, address }), remove: (f, v) => deleteCustomer(f.ctx, f.customer.id, v) },
  { name: "customer location", update: (f, expectedVersion, address) => updateCustomerLocation(f.ctx, f.customerLocation.id, { expectedVersion, address }), remove: (f, v) => deleteCustomerLocation(f.ctx, f.customerLocation.id, v) },
  { name: "formulation", update: (f, expectedVersion, description) => updateFormulation(f.ctx, f.formulation.id, { expectedVersion, description }), remove: (f, v) => deleteFormulation(f.ctx, f.formulation.id, v) },
  { name: "feedstock type", update: (f, expectedVersion, description) => updateFeedstockType(f.ctx, { feedstockTypeId: f.feedstockType.id, expectedVersion, description }), remove: (f, v) => deleteFeedstockType(f.ctx, f.feedstockType.id, v) },
  { name: "emission factors", update: (f, expectedVersion, sourceNote) => upsertFacilityEmissionFactors(f.ctx, { facilityId: f.facility.id, expectedVersion, sourceNote, dieselKgCo2ePerLitre: 2, gridKgCo2ePerKwh: 1, roadFreightKgCo2ePerTonneKm: 1 }) },
];

describe.each(cases)("$name integer versions", ({ update, remove }) => {
  it("commits current versions, increments once, and rejects stale updates", async () => {
    const f = await seed();
    const first = await update(f, INITIAL_VERSION, "First");
    expect(first.version).toBe(INITIAL_VERSION + VERSION_STEP);
    await expect(update(f, INITIAL_VERSION, "Stale")).rejects.toMatchObject(STALE);
    const second = await update(f, first.version, "Second");
    expect(second.version).toBe(first.version + VERSION_STEP);
  });
  if (remove) it("refuses stale deletes or archives", async () => {
    const f = await seed();
    await update(f, INITIAL_VERSION, "Updated");
    await expect(remove(f, INITIAL_VERSION)).rejects.toMatchObject(STALE);
  });
  it("allows exactly one of two writers holding the same version", async () => {
    const f = await seed();
    const results = await Promise.allSettled([update(f, INITIAL_VERSION, "Writer A"), update(f, INITIAL_VERSION, "Writer B")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused).toMatchObject({ status: "rejected", reason: STALE });
  });
});

it("facility archive and restore increment the facility, reactors and bins", async () => {
  const f = await seed();
  const archived = await archiveFacility(f.ctx, f.facility.id, f.facility.version);
  expect(archived.version).toBe(f.facility.version + VERSION_STEP);
  for (const table of [reactors, storageLocations]) {
    const [row] = await db.select().from(table).where(eq(table.organizationId, f.ctx.organizationId));
    expect(row.version).toBe(INITIAL_VERSION + VERSION_STEP);
  }
  await expect(restoreFacility(f.ctx, f.facility.id, f.facility.version)).rejects.toMatchObject(STALE);
  const restored = await restoreFacility(f.ctx, f.facility.id, archived.version);
  expect(restored.version).toBe(archived.version + VERSION_STEP);
  for (const table of [reactors, storageLocations]) {
    const [row] = await db.select().from(table).where(eq(table.organizationId, f.ctx.organizationId));
    expect(row.version).toBe(INITIAL_VERSION + VERSION_STEP + VERSION_STEP);
  }
});

it("bin and feedstock type archives and restores check and increment versions", async () => {
  const f = await seed();
  const bin = await updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, name: "Changed" });
  await expect(archiveStorageLocation(f.ctx, bin.id, f.bin.version)).rejects.toMatchObject(STALE);
  const archivedBin = await archiveStorageLocation(f.ctx, bin.id, bin.version);
  await expect(restoreStorageLocation(f.ctx, bin.id, bin.version)).rejects.toMatchObject(STALE);
  const restoredBin = await restoreStorageLocation(f.ctx, bin.id, archivedBin.version);
  expect(restoredBin.version).toBe(archivedBin.version + VERSION_STEP);
  const type = await updateFeedstockType(f.ctx, { feedstockTypeId: f.feedstockType.id, expectedVersion: f.feedstockType.version, description: "Changed" });
  await expect(archiveFeedstockType(f.ctx, type.id, f.feedstockType.version)).rejects.toMatchObject(STALE);
  const archivedType = await archiveFeedstockType(f.ctx, type.id, type.version);
  await expect(unarchiveFeedstockType(f.ctx, type.id, type.version)).rejects.toMatchObject(STALE);
  const restoredType = await unarchiveFeedstockType(f.ctx, type.id, archivedType.version);
  expect(restoredType.version).toBe(archivedType.version + VERSION_STEP);
});

it("creating and promoting defaults increments every demoted sibling", async () => {
  const f = await seed();
  const supplierNew = await createSupplierLocation(f.ctx, { supplierId: f.supplier.id, country: "Kenya", isDefault: true });
  const customerNew = await createCustomerLocation(f.ctx, { customerId: f.customer.id, name: "New", country: "Kenya", isDefault: true });
  const [supplierOld] = await db.select().from(supplierLocations).where(and(eq(supplierLocations.id, f.supplierLocation.id), eq(supplierLocations.organizationId, f.ctx.organizationId)));
  const [customerOld] = await db.select().from(customerLocations).where(and(eq(customerLocations.id, f.customerLocation.id), eq(customerLocations.organizationId, f.ctx.organizationId)));
  expect(supplierOld.version).toBe(f.supplierLocation.version + VERSION_STEP);
  expect(customerOld.version).toBe(f.customerLocation.version + VERSION_STEP);
  await expect(updateSupplierLocation(f.ctx, supplierOld.id, { expectedVersion: f.supplierLocation.version, isDefault: true })).rejects.toMatchObject(STALE);
  await expect(updateCustomerLocation(f.ctx, customerOld.id, { expectedVersion: f.customerLocation.version, isDefault: true })).rejects.toMatchObject(STALE);
  await updateSupplierLocation(f.ctx, supplierOld.id, { expectedVersion: supplierOld.version, isDefault: true });
  await updateCustomerLocation(f.ctx, customerOld.id, { expectedVersion: customerOld.version, isDefault: true });
  const [supplierDemoted] = await db.select().from(supplierLocations).where(eq(supplierLocations.id, supplierNew.id));
  const [customerDemoted] = await db.select().from(customerLocations).where(eq(customerLocations.id, customerNew.id));
  expect(supplierDemoted.version).toBe(supplierNew.version + VERSION_STEP);
  expect(customerDemoted.version).toBe(customerNew.version + VERSION_STEP);
});


it("a feedstock delivery claims its bin and increments the bin version", async () => {
  // First-use claiming needs an unclaimed bin; versioned edits use valid bins.
  const f = await seed({ unclaimedBin: true });
  await db.transaction((tx) => createFeedstockInTransaction(f.ctx, tx, {
    facilityId: f.facility.id, supplierId: f.supplier.id,
    deliveryDate: new Date("2026-10-01T00:00:00Z"), feedstockTypeId: f.feedstockType.id,
    totalWetMassKg: DELIVERY_MASS_KG, moisturePercent: MOISTURE_PERCENT,
    allocations: [{ storageLocationId: f.bin.id, allocatedWetMassKg: DELIVERY_MASS_KG }],
  }));
  const [claimed] = await db.select().from(storageLocations).where(and(eq(storageLocations.id, f.bin.id), eq(storageLocations.organizationId, f.ctx.organizationId)));
  expect(claimed).toMatchObject({ feedstockTypeId: f.feedstockType.id, version: f.bin.version + VERSION_STEP });
  await expect(updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, name: "Stale" })).rejects.toMatchObject(STALE);
});
