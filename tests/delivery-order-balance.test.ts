import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProducts,
  applications,
  customers,
  deliveries,
  facilities,
  orders,
} from "@/db/schema";
import { createDelivery, updateDelivery } from "@/data-access/deliveries";
import { updateOrder } from "@/data-access/orders";
import { getOrderEntityById } from "@/data-access/entities/orders";
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
      moistureContentPercent: 10,
      composition: { ingredients: [{ massKg: 8_000 }] },
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
    async cleanup(additionalProductIds: string[] = []) {
      await db.delete(deliveries).where(eq(deliveries.orderId, order.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      for (const productId of additionalProductIds) {
        await db.delete(biocharProducts).where(eq(biocharProducts.id, productId));
      }
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    },
  };
}

describe("delivery order balance", () => {
  it("validates status-only delivery updates against the stored wet mass", async () => {
    const seeded = await seedOrder(100);

    try {
      const weighed = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-WEIGHED`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 50,
      });
      const unweighed = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-UNWEIGHED`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-02T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: null,
      });

      await expect(
        updateDelivery(ctx, weighed.id, { status: "delivered" }),
      ).resolves.toMatchObject({
        status: "delivered",
        deliveredWetMassKg: 50,
      });
      await expect(
        updateDelivery(ctx, unweighed.id, { status: "delivered" }),
      ).rejects.toThrow("Wet mass must be greater than 0");
    } finally {
      await seeded.cleanup();
    }
  });

  it("allocates full product dry biochar independently of delivery moisture", async () => {
    const seeded = await seedOrder(10_000);

    try {
      const delivery = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-DRY-FULL`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 10_000,
        moistureContentPercent: 40,
      });

      expect(delivery.massDryKg).toBe(1_800);

      const updated = await updateDelivery(ctx, delivery.id, {
        moistureContentPercent: 5,
      });
      expect(updated.massDryKg).toBe(1_800);
    } finally {
      await seeded.cleanup();
    }
  });

  it("carries the exact dry remainder across partial deliveries", async () => {
    const seeded = await seedOrder(10_000);

    try {
      const first = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-DRY-1`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 3_333,
        moistureContentPercent: 5,
      });
      const last = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-DRY-2`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-02T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 6_667,
        moistureContentPercent: 40,
      });

      expect(first.massDryKg).toBe(599.94);
      expect(last.massDryKg).toBe(1_200.06);
      expect((first.massDryKg ?? 0) + (last.massDryKg ?? 0)).toBe(1_800);
    } finally {
      await seeded.cleanup();
    }
  });

  it("uses the remaining composition after recorded water is added", async () => {
    const seeded = await seedOrder(20_000);

    try {
      const first = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-WATER-1`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 5_000,
      });
      expect(first.massDryKg).toBe(900);

      await db
        .update(biocharProducts)
        .set({ waterAddedKg: 10_000 })
        .where(eq(biocharProducts.id, seeded.productId));

      const second = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-WATER-2`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-02T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 7_500,
      });
      expect(second.massDryKg).toBe(450);
    } finally {
      await seeded.cleanup();
    }
  });

  it("previews remaining order dry mass from the product's current remaining basis", async () => {
    const seeded = await seedOrder(1_000);

    try {
      await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-PREVIEW-BASIS`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 250,
      });
      await db
        .update(biocharProducts)
        .set({ waterAddedKg: 10_000 })
        .where(eq(biocharProducts.id, seeded.productId));

      await expect(
        getOrderEntityById(ctx, seeded.orderId),
      ).resolves.toMatchObject({
        remainingMass: { wetKg: 750, dryKg: 66.646 },
      });
    } finally {
      await seeded.cleanup();
    }
  });

  it("repairs a lone missing dry allocation on an unchanged save", async () => {
    const seeded = await seedOrder(10_000);

    try {
      const delivery = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-REPAIR`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 1_000,
      });
      await db
        .update(deliveries)
        .set({ massDryKg: null })
        .where(eq(deliveries.id, delivery.id));

      await expect(
        updateDelivery(ctx, delivery.id, { deliveredWetMassKg: 1_000 }),
      ).resolves.toMatchObject({ massDryKg: 180 });
    } finally {
      await seeded.cleanup();
    }
  });

  it("rejects changing delivery mass after an application exists", async () => {
    const seeded = await seedOrder(10_000);
    let applicationId: string | null = null;

    try {
      const delivery = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-APPLIED`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "delivered",
        deliveredWetMassKg: 1_000,
      });
      const [application] = await db
        .insert(applications)
        .values({
          organizationId: TEST_ORG_ID,
          code: `AP-ORDER-BAL-${seeded.tag}`,
          deliveryId: delivery.id,
          applicationDate: new Date("2026-08-02T00:00:00Z"),
          biocharAppliedTons: 0.5,
          biocharAppliedDryTons: 0.09,
        })
        .returning({ id: applications.id });
      applicationId = application.id;

      await db
        .update(deliveries)
        .set({ massDryKg: null })
        .where(eq(deliveries.id, delivery.id));
      await expect(
        updateDelivery(ctx, delivery.id, {
          code: `DL-ORDER-BAL-${seeded.tag}-APPLIED-RENAMED`,
        }),
      ).resolves.toMatchObject({ massDryKg: 180 });

      await expect(
        updateDelivery(ctx, delivery.id, { deliveredWetMassKg: 900 }),
      ).rejects.toThrow(
        "This delivery already has applications. Delete them before changing its order, product, or wet mass.",
      );
    } finally {
      if (applicationId) {
        await db.delete(applications).where(eq(applications.id, applicationId));
      }
      await seeded.cleanup();
    }
  });

  it("prevents upcoming deliveries across orders from over-allocating one product", async () => {
    const seeded = await seedOrder(8_000);
    const [secondOrder] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: seeded.facilityId,
        biocharProductId: seeded.productId,
        customerId: seeded.customerId,
        code: `OR-ORDER-BAL-${seeded.tag}-SECOND`,
        orderDate: new Date("2026-07-31T00:00:00Z"),
        quantityKg: 3_000,
        packaging: "loose",
      })
      .returning({ id: orders.id });

    try {
      await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-CROSS-1`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 8_000,
      });
      await expect(
        createDelivery(ctx, {
          code: `DL-ORDER-BAL-${seeded.tag}-CROSS-2`,
          orderId: secondOrder.id,
          facilityId: seeded.facilityId,
          deliveryDate: new Date("2026-08-02T00:00:00Z"),
          status: "upcoming",
          deliveredWetMassKg: 3_000,
        }),
      ).rejects.toThrow(
        "Biochar product wet mass exceeds the unallocated product balance.",
      );
    } finally {
      await db.delete(deliveries).where(eq(deliveries.orderId, secondOrder.id));
      await db.delete(orders).where(eq(orders.id, secondOrder.id));
      await seeded.cleanup();
    }
  });

  it("rejects changing an order product after a delivery inherits it", async () => {
    const seeded = await seedOrder(10_000);
    let replacementProductId: string | null = null;

    try {
      const delivery = await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-REPOINT`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 1_000,
        moistureContentPercent: 40,
      });
      expect(delivery.massDryKg).toBe(180);

      // Current deliveries snapshot their product. This null reproduces a
      // legacy row that still inherits the product from its order.
      await db
        .update(deliveries)
        .set({ biocharProductId: null })
        .where(eq(deliveries.id, delivery.id));

      const [replacementProduct] = await db
        .insert(biocharProducts)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: seeded.facilityId,
          code: `BP-ORDER-BAL-${seeded.tag}-REPLACEMENT`,
          massKg: 10_000,
          moistureContentPercent: 20,
          composition: { ingredients: [{ massKg: 5_000 }] },
        })
        .returning({ id: biocharProducts.id });
      replacementProductId = replacementProduct.id;

      await expect(
        updateOrder(ctx, seeded.orderId, {
          biocharProductId: replacementProduct.id,
        }),
      ).rejects.toThrow(
        "This order already has deliveries. Create a new order instead of changing its biochar product.",
      );
    } finally {
      await seeded.cleanup(replacementProductId ? [replacementProductId] : []);
    }
  });

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

  it("serializes an order shrink against a concurrent delivery allocation", async () => {
    const seeded = await seedOrder(100);

    try {
      const results = await Promise.allSettled([
        updateOrder(ctx, seeded.orderId, { quantityKg: 50 }),
        createDelivery(ctx, {
          code: `DL-ORDER-BAL-${seeded.tag}-SHRINK-RACE`,
          orderId: seeded.orderId,
          facilityId: seeded.facilityId,
          deliveryDate: new Date("2026-08-01T00:00:00Z"),
          status: "upcoming",
          deliveredWetMassKg: 60,
        }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled"))
        .toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected"))
        .toHaveLength(1);
    } finally {
      await seeded.cleanup();
    }
  });

  it("rejects shrinking an order below its existing delivery allocations", async () => {
    const seeded = await seedOrder(100);

    try {
      await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-SHRINK`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 60,
      });

      await expect(
        updateOrder(ctx, seeded.orderId, { quantityKg: 59 }),
      ).rejects.toThrow(
        "Order quantity cannot be less than the 60 kg already allocated to deliveries.",
      );
      await expect(
        updateOrder(ctx, seeded.orderId, { quantityKg: 60 }),
      ).resolves.toMatchObject({ quantityKg: 60 });
    } finally {
      await seeded.cleanup();
    }
  });

  it("rounds an actionable order minimum up to cover fractional allocations", async () => {
    const seeded = await seedOrder(100);

    try {
      await createDelivery(ctx, {
        code: `DL-ORDER-BAL-${seeded.tag}-FRACTIONAL`,
        orderId: seeded.orderId,
        facilityId: seeded.facilityId,
        deliveryDate: new Date("2026-08-01T00:00:00Z"),
        status: "upcoming",
        deliveredWetMassKg: 60.05,
      });

      await expect(
        updateOrder(ctx, seeded.orderId, { quantityKg: 60 }),
      ).rejects.toThrow(
        "Order quantity cannot be less than the 60.1 kg already allocated to deliveries.",
      );
    } finally {
      await seeded.cleanup();
    }
  });

  it("allows UI-shaped unchanged balance fields on legacy delivery and order edits", async () => {
    const seeded = await seedOrder(50);

    try {
      const [legacyDelivery] = await db
        .insert(deliveries)
        .values({
          organizationId: TEST_ORG_ID,
          code: `DL-ORDER-BAL-${seeded.tag}-LEGACY`,
          orderId: seeded.orderId,
          facilityId: seeded.facilityId,
          deliveryDate: new Date("2026-08-01T00:00:00Z"),
          status: "upcoming",
          deliveredWetMassKg: 60,
        })
        .returning({ id: deliveries.id });

      await expect(
        updateDelivery(ctx, legacyDelivery.id, {
          code: `DL-ORDER-BAL-${seeded.tag}-RENAMED`,
          orderId: seeded.orderId,
          facilityId: seeded.facilityId,
          deliveryDate: new Date("2026-08-01T00:00:00Z"),
          biocharProductId: null,
          status: "upcoming",
          deliveredWetMassKg: 60,
          moistureContentPercent: null,
        }),
      ).resolves.toMatchObject({
        code: `DL-ORDER-BAL-${seeded.tag}-RENAMED`,
        deliveredWetMassKg: 60,
      });

      await expect(
        updateOrder(ctx, seeded.orderId, {
          code: `OR-ORDER-BAL-${seeded.tag}-RENAMED`,
          facilityId: seeded.facilityId,
          customerId: seeded.customerId,
          customerLocationId: null,
          biocharProductId: seeded.productId,
          orderDate: new Date("2026-07-31T00:00:00Z"),
          quantityKg: 50,
          packaging: "loose",
          value: null,
          currency: "TZS",
        }),
      ).resolves.toMatchObject({
        code: `OR-ORDER-BAL-${seeded.tag}-RENAMED`,
        quantityKg: 50,
      });

      await expect(
        updateDelivery(ctx, legacyDelivery.id, {
          deliveredWetMassKg: 61,
        }),
      ).rejects.toThrow(
        "Only 50 kg remains on this order. Reduce the delivered mass.",
      );
      await expect(
        updateOrder(ctx, seeded.orderId, { quantityKg: 49 }),
      ).rejects.toThrow(
        "Order quantity cannot be less than the 60 kg already allocated to deliveries.",
      );
    } finally {
      await seeded.cleanup();
    }
  });
});
