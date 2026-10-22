import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  applications,
  certificationSubmissions,
  certifierGhgStatements,
  certifierRemovals,
  creditBatchApplications,
  creditBatchProductionRuns,
  creditBatches,
  samples,
} from "@/db/schema";
import { deleteCreditBatch } from "@/data-access/credit-batches";
import { getRecordLock } from "@/data-access/certification-lineage-guards";
import { withLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const remote = vi.hoisted(() => ({
  status: "FAILED_VERIFICATION",
  submitted_at: "2026-10-01T12:00:00Z",
  ghg_entry_ids: [] as string[],
}));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => remote }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));

beforeAll(() => ensureTestOrg());

async function prepareDeletableBatch(fixture: LineageFixture) {
  // Remove the fixture's independent Sample blocker. It has no emissions entries.
  await db.delete(samples).where(and(eq(samples.organizationId, TEST_ORG_ID), eq(samples.id, fixture.sampleId)));
  const [batch] = await db.select().from(creditBatches).where(and(
    eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, fixture.batchId),
  ));
  return batch;
}

async function expectMembershipRetained(fixture: LineageFixture) {
  const [batch] = await db.select().from(creditBatches).where(and(
    eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, fixture.batchId),
  ));
  expect(batch).toBeDefined();
  const slices = await db.select().from(creditBatchApplications).where(and(
    eq(creditBatchApplications.organizationId, TEST_ORG_ID), eq(creditBatchApplications.creditBatchId, fixture.batchId),
  ));
  expect(slices).toMatchObject([{ applicationId: fixture.applicationId, removalId: fixture.removalId,
    allocatedWetMassKg: 200, allocatedDryMassKg: 190 }]);
  const members = await db.select().from(creditBatchProductionRuns).where(and(
    eq(creditBatchProductionRuns.organizationId, TEST_ORG_ID), eq(creditBatchProductionRuns.creditBatchId, fixture.batchId),
  ));
  expect(members).toMatchObject([{ productionRunId: fixture.productionRunId }]);
  const [removal] = await db.select().from(certifierRemovals).where(and(
    eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId),
  ));
  expect(removal).toBeDefined();
}

describe("credit batch deletion preserves Isometric's Removal membership", () => {
  it.each([
    ["FAILED_VERIFICATION", "submitted"],
    ["DRAFT", "accepted"],
    ["FAILED_VERIFICATION", "superseded"],
    ["FAILED_VERIFICATION", "rejected"],
  ] as const)("refuses deletion after a fresh %s return of a %s attempt with a remote identity", async (status, attemptStatus) => {
    await withLineageFixture(async fixture => {
      const ctx = makeTestOrgContext();
      const batch = await prepareDeletableBatch(fixture);
      const suffix = randomUUID();
      const removalExternalId = `entry-delete-${suffix}`;
      const [statement] = await db.insert(certifierGhgStatements).values({
        organizationId: TEST_ORG_ID, facilityId: fixture.facilityId, reportingPeriodEndOn: "2026-06-30",
      }).returning();
      fixture.ghgStatementId = statement.id;
      await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(and(
        eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId),
      ));
      await db.insert(certificationSubmissions).values([
        { organizationId: TEST_ORG_ID, provider: "isometric", localEntityType: "removal",
          localEntityId: fixture.removalId, submissionType: "removal", version: 1, status: attemptStatus,
          externalId: removalExternalId, submittedAt: new Date("2026-09-30T12:00:00Z") },
        { organizationId: TEST_ORG_ID, provider: "isometric", localEntityType: "removal",
          localEntityId: fixture.removalId, submissionType: "removal", version: 2, status: "rejected" },
        { organizationId: TEST_ORG_ID, provider: "isometric", localEntityType: "ghgStatement",
          localEntityId: statement.id, submissionType: "ghg_statement", version: 1, status: "submitted",
          externalId: `statement-delete-${suffix}`, submittedAt: new Date(remote.submitted_at),
          metadata: { remoteStatus: status, removalIds: [removalExternalId] } },
      ]);
      remote.status = status;
      remote.ghg_entry_ids = [removalExternalId];

      const lock = await db.transaction(tx => getRecordLock(ctx, tx, { entityType: "creditBatch", entityId: batch.id }));
      expect(lock.level).toBe("inUse");
      expect(lock.returnedBy).toMatchObject([{ removalId: fixture.removalId }]);
      const [removal] = await db.select().from(certifierRemovals).where(and(
        eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId),
      ));
      await expect(deleteCreditBatch(ctx, batch.id, batch.version)).rejects.toMatchObject({
        code: "certification_locked",
        message: `Credit batch ${batch.code} is in Removal ${removal.code}, which was sent to Isometric. Correct its records, then resubmit Removal ${removal.code}.`,
      });
      await expectMembershipRetained(fixture);
    }, "none");
  });

  it.each([false, true])("allows deletion for a never-sent draft Removal (failed local attempt: %s)", async failedAttempt => {
    await withLineageFixture(async fixture => {
      const batch = await prepareDeletableBatch(fixture);
      if (failedAttempt) {
        await db.insert(certificationSubmissions).values({
          organizationId: TEST_ORG_ID, provider: "isometric", localEntityType: "removal",
          localEntityId: fixture.removalId, submissionType: "removal", version: 1, status: "rejected",
        });
      }
      await expect(deleteCreditBatch(makeTestOrgContext(), batch.id, batch.version)).resolves.toBeUndefined();
      expect(await db.select().from(creditBatches).where(and(
        eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.id, batch.id),
      ))).toEqual([]);
      expect(await db.select().from(creditBatchApplications).where(and(
        eq(creditBatchApplications.organizationId, TEST_ORG_ID), eq(creditBatchApplications.creditBatchId, batch.id),
      ))).toEqual([]);
      const [application] = await db.select().from(applications).where(and(
        eq(applications.organizationId, TEST_ORG_ID), eq(applications.id, fixture.applicationId),
      ));
      expect(application).toBeDefined();
    }, "none");
  });

  it("still refuses deletion while the Removal is Sent", async () => {
    await withLineageFixture(async fixture => {
      const ctx = makeTestOrgContext();
      const batch = await prepareDeletableBatch(fixture);
      await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID, provider: "isometric", localEntityType: "removal",
        localEntityId: fixture.removalId, submissionType: "removal", version: 1, status: "submitted",
        externalId: `entry-sent-delete-${randomUUID()}`, submittedAt: new Date("2026-09-30T12:00:00Z"),
      });
      expect((await db.transaction(tx => getRecordLock(ctx, tx, {
        entityType: "creditBatch", entityId: batch.id,
      }))).level).toBe("sent");
      await expect(deleteCreditBatch(ctx, batch.id, batch.version)).rejects.toMatchObject({
        code: "certification_locked", message: expect.stringContaining("is locked by a certification submission"),
      });
      await expectMembershipRetained(fixture);
    }, "none");
  });
});
