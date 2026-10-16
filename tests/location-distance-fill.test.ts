import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations, deliveries, feedstocks, orders, supplierLocations } from "@/db/schema";
import { updateCustomerLocation } from "@/data-access/customers";
import { updateSupplierLocation } from "@/data-access/suppliers";
import { getTransportLegsForEntity } from "@/data-access/transport-legs";
import { getDeliveryWithRelations } from "@/data-access/deliveries";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";
import { ensureOutputFixtureActor } from "./helpers/output-contract-fixtures";

const ctx = makeTestOrgContext();
beforeAll(async () => { await ensureTestOrg(); await ensureOutputFixtureActor(ctx); });

it.each(["removal", "ghgStatement", "none"] as const)("fills only unlocked missing distances with %s lineage", async blockingVia => {
  await withLineageFixture(async fixture => {
    const [order] = await db.select().from(orders).where(eq(orders.id, fixture.orderId));
    const [location] = await db.select().from(customerLocations).where(eq(customerLocations.id, order.customerLocationId));
    await db.update(deliveries).set({ distanceKmOverride: null, recordedDistanceKm: null, recordedDistanceSource: null })
      .where(and(eq(deliveries.organizationId, TEST_ORG_ID), eq(deliveries.id, fixture.deliveryId)));
    const savedLocation = await updateCustomerLocation(ctx, location.id, { expectedVersion: location.version,
      facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 25, distanceSource: "document" }] });
    const delivery = await getDeliveryWithRelations(ctx, fixture.deliveryId);
    expect(delivery.recordedDistanceKm).toBe(blockingVia === "none" ? 25 : null);
    expect(savedLocation.version).toBe(location.version + 1);

    const [feedstock] = await db.select().from(feedstocks).where(eq(feedstocks.id, fixture.feedstockId));
    const [supplierLocation] = await db.insert(supplierLocations).values({
      ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, supplierId: feedstock.supplierId, isDefault: true,
    }).returning();
    try {
      const saved = await updateSupplierLocation(ctx, supplierLocation.id, { expectedVersion: supplierLocation.version,
        facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 35, distanceSource: "manual" }] });
      const legs = await getTransportLegsForEntity(ctx, "feedstock", feedstock.id);
      expect(legs).toHaveLength(blockingVia === "none" ? 1 : 0);
      if (blockingVia === "none") {
        expect(legs[0].distanceKm).toBe(35);
        await updateSupplierLocation(ctx, supplierLocation.id, { expectedVersion: saved.version,
          facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 80, distanceSource: "document" }] });
        expect(await getTransportLegsForEntity(ctx, "feedstock", feedstock.id)).toEqual(legs);
      }
    } finally {
      await db.delete(supplierLocations).where(eq(supplierLocations.id, supplierLocation.id));
    }
  }, blockingVia);
});
