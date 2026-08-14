import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deriveLaneStock } from "@/data-access/lane-stock-derivation";
import { getStorageLocationWithFacility } from "@/data-access/storage-locations";
import { binMovements } from "@/db/schema/bin-movements";
import { facilities, reactors, storageLocations } from "@/db/schema/facilities";
import { feedstocks, feedstockTypes } from "@/db/schema/feedstock";
import {
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  productionRuns,
} from "@/db/schema/production";
import { biocharProducts, formulations } from "@/db/schema/products";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000421";
const FEEDSTOCK_INTAKE_KG = 120;
const FEEDSTOCK_CONSUMED_KG = 50;
const FEEDSTOCK_MOVEMENT_KG = -127;
const BIOCHAR_PRODUCED_KG = 120;
const BIOCHAR_ALLOCATED_KG = 35;
const BIOCHAR_MOVEMENT_KG = -3;
const PRODUCT_MOVEMENT_KG = 7;

describe("shared lane-stock derivation", () => {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  const ctx = makeTestOrgContext(TEST_USER_ID);
  const productionRunIds: string[] = [];
  const biocharProductIds: string[] = [];
  const storageLocationIds: string[] = [];
  let facilityId: string;
  let reactorId: string;
  let feedstockTypeId: string;
  const feedstockIds: string[] = [];
  let formulationId: string;

  beforeAll(async () => {
    await ensureTestOrg();

    await db.transaction(async (tx) => {
      const [facility] = await tx
        .insert(facilities)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FAC-LANE-${tag}`,
          name: `Lane Stock Facility ${tag}`,
        })
        .returning({ id: facilities.id });
      facilityId = facility.id;

      const [reactor] = await tx
        .insert(reactors)
        .values({
          organizationId: TEST_ORG_ID,
          code: `R-LANE-${tag}`,
          identifier: `Lane Stock Reactor ${tag}`,
          facilityId,
          reactorType: "auger",
        })
        .returning({ id: reactors.id });
      reactorId = reactor.id;

      const [feedstockType] = await tx
        .insert(feedstockTypes)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FT-LANE-${tag}`,
          name: `Lane Stock Feedstock ${tag}`,
          category: "forestry",
        })
        .returning({ id: feedstockTypes.id });
      feedstockTypeId = feedstockType.id;

      const locations = await tx
        .insert(storageLocations)
        .values([
          {
            organizationId: TEST_ORG_ID,
            code: `BIN-LANE-FS-${tag}`,
            name: `Lane Feedstock Bin ${tag}`,
            type: "feedstock_bin" as const,
            facilityId,
            feedstockTypeId,
          },
          {
            organizationId: TEST_ORG_ID,
            code: `BIN-LANE-BC-${tag}`,
            name: `Lane Biochar Bin ${tag}`,
            type: "biochar_bin" as const,
            facilityId,
          },
          {
            organizationId: TEST_ORG_ID,
            code: `BIN-LANE-P-${tag}`,
            name: `Lane Product Bin ${tag}`,
            type: "product_bin" as const,
            facilityId,
          },
        ])
        .returning({ id: storageLocations.id });
      storageLocationIds.push(...locations.map((location) => location.id));
      const [feedstockStorageLocationId, biocharStorageLocationId] =
        storageLocationIds;

      const insertedFeedstocks = await tx
        .insert(feedstocks)
        .values([
          {
            organizationId: TEST_ORG_ID,
            code: `FS-LANE-COMPLETE-${tag}`,
            facilityId,
            status: "complete" as const,
            feedstockTypeId,
            massDryKg: FEEDSTOCK_INTAKE_KG,
            massWetKg: 150,
            storageLocationId: feedstockStorageLocationId,
          },
          {
            organizationId: TEST_ORG_ID,
            code: `FS-LANE-PENDING-${tag}`,
            facilityId,
            status: "missing_data" as const,
            feedstockTypeId,
            massDryKg: 900,
            massWetKg: 1000,
            storageLocationId: feedstockStorageLocationId,
          },
        ])
        .returning({ id: feedstocks.id });
      feedstockIds.push(...insertedFeedstocks.map((feedstock) => feedstock.id));

      const runs = await tx
        .insert(productionRuns)
        .values([
          {
            organizationId: TEST_ORG_ID,
            code: `PR-LANE-A-${tag}`,
            facilityId,
            reactorId,
            feedstockStorageLocationId,
            biocharStorageLocationId,
            biocharOutputKg: 80,
            startTime: new Date("2026-07-01T08:00:00Z"),
            endTime: new Date("2026-07-01T09:00:00Z"),
          },
          {
            organizationId: TEST_ORG_ID,
            code: `PR-LANE-B-${tag}`,
            facilityId,
            reactorId,
            feedstockStorageLocationId,
            biocharStorageLocationId,
            biocharOutputKg: 40,
            startTime: new Date("2026-07-01T10:00:00Z"),
            endTime: new Date("2026-07-01T11:00:00Z"),
          },
        ])
        .returning({ id: productionRuns.id });
      productionRunIds.push(...runs.map((run) => run.id));

      await tx.insert(productionRunFeedstockDraws).values([
        {
          organizationId: TEST_ORG_ID,
          productionRunId: productionRunIds[0],
          storageLocationId: feedstockStorageLocationId,
          wetMassKg: 30,
        },
        {
          organizationId: TEST_ORG_ID,
          productionRunId: productionRunIds[1],
          storageLocationId: feedstockStorageLocationId,
          wetMassKg: 20,
        },
      ]);

      await tx.insert(productionRunFeedstocks).values([
        {
          organizationId: TEST_ORG_ID,
          productionRunId: productionRunIds[0],
          feedstockId: feedstockIds[0],
          wetMassUsedKg: 30,
        },
        {
          organizationId: TEST_ORG_ID,
          productionRunId: productionRunIds[1],
          feedstockId: feedstockIds[0],
          wetMassUsedKg: 20,
        },
      ]);

      const [formulation] = await tx
        .insert(formulations)
        .values({
          organizationId: TEST_ORG_ID,
          code: `FORM-LANE-${tag}`,
          name: `Lane Stock Blend ${tag}`,
          biocharRatio: 0.5,
        })
        .returning({ id: formulations.id });
      formulationId = formulation.id;

      const products = await tx
        .insert(biocharProducts)
        .values([
          {
            organizationId: TEST_ORG_ID,
            code: `BP-LANE-A-${tag}`,
            facilityId,
            linkedProductionRunId: productionRunIds[0],
            formulationId,
            massKg: 20,
            storageLocationId: storageLocationIds[2],
          },
          {
            organizationId: TEST_ORG_ID,
            code: `BP-LANE-B-${tag}`,
            facilityId,
            linkedProductionRunId: productionRunIds[1],
            massKg: 15,
            storageLocationId: storageLocationIds[2],
          },
        ])
        .returning({ id: biocharProducts.id });
      biocharProductIds.push(...products.map((product) => product.id));

      await tx.insert(binMovements).values([
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: feedstockStorageLocationId,
          lane: "feedstock",
          movementType: "loss",
          massDeltaKg: -130,
          reason: "Derivation regression fixture",
        },
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: feedstockStorageLocationId,
          lane: "feedstock",
          movementType: "adjustment",
          massDeltaKg: 3,
          reason: "Derivation regression fixture",
        },
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: biocharStorageLocationId,
          lane: "biochar",
          movementType: "loss",
          massDeltaKg: BIOCHAR_MOVEMENT_KG,
          reason: "Derivation regression fixture",
        },
        {
          organizationId: TEST_ORG_ID,
          storageLocationId: storageLocationIds[2],
          lane: "product",
          movementType: "adjustment",
          massDeltaKg: PRODUCT_MOVEMENT_KG,
          reason: "Derivation regression fixture",
        },
      ]);
    });
  });

  afterAll(async () => {
    await db.transaction(async (tx) => {
      await tx
        .delete(binMovements)
        .where(inArray(binMovements.storageLocationId, storageLocationIds));
      await tx
        .delete(biocharProducts)
        .where(inArray(biocharProducts.id, biocharProductIds));
      await tx.delete(formulations).where(eq(formulations.id, formulationId));
      await tx
        .delete(productionRunFeedstocks)
        .where(inArray(productionRunFeedstocks.productionRunId, productionRunIds));
      await tx
        .delete(productionRunFeedstockDraws)
        .where(inArray(productionRunFeedstockDraws.productionRunId, productionRunIds));
      await tx
        .delete(productionRuns)
        .where(inArray(productionRuns.id, productionRunIds));
      await tx.delete(feedstocks).where(inArray(feedstocks.id, feedstockIds));
      await tx
        .delete(storageLocations)
        .where(inArray(storageLocations.id, storageLocationIds));
      await tx.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
      await tx.delete(reactors).where(eq(reactors.id, reactorId));
      await tx.delete(facilities).where(eq(facilities.id, facilityId));
    });
  });

  it("derives unclamped lane stock from lineage and signed movements", async () => {
    const rows = await deriveLaneStock(ctx, db, { storageLocationIds });
    const byLocation = new Map(rows.map((row) => [row.storageLocationId, row]));
    const feedstock = byLocation.get(storageLocationIds[0]);
    const biochar = byLocation.get(storageLocationIds[1]);
    const product = byLocation.get(storageLocationIds[2]);

    expect(feedstock).toMatchObject({
      feedstockIntakeDryKg: FEEDSTOCK_INTAKE_KG,
      feedstockConsumedWetKg: FEEDSTOCK_CONSUMED_KG,
      feedstockMovementDeltaKg: FEEDSTOCK_MOVEMENT_KG,
      feedstockStockWetKg: -27,
      feedstockEstimatedDryKg: -21.6,
    });
    expect(biochar).toMatchObject({
      biocharProducedKg: BIOCHAR_PRODUCED_KG,
      biocharAllocatedKg: BIOCHAR_ALLOCATED_KG,
      biocharMovementDeltaKg: BIOCHAR_MOVEMENT_KG,
      biocharStockKg: 82,
    });
    expect(product?.productMovementDeltaKg).toBe(PRODUCT_MOVEMENT_KG);
  });

  it("excludes the run or product being edited", async () => {
    const [withoutRun] = await deriveLaneStock(ctx, db, {
      storageLocationIds: [storageLocationIds[0]],
      excludeRunId: productionRunIds[0],
    });
    const [withoutProduct] = await deriveLaneStock(ctx, db, {
      storageLocationIds: [storageLocationIds[1]],
      excludeProductId: biocharProductIds[0],
    });

    expect(withoutRun.feedstockConsumedWetKg).toBe(20);
    expect(withoutRun.feedstockStockWetKg).toBe(3);
    expect(withoutProduct.biocharAllocatedKg).toBe(15);
    expect(withoutProduct.biocharStockKg).toBe(102);
  });

  it("keeps enrichment stock in parity with the shared derivation", async () => {
    const [feedstock, biochar, product] = await Promise.all(
      storageLocationIds.map((id) => getStorageLocationWithFacility(ctx, id)),
    );

    expect(feedstock.feedstockInventory.currentWetMassKg).toBe(-27);
    expect(feedstock.feedstockInventory.estimatedDryMassKg).toBeCloseTo(-21.6);
    expect(feedstock.feedstockInventory.batchCount).toBe(1);
    expect(feedstock.feedstockInventory.pendingWetMassKg).toBe(1000);
    expect(feedstock.feedstockInventory.estimatedMoisturePercent).toBeNull();
    expect(biochar.biocharInventory.currentMassKg).toBe(82);
    expect(biochar.biocharInventory.allocatedToProductsKg).toBe(35);
    expect(product.productInventory.currentMassKg).toBe(42);
    expect(product.productInventory.biocharEquivalentKg).toBe(35);
  });

  it("reads movement overlays through the supplied transaction", async () => {
    await db.transaction(async (tx) => {
      const [movement] = await tx
        .insert(binMovements)
        .values({
          organizationId: TEST_ORG_ID,
          storageLocationId: storageLocationIds[0],
          lane: "feedstock",
          movementType: "adjustment",
          massDeltaKg: 11,
          reason: "Transaction executor regression",
        })
        .returning({ id: binMovements.id });

      const [stock] = await deriveLaneStock(ctx, tx, {
        storageLocationIds: [storageLocationIds[0]],
      });
      expect(stock.feedstockStockWetKg).toBe(-16);

      await tx.delete(binMovements).where(eq(binMovements.id, movement.id));
    });
  });

  it("keeps feedstock reconciliation, losses, and ingredient draws on wet kg", async () => {
    const stockTakeAt = new Date(Date.now() + 60_000);
    const ingredientSnapshotAt = new Date(stockTakeAt.getTime() + 60_000);
    const basislessLossAt = new Date(ingredientSnapshotAt.getTime() + 60_000);

    await db.transaction(async (tx) => {
      const [stockTake] = await tx
        .insert(binMovements)
        .values({
          organizationId: TEST_ORG_ID,
          storageLocationId: storageLocationIds[0],
          lane: "feedstock",
          movementType: "adjustment",
          massDeltaKg: 100,
          countedMassKg: 64,
          countedWetMassKg: 80,
          moistureRatioUsed: 0.2,
          reason: "Authoritative wet-basis reset",
          createdAt: stockTakeAt,
        })
        .returning({ id: binMovements.id });
      const [ingredientProduct] = await tx
        .insert(biocharProducts)
        .values({
          organizationId: TEST_ORG_ID,
          code: `BP-LANE-REPLAY-${tag}`,
          facilityId,
          formulationId,
          massKg: 10,
          storageLocationId: storageLocationIds[2],
          composition: {
            ingredients: [
              {
                storageLocationId: storageLocationIds[0],
                massKg: 10,
                massDryKg: 8,
              },
            ],
          },
          createdAt: ingredientSnapshotAt,
        })
        .returning({ id: biocharProducts.id });

      const [afterIngredientDraw] = await deriveLaneStock(ctx, tx, {
        storageLocationIds: [storageLocationIds[0]],
      });
      expect(afterIngredientDraw.feedstockStockWetKg).toBe(63);

      const [loss] = await tx
        .insert(binMovements)
        .values({
          organizationId: TEST_ORG_ID,
          storageLocationId: storageLocationIds[0],
          lane: "feedstock",
          movementType: "loss",
          massDeltaKg: -1,
          reason: "Wet feedstock loss",
          createdAt: basislessLossAt,
        })
        .returning({ id: binMovements.id });

      const [afterWetLoss] = await deriveLaneStock(ctx, tx, {
        storageLocationIds: [storageLocationIds[0]],
      });
      expect(afterWetLoss.feedstockStockWetKg).toBe(62);

      await tx.delete(binMovements).where(inArray(binMovements.id, [stockTake.id, loss.id]));
      await tx.delete(biocharProducts).where(eq(biocharProducts.id, ingredientProduct.id));
    });
  });
});
