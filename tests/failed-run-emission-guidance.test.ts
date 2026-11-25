import { beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creditBatches, feedstocks, feedstockTypes, productionRunFeedstocks, productionRuns } from "@/db/schema";
import { loadFacilityFailedEmissionTodos } from "@/data-access/failed-run-emission-guidance";
import { getProductionRunCreditBatchPreview } from "@/data-access/production-run-credit-batch-preview";
import { getEmissionAllocation } from "@/data-access/emission-allocation";
import { NOT_YET } from "@/types/emission-allocation";
import { failedRunFixture } from "./helpers/failed-run-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const ROLLBACK = new Error("rollback failed guidance fixture");
beforeAll(() => ensureTestOrg());

it("reads a saved unresolved note, keeps activity Not yet, and resolves without saving the run again", async () => {
  await expect(db.transaction(async tx => {
    const f = await failedRunFixture(tx, { batch: false });
    const ctx = makeTestOrgContext();
    const input = { savedOnly: true, productionRunId: f.run.id, facilityId: f.facility.id,
      status: "failed" as const, startTime: null, endTime: null, feedstockStorageLocationIds: [] };
    const preview = await getProductionRunCreditBatchPreview(ctx, input, tx);
    expect(preview.savedEmissionAttachment).toMatchObject({ state: "no-match", productionRunId: f.run.id,
      runCode: f.run.code, endDay: "2026-03-01", feedstockTypeName: f.type.name, batch: null });
    expect(preview.savedEmissionAttachment?.message).toContain("is saved");
    const todos = await loadFacilityFailedEmissionTodos(ctx, f.facility.id, tx);
    expect(todos).toHaveLength(1);
    expect(todos[0].emissionAttachment).toEqual(preview.savedEmissionAttachment);
    expect(todos[0].target.href).toContain("/credit-batches?facility=");
    const [anchor] = await tx.insert(creditBatches).values({ ...f.batchValues, code: `FR-APRIL-${crypto.randomUUID()}`, startDate: "2026-04-01", endDate: "2026-04-30" }).returning();
    const allocation = await getEmissionAllocation(ctx, { creditBatchId: anchor.id }, tx);
    expect(allocation.records.find(record => record.id === f.run.id)?.parts).toMatchObject([{ key: NOT_YET, fraction: 1 }]);
    const [batch] = await tx.insert(creditBatches).values(f.batchValues).returning();
    expect((await getProductionRunCreditBatchPreview(ctx, input, tx)).savedEmissionAttachment).toMatchObject({
      state: "attached", batch: { id: batch.id, code: batch.code },
    });
    expect(await loadFacilityFailedEmissionTodos(ctx, f.facility.id, tx)).toEqual([]);
    expect((await tx.select().from(productionRuns).where(eq(productionRuns.id, f.run.id)))[0]).toEqual(f.run);
    expect(await loadFacilityFailedEmissionTodos({ ...ctx, organizationId: "foreign-org" }, f.facility.id, tx)).toEqual([]);
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});

it("reports mixed provenance rather than choosing a matching type, and distinguishes empty provenance", async () => {
  await expect(db.transaction(async tx => {
    const f = await failedRunFixture(tx);
    const [type] = await tx.insert(feedstockTypes).values({ ...f.org, code: `FR-MIX-${crypto.randomUUID()}`, name: "Other type", usage: "pyrolysis", category: "forestry" }).returning();
    const [stock] = await tx.insert(feedstocks).values({ ...f.stock, id: undefined, code: `FR-MIX-${crypto.randomUUID()}`, feedstockTypeId: type.id }).returning();
    await tx.insert(productionRunFeedstocks).values({ ...f.org, productionRunId: f.run.id, feedstockId: stock.id, wetMassUsedKg: 1 });
    const ctx = makeTestOrgContext();
    const [mixed] = await loadFacilityFailedEmissionTodos(ctx, f.facility.id, tx);
    expect(mixed.emissionAttachment.state).toBe("mixed-feedstock");
    expect(mixed.detail).toContain("more than one feedstock type");
    expect(mixed.target.href).toContain("/production-runs?");
    await tx.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, f.run.id));
    expect((await loadFacilityFailedEmissionTodos(ctx, f.facility.id, tx))[0].emissionAttachment.state).toBe("empty-feedstock");
    throw ROLLBACK;
  })).rejects.toBe(ROLLBACK);
});
