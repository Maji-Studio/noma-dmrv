import { beforeAll, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerLocations, deliveries, feedstocks, orders, supplierLocations, suppliers } from "@/db/schema";
import { updateCustomerLocation } from "./helpers/customer-location-operations";
import { createSupplierLocation, updateSupplierLocation } from "./helpers/supplier-location-operations";
import { getTransportLegsForEntity } from "@/data-access/transport-legs";
import * as transportLegWriters from "@/data-access/transport-legs";
import * as locationDistanceFill from "@/data-access/location-distance-fill";
import { getDeliveryWithRelations } from "@/data-access/deliveries";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";
import { ensureOutputFixtureActor } from "./helpers/output-contract-fixtures";
import { upsertLocationFacilityDistances } from "@/data-access/location-facility-distances";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";

const BARRIER_POOL_SIZE = 2;
const CONCURRENCY_TEST_TIMEOUT_MS = 15_000;

const ctx = makeTestOrgContext();
beforeAll(async () => { await ensureTestOrg(); await ensureOutputFixtureActor(ctx); });

it("fills changed and persisted promotion pairs in one ascending feedstock pass", async () => {
  await withLineageFixture(async first => {
    await withLineageFixture(async second => {
      const [lower, higher] = [first, second].sort((a, b) => a.feedstockId.localeCompare(b.feedstockId));
      const [lowerFeedstock] = await db.select().from(feedstocks).where(eq(feedstocks.id, lower.feedstockId));
      const [higherFeedstock] = await db.select().from(feedstocks).where(eq(feedstocks.id, higher.feedstockId));
      await db.update(feedstocks).set({ supplierId: lowerFeedstock.supplierId }).where(eq(feedstocks.id, higher.feedstockId));
      const original = await createSupplierLocation(ctx, {
        ...TEST_SITE_POSITION, supplierId: lowerFeedstock.supplierId, isDefault: true,
      });
      const promoted = await createSupplierLocation(ctx, {
        ...TEST_SITE_POSITION, supplierId: lowerFeedstock.supplierId, isDefault: false,
        facilityDistances: [{ facilityId: lower.facilityId, distanceKm: 35, distanceSource: "manual" }],
      });
      const fill = vi.spyOn(locationDistanceFill, "fillMissingLocationDistances");
      const sync = vi.spyOn(transportLegWriters, "syncFeedstockTransportLeg");
      try {
        await updateSupplierLocation(ctx, promoted.id, {
          expectedVersion: promoted.version, isDefault: true,
          facilityDistances: [{ facilityId: higher.facilityId, distanceKm: 80, distanceSource: "document" }],
        });
        expect(fill).toHaveBeenCalledTimes(1);
        expect(await fill.mock.results[0].value).toEqual({
          filled: 2, skipped: { submitted: 0, concurrent: 0, repointed: 0 },
        });
        expect(fill.mock.calls[0][4]).toEqual(expect.arrayContaining([
          expect.objectContaining({ facilityId: lower.facilityId, distanceKm: 35 }),
          expect.objectContaining({ facilityId: higher.facilityId, distanceKm: 80 }),
        ]));
        expect(sync.mock.calls.map(call => call[2])).toEqual([lower.feedstockId, higher.feedstockId]);
        expect(await getTransportLegsForEntity(ctx, "feedstock", lower.feedstockId)).toEqual([
          expect.objectContaining({ distanceKm: 35, distanceSource: "manual" }),
        ]);
        expect(await getTransportLegsForEntity(ctx, "feedstock", higher.feedstockId)).toEqual([
          expect.objectContaining({ distanceKm: 80, distanceSource: "document" }),
        ]);
      } finally {
        fill.mockRestore();
        sync.mockRestore();
        await db.delete(supplierLocations).where(eq(supplierLocations.id, promoted.id));
        await db.delete(supplierLocations).where(eq(supplierLocations.id, original.id));
        await db.update(feedstocks).set({ supplierId: higherFeedstock.supplierId }).where(eq(feedstocks.id, higher.feedstockId));
      }
    }, "none");
  }, "none");
});

