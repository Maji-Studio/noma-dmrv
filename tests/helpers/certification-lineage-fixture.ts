import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./feedstock-fixture";
/**
 * A full certification lineage for one feedstock: production run, credit
 * batch, Removal, and (unless `blockingVia` is "none") a blocking submission.
 * Shared by the lineage-guard suites.
 */
import { expect } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  certificationSubmissions,
  certifierGhgStatements,
  certifierRemovals,
  creditBatchApplications,
  creditBatchProductionRuns,
  creditBatches,
  customers,
  deliveries,
  facilities,
  feedstockTypes,
  feedstocks,
  orders,
  outputStockMoistureReadings,
  productionProcesses,
  productionRunFeedstockDraws,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  samples,
  storageLocations,
  transportLegs,
} from "@/db/schema";
import {
  deleteOutputApplicationFixtures,
  deleteOutputDeliveryFixtures,
  deleteOutputFacilityFixtures,
  deleteOutputOrderFixtures,
  deleteOutputProductFixtures,
  insertOutputApplicationFixture,
  insertOutputDeliveryFixture,
  outputOrderFixtureValues,
  outputProductFixtureValues,
} from "./output-contract-fixtures";
import { TEST_ORG_ID } from "./test-org";

const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;

export interface LineageFixture {
  applicationId: string;
  batchId: string;
  customerId: string;
  deliveryId: string;
  facilityId: string;
  feedstockId: string;
  feedstockBinId: string;
  biocharBinId: string;
  feedstockTypeId: string;
  productionProcessId: string;
  ghgStatementId: string | null;
  orderId: string;
  productId: string;
  productionRunId: string;
  reactorId: string;
  removalId: string;
  sampleId: string;
}

