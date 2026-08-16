import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProductSourceAllocations,
  biocharProducts,
  certifierRemovals,
  creditBatchApplications,
  creditBatchProductionRuns,
  creditBatches,
  customers,
  deliveries,
  facilities,
  feedstockTypes,
  orders,
  productionProcesses,
  productionRuns,
  reactors,
  storageLocations,
} from "@/db/schema";
import { createRemovalWithCreditBatches } from "@/data-access/certifier-removals";
import { reconcileUnassignedCreditBatchApplicationSlices } from "@/data-access/credit-batch-application-slices";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("Removal Application-slice assignment", () => {
  it("rejects a partial batch selection instead of stranding a sibling slice", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `RAS-F-${tag}`,
        name: `Removal assignment ${tag}`,
      })
      .returning();
    const [sourceBin] = await db
      .insert(storageLocations)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `RAS-SL-${tag}`,
        name: `Removal assignment ${tag}`,
        type: "biochar_bin",
      })
      .returning();
    const [reactor] = await db
      .insert(reactors)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `RAS-R-${tag}`,
        identifier: `Removal assignment ${tag}`,
        reactorType: "fixed-bed",
      })
      .returning();
    const [feedstockType] = await db
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `RAS-FT-${tag}`,
        name: `Removal assignment ${tag}`,
        category: "forestry",
      })
      .returning();
    const [process] = await db
      .insert(productionProcesses)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
      })
      .returning();
    const runs = await db
      .insert(productionRuns)
      .values(
        [1, 2, 3].map((number) => ({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          reactorId: reactor.id,
          code: `RAS-PR${number}-${tag}`,
          status: "complete" as const,
          startTime: new Date(`2026-04-0${number}T08:00:00Z`),
          endTime: new Date(`2026-04-0${number}T12:00:00Z`),
          biocharDryMassKg: 100,
        })),
      )
      .returning();
    const [product] = await db
      .insert(biocharProducts)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        code: `RAS-BP-${tag}`,
        sourceBiocharStorageLocationId: sourceBin.id,
        massKg: 300,
      })
      .returning();
    await db.insert(biocharProductSourceAllocations).values(
      runs.map((run) => ({
        organizationId: TEST_ORG_ID,
        biocharProductId: product.id,
        productionRunId: run.id,
        sourceStorageLocationId: sourceBin.id,
        allocatedWetMassKg: 100,
        allocatedDryMassKg: 100,
      })),
    );
    const [customer] = await db
      .insert(customers)
      .values({
        organizationId: TEST_ORG_ID,
        code: `RAS-C-${tag}`,
        name: `Removal assignment ${tag}`,
      })
      .returning();
    const [order] = await db
      .insert(orders)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        customerId: customer.id,
        biocharProductId: product.id,
        code: `RAS-O-${tag}`,
        orderDate: new Date("2026-04-03T00:00:00Z"),
        quantityKg: 300,
        packaging: "loose",
      })
      .returning();
    const [delivery] = await db
      .insert(deliveries)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        orderId: order.id,
        biocharProductId: product.id,
        code: `RAS-D-${tag}`,
        deliveryDate: new Date("2026-04-04T00:00:00Z"),
        deliveredWetMassKg: 300,
        massDryKg: 300,
      })
      .returning();
    const [application] = await db
      .insert(applications)
      .values({
        organizationId: TEST_ORG_ID,
        deliveryId: delivery.id,
        code: `RAS-A-${tag}`,
        applicationDate: new Date("2026-04-05T00:00:00Z"),
        biocharAppliedTons: 0.3,
        biocharAppliedDryTons: 0.15,
      })
      .returning();
    const batches = await db
      .insert(creditBatches)
      .values(
        [1, 2].map((number) => ({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
          productionProcessId: process.id,
          code: `RAS-CB${number}-${tag}`,
          startDate: `2026-04-0${number}`,
          endDate: `2026-04-0${number}`,
        })),
      )
      .returning();
    await db.insert(creditBatchProductionRuns).values(
      batches.map((batch, index) => ({
        organizationId: TEST_ORG_ID,
        creditBatchId: batch.id,
        productionRunId: runs[index].id,
      })),
    );

    let removalId: string | null = null;
    let laterBatchId: string | null = null;
    try {
      const ctx = makeTestOrgContext();
      await db.transaction((tx) =>
        reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
          applicationIds: [application.id],
        }),
      );

      await expect(
        createRemovalWithCreditBatches(ctx, facility.id, [batches[0].id]),
      ).rejects.toThrow(/select every related credit batch/i);
      const afterRejectedSelection = await db
        .select({ removalId: creditBatchApplications.removalId })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id));
      expect(afterRejectedSelection).toHaveLength(2);
      expect(afterRejectedSelection.every((slice) => slice.removalId == null)).toBe(
        true,
      );

      removalId = await createRemovalWithCreditBatches(
        ctx,
        facility.id,
        batches.map((batch) => batch.id),
      );
      const assigned = await db
        .select({ removalId: creditBatchApplications.removalId })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id));
      expect(assigned).toEqual([{ removalId }, { removalId }]);

      const [laterBatch] = await db
        .insert(creditBatches)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          feedstockTypeId: feedstockType.id,
          productionProcessId: process.id,
          code: `RAS-CB3-${tag}`,
          startDate: "2026-04-03",
          endDate: "2026-04-03",
        })
        .returning();
      laterBatchId = laterBatch.id;
      await db.insert(creditBatchProductionRuns).values({
        organizationId: TEST_ORG_ID,
        creditBatchId: laterBatch.id,
        productionRunId: runs[2].id,
      });
      await db.transaction((tx) =>
        reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
          applicationIds: [application.id],
        }),
      );
      await expect(
        createRemovalWithCreditBatches(ctx, facility.id, [laterBatch.id]),
      ).rejects.toThrow(/already partly assigned to another Removal/i);
      const laterSlice = await db
        .select({ removalId: creditBatchApplications.removalId })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.creditBatchId, laterBatch.id));
      expect(laterSlice).toEqual([{ removalId: null }]);
    } finally {
      await db
        .delete(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id));
      if (removalId) {
        await db
          .delete(certifierRemovals)
          .where(eq(certifierRemovals.id, removalId));
      }
      await db
        .delete(creditBatchProductionRuns)
        .where(
          inArray(creditBatchProductionRuns.creditBatchId, [
            ...batches.map((b) => b.id),
            ...(laterBatchId ? [laterBatchId] : []),
          ]),
        );
      await db.delete(creditBatches).where(
        inArray(creditBatches.id, [
          ...batches.map((b) => b.id),
          ...(laterBatchId ? [laterBatchId] : []),
        ]),
      );
      await db.delete(applications).where(eq(applications.id, application.id));
      await db.delete(deliveries).where(eq(deliveries.id, delivery.id));
      await db.delete(orders).where(eq(orders.id, order.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db
        .delete(biocharProductSourceAllocations)
        .where(eq(biocharProductSourceAllocations.biocharProductId, product.id));
      await db.delete(biocharProducts).where(eq(biocharProducts.id, product.id));
      await db.delete(productionRuns).where(inArray(productionRuns.id, runs.map((r) => r.id)));
      await db.delete(productionProcesses).where(eq(productionProcesses.id, process.id));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(reactors).where(eq(reactors.id, reactor.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, sourceBin.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
