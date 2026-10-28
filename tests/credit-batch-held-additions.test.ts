import { and, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  activityEvents, applicationOutputAllocations, certificationSubmissions, certifierRemovals, creditBatchApplications, creditBatchProductionRuns,
  creditBatches, facilities, productionRunFeedstocks, productionRuns,
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
const SHARED_APPLICATION_WET_MASS_KG = "100";
const SHARED_APPLICATION_DRY_MASS_KG = "95";
const ctx = makeTestOrgContext();
beforeAll(() => ensureTestOrg());

async function withMissedRun(
  test: (f: LineageFixture, runId: string, batch: typeof creditBatches.$inferSelect) => Promise<void>,
  mode: "none" | "removal" | "ghgStatement" = "none",
) {
  await withLineageFixture(async f => {
    await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
      .where(eq(productionRuns.id, f.productionRunId));
    await withUnassignedRun(f, async runId => {
      const [batch] = await db.select().from(creditBatches).where(eq(creditBatches.id, f.batchId));
      await test(f, runId, batch);
    });
  }, mode);
}

const MISSED_RUN_START = "2026-06-14T08:00:00Z";
const SECOND_MISSED_RUN_START = "2026-06-14T13:00:00Z";
const MISSED_RUN_HOURS = 4;
const HOUR_MS = 3_600_000;

async function withUnassignedRun(f: LineageFixture, test: (runId: string) => Promise<void>, start = MISSED_RUN_START) {
  const startTime = new Date(start);
  const [original] = await db.select().from(productionRuns).where(eq(productionRuns.id, f.productionRunId));
  // Direct fixture insertion models a legacy run that missed automatic attachment.
  const [run] = await db.insert(productionRuns).values({
    ...original, id: crypto.randomUUID(), stockPostingSequence: undefined, code: `PR-MISSED-${crypto.randomUUID()}`,
    startTime, endTime: new Date(startTime.getTime() + MISSED_RUN_HOURS * HOUR_MS),
  }).returning();
  await db.insert(productionRunFeedstocks).values({
    organizationId: TEST_ORG_ID, productionRunId: run.id, feedstockId: f.feedstockId, wetMassUsedKg: MISSED_RUN_WET_MASS_KG,
  });
  try { await test(run.id); }
  finally {
    await db.delete(activityEvents).where(eq(activityEvents.creditBatchId, f.batchId));
    await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.productionRunId, run.id));
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id));
    await db.delete(productionRuns).where(eq(productionRuns.id, run.id));
  }
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
  it("refuses an added run allocated to an application slice held by a draft Removal without changing saved state", async () => {
    await withMissedRun(async (f, runId, batch) => {
      const [originalShare] = await db.select().from(applicationOutputAllocations)
        .where(eq(applicationOutputAllocations.applicationId, f.applicationId));
      // Split the existing 200 kg wet / 190 kg dry application across A and B.
      // Its assigned slice still describes A only, before B joins the batch.
      await db.update(applicationOutputAllocations).set({
        wetMassKg: SHARED_APPLICATION_WET_MASS_KG, dryMassKg: SHARED_APPLICATION_DRY_MASS_KG,
      }).where(eq(applicationOutputAllocations.id, originalShare.id));
      await db.update(creditBatchApplications).set({
        allocatedWetMassKg: Number(SHARED_APPLICATION_WET_MASS_KG), allocatedDryMassKg: Number(SHARED_APPLICATION_DRY_MASS_KG),
      }).where(eq(creditBatchApplications.creditBatchId, batch.id));
      const [addedShare] = await db.insert(applicationOutputAllocations).values({
        ...originalShare, id: crypto.randomUUID(), productionRunId: runId,
        wetMassKg: SHARED_APPLICATION_WET_MASS_KG, dryMassKg: SHARED_APPLICATION_DRY_MASS_KG,
      }).returning();
      const readState = () => Promise.all([
        db.select().from(creditBatches).where(eq(creditBatches.id, batch.id)),
        db.select().from(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, batch.id))
          .orderBy(creditBatchProductionRuns.productionRunId),
        db.select().from(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, batch.id))
          .orderBy(creditBatchApplications.id),
        db.select().from(applicationOutputAllocations).where(eq(applicationOutputAllocations.applicationId, f.applicationId))
          .orderBy(applicationOutputAllocations.id),
        db.select().from(activityEvents).where(eq(activityEvents.creditBatchId, batch.id)).orderBy(activityEvents.id),
      ]);
      try {
        const before = await readState();
        await expect(updateCreditBatch(ctx, batch.id, {
          expectedVersion: batch.version, productionRunIds: [f.productionRunId, runId],
        })).rejects.toMatchObject({ code: "certification_locked" });
        expect(await readState()).toEqual(before);
      } finally {
        await db.delete(applicationOutputAllocations).where(eq(applicationOutputAllocations.id, addedShare.id));
      }
    });
  });

  it("adds only the requested missed run and leaves another matching run unassigned", async () => {
    await withMissedRun(async (f, runId, batch) => {
      await withUnassignedRun(f, async unrequestedRunId => {
        await updateCreditBatch(ctx, batch.id, {
          expectedVersion: batch.version, productionRunIds: [f.productionRunId, runId],
        });
        const members = await db.select().from(creditBatchProductionRuns)
          .where(eq(creditBatchProductionRuns.creditBatchId, batch.id));
        expect(members.map(member => member.productionRunId).sort()).toEqual([f.productionRunId, runId].sort());
        expect(await db.select().from(creditBatchProductionRuns)
          .where(eq(creditBatchProductionRuns.productionRunId, unrequestedRunId))).toEqual([]);
        const options = await getCreditBatchProductionRunOptions(ctx, {
          facilityId: f.facilityId, startDate: batch.startDate, endDate: batch.endDate, includeCreditBatchId: batch.id,
        });
        expect(options).toContainEqual(expect.objectContaining({ id: unrequestedRunId, assignedCreditBatchId: null }));
      }, SECOND_MISSED_RUN_START);
    });
  });

  it.each([
    { durabilityOption: "200_year", outcome: "refuses" },
    { durabilityOption: "1000_year", outcome: "accepts" },
  ] as const)("$outcome an added run whose Application is held through another batch at $durabilityOption", async ({ durabilityOption }) => {
    await withMissedRun(async (f, runId, batch) => {
      await db.update(facilities).set({ durabilityOption }).where(and(
        eq(facilities.id, f.facilityId), eq(facilities.organizationId, TEST_ORG_ID),
      ));
      await withLineageFixture(async other => {
        const [originalShare] = await db.select().from(applicationOutputAllocations)
          .where(eq(applicationOutputAllocations.applicationId, other.applicationId));
        // Application X keeps half its mass in B2's held slice; the missed
        // run supplies the other half without yet belonging to any batch.
        await db.update(applicationOutputAllocations).set({
          wetMassKg: SHARED_APPLICATION_WET_MASS_KG, dryMassKg: SHARED_APPLICATION_DRY_MASS_KG,
        }).where(eq(applicationOutputAllocations.id, originalShare.id));
        await db.update(creditBatchApplications).set({
          allocatedWetMassKg: Number(SHARED_APPLICATION_WET_MASS_KG), allocatedDryMassKg: Number(SHARED_APPLICATION_DRY_MASS_KG),
        }).where(eq(creditBatchApplications.creditBatchId, other.batchId));
        const [addedShare] = await db.insert(applicationOutputAllocations).values({
          ...originalShare, id: crypto.randomUUID(), productionRunId: runId,
          wetMassKg: SHARED_APPLICATION_WET_MASS_KG, dryMassKg: SHARED_APPLICATION_DRY_MASS_KG,
        }).returning();
        const readState = () => Promise.all([
          db.select().from(creditBatches).where(inArray(creditBatches.id, [batch.id, other.batchId])).orderBy(creditBatches.id),
          db.select().from(creditBatchProductionRuns).where(inArray(creditBatchProductionRuns.creditBatchId, [batch.id, other.batchId]))
            .orderBy(creditBatchProductionRuns.productionRunId),
          db.select().from(creditBatchApplications).where(inArray(creditBatchApplications.creditBatchId, [batch.id, other.batchId]))
            .orderBy(creditBatchApplications.id),
          db.select().from(applicationOutputAllocations).where(inArray(applicationOutputAllocations.applicationId, [f.applicationId, other.applicationId]))
            .orderBy(applicationOutputAllocations.id),
          db.select().from(activityEvents).where(inArray(activityEvents.creditBatchId, [batch.id, other.batchId])).orderBy(activityEvents.id),
        ]);
        try {
          const before = await readState();
          if (durabilityOption === "200_year") {
            await expect(updateCreditBatch(ctx, batch.id, {
              expectedVersion: batch.version, productionRunIds: [f.productionRunId, runId],
            })).rejects.toMatchObject({ code: "certification_locked", message: expect.stringContaining("through another credit batch") });
            expect(await readState()).toEqual(before);
          } else {
            await expectAccepted(f, runId, batch);
            expect(await db.select().from(creditBatchApplications).where(and(
              eq(creditBatchApplications.creditBatchId, batch.id), eq(creditBatchApplications.applicationId, other.applicationId),
            ))).toEqual([expect.objectContaining({
              removalId: null, allocatedWetMassKg: Number(SHARED_APPLICATION_WET_MASS_KG),
              allocatedDryMassKg: Number(SHARED_APPLICATION_DRY_MASS_KG),
            })]);
            expect(await db.select().from(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, other.batchId)))
              .toEqual(before[2].filter(slice => slice.creditBatchId === other.batchId));
          }
        } finally {
          await db.delete(creditBatchApplications).where(and(
            eq(creditBatchApplications.creditBatchId, batch.id), eq(creditBatchApplications.applicationId, other.applicationId),
          ));
          await db.delete(applicationOutputAllocations).where(eq(applicationOutputAllocations.id, addedShare.id));
        }
      }, "none");
    });
  });

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