it.each(["concurrent", "repointed"] as const)("counts an intake skipped because it was %s after discovery", async reason => {
  await withLineageFixture(async fixture => {
    const [feedstock] = await db.select().from(feedstocks).where(eq(feedstocks.id, fixture.feedstockId));
    const location = await createSupplierLocation(ctx, { ...TEST_SITE_POSITION, supplierId: feedstock.supplierId });
    const pairs = [{ facilityId: fixture.facilityId, distanceKm: 35, distanceSource: "manual" as const }];
    await db.transaction(tx => upsertLocationFacilityDistances(ctx, tx, "supplier", location.id, pairs, { deferFill: true }));
    const [other] = await db.insert(suppliers).values({ organizationId: TEST_ORG_ID, code: `FILL-${crypto.randomUUID()}`, name: "Fill repoint" }).returning();
    const pool = createTestPool(BARRIER_POOL_SIZE);
    const barrier = await openOperationBarrier(pool);
    let pending: ReturnType<typeof db.transaction> | undefined;
    try {
      await barrier.tx.select().from(feedstocks).where(eq(feedstocks.id, feedstock.id)).for("update");
      if (reason === "repointed") {
        await barrier.tx.update(feedstocks).set({ supplierId: other.id }).where(eq(feedstocks.id, feedstock.id));
      } else {
        await transportLegWriters.syncFeedstockTransportLeg(ctx, barrier.tx, feedstock.id);
      }
      const fill = db.transaction(tx => locationDistanceFill.fillMissingLocationDistances(ctx, tx, "supplier", location.id, pairs));
      pending = fill;
      void fill.catch(() => undefined);
      await waitForBlockedOperations(pool, barrier.pid, 1);
      await barrier.commit();
      expect(await fill).toEqual({
        filled: 0, skipped: { submitted: 0, concurrent: reason === "concurrent" ? 1 : 0, repointed: reason === "repointed" ? 1 : 0 },
      });
    } finally {
      await barrier.rollback();
      await pending?.catch(() => undefined);
      await db.update(feedstocks).set({ supplierId: feedstock.supplierId }).where(eq(feedstocks.id, feedstock.id));
      await db.delete(supplierLocations).where(eq(supplierLocations.id, location.id));
      await db.delete(suppliers).where(eq(suppliers.id, other.id));
      await pool.end();
    }
  }, "none");
}, CONCURRENCY_TEST_TIMEOUT_MS);

it("counts a delivery filled concurrently after discovery", async () => {
  await withLineageFixture(async fixture => {
    const [order] = await db.select().from(orders).where(eq(orders.id, fixture.orderId));
    await db.update(deliveries).set({ recordedDistanceKm: null, recordedDistanceSource: null }).where(eq(deliveries.id, fixture.deliveryId));
    const pool = createTestPool(BARRIER_POOL_SIZE);
    const barrier = await openOperationBarrier(pool);
    let pending: ReturnType<typeof db.transaction> | undefined;
    try {
      await barrier.tx.update(deliveries).set({ recordedDistanceKm: 80, recordedDistanceSource: "manual" }).where(eq(deliveries.id, fixture.deliveryId));
      const fill = db.transaction(tx => locationDistanceFill.fillMissingLocationDistances(ctx, tx, "customer", order.customerLocationId, [
        { facilityId: fixture.facilityId, distanceKm: 25, distanceSource: "document" },
      ]));
      pending = fill;
      void fill.catch(() => undefined);
      await waitForBlockedOperations(pool, barrier.pid, 1);
      await barrier.commit();
      expect(await fill).toEqual({ filled: 0, skipped: { submitted: 0, concurrent: 1, repointed: 0 } });
      expect((await getDeliveryWithRelations(ctx, fixture.deliveryId)).recordedDistanceKm).toBe(80);
    } finally {
      await barrier.rollback();
      await pending?.catch(() => undefined);
      await pool.end();
    }
  }, "none");
}, CONCURRENCY_TEST_TIMEOUT_MS);

