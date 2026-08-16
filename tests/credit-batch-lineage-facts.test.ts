import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  biocharProductSourceAllocations,
  biocharProducts,
  creditBatchApplications,
  creditBatchProductionRuns,
  creditBatches,
  customers,
  certificationSubmissions,
  certifierRemovals,
  deliveries,
  facilities,
  feedstocks,
  feedstockTypes,
  orders,
  productionProcesses,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  storageLocations,
} from "@/db/schema";
import { loadCreditBatchAccounting } from "@/data-access/credit-batch-accounting";
import { loadCreditBatchRollups } from "@/data-access/credit-batch-accounting";
import { getCreditBatchById } from "@/data-access/credit-batches";
import {
  createRemovalWithCreditBatches,
  listProductionClaimDraftContenders,
} from "@/data-access/certifier-removals";
import { reconcileUnassignedCreditBatchApplicationSlices } from "@/data-access/credit-batch-application-slices";
import { getCreditBatchChainData } from "@/data-access/chain-of-custody-batch";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("credit batch accounting", () => {
  it("keeps multi-application Roll-up projections aligned behind one deep read", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const applicationIds: string[] = [];
    const removalIds: string[] = [];
    const [facility] = await db.insert(facilities).values({ organizationId: TEST_ORG_ID, code: `LF-F-${tag}`, name: `Lineage ${tag}` }).returning();
    const [sourceBin] = await db.insert(storageLocations).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, code: `LF-SL-${tag}`, name: `Source ${tag}`, type: "biochar_bin" }).returning();
    const [reactor] = await db.insert(reactors).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, code: `LF-R-${tag}`, identifier: `Lineage ${tag}`, reactorType: "fixed-bed" }).returning();
    const [feedstockType] = await db.insert(feedstockTypes).values({ organizationId: TEST_ORG_ID, code: `LF-FT-${tag}`, name: `Lineage ${tag}`, category: "forestry" }).returning();
    const [process] = await db.insert(productionProcesses).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id }).returning();
    const runs = await db.insert(productionRuns).values([1, 2].map((n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, reactorId: reactor.id, code: `LF-PR${n}-${tag}`, startTime: new Date(`2026-07-0${n}T10:00:00Z`), feedstockMassDryKg: 2_400 * n, biocharDryMassKg: 100 * n }))).returning();
    const stocks = await db.insert(feedstocks).values(runs.map((run, n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id, code: `LF-FS${n}-${tag}`, status: "complete" as const, massDryKg: 200, eligibilityStatus: "eligible" as const }))).returning();
    await db.insert(productionRunFeedstocks).values(runs.map((run, n) => ({ organizationId: TEST_ORG_ID, productionRunId: run.id, feedstockId: stocks[n].id, wetMassUsedKg: 100 })));
    const products = await db.insert(biocharProducts).values(runs.map((run, n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, code: `LF-BP${n}-${tag}`, linkedProductionRunId: run.id, massKg: 100 }))).returning();
    const [multiRunProduct] = await db.insert(biocharProducts).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, code: `LF-BPM-${tag}`, sourceBiocharStorageLocationId: sourceBin.id, linkedProductionRunId: null, massKg: 400 }).returning();
    const allocationRows = await db.insert(biocharProductSourceAllocations).values([
      { organizationId: TEST_ORG_ID, biocharProductId: multiRunProduct.id, productionRunId: runs[0].id, sourceStorageLocationId: sourceBin.id, allocatedWetMassKg: 50, allocatedDryMassKg: 40 },
      { organizationId: TEST_ORG_ID, biocharProductId: multiRunProduct.id, productionRunId: runs[1].id, sourceStorageLocationId: sourceBin.id, allocatedWetMassKg: 150, allocatedDryMassKg: 60 },
    ]).returning();
    const [customer] = await db.insert(customers).values({ organizationId: TEST_ORG_ID, code: `LF-C-${tag}`, name: `Lineage ${tag}` }).returning();
    const ordersRows = await db.insert(orders).values(products.map((product, n) => ({ organizationId: TEST_ORG_ID, facilityId: facility.id, customerId: customer.id, biocharProductId: product.id, code: `LF-O${n}-${tag}`, orderDate: new Date("2026-07-03"), quantityKg: 100, packaging: "loose" as const }))).returning();
    const deliveryRows = await db.insert(deliveries).values([
      { organizationId: TEST_ORG_ID, facilityId: facility.id, orderId: ordersRows[1].id, biocharProductId: products[0].id, code: `LF-D1-${tag}`, deliveryDate: new Date("2026-07-04"), deliveredWetMassKg: 10 },
      { organizationId: TEST_ORG_ID, facilityId: facility.id, orderId: ordersRows[1].id, code: `LF-D2-${tag}`, deliveryDate: new Date("2026-07-04"), deliveredWetMassKg: 20 },
    ]).returning();
    const appRows = await db.insert(applications).values(deliveryRows.map((delivery, n) => ({ organizationId: TEST_ORG_ID, deliveryId: delivery.id, code: `LF-A${n}-${tag}`, applicationDate: new Date(`2026-08-1${n}T00:00:00Z`), biocharAppliedTons: n + 1, biocharAppliedDryTons: n + 0.5 }))).returning();
    const [multiRunOrder] = await db.insert(orders).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, customerId: customer.id, biocharProductId: multiRunProduct.id, code: `LF-OM-${tag}`, orderDate: new Date("2026-07-03"), quantityKg: 400, packaging: "loose" }).returning();
    const [multiRunDelivery] = await db.insert(deliveries).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, orderId: multiRunOrder.id, biocharProductId: multiRunProduct.id, code: `LF-DM-${tag}`, deliveryDate: new Date("2026-07-04"), deliveredWetMassKg: 400, massDryKg: 200 }).returning();
    const [multiRunApplication] = await db.insert(applications).values({ organizationId: TEST_ORG_ID, deliveryId: multiRunDelivery.id, code: `LF-AM-${tag}`, applicationDate: new Date("2026-08-12T00:00:00Z"), biocharAppliedTons: 4, biocharAppliedDryTons: 2 }).returning();
    const [batch] = await db.insert(creditBatches).values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id, productionProcessId: process.id, code: `LF-CB-${tag}`, startDate: "2026-07-01", endDate: "2026-07-31" }).returning();
    await db.insert(creditBatchProductionRuns).values(runs.map((run) => ({ organizationId: TEST_ORG_ID, creditBatchId: batch.id, productionRunId: run.id })));
    await db.insert(creditBatchApplications).values([
      { organizationId: TEST_ORG_ID, creditBatchId: batch.id, applicationId: appRows[0].id, allocatedWetMassKg: 1_000, allocatedDryMassKg: 500 },
      { organizationId: TEST_ORG_ID, creditBatchId: batch.id, applicationId: appRows[1].id, allocatedWetMassKg: 2_000, allocatedDryMassKg: 1_500 },
      { organizationId: TEST_ORG_ID, creditBatchId: batch.id, applicationId: multiRunApplication.id, allocatedWetMassKg: 4_000, allocatedDryMassKg: 2_000 },
    ]);
    applicationIds.push(
      ...appRows.map((application) => application.id),
      multiRunApplication.id,
    );

    try {
      const accounting = (
        await loadCreditBatchAccounting(makeTestOrgContext(), [batch.id])
      )[batch.id];
      const facts = accounting.lineageFacts;
      const detail = await getCreditBatchById(makeTestOrgContext(), batch.id, { skipPreview: true });
      const chain = await getCreditBatchChainData(makeTestOrgContext(), batch.id);
      expect(facts.productionRunIds).toHaveLength(2);
      expect(facts.runs.map((run) => run.feedstockMassDryKg).sort((a, b) => Number(a) - Number(b))).toEqual([2_400, 4_800]);
      expect(facts.applicationIds).toHaveLength(3);
      expect(facts.appliedWeightTons).toBe(7);
      expect(
        facts.applications.find((application) => application.id === appRows[0].id)
          ?.biocharProduct.id,
      ).toBe(products[0].id);
      expect(
        facts.applications.find((application) => application.id === appRows[1].id)
          ?.biocharProduct.id,
      ).toBe(products[1].id);
      const multiRunSlices = facts.applications.filter(
        (application) => application.id === multiRunApplication.id,
      );
      expect(multiRunSlices).toHaveLength(2);
      expect(
        multiRunSlices
          .map((application) => ({
            runId: application.biocharProduct.linkedProductionRunId,
            wetTons: application.biocharAppliedTons,
            dryTons: application.biocharAppliedDryTons,
          }))
          .sort((left, right) => left.runId.localeCompare(right.runId)),
      ).toEqual(
        [
          { runId: runs[0].id, wetTons: 1, dryTons: 0.8 },
          { runId: runs[1].id, wetTons: 3, dryTons: 1.2 },
        ].sort((left, right) => left.runId.localeCompare(right.runId)),
      );
      expect(detail?.applicationIds.sort()).toEqual(facts.applicationIds.sort());
      expect(detail?.productionRunIds.sort()).toEqual(facts.productionRunIds.sort());
      expect(detail?.appliedWeightTons).toBe(facts.appliedWeightTons);
      expect(accounting.appliedWeightTons).toBe(facts.appliedWeightTons);
      expect(accounting.feedstockType).toEqual({
        id: feedstockType.id,
        name: feedstockType.name,
        usage: "pyrolysis",
        isometricFeedstockTypeId: null,
      });
      expect(accounting.co2ePreview.co2eStoredTonnes).toBeNull();
      expect(
        chain.lineages.filter(
          (lineage) => lineage.applicationId === multiRunApplication.id,
        ).map((lineage) => lineage.chain.productionRun?.id).sort(),
      ).toEqual(runs.map((run) => run.id).sort());
      expect(chain.sankey.columns.length).toBeGreaterThan(0);

      const ctx = makeTestOrgContext();
      const foreignCtx = {
        ...ctx,
        organizationId: `org-foreign-${tag}`,
      };
      await expect(
        loadCreditBatchRollups(foreignCtx, [batch.id]),
      ).resolves.toEqual({});
      const slicesBeforeForeignWrite = await db
        .select({
          applicationId: creditBatchApplications.applicationId,
          allocatedWetMassKg: creditBatchApplications.allocatedWetMassKg,
          allocatedDryMassKg: creditBatchApplications.allocatedDryMassKg,
          removalId: creditBatchApplications.removalId,
        })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.creditBatchId, batch.id));
      await db.transaction((tx) =>
        reconcileUnassignedCreditBatchApplicationSlices(foreignCtx, tx, {
          applicationIds: [appRows[0].id],
        }),
      );
      const slicesAfterForeignWrite = await db
        .select({
          applicationId: creditBatchApplications.applicationId,
          allocatedWetMassKg: creditBatchApplications.allocatedWetMassKg,
          allocatedDryMassKg: creditBatchApplications.allocatedDryMassKg,
          removalId: creditBatchApplications.removalId,
        })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.creditBatchId, batch.id));
      expect(slicesAfterForeignWrite).toEqual(slicesBeforeForeignWrite);
      await expect(
        createRemovalWithCreditBatches(foreignCtx, facility.id, [batch.id]),
      ).rejects.toThrow("no longer exist");
      const firstRemovalId = await createRemovalWithCreditBatches(
        ctx,
        facility.id,
        [batch.id],
      );
      removalIds.push(firstRemovalId);
      const firstFrozen = (
        await loadCreditBatchRollups(ctx, [batch.id], {
          removalId: firstRemovalId,
        })
      )[batch.id].lineageFacts;
      const [laterApplication] = await db
        .insert(applications)
        .values({
          organizationId: TEST_ORG_ID,
          deliveryId: deliveryRows[0].id,
          code: `LF-A-LATER-${tag}`,
          applicationDate: new Date("2026-06-20T00:00:00Z"),
          biocharAppliedTons: 0.25,
          biocharAppliedDryTons: 0.125,
        })
        .returning();
      applicationIds.push(laterApplication.id);
      await db.transaction((tx) =>
        reconcileUnassignedCreditBatchApplicationSlices(ctx, tx, {
          applicationIds: [laterApplication.id],
        }),
      );
      const secondRemovalId = await createRemovalWithCreditBatches(
        ctx,
        facility.id,
        [batch.id],
      );
      removalIds.push(secondRemovalId);
      const firstAfterSecond = (
        await loadCreditBatchRollups(ctx, [batch.id], {
          removalId: firstRemovalId,
        })
      )[batch.id].lineageFacts;
      const secondFrozen = (
        await loadCreditBatchRollups(ctx, [batch.id], {
          removalId: secondRemovalId,
        })
      )[batch.id].lineageFacts;
      expect(firstAfterSecond.applicationIds).toEqual(firstFrozen.applicationIds);
      expect(firstAfterSecond.appliedWeightTons).toBe(firstFrozen.appliedWeightTons);
      expect(secondFrozen.applicationIds).toEqual([laterApplication.id]);
      expect(secondFrozen.appliedWeightTons).toBe(0.25);

      const draftRows = await db
        .insert(certificationSubmissions)
        .values([
          {
            organizationId: TEST_ORG_ID,
            provider: "isometric" as const,
            submissionType: "removal",
            localEntityType: "removal",
            localEntityId: firstRemovalId,
            version: 1,
            status: "draft" as const,
            createdAt: new Date("2026-08-01T00:00:00Z"),
            lockedAt: new Date(),
          },
          {
            organizationId: TEST_ORG_ID,
            provider: "isometric" as const,
            submissionType: "removal",
            localEntityType: "removal",
            localEntityId: secondRemovalId,
            version: 1,
            status: "draft" as const,
            createdAt: new Date("2026-08-02T00:00:00Z"),
            lockedAt: new Date(),
          },
        ])
        .returning({ id: certificationSubmissions.id });
      const contenders = await listProductionClaimDraftContenders(ctx, [batch.id]);
      expect(contenders.map((contender) => contender.removalId)).toEqual([
        secondRemovalId,
        firstRemovalId,
      ]);
      await db.delete(certificationSubmissions).where(
        inArray(
          certificationSubmissions.id,
          draftRows.map((row) => row.id),
        ),
      );
    } finally {
      await db.delete(certificationSubmissions).where(
        inArray(certificationSubmissions.localEntityId, removalIds),
      );
      await db.delete(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, batch.id));
      await db.delete(certifierRemovals).where(inArray(certifierRemovals.id, removalIds));
      await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, batch.id));
      await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
      await db.delete(applications).where(inArray(applications.id, applicationIds));
      await db.delete(deliveries).where(inArray(deliveries.id, [...deliveryRows.map((row) => row.id), multiRunDelivery.id]));
      await db.delete(orders).where(inArray(orders.id, [...ordersRows.map((row) => row.id), multiRunOrder.id]));
      await db.delete(biocharProductSourceAllocations).where(inArray(biocharProductSourceAllocations.id, allocationRows.map((row) => row.id)));
      await db.delete(biocharProducts).where(inArray(biocharProducts.id, [...products.map((row) => row.id), multiRunProduct.id]));
      await db.delete(productionRunFeedstocks).where(inArray(productionRunFeedstocks.productionRunId, runs.map((row) => row.id)));
      await db.delete(feedstocks).where(inArray(feedstocks.id, stocks.map((row) => row.id)));
      await db.delete(productionRuns).where(inArray(productionRuns.id, runs.map((row) => row.id)));
      await db.delete(productionProcesses).where(eq(productionProcesses.id, process.id));
      await db.delete(reactors).where(eq(reactors.id, reactor.id));
      await db.delete(customers).where(eq(customers.id, customer.id));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockType.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, sourceBin.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
