import { deliveryDistanceSnapshot } from "@/data-access/delivery-distance-snapshot";
import { loadBiocharDeliveryTransportLegs } from "@/data-access/biochar-delivery-transport";
import { deliveryDistanceBlocker } from "@/lib/certification/submission-readiness";
import { getTransportDistanceFixLinks } from "@/data-access/transport-distance-fix-links";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { createFeedstockInTransaction } from "@/data-access/feedstocks";
import { updateSupplierLocation } from "@/data-access/suppliers";
import { facilities, orders, feedstocks, supplierLocations } from "@/db/schema";
import { updateCustomerLocation, getCustomerLocations } from "@/data-access/customers";
import { getLocationFacilityDistances } from "@/data-access/location-facility-distances";
import { createDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import { getTransportLegsForEntity } from "@/data-access/transport-legs";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { TEST_SITE_POSITION } from "./helpers/test-org";

const PAIR_SAVE_OBSERVATION_MS = 500;
const organizations: string[] = [];
afterEach(async () => {
  for (const id of organizations.splice(0)) {
    await db.delete(supplierLocations).where(eq(supplierLocations.organizationId, id));
    await cleanupOutputStockFixture(db, id);
  }
});

async function fixture() {
  const f = await createDeliveryFixture();
  organizations.push(f.ctx.organizationId);
  return f;
}

describe("location facility distances", () => {
  it("allows a delivery without a pair and links its blocking readiness gap to the location form", async () => {
    const f = await fixture();
    const { delivery } = await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    expect(delivery.recordedDistanceKm).toBeNull();
    const legs = await loadBiocharDeliveryTransportLegs(f.ctx, [{ deliveryId: delivery.id, loadMassKg: 100 }]);
    expect(deliveryDistanceBlocker({ deliveryCode: delivery.code, deliveryStatus: delivery.status, distanceKmOverride: null, locationDistanceKm: legs[0].distanceKm })).toContain("no positive transport distance");
    const links = await getTransportDistanceFixLinks(f.ctx, [], [delivery.id]);
    expect(links.get(delivery.id)).toBe(`/customers?facility=${f.facility.id}&customer=${f.customer.id}&mode=edit&location=${f.location.id}`);
    await updateCustomerLocation(f.ctx, f.location.id, { expectedVersion: f.location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 25, distanceSource: "manual" }] });
    const repaired = await loadBiocharDeliveryTransportLegs(f.ctx, [{ deliveryId: delivery.id, loadMassKg: 100 }]);
    expect(repaired[0].distanceKm).toBe(25);
    expect(deliveryDistanceBlocker({ deliveryCode: delivery.code, deliveryStatus: delivery.status, distanceKmOverride: null, locationDistanceKm: repaired[0].distanceKm })).toBeNull();
  });

  it("keeps distinct distances for the same location at two facilities (DEF-003)", async () => {
    const f = await fixture();
    const [second] = await db.insert(facilities).values({
      ...TEST_SITE_POSITION, timezone: "UTC", organizationId: f.ctx.organizationId,
      code: `E2E-SECOND-${f.tag}`, name: `E2E second ${f.tag}`,
    }).returning();
    await updateCustomerLocation(f.ctx, f.location.id, {
      expectedVersion: f.location.version,
      facilityDistances: [
        { facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual" },
        { facilityId: second.id, distanceKm: 80, distanceSource: "document" },
      ],
    });
    const [secondOrder] = await db.insert(orders).values({
      organizationId: f.ctx.organizationId, facilityId: second.id, code: `E2E-SECOND-ORDER-${f.tag}`,
      customerId: f.customer.id, customerLocationId: f.location.id, formulationId: f.recipe.id,
      orderDate: new Date("2026-09-12"), quantityKg: 100, packaging: "loose",
    }).returning();
    expect(await db.transaction(tx => deliveryDistanceSnapshot(f.ctx, tx, {
      orderId: secondOrder.id, facilityId: second.id, distanceKmOverride: null, distanceSource: null,
    }))).toEqual({ recordedDistanceKm: 80, recordedDistanceSource: "document" });
    const rows = await getLocationFacilityDistances(f.ctx, "customer", f.location.id);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ facilityId: f.facility.id, distanceKm: 20 }),
      expect.objectContaining({ facilityId: second.id, distanceKm: 80 }),
    ]));
    await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    expect(await getTransportLegsForEntity(f.ctx, "biochar", f.product.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ distanceKm: 20 })]),
    );
  });

  it("upserts supplied pairs, preserves omitted pairs and freezes existing legs", async () => {
    const f = await fixture();
    let location = await updateCustomerLocation(f.ctx, f.location.id, {
      expectedVersion: f.location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual" }],
    });
    await db.transaction(tx => createDeliveryInTransaction(f.ctx, tx, f.input));
    const before = await getTransportLegsForEntity(f.ctx, "biochar", f.product.id);
    location = await updateCustomerLocation(f.ctx, f.location.id, {
      expectedVersion: location.version, name: "E2E renamed site",
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 80, distanceSource: "document" }],
    });
    await updateCustomerLocation(f.ctx, location.id, { expectedVersion: location.version, city: "E2E city" });
    expect(await getTransportLegsForEntity(f.ctx, "biochar", f.product.id)).toEqual(before);
    const locations = await getCustomerLocations(f.ctx, f.customer.id);
    expect(locations.find(row => row.id === location.id)?.facilityDistances).toEqual(
      expect.arrayContaining([expect.objectContaining({ distanceKm: 80 })]),
    );
  });

  it("fills an intake that was still committing when the supplier pair was saved", async () => {
    const f = await fixture();
    const [existing] = await db.select().from(feedstocks).where(eq(feedstocks.organizationId, f.ctx.organizationId));
    const [location] = await db.insert(supplierLocations).values({ ...TEST_SITE_POSITION,
      organizationId: f.ctx.organizationId, supplierId: existing.supplierId, isDefault: true,
    }).returning();
    let ready!: () => void;
    let release!: () => void;
    const inserted = new Promise<void>(resolve => { ready = resolve; });
    const commit = new Promise<void>(resolve => { release = resolve; });
    const intake = db.transaction(async tx => {
      const result = await createFeedstockInTransaction(f.ctx, tx, {
        facilityId: f.facility.id, supplierId: existing.supplierId, feedstockTypeId: existing.feedstockTypeId,
        deliveryDate: new Date("2026-09-14T12:00:00Z"), totalWetMassKg: 100, moisturePercent: 10,
        allocations: [{ storageLocationId: existing.storageLocationId, allocatedWetMassKg: 100 }],
      });
      ready();
      await commit;
      return result.feedstocks[0];
    });
    await inserted;
    let completed = false;
    const save = updateSupplierLocation(f.ctx, location.id, { expectedVersion: location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 45, distanceSource: "manual" }],
    }).then(value => { completed = true; return value; });
    let completedBeforeCommit: boolean;
    try {
      await new Promise(resolve => setTimeout(resolve, PAIR_SAVE_OBSERVATION_MS));
      completedBeforeCommit = completed;
    } finally {
      release();
    }
    const [savedIntake] = await Promise.all([intake, save]);
    expect(completedBeforeCommit).toBe(false);
    expect(await getTransportLegsForEntity(f.ctx, "feedstock", savedIntake.id)).toEqual([
      expect.objectContaining({ distanceKm: 45 }),
    ]);
  });

  it("rejects a foreign facility atomically", async () => {
    const f = await fixture();
    const foreign = await fixture();
    await expect(updateCustomerLocation(f.ctx, f.location.id, {
      expectedVersion: f.location.version,
      facilityDistances: [
        { facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual" },
        { facilityId: foreign.facility.id, distanceKm: 80, distanceSource: "manual" },
      ],
    })).rejects.toThrow();
    expect(await getLocationFacilityDistances(f.ctx, "customer", f.location.id)).toEqual([]);
  });
  it("ignores null pairs for archived and missing facilities when renaming a location", async () => {
    const f = await fixture();
    await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, f.facility.id));
    const location = await updateCustomerLocation(f.ctx, f.location.id, {
      expectedVersion: f.location.version, name: "E2E renamed site",
      facilityDistances: [
        { facilityId: f.facility.id, distanceKm: null, distanceSource: "manual" },
        { facilityId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", distanceKm: null, distanceSource: "manual" },
      ],
    });
    expect(location.name).toBe("E2E renamed site");
    expect(await getLocationFacilityDistances(f.ctx, "customer", f.location.id)).toEqual([]);
  });

  it("clears an existing pair after its facility is archived", async () => {
    const f = await fixture();
    const location = await updateCustomerLocation(f.ctx, f.location.id, {
      expectedVersion: f.location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual" }],
    });
    await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, f.facility.id));
    await updateCustomerLocation(f.ctx, location.id, {
      expectedVersion: location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: null, distanceSource: "manual" }],
    });
    expect(await getLocationFacilityDistances(f.ctx, "customer", location.id)).toEqual([]);
  });

  it("rejects archived facility pairs without changing the location", async () => {
    const f = await fixture();
    await db.update(facilities).set({ archivedAt: new Date() }).where(eq(facilities.id, f.facility.id));
    await expect(updateCustomerLocation(f.ctx, f.location.id, {
      expectedVersion: f.location.version,
      facilityDistances: [{ facilityId: f.facility.id, distanceKm: 20, distanceSource: "manual" }],
    })).rejects.toThrow(/Facility .*not found.*archived/);
    expect(await getLocationFacilityDistances(f.ctx, "customer", f.location.id)).toEqual([]);
  });

});
