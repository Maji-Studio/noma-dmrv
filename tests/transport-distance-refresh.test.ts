import { beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations, deliveries, feedstocks, orders, supplierLocations } from "@/db/schema";
import { getTransportDistanceDrift, refreshFeedstockDistance, refreshDeliveryDistance } from "@/data-access/transport-distance-refresh";
import { getTransportLegsForEntity } from "@/data-access/transport-legs";
import { createSupplierLocation, updateSupplierLocation } from "@/data-access/suppliers";
import { updateCustomerLocation } from "@/data-access/customers";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";
import { insertOutputDeliveryFixture, deleteOutputDeliveryFixtures, ensureOutputFixtureActor } from "./helpers/output-contract-fixtures";

const ctx = makeTestOrgContext();
beforeAll(async () => { await ensureTestOrg(); await ensureOutputFixtureActor(ctx); });

it.each(["feedstock", "delivery"] as const)("freezes %s defaults, reports drift, and refreshes only on a versioned request", async entityType => {
  await withLineageFixture(async fixture => {
    const entityId = entityType === "feedstock" ? fixture.feedstockId : fixture.deliveryId;
    const target = { entityType, entityId };
    const [feedstock] = await db.select().from(feedstocks).where(eq(feedstocks.id, fixture.feedstockId));
    const supplierLocation = await createSupplierLocation(ctx, {
      ...TEST_SITE_POSITION, supplierId: feedstock.supplierId, isDefault: true,
      facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 42, distanceSource: "manual" }],
    });
    try {
      const [order] = await db.select().from(orders).where(eq(orders.id, fixture.orderId));
      const [customerLocation] = await db.select().from(customerLocations).where(eq(customerLocations.id, order.customerLocationId));
      // Set a recorded delivery distance independently of its location default.
      await db.update(deliveries).set({ distanceKmOverride: null, distanceSource: null, recordedDistanceKm: 42, recordedDistanceSource: "manual" }).where(eq(deliveries.id, fixture.deliveryId));
      const before = await getTransportDistanceDrift(ctx, target);
      if (entityType === "feedstock") {
        await updateSupplierLocation(ctx, supplierLocation.id, { expectedVersion: supplierLocation.version,
          facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 55, distanceSource: "document" }],
        });
      } else {
        await updateCustomerLocation(ctx, customerLocation.id, { expectedVersion: customerLocation.version,
          facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 55, distanceSource: "document" }],
        });
      }
      const drift = await getTransportDistanceDrift(ctx, target);
      expect(drift).toMatchObject({ recordedDistanceKm: 42, currentDistanceKm: 55, hasDrift: true, isOverridden: false, hasSubmittedRemoval: false });
      expect(drift.expectedVersion).toBe(before.expectedVersion);
      const refresh = entityType === "feedstock" ? refreshFeedstockDistance : refreshDeliveryDistance;
      await expect(refresh({ ...ctx, organizationId: "foreign-org" }, { entityId, expectedVersion: drift.expectedVersion })).rejects.toThrow();
      await expect(getTransportDistanceDrift({ ...ctx, organizationId: "foreign-org" }, target)).rejects.toThrow();
      const refreshed = await refresh(ctx, { entityId, expectedVersion: drift.expectedVersion });
      expect(refreshed).toMatchObject({ recordedDistanceKm: 55, hasDrift: false, expectedVersion: drift.expectedVersion + 1 });
      const legs = await getTransportLegsForEntity(ctx, entityType === "feedstock" ? "feedstock" : "biochar", entityType === "feedstock" ? fixture.feedstockId : fixture.productId);
      expect(legs).toEqual(expect.arrayContaining([expect.objectContaining({ isDerived: true, distanceKm: 55 })]));
      await expect(refresh(ctx, { entityId, expectedVersion: drift.expectedVersion })).rejects.toMatchObject({ code: "conflict" });
      if (entityType === "feedstock") await db.update(feedstocks).set({ distanceKmOverride: 25, distanceSource: "manual" }).where(eq(feedstocks.id, entityId));
      else await db.update(deliveries).set({ distanceKmOverride: 25, distanceSource: "manual" }).where(eq(deliveries.id, entityId));
      expect(await getTransportDistanceDrift(ctx, target)).toMatchObject({ hasDrift: false, isOverridden: true });
      await expect(refresh(ctx, { entityId, expectedVersion: refreshed.expectedVersion })).rejects.toThrow(/override/i);
    } finally { await db.delete(supplierLocations).where(eq(supplierLocations.id, supplierLocation.id)); }
  }, "none");
});

it.each(["removal", "ghgStatement"] as const)("refuses refresh through real %s locked lineage", async blockingVia => {
  await withLineageFixture(async fixture => {
    for (const entityType of ["feedstock", "delivery"] as const) {
      const entityId = entityType === "feedstock" ? fixture.feedstockId : fixture.deliveryId;
      const before = await getTransportDistanceDrift(ctx, { entityType, entityId });
      expect(before.hasSubmittedRemoval).toBe(true);
      const refresh = entityType === "feedstock" ? refreshFeedstockDistance : refreshDeliveryDistance;
      await expect(refresh(ctx, { entityId, expectedVersion: before.expectedVersion })).rejects.toThrow(
        "The distance was not refreshed because its transport data belongs to a locked Removal. Ask an Organization Admin to review the linked Removal.",
      );
      expect(await getTransportDistanceDrift(ctx, { entityType, entityId })).toEqual(before);
    }
  }, blockingVia);
});

it("protects a shared product even when the refreshed delivery has no application of its own", async () => {
  await withLineageFixture(async fixture => {
    const [shared] = await insertOutputDeliveryFixture(db, {
      organizationId: ctx.organizationId, facilityId: fixture.facilityId,
      orderId: fixture.orderId, biocharProductId: fixture.productId,
      code: `E2E-SHARED-${crypto.randomUUID()}`, deliveryDate: new Date("2026-10-15T12:00:00Z"),
      deliveredWetMassKg: 1, moistureContentPercent: 10, massDryKg: 0.9,
    }, row => row);
    try {
      const preview = await getTransportDistanceDrift(ctx, { entityType: "delivery", entityId: shared.id });
      expect(preview.hasSubmittedRemoval).toBe(true);
      await expect(refreshDeliveryDistance(ctx, { entityId: shared.id, expectedVersion: shared.version }))
        .rejects.toThrow("The distance was not refreshed because its transport data belongs to a locked Removal.");
    } finally { await deleteOutputDeliveryFixtures(db, eq(deliveries.id, shared.id)); }
  }, "removal");
});
