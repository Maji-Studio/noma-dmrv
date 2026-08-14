/**
 * Integration coverage for the biochar-product entity option's
 * `excludeOrderId` (DR-002 / OR-26-001).
 *
 * The order form's product picker shows "remaining" stock derived from
 * `buildDeliveredMassAggregate`. Without exclusion, an order being edited
 * counts its own delivered delivery as competing consumption and the caption
 * reads "0 kg remaining" beside the same form's "4,000 kg reserved". With
 * `excludeOrderId`, remaining means "available to other demand".
 *
 * Runs against a real database because the aggregate is a grouped SQL
 * subquery; skips when DATABASE_URL is unreachable, matching the other
 * DB-backed specs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  getBiocharProductEntityById,
  getBiocharProducts,
} from "@/data-access/entities/biochar-products";
import { facilities } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customers } from "@/db/schema/parties";
import { biocharProducts } from "@/db/schema/products";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const PRODUCT_MASS_KG = 4_000;
const DELIVERED_WET_KG = 4_000;
const DELIVERED_DRY_KG = 3_000;

interface Fixture {
  facilityId: string;
  customerId: string;
  productId: string;
  fulfilledOrderId: string;
  otherOrderId: string;
  deliveryId: string;
}

let dbReachable = true;
let fixture: Fixture | null = null;

beforeAll(async () => {
  const runId = crypto.randomUUID().slice(0, 8);
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbReachable = false;
    return;
  }
  await ensureTestOrg();
  fixture = await db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        name: `Excl Facility ${runId}`,
        code: `FAC-EXCL-${runId}`,
      })
      .returning({ id: facilities.id });

    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        name: `Excl Customer ${runId}`,
        code: `CU-EXCL-${runId}`,
      })
      .returning({ id: customers.id });

    const [product] = await tx
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BP-EXCL-${runId}`,
        facilityId: facility.id,
        massKg: PRODUCT_MASS_KG,
        moistureContentPercent: 20,
      })
      .returning({ id: biocharProducts.id });

    const [fulfilledOrder] = await tx
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        code: `OR-EXCL-A-${runId}`,
        facilityId: facility.id,
        biocharProductId: product.id,
        customerId: customer.id,
        orderDate: new Date("2026-06-01"),
        quantityKg: DELIVERED_WET_KG,
        packaging: "bagged",
      })
      .returning({ id: orders.id });

    const [otherOrder] = await tx
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        code: `OR-EXCL-B-${runId}`,
        facilityId: facility.id,
        biocharProductId: product.id,
        customerId: customer.id,
        orderDate: new Date("2026-06-02"),
        quantityKg: 500,
        packaging: "bagged",
      })
      .returning({ id: orders.id });

    const [delivery] = await tx
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        code: `DL-EXCL-${runId}`,
        facilityId: facility.id,
        orderId: fulfilledOrder.id,
        deliveryDate: new Date("2026-06-10"),
        deliveredWetMassKg: DELIVERED_WET_KG,
        massDryKg: DELIVERED_DRY_KG,
        status: "delivered",
      })
      .returning({ id: deliveries.id });

    return {
      facilityId: facility.id,
      customerId: customer.id,
      productId: product.id,
      fulfilledOrderId: fulfilledOrder.id,
      otherOrderId: otherOrder.id,
      deliveryId: delivery.id,
    };
  });
});

afterAll(async () => {
  if (!fixture) return;
  await db.delete(deliveries).where(inArray(deliveries.id, [fixture.deliveryId]));
  await db
    .delete(orders)
    .where(inArray(orders.id, [fixture.fulfilledOrderId, fixture.otherOrderId]));
  await db
    .delete(biocharProducts)
    .where(inArray(biocharProducts.id, [fixture.productId]));
  await db.delete(customers).where(inArray(customers.id, [fixture.customerId]));
  await db.delete(facilities).where(inArray(facilities.id, [fixture.facilityId]));
});

describe("biochar product entity option excludeOrderId", () => {
  it("counts the order's own delivery as consumed without exclusion", async () => {
    if (!dbReachable || !fixture) return;
    const ctx = makeTestOrgContext();
    const option = await getBiocharProductEntityById(ctx, fixture.productId);
    expect(option?.remainingMass?.wetKg).toBe(
      PRODUCT_MASS_KG - DELIVERED_WET_KG,
    );
  });

  it("adds the excluded order's fulfilment back into remaining stock", async () => {
    if (!dbReachable || !fixture) return;
    const ctx = makeTestOrgContext();
    const option = await getBiocharProductEntityById(ctx, fixture.productId, {
      excludeOrderId: fixture.fulfilledOrderId,
    });
    expect(option?.remainingMass?.wetKg).toBe(PRODUCT_MASS_KG);
  });

  it("excluding an unrelated order changes nothing", async () => {
    if (!dbReachable || !fixture) return;
    const ctx = makeTestOrgContext();
    const option = await getBiocharProductEntityById(ctx, fixture.productId, {
      excludeOrderId: fixture.otherOrderId,
    });
    expect(option?.remainingMass?.wetKg).toBe(
      PRODUCT_MASS_KG - DELIVERED_WET_KG,
    );
  });

  it("applies the same exclusion on the list/search path", async () => {
    if (!dbReachable || !fixture) return;
    const { facilityId, fulfilledOrderId, productId } = fixture;
    const ctx = makeTestOrgContext();
    const options = await getBiocharProducts(ctx, {
      facilityId,
      excludeOrderId: fulfilledOrderId,
      limit: 50,
    });
    const option = options.find((o) => o.id === productId);
    expect(option?.remainingMass?.wetKg).toBe(PRODUCT_MASS_KG);
  });
});
