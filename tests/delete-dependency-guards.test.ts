import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deleteCustomer } from "@/data-access/customers";
import { deleteDelivery } from "@/data-access/deliveries";
import { deleteStorageLocation } from "@/data-access/storage-locations";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customerLocations, customers } from "@/db/schema/parties";
import { biocharProducts } from "@/db/schema/products";
import { SafeError } from "@/lib/errors";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";


beforeAll(() => ensureTestOrg());

describe("delete dependency guards", () => {
  it("blocks deleting an in-use storage bin with actionable copy", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({ organizationId: TEST_ORG_ID, code: `FAC-DDG-SL-${tag}`, name: `DDG Storage Facility ${tag}` })
        .returning({ id: facilities.id });
      const [feedstockType] = await tx
        .insert(feedstockTypes)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FT-DDG-SL-${tag}`,
          name: `DDG Storage Feedstock ${tag}`,
          category: "forestry",
          usage: "pyrolysis",
        })
        .returning({ id: feedstockTypes.id });
      const [storageLocation] = await tx
        .insert(storageLocations)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BIN-DDG-SL-${tag}`,
          name: `DDG Storage Bin ${tag}`,
          type: "feedstock_bin",
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
        })
        .returning({ id: storageLocations.id });
      const [feedstock] = await tx
        .insert(feedstocks)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FS-DDG-SL-${tag}`,
          facilityId: facility.id,
          status: "complete",
          feedstockTypeId: feedstockType.id,
          massDryKg: 80,
          storageLocationId: storageLocation.id,
        })
        .returning({ id: feedstocks.id });

      return {
        facilityId: facility.id,
        feedstockId: feedstock.id,
        feedstockTypeId: feedstockType.id,
        storageLocationId: storageLocation.id,
      };
    });

    try {
      await expect(
        deleteStorageLocation(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId),
      ).rejects.toThrowError(SafeError);
      await expect(
        deleteStorageLocation(makeTestOrgContext(TEST_USER_ID), fixture.storageLocationId),
      ).rejects.toThrow(/feedstock batches/);
    } finally {
      await db.transaction(async (tx) => {
        await tx.delete(feedstocks).where(eq(feedstocks.id, fixture.feedstockId));
        await tx
          .delete(storageLocations)
          .where(eq(storageLocations.id, fixture.storageLocationId));
        await tx
          .delete(feedstockTypes)
          .where(eq(feedstockTypes.id, fixture.feedstockTypeId));
        await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
      });
    }
  });

  it("blocks deleting a customer with orders", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({ organizationId: TEST_ORG_ID, code: `FAC-DDG-CU-${tag}`, name: `DDG Customer Facility ${tag}` })
        .returning({ id: facilities.id });
      const [customer] = await tx
        .insert(customers)
        .values({ organizationId: TEST_ORG_ID, code: `CU-DDG-${tag}`, name: `DDG Customer ${tag}` })
        .returning({ id: customers.id });
      const [product] = await tx
        .insert(biocharProducts)
        .values({ organizationId: TEST_ORG_ID, code: `BP-DDG-CU-${tag}`, facilityId: facility.id })
        .returning({ id: biocharProducts.id });
      const [order] = await tx
        .insert(orders)
        .values({
          organizationId: TEST_ORG_ID,
          code: `OR-DDG-CU-${tag}`,
          facilityId: facility.id,
          customerId: customer.id,
          biocharProductId: product.id,
          orderDate: new Date("2026-06-13"),
          quantityKg: 100,
          packaging: "loose",
        })
        .returning({ id: orders.id });

      return {
        customerId: customer.id,
        facilityId: facility.id,
        orderId: order.id,
        productId: product.id,
      };
    });

    try {
      await expect(deleteCustomer(makeTestOrgContext(TEST_USER_ID), fixture.customerId)).rejects.toThrow(
        /orders/,
      );
    } finally {
      await db.transaction(async (tx) => {
        await tx.delete(orders).where(eq(orders.id, fixture.orderId));
        await tx.delete(biocharProducts).where(eq(biocharProducts.id, fixture.productId));
        await tx.delete(customers).where(eq(customers.id, fixture.customerId));
        await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
      });
    }
  });

  it("blocks deleting a delivery with applications", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const fixture = await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({ organizationId: TEST_ORG_ID, code: `FAC-DDG-DL-${tag}`, name: `DDG Delivery Facility ${tag}` })
        .returning({ id: facilities.id });
      const [customer] = await tx
        .insert(customers)
        .values({ organizationId: TEST_ORG_ID, code: `CU-DDG-DL-${tag}`, name: `DDG Delivery Customer ${tag}` })
        .returning({ id: customers.id });
      const [customerLocation] = await tx
        .insert(customerLocations)
        .values({
          organizationId: TEST_ORG_ID,
          customerId: customer.id,
          name: `DDG Delivery Location ${tag}`,
          country: "Tanzania",
        })
        .returning({ id: customerLocations.id });
      const [product] = await tx
        .insert(biocharProducts)
        .values({ organizationId: TEST_ORG_ID, code: `BP-DDG-DL-${tag}`, facilityId: facility.id })
        .returning({ id: biocharProducts.id });
      const [order] = await tx
        .insert(orders)
        .values({
          organizationId: TEST_ORG_ID,
          code: `OR-DDG-DL-${tag}`,
          facilityId: facility.id,
          customerId: customer.id,
          customerLocationId: customerLocation.id,
          biocharProductId: product.id,
          orderDate: new Date("2026-06-13"),
          quantityKg: 100,
          packaging: "loose",
        })
        .returning({ id: orders.id });
      const [delivery] = await tx
        .insert(deliveries)
        .values({
          organizationId: TEST_ORG_ID,
          code: `DL-DDG-${tag}`,
          facilityId: facility.id,
          orderId: order.id,
          deliveryDate: new Date("2026-06-14"),
          deliveredWetMassKg: 100,
        })
        .returning({ id: deliveries.id });
      const [application] = await tx
        .insert(applications)
        .values({
          organizationId: TEST_ORG_ID,
          code: `AP-DDG-${tag}`,
          deliveryId: delivery.id,
          biocharAppliedTons: 0.1,
          biocharAppliedDryTons: 0.1,
          fieldSizeHa: 1,
        })
        .returning({ id: applications.id });

      return {
        applicationId: application.id,
        customerId: customer.id,
        customerLocationId: customerLocation.id,
        deliveryId: delivery.id,
        facilityId: facility.id,
        orderId: order.id,
        productId: product.id,
      };
    });

    try {
      await expect(deleteDelivery(makeTestOrgContext(TEST_USER_ID), fixture.deliveryId)).rejects.toThrow(
        /applications/,
      );
    } finally {
      await db.transaction(async (tx) => {
        await tx.delete(applications).where(eq(applications.id, fixture.applicationId));
        await tx.delete(deliveries).where(eq(deliveries.id, fixture.deliveryId));
        await tx.delete(orders).where(eq(orders.id, fixture.orderId));
        await tx.delete(biocharProducts).where(eq(biocharProducts.id, fixture.productId));
        await tx
          .delete(customerLocations)
          .where(eq(customerLocations.id, fixture.customerLocationId));
        await tx.delete(customers).where(eq(customers.id, fixture.customerId));
        await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
      });
    }
  });
});
