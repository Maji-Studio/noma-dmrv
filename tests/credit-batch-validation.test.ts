import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * Credit Batch Production-Run Validation Tests
 *
 * Integration tests for server-side validation in credit batch data-access layer.
 * Tests: missing IDs, cross-facility IDs, duplicate IDs, and facility-change-with-stale-membership.
 *
 * Requires a running database (uses DATABASE_URL from .env.test or test defaults).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { inArray, sql } from "drizzle-orm";
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
import { updateProductionRun } from "@/data-access/production-runs";

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
// ADR 0016 feedstock-derivation fixtures.
let primaryFeedstockTypeId: string;
let multiFeedstockRunInFacilityA: { id: string };
let noFeedstockRunInFacilityA: { id: string };
let mismatchedFeedstockRunInFacilityA: { id: string };
let concurrencyRunInFacilityA: { id: string };
const CONCURRENCY_BARRIER_TIMEOUT_MS = 5_000;

beforeAll(() => ensureTestOrg());

beforeAll(async () => {
  // Per-run suffix to avoid uniqueness collisions across parallel runs
  const runId = Date.now().toString(36);

  // Create shared prerequisites
  const [customer] = await db
    .insert(customers)
    .values({ organizationId: TEST_ORG_ID, name: "Test Customer VAL", code: `CU-VAL-${runId}` })
    .returning({ id: customers.id });
  createdIds.customers.push(customer.id);

  const [formulation] = await db
    .insert(formulations)
    .values({ organizationId: TEST_ORG_ID, name: "Raw Biochar VAL", code: `FM-VAL-${runId}` })
    .returning({ id: formulations.id });
  createdIds.formulations.push(formulation.id);

  // Create two facilities
  const [fA] = await db
    .insert(facilities)
    .values({ organizationId: TEST_ORG_ID, name: `Test Facility A ${runId}`, code: `TFA-VAL-${runId}` })
    .returning({ id: facilities.id });
  const [fB] = await db
    .insert(facilities)
    .values({ organizationId: TEST_ORG_ID, name: `Test Facility B ${runId}`, code: `TFB-VAL-${runId}` })
    .returning({ id: facilities.id });
  facilityA = fA;
  facilityB = fB;
  createdIds.facilities.push(fA.id, fB.id);

  const [reactorA] = await db
    .insert(reactors)
    .values({
      organizationId: TEST_ORG_ID,
      code: `RE-VAL-A-${runId}`,
      facilityId: facilityA.id,
      identifier: "Validation Reactor A",
      reactorType: "fixed-bed",
    })
    .returning({ id: reactors.id });
  const [reactorB] = await db
    .insert(reactors)
    .values({
      organizationId: TEST_ORG_ID,
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
        organizationId: TEST_ORG_ID,
        code: `PR-VAL-A1-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-15T08:00:00Z"),
        endTime: new Date("2025-06-15T12:00:00Z"),
        biocharDryMassKg: 4500,
      },
      {
        organizationId: TEST_ORG_ID,
        code: `PR-VAL-A2-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-16T08:00:00Z"),
        endTime: new Date("2025-06-16T12:00:00Z"),
        biocharDryMassKg: 4200,
      },
      {
        organizationId: TEST_ORG_ID,
        code: `PR-VAL-A3-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-17T08:00:00Z"),
        endTime: new Date("2025-06-17T12:00:00Z"),
        biocharDryMassKg: 4100,
      },
      {
        organizationId: TEST_ORG_ID,
        code: `PR-VAL-A4-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-18T08:00:00Z"),
        endTime: new Date("2025-06-18T12:00:00Z"),
        biocharDryMassKg: 4000,
      },
      {
        organizationId: TEST_ORG_ID,
        code: `PR-VAL-A5-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-07-15T08:00:00Z"),
        endTime: new Date("2025-07-15T12:00:00Z"),
        biocharDryMassKg: 3900,
      },
      {
        organizationId: TEST_ORG_ID,
        code: `PR-VAL-B1-${runId}`,
        facilityId: facilityB.id,
        reactorId: reactorB.id,
        startTime: new Date("2025-06-15T08:00:00Z"),
        endTime: new Date("2025-06-15T12:00:00Z"),
        biocharDryMassKg: 4300,
      },
      {
        organizationId: TEST_ORG_ID,
        // ADR 0016: a run blending two feedstock types — a credit batch built
        // from it must be rejected (one feedstock per protocol production batch).
        code: `PR-VAL-A6-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-20T08:00:00Z"),
        endTime: new Date("2025-06-20T12:00:00Z"),
        biocharDryMassKg: 3800,
      },
      {
        organizationId: TEST_ORG_ID,
        // A run with no linked feedstock — derivation must throw loudly.
        code: `PR-VAL-A7-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-19T08:00:00Z"),
        endTime: new Date("2025-06-19T12:00:00Z"),
        biocharDryMassKg: 3700,
      },
      {
        organizationId: TEST_ORG_ID,
        // ADR 0016 amendment: a run whose SINGLE feedstock is valid but differs
        // from the type declared on the batch. The equality guard must reject
        // it so the declaration can never drift from the actual runs.
        code: `PR-VAL-A8-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-21T08:00:00Z"),
        endTime: new Date("2025-06-21T12:00:00Z"),
        biocharDryMassKg: 3600,
      },
      {
        organizationId: TEST_ORG_ID,
        code: `PR-VAL-RACE-${runId}`,
        facilityId: facilityA.id,
        reactorId: reactorA.id,
        startTime: new Date("2025-06-22T08:00:00Z"),
        endTime: new Date("2025-06-22T12:00:00Z"),
        feedstockMassDryKg: 400,
        biocharOutputKg: 100,
        biocharDryMassKg: 100,
      },
    ].map((row) => ({ ...row, status: "complete" as const })))
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
    mismatchedFeedstockRunInFacilityA,
    concurrencyRunInFacilityA,
  ] = productionRunRows;
  createdIds.productionRuns.push(...productionRunRows.map((run) => run.id));

  // ADR 0016: every credit batch derives its single feedstock from its member
  // runs (productionRunFeedstocks → feedstocks.feedstockTypeId), so each run
  // used in a positive test needs a feedstock link. Two types let us prove the
  // single-feedstock assertion fires when a run blends more than one.
  const [primaryType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Validation Woodchips ${runId}`,
      code: `FT-VAL-W-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  const [secondaryType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
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
      organizationId: TEST_ORG_ID,
      code: `FS-VAL-A-W-${runId}`,
      facilityId: facilityA.id,
      feedstockTypeId: primaryType.id,
      massDryKg: 3000,
    })
    .returning({ id: feedstocks.id });
  const [feedstockASecondary] = await db
    .insert(feedstocks)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FS-VAL-A-C-${runId}`,
      facilityId: facilityA.id,
      feedstockTypeId: secondaryType.id,
      massDryKg: 1500,
    })
    .returning({ id: feedstocks.id });
  const [feedstockBPrimary] = await db
    .insert(feedstocks)
    .values({
      organizationId: TEST_ORG_ID,
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
    { organizationId: TEST_ORG_ID, productionRunId: runInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { organizationId: TEST_ORG_ID, productionRunId: secondRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { organizationId: TEST_ORG_ID, productionRunId: thirdRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { organizationId: TEST_ORG_ID, productionRunId: assignedGuardRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { organizationId: TEST_ORG_ID, productionRunId: outOfWindowRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
    { organizationId: TEST_ORG_ID, productionRunId: runInFacilityB.id, feedstockId: feedstockBPrimary.id, massUsedKg: 400 },
    { organizationId: TEST_ORG_ID, productionRunId: multiFeedstockRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 250 },
    { organizationId: TEST_ORG_ID, productionRunId: multiFeedstockRunInFacilityA.id, feedstockId: feedstockASecondary.id, massUsedKg: 150 },
    // A8 uses ONLY the secondary type — a single, valid feedstock that differs
    // from the primary type the batch will declare (equality-guard fixture).
    { organizationId: TEST_ORG_ID, productionRunId: mismatchedFeedstockRunInFacilityA.id, feedstockId: feedstockASecondary.id, massUsedKg: 400 },
    { organizationId: TEST_ORG_ID, productionRunId: concurrencyRunInFacilityA.id, feedstockId: feedstockAPrimary.id, massUsedKg: 400 },
  ]);

  // Create biochar products (needs formulation)
  const [productA] = await db
    .insert(biocharProducts)
    .values({
      organizationId: TEST_ORG_ID,
      code: `BP-VAL-A-${runId}`,
      facilityId: facilityA.id,
      formulationId: formulation.id,
      linkedProductionRunId: runInFacilityA.id,
    })
    .returning({ id: biocharProducts.id });
  const [productB] = await db
    .insert(biocharProducts)
    .values({
      organizationId: TEST_ORG_ID,
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
      organizationId: TEST_ORG_ID,
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
      organizationId: TEST_ORG_ID,
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
      organizationId: TEST_ORG_ID,
      code: `DL-VAL-A-${runId}`,
      facilityId: facilityA.id,
      orderId: orderA.id,
      deliveryDate: new Date("2025-06-10"),
    })
    .returning({ id: deliveries.id });
  const [deliveryB] = await db
    .insert(deliveries)
    .values({
      organizationId: TEST_ORG_ID,
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
      organizationId: TEST_ORG_ID,
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
      organizationId: TEST_ORG_ID,
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
    // Feedstock type is now DECLARED (ADR 0016 amendment) and guarded against the
    // member runs. A getter defers reading the module-scoped id until each test
    // spreads baseBatchData — after beforeAll has seeded it.
    get feedstockTypeId() {
      return primaryFeedstockTypeId;
    },
  };

  it("rejects missing production run IDs", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000999";
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-MISSING",
        facilityId: facilityA.id,
        productionRunIds: [fakeId],
      })
    ).rejects.toThrow("Production run(s) not found");
  });

  it("rejects cross-facility production run IDs", async () => {
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-XFAC",
        facilityId: facilityA.id,
        productionRunIds: [runInFacilityB.id],
      })
    ).rejects.toThrow("do not belong to the selected facility");
  });

  it("rejects duplicate production run IDs", async () => {
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-DUP",
        facilityId: facilityA.id,
        productionRunIds: [runInFacilityA.id, runInFacilityA.id],
      })
    ).rejects.toThrow("Duplicate production run IDs");
  });

  it("rejects production runs outside the batch production window", async () => {
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-WINDOW",
        facilityId: facilityA.id,
        productionRunIds: [outOfWindowRunInFacilityA.id],
      })
    ).rejects.toThrow("fall outside the credit batch production window");
  });

  it("accepts valid same-facility runs matching the declared feedstock", async () => {
    const result = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...baseBatchData,
      code: "CB-VAL-OK",
      facilityId: facilityA.id,
      productionRunIds: [runInFacilityA.id],
    });
    createdIds.creditBatches.push(result.id);

    expect(result.productionRunIds).toEqual([runInFacilityA.id]);
    expect(result.applicationIds).toEqual([appInFacilityA.id]);
    expect(result.applicationCount).toBe(1);
    // ADR 0016 (amended 2026-07-04): feedstock type is DECLARED on the batch and
    // guarded against the member runs; the production process is resolved from it.
    expect(result.feedstockTypeId).toBe(primaryFeedstockTypeId);
    expect(result.productionProcessId).toBeTruthy();
  });

  it("rejects an unsampled batch without an Isometric connection", async () => {
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-UNSAMPLED-NO-CONNECTION",
        facilityId: facilityA.id,
        productionRunIds: [secondRunInFacilityA.id],
        sampling: "unsampled",
      }),
    ).rejects.toThrow(/require an Isometric connection/i);
  });

  it("rejects a batch whose runs blend more than one feedstock type", async () => {
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-MULTI",
        facilityId: facilityA.id,
        productionRunIds: [multiFeedstockRunInFacilityA.id],
      }),
    ).rejects.toThrow(/single feedstock/i);
  });

  it("rejects a batch whose run has no linked feedstock", async () => {
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-NOFEED",
        facilityId: facilityA.id,
        productionRunIds: [noFeedstockRunInFacilityA.id],
      }),
    ).rejects.toThrow(/no linked feedstock/i);
  });

  it("rejects a run whose single feedstock differs from the declared type", async () => {
    // baseBatchData declares the PRIMARY type, but this run resolves to a valid
    // SINGLE feedstock of the SECONDARY type. The equality guard (ADR 0016
    // amendment) must reject it — a declared type that doesn't match the member
    // runs can never be silently accepted.
    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-MISMATCH",
        facilityId: facilityA.id,
        productionRunIds: [mismatchedFeedstockRunInFacilityA.id],
      }),
    ).rejects.toThrow(/different feedstock/i);
  });

  it("rejects facility change when existing linked production runs belong to old facility", async () => {
    // Create a valid batch for facility A
    const batch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...baseBatchData,
      code: "CB-VAL-FCHG",
      facilityId: facilityA.id,
      productionRunIds: [secondRunInFacilityA.id],
    });
    createdIds.creditBatches.push(batch.id);

    // Try to change facilityId to B without updating productionRunIds.
    // Existing membership points to facility A runs — should fail against facility B.
    await expect(
      updateCreditBatch(makeTestOrgContext(TEST_USER_ID), batch.id, {
        facilityId: facilityB.id,
      })
    ).rejects.toThrow("do not belong to the selected facility");
  });

  it("rejects a production run that is already assigned to another batch", async () => {
    const firstBatch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...baseBatchData,
      code: "CB-VAL-ASSIGNED-1",
      facilityId: facilityA.id,
      productionRunIds: [assignedGuardRunInFacilityA.id],
    });
    createdIds.creditBatches.push(firstBatch.id);

    await expect(
      createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
        ...baseBatchData,
        code: "CB-VAL-ASSIGNED-2",
        facilityId: facilityA.id,
        productionRunIds: [assignedGuardRunInFacilityA.id],
      })
    ).rejects.toThrow("already assigned to credit batches");
  });

  it("rejects cross-facility production run IDs on update", async () => {
    // Create a valid batch for facility A.
    const batch = await createCreditBatch(makeTestOrgContext(TEST_USER_ID), {
      ...baseBatchData,
      code: "CB-VAL-XUPD",
      facilityId: facilityA.id,
      productionRunIds: [thirdRunInFacilityA.id],
    });
    createdIds.creditBatches.push(batch.id);

    // Try to update with a production run from facility B.
    await expect(
      updateCreditBatch(makeTestOrgContext(TEST_USER_ID), batch.id, {
        productionRunIds: [runInFacilityB.id],
      })
    ).rejects.toThrow("do not belong to the selected facility");
  });

  it("serializes batch assignment ahead of a concurrent Complete-to-Running reopen", async () => {
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const lockKey = `production-process-current:${facilityA.id}:${primaryFeedstockTypeId}`;
    let releaseProcessLock = () => {};
    let signalProcessLockReady = () => {};
    const processLockReady = new Promise<void>((resolve) => {
      signalProcessLockReady = resolve;
    });
    const releaseProcessLockPromise = new Promise<void>((resolve) => {
      releaseProcessLock = resolve;
    });
    let blockerPid = 0;
    const blocker = db.transaction(async (tx) => {
      await tx.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `);
      const backend = await tx.execute<{ pid: number }>(
        sql`select pg_backend_pid() as pid`,
      );
      blockerPid = backend.rows[0]?.pid ?? 0;
      signalProcessLockReady();
      await releaseProcessLockPromise;
    });

    let createPromise: ReturnType<typeof createCreditBatch> | undefined;
    let reopenPromise: ReturnType<typeof updateProductionRun> | undefined;
    try {
      await processLockReady;
      createPromise = createCreditBatch(ctx, {
        ...baseBatchData,
        code: `CB-VAL-RACE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
        facilityId: facilityA.id,
        productionRunIds: [concurrencyRunInFacilityA.id],
      });

      await expect.poll(async () => {
        const result = await db.execute<{ waiting: boolean }>(sql`
          select exists (
            select 1
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
              and held.pid = ${blockerPid}
          ) as waiting
        `);
        return result.rows[0]?.waiting ?? false;
      }, { timeout: CONCURRENCY_BARRIER_TIMEOUT_MS }).toBe(true);

      reopenPromise = updateProductionRun(ctx, concurrencyRunInFacilityA.id, {
        status: "running",
        endTime: null,
      });
      void reopenPromise.catch(() => undefined);
      releaseProcessLock();
      await blocker;

      const batch = await createPromise;
      createdIds.creditBatches.push(batch.id);
      await expect(reopenPromise).rejects.toThrow(
        "Remove this run from its Credit batch before reopening it.",
      );

      const [persistedRun] = await db
        .select({ status: productionRuns.status })
        .from(productionRuns)
        .where(inArray(productionRuns.id, [concurrencyRunInFacilityA.id]));
      expect(persistedRun?.status).toBe("complete");
      expect(batch.productionRunIds).toEqual([concurrencyRunInFacilityA.id]);
    } finally {
      releaseProcessLock();
      await blocker.catch(() => undefined);
      await createPromise?.catch(() => undefined);
      await reopenPromise?.catch(() => undefined);
    }
  });
});
