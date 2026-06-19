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
import { productionRuns } from "@/db/schema/production";
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
    ])
    .returning({ id: productionRuns.id });
  [
    runInFacilityA,
    secondRunInFacilityA,
    thirdRunInFacilityA,
    assignedGuardRunInFacilityA,
    outOfWindowRunInFacilityA,
    runInFacilityB,
  ] = productionRunRows;
  createdIds.productionRuns.push(...productionRunRows.map((run) => run.id));

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
        .delete(productionRuns)
        .where(inArray(productionRuns.id, createdIds.productionRuns));
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
      await tx
        .delete(facilities)
        .where(inArray(facilities.id, createdIds.facilities));
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

  it("accepts valid same-facility production run IDs", async () => {
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
