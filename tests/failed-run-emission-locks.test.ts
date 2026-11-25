import { updateCreditBatch, deleteCreditBatch } from "@/data-access/credit-batches";
import { runOperation } from "@/lib/operations/runner";
import { updateProductionRun as updateRunOperation } from "@/lib/operations/production-runs";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { beforeAll, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, certifierRemovals, creditBatchProductionRuns, creditBatches, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns } from "@/db/schema";
import { updateProductionRun, deleteProductionRunInTransaction } from "@/data-access/production-runs/mutations";
import { getRecordLock } from "@/data-access/certification-lineage-guards";
import { loadRunEmissionContributors } from "@/data-access/credit-batch-emission-contributors";
import { withFailedRunLineage, FAILED_END } from "./helpers/failed-run-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const ctx = makeTestOrgContext();
const OUTSIDE_END = new Date("2026-07-01T12:00:00Z");
const remote = vi.hoisted(() => ({ status: "FAILED_VERIFICATION", submitted_at: "2026-10-01T12:00:00Z", ghg_entry_ids: ["ext-removal-123"] }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => remote }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));
beforeAll(() => ensureTestOrg());

it.each([false, true])("allows Running to Failed with an editable matching batch=%s", async matched => {
  await withFailedRunLineage(async (fixture, run) => {
    await db.update(productionRuns).set({ status: "running", endTime: null }).where(eq(productionRuns.id, run.id));
    if (!matched) await db.update(creditBatches).set({ endDate: "2026-06-13" }).where(eq(creditBatches.id, fixture.batchId));
    await updateProductionRun(ctx, run.id, { expectedVersion: run.version, status: "failed", endTime: FAILED_END });
    const [attachment] = await loadRunEmissionContributors(ctx, [run.id]);
    expect(attachment.creditBatchId).toBe(matched ? fixture.batchId : null);
    expect(await db.select().from(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.productionRunId, run.id))).toEqual([]);
  }, "none");
});

it("refuses Running to Failed into Sent and rolls back the outcome and draws", async () => {
  await withFailedRunLineage(async (fixture, run) => {
    await db.update(productionRuns).set({ status: "running", endTime: null }).where(eq(productionRuns.id, run.id));
    const draws = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, run.id));
    const [holder] = await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, fixture.removalId));
    await expect(updateProductionRun(ctx, run.id, { expectedVersion: run.version, status: "failed", endTime: FAILED_END,
      feedstockDraws: [{ storageLocationId: fixture.feedstockBinId, wetMassKg: 120 }],
    })).rejects.toMatchObject({ code: "certification_locked", message: expect.stringContaining(holder.code) });
    expect(await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, run.id))).toEqual(draws);
    const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(saved).toMatchObject({ status: "running", endTime: null, version: run.version });
  });
});

it.each([
  { dieselOperationLiters: 7 }, { electricityKwh: 8 }, { feedstockMoisturePercent: 12 },
  { endTime: OUTSIDE_END }, { status: "running" as const, endTime: null }, { code: "E2E-FAILED-RENAMED" },
])("refuses a Sent failed source edit %j", async changes => {
  await withFailedRunLineage(async (_fixture, run) => {
    const links = await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id));
    await expect(updateProductionRun(ctx, run.id, { expectedVersion: run.version, ...changes }))
      .rejects.toMatchObject({ code: "certification_locked" });
    const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(saved).toEqual(run);
    expect(await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id))).toEqual(links);
    const lock = await db.transaction(tx => getRecordLock(ctx, tx, { entityType: "productionRun", entityId: run.id }));
    expect(lock.level).toBe("sent");
  });
});

it("refuses moving an unclaimed failed source into Sent", async () => {
  await withFailedRunLineage(async (_fixture, run) => {
    await db.update(productionRuns).set({ endTime: OUTSIDE_END }).where(eq(productionRuns.id, run.id));
    expect((await loadRunEmissionContributors(ctx, [run.id]))[0].creditBatchId).toBeNull();
    await expect(updateProductionRun(ctx, run.id, { expectedVersion: run.version, endTime: FAILED_END }))
      .rejects.toMatchObject({ code: "certification_locked" });
    const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(saved.endTime).toEqual(OUTSIDE_END);
  });
});

