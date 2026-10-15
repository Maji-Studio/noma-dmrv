import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { outputOrderFixtureValues, outputProductFixtureValues, insertOutputDeliveryFixture } from "./output-contract-fixtures";

export const ACTIVITY_FIXTURE_DATE = new Date("2026-01-10T10:00:00Z");
const FIXTURE_RUN_START = new Date("2026-01-10T09:00:00Z");
const FIXTURE_WET_KG = 100;
const FIXTURE_DRY_KG = 80;
const FIXTURE_MOISTURE_PERCENT = 20;

export async function createActivityWriteFixture(ctx: OrgContext) {
  const organizationId = ctx.organizationId;
  await db.insert(schema.organizations).values({
    id: organizationId, name: "Activity writes fixture", slug: organizationId,
  });
  return db.transaction(async tx => {
    const [facility] = await tx.insert(schema.facilities).values({
      organizationId, code: "ACT-FAC", name: "Activity writes fixture", timezone: "UTC",
    }).returning();
    const [feedstockType] = await tx.insert(schema.feedstockTypes).values({
      organizationId, code: "ACT-TYPE", name: "Activity feedstock", category: "forestry", usage: "pyrolysis",
    }).returning();
    const [reactor] = await tx.insert(schema.reactors).values({
      organizationId, facilityId: facility.id, code: "ACT-RE", identifier: "Activity reactor", reactorType: "auger",
    }).returning();
    const [outputBin] = await tx.insert(schema.storageLocations).values({
      organizationId, facilityId: facility.id, code: "ACT-OUT", name: "Activity output", type: "biochar_bin",
    }).returning();
    const [inputBin] = await tx.insert(schema.storageLocations).values({
      organizationId, facilityId: facility.id, feedstockTypeId: feedstockType.id,
      code: "ACT-IN", name: "Activity input", type: "feedstock_bin",
    }).returning();
    const [feedstock] = await tx.insert(schema.feedstocks).values({
      organizationId, facilityId: facility.id, feedstockTypeId: feedstockType.id,
      storageLocationId: inputBin.id, code: "ACT-FS", massWetKg: FIXTURE_WET_KG, massDryKg: FIXTURE_DRY_KG,
    }).returning();
    const [run] = await tx.insert(schema.productionRuns).values({
      organizationId, facilityId: facility.id, reactorId: reactor.id, code: "ACT-RUN", status: "complete",
      startTime: FIXTURE_RUN_START, endTime: ACTIVITY_FIXTURE_DATE,
      biocharStorageLocationId: outputBin.id, biocharOutputKg: FIXTURE_WET_KG,
      biocharDryMassKg: FIXTURE_DRY_KG, biocharMoisturePercent: FIXTURE_MOISTURE_PERCENT,
    }).returning();
    await tx.insert(schema.productionRunFeedstocks).values({
      organizationId, productionRunId: run.id, feedstockId: feedstock.id, wetMassUsedKg: FIXTURE_WET_KG,
    });
    const [process] = await tx.insert(schema.productionProcesses).values({
      organizationId, facilityId: facility.id, feedstockTypeId: feedstockType.id,
    }).returning();
    const [batch] = await tx.insert(schema.creditBatches).values({
      organizationId, facilityId: facility.id, feedstockTypeId: feedstockType.id,
      productionProcessId: process.id, code: "ACT-CB", startDate: "2026-01-01", endDate: "2026-01-31",
    }).returning();
    await tx.insert(schema.creditBatchProductionRuns).values({
      organizationId, creditBatchId: batch.id, productionRunId: run.id,
    });
    const [product] = await tx.insert(schema.biocharProducts).values(await outputProductFixtureValues(tx, {
      organizationId, facilityId: facility.id, code: "ACT-BP", linkedProductionRunId: run.id,
      productionDate: ACTIVITY_FIXTURE_DATE, sourceBiocharStorageLocationId: outputBin.id,
    })).returning();
    await tx.insert(schema.biocharProductSourceAllocations).values({
      organizationId, biocharProductId: product.id, productionRunId: run.id,
      sourceStorageLocationId: outputBin.id, allocatedWetMassKg: FIXTURE_WET_KG, allocatedDryMassKg: FIXTURE_DRY_KG,
    });
    const [customer] = await tx.insert(schema.customers).values({
      organizationId, code: "ACT-CU", name: "Activity customer",
    }).returning();
    const [order] = await tx.insert(schema.orders).values(await outputOrderFixtureValues(tx, {
      organizationId, facilityId: facility.id, code: "ACT-OR", customerId: customer.id,
      biocharProductId: product.id, orderDate: ACTIVITY_FIXTURE_DATE, quantityKg: FIXTURE_WET_KG, packaging: "loose",
    })).returning();
    const [delivery] = await insertOutputDeliveryFixture(tx, {
      organizationId, facilityId: facility.id, code: "ACT-DL", orderId: order.id,
      deliveryDate: ACTIVITY_FIXTURE_DATE, deliveredWetMassKg: FIXTURE_WET_KG, massDryKg: FIXTURE_DRY_KG,
    }, row => row);
    return { facility, feedstockType, feedstock, run, batch, product, delivery };
  });
}

export async function cleanupActivityWriteFixture(organizationId: string) {
  // Activity must be removed before facilities; all tables are private to this fixture.
  const tables = [
    schema.activityEvents, schema.documents, schema.storageObjectDeletions, schema.transportLegs,
    schema.creditBatchApplications, schema.soilTemperatureMeasurements, schema.applicationOutputAllocations, schema.applications,
    schema.outputStockRunAllocations, schema.outputStockAllocations, schema.outputStockMoistureReadings,
    schema.deliveries, schema.orders, schema.productIngredientSnapshots, schema.biocharProductSourceAllocations,
    schema.biocharProducts, schema.binMovements, schema.samples, schema.creditBatchProductionRuns,
    schema.creditBatches, schema.productionProcesses, schema.productionRunFeedstockDraws, schema.productionRunFeedstocks,
    schema.productionRuns, schema.feedstocks, schema.storageLocations, schema.reactors, schema.formulations,
    schema.customerLocations, schema.customers, schema.feedstockTypes, schema.facilities,
  ];
  await db.transaction(async tx => {
    for (const table of tables) await tx.delete(table).where(eq(table.organizationId, organizationId));
    await tx.delete(schema.organizations).where(eq(schema.organizations.id, organizationId));
  });
}
