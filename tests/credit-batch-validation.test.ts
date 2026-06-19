/**
 * Credit Batch Production-Run Validation Tests
 *
 * Integration tests for server-side validation in credit batch data-access layer.
 * Tests: missing IDs, cross-facility IDs, duplicate IDs, and facility-change-with-stale-membership.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test defaults).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities, reactors } from "@/db/schema/facilities";
import {
  creditBatches,
  creditBatchApplications,
  creditBatchProductionRuns,
} from "@/db/schema/credits";
import { applications } from "@/db/schema/application";
import { deliveries, orders } from "@/db/schema/logistics";
import { biocharProducts, formulations } from "@/db/schema/products";
import { customers } from "@/db/schema/parties";
import { feedstockTypes, feedstocks } from "@/db/schema/feedstock";
import { productionRuns, productionRunFeedstocks } from "@/db/schema/production";
import { productionProcesses } from "@/db/schema/production-processes";
import {
  createCreditBatch,
  updateCreditBatch,
} from "@/data-access/credit-batches";

// Fake userId for requireAuth (just needs to be truthy)
const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

// Track created IDs for cleanup
const createdIds = {
  facilities: [] as string[],
  customers: [] as string[],
  reactors: [] as string[],
  productionRuns: [] as string[],
  formulations: [] as string[],
  biocharProducts: [] as string[],
  orders: [] as string[],
  deliveries: [] as string[],
  applications: [] as string[],
  creditBatches: [] as string[],
  feedstockTypes: [] as string[],
  feedstocks: [] as string[],
};

// Two facilities for cross-facility testing
let facilityA: { id: string };
let facilityB: { id: string };
let appInFacilityA: { id: string };
let runInFacilityA: { id: string };
let secondRunInFacilityA: { id: string };
let thirdRunInFacilityA: { id: string };
let assignedGuardRunInFacilityA: { id: string };
let outOfWindowRunInFacilityA: { id: string };
let runInFacilityB: { id: string };
// ADR 0015 feedstock-derivation fixtures.
let primaryFeedstockTypeId: string;
let multiFeedstockRunInFacilityA: { id: string };
let noFeedstockRunInFacilityA: { id: string };

beforeAll(async () => {
  // Per-run suffix to avoid uniqueness collisions across parallel runs
  const runId = Date.now().toString(36);

  // Create shared prerequisites
  const [customer] = await db
    .insert(customers)
    .values({ name: "Test Customer VAL", code: `CU-VAL-${runId}` })
    .returning({ id: customers.id });
  createdIds.customers.push(customer.id);

  const [formulation] = await db
    .insert(formulations)
    .values({ name: "Raw Biochar VAL", code: `FM-VAL-${runId}` })
    .returning({ id: formulations.id });
  createdIds.formulations.push(formulation.id);

  // Create two facilities
  const [fA] = await db
    .insert(facilities)
    .values({ name: "Test Facility A", code: `TFA-VAL-${runId}` })
    .returning({ id: facilities.id });
  const [fB] = await db
    .insert(facilities)
    .values({ name: "Test Facility B", code: `TFB-VAL-${runId}` })
    .returning({ id: facilities.id });
  facilityA = fA;
  facilityB = fB;
  createdIds.facilities.push(fA.id, fB.id);

  const [reactorA] = await db
    .insert(reactors)
    .values({
      code: `RE-VAL-A-${runId}`,
      facilityId: facilityA.id,
      identifier: "Validation Reactor A",
      reactorType: "fixed-bed",
    })
    .returning({ id: reactors.id });
  const [reactorB] = await db
    .insert(reactors)
    .values({
      code: `RE-VAL-B-${runId}`,
      facilityId: facilityB.id,
      identifier: "Validation Reactor B",
      reactorType: "fixed-bed",
    })
    .returning({ id: reactors.id });
  createdIds.reactors.push(reactorA.id, reactorB.id);

  const productionRunRows = await db
    .insert(productionRuns)
    .values([
      {
        code: `PR-VAL-A1-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        date: "2025-06-15",
        startTime: new Date("2025-06-15T08:00:00Z"),
        endTime: new Date("2025-06-15T12:00:00Z"),
        biocharDryMassKg: 4500,
      },
      {
        code: `PR-VAL-A2-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        date: "2025-06-16",
        startTime: new Date("2025-06-16T08:00:00Z"),
        endTime: new Date("2025-06-16T12:00:00Z"),
        biocharDryMassKg: 4200,
      },
      {
        code: `PR-VAL-A3-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        date: "2025-06-17",
        startTime: new Date("2025-06-17T08:00:00Z"),
        endTime: new Date("2025-06-17T12:00:00Z"),
        biocharDryMassKg: 4100,
      },
      {
        code: `PR-VAL-A4-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        date: "2025-06-18",
        startTime: new Date("2025-06-18T08:00:00Z"),
        endTime: new Date("2025-06-18T12:00:00Z"),
        biocharDryMassKg: 4000,
      },
      {
        code: `PR-VAL-A5-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        date: "2025-07-15",
        startTime: new Date("2025-07-15T08:00:00Z"),
        endTime: new Date("2025-07-15T12:00:00Z"),
        biocharDryMassKg: 3900,
      },
      {
        code: `PR-VAL-B1-${runId}`,
        facilityId: facilityB.id,
        reactorId: reactorB.id,
        date: "2025-06-15",
        startTime: new Date("2025-06-15T08:00:00Z"),
        endTime: new Date("2025-06-15T12:00:00Z"),
        biocharDryMassKg: 4300,
      },
      {
        // ADR 0015: a run blending two feedstock types — a credit batch built
        // from it must be rejected (one feedstock per protocol production batch).
        code: `PR-VAL-A6-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        date: "2025-06-20",
        startTime: new Date("2025-06-20T08:00:00Z"),
        endTime: new Date("2025-06-20T12:00:00Z"),
        biocharDryMassKg: 3800,
      },
      {
        // A run with no linked feedstock — derivation must throw loudly.
        code: `PR-VAL-A7-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        date: "2025-06-19",
        startTime: new Date("2025-06-19T08:00:00Z"),
        endTime: new Date("2025-06-19T12:00:00Z"),
        biocharDryMassKg: 3700,
      },
    ])
    .returning({ id: productionRuns.id });
  [
    runInFacilityA,
    secondRunInFacilityA,
    thirdRunInFacilityA,
    assignedGuardRunInFacilityA,
    outOfWindowRunInFacilityA,
    runInFacilityB,
    multiFeedstockRunInFacilityA,
    noFeedstockRunInFacilityA,
  ] = productionRunRows;
  createdIds.productionRuns.push(...productionRunRows.map((run) => run.id));

  // ADR 0015: every credit batch derives its single feedstock from its member
  // runs (productionRunFeedstocks → feedstocks.feedstockTypeId), so each run
  // used in a positive test needs a feedstock link. Two types let us prove the
  // single-feedstock assertion fires when a run blends more than one.
  const [primaryType] = await db
    .insert(feedstockTypes)
    .values({
      name: `Validation Woodchips ${runId}`,
      code: `FT-VAL-W-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  const [secondaryType] = await db
    .insert(feedstockTypes)
    .values({
      name: `Validation Coffee Husk ${runId}`,
      code: `FT-VAL-C-${runId}`,
      category: "agricultural",
    })
    .returning({ id: feedstockTypes.id });
  primaryFeedstockTypeId = primaryType.id;
  createdIds.feedstockTypes.push(primaryType.id, secondaryType.id);

  const [feedstockAPrimary] = await db
    .insert(feedstocks)
    .values({
      code: `FS-VAL-A-W-${runId}`,
      facilityId: facilityA.id,
      feedstockTypeId: primaryType.id,
      massDryKg: 3000,
    })
    .returning({ id: feedstocks.id });
  const [feedstockASecondary] = await db
    .insert(feedstocks)
    .values({
      code: `FS-VAL-A-C-${runId}`,
      facilityId: facilityA.id,
      feedstockTypeId: secondaryType.id,
      massDryKg: 1500,
    })
    .returning({ id: feedstocks.id });
  const [feedstockBPrimary] = await db
    .insert(feedstocks)
    .values({
      code: `FS-VAL-B-W-${runId}`,
      facilityId: facilityB.id,
      feedstockTypeId: primaryType.id,
      massDryKg: 2800,
    })
    .returning({ id: feedstocks.id });
  createdIds.feedstocks.push(
    feedstockAPrimary.id,
    feedstockASecondary.id,
    feedstockBPrimary.id,
  );

  // Link each facility-A run (except the deliberately unlinked A7) to the
  // primary feedstock; the facility-B run to its own primary feedstock; and the
  // A6 run to BOTH types so it resolves to two feedstocks.
  await db.insert(productionRunFeedstocks).values([
    { productionRunId: runInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { productionRunId: secondRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { productionRunId: thirdRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { productionRunId: assignedGuardRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { productionRunId: outOfWindowRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { productionRunId: runInFacilityB.id, feedstockId: feedstockBPrimary.id, massUsedKg: 400 },
    { productionRunId: multiFeedstockRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 250 },
    { productionRunId: multiFeedstockRunInFacilityA.id, feedstockId: feedstockASecondary.id, massUsedKg: 150 },
  ]);

  // Create biochar products (needs formulation)
  const [productA] = await db
    .insert(biocharProducts)
    .values({
      code: `BP-VAL-A-${runId}`,
      facilityId: facilityA.id,
      formulationId: formulation.id,
      linkedProductionRunId: runInFacilityA.id,
    })
    .returning({ id: biocharProducts.id });
  const [productB] = await db
    .insert(biocharProducts)
    .values({
      code: `BP-VAL-B-${runId}`,
      facilityId: facilityB.id,
      formulationId: formulation.id,
      linkedProductionRunId: runInFacilityB.id,
    })
    .returning({ id: biocharProducts.id });
  createdIds.biocharProducts.push(productA.id, productB.id);

  // Create orders (needs customer, product, required fields)
  const [orderA] = await db
    .insert(orders)
    .values({
      code: `OR-VAL-A-${runId}`,
      facilityId: facilityA.id,
      biocharProductId: productA.id,
      customerId: customer.id,
      orderDate: new Date("2025-06-01"),
      quantityKg: 1000,
      packaging: "bagged",
    })
    .returning({ id: orders.id });
  const [orderB] = await db
    .insert(orders)
    .values({
      code: `OR-VAL-B-${runId}`,
      facilityId: facilityB.id,
      biocharProductId: productB.id,
      customerId: customer.id,
      orderDate: new Date("2025-06-01"),
      quantityKg: 1000,
      packaging: "bagged",
    })
    .returning({ id: orders.id });
  createdIds.orders.push(orderA.id, orderB.id);

  // Create deliveries (link to facility via facilityId)
  const [deliveryA] = await db
    .insert(deliveries)
    .values({
      code: `DL-VAL-A-${runId}`,
      facilityId: facilityA.id,
      orderId: orderA.id,
      deliveryDate: new Date("2025-06-10"),
    })
    .returning({ id: deliveries.id });
  const [deliveryB] = await db
    .insert(deliveries)
    .values({
      code: `DL-VAL-B-${runId}`,
      facilityId: facilityB.id,
      orderId: orderB.id,
      deliveryDate: new Date("2025-06-10"),
    })
    .returning({ id: deliveries.id });
  createdIds.deliveries.push(deliveryA.id, deliveryB.id);

  // Create applications linked to each facility via deliveries
  const [aA] = await db
    .insert(applications)
    .values({
      code: `AP-VAL-A-${runId}`,
      deliveryId: deliveryA.id,
      applicationDate: new Date("2025-06-15"),
      biocharAppliedTons: 5,
      biocharAppliedDryTons: 4.5,
    })
    .returning({ id: applications.id });
  const [aB] = await db
    .insert(applications)
    .values({
      code: `AP-VAL-B-${runId}`,
      deliveryId: deliveryB.id,
      applicationDate: new Date("2025-06-15"),
      biocharAppliedTons: 5,
      biocharAppliedDryTons: 4.5,
    })
    .returning({ id: applications.id });
  appInFacilityA = aA;
  createdIds.applications.push(aA.id, aB.id);
});

afterAll(async () => {
  // Cleanup in reverse dependency order
  await db.transaction(async (tx) => {
    if (createdIds.creditBatches.length > 0) {
      await tx
        .delete(creditBatchProductionRuns)
        .where(inArray(creditBatchProductionRuns.creditBatchId, createdIds.creditBatches));
      await tx
        .delete(creditBatchApplications)
        .where(inArray(creditBatchApplications.creditBatchId, createdIds.creditBatches));
      await tx
        .delete(creditBatches)
        .where(inArray(creditBatches.id, createdIds.creditBatches));
    }
    if (createdIds.applications.length > 0) {
      await tx
        .delete(applications)
        .where(inArray(applications.id, createdIds.applications));
    }
    if (createdIds.deliveries.length > 0) {
      await tx
        .delete(deliveries)
        .where(inArray(deliveries.id, createdIds.deliveries));
    }
    if (createdIds.orders.length > 0) {
      await tx
        .delete(orders)
        .where(inArray(orders.id, createdIds.orders));
    }
    if (createdIds.biocharProducts.length > 0) {
      await tx
        .delete(biocharProducts)
        .where(inArray(biocharProducts.id, createdIds.biocharProducts));
    }
    if (createdIds.productionRuns.length > 0) {
      await tx
        .delete(productionRunFeedstocks)
        .where(
          inArray(
            productionRunFeedstocks.productionRunId,
            createdIds.productionRuns,
          ),
        );
      await tx
        .delete(productionRuns)
        .where(inArray(productionRuns.id, createdIds.productionRuns));
    }
    if (createdIds.feedstocks.length > 0) {
      await tx
        .delete(feedstocks)
        .where(inArray(feedstocks.id, createdIds.feedstocks));
    }
    if (createdIds.reactors.length > 0) {
      await tx
        .delete(reactors)
        .where(inArray(reactors.id, createdIds.reactors));
    }
    if (createdIds.formulations.length > 0) {
      await tx
        .delete(formulations)
        .where(inArray(formulations.id, createdIds.formulations));
    }
    if (createdIds.customers.length > 0) {
      await tx
        .delete(customers)
        .where(inArray(customers.id, createdIds.customers));
    }
    if (createdIds.facilities.length > 0) {
      // createCreditBatch find-or-creates a production_processes row per
      // (facility, feedstockType); it isn't tracked in createdIds, so clear it
      // by facility before deleting facilities/feedstockTypes it references.
      await tx
        .delete(productionProcesses)
        .where(inArray(productionProcesses.facilityId, createdIds.facilities));
      await tx
        .delete(facilities)
        .where(inArray(facilities.id, createdIds.facilities));
    }
    if (createdIds.feedstockTypes.length > 0) {
      await tx
        .delete(feedstockTypes)
        .where(inArray(feedstockTypes.id, createdIds.feedstockTypes));
    }
  });
});

describe("Credit Batch Production-Run Validation", () => {
  const baseBatchData = {
    startDate: new Date("2025-06-01"),
    endDate: new Date("2025-06-30"),
    certifier: "isometric" as const,
    durabilityOption: "200_year" as const,
    hToCorgRatio: 0.4,
    currency: "TZS" as const,
  };

  it("rejects missing production run IDs", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000999";
    await expect(
      createCreditBatch(TEST_USER_ID, {
        ...baseBatchData,
        code: "CB-VAL-MISSING",
        facilityId: facilityA.id,
        productionRunIds: [fakeId],
      })
    ).rejects.toThrow("Production run(s) not found");
  });

  it("rejects cross-facility production run IDs", async () => {
    await expect(
      createCreditBatch(TEST_USER_ID, {
        ...baseBatchData,
        code: "CB-VAL-XFAC",
        facilityId: facilityA.id,
        productionRunIds: [runInFacilityB.id],
      })
    ).rejects.toThrow("do not belong to the selected facility");
  });

  it("rejects duplicate production run IDs", async () => {
    await expect(
      createCreditBatch(TEST_USER_ID, {
        ...baseBatchData,
        code: "CB-VAL-DUP",
        facilityId: facilityA.id,
        productionRunIds: [runInFacilityA.id, runInFacilityA.id],
      })
    ).rejects.toThrow("Duplicate production run IDs");
  });

  it("rejects production runs outside the batch production window", async () => {
    await expect(
      createCreditBatch(TEST_USER_ID, {
        ...baseBatchData,
        code: "CB-VAL-WINDOW",
        facilityId: facilityA.id,
        productionRunIds: [outOfWindowRunInFacilityA.id],
      })
    ).rejects.toThrow("fall outside the credit batch production window");
  });

  it("accepts valid same-facility production run IDs and derives the single feedstock", async () => {
    const result = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: "CB-VAL-OK",
      facilityId: facilityA.id,
      productionRunIds: [runInFacilityA.id],
    });
    createdIds.creditBatches.push(result.id);

    expect(result.productionRunIds).toEqual([runInFacilityA.id]);
    expect(result.applicationIds).toEqual([appInFacilityA.id]);
    expect(result.applicationCount).toBe(1);
    // ADR 0015: the batch's feedstock + production process are derived from the
    // member run, never supplied by the caller.
    expect(result.feedstockTypeId).toBe(primaryFeedstockTypeId);
    expect(result.productionProcessId).toBeTruthy();
  });

  it("rejects a batch whose runs blend more than one feedstock type", async () => {
    await expect(
      createCreditBatch(TEST_USER_ID, {
        ...baseBatchData,
        code: "CB-VAL-MULTI",
        facilityId: facilityA.id,
        productionRunIds: [multiFeedstockRunInFacilityA.id],
      }),
    ).rejects.toThrow(/single feedstock/i);
  });

  it("rejects a batch whose run has no linked feedstock", async () => {
    await expect(
      createCreditBatch(TEST_USER_ID, {
        ...baseBatchData,
        code: "CB-VAL-NOFEED",
        facilityId: facilityA.id,
        productionRunIds: [noFeedstockRunInFacilityA.id],
      }),
    ).rejects.toThrow(/no linked feedstock/i);
  });

  it("rejects facility change when existing linked production runs belong to old facility", async () => {
    // Create a valid batch for facility A
    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: "CB-VAL-FCHG",
      facilityId: facilityA.id,
      productionRunIds: [secondRunInFacilityA.id],
    });
    createdIds.creditBatches.push(batch.id);

    // Try to change facilityId to B without updating productionRunIds.
    // Existing membership points to facility A runs — should fail against facility B.
    await expect(
      updateCreditBatch(TEST_USER_ID, batch.id, {
        facilityId: facilityB.id,
      })
    ).rejects.toThrow("do not belong to the selected facility");
  });

  it("rejects a production run that is already assigned to another batch", async () => {
    const firstBatch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: "CB-VAL-ASSIGNED-1",
      facilityId: facilityA.id,
      productionRunIds: [assignedGuardRunInFacilityA.id],
    });
    createdIds.creditBatches.push(firstBatch.id);

    await expect(
      createCreditBatch(TEST_USER_ID, {
        ...baseBatchData,
        code: "CB-VAL-ASSIGNED-2",
        facilityId: facilityA.id,
        productionRunIds: [assignedGuardRunInFacilityA.id],
      })
    ).rejects.toThrow("already assigned to credit batches");
  });

  it("rejects cross-facility production run IDs on update", async () => {
    // Create a valid batch for facility A.
    const batch = await createCreditBatch(TEST_USER_ID, {
      ...baseBatchData,
      code: "CB-VAL-XUPD",
      facilityId: facilityA.id,
      productionRunIds: [thirdRunInFacilityA.id],
    });
    createdIds.creditBatches.push(batch.id);

    // Try to update with a production run from facility B.
    await expect(
      updateCreditBatch(TEST_USER_ID, batch.id, {
        productionRunIds: [runInFacilityB.id],
      })
    ).rejects.toThrow("do not belong to the selected facility");
  });
});