export async function createLineageFixture(
  blockingVia: "none" | "removal" | "ghgStatement" = "removal",
): Promise<LineageFixture> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();

  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({ timezone: "UTC", organizationId: TEST_ORG_ID, code: `FAC-CLG-${tag}`, name: `CLG Facility ${tag}` })
      .returning({ id: facilities.id });

    const [reactor] = await tx
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        code: `RX-CLG-${tag}`,
        identifier: `CLG Reactor ${tag}`,
        facilityId: facility.id,
        reactorType: "retort",
      })
      .returning({ id: reactors.id });

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-CLG-${tag}`,
        name: `CLG Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });

    const [feedstockBin] = await tx.insert(storageLocations).values({
      organizationId: TEST_ORG_ID, facilityId: facility.id, code: `BIN-CLG-${tag}`,
      name: "Lineage feedstock source", type: "feedstock_bin", feedstockTypeId: feedstockType.id,
    }).returning();

    const [feedstock] = await tx
      .insert(feedstocks)
      .values(await feedstockFixtureValues(tx, {
        organizationId: TEST_ORG_ID,
        code: `FS-CLG-${tag}`,
        storageLocationId: feedstockBin.id,
        status: "complete",
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        massDryKg: 900,
        massWetKg: 1_000,
        moistureContentPercent: 10,
      }))
      .returning({ id: feedstocks.id });

    const [productionProcess] = await tx
      .insert(productionProcesses)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
      })
      .returning({ id: productionProcesses.id });

    const [biocharBin] = await tx.insert(storageLocations).values({
      organizationId: TEST_ORG_ID, facilityId: facility.id, code: `BIN-CLG-OUT-${tag}`,
      name: `E2E Lineage output ${tag}`, type: "biochar_bin",
    }).returning();
    const [productionRun] = await tx
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        code: `PR-CLG-${tag}`,
        facilityId: facility.id,
        startTime: new Date("2026-06-13T08:00:00Z"),
        endTime: blockingVia === "none" ? null : new Date("2026-06-13T12:00:00Z"),
        reactorId: reactor.id,
        feedstockWetMassKg: 1_000,
        feedstockMoisturePercent: 10,
        feedstockMassDryKg: 900,
        biocharStorageLocationId: biocharBin.id,
        biocharOutputKg: 300,
        biocharMoisturePercent: 5,
        biocharDryMassKg: 285,
        status: blockingVia === "none" ? "running" : "complete",
      })
      .returning({ id: productionRuns.id });

    await tx.insert(productionRunFeedstockDraws).values({
      organizationId: TEST_ORG_ID, productionRunId: productionRun.id,
      storageLocationId: feedstockBin.id, wetMassKg: 1_000,
    });

    await tx.insert(productionRunFeedstocks).values({
      organizationId: TEST_ORG_ID,
      productionRunId: productionRun.id,
      feedstockId: feedstock.id,
      wetMassUsedKg: 1_000,
    });

    const [sample] = await tx
      .insert(samples)
      .values({
        organizationId: TEST_ORG_ID,
        productionRunId: productionRun.id,
        sampleCode: `S-CLG-${tag}`,
        samplingTime: new Date("2026-06-13T10:00:00Z"),
        totalCarbonPercent: 80,
        organicCarbonPercent: 78,
      })
      .returning({ id: samples.id });

    const [product] = await tx
      .insert(biocharProducts)
      .values(await outputProductFixtureValues(tx, {
        organizationId: TEST_ORG_ID,
        code: `BP-CLG-${tag}`,
        facilityId: facility.id,
        linkedProductionRunId: productionRun.id,
        massKg: 300,
        moistureContentPercent: 5,
        waterAddedKg: 0,
      }))
      .returning({ id: biocharProducts.id });

    const [customer] = await tx
      .insert(customers)
      .values({ organizationId: TEST_ORG_ID, code: `CU-CLG-${tag}`, name: `CLG Customer ${tag}` })
      .returning({ id: customers.id });

    const [order] = await tx
      .insert(orders)
      .values(await outputOrderFixtureValues(tx, {
        organizationId: TEST_ORG_ID,
        code: `OR-CLG-${tag}`,
        facilityId: facility.id,
        customerId: customer.id,
        biocharProductId: product.id,
        orderDate: new Date("2026-06-14T00:00:00Z"),
        quantityKg: 300,
        packaging: "loose",
      }))
      .returning({ id: orders.id });

    const [delivery] = await insertOutputDeliveryFixture(tx, {
        organizationId: TEST_ORG_ID,
        code: `DL-CLG-${tag}`,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: product.id,
        status: "delivered",
        deliveryDate: new Date("2026-06-15T00:00:00Z"),
        deliveredWetMassKg: 300,
        massDryKg: 285,
      }, row => ({ id: row.id }));

    const [application] = await insertOutputApplicationFixture(tx, {
        organizationId: TEST_ORG_ID,
        code: `AP-CLG-${tag}`,
        deliveryId: delivery.id,
        applicationDate: new Date("2026-06-16T00:00:00Z"),
        biocharAppliedTons: 0.2,
        biocharAppliedDryTons: 0.19,
        fieldSizeHa: 1,
        gpsLatitude: -3.3349,
        gpsLongitude: 37.3404,
      }, row => ({ id: row.id }));

    let ghgStatementId: string | null = null;
    if (blockingVia === "ghgStatement") {
      const [ghgStatement] = await tx
        .insert(certifierGhgStatements)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          reportingPeriodEndOn: "2026-06-30",
        })
        .returning({ id: certifierGhgStatements.id });
      ghgStatementId = ghgStatement.id;
    }

    const [removal] = await tx
      .insert(certifierRemovals)
      .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, ghgStatementId })
      .returning({ id: certifierRemovals.id });

    const [batch] = await tx
      .insert(creditBatches)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CB-CLG-${tag}`,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        productionProcessId: productionProcess.id,
        status: "pending",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        certifier: "isometric",
      })
      .returning({ id: creditBatches.id });

    await tx.insert(creditBatchProductionRuns).values({
      organizationId: TEST_ORG_ID,
      creditBatchId: batch.id,
      productionRunId: productionRun.id,
    });
    await tx.insert(creditBatchApplications).values({
      organizationId: TEST_ORG_ID,
      creditBatchId: batch.id,
      applicationId: application.id,
      allocatedWetMassKg: 200,
      allocatedDryMassKg: 190,
      removalId: removal.id,
    });

    if (blockingVia !== "none") {
      await tx.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID,
        provider: "isometric",
        submissionType:
          blockingVia === "ghgStatement" ? "ghg_statement" : "removal",
        localEntityType:
          blockingVia === "ghgStatement" ? "ghgStatement" : "removal",
        localEntityId: ghgStatementId ?? removal.id,
        externalId: `ext_clg_${tag}`,
        version: 1,
        status: "submitted",
        payloadHash: `hash-${tag}`,
        payloadSnapshot: { fixture: "certification-lineage-guards" },
        submittedAt: new Date("2026-06-17T00:00:00Z"),
      });
    }

    return {
      applicationId: application.id,
      batchId: batch.id,
      customerId: customer.id,
      deliveryId: delivery.id,
      facilityId: facility.id,
      feedstockId: feedstock.id,
      feedstockBinId: feedstockBin.id,
      biocharBinId: biocharBin.id,
      feedstockTypeId: feedstockType.id,
      productionProcessId: productionProcess.id,
      ghgStatementId,
      orderId: order.id,
      productId: product.id,
      productionRunId: productionRun.id,
      reactorId: reactor.id,
      removalId: removal.id,
      sampleId: sample.id,
    };
  });
}

export async function cleanupLineageFixture(fixture: LineageFixture): Promise<void> {
  const submissionEntityIds = [fixture.removalId];
  if (fixture.ghgStatementId) submissionEntityIds.push(fixture.ghgStatementId);

  await db.transaction(async (tx) => {
    await tx
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, submissionEntityIds));
    await tx
      .delete(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.creditBatchId, fixture.batchId));
    await tx
      .delete(creditBatchApplications)
      .where(eq(creditBatchApplications.creditBatchId, fixture.batchId));
    await tx.delete(creditBatches).where(eq(creditBatches.id, fixture.batchId));
    await deleteOutputApplicationFixtures(tx, eq(applications.id, fixture.applicationId));
    await deleteOutputDeliveryFixtures(tx, eq(deliveries.id, fixture.deliveryId));
    await deleteOutputOrderFixtures(tx, eq(orders.id, fixture.orderId));
    await deleteOutputProductFixtures(tx, eq(biocharProducts.id, fixture.productId));
    await tx.delete(samples).where(eq(samples.id, fixture.sampleId));
    await tx
      .delete(productionRunFeedstocks)
      .where(eq(productionRunFeedstocks.productionRunId, fixture.productionRunId));
    await tx
      .delete(transportLegs)
      .where(
        and(
          eq(transportLegs.organizationId, TEST_ORG_ID),
          eq(transportLegs.entityType, "feedstock"),
          eq(transportLegs.entityId, fixture.feedstockId),
        ),
      );
    await tx.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, fixture.productionRunId));
    await tx
      .delete(feedstocks)
      .where(eq(feedstocks.id, fixture.feedstockId));
    await cleanupFeedstockFixtureParents(tx);
    await tx
      .delete(productionProcesses)
      .where(eq(productionProcesses.id, fixture.productionProcessId));
    await tx.delete(storageLocations).where(eq(storageLocations.id, fixture.feedstockBinId));
    await tx
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.id, fixture.feedstockTypeId));
    await tx
      .delete(certifierRemovals)
      .where(eq(certifierRemovals.id, fixture.removalId));
    if (fixture.ghgStatementId) {
      await tx
        .delete(certifierGhgStatements)
        .where(eq(certifierGhgStatements.id, fixture.ghgStatementId));
    }
    await tx
      .delete(outputStockMoistureReadings)
      .where(eq(outputStockMoistureReadings.productionRunId, fixture.productionRunId));
    await tx
      .delete(productionRuns)
      .where(eq(productionRuns.id, fixture.productionRunId));
    await tx.delete(storageLocations).where(eq(storageLocations.id, fixture.biocharBinId));
    await tx.delete(reactors).where(eq(reactors.id, fixture.reactorId));
    await tx.delete(customers).where(eq(customers.id, fixture.customerId));
    await deleteOutputFacilityFixtures(tx, eq(facilities.id, fixture.facilityId));
  });
  await cleanupFeedstockFixtureParents(db);
}

export async function withLineageFixture<T>(
  testFn: (fixture: LineageFixture) => Promise<T>,
  blockingVia: "none" | "removal" | "ghgStatement" = "removal",
): Promise<T> {
  const fixture = await createLineageFixture(blockingVia);
  try {
    return await testFn(fixture);
  } finally {
    await cleanupLineageFixture(fixture);
  }
}

/** Resolve once `waiters` backends wait on an advisory lock `heldByPid` holds. */
export async function waitForAdvisoryLockWait(heldByPid: number, waiters = 1): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await db.execute<{ waiting: number }>(sql`
          select count(*)::int as waiting
          from pg_locks waiting
          join pg_locks held
            on held.locktype = waiting.locktype
           and held.database is not distinct from waiting.database
           and held.classid is not distinct from waiting.classid
           and held.objid is not distinct from waiting.objid
           and held.objsubid is not distinct from waiting.objsubid
          where waiting.locktype = 'advisory'
            and not waiting.granted
            and held.granted
            and held.pid = ${heldByPid}
        `);
        return result.rows[0]?.waiting ?? 0;
      },
      { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS },
    )
    .toBeGreaterThanOrEqual(waiters);
}
