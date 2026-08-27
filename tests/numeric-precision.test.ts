import { ensureTestOrg, TEST_ORG_ID } from "./helpers/test-org";
/**
 * Issue #280 — credit-bearing values are exact numeric(p,s), not float4.
 *
 * Each case round-trips a value that float4 cannot represent (or that binary
 * floating point corrupts) and asserts the DB returns exactly what was
 * written, still typed `number` (drizzle `mode: 'number'`). These tests fail
 * against the pre-#280 `real` columns.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq, TransactionRollbackError } from "drizzle-orm";
import { db } from "@/db";
import { applications } from "@/db/schema/application";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { deliveries, orders } from "@/db/schema/logistics";
import { customers } from "@/db/schema/parties";
import { samples } from "@/db/schema/production";
import { biocharProducts } from "@/db/schema/products";
import { biocharStorageInventory } from "@/db/schema/storage-inventory";

// 8 significant digits — float4 (~7 digits) rounds this to 33333.332.
const MASS_KG_8_SIG_DIGITS = 33333.333;
// 9 significant digits at scale 4 — float4 (~7 digits) rounds this to
// 12345.679; numeric(10,4) must return it exactly.
const PPM_9_SIG_DIGITS = 12345.6789;
// 9 significant digits — exact at numeric(14,6), unrepresentable in float4.
const TONNES_9_SIG_DIGITS = 123.456789;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Run assertions inside a transaction, then discard every fixture row. */
async function withRollback(run: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await run(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}


beforeAll(() => ensureTestOrg());

describe("numeric precision round-trips (issue #280)", () => {
  it("stores biochar_storage_inventory.quantity_kg_stored exactly at gram resolution", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();

    await withRollback(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({ organizationId: TEST_ORG_ID, code: `FAC-NUM-${runId}`, name: `Numeric Facility ${runId}` })
        .returning({ id: facilities.id });

      const [bin] = await tx
        .insert(storageLocations)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BIN-NUM-${runId}`,
          name: `Numeric Bin ${runId}`,
          type: "product_bin",
          facilityId: facility.id,
        })
        .returning({ id: storageLocations.id });

      const [product] = await tx
        .insert(biocharProducts)
        .values({ organizationId: TEST_ORG_ID, code: `BP-NUM-${runId}`, facilityId: facility.id })
        .returning({ id: biocharProducts.id });

      const [inserted] = await tx
        .insert(biocharStorageInventory)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BSI-NUM-${runId}`,
          biocharProductId: product.id,
          storageLocationId: bin.id,
          quantityKgStored: MASS_KG_8_SIG_DIGITS,
          quantityKgRemaining: MASS_KG_8_SIG_DIGITS,
          storedAt: new Date(),
        })
        .returning({ id: biocharStorageInventory.id });

      const [row] = await tx
        .select({ quantityKgStored: biocharStorageInventory.quantityKgStored })
        .from(biocharStorageInventory)
        .where(eq(biocharStorageInventory.id, inserted.id));

      expect(typeof row.quantityKgStored).toBe("number");
      expect(row.quantityKgStored).toBe(MASS_KG_8_SIG_DIGITS);
    });
  });

  it("stores samples.arsenic_mg_kg exactly at scale 4", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();

    await withRollback(async (tx) => {
      const [inserted] = await tx
        .insert(samples)
        .values({
          organizationId: TEST_ORG_ID,
          sampleCode: `SMP-NUM-${runId}`,
          samplingTime: new Date(),
          totalCarbonPercent: 80,
          organicCarbonPercent: 75,
          arsenicMgKg: PPM_9_SIG_DIGITS,
        })
        .returning({ id: samples.id });

      const [row] = await tx
        .select({ arsenicMgKg: samples.arsenicMgKg })
        .from(samples)
        .where(eq(samples.id, inserted.id));

      expect(typeof row.arsenicMgKg).toBe("number");
      expect(row.arsenicMgKg).toBe(PPM_9_SIG_DIGITS);
    });
  });

  it("stores applications.co2e_stored_tonnes exactly at scale 6", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();

    await withRollback(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FAC-NUM-AP-${runId}`,
          name: `Numeric App Facility ${runId}`,
        })
        .returning({ id: facilities.id });

      const [customer] = await tx
        .insert(customers)
        .values({ organizationId: TEST_ORG_ID, code: `CU-NUM-${runId}`, name: `Numeric Customer ${runId}` })
        .returning({ id: customers.id });

      const [product] = await tx
        .insert(biocharProducts)
        .values({ organizationId: TEST_ORG_ID, code: `BP-NUM-AP-${runId}`, facilityId: facility.id })
        .returning({ id: biocharProducts.id });

      const [order] = await tx
        .insert(orders)
        .values({
          organizationId: TEST_ORG_ID,
          code: `OR-NUM-${runId}`,
          facilityId: facility.id,
          orderDate: new Date(),
          customerId: customer.id,
          biocharProductId: product.id,
          quantityKg: 1000,
          packaging: "loose",
        })
        .returning({ id: orders.id });

      const [delivery] = await tx
        .insert(deliveries)
        .values({
          organizationId: TEST_ORG_ID,
          code: `DL-NUM-${runId}`,
          facilityId: facility.id,
          deliveryDate: new Date(),
          orderId: order.id,
        })
        .returning({ id: deliveries.id });

      const [inserted] = await tx
        .insert(applications)
        .values({
          organizationId: TEST_ORG_ID,
          code: `AP-NUM-${runId}`,
          deliveryId: delivery.id,
          biocharAppliedTons: 1,
          biocharAppliedDryTons: 0.9,
          co2eStoredTonnes: TONNES_9_SIG_DIGITS,
        })
        .returning({ id: applications.id });

      const [row] = await tx
        .select({ co2eStoredTonnes: applications.co2eStoredTonnes })
        .from(applications)
        .where(eq(applications.id, inserted.id));

      expect(typeof row.co2eStoredTonnes).toBe("number");
      expect(row.co2eStoredTonnes).toBe(TONNES_9_SIG_DIGITS);
    });
  });
});