it.each(["removal", "none"] as const)("deletion follows failed dependency holder %s", async holder => {
  await withFailedRunLineage(async (_fixture, run) => {
    const write = db.transaction(tx => deleteProductionRunInTransaction(ctx, tx, run.id, run.version, "form"));
    if (holder === "removal") await expect(write).rejects.toMatchObject({ code: "certification_locked" });
    else await write;
    expect((await db.select().from(productionRuns).where(eq(productionRuns.id, run.id))).length).toBe(holder === "removal" ? 1 : 0);
  }, holder);
});

it.each(["edit", "reopen"])("allows %s of an editable failed source", async action => {
  await withFailedRunLineage(async (_fixture, run) => {
    await updateProductionRun(ctx, run.id, { expectedVersion: run.version,
      ...(action === "edit" ? { dieselOperationLiters: 9 } : { status: "running" as const, endTime: null }),
    });
    const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(saved.version).toBe(run.version + 1);
    expect(saved.status).toBe(action === "edit" ? "failed" : "running");
  }, "none");
});

it("retains an older Sent attempt behind a newer rejected attempt", async () => {
  await withFailedRunLineage(async (fixture, run) => {
    await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: "isometric",
      submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId,
      version: 2, status: "rejected", metadata: { externalMutation: "none" },
    });
    await expect(updateProductionRun(ctx, run.id, { expectedVersion: run.version, electricityKwh: 10 }))
      .rejects.toMatchObject({ code: "certification_locked" });
  });
});

it("keeps unchanged Sent saves on the existing refusal/version policy", async () => {
  await withFailedRunLineage(async (_fixture, run) => {
    await expect(updateProductionRun(ctx, run.id, { expectedVersion: run.version, electricityKwh: run.electricityKwh }))
      .rejects.toMatchObject({ code: "certification_locked" });
    const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(saved.version).toBe(run.version);
  });
});

it("allows correction after a fresh evidenced statement return", async () => {
  await withFailedRunLineage(async (fixture, run) => {
    await db.update(certificationSubmissions).set({ metadata: {
      remoteStatus: "FAILED_VERIFICATION", submittedToVerifierAt: remote.submitted_at,
    } }).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
    await updateProductionRun(ctx, run.id, { expectedVersion: run.version, electricityKwh: 10 });
    const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, run.id));
    expect(saved.electricityKwh).toBe(10);
  }, "ghgStatement");
});

it("rolls back stock and activity when the operation enters a Sent cohort", async () => {
  await withFailedRunLineage(async (fixture, run) => {
    await db.update(productionRuns).set({ status: "running", endTime: null }).where(eq(productionRuns.id, run.id));
    const beforeStock = await deriveFeedstockWetStockKg(ctx, db, fixture.feedstockBinId);
    const activity = () => db.select().from(activityEvents).where(and(
      eq(activityEvents.organizationId, TEST_ORG_ID), eq(activityEvents.entityId, run.id),
    ));
    const beforeActivity = await activity();
    await expect(runOperation(updateRunOperation, ctx, {
      productionRunId: run.id, expectedVersion: run.version, status: "failed", endTime: FAILED_END,
      feedstockDraws: [{ storageLocationId: fixture.feedstockBinId, wetMassKg: 120 }],
    })).rejects.toMatchObject({ code: "certification_locked" });
    expect(await deriveFeedstockWetStockKg(ctx, db, fixture.feedstockBinId)).toBe(beforeStock);
    expect(await activity()).toEqual(beforeActivity);
  });
});

it.each(["window", "delete"])("refuses a Sent batch %s while failed contributions depend on it", async action => {
  await withFailedRunLineage(async (fixture, run) => {
    const [before] = await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId));
    const write = action === "delete"
      ? deleteCreditBatch(ctx, fixture.batchId, before.version)
      : updateCreditBatch(ctx, fixture.batchId, { expectedVersion: before.version, endDate: new Date("2026-06-13T00:00:00Z") });
    await expect(write).rejects.toMatchObject({ code: "certification_locked" });
    expect((await db.select().from(creditBatches).where(eq(creditBatches.id, fixture.batchId)))[0]).toEqual(before);
    expect((await loadRunEmissionContributors(ctx, [run.id]))[0].creditBatchId).toBe(fixture.batchId);
  });
});
