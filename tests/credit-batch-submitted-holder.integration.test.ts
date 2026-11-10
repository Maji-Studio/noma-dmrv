import { and, eq, inArray } from "drizzle-orm";
import { assert, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { applications, certificationSubmissions, certifierGhgStatements, certifierRemovals, creditBatchApplications } from "@/db/schema";
import { loadCreditBatchHealthSummaries } from "@/fn/certification/overview";
import { requireOrgContext } from "@/lib/auth/server";
import { creditBatchStateOf } from "@/lib/credit-batches/batch-state";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { deleteOutputApplicationFixtures, insertOutputApplicationFixture } from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

// Session resolution alone is stubbed; org guards, holder/version reads and readiness use the test DB.
vi.mock("@/lib/auth/server", async (original) => ({
  ...await original<typeof import("@/lib/auth/server")>(), requireOrgContext: vi.fn(),
}));

const REPORTING_WINDOW = { startedOn: "2026-06-01", completedOn: "2026-06-30" };
const OLDER_HOLDER_CREATED_AT = new Date("2026-06-01T00:00:00Z");
const NEWER_HOLDER_CREATED_AT = new Date("2026-07-01T00:00:00Z");

beforeAll(() => ensureTestOrg());

it.each(["submitted", "accepted"] as const)(
  "keeps a batch submitted with an older %s version and a newer draft holder",
  async (status) => {
    await withLineageFixture(async (fixture) => {
      vi.mocked(requireOrgContext).mockResolvedValue(makeTestOrgContext());
      const { newer, application } = await db.transaction(async (tx) => {
        await tx.update(certifierRemovals).set({ createdAt: OLDER_HOLDER_CREATED_AT, ...REPORTING_WINDOW })
          .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId)));
        // The older holder also has a newer draft attempt: latest-attempt-only reads must fail this test.
        await tx.insert(certificationSubmissions).values([
          {
            organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
            localEntityType: "removal", localEntityId: fixture.removalId, version: 1, status,
            externalId: `submitted-holder-${fixture.removalId}`, payloadHash: "submitted-holder", payloadSnapshot: { semantic: REPORTING_WINDOW },
          },
          {
            organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
            localEntityType: "removal", localEntityId: fixture.removalId, version: 2, status: "draft",
            payloadHash: "older-holder-correction", payloadSnapshot: {},
          },
        ]);
        const [newer] = await insertRemovalFixture(tx, {
          organizationId: TEST_ORG_ID, facilityId: fixture.facilityId, createdAt: NEWER_HOLDER_CREATED_AT, ...REPORTING_WINDOW,
        });
        const [application] = await insertOutputApplicationFixture(tx, {
          organizationId: TEST_ORG_ID, deliveryId: fixture.deliveryId, code: `HOLDERS-${fixture.batchId}`,
          applicationDate: new Date("2026-06-18"), fieldSizeHa: 1, biocharAppliedTons: 0.1, biocharAppliedDryTons: 0.05,
        }, row => row);
        await tx.insert(creditBatchApplications).values({
          organizationId: TEST_ORG_ID, creditBatchId: fixture.batchId, applicationId: application.id,
          allocatedWetMassKg: 100, allocatedDryMassKg: 50, removalId: newer.id,
        });
        await tx.insert(certificationSubmissions).values({
          organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
          localEntityType: "removal", localEntityId: newer.id, version: 1, status: "draft",
          payloadHash: "newer-holder-draft", payloadSnapshot: {},
        });
        return { newer, application };
      });
      try {
        const result = await loadCreditBatchHealthSummaries(fixture.facilityId, [fixture.batchId]);
        assert(result.success, JSON.stringify(result));
        const summary = result.data[fixture.batchId];
        expect(summary).toMatchObject({
          removalId: newer.id, removalStatus: { kind: "not-submitted" },
          hasSubmittedRemoval: true, removalInterrupted: false, ghgStatementId: null,
        });
        expect(creditBatchStateOf(summary)).toEqual({ state: "submitted", blockingCount: 0, openTodoCount: 0 });

        // A submitted ledger row whose attempt was interrupted does not count as submitted phase.
        await db.update(certificationSubmissions).set({ metadata: { lastAttemptOutcome: "interrupted" } })
          .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID),
            eq(certificationSubmissions.localEntityId, fixture.removalId), eq(certificationSubmissions.version, 1)));
        const interrupted = await loadCreditBatchHealthSummaries(fixture.facilityId, [fixture.batchId]);
        assert(interrupted.success, JSON.stringify(interrupted));
        expect(interrupted.data[fixture.batchId].hasSubmittedRemoval).toBe(false);
      } finally {
        await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID),
          eq(certificationSubmissions.localEntityId, newer.id)));
        await db.delete(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, TEST_ORG_ID),
          eq(creditBatchApplications.applicationId, application.id)));
        await deleteOutputApplicationFixtures(db, and(eq(applications.organizationId, TEST_ORG_ID), eq(applications.id, application.id))!);
        await db.delete(certifierRemovals).where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, newer.id)));
      }
    }, "none");
  },
);

