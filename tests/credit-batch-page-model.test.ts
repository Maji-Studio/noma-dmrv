import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  applications,
  certifierGhgStatements,
  creditBatchApplications,
  certifierRemovals,
  certificationSubmissions,
  productionRuns,
} from "@/db/schema";
import { getCreditBatchPageModel } from "@/data-access/credit-batch-page-model";
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
  it("groups frozen slices by Removal, accounts in dry kg, and hides another organization's batch", async () => {
    const fixture = await createLineageFixture("none");
    const extraIds: string[] = [];
    let submittedId: string | undefined;
    let statementId: string | undefined;
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
      await db.insert(certificationSubmissions).values({
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
      });

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
      await cleanupLineageFixture(fixture);
    }
  });
});
