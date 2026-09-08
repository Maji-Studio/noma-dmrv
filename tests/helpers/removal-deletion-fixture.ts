import { eq } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, certifierProjects, certifierRemovals } from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import { TEST_ORG_ID } from "./test-org";

const RUN_ID_LENGTH = 8;
const SUBMISSION_VERSION = 1;

export interface Fixture {
  facilityId: string;
  removalId: string;
  creditBatchId: string;
  certifierProjectId: string;
  externalProjectId: string;
  runId: string;
}
export async function createRemovalDeletionFixture(tracked: {
  createdFacilityIds: string[];
  createdRemovalIds: string[];
  createdBatchIds: string[];
  createdFeedstockTypeIds: string[];
}): Promise<Fixture> {
  const { createdFacilityIds, createdRemovalIds, createdBatchIds, createdFeedstockTypeIds } = tracked;
  const runId = crypto.randomUUID().slice(0, RUN_ID_LENGTH);
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Deletion Facility ${runId}`,
      code: `FAC-DEL-${runId}`,
      durabilityOption: "200_year",
    })
    .returning({ id: facilities.id });
  createdFacilityIds.push(facility.id);
  const externalProjectId = `prj_deletion_${runId}`;
  const [project] = await db
    .insert(certifierProjects)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      provider: "isometric",
      externalProjectId,
    })
    .returning({ id: certifierProjects.id });
  const [removal] = await db
    .insert(certifierRemovals)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      provider: "isometric",
    })
    .returning({ id: certifierRemovals.id });
  createdRemovalIds.push(removal.id);
  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      code: `FT-DEL-${runId}`,
      name: `Deletion Feedstock ${runId}`,
      category: "forestry",
      usage: "pyrolysis",
    })
    .returning({ id: feedstockTypes.id });
  createdFeedstockTypeIds.push(feedstockType.id);
  const [productionProcess] = await db
    .insert(productionProcesses)
    .values({
      organizationId: TEST_ORG_ID,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
    })
    .returning({ id: productionProcesses.id });
  const [batch] = await db
    .insert(creditBatches)
    .values({
      organizationId: TEST_ORG_ID,
      code: `CB-DEL-${runId}`,
      facilityId: facility.id,
      feedstockTypeId: feedstockType.id,
      productionProcessId: productionProcess.id,
      status: "pending",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      certifier: "isometric",
    })
    .returning({ id: creditBatches.id });
  createdBatchIds.push(batch.id);
  return {
    facilityId: facility.id,
    removalId: removal.id,
    creditBatchId: batch.id,
    certifierProjectId: project.id,
    externalProjectId,
    runId,
  };
}
export async function insertLedgerRow(
  fixture: Fixture,
  args: {
    status: "draft" | "submitted" | "rejected";
    externalId: string | null;
    lockedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
    payloadSnapshot?: Record<string, unknown> | null;
    reserveBatch?: boolean;
    version?: number;
  },
): Promise<string> {
  const [row] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: fixture.removalId,
      version: args.version ?? SUBMISSION_VERSION,
      status: args.status,
      externalId: args.externalId,
      lockedAt: args.lockedAt ?? null,
      metadata: args.metadata ?? null,
      payloadSnapshot: args.payloadSnapshot ?? null,
    })
    .returning({ id: certificationSubmissions.id });
  if (args.reserveBatch) {
    await db
      .update(creditBatches)
      .set({ productionEmissionsClaimReservedBySubmissionId: row.id })
      .where(eq(creditBatches.id, fixture.creditBatchId));
  }
  return row.id;
}
