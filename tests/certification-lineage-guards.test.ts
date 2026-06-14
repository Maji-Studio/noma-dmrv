import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createApplication,
  deleteApplication,
  updateApplication,
} from "@/data-access/applications";
import { updateBiocharProduct } from "@/data-access/biochar-products";
import {
  deleteCreditBatch,
  updateCreditBatch,
} from "@/data-access/credit-batches";
import { updateDelivery } from "@/data-access/deliveries";
import { updateFeedstock } from "@/data-access/feedstocks";
import { updateOrder } from "@/data-access/orders";
import {
  deleteProductionRun,
  updateProductionRun,
} from "@/data-access/production-runs";
import { deleteSample, updateSample } from "@/data-access/samples";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  certificationSubmissions,
  certifierGhgStatements,
  certifierRemovals,
  creditBatchApplications,
  creditBatches,
  customers,
  deliveries,
  facilities,
  feedstockTypes,
  feedstocks,
  orders,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  samples,
} from "@/db/schema";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";
const LOCKED_COPY = "Create a correction instead of editing locked source data";

interface LineageFixture {
  applicationId: string;
  batchId: string;
  customerId: string;
  deliveryId: string;
  facilityId: string;
  feedstockId: string;
  feedstockTypeId: string;
  ghgStatementId: string | null;
  orderId: string;
  productId: string;
  productionRunId: string;
  reactorId: string;
  removalId: string;
  sampleId: string;
}

