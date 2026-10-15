import { insertOutputApplicationFixture } from "./helpers/output-contract-fixtures";
import { outputProductFixtureValues, outputOrderFixtureValues, insertOutputDeliveryFixture } from "./helpers/output-contract-fixtures";
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
import { creditBatches } from "@/db/schema/credits";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { applications } from "@/db/schema/application";
import { facilities, storageLocations } from "@/db/schema/facilities";
import { orders } from "@/db/schema/logistics";
import { customers } from "@/db/schema/parties";
import { biocharProducts } from "@/db/schema/products";
import { biocharStorageInventory } from "@/db/schema/storage-inventory";

// 8 significant digits — float4 (~7 digits) rounds this to 33333.332.
const MASS_KG_8_SIG_DIGITS = 33333.333;
// 9 significant digits — exact at numeric(14,6), unrepresentable in float4.
const TONNES_9_SIG_DIGITS = 123.456789;
// 9 significant digits at scale 4, unrepresentable in float4.
const PPM_9_SIG_DIGITS = 12345.6789;

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
        .values({ timezone: "UTC", organizationId: TEST_ORG_ID, code: `FAC-NUM-${runId}`, name: `Numeric Facility ${runId}` })
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
        .values(await outputProductFixtureValues(tx, { organizationId: TEST_ORG_ID, code: `BP-NUM-${runId}`, facilityId: facility.id }))
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

  it("stores credit_batches.ch4_ppm exactly at scale 4", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();

    await withRollback(async (tx) => {
      const [facility] = await tx.insert(facilities).values({
        timezone: "UTC", organizationId: TEST_ORG_ID,
        code: `FAC-NUM-PPM-${runId}`, name: `Numeric PPM Facility ${runId}`,
      }).returning({ id: facilities.id });
      const [feedstockType] = await tx.insert(feedstockTypes).values({
        organizationId: TEST_ORG_ID, code: `FT-NUM-PPM-${runId}`,
        name: `Numeric PPM Feedstock ${runId}`, category: "forestry", usage: "pyrolysis",
      }).returning({ id: feedstockTypes.id });
      const [process] = await tx.insert(productionProcesses).values({
        organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id,
      }).returning({ id: productionProcesses.id });
      const [inserted] = await tx.insert(creditBatches).values({
        organizationId: TEST_ORG_ID, code: `CB-NUM-PPM-${runId}`, facilityId: facility.id,
        feedstockTypeId: feedstockType.id, productionProcessId: process.id,
        startDate: "2026-06-01", endDate: "2026-06-30", ch4Ppm: PPM_9_SIG_DIGITS,
      }).returning({ id: creditBatches.id });
      const [row] = await tx.select({ ch4Ppm: creditBatches.ch4Ppm })
        .from(creditBatches).where(eq(creditBatches.id, inserted.id));

      expect(typeof row.ch4Ppm).toBe("number");
      expect(row.ch4Ppm).toBe(PPM_9_SIG_DIGITS);
    });
  });

  it("stores applications.co2e_stored_tonnes exactly at scale 6", async () => {
    const runId = crypto.randomUUID().slice(0, 8).toUpperCase();

    await withRollback(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({ timezone: "UTC",
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
        .values(await outputProductFixtureValues(tx, { organizationId: TEST_ORG_ID, code: `BP-NUM-AP-${runId}`, facilityId: facility.id }))
        .returning({ id: biocharProducts.id });

      const [order] = await tx
        .insert(orders)
        .values(await outputOrderFixtureValues(tx, {
          organizationId: TEST_ORG_ID,
          code: `OR-NUM-${runId}`,
          facilityId: facility.id,
          orderDate: new Date(),
          customerId: customer.id,
          biocharProductId: product.id,
          quantityKg: 1000,
          packaging: "loose",
        }))
        .returning({ id: orders.id });

      const [delivery] = await insertOutputDeliveryFixture(tx, {

        deliveredWetMassKg: 1000,
          organizationId: TEST_ORG_ID,
          code: `DL-NUM-${runId}`,
          facilityId: facility.id,
          deliveryDate: new Date(),
          orderId: order.id,
        }, row => ({ id: row.id }));

      const [inserted] = await insertOutputApplicationFixture(tx, {
        fieldSizeHa: 1, applicationDate: new Date("2026-06-15T00:00:00Z"),
          organizationId: TEST_ORG_ID,
          code: `AP-NUM-${runId}`,
          deliveryId: delivery.id,
          biocharAppliedTons: 1,
          biocharAppliedDryTons: 0.9,
          co2eStoredTonnes: TONNES_9_SIG_DIGITS,
        }, row => ({ id: row.id }));

      const [row] = await tx
        .select({ co2eStoredTonnes: applications.co2eStoredTonnes })
        .from(applications)
        .where(eq(applications.id, inserted.id));

      expect(typeof row.co2eStoredTonnes).toBe("number");
      expect(row.co2eStoredTonnes).toBe(TONNES_9_SIG_DIGITS);
    });
  });
});
