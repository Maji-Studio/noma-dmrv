import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  certifierGhgStatements,
  creditBatchApplications,
  creditBatchProductionRuns,
  certifierRemovals,
  certificationSubmissions,
  productionRuns,
} from "@/db/schema";
import { buildCreditBatchOpenItems } from "@/lib/credit-batches/open-items";
import { getCreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import * as creditBatchAccounting from "@/data-access/credit-batch-accounting";
import { markSubmissionSubmitted } from "@/data-access/certification";
import {
  REMOTE_PERIOD_END_ON_METADATA_KEY,
  REMOTE_PERIOD_MISSING_METADATA_KEY,
} from "@/data-access/certifier-ghg-statements";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import {
  insertOutputApplicationFixture,
  deleteOutputApplicationFixtures,
} from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("credit batch page model", () => {
  it("keeps the original snapshot when a Removal deletion commits after the rollup read", async () => {
    const fixture = await createLineageFixture("none");
    const loadRollups = creditBatchAccounting.loadCreditBatchRollups;
    const rollupRead = vi.spyOn(creditBatchAccounting, "loadCreditBatchRollups")
      .mockImplementationOnce(async (...args) => {
        const rollups = await loadRollups(...args);
        // The first read has established the snapshot. Commit the deletion on
        // another connection before allowing the remaining page reads to start.
        await db.transaction(async tx => {
          await tx.update(creditBatchApplications).set({ removalId: null })
            .where(and(eq(creditBatchApplications.organizationId, TEST_ORG_ID),
              eq(creditBatchApplications.removalId, fixture.removalId)));
          await tx.delete(certifierRemovals)
            .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID),
              eq(certifierRemovals.id, fixture.removalId)));
        });
        return rollups;
      });
    try {
      const model = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(rollupRead).toHaveBeenCalledOnce();
      expect(model.slices[0].removalId).toBe(fixture.removalId);
      expect(model.removals).toEqual([expect.objectContaining({ id: fixture.removalId, phase: "draft", dryKg: 190 })]);
      expect(model.mass).toMatchObject({
        appliedDryKg: 190, inSubmittedDryKg: 0, inDraftDryKg: 190, notInRemovalDryKg: 0,
      });

      const afterDeletion = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(afterDeletion.slices[0].removalId).toBeNull();
      expect(afterDeletion.removals).toEqual([]);
      expect(afterDeletion.mass).toMatchObject({
        appliedDryKg: 190, inSubmittedDryKg: 0, inDraftDryKg: 0, notInRemovalDryKg: 190,
      });
    } finally {
      rollupRead.mockRestore();
      await cleanupLineageFixture(fixture);
    }
  });

  it("excludes an interrupted submitted Removal from the first-submitted milestone", async () => {
    const fixture = await createLineageFixture("none");
    try {
      await db.update(certifierRemovals).set({ startedOn: "2026-06-01", completedOn: "2026-06-30" })
        .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId)));
      const submittedAt = new Date("2026-06-17T12:00:00Z");
      const [submission] = await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
        localEntityType: "removal", localEntityId: fixture.removalId, version: 1,
        status: "submitted", externalId: `page-${fixture.removalId}`,
        payloadHash: "interrupted", payloadSnapshot: {}, submittedAt,
        metadata: { lastAttemptOutcome: "interrupted" },
      }).returning({ id: certificationSubmissions.id });

      const model = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(model.removals[0]).toMatchObject({ phase: "draft", status: { kind: "interrupted" } });
      expect(model.mass).toMatchObject({ inDraftDryKg: 190, inSubmittedDryKg: 0 });
      expect(model.milestones).toMatchObject({ firstRemovalSubmittedAt: null, firstRemovalSubmittedCode: null });

      await db.update(certificationSubmissions).set({ metadata: {} })
        .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.id, submission.id)));
      const completedModel = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(completedModel.removals[0].phase).toBe("submitted");
      expect(completedModel.milestones).toMatchObject({
        firstRemovalSubmittedAt: submittedAt, firstRemovalSubmittedCode: completedModel.removals[0].code,
      });
    } finally {
      await cleanupLineageFixture(fixture);
    }
  });

  it("groups frozen slices by Removal, accounts in dry kg, and hides another organization's batch", async () => {
    const fixture = await createLineageFixture("none");
    const extraIds: string[] = [];
    let submittedId: string | undefined;
    let statementId: string | undefined;
    let extraRunId: string | undefined;
    try {
      const [submitted] = await insertRemovalFixture(db, {
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        startedOn: "2026-06-01",
        completedOn: "2026-06-30",
      });
      submittedId = submitted.id;
      const [draft] = await db.select()
        .from(certifierRemovals)
        .where(eq(certifierRemovals.id, fixture.removalId));
      const added = await insertOutputApplicationFixture(db,
        ["unassigned", "submitted"].map((suffix) => ({
          organizationId: TEST_ORG_ID,
          deliveryId: fixture.deliveryId,
          code: `PAGE-${suffix}-${fixture.batchId}`,
          applicationDate: new Date("2026-06-17"),
          fieldSizeHa: 1,
          fieldIdentifier: "North field",
          biocharAppliedTons: 0.1,
          biocharAppliedDryTons: 0.05,
        })),
        row => row,
      );
      extraIds.push(...added.map(row => row.id));
      await db.insert(creditBatchApplications).values(added.map((row, index) => ({
        organizationId: TEST_ORG_ID,
        creditBatchId: fixture.batchId,
        applicationId: row.id,
        allocatedWetMassKg: 100,
        allocatedDryMassKg: 40 + index * 10,
        removalId: index ? submitted.id : null,
      })));
      const submittedAt = new Date("2026-06-18T12:00:00Z");
      const [firstSubmission] = await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID,
        provider: "isometric",
        submissionType: "removal",
        localEntityType: "removal",
        localEntityId: submitted.id,
        version: 1,
        status: "submitted",
        externalId: `page-${submitted.id}`,
        payloadHash: "fixture",
        payloadSnapshot: {},
        submittedAt,
      }).returning({ id: certificationSubmissions.id });

      const model = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(model.slices).toHaveLength(3);
      expect(model.slices.find(row => row.applicationId === added[0].id)).toMatchObject({
        applicationCode: added[0].code,
        applicationDate: added[0].applicationDate,
        deliveryId: fixture.deliveryId,
        destinationLabel: "North field",
        wetKg: 100,
        dryKg: 40,
        removalId: null,
      });
      expect(model.removals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: draft.id,
          code: draft.code,
          phase: "draft",
          dryKg: 190,
          submittedAt: null,
        }),
        expect.objectContaining({
          id: submitted.id,
          code: submitted.code,
          phase: "submitted",
          status: expect.objectContaining({ kind: "submitted" }),
          dryKg: 50,
          submittedAt,
        }),
      ]));
      expect(model.mass).toEqual({
        producedDryKg: 285,
        appliedDryKg: 280,
        inSubmittedDryKg: 50,
        inDraftDryKg: 190,
        notInRemovalDryKg: 40,
        notAppliedDryKg: 5,
      });
      expect(model.milestones).toEqual({
        firstRemovalSubmittedAt: submittedAt,
        firstRemovalSubmittedCode: submitted.code,
        ghgStatement: null,
      });

      const [resubmission] = await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
        localEntityType: "removal", localEntityId: submitted.id, version: 2,
        status: "draft", payloadHash: "pending-v2", payloadSnapshot: {},
      }).returning({ id: certificationSubmissions.id });
      const pendingModel = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(pendingModel.removals.find(row => row.id === submitted.id)).toMatchObject({
        phase: "submitted", submittedAt, status: { kind: "not-submitted" },
      });
      expect(pendingModel.mass.inSubmittedDryKg).toBe(50);
      expect(pendingModel.milestones).toMatchObject({
        firstRemovalSubmittedAt: submittedAt, firstRemovalSubmittedCode: submitted.code,
      });

      await markSubmissionSubmitted(makeTestOrgContext(), resubmission.id, {
        externalId: `page-v2-${submitted.id}`,
        supersedePreviousId: firstSubmission.id,
      });
      const [superseded] = await db.select().from(certificationSubmissions)
        .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID),
          eq(certificationSubmissions.id, firstSubmission.id)));
      expect(superseded).toMatchObject({ status: "superseded", submittedAt });
      const finalizedModel = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(finalizedModel.removals.find(row => row.id === submitted.id)).toMatchObject({
        phase: "submitted", submittedAt, status: { kind: "submitted" },
      });
      expect(finalizedModel.milestones).toMatchObject({
        firstRemovalSubmittedAt: submittedAt, firstRemovalSubmittedCode: submitted.code,
      });

      const decimalSlices = [0.1, 0.7, 0.1];
      const applicationIds = [fixture.applicationId, ...extraIds];
      for (const [index, applicationId] of applicationIds.entries()) {
        await db.update(creditBatchApplications).set({ allocatedDryMassKg: decimalSlices[index] })
          .where(and(eq(creditBatchApplications.organizationId, TEST_ORG_ID),
            eq(creditBatchApplications.creditBatchId, fixture.batchId),
            eq(creditBatchApplications.applicationId, applicationId)));
      }
      await db.update(productionRuns).set({ biocharDryMassKg: 0.9 })
        .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, fixture.productionRunId)));
      const decimalModel = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(decimalModel.mass).toEqual({ producedDryKg: 0.9, appliedDryKg: 0.9,
        inSubmittedDryKg: 0.1, inDraftDryKg: 0.1, notInRemovalDryKg: 0.7, notAppliedDryKg: 0 });
      expect(buildCreditBatchOpenItems({
        facilityId: fixture.facilityId, creditBatchId: fixture.batchId, pageModel: decimalModel,
      }).waiting).toEqual([]);

      const [statement] = await db.insert(certifierGhgStatements).values({
        organizationId: TEST_ORG_ID,
        facilityId: fixture.facilityId,
        reportingPeriodEndOn: "2026-06-30",
      }).returning();
      statementId = statement.id;
      await db.update(certifierRemovals)
        .set({ ghgStatementId: statement.id })
        .where(eq(certifierRemovals.id, submitted.id));
      const submittedToVerifierAt = "2026-07-01T12:00:00Z";
      await db.insert(certificationSubmissions).values({
        organizationId: TEST_ORG_ID,
        provider: "isometric",
        submissionType: "ghg_statement",
        localEntityType: "ghgStatement",
        localEntityId: statement.id,
        version: 1,
        status: "submitted",
        externalId: `page-${statement.id}`,
        payloadHash: "fixture",
        payloadSnapshot: {},
        metadata: { remoteStatus: "AWAITING_VERIFICATION", submittedToVerifierAt },
      });
      const statementModel = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(statementModel.milestones.ghgStatement).toEqual({
        id: statement.id,
        reportingPeriodStartOn: null,
        reportingPeriodEndOn: "2026-06-30",
        hasMissingPeriod: false,
        status: "in-verification",
        submittedToVerifierAt,
        creditsIssuedAt: null,
      });

      await db.update(certifierGhgStatements).set({
        reportingPeriodStartOn: "2026-06-01",
        metadata: {
          [REMOTE_PERIOD_END_ON_METADATA_KEY]: "2026-07-31",
          [REMOTE_PERIOD_MISSING_METADATA_KEY]: true,
        },
      }).where(eq(certifierGhgStatements.id, statement.id));
      const updatedModel = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(updatedModel.milestones.ghgStatement).toMatchObject({
        reportingPeriodStartOn: "2026-06-01",
        reportingPeriodEndOn: "2026-07-31",
        hasMissingPeriod: true,
      });
      await expect(getCreditBatchPageModel({
        ...makeTestOrgContext(),
        organizationId: "another-org",
      }, fixture.batchId)).rejects.toMatchObject({ code: "not_found" });
      const [extraRun] = await db.insert(productionRuns).values({
        organizationId: TEST_ORG_ID, code: `PR-PAGE-${fixture.batchId}`,
        facilityId: fixture.facilityId, reactorId: fixture.reactorId,
        startTime: new Date("2026-06-14T08:00:00Z"), status: "running", biocharDryMassKg: 1,
      }).returning({ id: productionRuns.id });
      extraRunId = extraRun.id;
      await db.insert(creditBatchProductionRuns).values({ organizationId: TEST_ORG_ID,
        creditBatchId: fixture.batchId, productionRunId: extraRun.id });
      await db.update(productionRuns)
        .set({ biocharDryMassKg: null })
        .where(eq(productionRuns.id, fixture.productionRunId));
      const missingMassModel = await getCreditBatchPageModel(makeTestOrgContext(), fixture.batchId);
      expect(missingMassModel.mass).toMatchObject({
        producedDryKg: null,
        notAppliedDryKg: null,
      });
    } finally {
      if (extraIds.length) {
        await db.delete(creditBatchApplications)
          .where(inArray(creditBatchApplications.applicationId, extraIds));
        await deleteOutputApplicationFixtures(db, inArray(applications.id, extraIds));
      }
      if (submittedId) {
        await db.delete(certificationSubmissions)
          .where(eq(certificationSubmissions.localEntityId, submittedId));
        await db.delete(certifierRemovals).where(eq(certifierRemovals.id, submittedId));
      }
      if (statementId) {
        await db.delete(certificationSubmissions)
          .where(eq(certificationSubmissions.localEntityId, statementId));
        await db.delete(certifierGhgStatements).where(eq(certifierGhgStatements.id, statementId));
      }
      if (extraRunId) {
        await db.delete(creditBatchProductionRuns).where(and(
          eq(creditBatchProductionRuns.organizationId, TEST_ORG_ID),
          eq(creditBatchProductionRuns.productionRunId, extraRunId)));
        await db.delete(productionRuns).where(and(
          eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, extraRunId)));
      }
      await cleanupLineageFixture(fixture);
    }
  });
});
