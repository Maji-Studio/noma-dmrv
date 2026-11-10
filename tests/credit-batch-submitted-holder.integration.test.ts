import { and, eq } from "drizzle-orm";
import { assert, beforeAll, expect, it, vi } from "vitest";
import { db } from "@/db";
import { applications, certificationSubmissions, certifierRemovals, creditBatchApplications } from "@/db/schema";
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