it("keeps an older holder's issued statement in the health summary across a newer follow-up", async () => {
  await withLineageFixture(async (fixture) => {
    vi.mocked(requireOrgContext).mockResolvedValue(makeTestOrgContext());
    const { newer, application, olderStatement, statementIds } = await db.transaction(async (tx) => {
      await tx.update(certifierRemovals).set({ createdAt: OLDER_HOLDER_CREATED_AT, ...REPORTING_WINDOW })
        .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId)));
      const [newer] = await insertRemovalFixture(tx, {
        organizationId: TEST_ORG_ID, facilityId: fixture.facilityId, createdAt: NEWER_HOLDER_CREATED_AT, ...REPORTING_WINDOW,
      });
      const [application] = await insertOutputApplicationFixture(tx, {
        organizationId: TEST_ORG_ID, deliveryId: fixture.deliveryId, code: `STATEMENT-HOLDERS-${fixture.batchId}`,
        applicationDate: new Date("2026-06-18"), fieldSizeHa: 1, biocharAppliedTons: 0.1, biocharAppliedDryTons: 0.05,
      }, row => row);
      await tx.insert(creditBatchApplications).values({
        organizationId: TEST_ORG_ID, creditBatchId: fixture.batchId, applicationId: application.id,
        allocatedWetMassKg: 100, allocatedDryMassKg: 50, removalId: newer.id,
      });
      const [olderStatement, newerStatement] = await tx.insert(certifierGhgStatements).values([
        { organizationId: TEST_ORG_ID, facilityId: fixture.facilityId,
          reportingPeriodStartOn: "2026-06-01", reportingPeriodEndOn: "2026-06-30" },
        { organizationId: TEST_ORG_ID, facilityId: fixture.facilityId,
          reportingPeriodStartOn: "2026-07-01", reportingPeriodEndOn: "2026-07-31" },
      ]).returning();
      await tx.update(certifierRemovals).set({ ghgStatementId: olderStatement.id })
        .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId)));
      await tx.update(certifierRemovals).set({ ghgStatementId: newerStatement.id })
        .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, newer.id)));
      await tx.insert(certificationSubmissions).values([
        {
          organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "ghg_statement",
          localEntityType: "ghgStatement", localEntityId: olderStatement.id, version: 1, status: "submitted",
          payloadHash: "older-holder-issued", payloadSnapshot: {}, metadata: { remoteStatus: "CREDITS_ISSUED" },
        },
        {
          organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "ghg_statement",
          localEntityType: "ghgStatement", localEntityId: newerStatement.id, version: 1, status: "submitted",
          payloadHash: "newer-holder-awaiting", payloadSnapshot: {}, metadata: { remoteStatus: "AWAITING_VERIFICATION" },
        },
      ]);
      return { newer, application, olderStatement, statementIds: [olderStatement.id, newerStatement.id] };
    });
    try {
      const result = await loadCreditBatchHealthSummaries(fixture.facilityId, [fixture.batchId]);
      assert(result.success, JSON.stringify(result));
      expect(result.data[fixture.batchId]).toMatchObject({
        ghgStatementId: olderStatement.id, ghgStatementStatus: { kind: "issued" },
      });

      await db.update(certifierRemovals).set({ ghgStatementId: null })
        .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, newer.id)));
      const followUp = await loadCreditBatchHealthSummaries(fixture.facilityId, [fixture.batchId]);
      assert(followUp.success, JSON.stringify(followUp));
      expect(followUp.data[fixture.batchId]).toMatchObject({
        ghgStatementId: olderStatement.id, ghgStatementStatus: { kind: "issued" },
      });
    } finally {
      await db.update(certifierRemovals).set({ ghgStatementId: null })
        .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), inArray(certifierRemovals.id, [fixture.removalId, newer.id])));
      await db.delete(certificationSubmissions).where(and(
        eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityType, "ghgStatement"),
        inArray(certificationSubmissions.localEntityId, statementIds),
      ));
      await db.delete(certifierGhgStatements).where(and(
        eq(certifierGhgStatements.organizationId, TEST_ORG_ID), inArray(certifierGhgStatements.id, statementIds),
      ));
      await db.delete(creditBatchApplications).where(and(eq(creditBatchApplications.organizationId, TEST_ORG_ID),
        eq(creditBatchApplications.applicationId, application.id)));
      await deleteOutputApplicationFixtures(db, and(eq(applications.organizationId, TEST_ORG_ID), eq(applications.id, application.id))!);
      await db.delete(certifierRemovals).where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, newer.id)));
    }
  }, "none");
});
