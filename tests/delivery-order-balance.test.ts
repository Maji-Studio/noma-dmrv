import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  customers,
  deliveries,
  facilities,
  orders,
} from "@/db/schema";
import { createDelivery, updateDelivery } from "@/data-access/deliveries";
import { getStockAvailability } from "@/data-access/stock-availability";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const ctx = makeTestOrgContext("delivery-order-balance-test");

beforeAll(async () => {
  await ensureTestOrg();
});

async function seedOrder(quantityKg: number) {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FAC-ORDER-BAL-${tag}`,
      name: `Order Balance Facility ${tag}`,
    })
    .returning({ id: facilities.id });
  const [product] = await db
    .insert(biocharProducts)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      code: `BP-ORDER-BAL-${tag}`,
      massKg: 10_000,
    })
    .returning({ id: biocharProducts.id });
  const [customer] = await db
    .insert(customers)
    .values({
      organizationId: TEST_ORG_ID,
      code: `CU-ORDER-BAL-${tag}`,
      name: `Order Balance Customer ${tag}`,
    })
    .returning({ id: customers.id });
  const [order] = await db
    .insert(orders)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      biocharProductId: product.id,
      customerId: customer.id,
      code: `OR-ORDER-BAL-${tag}`,
      orderDate: new Date("2026-07-31T00:00:00Z"),
      quantityKg,
      packaging: "loose",
    })
    .returning({ id: orders.id });

  return {
    tag,
    facilityId: facility.id,
    productId: product.id,
    customerId: customer.id,
    orderId: order.id,
    async cleanup() {
      await db.delete(deliveries).where(eq(deliveries.orderId, order.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    },
  };
}

describe("delivery order balance", () => {
  it("counts upcoming deliveries as allocations when creating a delivery", async () => {
    const seeded = await seedOrder(100);

    try {
      await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-1`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 60,
      });

      await expect(
        createDelivery(ctx, {
          code: `DL-ORDER-BAL-${seeded.tag}-2`,
          orderId: seeded.orderId,
          facilityId: seeded.facilityId,
          deliveryDate: new Date("2026-08-02T00:00:00Z"),
          status: "upcoming",
          deliveredWetMassKg: 50,
        }),
      ).rejects.toThrow(
        "Only 40 kg remains on this order. Reduce the delivered mass.",
      );
    } finally {
      await seeded.cleanup();
    }
  });

  it("re-credits the current delivery when checking an edit", async () => {
    const seeded = await seedOrder(100);

    try {
      const current = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-CURRENT`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 60,
      });
      await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-OTHER`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-02T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 20,
      });

      await expect(
        updateDelivery(ctx, current.id, { deliveredWetMassKg: 80 }),
      ).resolves.toMatchObject({ deliveredWetMassKg: 80 });
      await expect(
        updateDelivery(ctx, current.id, { deliveredWetMassKg: 81 }),
      ).rejects.toThrow(
        "Only 80 kg remains on this order. Reduce the delivered mass.",
      );
    } finally {
      await seeded.cleanup();
    }
  });

  it("reports the live order balance for immediate create and edit feedback", async () => {
    const seeded = await seedOrder(100);

    try {
      const current = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-CURRENT`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 60,
      });
      await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-OTHER`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-02T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 20,
      });

      await expect(
        getStockAvailability(ctx, {
          kind: "delivery",
          orderId: seeded.orderId,
        }),
      ).resolves.toMatchObject({ orderAvailableKg: 20 });
      await expect(
        getStockAvailability(ctx, {
          kind: "delivery",
          orderId: seeded.orderId,
          deliveryId: current.id,
        }),
      ).resolves.toMatchObject({ orderAvailableKg: 80 });
    } finally {
      await seeded.cleanup();
    }
  });

  it("serializes concurrent allocations against the same order", async () => {
    const seeded = await seedOrder(100);

    try {
      const results = await Promise.allSettled(
        [1, 2].map((attempt) =>
          createDelivery(ctx, {
            code: `DL-ORDER-BAL-${seeded.tag}-RACE-${attempt}`,
            orderId: seeded.orderId,
            facilityId: seeded.facilityId,
            deliveryDate: new Date("2026-08-01T00:00:00Z"),
            status: "upcoming",
            deliveredWetMassKg: 60,
          }),
        ),
      );

      expect(results.filter((result) => result.status === "fulfilled"))
        .toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected"))
        .toHaveLength(1);
      await expect(
        db
          .select({ deliveredWetMassKg: deliveries.deliveredWetMassKg })
          .from(deliveries)
          .where(eq(deliveries.orderId, seeded.orderId)),
      ).resolves.toEqual([{ deliveredWetMassKg: 60 }]);
    } finally {
      await seeded.cleanup();
    }
  });
});