it.each(["removal", "ghgStatement", "none"] as const)("fills only unlocked missing distances with %s lineage", async blockingVia => {
  const fill = vi.spyOn(locationDistanceFill, "fillMissingLocationDistances");
  await withLineageFixture(async fixture => {
    const [order] = await db.select().from(orders).where(eq(orders.id, fixture.orderId));
    const [location] = await db.select().from(customerLocations).where(eq(customerLocations.id, order.customerLocationId));
    await db.update(deliveries).set({ distanceKmOverride: null, recordedDistanceKm: null, recordedDistanceSource: null })
      .where(and(eq(deliveries.organizationId, TEST_ORG_ID), eq(deliveries.id, fixture.deliveryId)));
    const savedLocation = await updateCustomerLocation(ctx, location.id, { expectedVersion: location.version,
      facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 25, distanceSource: "document" }] });
    const delivery = await getDeliveryWithRelations(ctx, fixture.deliveryId);
    expect(await fill.mock.results.at(-1)!.value).toEqual({
      filled: blockingVia === "none" ? 1 : 0,
      skipped: { submitted: blockingVia === "none" ? 0 : 1, concurrent: 0, repointed: 0 },
    });
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
      expect(await fill.mock.results.at(-1)!.value).toEqual({
        filled: blockingVia === "none" ? 1 : 0,
        skipped: { submitted: blockingVia === "none" ? 0 : 1, concurrent: 0, repointed: 0 },
      });
      expect(legs).toHaveLength(blockingVia === "none" ? 1 : 0);
      if (blockingVia === "none") {
        expect(legs[0].distanceKm).toBe(35);
        await updateSupplierLocation(ctx, supplierLocation.id, { expectedVersion: saved.version,
          facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 80, distanceSource: "document" }] });
        expect(await fill.mock.results.at(-1)!.value).toEqual({
          filled: 0, skipped: { submitted: 0, concurrent: 0, repointed: 0 },
        });
        expect(await getTransportLegsForEntity(ctx, "feedstock", feedstock.id)).toEqual(legs);
      }
    } finally {
      await db.delete(supplierLocations).where(eq(supplierLocations.id, supplierLocation.id));
    }
  }, blockingVia);
});

it("does not fill archived deliveries or feedstocks at an active facility", async () => {
  await withLineageFixture(async fixture => {
    const [order] = await db.select().from(orders).where(eq(orders.id, fixture.orderId));
    const [location] = await db.select().from(customerLocations).where(eq(customerLocations.id, order.customerLocationId));
    await db.update(deliveries).set({ recordedDistanceKm: null, recordedDistanceSource: null, archivedAt: new Date() })
      .where(eq(deliveries.id, fixture.deliveryId));
    await updateCustomerLocation(ctx, location.id, { expectedVersion: location.version,
      facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 25, distanceSource: "manual" }] });
    expect((await getDeliveryWithRelations(ctx, fixture.deliveryId)).recordedDistanceKm).toBeNull();

    const [feedstock] = await db.update(feedstocks).set({ archivedAt: new Date() })
      .where(eq(feedstocks.id, fixture.feedstockId)).returning();
    const [supplierLocation] = await db.insert(supplierLocations).values({
      ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, supplierId: feedstock.supplierId, isDefault: true,
    }).returning();
    try {
      await updateSupplierLocation(ctx, supplierLocation.id, { expectedVersion: supplierLocation.version,
        facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 35, distanceSource: "manual" }] });
      expect(await getTransportLegsForEntity(ctx, "feedstock", feedstock.id)).toEqual([]);
    } finally {
      await db.delete(supplierLocations).where(eq(supplierLocations.id, supplierLocation.id));
    }
  }, "none");
});


it.each(["removal", "ghgStatement", "none"] as const)("fills from persisted pairs on default promotion with %s lineage", async blockingVia => {
  await withLineageFixture(async fixture => {
    const [feedstock] = await db.select().from(feedstocks).where(eq(feedstocks.id, fixture.feedstockId));
    const original = await createSupplierLocation(ctx, {
      ...TEST_SITE_POSITION, supplierId: feedstock.supplierId, isDefault: true,
    });
    const promoted = await createSupplierLocation(ctx, {
      ...TEST_SITE_POSITION, supplierId: feedstock.supplierId, isDefault: false,
      facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 35, distanceSource: "manual" }],
    });
    try {
      expect(await getTransportLegsForEntity(ctx, "feedstock", feedstock.id)).toEqual([]);
      await updateSupplierLocation(ctx, promoted.id, {
        expectedVersion: promoted.version, isDefault: true, facilityDistances: [],
      });
      const legs = await getTransportLegsForEntity(ctx, "feedstock", feedstock.id);
      expect(legs).toHaveLength(blockingVia === "none" ? 1 : 0);
      if (blockingVia === "none") {
        expect(legs[0].distanceKm).toBe(35);
        const [currentOriginal] = await db.select().from(supplierLocations).where(eq(supplierLocations.id, original.id));
        await updateSupplierLocation(ctx, original.id, {
          expectedVersion: currentOriginal.version, isDefault: true,
          facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 80, distanceSource: "document" }],
        });
        expect(await getTransportLegsForEntity(ctx, "feedstock", feedstock.id)).toEqual(legs);
      }
    } finally {
      await db.delete(supplierLocations).where(and(eq(supplierLocations.organizationId, TEST_ORG_ID), eq(supplierLocations.supplierId, feedstock.supplierId)));
    }
  }, blockingVia);
});
