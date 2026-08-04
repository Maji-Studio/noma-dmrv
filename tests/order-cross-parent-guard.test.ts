import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { createOrder, updateOrder } from "@/data-access/orders";
import { db } from "@/db";
import { facilities } from "@/db/schema/facilities";
import { orders } from "@/db/schema/logistics";
import { customerLocations, customers } from "@/db/schema/parties";
import { biocharProducts } from "@/db/schema/products";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";


describe("order cross-parent guards", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  let facilityId: string;
  let productId: string;
  let zeroBiocharProductId: string;
  let customerAId: string;
  let customerBId: string;
  let locationAId: string;
  let locationBId: string;
  let orderId: string;
  let zeroProductOrderId: string;

  beforeAll(() => ensureTestOrg());

beforeAll(async () => {
    const fixture = await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({ organizationId: TEST_ORG_ID, code: `FAC-OCG-${tag}`, name: `OCG Facility ${tag}` })
        .returning({ id: facilities.id });
      const [product] = await tx
        .insert(biocharProducts)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BP-OCG-${tag}`,
          facilityId: facility.id,
          massKg: 100,
        })
        .returning({ id: biocharProducts.id });
      const [zeroBiocharProduct] = await tx
        .insert(biocharProducts)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BP-OCG-ZERO-${tag}`,
          facilityId: facility.id,
          massKg: 100,
          composition: {
            ingredients: [{ massKg: 100 }],
          },
        })
        .returning({ id: biocharProducts.id });
      const [customerA] = await tx
        .insert(customers)
        .values({ organizationId: TEST_ORG_ID, code: `CU-OCG-A-${tag}`, name: `OCG Customer A ${tag}` })
        .returning({ id: customers.id });
      const [customerB] = await tx
        .insert(customers)
        .values({ organizationId: TEST_ORG_ID, code: `CU-OCG-B-${tag}`, name: `OCG Customer B ${tag}` })
        .returning({ id: customers.id });
      const [locationA] = await tx
        .insert(customerLocations)
        .values({
          organizationId: TEST_ORG_ID,
          customerId: customerA.id,
          name: `OCG Location A ${tag}`,
          country: "Tanzania",
        })
        .returning({ id: customerLocations.id });
      const [locationB] = await tx
        .insert(customerLocations)
        .values({
          organizationId: TEST_ORG_ID,
          customerId: customerB.id,
          name: `OCG Location B ${tag}`,
          country: "Tanzania",
        })
        .returning({ id: customerLocations.id });
      const [order] = await tx
        .insert(orders)
        .values({
          organizationId: TEST_ORG_ID,
          code: `OR-OCG-${tag}`,
          facilityId: facility.id,
          customerId: customerA.id,
          customerLocationId: locationA.id,
          biocharProductId: product.id,
          orderDate: new Date("2026-06-13"),
          quantityKg: 100,
          packaging: "loose",
        })
        .returning({ id: orders.id });
      const [zeroProductOrder] = await tx
        .insert(orders)
        .values({
          organizationId: TEST_ORG_ID,
          code: `OR-OCG-ZERO-EXISTING-${tag}`,
          facilityId: facility.id,
          customerId: customerA.id,
          customerLocationId: locationA.id,
          biocharProductId: zeroBiocharProduct.id,
          orderDate: new Date("2026-06-13"),
          quantityKg: 100,
          packaging: "loose",
        })
        .returning({ id: orders.id });

      return {
        customerAId: customerA.id,
        customerBId: customerB.id,
        facilityId: facility.id,
        locationAId: locationA.id,
        locationBId: locationB.id,
        orderId: order.id,
        productId: product.id,
        zeroBiocharProductId: zeroBiocharProduct.id,
        zeroProductOrderId: zeroProductOrder.id,
      };
    });

    customerAId = fixture.customerAId;
    customerBId = fixture.customerBId;
    facilityId = fixture.facilityId;
    locationAId = fixture.locationAId;
    locationBId = fixture.locationBId;
    orderId = fixture.orderId;
    productId = fixture.productId;
    zeroBiocharProductId = fixture.zeroBiocharProductId;
    zeroProductOrderId = fixture.zeroProductOrderId;
  });

  afterAll(async () => {
    async function cleanup(step: () => Promise<unknown>) {
      try {
        await step();
      } catch {
        // Best-effort teardown; preserve the original assertion failure.
      }
    }

    await cleanup(() =>
      db.delete(orders).where(inArray(orders.id, [orderId, zeroProductOrderId])),
    );
    await cleanup(() =>
      db
        .delete(customerLocations)
        .where(inArray(customerLocations.id, [locationAId, locationBId])),
    );
    await cleanup(() =>
      db.delete(customers).where(inArray(customers.id, [customerAId, customerBId])),
    );
    await cleanup(() =>
      db
        .delete(biocharProducts)
        .where(inArray(biocharProducts.id, [productId, zeroBiocharProductId])),
    );
    await cleanup(() => db.delete(facilities).where(eq(facilities.id, facilityId)));
  });

  it("rejects creating an order with a location from another customer", async () => {
    await expect(
      createOrder(makeTestOrgContext(TEST_USER_ID), {
        code: `OR-OCG-CREATE-${tag}`,
        facilityId,
        customerId: customerAId,
        customerLocationId: locationBId,
        biocharProductId: productId,
        orderDate: new Date("2026-06-13"),
        quantityKg: 100,
        packaging: "loose",
      }),
    ).rejects.toThrow("Delivery location belongs to a different customer");
  });

  it("rejects creating an order for a product with zero source biochar", async () => {
    await expect(
      createOrder(makeTestOrgContext(TEST_USER_ID), {
        code: `OR-OCG-ZERO-${tag}`,
        facilityId,
        customerId: customerAId,
        customerLocationId: locationAId,
        biocharProductId: zeroBiocharProductId,
        orderDate: new Date("2026-06-13"),
        quantityKg: 100,
        packaging: "loose",
      }),
    ).rejects.toThrow("contains 0 kg of source biochar");
  });

  it("rejects changing an order customer while preserving another customer's location", async () => {
    await expect(
      updateOrder(makeTestOrgContext(TEST_USER_ID), orderId, { customerId: customerBId }),
    ).rejects.toThrow("Delivery location belongs to a different customer");
  });

  it("rejects changing an order location to another customer's location", async () => {
    await expect(
      updateOrder(makeTestOrgContext(TEST_USER_ID), orderId, { customerLocationId: locationBId }),
    ).rejects.toThrow("Delivery location belongs to a different customer");
  });

  it("rejects any update while an order references a zero-source product", async () => {
    await expect(
      updateOrder(makeTestOrgContext(TEST_USER_ID), zeroProductOrderId, {
        packaging: "bagged",
      }),
    ).rejects.toThrow("contains 0 kg of source biochar");
  });
});
