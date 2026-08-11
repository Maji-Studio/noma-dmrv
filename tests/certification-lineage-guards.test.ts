import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createApplication,
  deleteApplication,
  updateApplication,
} from "@/data-access/applications";
import {
  createBiocharProduct,
  updateBiocharProduct,
} from "@/data-access/biochar-products";
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
import { createTransportLeg } from "@/data-access/transport-legs";
import { db } from "@/db";
import {
  applications,
  biocharProducts,
  certificationSubmissions,
  certifierGhgStatements,
  certifierRemovals,
  creditBatchProductionRuns,
  creditBatches,
  customers,
  deliveries,
  facilities,
  feedstockTypes,
  feedstocks,
  orders,
  productionRunFeedstocks,
  productionRuns,
  productionProcesses,
  reactors,
  samples,
  storageLocations,
} from "@/db/schema";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";
const LOCKED_COPY =
  "Submitted Removal data is locked. Removal cancellation is not available yet.";

interface LineageFixture {
  applicationId: string;
  batchId: string;
  customerId: string;
  deliveryId: string;
  facilityId: string;
  feedstockId: string;
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

async function createLineageFixture(
  blockingVia: "none" | "removal" | "ghgStatement" = "removal",
): Promise<LineageFixture> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();

  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({ organizationId: TEST_ORG_ID, code: `FAC-CLG-${tag}`, name: `CLG Facility ${tag}` })
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

