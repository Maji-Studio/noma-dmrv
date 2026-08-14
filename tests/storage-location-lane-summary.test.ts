/**
 * Integration coverage for the storage-location lane summary (DR-002 /
 * PB-26-001).
 *
 * The type-filter rail total was a separate hand-rolled query that omitted
 * `waterAddedKg` from the intake side while delivered wet mass on the out
 * side includes that water, so a fully delivered watered product produced a
 * phantom negative lane total ("Product (-1,000 kg)") while every bin card
 * showed consistent stock. The rail must equal the sum of the per-bin card
 * figures — one derivation, one arithmetic.
 *
 * Skips when DATABASE_URL is unreachable, matching the other DB-backed specs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { getStorageLocations } from "@/data-access/storage-locations";
import { facilities } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customers } from "@/db/schema/parties";
import { biocharProducts } from "@/db/schema/products";
import { storageLocations } from "@/db/schema";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const BLEND_MASS_KG = 3_000;
const WATER_ADDED_KG = 1_000;
const DELIVERED_WET_KG = 4_000;

interface Fixture {
  facilityId: string;
  customerId: string;
  binId: string;
  productId: string;
  orderId: string;
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
        name: `Lane Facility ${runId}`,
        code: `FAC-LANE-${runId}`,
      })
      .returning({ id: facilities.id });

    const [customer] = await tx
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        name: `Lane Customer ${runId}`,
        code: `CU-LANE-${runId}`,
      })
      .returning({ id: customers.id });

    const [bin] = await tx
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `PB-LANE-${runId}`,
        name: `Lane Product Bin ${runId}`,
        type: "product_bin",
      })
      .returning({ id: storageLocations.id });

    const [product] = await tx
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        code: `BP-LANE-${runId}`,
        facilityId: facility.id,
        storageLocationId: bin.id,
        massKg: BLEND_MASS_KG,
        waterAddedKg: WATER_ADDED_KG,
        moistureContentPercent: 20,
      })
      .returning({ id: biocharProducts.id });

    const [order] = await tx
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        code: `OR-LANE-${runId}`,
        facilityId: facility.id,
        biocharProductId: product.id,
        customerId: customer.id,
        orderDate: new Date("2026-06-01"),
        quantityKg: DELIVERED_WET_KG,
        packaging: "bagged",
      })
      .returning({ id: orders.id });

    const [delivery] = await tx
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        code: `DL-LANE-${runId}`,
        facilityId: facility.id,
        orderId: order.id,
        deliveryDate: new Date("2026-06-10"),
        deliveredWetMassKg: DELIVERED_WET_KG,
        status: "delivered",
      })
      .returning({ id: deliveries.id });

    return {
      facilityId: facility.id,
      customerId: customer.id,
      binId: bin.id,
      productId: product.id,
      orderId: order.id,
      deliveryId: delivery.id,
    };
  });
});

afterAll(async () => {
  if (!fixture) return;
  await db.delete(deliveries).where(inArray(deliveries.id, [fixture.deliveryId]));
  await db.delete(orders).where(inArray(orders.id, [fixture.orderId]));
  await db
    .delete(biocharProducts)
    .where(inArray(biocharProducts.id, [fixture.productId]));
  await db
    .delete(storageLocations)
    .where(inArray(storageLocations.id, [fixture.binId]));
  await db.delete(customers).where(inArray(customers.id, [fixture.customerId]));
  await db.delete(facilities).where(inArray(facilities.id, [fixture.facilityId]));
});

describe("storage location lane summary", () => {
  it("counts added water on the intake side, so full delivery reads zero", async () => {
    if (!dbReachable || !fixture) return;
    const ctx = makeTestOrgContext();
    const result = await getStorageLocations(ctx, {
      facilityId: fixture.facilityId,
    });
    expect(result.laneSummary.product_bin.onHandKg).toBe(0);
  });

  it("keeps the lane total equal to the sum of per-bin card figures", async () => {
    if (!dbReachable || !fixture) return;
    const { binId } = fixture;
    const ctx = makeTestOrgContext();
    const result = await getStorageLocations(ctx, {
      facilityId: fixture.facilityId,
    });
    const bin = result.items.find((item) => item.id === binId);
    expect(bin).toBeDefined();
    expect(result.laneSummary.product_bin.onHandKg).toBe(
      bin?.productInventory.currentMassKg,
    );
  });
});
