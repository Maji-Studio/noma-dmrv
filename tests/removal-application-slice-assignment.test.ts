import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProductSourceAllocations,
  biocharProducts,
  certificationSubmissions,
  certifierGhgStatements,
  certifierRemovals,
  certifierSyncEvents,
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
import {
  createRemovalWithCreditBatches,
  discardLocalRemovalDraft,
} from "@/data-access/certifier-removals";
import { reconcileUnassignedCreditBatchApplicationSlices } from "@/data-access/credit-batch-application-slices";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("Removal Application-slice assignment", () => {
  it("enforces 1000-year grouping and safely recovers a local draft", async () => {
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
    let secondRemovalId: string | null = null;
    let laterBatchId: string | null = null;
    let submissionId: string | null = null;
    let ghgStatementId: string | null = null;
    let auditRemovalId: string | null = null;
    try {
      const ctx = makeTestOrgContext();
      await db.transaction((tx) =>
        reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
          applicationIds: [application.id],
        }),
      );

      await expect(
        createRemovalWithCreditBatches(
          ctx,
          facility.id,
          batches.map((batch) => batch.id),
        ),
      ).rejects.toThrow(/1000-year Removal can contain one credit batch/i);
      const removalsAfter1000YearRejection = await db
        .select({ id: certifierRemovals.id })
        .from(certifierRemovals)
        .where(eq(certifierRemovals.facilityId, facility.id));
      expect(removalsAfter1000YearRejection).toEqual([]);
      const slicesAfter1000YearRejection = await db
        .select({ removalId: creditBatchApplications.removalId })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id));
      expect(
        slicesAfter1000YearRejection.every((slice) => slice.removalId == null),
      ).toBe(true);

      removalId = await createRemovalWithCreditBatches(ctx, facility.id, [
        batches[0].id,
      ]);
      secondRemovalId = await createRemovalWithCreditBatches(ctx, facility.id, [
        batches[1].id,
      ]);
      const separatelyAssigned = await db
        .select({
          creditBatchId: creditBatchApplications.creditBatchId,
          removalId: creditBatchApplications.removalId,
        })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id))
        .orderBy(creditBatchApplications.creditBatchId);
      expect(new Map(separatelyAssigned.map((slice) => [slice.creditBatchId, slice.removalId]))).toEqual(
        new Map([
          [batches[0].id, removalId],
          [batches[1].id, secondRemovalId],
        ]),
      );

      await expect(
        discardLocalRemovalDraft(ctx, facility.id, removalId),
      ).resolves.toEqual({ releasedSliceCount: 1 });
      removalId = null;
      await expect(
        discardLocalRemovalDraft(ctx, facility.id, secondRemovalId),
      ).resolves.toEqual({ releasedSliceCount: 1 });
      secondRemovalId = null;

      await db
        .update(facilities)
        .set({ durabilityOption: "200_year" })
        .where(eq(facilities.id, facility.id));

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

      await db.insert(certifierSyncEvents).values({
        organizationId: TEST_ORG_ID,
        provider: "isometric",
        entityType: "removal",
        entityId: removalId,
        operation: "removal:protocol-version-check",
        status: "succeeded",
      });
      auditRemovalId = removalId;

      await expect(
        discardLocalRemovalDraft(ctx, crypto.randomUUID(), removalId),
      ).rejects.toThrow(/cannot be discarded/i);
      await expect(
        discardLocalRemovalDraft(
          { ...ctx, organizationId: "org_without_access" },
          facility.id,
          removalId,
        ),
      ).rejects.toThrow(/cannot be discarded/i);

      const [ghgStatement] = await db
        .insert(certifierGhgStatements)
        .values({
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          reportingPeriodEndOn: "2026-06-30",
        })
        .returning({ id: certifierGhgStatements.id });
      ghgStatementId = ghgStatement.id;
      await db
        .update(certifierRemovals)
        .set({ ghgStatementId })
        .where(eq(certifierRemovals.id, removalId));
      await expect(
        discardLocalRemovalDraft(ctx, facility.id, removalId),
      ).rejects.toThrow(/cannot be discarded/i);
      await db
        .update(certifierRemovals)
        .set({ ghgStatementId: null })
        .where(eq(certifierRemovals.id, removalId));
      await db
        .delete(certifierGhgStatements)
        .where(eq(certifierGhgStatements.id, ghgStatementId));
      ghgStatementId = null;

      const [submission] = await db
        .insert(certificationSubmissions)
        .values({
          organizationId: TEST_ORG_ID,
          provider: "isometric",
          submissionType: "removal",
          localEntityType: "removal",
          localEntityId: removalId,
          version: 1,
          status: "draft",
        })
        .returning({ id: certificationSubmissions.id });
      submissionId = submission.id;
      await db
        .update(creditBatches)
        .set({ productionEmissionsClaimReservedBySubmissionId: submission.id })
        .where(eq(creditBatches.id, batches[0].id));

      await expect(
        discardLocalRemovalDraft(ctx, facility.id, removalId),
      ).rejects.toThrow(/cannot be discarded/i);
      const [preservedReservation] = await db
        .select({
          reservationId:
            creditBatches.productionEmissionsClaimReservedBySubmissionId,
        })
        .from(creditBatches)
        .where(eq(creditBatches.id, batches[0].id));
      expect(preservedReservation.reservationId).toBe(submission.id);
      const stillAssigned = await db
        .select({ removalId: creditBatchApplications.removalId })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id));
      expect(
        stillAssigned.filter((slice) => slice.removalId === removalId),
      ).toHaveLength(2);
      expect(
        stillAssigned.filter((slice) => slice.removalId === null),
      ).toHaveLength(1);

      await db
        .update(creditBatches)
        .set({ productionEmissionsClaimReservedBySubmissionId: null })
        .where(eq(creditBatches.id, batches[0].id));
      await db
        .delete(certificationSubmissions)
        .where(eq(certificationSubmissions.id, submission.id));
      submissionId = null;

      await expect(
        discardLocalRemovalDraft(ctx, facility.id, removalId),
      ).resolves.toEqual({ releasedSliceCount: 2 });
      const releasedSlices = await db
        .select({ removalId: creditBatchApplications.removalId })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id));
      expect(releasedSlices.every((slice) => slice.removalId === null)).toBe(
        true,
      );
      const discardedRemoval = await db
        .select({ id: certifierRemovals.id })
        .from(certifierRemovals)
        .where(eq(certifierRemovals.id, removalId));
      expect(discardedRemoval).toEqual([]);
      const retainedAudit = await db
        .select({ id: certifierSyncEvents.id })
        .from(certifierSyncEvents)
        .where(eq(certifierSyncEvents.entityId, auditRemovalId));
      expect(retainedAudit).toHaveLength(1);
      removalId = null;
    } finally {
      if (ghgStatementId) {
        if (removalId) {
          await db
            .update(certifierRemovals)
            .set({ ghgStatementId: null })
            .where(eq(certifierRemovals.id, removalId));
        }
        await db
          .delete(certifierGhgStatements)
          .where(eq(certifierGhgStatements.id, ghgStatementId));
      }
      if (submissionId) {
        await db
          .update(creditBatches)
          .set({ productionEmissionsClaimReservedBySubmissionId: null })
          .where(eq(creditBatches.facilityId, facility.id));
        await db
          .delete(certificationSubmissions)
          .where(eq(certificationSubmissions.id, submissionId));
      }
      await db
        .delete(creditBatchApplications)
        .where(eq(creditBatchApplications.applicationId, application.id));
      if (removalId) {
        await db
          .delete(certifierRemovals)
          .where(eq(certifierRemovals.id, removalId));
      }
      if (secondRemovalId) {
        await db
          .delete(certifierRemovals)
          .where(eq(certifierRemovals.id, secondRemovalId));
      }
      if (auditRemovalId) {
        await db
          .delete(certifierSyncEvents)
          .where(eq(certifierSyncEvents.entityId, auditRemovalId));
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