async function createLineageFixture(
  blockingVia: "removal" | "ghgStatement" = "removal",
): Promise<LineageFixture> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();

  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({ code: `FAC-CLG-${tag}`, name: `CLG Facility ${tag}` })
      .returning({ id: facilities.id });

    const [reactor] = await tx
      .insert(reactors)
      .values({
        code: `RX-CLG-${tag}`,
        identifier: `CLG Reactor ${tag}`,
        facilityId: facility.id,
        reactorType: "retort",
      })
      .returning({ id: reactors.id });

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        code: `FT-CLG-${tag}`,
        name: `CLG Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });

    const [feedstock] = await tx
      .insert(feedstocks)
      .values({
        code: `FS-CLG-${tag}`,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        massDryKg: 900,
        massWetKg: 1_000,
        moistureContentPercent: 10,
      })
      .returning({ id: feedstocks.id });

    const [productionRun] = await tx
      .insert(productionRuns)
      .values({
        code: `PR-CLG-${tag}`,
        facilityId: facility.id,
        date: "2026-06-13",
        startTime: new Date("2026-06-13T08:00:00Z"),
        endTime: new Date("2026-06-13T12:00:00Z"),
        reactorId: reactor.id,
        feedstockWetMassKg: 1_000,
        feedstockMoisturePercent: 10,
        feedstockMassDryKg: 900,
        biocharOutputKg: 300,
        biocharMoisturePercent: 5,
        biocharDryMassKg: 285,
      })
      .returning({ id: productionRuns.id });

    await tx.insert(productionRunFeedstocks).values({
      productionRunId: productionRun.id,
      feedstockId: feedstock.id,
      massUsedKg: 900,
    });

    const [sample] = await tx
      .insert(samples)
      .values({
        productionRunId: productionRun.id,
        sampleCode: `S-CLG-${tag}`,
        samplingTime: new Date("2026-06-13T10:00:00Z"),
        totalCarbonPercent: 80,
        organicCarbonPercent: 78,
      })
      .returning({ id: samples.id });

    const [product] = await tx
      .insert(biocharProducts)
      .values({
        code: `BP-CLG-${tag}`,
        facilityId: facility.id,
        linkedProductionRunId: productionRun.id,
        massKg: 300,
        moistureContentPercent: 5,
        waterAddedKg: 0,
      })
      .returning({ id: biocharProducts.id });

    const [customer] = await tx
      .insert(customers)
      .values({ code: `CU-CLG-${tag}`, name: `CLG Customer ${tag}` })
      .returning({ id: customers.id });

    const [order] = await tx
      .insert(orders)
      .values({
        code: `OR-CLG-${tag}`,
        facilityId: facility.id,
        customerId: customer.id,
        biocharProductId: product.id,
        orderDate: new Date("2026-06-14T00:00:00Z"),
        quantityKg: 300,
        packaging: "loose",
      })
      .returning({ id: orders.id });

    const [delivery] = await tx
      .insert(deliveries)
      .values({
        code: `DL-CLG-${tag}`,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: product.id,
        deliveryDate: new Date("2026-06-15T00:00:00Z"),
        deliveredWetMassKg: 300,
        massDryKg: 285,
      })
      .returning({ id: deliveries.id });

    const [application] = await tx
      .insert(applications)
      .values({
        code: `AP-CLG-${tag}`,
        deliveryId: delivery.id,
        applicationDate: new Date("2026-06-16T00:00:00Z"),
        biocharAppliedTons: 0.3,
        biocharAppliedDryTons: 0.285,
      })
      .returning({ id: applications.id });

    let ghgStatementId: string | null = null;
    if (blockingVia === "ghgStatement") {
      const [ghgStatement] = await tx
        .insert(certifierGhgStatements)
        .values({
          facilityId: facility.id,
          reportingPeriodEndOn: "2026-06-30",
        })
        .returning({ id: certifierGhgStatements.id });
      ghgStatementId = ghgStatement.id;
    }

    const [removal] = await tx
      .insert(certifierRemovals)
      .values({ facilityId: facility.id, ghgStatementId })
      .returning({ id: certifierRemovals.id });

    const [batch] = await tx
      .insert(creditBatches)
      .values({
        code: `CB-CLG-${tag}`,
        facilityId: facility.id,
        status: "pending",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        certifier: "isometric",
        removalId: removal.id,
      })
      .returning({ id: creditBatches.id });

    await tx.insert(creditBatchApplications).values({
      creditBatchId: batch.id,
      applicationId: application.id,
    });

    await tx.insert(certificationSubmissions).values({
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

    return {
      applicationId: application.id,
      batchId: batch.id,
      customerId: customer.id,
      deliveryId: delivery.id,
      facilityId: facility.id,
      feedstockId: feedstock.id,
      feedstockTypeId: feedstockType.id,
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

async function cleanupLineageFixture(fixture: LineageFixture): Promise<void> {
  const submissionEntityIds = [fixture.removalId];
  if (fixture.ghgStatementId) submissionEntityIds.push(fixture.ghgStatementId);

  await db.transaction(async (tx) => {
    await tx
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, submissionEntityIds));
    await tx
      .delete(creditBatchApplications)
      .where(eq(creditBatchApplications.creditBatchId, fixture.batchId));
    await tx.delete(creditBatches).where(eq(creditBatches.id, fixture.batchId));
    await tx
      .delete(applications)
      .where(eq(applications.id, fixture.applicationId));
    await tx.delete(deliveries).where(eq(deliveries.id, fixture.deliveryId));
    await tx.delete(orders).where(eq(orders.id, fixture.orderId));
    await tx
      .delete(biocharProducts)
      .where(eq(biocharProducts.id, fixture.productId));
    await tx.delete(samples).where(eq(samples.id, fixture.sampleId));
    await tx
      .delete(productionRunFeedstocks)
      .where(eq(productionRunFeedstocks.productionRunId, fixture.productionRunId));
    await tx
      .delete(feedstocks)
      .where(eq(feedstocks.id, fixture.feedstockId));
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
      .delete(productionRuns)
      .where(eq(productionRuns.id, fixture.productionRunId));
    await tx.delete(reactors).where(eq(reactors.id, fixture.reactorId));
    await tx.delete(customers).where(eq(customers.id, fixture.customerId));
    await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
  });
}

async function withFixture<T>(
  testFn: (fixture: LineageFixture) => Promise<T>,
  blockingVia: "removal" | "ghgStatement" = "removal",
): Promise<T> {
  const fixture = await createLineageFixture(blockingVia);
  try {
    return await testFn(fixture);
  } finally {
    await cleanupLineageFixture(fixture);
  }
}

describe("certification lineage guards", () => {
  it("rejects production run dry-mass edits once a linked removal is submitted", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateProductionRun(TEST_USER_ID, fixture.productionRunId, {
          feedstockWetMassKg: 1_100,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects production run deletion once linked to a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteProductionRun(TEST_USER_ID, fixture.productionRunId),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects sample edits once the sample supports a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateSample(TEST_USER_ID, fixture.sampleId, {
          organicCarbonPercent: 79,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects deleting upstream sample evidence for a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteSample(TEST_USER_ID, fixture.sampleId),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects delivery edits once the removal is verifier-bound through a GHG statement", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateDelivery(TEST_USER_ID, fixture.deliveryId, {
          deliveredWetMassKg: 301,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    }, "ghgStatement");
  });

  it("rejects biochar product edits once linked to a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateBiocharProduct(TEST_USER_ID, fixture.productId, {
          massKg: 301,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects feedstock edits once consumed by a submitted removal lineage", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateFeedstock(TEST_USER_ID, fixture.feedstockId, {
          massDryKg: 901,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects order edits once linked to a submitted removal lineage", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateOrder(TEST_USER_ID, fixture.orderId, {
          quantityKg: 301,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects new applications on a submitted delivery lineage", async () => {
    await withFixture(async (fixture) => {
      await expect(
        createApplication(TEST_USER_ID, {
          code: `AP-LOCKED-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          deliveryId: fixture.deliveryId,
          applicationDate: new Date("2026-06-17T00:00:00Z"),
          biocharAppliedTons: 0.01,
          biocharAppliedDryTons: 0.01,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects application edits once linked to a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateApplication(TEST_USER_ID, fixture.applicationId, {
          fieldIdentifier: "locked-field",
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects deleting applications from a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteApplication(TEST_USER_ID, fixture.applicationId),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects credit batch edits once its removal is submitted", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateCreditBatch(TEST_USER_ID, fixture.batchId, {
          siteManagementNotes: "locked notes",
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects credit batch deletion once its removal is verifier-bound through a GHG statement", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteCreditBatch(TEST_USER_ID, fixture.batchId),
      ).rejects.toThrow(LOCKED_COPY);
    }, "ghgStatement");
  });
});
