import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  biocharProductSourceAllocations, creditBatchProductionRuns, creditBatches, deliveries,
  outputStockAllocations, outputStockRunAllocations, productionRunFeedstockDraws,
  productionRunFeedstocks, productionRuns, transportLegs,
} from "@/db/schema";
import { getEmissionAllocation } from "@/data-access/emission-allocation";
import { loadBatchesEmissionAutomaticFacts } from "@/data-access/batch-emission-automatic-figures";
import type { EmissionAllocation, GroupKey } from "@/types/emission-allocation";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const DISTANCE_KM = 10;
const FEEDSTOCK_KG = 1_000;
const FIRST_DRAW_KG = 600;
const SECOND_DRAW_KG = 400;
const HALF_LOAD_WET_KG = 150;
const HALF_LOAD_DRY_KG = 142.5;
const EXPECTED_FEEDSTOCK_TONNE_KM = 20;
const EXPECTED_DELIVERY_PART_TONNE_KM = 3;
const ROLLBACK = new Error("rollback allocation parity fixture");
const ctx = makeTestOrgContext();

beforeAll(() => ensureTestOrg());

function batchTransport(allocation: EmissionAllocation, creditBatchId: string, group: GroupKey) {
  return allocation.records.filter(record => record.group === group).reduce((total, record) => {
    const fraction = record.parts.filter(part => part.key === creditBatchId).reduce((sum, part) => sum + part.fraction, 0);
    if (!fraction) return total;
    const quantity = record.quantities.find(quantity => quantity.unit === "t·km");
    expect(quantity?.value).not.toBeNull();
    return total + fraction * quantity!.value!;
  }, 0);
}

