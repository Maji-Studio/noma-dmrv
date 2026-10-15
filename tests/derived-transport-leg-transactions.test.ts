import { labLogisticsVersion } from "./helpers/lab-logistics-version";
import { masterDataVersion } from "./helpers/master-data-version";
import { preparePureOutputProductFixture, ensureOutputFixtureActor } from "./helpers/output-contract-fixtures";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { deleteOutputDeliveryFixtures, deleteOutputProductFixtures, deleteOutputFacilityFixtures, outputProductFixtureValues, outputOrderFixtureValues } from "./helpers/output-contract-fixtures";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  customerLocations,
  customers,
  deliveries,
  documents,
  facilities,
  feedstocks,
  feedstockTypes,
  orders,
  storageLocations,
  storageObjectDeletions,
  supplierLocations,
  suppliers,
  transportLegs,
} from "@/db/schema";
import { updateCustomerLocation } from "@/data-access/customers";
import { deleteDelivery } from "@/data-access/deliveries";
import { createDelivery } from "./helpers/create-delivery";
import { __setStorageProviderForTests } from "@/lib/storage";
import { RetirementStorageProvider, insertManagedDocument } from "./helpers/document-retirement";
import { updateDelivery, updateDeliveryOperation } from "@/lib/operations/deliveries";
import { runOperationInProcess } from "@/lib/operations/runner";
import {
  createFeedstockInTransaction,
  updateFeedstockInTransaction,
} from "@/data-access/feedstocks";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const ctx = makeTestOrgContext();
const DELIVERY_WET_MASS_KG = 100;
const DELIVERY_DISTANCE_KM = 25;