    const [feedstock] = await tx
      .insert(feedstocks)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FS-CLG-${tag}`,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        massDryKg: 900,
        massWetKg: 1_000,
        moistureContentPercent: 10,
      })
      .returning({ id: feedstocks.id });

    const [productionProcess] = await tx
      .insert(productionProcesses)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
      })
      .returning({ id: productionProcesses.id });

    const [productionRun] = await tx
      .insert(productionRuns)
      .values({
        organizationId: TEST_ORG_ID,
        code: `PR-CLG-${tag}`,
        facilityId: facility.id,
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
      .values({
        organizationId: TEST_ORG_ID,
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
      .values({ organizationId: TEST_ORG_ID, code: `CU-CLG-${tag}`, name: `CLG Customer ${tag}` })
      .returning({ id: customers.id });

    const [order] = await tx
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
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
        organizationId: TEST_ORG_ID,
        code: `DL-CLG-${tag}`,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: product.id,
        status: "delivered",
        deliveryDate: new Date("2026-06-15T00:00:00Z"),
        deliveredWetMassKg: 300,
        massDryKg: 285,
      })
      .returning({ id: deliveries.id });

    const [application] = await tx
      .insert(applications)
      .values({
        organizationId: TEST_ORG_ID,
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
        removalId: removal.id,
      })
      .returning({ id: creditBatches.id });

    await tx.insert(creditBatchProductionRuns).values({
      organizationId: TEST_ORG_ID,
      creditBatchId: batch.id,
      productionRunId: productionRun.id,
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

async function cleanupLineageFixture(fixture: LineageFixture): Promise<void> {
  const submissionEntityIds = [fixture.removalId];
  if (fixture.ghgStatementId) submissionEntityIds.push(fixture.ghgStatementId);

  await db.transaction(async (tx) => {
    await tx
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, submissionEntityIds));
    await tx
      .delete(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.creditBatchId, fixture.batchId));
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
      .delete(productionProcesses)
      .where(eq(productionProcesses.id, fixture.productionProcessId));
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
  blockingVia: "none" | "removal" | "ghgStatement" = "removal",
): Promise<T> {
  const fixture = await createLineageFixture(blockingVia);
  try {
    return await testFn(fixture);
  } finally {
    await cleanupLineageFixture(fixture);
  }
}


beforeAll(() => ensureTestOrg());

describe("certification lineage guards", () => {
  it("allows production run edits while the lineage has no submitted certification artifact", async () => {
    await withFixture(async (fixture) => {
      const updated = await updateProductionRun(
        makeTestOrgContext(TEST_USER_ID),
        fixture.productionRunId,
        {
          feedstockWetMassKg: 1_100,
        },
      );

      expect(updated.feedstockWetMassKg).toBe(1_100);
    }, "none");
  });

  it("allows application edits while the lineage has no submitted certification artifact", async () => {
    await withFixture(async (fixture) => {
      const updated = await updateApplication(makeTestOrgContext(TEST_USER_ID), fixture.applicationId, {
        fieldIdentifier: "editable-field",
      });

      expect(updated.fieldIdentifier).toBe("editable-field");
    }, "none");
  });

  it("rejects production run dry-mass edits once a linked removal is submitted", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateProductionRun(makeTestOrgContext(TEST_USER_ID), fixture.productionRunId, {
          feedstockWetMassKg: 1_100,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects production run deletion once linked to a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteProductionRun(makeTestOrgContext(TEST_USER_ID), fixture.productionRunId),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects sample edits once the sample supports a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateSample(makeTestOrgContext(TEST_USER_ID), fixture.sampleId, {
          organicCarbonPercent: 79,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects deleting upstream sample evidence for a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteSample(makeTestOrgContext(TEST_USER_ID), fixture.sampleId),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects delivery edits once the removal is verifier-bound through a GHG statement", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateDelivery(makeTestOrgContext(TEST_USER_ID), fixture.deliveryId, {
          deliveredWetMassKg: 301,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    }, "ghgStatement");
  });

  it("rejects biochar product edits once linked to a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateBiocharProduct(makeTestOrgContext(TEST_USER_ID), fixture.productId, {
          massKg: 301,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects creating a biochar product against a submitted production-run lineage", async () => {
    await withFixture(async (fixture) => {
      const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
      // An otherwise-valid create: a real product bin in the locked run's
      // facility. Only the certified-lineage guard should block it.
      const [bin] = await db
        .insert(storageLocations)
        .values({
          organizationId: TEST_ORG_ID,
          code: `SL-CLG-${tag}`,
          name: `CLG Product Bin ${tag}`,
          type: "product_bin",
          facilityId: fixture.facilityId,
        })
        .returning({ id: storageLocations.id });

      try {
        await expect(
          createBiocharProduct(makeTestOrgContext(TEST_USER_ID), {
            code: `BP-LOCKED-${tag}`,
            facilityId: fixture.facilityId,
            linkedProductionRunId: fixture.productionRunId,
            storageLocationId: bin.id,
            massKg: 10,
            moistureContentPercent: 5,
            waterAddedKg: 0,
          }),
        ).rejects.toThrow(
          "Cannot create this biochar product because its production run is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
        );
      } finally {
        // If the certified-lineage guard ever regresses and the create
        // succeeds, the assertion fails AND leaves an orphan product behind.
        // Remove any product with this run's unique code before the bin so a
        // regression can't cascade into later specs.
        await db
          .delete(biocharProducts)
          .where(eq(biocharProducts.code, `BP-LOCKED-${tag}`));
        await db
          .delete(storageLocations)
          .where(eq(storageLocations.id, bin.id));
      }
    });
  });

  it("rejects feedstock edits once consumed by a submitted removal lineage", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateFeedstock(makeTestOrgContext(TEST_USER_ID), fixture.feedstockId, {
          massDryKg: 901,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects order edits once linked to a submitted removal lineage", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateOrder(makeTestOrgContext(TEST_USER_ID), fixture.orderId, {
          quantityKg: 301,
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects new applications on a submitted delivery lineage", async () => {
    await withFixture(async (fixture) => {
      await expect(
        createApplication(makeTestOrgContext(TEST_USER_ID), {
          code: `AP-LOCKED-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          deliveryId: fixture.deliveryId,
          applicationDate: new Date("2026-06-17T00:00:00Z"),
          biocharAppliedTons: 0.01,
        }),
      ).rejects.toThrow(
        "Cannot create this application because its delivery is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
      );
    });
  });

  it("rejects new transport legs on a submitted parent lineage", async () => {
    await withFixture(async (fixture) => {
      await expect(
        createTransportLeg(makeTestOrgContext(TEST_USER_ID), {
          entityType: "feedstock",
          entityId: fixture.feedstockId,
          distanceKm: 10,
          transportMethodType: "road",
          loadMassKg: 100,
        }),
      ).rejects.toThrow(
        "Cannot create this transport leg because its feedstock is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
      );
    });
  });

  it("rejects application edits once linked to a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateApplication(makeTestOrgContext(TEST_USER_ID), fixture.applicationId, {
          fieldIdentifier: "locked-field",
        }),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects deleting applications from a submitted removal", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteApplication(makeTestOrgContext(TEST_USER_ID), fixture.applicationId),
      ).rejects.toThrow(LOCKED_COPY);
    });
  });

  it("rejects credit batch edits once its removal is submitted", async () => {
    await withFixture(async (fixture) => {
      await expect(
        updateCreditBatch(makeTestOrgContext(TEST_USER_ID), fixture.batchId, {
          siteManagementNotes: "locked notes",
        }),
      ).rejects.toThrow(
        "Cannot update this credit batch because it is part of a submitted Removal. Submitted Removal data is locked. Removal cancellation is not available yet.",
      );
    });
  });

  it("rejects credit batch deletion once its removal is verifier-bound through a GHG statement", async () => {
    await withFixture(async (fixture) => {
      await expect(
        deleteCreditBatch(makeTestOrgContext(TEST_USER_ID), fixture.batchId),
      ).rejects.toThrow(LOCKED_COPY);
    }, "ghgStatement");
  });
});
