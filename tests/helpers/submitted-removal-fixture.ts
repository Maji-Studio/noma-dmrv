import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierRemovals } from "@/db/schema";
import { createLineageFixture, type LineageFixture } from "./certification-lineage-fixture";
import { TEST_ORG_ID } from "./test-org";

/**
 * A lineage fixture whose Removal reads as submitted (not interrupted): an
 * ended pending batch waiting on the verifier.
 */
export async function createSubmittedRemovalFixture(): Promise<LineageFixture> {
  const fixture = await createLineageFixture("none");
  await db.update(certifierRemovals).set({ startedOn: "2026-06-01", completedOn: "2026-06-30" })
    .where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId)));
  await db.insert(certificationSubmissions).values({
    organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
    localEntityType: "removal", localEntityId: fixture.removalId, version: 1,
    status: "submitted", externalId: `budget-${fixture.removalId}`,
    payloadHash: "submitted", payloadSnapshot: {}, submittedAt: new Date("2026-07-02T12:00:00Z"), metadata: {},
  });
  return fixture;
}
