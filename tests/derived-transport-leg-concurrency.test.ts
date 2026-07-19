import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  customerLocations,
  customers,
  deliveries,
  facilities,
  orders,
  transportLegs,
} from "@/db/schema";
import { createDelivery, updateDelivery } from "@/data-access/deliveries";
import { updateOrder } from "@/data-access/orders";
import { syncBiocharProductTransportLegs } from "@/data-access/transport-legs";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const ctx = makeTestOrgContext();
const BARRIER_TIMEOUT_MS = 5_000;
const CONCURRENCY_TEST_TIMEOUT_MS = 30_000;

interface DistributionFixture {
  facilityId: string;
  customerId: string;
  locationIds: string[];
  productIds: string[];
  orderId: string;
}

describe(
  "derived biochar transport-leg synchronization",
  { timeout: CONCURRENCY_TEST_TIMEOUT_MS },
  () => {
    const created = {
      facilityIds: [] as string[],
      customerIds: [] as string[],
      customerLocationIds: [] as string[],
      biocharProductIds: [] as string[],
      orderIds: [] as string[],
      deliveryIds: [] as string[],
    };

    beforeAll(() => ensureTestOrg());

    afterEach(async () => {
      if (created.biocharProductIds.length > 0) {
        await db
          .delete(transportLegs)
          .where(inArray(transportLegs.entityId, created.biocharProductIds));
      }
      if (created.deliveryIds.length > 0) {
        await db.delete(deliveries).where(inArray(deliveries.id, created.deliveryIds));
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
      if (created.facilityIds.length > 0) {
        await db.delete(facilities).where(inArray(facilities.id, created.facilityIds));
      }

      for (const ids of Object.values(created)) ids.length = 0;
    });

    async function createFixture(
      tagPrefix: string,
      locationDistances: number[],
      productCount: number,
    ): Promise<DistributionFixture> {
      const tag = `${tagPrefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const [facility] = await db
        .insert(facilities)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FAC-${tag}`,
          name: `Transport Sync Facility ${tag}`,
        })
        .returning({ id: facilities.id });
      created.facilityIds.push(facility.id);

      const [customer] = await db
        .insert(customers)
        .values({
          organizationId: TEST_ORG_ID,
          code: `CUS-${tag}`,
          name: `Transport Sync Customer ${tag}`,
        })
        .returning({ id: customers.id });
      created.customerIds.push(customer.id);

      const locations = await db
        .insert(customerLocations)
        .values(
          locationDistances.map((distance, index) => ({
            organizationId: TEST_ORG_ID,
            customerId: customer.id,
            name: `Transport Sync Site ${tag}-${index}`,
            distanceFromFacilityKm: distance,
            distanceSource: "manual" as const,
          })),
        )
        .returning({ id: customerLocations.id });
      const locationIds = locations.map((location) => location.id);
      created.customerLocationIds.push(...locationIds);

      const products = await db
        .insert(biocharProducts)
        .values(
          Array.from({ length: productCount }, (_, index) => ({
            organizationId: TEST_ORG_ID,
            facilityId: facility.id,
            code: `BP-${tag}-${index}`,
            massKg: 1_000,
          })),
        )
        .returning({ id: biocharProducts.id });
      const productIds = products.map((product) => product.id);
      created.biocharProductIds.push(...productIds);

      const [order] = await db
        .insert(orders)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          customerId: customer.id,
          customerLocationId: locationIds[0],
          biocharProductId: productIds[0],
          code: `OR-${tag}`,
          orderDate: new Date("2026-07-18T00:00:00Z"),
          quantityKg: 500,
          packaging: "bagged",
        })
        .returning({ id: orders.id });
      created.orderIds.push(order.id);

      return {
        facilityId: facility.id,
        customerId: customer.id,
        locationIds,
        productIds,
        orderId: order.id,
      };
    }

    async function createDelivered(
      fixture: DistributionFixture,
      codeSuffix: string,
      productId: string,
      massKg: number,
      distanceKmOverride?: number,
    ) {
      const delivery = await createDelivery(ctx, {
        code: `DL-${codeSuffix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        orderId: fixture.orderId,
        facilityId: fixture.facilityId,
        deliveryDate: new Date("2026-07-19T00:00:00Z"),
        biocharProductId: productId,
        status: "delivered",
        deliveredWetMassKg: massKg,
        distanceKmOverride,
        distanceSource: distanceKmOverride === undefined ? null : "manual",
      });
      created.deliveryIds.push(delivery.id);
      return delivery;
    }

    it("serializes two delivery aggregates on one product across real connections", async () => {
      const fixture = await createFixture("RACE", [10], 1);
      const [secondOrder] = await db
        .insert(orders)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: fixture.facilityId,
          customerId: fixture.customerId,
          customerLocationId: fixture.locationIds[0],
          biocharProductId: fixture.productIds[0],
          code: `OR-RACE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          orderDate: new Date("2026-07-18T00:00:00Z"),
          quantityKg: 500,
          packaging: "bagged",
        })
        .returning({ id: orders.id });
      created.orderIds.push(secondOrder.id);
      const secondOrderFixture = { ...fixture, orderId: secondOrder.id };
      const [first, second] = await Promise.all([
        createDelivered(fixture, "RACE-A", fixture.productIds[0], 100, 20),
        createDelivered(
          secondOrderFixture,
          "RACE-B",
          fixture.productIds[0],
          100,
          40,
        ),
      ]);

      let releaseBarrier = () => {};
      let signalBarrierReady = () => {};
      const barrierReady = new Promise<void>((resolve) => {
        signalBarrierReady = resolve;
      });
      const barrierRelease = new Promise<void>((resolve) => {
        releaseBarrier = resolve;
      });
      const barrierTransaction = db.transaction(async (tx) => {
        await tx.execute(sql`lock table ${transportLegs} in share mode`);
        signalBarrierReady();
        await barrierRelease;
      });

      let updates:
        | Promise<
            [
              PromiseSettledResult<Awaited<ReturnType<typeof updateDelivery>>>,
              PromiseSettledResult<Awaited<ReturnType<typeof updateDelivery>>>,
            ]
          >
        | undefined;

      try {
        await barrierReady;
        updates = Promise.allSettled([
          updateDelivery(ctx, first.id, {
            distanceKmOverride: 30,
            distanceSource: "manual",
          }),
          updateDelivery(ctx, second.id, {
            distanceKmOverride: 70,
            distanceSource: "manual",
          }),
        ]);

        // One transaction has passed the aggregate lock and is parked on the
        // table-write barrier. A distinct connection must be waiting on that
        // transaction's advisory lock before the barrier is released.
        await expect
          .poll(
            async () => {
              const result = await db.execute<{ ready: boolean }>(sql`
                with blocked_transport_writers as (
                  select pid
                  from pg_locks
                  where not granted
                    and mode = 'RowExclusiveLock'
                    and relation = 'transport_legs'::regclass
                )
                select exists (
                  select 1
                  from pg_locks waiting
                  join pg_locks held
                    on held.locktype = waiting.locktype
                   and held.database is not distinct from waiting.database
                   and held.classid is not distinct from waiting.classid
                   and held.objid is not distinct from waiting.objid
                   and held.objsubid is not distinct from waiting.objsubid
                  where waiting.locktype = 'advisory'
                    and not waiting.granted
                    and held.granted
                    and held.pid in (select pid from blocked_transport_writers)
                ) as ready
              `);
              return result.rows[0]?.ready ?? false;
            },
            { timeout: BARRIER_TIMEOUT_MS },
          )
          .toBe(true);

        releaseBarrier();
        await barrierTransaction;
        const results = await updates;
        expect(results.every((result) => result.status === "fulfilled")).toBe(true);

        const [derived] = await db
          .select({
            distanceKm: transportLegs.distanceKm,
            loadMassKg: transportLegs.loadMassKg,
          })
          .from(transportLegs)
          .where(and(
            eq(transportLegs.entityType, "biochar"),
            eq(transportLegs.entityId, fixture.productIds[0]),
            eq(transportLegs.isDerived, true),
          ));

        expect(derived).toEqual({ distanceKm: 50, loadMassKg: 200 });
      } finally {
        releaseBarrier();
        await barrierTransaction.catch(() => undefined);
        await updates?.catch(() => undefined);
      }
    });

    it("moves inherited deliveries from the old product leg to the new one", async () => {
      const fixture = await createFixture("REPOINT", [20], 3);
      const inherited = await createDelivered(
        fixture,
        "REPOINT-INHERITED",
        fixture.productIds[0],
        100,
      );
      const explicit = await createDelivered(
        fixture,
        "REPOINT-EXPLICIT",
        fixture.productIds[2],
        50,
      );
      await db
        .update(deliveries)
        .set({ biocharProductId: null })
        .where(eq(deliveries.id, inherited.id));

      await updateOrder(ctx, fixture.orderId, {
        biocharProductId: fixture.productIds[1],
      });

      const legs = await db
        .select({
          entityId: transportLegs.entityId,
          distanceKm: transportLegs.distanceKm,
          loadMassKg: transportLegs.loadMassKg,
        })
        .from(transportLegs)
        .where(and(
          inArray(transportLegs.entityId, fixture.productIds),
          eq(transportLegs.isDerived, true),
        ));

      expect(legs).toEqual(expect.arrayContaining([
        { entityId: fixture.productIds[1], distanceKm: 20, loadMassKg: 100 },
        { entityId: fixture.productIds[2], distanceKm: 20, loadMassKg: 50 },
      ]));
      expect(legs.find((leg) => leg.entityId === fixture.productIds[0])).toBeUndefined();

      const [explicitAfter] = await db
        .select({ biocharProductId: deliveries.biocharProductId })
        .from(deliveries)
        .where(eq(deliveries.id, explicit.id));
      expect(explicitAfter.biocharProductId).toBe(fixture.productIds[2]);
    });

    it("updates inherited order distance without replacing a delivery location override", async () => {
      const fixture = await createFixture("LOCATION", [20, 60, 100], 1);
      const inherited = await createDelivered(
        fixture,
        "LOCATION-INHERITED",
        fixture.productIds[0],
        100,
      );
      const explicit = await createDelivered(
        fixture,
        "LOCATION-EXPLICIT",
        fixture.productIds[0],
        100,
      );
      await db
        .update(deliveries)
        .set({ customerLocationId: fixture.locationIds[2] })
        .where(eq(deliveries.id, explicit.id));
      await db.transaction((tx) =>
        syncBiocharProductTransportLegs(ctx, tx, [fixture.productIds[0]]),
      );

      await updateOrder(ctx, fixture.orderId, {
        customerLocationId: fixture.locationIds[1],
      });

      const [derived] = await db
        .select({
          distanceKm: transportLegs.distanceKm,
          loadMassKg: transportLegs.loadMassKg,
        })
        .from(transportLegs)
        .where(and(
          eq(transportLegs.entityId, fixture.productIds[0]),
          eq(transportLegs.isDerived, true),
        ));
      expect(derived).toEqual({ distanceKm: 80, loadMassKg: 200 });

      const deliveryLocations = await db
        .select({ id: deliveries.id, customerLocationId: deliveries.customerLocationId })
        .from(deliveries)
        .where(inArray(deliveries.id, [inherited.id, explicit.id]));
      expect(deliveryLocations).toEqual(expect.arrayContaining([
        { id: inherited.id, customerLocationId: null },
        { id: explicit.id, customerLocationId: fixture.locationIds[2] },
      ]));
    });
  },
);
