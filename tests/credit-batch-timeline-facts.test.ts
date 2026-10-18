import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { applications, certifierRemovals, creditBatchApplications } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { listCreditBatchTimelineFacts } from "@/data-access/credit-batch-timeline-facts";
import { createLineageFixture, cleanupLineageFixture } from "./helpers/certification-lineage-fixture";
import {
  insertOutputApplicationFixture,
  deleteOutputApplicationFixtures,
} from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("credit batch timeline facts", () => {
  it("batches produced, applied and not-in-Removal dry mass with Removal codes, scoped to the organization", async () => {
    const fixture = await createLineageFixture("none");
    const extraIds: string[] = [];
    try {
      const added = await insertOutputApplicationFixture(db, [{
        organizationId: TEST_ORG_ID,
        deliveryId: fixture.deliveryId,
        code: `TL-unassigned-${fixture.batchId}`,
        applicationDate: new Date("2026-06-17"),
        fieldSizeHa: 1,
        fieldIdentifier: "North field",
        biocharAppliedTons: 0.1,
        biocharAppliedDryTons: 0.05,
      }], row => row);
      extraIds.push(...added.map(row => row.id));
      await db.insert(creditBatchApplications).values({
        organizationId: TEST_ORG_ID,
        creditBatchId: fixture.batchId,
        applicationId: added[0].id,
        allocatedWetMassKg: 100,
        allocatedDryMassKg: 40,
        removalId: null,
      });
      const [removal] = await db.select().from(certifierRemovals).where(eq(certifierRemovals.id, fixture.removalId));

      const facts = await listCreditBatchTimelineFacts(makeTestOrgContext(), [fixture.batchId, fixture.batchId]);
      expect(facts[fixture.batchId]).toEqual({
        creditBatchId: fixture.batchId,
        facilityId: fixture.facilityId,
        producedDryKg: 285,
        appliedDryKg: 230,
        notInRemovalDryKg: 40,
        removalCodes: [removal.code],
      });

      expect(await listCreditBatchTimelineFacts({ ...makeTestOrgContext(), organizationId: "another-org" }, [fixture.batchId])).toEqual({});
      expect(await listCreditBatchTimelineFacts(makeTestOrgContext(), [])).toEqual({});
    } finally {
      if (extraIds.length) {
        await db.delete(creditBatchApplications).where(inArray(creditBatchApplications.applicationId, extraIds));
        await deleteOutputApplicationFixtures(db, inArray(applications.id, extraIds));
      }
      await cleanupLineageFixture(fixture);
    }
  });
});
