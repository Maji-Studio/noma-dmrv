import { describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { deleteApplication } from "@/data-access/applications";
import { applications, soilTemperatureMeasurements } from "@/db/schema/application";
import {
  creditBatches,
  creditBatchApplications,
  creditBatchProductionRuns,
} from "@/db/schema/credits";
import { facilities, reactors } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { deliveries, orders } from "@/db/schema/logistics";
import { customers } from "@/db/schema/parties";
import { biocharProducts, formulations } from "@/db/schema/products";
import { productionRuns } from "@/db/schema/production";

const TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001";

interface DeleteFixture {
  facilityId: string;
  customerId: string;
  formulationId: string;
  feedstockTypeId: string;
  reactorId: string;
  productionRunId: string;
  productId: string;
  orderId: string;
  deliveryId: string;
  applicationIds: string[];
  batchIds: string[];
  measurementIds: string[];
}

async function createDeleteFixture(runId: string): Promise<DeleteFixture> {
  const [customer] = await db
    .insert(customers)
    .values({ name: `Delete Test Customer ${runId}`, code: `CU-DEL-${runId}` })
    .returning({ id: customers.id });

  const [formulation] = await db
    .insert(formulations)
    .values({ name: `Delete Test Formulation ${runId}`, code: `FM-DEL-${runId}` })
    .returning({ id: formulations.id });

  // ADR 0016: a credit batch is single-feedstock (NOT NULL feedstockTypeId), so
  // the fixture needs a feedstock type even though this delete test ignores
  // feedstock semantics.
  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      name: `Delete Test Feedstock ${runId}`,
      code: `FT-DEL-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });

  const [facility] = await db
    .insert(facilities)
    .values({ name: `Delete Test Facility ${runId}`, code: `FAC-DEL-${runId}` })
    .returning({ id: facilities.id });

  const [reactor] = await db
    .insert(reactors)
    .values({
      code: `RE-DEL-${runId}`,
      facilityId: facility.id,
      identifier: `Delete Test Reactor ${runId}`,
      reactorType: "fixed-bed",
    })
    .returning({ id: reactors.id });

  const [productionRun] = await db
    .insert(productionRuns)
    .values({
      code: `PR-DEL-${runId}`,
      facilityId: facility.id,
      reactorId: reactor.id,
      date: "2025-06-15",
      startTime: new Date("2025-06-15T08:00:00Z"),
      endTime: new Date("2025-06-15T12:00:00Z"),
      biocharDryMassKg: 10_000,
    })
    .returning({ id: productionRuns.id });

  const [product] = await db
    .insert(biocharProducts)
    .values({
      code: `BP-DEL-${runId}`,
      facilityId: facility.id,
      formulationId: formulation.id,
      linkedProductionRunId: productionRun.id,
    })
    .returning({ id: biocharProducts.id });

  const [order] = await db
    .insert(orders)
    .values({
      code: `OR-DEL-${runId}`,
      facilityId: facility.id,
      biocharProductId: product.id,
      customerId: customer.id,
      orderDate: new Date("2025-06-01"),
      quantityKg: 1000,
      packaging: "bagged",
    })
    .returning({ id: orders.id });

  const [delivery] = await db
    .insert(deliveries)
    .values({
      code: `DL-DEL-${runId}`,
      facilityId: facility.id,
      orderId: order.id,
      deliveryDate: new Date("2025-06-10"),
      deliveredWetMassKg: 10_000,
    })
    .returning({ id: deliveries.id });

  return {
    facilityId: facility.id,
    customerId: customer.id,
    formulationId: formulation.id,
    feedstockTypeId: feedstockType.id,
    reactorId: reactor.id,
    productionRunId: productionRun.id,
    productId: product.id,
    orderId: order.id,
    deliveryId: delivery.id,
    applicationIds: [],
    batchIds: [],
    measurementIds: [],
  };
}

async function cleanupDeleteFixture(fixture: DeleteFixture): Promise<void> {
  await db.transaction(async (tx) => {
    if (fixture.measurementIds.length > 0) {
      await tx
        .delete(soilTemperatureMeasurements)
        .where(inArray(soilTemperatureMeasurements.id, fixture.measurementIds));
    }

    if (fixture.batchIds.length > 0) {
      await tx
        .delete(creditBatchProductionRuns)
        .where(inArray(creditBatchProductionRuns.creditBatchId, fixture.batchIds));
      await tx
        .delete(creditBatchApplications)
        .where(inArray(creditBatchApplications.creditBatchId, fixture.batchIds));
      await tx
        .delete(creditBatches)
        .where(inArray(creditBatches.id, fixture.batchIds));
    }

    if (fixture.applicationIds.length > 0) {
      await tx
        .delete(applications)
        .where(inArray(applications.id, fixture.applicationIds));
    }

    await tx.delete(deliveries).where(eq(deliveries.id, fixture.deliveryId));
    await tx.delete(orders).where(eq(orders.id, fixture.orderId));
    await tx.delete(biocharProducts).where(eq(biocharProducts.id, fixture.productId));
    await tx
      .delete(productionRuns)
      .where(eq(productionRuns.id, fixture.productionRunId));
    await tx.delete(reactors).where(eq(reactors.id, fixture.reactorId));
    await tx.delete(formulations).where(eq(formulations.id, fixture.formulationId));
    await tx.delete(customers).where(eq(customers.id, fixture.customerId));
    await tx.delete(facilities).where(eq(facilities.id, fixture.facilityId));
    await tx
      .delete(feedstockTypes)
      .where(eq(feedstockTypes.id, fixture.feedstockTypeId));
  });
}

async function createApplicationRecord(
  fixture: DeleteFixture,
  suffix: string,
  values: {
    biocharAppliedTons: number;
    biocharAppliedDryTons: number;
    co2eStoredTonnes: number | null;
  },
): Promise<string> {
  const [application] = await db
    .insert(applications)
    .values({
      code: `AP-DEL-${suffix}`,
      deliveryId: fixture.deliveryId,
      applicationDate: new Date("2025-06-15"),
      biocharAppliedTons: values.biocharAppliedTons,
      biocharAppliedDryTons: values.biocharAppliedDryTons,
      co2eStoredTonnes: values.co2eStoredTonnes,
    })
    .returning({ id: applications.id });

  fixture.applicationIds.push(application.id);
  return application.id;
}

async function createMeasurementRecord(
  fixture: DeleteFixture,
  applicationId: string,
): Promise<string> {
  const [measurement] = await db
    .insert(soilTemperatureMeasurements)
    .values({
      applicationId,
      measurementDate: "2025-06-15",
      temperatureC: 24,
    })
    .returning({ id: soilTemperatureMeasurements.id });

  fixture.measurementIds.push(measurement.id);
  return measurement.id;
}

async function createCreditBatchRecord(
  fixture: DeleteFixture,
  runId: string,
  status: "draft" | "pending" | "verified" | "issued" | "rejected",
  fields?: {
    weightTons?: number | null;
    totalCo2eStoredTons?: number | null;
    totalCo2eEmissionsTons?: number | null;
    totalCo2eCounterfactualTons?: number | null;
    fDurableCalculated?: number | null;
  },
): Promise<string> {
  const [creditBatch] = await db
    .insert(creditBatches)
    .values({
      code: `CB-DEL-${runId}-${status.toUpperCase()}`,
      facilityId: fixture.facilityId,
      feedstockTypeId: fixture.feedstockTypeId,
      status,
      startDate: "2025-06-01",
      endDate: "2025-06-30",
      certifier: "isometric",
      durabilityOption: "200_year",
      hToCorgRatio: 0.4,
      weightTons: fields?.weightTons ?? null,
      totalCo2eStoredTons: fields?.totalCo2eStoredTons ?? null,
      totalCo2eEmissionsTons: fields?.totalCo2eEmissionsTons ?? null,
      totalCo2eCounterfactualTons: fields?.totalCo2eCounterfactualTons ?? null,
      fDurableCalculated: fields?.fDurableCalculated ?? null,
    })
    .returning({ id: creditBatches.id });

  fixture.batchIds.push(creditBatch.id);

  await db.insert(creditBatchProductionRuns).values({
    creditBatchId: creditBatch.id,
    productionRunId: fixture.productionRunId,
  });

  return creditBatch.id;
}

describe("deleteApplication", () => {
  it("refreshes draft or pending credit batch summaries after removing a linked application", async () => {
    const runId = `${crypto.randomUUID()}-pending`;
    const fixture = await createDeleteFixture(runId);

    try {
      const deletedApplicationId = await createApplicationRecord(fixture, `${runId}-A`, {
        biocharAppliedTons: 5,
        biocharAppliedDryTons: 4.5,
        co2eStoredTonnes: 3.6,
      });
      await createApplicationRecord(fixture, `${runId}-B`, {
        biocharAppliedTons: 2,
        biocharAppliedDryTons: 1.8,
        co2eStoredTonnes: 1.4,
      });

      await createMeasurementRecord(fixture, deletedApplicationId);

      const creditBatchId = await createCreditBatchRecord(
        fixture,
        runId,
        "pending",
        {
          weightTons: 7,
          totalCo2eStoredTons: 5,
          totalCo2eEmissionsTons: 0.5,
          totalCo2eCounterfactualTons: 0.2,
          fDurableCalculated: 0.85,
        },
      );

      await deleteApplication(TEST_USER_ID, deletedApplicationId);
      fixture.applicationIds = fixture.applicationIds.filter((id) => id !== deletedApplicationId);
      fixture.measurementIds = [];

      const [remainingApplication] = await db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.id, deletedApplicationId));

      const productionRunLinks = await db
        .select({ productionRunId: creditBatchProductionRuns.productionRunId })
        .from(creditBatchProductionRuns)
        .where(eq(creditBatchProductionRuns.creditBatchId, creditBatchId));

      const remainingMeasurements = await db
        .select({ id: soilTemperatureMeasurements.id })
        .from(soilTemperatureMeasurements)
        .where(eq(soilTemperatureMeasurements.applicationId, deletedApplicationId));

      const [updatedBatch] = await db
        .select({
          weightTons: creditBatches.weightTons,
          totalCo2eStoredTons: creditBatches.totalCo2eStoredTons,
          totalCo2eEmissionsTons: creditBatches.totalCo2eEmissionsTons,
          totalCo2eCounterfactualTons: creditBatches.totalCo2eCounterfactualTons,
          fDurableCalculated: creditBatches.fDurableCalculated,
        })
        .from(creditBatches)
        .where(eq(creditBatches.id, creditBatchId));

      expect(remainingApplication).toBeUndefined();
      expect(productionRunLinks).toEqual([{ productionRunId: fixture.productionRunId }]);
      expect(remainingMeasurements).toHaveLength(0);
      expect(updatedBatch).toEqual({
        weightTons: 2,
        totalCo2eStoredTons: 1.4,
        totalCo2eEmissionsTons: null,
        totalCo2eCounterfactualTons: null,
        fDurableCalculated: null,
      });
    } finally {
      await cleanupDeleteFixture(fixture);
    }
  });

  it("blocks deletion when the application is linked to an issued credit batch", async () => {
    const runId = `${crypto.randomUUID()}-issued`;
    const fixture = await createDeleteFixture(runId);

    try {
      const applicationId = await createApplicationRecord(fixture, `${runId}-A`, {
        biocharAppliedTons: 5,
        biocharAppliedDryTons: 4.5,
        co2eStoredTonnes: 3.6,
      });
      await createCreditBatchRecord(fixture, runId, "issued", {
        weightTons: 5,
        totalCo2eStoredTons: 3.6,
        totalCo2eEmissionsTons: 0.5,
        totalCo2eCounterfactualTons: 0.2,
        fDurableCalculated: 0.85,
      });

      await expect(
        deleteApplication(TEST_USER_ID, applicationId),
      ).rejects.toThrow("Cannot delete application linked to verified or issued credit batches");

      const [applicationStillPresent] = await db
        .select({ id: applications.id })
        .from(applications)
        .where(eq(applications.id, applicationId));

      const remainingLinks = await db
        .select({ productionRunId: creditBatchProductionRuns.productionRunId })
        .from(creditBatchProductionRuns)
        .where(eq(creditBatchProductionRuns.productionRunId, fixture.productionRunId));

      expect(applicationStillPresent).toEqual({ id: applicationId });
      expect(remainingLinks).toHaveLength(1);
    } finally {
      await cleanupDeleteFixture(fixture);
    }
  });
});
