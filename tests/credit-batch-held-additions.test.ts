import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  activityEvents, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatchProductionRuns,
  creditBatches, productionRunFeedstocks, productionRuns,
} from "@/db/schema";
import { getCreditBatchProductionRunOptions, updateCreditBatch } from "@/data-access/credit-batches";
import { withLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const remote = vi.hoisted(() => ({
  status: "FAILED_VERIFICATION", submitted_at: "2026-10-01T12:00:00Z", ghg_entry_ids: ["entry-missed"],
}));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => remote }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));
const MISSED_RUN_WET_MASS_KG = 100;
const ctx = makeTestOrgContext();
beforeAll(() => ensureTestOrg());

async function withMissedRun(
  test: (f: LineageFixture, runId: string, batch: typeof creditBatches.$inferSelect) => Promise<void>,
  mode: "none" | "removal" | "ghgStatement" = "none",
) {
  await withLineageFixture(async f => {
    await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
      .where(eq(productionRuns.id, f.productionRunId));
    const [original] = await db.select().from(productionRuns).where(eq(productionRuns.id, f.productionRunId));
    // Direct fixture insertion models a legacy run that missed automatic attachment.
    const [run] = await db.insert(productionRuns).values({
      ...original, id: crypto.randomUUID(), stockPostingSequence: undefined, code: `PR-MISSED-${crypto.randomUUID()}`,
      startTime: new Date("2026-06-14T08:00:00Z"), endTime: new Date("2026-06-14T12:00:00Z"),
    }).returning();
    await db.insert(productionRunFeedstocks).values({
      organizationId: TEST_ORG_ID, productionRunId: run.id, feedstockId: f.feedstockId, wetMassUsedKg: MISSED_RUN_WET_MASS_KG,
    });
    const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, f.batchId));
    try { await test(f, run.id, batch); }
    finally {
      await db.delete(activityEvents).where(eq(activityEvents.creditBatchId, f.batchId));
      await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.productionRunId, run.id));
      await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id));
      await db.delete(productionRuns).where(eq(productionRuns.id, run.id));
    }
  }, mode);
}

async function expectAccepted(f: LineageFixture, runId: string, batch: typeof creditBatches.$inferSelect) {
  const options = await getCreditBatchProductionRunOptions(ctx, {
    facilityId: f.facilityId, startDate: batch.startDate, endDate: batch.endDate, includeCreditBatchId: batch.id,
  });
  expect(options).toContainEqual(expect.objectContaining({ id: runId, status: "complete", assignedCreditBatchId: null,
    feedstockTypeIds: [f.feedstockTypeId] }));
  const saved = await updateCreditBatch(ctx, batch.id, {
    expectedVersion: batch.version, productionRunIds: [f.productionRunId, runId],
    facilityId: batch.facilityId, feedstockTypeId: batch.feedstockTypeId,
    startDate: new Date(batch.startDate), endDate: new Date(batch.endDate),
  });
  expect(saved.version).toBe(batch.version + 1);
  expect(await db.select().from(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, batch.id)))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ productionRunId: f.productionRunId }), expect.objectContaining({ productionRunId: runId }),
    ]));
  expect(await db.select().from(activityEvents).where(and(eq(activityEvents.creditBatchId, batch.id),
    eq(activityEvents.productionRunId, runId))))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ entityType: "production_run", reasonCode: "attached", source: "form", actorUserId: ctx.userId }),
      expect.objectContaining({ entityType: "credit_batch", action: "updated", source: "form" }),
    ]));
}