describe("allocation transport parity with the Emissions tab (real database)", () => {
  it("counts the first batch's whole feedstock leg and splits a shared delivery across both batches", async () => {
    await withLineageFixture(async fixture => {
      await expect(db.transaction(async tx => {
        const org = { organizationId: TEST_ORG_ID };
        const site = { ...org, facilityId: fixture.facilityId };
        await tx.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
          .where(and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, fixture.productionRunId)));
        await tx.update(productionRunFeedstocks).set({ wetMassUsedKg: FIRST_DRAW_KG })
          .where(and(eq(productionRunFeedstocks.organizationId, ctx.organizationId), eq(productionRunFeedstocks.productionRunId, fixture.productionRunId)));
        await tx.update(productionRunFeedstockDraws).set({ wetMassKg: FIRST_DRAW_KG })
          .where(and(eq(productionRunFeedstockDraws.organizationId, ctx.organizationId), eq(productionRunFeedstockDraws.productionRunId, fixture.productionRunId)));
        const [laterRun] = await tx.insert(productionRuns).values({ ...site, reactorId: fixture.reactorId,
          code: `E2E-ALLOC-PR-${crypto.randomUUID()}`, startTime: new Date("2026-06-14T08:00:00Z"), endTime: new Date("2026-06-14T12:00:00Z"),
          status: "complete", feedstockWetMassKg: SECOND_DRAW_KG, feedstockMassDryKg: SECOND_DRAW_KG,
          biocharStorageLocationId: fixture.biocharBinId, biocharOutputKg: HALF_LOAD_WET_KG,
          biocharMoisturePercent: 5, biocharDryMassKg: HALF_LOAD_DRY_KG }).returning();
        const [laterBatch] = await tx.insert(creditBatches).values({ ...site, code: `E2E-ALLOC-CB-${crypto.randomUUID()}`,
          feedstockTypeId: fixture.feedstockTypeId, productionProcessId: fixture.productionProcessId,
          startDate: "2026-06-01", endDate: "2026-06-30" }).returning();
        await tx.insert(creditBatchProductionRuns).values({ ...org, creditBatchId: laterBatch.id, productionRunId: laterRun.id });
        await tx.insert(productionRunFeedstocks).values({ ...org, productionRunId: laterRun.id, feedstockId: fixture.feedstockId, wetMassUsedKg: SECOND_DRAW_KG });
        await tx.insert(productionRunFeedstockDraws).values({ ...org, productionRunId: laterRun.id, storageLocationId: fixture.feedstockBinId, wetMassKg: SECOND_DRAW_KG });
        await tx.insert(transportLegs).values({ ...org, entityType: "feedstock", entityId: fixture.feedstockId,
          distanceKm: DISTANCE_KM, loadMassKg: FEEDSTOCK_KG, transportMethodType: "road" });
        await tx.update(deliveries).set({ recordedDistanceKm: DISTANCE_KM, recordedDistanceSource: "manual" })
          .where(and(eq(deliveries.organizationId, ctx.organizationId), eq(deliveries.id, fixture.deliveryId)));
        // Keep both the product's saved source weights and the shipped layer's
        // frozen source shares balanced; no allocator or automatic figure is mocked.
        await tx.insert(biocharProductSourceAllocations).values([fixture.productionRunId, laterRun.id].map(productionRunId => ({
          ...org, biocharProductId: fixture.productId, productionRunId, sourceStorageLocationId: fixture.biocharBinId,
          allocatedWetMassKg: HALF_LOAD_WET_KG, allocatedDryMassKg: HALF_LOAD_DRY_KG,
        }))).onConflictDoUpdate({ target: [biocharProductSourceAllocations.biocharProductId, biocharProductSourceAllocations.productionRunId],
          set: { allocatedWetMassKg: HALF_LOAD_WET_KG, allocatedDryMassKg: HALF_LOAD_DRY_KG } });
        const [layer] = await tx.select().from(outputStockAllocations).where(and(
          eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.deliveryId, fixture.deliveryId)));
        await tx.update(outputStockRunAllocations).set({ dryMassKg: String(HALF_LOAD_DRY_KG) }).where(and(
          eq(outputStockRunAllocations.organizationId, ctx.organizationId), eq(outputStockRunAllocations.allocationId, layer.id)));
        await tx.insert(outputStockRunAllocations).values({ ...org, allocationId: layer.id, productionRunId: laterRun.id, dryMassKg: String(HALF_LOAD_DRY_KG) });

        const batchIds = [fixture.batchId, laterBatch.id];
        const allocation = await getEmissionAllocation(ctx, { creditBatchId: fixture.batchId }, tx);
        const automatic = await loadBatchesEmissionAutomaticFacts(ctx, batchIds, {}, tx);
        expect(allocation.batches.map(batch => batch.id).sort()).toEqual([...batchIds].sort());
        expect(allocation.records.filter(record => record.group === "deliveryTransport")).toHaveLength(1);
        expect(allocation.records.find(record => record.id === fixture.feedstockId)?.feedstock?.used)
          .toEqual(expect.arrayContaining([expect.objectContaining({ creditBatchId: laterBatch.id, kg: SECOND_DRAW_KG })]));
        for (const [index, batchId] of batchIds.entries()) {
          for (const [group, source] of [["feedstockTransport", "feedstock-transport"], ["deliveryTransport", "delivery-transport"]] as const) {
            const figure = automatic[batchId].automaticFigures[source];
            expect(figure).not.toBeNull();
            expect(batchTransport(allocation, batchId, group)).toBeCloseTo(Number(figure!.magnitude));
          }
          expect(batchTransport(allocation, batchId, "feedstockTransport")).toBe(index === 0 ? EXPECTED_FEEDSTOCK_TONNE_KM : 0);
          expect(batchTransport(allocation, batchId, "deliveryTransport")).toBe(EXPECTED_DELIVERY_PART_TONNE_KM);
        }
        expect(await getEmissionAllocation(ctx, { removalId: fixture.removalId }, tx)).toEqual(allocation);
        await expect(getEmissionAllocation({ ...ctx, organizationId: `foreign-${crypto.randomUUID()}` }, { creditBatchId: fixture.batchId }, tx))
          .rejects.toThrow("Credit batch or Removal was not found.");
        throw ROLLBACK;
      })).rejects.toBe(ROLLBACK);
    }, "none");
  });
});
