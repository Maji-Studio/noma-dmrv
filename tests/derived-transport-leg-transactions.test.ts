import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  customerLocations,
  customers,
  deliveries,
  facilities,
  feedstocks,
  feedstockTypes,
  orders,
  storageLocations,
  supplierLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import { updateCustomerLocation } from "@/data-access/customers";
import {
  createDelivery,
  deleteDelivery,
  updateDelivery,
} from "@/data-access/deliveries";
import {
  createFeedstock,
  updateFeedstock,
} from "@/data-access/feedstocks";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const ctx = makeTestOrgContext();

describe("derived transport-leg transaction boundaries", () => {
  const created = {
    facilityIds: [] as string[],
    supplierIds: [] as string[],
    supplierLocationIds: [] as string[],
    feedstockTypeIds: [] as string[],
    feedstockCodes: [] as string[],
    storageLocationIds: [] as string[],
    customerIds: [] as string[],
    customerLocationIds: [] as string[],
    biocharProductIds: [] as string[],
    orderIds: [] as string[],
    deliveryIds: [] as string[],
  };

  beforeAll(() => ensureTestOrg());

  afterEach(async () => {
    const trackedFeedstocks = created.feedstockCodes.length > 0
      ? await db
          .select({ id: feedstocks.id })
          .from(feedstocks)
          .where(and(
            eq(feedstocks.organizationId, TEST_ORG_ID),
            inArray(feedstocks.code, created.feedstockCodes),
          ))
      : [];
    const entityIds = [
      ...created.biocharProductIds,
      ...trackedFeedstocks.map((row) => row.id),
    ];
    if (entityIds.length > 0) {
      await db.delete(transportLegs).where(inArray(transportLegs.entityId, entityIds));
    }
    if (created.deliveryIds.length > 0) {
      await db.delete(deliveries).where(inArray(deliveries.id, created.deliveryIds));
    }
    if (trackedFeedstocks.length > 0) {
      await db
        .delete(feedstocks)
        .where(inArray(feedstocks.id, trackedFeedstocks.map((row) => row.id)));
    }
    if (created.orderIds.length > 0) {
      await db.delete(orders).where(inArray(orders.id, created.orderIds));
    }
    if (created.customerLocationIds.length > 0) {
      await db
        .delete(customerLocations)
        .where(inArray(customerLocations.id, created.customerLocationIds));
    }
    if (created.customerIds.length > 0) {
      await db.delete(customers).where(inArray(customers.id, created.customerIds));
    }
    if (created.biocharProductIds.length > 0) {
      await db
        .delete(biocharProducts)
        .where(inArray(biocharProducts.id, created.biocharProductIds));
    }
    if (created.storageLocationIds.length > 0) {
      await db
        .delete(storageLocations)
        .where(inArray(storageLocations.id, created.storageLocationIds));
    }
    if (created.feedstockTypeIds.length > 0) {
      await db
        .delete(feedstockTypes)
        .where(inArray(feedstockTypes.id, created.feedstockTypeIds));
    }
    if (created.supplierLocationIds.length > 0) {
      await db
        .delete(supplierLocations)
        .where(inArray(supplierLocations.id, created.supplierLocationIds));
    }
    if (created.supplierIds.length > 0) {
      await db.delete(suppliers).where(inArray(suppliers.id, created.supplierIds));
    }
    if (created.facilityIds.length > 0) {
      await db.delete(facilities).where(inArray(facilities.id, created.facilityIds));
    }

    for (const ids of Object.values(created)) ids.length = 0;
  });

  it("rolls back feedstock creation and bin locking when derived persistence fails", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-TL-${tag}`,
        name: `Transport Transaction Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    created.facilityIds.push(facility.id);

    const [supplier] = await db
      .insert(suppliers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `SUP-TL-${tag}`,
        name: `Transport Transaction Supplier ${tag}`,
      })
      .returning({ id: suppliers.id });
    created.supplierIds.push(supplier.id);

    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-TL-${tag}`,
        name: `Transport Transaction Feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });
    created.feedstockTypeIds.push(feedstockType.id);

    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-TL-${tag}`,
        name: `Transport Transaction Bin ${tag}`,
        type: "feedstock_bin",
      })
      .returning({ id: storageLocations.id });
    created.storageLocationIds.push(bin.id);

    const feedstockCode = `FS-TL-${tag}`;
    created.feedstockCodes.push(feedstockCode);
    await expect(
      createFeedstock(
        ctx,
        {
          facilityId: facility.id,
          deliveryDate: new Date("2026-07-19T00:00:00Z"),
          supplierId: supplier.id,
          feedstockTypeId: feedstockType.id,
          totalWetMassKg: 100,
          moisturePercent: 10,
          allocations: [{ storageLocationId: bin.id, allocatedWetMassKg: 100 }],
          transportDistanceKm: 25,
          // Exercise a database rejection specifically in derived persistence.
          transportDistanceSource: "invalid_source" as never,
        },
        async () => [feedstockCode],
      ),
    ).rejects.toThrow();

    const [persistedFeedstock] = await db
      .select({ id: feedstocks.id })
      .from(feedstocks)
      .where(and(
        eq(feedstocks.organizationId, TEST_ORG_ID),
        eq(feedstocks.code, feedstockCode),
      ));
    const [persistedBin] = await db
      .select({ feedstockTypeId: storageLocations.feedstockTypeId })
      .from(storageLocations)
      .where(eq(storageLocations.id, bin.id));

    expect(persistedFeedstock).toBeUndefined();
    expect(persistedBin.feedstockTypeId).toBeNull();
  });

  it("preserves feedstock overrides on partial updates and resets them on reroute", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-OVR-${tag}`,
        name: `Override Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    created.facilityIds.push(facility.id);

    const [supplier, newRouteSupplier] = await db
      .insert(suppliers)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `SUP-OVR-${tag}`,
          name: `Override Supplier ${tag}`,
          distanceToFacilityKm: 10,
          distanceSource: "map_estimate" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          code: `SUP-ROUTE-${tag}`,
          name: `New Route Supplier ${tag}`,
          distanceToFacilityKm: 35,
          distanceSource: "manual" as const,
        },
      ])
      .returning({ id: suppliers.id });
    created.supplierIds.push(supplier.id, newRouteSupplier.id);

    const [newDefaultLocation] = await db
      .insert(supplierLocations)
      .values({
        organizationId: TEST_ORG_ID,
        supplierId: newRouteSupplier.id,
        name: `New Route Source ${tag}`,
        isDefault: true,
        distanceFromFacilityKm: 45,
        distanceSource: "map_estimate",
      })
      .returning({ id: supplierLocations.id });
    created.supplierLocationIds.push(newDefaultLocation.id);

    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-OVR-${tag}`,
        name: `Override Feedstock ${tag}`,
        category: "forestry",
      })
      .returning({ id: feedstockTypes.id });
    created.feedstockTypeIds.push(feedstockType.id);

    const [bin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `BIN-OVR-${tag}`,
        name: `Override Bin ${tag}`,
        type: "feedstock_bin",
      })
      .returning({ id: storageLocations.id });
    created.storageLocationIds.push(bin.id);

    const feedstockCode = `FS-OVR-${tag}`;
    created.feedstockCodes.push(feedstockCode);
    const result = await createFeedstock(
      ctx,
      {
        facilityId: facility.id,
        deliveryDate: new Date("2026-07-19T00:00:00Z"),
        supplierId: supplier.id,
        feedstockTypeId: feedstockType.id,
        totalWetMassKg: 100,
        moisturePercent: 10,
        allocations: [{ storageLocationId: bin.id, allocatedWetMassKg: 100 }],
        transportDistanceKm: 25,
        transportDistanceSource: "document",
        transportTripType: "one_way",
      },
      async () => [feedstockCode],
    );
    const feedstockId = result.feedstocks[0].id;

    await updateFeedstock(ctx, feedstockId, { notes: "Partial update" });

    const [derived] = await db
      .select({
        distanceKm: transportLegs.distanceKm,
        distanceSource: transportLegs.distanceSource,
        tripType: transportLegs.tripType,
      })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, feedstockId),
        eq(transportLegs.isDerived, true),
      ));

    expect(derived).toEqual({
      distanceKm: 25,
      distanceSource: "document",
      tripType: "one_way",
    });

    // With no explicit transport fields, a route-anchor change discards the
    // stale saved override and recomputes from the new supplier's default.
    await updateFeedstock(ctx, feedstockId, {
      supplierId: newRouteSupplier.id,
    });

    const [rerouted] = await db
      .select({
        originName: transportLegs.originName,
        distanceKm: transportLegs.distanceKm,
        distanceSource: transportLegs.distanceSource,
        tripType: transportLegs.tripType,
      })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, feedstockId),
        eq(transportLegs.isDerived, true),
      ));

    expect(rerouted).toEqual({
      originName: `New Route Source ${tag}`,
      distanceKm: 45,
      distanceSource: "map_estimate",
      tripType: "one_way",
    });

    // An explicit override submitted with a reroute is authoritative. It must
    // not be discarded merely because the supplier anchor also changed.
    await updateFeedstock(ctx, feedstockId, {
      supplierId: supplier.id,
      transportDistanceKm: 30,
      transportDistanceSource: "document",
    });

    const [explicitReroute] = await db
      .select({
        originName: transportLegs.originName,
        distanceKm: transportLegs.distanceKm,
        distanceSource: transportLegs.distanceSource,
        tripType: transportLegs.tripType,
      })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, feedstockId),
        eq(transportLegs.isDerived, true),
      ));

    expect(explicitReroute).toEqual({
      originName: `Override Supplier ${tag}`,
      distanceKm: 30,
      distanceSource: "document",
      tripType: "one_way",
    });
  });

  it("recomputes prior, new, and location-affected product legs without touching manual legs", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-DIST-${tag}`,
        name: `Distribution Transaction Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    created.facilityIds.push(facility.id);

    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CUS-DIST-${tag}`,
        name: `Distribution Transaction Customer ${tag}`,
      })
      .returning({ id: customers.id });
    created.customerIds.push(customer.id);

    const [firstLocation, secondLocation] = await db
      .insert(customerLocations)
      .values([
        {
          organizationId: TEST_ORG_ID,
          customerId: customer.id,
          name: `First Site ${tag}`,
          distanceFromFacilityKm: 20,
          distanceSource: "manual" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          customerId: customer.id,
          name: `Second Site ${tag}`,
          distanceFromFacilityKm: 60,
          distanceSource: "document" as const,
        },
      ])
      .returning({ id: customerLocations.id });
    created.customerLocationIds.push(firstLocation.id, secondLocation.id);

    const [firstProduct, secondProduct] = await db
      .insert(biocharProducts)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BP-DIST-A-${tag}`,
          massKg: 1_000,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BP-DIST-B-${tag}`,
          massKg: 1_000,
        },
      ])
      .returning({ id: biocharProducts.id });
    created.biocharProductIds.push(firstProduct.id, secondProduct.id);

    const [firstOrder, secondOrder] = await db
      .insert(orders)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          customerId: customer.id,
          customerLocationId: firstLocation.id,
          biocharProductId: firstProduct.id,
          code: `OR-DIST-A-${tag}`,
          orderDate: new Date("2026-07-18T00:00:00Z"),
          quantityKg: 100,
          packaging: "bagged" as const,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          customerId: customer.id,
          customerLocationId: secondLocation.id,
          biocharProductId: secondProduct.id,
          code: `OR-DIST-B-${tag}`,
          orderDate: new Date("2026-07-18T00:00:00Z"),
          quantityKg: 100,
          packaging: "bagged" as const,
        },
      ])
      .returning({ id: orders.id });
    created.orderIds.push(firstOrder.id, secondOrder.id);

    const delivery = await createDelivery(ctx, {
      code: `DL-DIST-${tag}`,
      orderId: firstOrder.id,
      facilityId: facility.id,
      deliveryDate: new Date("2026-07-19T00:00:00Z"),
      biocharProductId: firstProduct.id,
      status: "upcoming",
      deliveredWetMassKg: 100,
    });
    created.deliveryIds.push(delivery.id);

    const upcomingDerived = await db
      .select({ id: transportLegs.id })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, firstProduct.id),
        eq(transportLegs.isDerived, true),
      ));
    expect(upcomingDerived).toEqual([]);

    await db.insert(transportLegs).values({
      organizationId: TEST_ORG_ID,
      entityType: "biochar",
      entityId: firstProduct.id,
      distanceKm: 99,
      distanceSource: "document",
      transportMethodType: "road",
      calculationMethodType: "distance_based",
      loadMassKg: 100,
      isDerived: false,
    });

    await updateDelivery(ctx, delivery.id, {
      orderId: secondOrder.id,
      biocharProductId: secondProduct.id,
      status: "delivered",
    });

    const legsAfterReassignment = await db
      .select({
        entityId: transportLegs.entityId,
        isDerived: transportLegs.isDerived,
        distanceKm: transportLegs.distanceKm,
      })
      .from(transportLegs)
      .where(inArray(transportLegs.entityId, [firstProduct.id, secondProduct.id]));

    expect(legsAfterReassignment).toEqual(expect.arrayContaining([
      { entityId: firstProduct.id, isDerived: false, distanceKm: 99 },
      { entityId: secondProduct.id, isDerived: true, distanceKm: 60 },
    ]));
    expect(legsAfterReassignment).toHaveLength(2);

    const upcomingDelivery = await createDelivery(ctx, {
      code: `DL-STALE-${tag}`,
      orderId: firstOrder.id,
      facilityId: facility.id,
      deliveryDate: new Date("2026-07-19T00:00:00Z"),
      biocharProductId: firstProduct.id,
      status: "upcoming",
      deliveredWetMassKg: 100,
    });
    created.deliveryIds.push(upcomingDelivery.id);
    await db.insert(transportLegs).values({
      organizationId: TEST_ORG_ID,
      entityType: "biochar",
      entityId: firstProduct.id,
      distanceKm: 20,
      distanceSource: "manual",
      transportMethodType: "road",
      calculationMethodType: "distance_based",
      loadMassKg: 100,
      isDerived: true,
    });

    await updateCustomerLocation(ctx, secondLocation.id, {
      distanceFromFacilityKm: 80,
      distanceSource: "map_estimate",
    });

    const [updatedDerived] = await db
      .select({ distanceKm: transportLegs.distanceKm })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, secondProduct.id),
        eq(transportLegs.isDerived, true),
      ));
    expect(updatedDerived.distanceKm).toBe(80);

    await updateCustomerLocation(ctx, firstLocation.id, {
      distanceFromFacilityKm: 40,
      distanceSource: "map_estimate",
    });
    const staleDerived = await db
      .select({ id: transportLegs.id })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, firstProduct.id),
        eq(transportLegs.isDerived, true),
      ));
    expect(staleDerived).toEqual([]);

    await deleteDelivery(ctx, delivery.id);
    const remainingLegs = await db
      .select({
        entityId: transportLegs.entityId,
        isDerived: transportLegs.isDerived,
      })
      .from(transportLegs)
      .where(inArray(transportLegs.entityId, [firstProduct.id, secondProduct.id]));

    expect(remainingLegs).toEqual([
      { entityId: firstProduct.id, isDerived: false },
    ]);
  });
});