describe("manual additions to held credit batches", () => {
  it("adds a fitting missed run to a draft Removal, bumps version and records manual activity", async () => {
    await withMissedRun(expectAccepted);
  });

  it("adds to a returned Removal under fresh statement facts", async () => {
    await withMissedRun(async (f, runId, batch) => {
      await db.update(certificationSubmissions).set({ metadata: {
        remoteStatus: "FAILED_VERIFICATION", submittedToVerifierAt: remote.submitted_at, removalIds: ["entry-missed"],
      } }).where(eq(certificationSubmissions.localEntityId, f.ghgStatementId!));
      await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID, provider: "isometric", localEntityType: "removal", localEntityId: f.removalId,
        submissionType: "removal", version: 1, status: "submitted", externalId: "entry-missed",
        submittedAt: new Date("2026-09-30T12:00:00Z"),
      });
      await expectAccepted(f, runId, batch);
    }, "ghgStatement");
  });

  it("keeps Sent locked", async () => {
    await withMissedRun(async (f, runId, batch) => {
      await expect(updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version,
        productionRunIds: [f.productionRunId, runId] })).rejects.toMatchObject({ code: "certification_locked" });
    }, "removal");
  });

  it.each(["remove", "end-date", "unchanged"])("keeps the existing slice refusal for %s", async change => {
    await withMissedRun(async (f, runId, batch) => {
      await expect(updateCreditBatch(ctx, batch.id, {
        expectedVersion: batch.version,
        productionRunIds: change === "remove" ? [runId] : change === "unchanged" ? [f.productionRunId] : [f.productionRunId, runId],
        ...(change === "end-date" ? { endDate: new Date("2026-06-29") } : {}),
      })).rejects.toMatchObject({ code: "certification_locked",
        message: expect.stringContaining("Cannot change this credit batch's production membership because its applied mass belongs to a Removal.") });
      const [unchanged] = await db.select().from(creditBatches).where(eq(creditBatches.id, batch.id));
      expect(unchanged.version).toBe(batch.version);
    });
  });

  it.each(["outside-window", "other-feedstock", "another-batch", "archived", "incomplete"])("refuses a %s run", async failure => {
    await withMissedRun(async (f, runId, batch) => {
      let otherBatchId: string | undefined;
      if (failure === "outside-window") await db.update(productionRuns).set({ endTime: new Date("2026-07-01") }).where(eq(productionRuns.id, runId));
      if (failure === "archived") await db.update(productionRuns).set({ archivedAt: new Date() }).where(eq(productionRuns.id, runId));
      if (failure === "incomplete") await db.update(productionRuns).set({ status: "running", endTime: null }).where(eq(productionRuns.id, runId));
      if (failure === "other-feedstock") {
        // A second lineage supplies a valid foreign type without altering the current member.
        await withLineageFixture(async other => {
          await db.update(productionRunFeedstocks).set({ feedstockId: other.feedstockId }).where(eq(productionRunFeedstocks.productionRunId, runId));
          try {
            await expect(updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version,
              productionRunIds: [f.productionRunId, runId] })).rejects.toThrow(/feedstock/i);
          } finally {
            await db.update(productionRunFeedstocks).set({ feedstockId: f.feedstockId }).where(eq(productionRunFeedstocks.productionRunId, runId));
          }
        }, "none");
        return;
      }
      if (failure === "another-batch") {
        const [other] = await db.insert(creditBatches).values({ ...batch, id: crypto.randomUUID(),
          code: `CB-OTHER-${crypto.randomUUID()}`, startDate: "2026-07-01", endDate: "2026-07-31" }).returning();
        otherBatchId = other.id;
        await db.insert(creditBatchProductionRuns).values({ organizationId: TEST_ORG_ID, creditBatchId: other.id, productionRunId: runId });
      }
      try {
        const message = failure === "outside-window" ? /outside the credit batch production window/ :
          failure === "another-batch" ? /already assigned/ : failure === "incomplete" ? /not complete/ : /not found/;
        await expect(updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version,
          productionRunIds: [f.productionRunId, runId] })).rejects.toThrow(message);
      } finally {
        if (otherBatchId) {
          await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, otherBatchId));
          await db.delete(creditBatches).where(eq(creditBatches.id, otherBatchId));
        }
      }
    });
  });

  it("preserves free-batch membership refresh", async () => {
    await withMissedRun(async (f, runId, batch) => {
      await db.update(creditBatchApplications).set({ removalId: null }).where(eq(creditBatchApplications.creditBatchId, batch.id));
      await expectAccepted(f, runId, batch);
    });
  });

  it("refuses a concurrently locked Removal lineage instead of silently skipping the addition", async () => {
    await withMissedRun(async (f, runId, batch) => {
      await db.transaction(async tx => {
        await tx.select().from(certifierRemovals).where(eq(certifierRemovals.id, f.removalId)).for("update");
        await expect(updateCreditBatch(ctx, batch.id, { expectedVersion: batch.version,
          productionRunIds: [f.productionRunId, runId] })).rejects.toMatchObject({ code: "conflict", retryable: true });
      });
    });
  });
});