describe("derived transport-leg transaction boundaries", () => {
  const created = {
    facilityIds: [] as string[],
    supplierIds: [] as string[],
    supplierLocationIds: [] as string[],
    feedstockTypeIds: [] as string[],
    storageLocationIds: [] as string[],
    customerIds: [] as string[],
    customerLocationIds: [] as string[],
    biocharProductIds: [] as string[],
    orderIds: [] as string[],
    deliveryIds: [] as string[],
  };

  beforeAll(async () => { await ensureTestOrg(); await ensureOutputFixtureActor(ctx); });

  afterEach(async () => {
    // Feedstock codes are generated, so feedstocks are tracked by facility.
    const trackedFeedstocks = created.facilityIds.length > 0
      ? await db
          .select({ id: feedstocks.id })
          .from(feedstocks)
          .where(and(
            eq(feedstocks.organizationId, TEST_ORG_ID),
            inArray(feedstocks.facilityId, created.facilityIds),
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
      await deleteOutputDeliveryFixtures(db, inArray(deliveries.id, created.deliveryIds));
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
      await deleteOutputProductFixtures(db, inArray(biocharProducts.id, created.biocharProductIds));
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
      await deleteOutputFacilityFixtures(db, inArray(facilities.id, created.facilityIds));
    }

    for (const ids of Object.values(created)) ids.length = 0;
  });

  it("rolls back feedstock creation and bin locking when derived persistence fails", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({ timezone: "UTC",
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

    await expect(
      db.transaction((tx) => createFeedstockInTransaction(ctx, tx, {
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
        })),
    ).rejects.toThrow();

    const [persistedFeedstock] = await db
      .select({ id: feedstocks.id })
      .from(feedstocks)
      .where(and(
        eq(feedstocks.organizationId, TEST_ORG_ID),
        eq(feedstocks.facilityId, facility.id),
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
      .values({ timezone: "UTC",
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

    const result = await db.transaction((tx) => createFeedstockInTransaction(ctx, tx, {
        facilityId: facility.id,
        deliveryDate: new Date("2026-07-19T00:00:00Z"),
        supplierId: supplier.id,
        feedstockTypeId: feedstockType.id,
        totalWetMassKg: 100,
        moisturePercent: 10,
        allocations: [{ storageLocationId: bin.id, allocatedWetMassKg: 100 }],
        transportDistanceKm: 25,
        transportDistanceSource: "document",
      }));
    expect(result.feedstocks[0].status).toBe("complete");
    const feedstockId = result.feedstocks[0].id;

    const partialUpdate = await db.transaction((tx) => updateFeedstockInTransaction(ctx, tx, feedstockId, {
      expectedVersion: result.feedstocks[0].version,
      notes: "Partial update",
    }));

    const [derived] = await db
      .select({
        distanceKm: transportLegs.distanceKm,
        distanceSource: transportLegs.distanceSource,
      })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, feedstockId),
        eq(transportLegs.isDerived, true),
      ));

    expect(derived).toEqual({
      distanceKm: 25,
      distanceSource: "document",
    });

    // With no explicit transport fields, a route-anchor change discards the
    // stale saved override and recomputes from the new supplier's default.
    const routeUpdate = await db.transaction((tx) => updateFeedstockInTransaction(ctx, tx, feedstockId, {
      expectedVersion: partialUpdate.version,
      supplierId: newRouteSupplier.id,
    }));

    const [rerouted] = await db
      .select({
        originName: transportLegs.originName,
        distanceKm: transportLegs.distanceKm,
        distanceSource: transportLegs.distanceSource,
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
    });

    // An explicit override submitted with a reroute is authoritative. It must
    // not be discarded merely because the supplier anchor also changed.
    await db.transaction((tx) => updateFeedstockInTransaction(ctx, tx, feedstockId, {
      expectedVersion: routeUpdate.version,
      supplierId: supplier.id,
      transportDistanceKm: 30,
      transportDistanceSource: "document",
    }));

    const [explicitReroute] = await db
      .select({
        originName: transportLegs.originName,
        distanceKm: transportLegs.distanceKm,
        distanceSource: transportLegs.distanceSource,
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
    });
  });

  it.each(["update_delivery", "update_posted_delivery"])("%s sweeps retired derived-leg evidence after clearing the only distance", async (operationId) => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db.insert(facilities).values({
      organizationId: TEST_ORG_ID, timezone: "UTC",
      code: `FAC-RET-${tag}`, name: `Retirement Facility ${tag}`,
    }).returning({ id: facilities.id });
    created.facilityIds.push(facility.id);
    const [customer] = await db.insert(customers).values({
      organizationId: TEST_ORG_ID,
      code: `CUS-RET-${tag}`, name: `Retirement Customer ${tag}`,
    }).returning({ id: customers.id });
    created.customerIds.push(customer.id);
    const [location] = await db.insert(customerLocations).values({
      organizationId: TEST_ORG_ID, customerId: customer.id,
      name: `Retirement Site ${tag}`, distanceFromFacilityKm: null,
    }).returning({ id: customerLocations.id });
    created.customerLocationIds.push(location.id);
    const [product] = await db.insert(biocharProducts).values(await outputProductFixtureValues(db, {
      organizationId: TEST_ORG_ID, facilityId: facility.id,
      code: `BP-RET-${tag}`, massKg: DELIVERY_WET_MASS_KG, moistureContentPercent: 0,
    })).returning({ id: biocharProducts.id });
    created.biocharProductIds.push(product.id);
    const [order] = await db.insert(orders).values(await outputOrderFixtureValues(db, {
      organizationId: TEST_ORG_ID, facilityId: facility.id,
      customerId: customer.id, customerLocationId: location.id, biocharProductId: product.id,
      code: `OR-RET-${tag}`, orderDate: new Date("2026-07-18T00:00:00Z"),
      quantityKg: DELIVERY_WET_MASS_KG, packaging: "bagged",
    })).returning({ id: orders.id });
    created.orderIds.push(order.id);
    const source = await preparePureOutputProductFixture(db, product.id);
    const preview = await previewOutputStock(ctx, {
      kind: "delivery", facilityId: facility.id, storageLocationId: source.storageLocationId,
      occurredAt: "2026-07-19T12:00:00.000Z", wetMassKg: DELIVERY_WET_MASS_KG, moisturePercent: 0,
    });
    const delivery = await createDelivery(ctx, {
      code: `DL-RET-${tag}`, orderId: order.id, facilityId: facility.id,
      storageLocationId: source.storageLocationId, deliveryDate: new Date("2026-07-19T12:00:00Z"),
      deliveredWetMassKg: DELIVERY_WET_MASS_KG, moistureContentPercent: 0,
      distanceKmOverride: DELIVERY_DISTANCE_KM, distanceSource: "document",
      basisFingerprint: preview.basisFingerprint, idempotencyKey: crypto.randomUUID(),
    });
    created.deliveryIds.push(delivery.id);
    const [leg] = await db.select({ id: transportLegs.id }).from(transportLegs).where(and(
      eq(transportLegs.organizationId, ctx.organizationId),
      eq(transportLegs.entityId, product.id),
      eq(transportLegs.isDerived, true),
    ));
    const provider = new RetirementStorageProvider();
    const key = `transport_leg/${leg.id}/pdf/${tag}.pdf`;
    const documentId = await insertManagedDocument(provider, "transport_leg", leg.id, key);
    __setStorageProviderForTests(provider);

    try {
      const changes = { expectedVersion: delivery.version, distanceKmOverride: null };
      const updated = operationId === "update_delivery"
        ? await runOperationInProcess(updateDeliveryOperation, ctx, { deliveryId: delivery.id, ...changes })
        : await updateDelivery(ctx, delivery.id, changes);

      expect(updated).toMatchObject({ id: delivery.id, distanceKmOverride: null });
      expect(await db.select().from(transportLegs).where(eq(transportLegs.id, leg.id))).toHaveLength(0);
      expect(await db.select().from(documents).where(eq(documents.id, documentId))).toHaveLength(0);
      expect(provider.deleteCalls).toContain(key);
      expect(provider.objects.has(key)).toBe(false);
      const [deletion] = await db.select().from(storageObjectDeletions).where(and(
        eq(storageObjectDeletions.organizationId, ctx.organizationId),
        eq(storageObjectDeletions.storageKey, key),
      ));
      expect(deletion).toMatchObject({ attemptCount: 1, completedAt: expect.any(Date) });
    } finally {
      __setStorageProviderForTests(null);
      await db.delete(documents).where(eq(documents.id, documentId));
      await db.delete(storageObjectDeletions).where(and(
        eq(storageObjectDeletions.organizationId, ctx.organizationId),
        eq(storageObjectDeletions.storageKey, key),
      ));
    }
  });

  it("preserves posted source relationships, recomputes location-affected legs and sweeps retired evidence without touching manual legs", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({ timezone: "UTC",
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
      .values(await outputProductFixtureValues(db, [
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BP-DIST-A-${tag}`,
          massKg: 1_000,
          moistureContentPercent: 0,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          code: `BP-DIST-B-${tag}`,
          massKg: 1_000,
          moistureContentPercent: 0,
        },
      ]))
      .returning({ id: biocharProducts.id });
    created.biocharProductIds.push(firstProduct.id, secondProduct.id);

    const [firstOrder, secondOrder] = await db
      .insert(orders)
      .values(await outputOrderFixtureValues(db, [
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
      ]))
      .returning({ id: orders.id });
    created.orderIds.push(firstOrder.id, secondOrder.id);

    const sources = await Promise.all([firstProduct, secondProduct].map(product => preparePureOutputProductFixture(db, product.id)));
    async function postDelivery(index: number, orderId: string) {
      const preview = await previewOutputStock(ctx, { kind: "delivery", facilityId: facility.id, storageLocationId: sources[index].storageLocationId, occurredAt: "2026-07-19T12:00:00.000Z", wetMassKg: 100, moisturePercent: 0 });
      const delivery = await createDelivery(ctx, { code: `DL-DIST-${index}-${tag}`, orderId, facilityId: facility.id, storageLocationId: sources[index].storageLocationId, deliveryDate: new Date("2026-07-19T12:00:00.000Z"), deliveredWetMassKg: 100, moistureContentPercent: 0, basisFingerprint: preview.basisFingerprint, idempotencyKey: crypto.randomUUID() });
      created.deliveryIds.push(delivery.id);
      return delivery;
    }
    const delivery = await postDelivery(0, firstOrder.id);
    await postDelivery(1, secondOrder.id);

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

    await expect(updateDelivery(ctx, delivery.id, { expectedVersion: await labLogisticsVersion(ctx, "deliveries", delivery.id), orderId: secondOrder.id })).rejects.toThrow(/source bin of a posted delivery/);

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
      { entityId: firstProduct.id, isDerived: true, distanceKm: 20 },
      { entityId: secondProduct.id, isDerived: true, distanceKm: 60 },
    ]));
    expect(legsAfterReassignment).toHaveLength(3);

    await updateCustomerLocation(ctx, secondLocation.id, { expectedVersion: await masterDataVersion(ctx, "customerLocations", secondLocation.id),
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

    await updateCustomerLocation(ctx, firstLocation.id, { expectedVersion: await masterDataVersion(ctx, "customerLocations", firstLocation.id),
      distanceFromFacilityKm: 40,
      distanceSource: "map_estimate",
    });
    const firstDerived = await db
      .select({ distanceKm: transportLegs.distanceKm })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, firstProduct.id),
        eq(transportLegs.isDerived, true),
      ));
    expect(firstDerived).toEqual([{ distanceKm: 40 }]);

    await expect(deleteDelivery(ctx, delivery.id, await labLogisticsVersion(ctx, "deliveries", delivery.id))).rejects.toThrow(/retain their history/);
    const remainingLegs = await db
      .select({
        entityId: transportLegs.entityId,
        isDerived: transportLegs.isDerived,
      })
      .from(transportLegs)
      .where(inArray(transportLegs.entityId, [firstProduct.id, secondProduct.id]));

    expect(remainingLegs).toEqual(expect.arrayContaining([
      { entityId: firstProduct.id, isDerived: false },
      { entityId: firstProduct.id, isDerived: true },
      { entityId: secondProduct.id, isDerived: true },
    ]));
    expect(remainingLegs).toHaveLength(3);

    const [retiringLeg] = await db.select({ id: transportLegs.id })
      .from(transportLegs)
      .where(and(
        eq(transportLegs.entityId, firstProduct.id),
        eq(transportLegs.isDerived, true),
        eq(transportLegs.organizationId, ctx.organizationId),
      ));
    const provider = new RetirementStorageProvider();
    const key = `transport_leg/${retiringLeg.id}/pdf/${tag}.pdf`;
    const documentId = await insertManagedDocument(provider, "transport_leg", retiringLeg.id, key);
    __setStorageProviderForTests(provider);

    try {
      // Clearing the only distance retires the derived leg and queues its evidence.
      const updated = await updateCustomerLocation(ctx, firstLocation.id, {
        expectedVersion: await masterDataVersion(ctx, "customerLocations", firstLocation.id),
        distanceFromFacilityKm: null,
      });

      expect(updated).toMatchObject({ id: firstLocation.id, distanceFromFacilityKm: null });
      expect(await db.select().from(transportLegs).where(eq(transportLegs.id, retiringLeg.id))).toHaveLength(0);
      expect(await db.select().from(documents).where(eq(documents.id, documentId))).toHaveLength(0);
      expect(provider.deleteCalls).toContain(key);
      expect(provider.objects.has(key)).toBe(false);
      const [deletion] = await db.select().from(storageObjectDeletions).where(and(
        eq(storageObjectDeletions.organizationId, ctx.organizationId),
        eq(storageObjectDeletions.storageKey, key),
      ));
      expect(deletion).toMatchObject({ attemptCount: 1, completedAt: expect.any(Date) });
    } finally {
      __setStorageProviderForTests(null);
      await db.delete(documents).where(eq(documents.id, documentId));
      await db.delete(storageObjectDeletions).where(and(
        eq(storageObjectDeletions.organizationId, ctx.organizationId),
        eq(storageObjectDeletions.storageKey, key),
      ));
    }
  });
});
