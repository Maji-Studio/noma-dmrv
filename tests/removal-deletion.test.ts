import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";
/**
 * DB-backed tests for deleting a never-finalized Removal
 * (`src/fn/certification/delete-removal.ts` over
 * `src/data-access/certifier-removal-deletion.ts`).
 *
 * Real Postgres for the claim/finalize seams (row locks, ledger CAS) and the
 * fake registry (`tests/fixtures/fake-registry.ts`) for the DELETE calls.
 * Biochar Application ordering is covered by the colocated unit test on the
 * orchestration; here the registry side is the GHG Entry.
 *
 * Requires a real Postgres (`.env.test`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

vi.mock("@/lib/isometric/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/isometric/client")>();
  const { createFakeClientModule } = await import("./fixtures/fake-registry");
  return createFakeClientModule(actual);
});

import { db } from "@/db";
import {
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
  certifierSyncEvents,
} from "@/db/schema/certification";
import { creditBatches } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionProcesses } from "@/db/schema/production-processes";
import {
  claimRemovalDeletion,
  finalizeRemovalDeletion,
  REMOVAL_DELETE_CHANGED_ERROR,
  REMOVAL_DELETE_IN_FLIGHT_ERROR,
  REMOVAL_DELETE_SUBMITTED_ERROR,
} from "@/data-access/certifier-removal-deletion";
import { deleteRemoval } from "@/fn/certification/delete-removal";
import {
  SUBMISSION_ATTEMPT_OUTCOMES,
  SUBMISSION_EXTERNAL_MUTATIONS,
} from "@/lib/certification/submission-metadata";
import { SafeError } from "@/lib/errors";
import {
  installFakeRegistry,
  type FakeIsometricRegistry,
} from "./fixtures/fake-registry";

const RUN_ID_LENGTH = 8;
const SUBMISSION_VERSION = 1;

const createdFacilityIds: string[] = [];
const createdRemovalIds: string[] = [];
const createdBatchIds: string[] = [];
const createdFeedstockTypeIds: string[] = [];

let registry: FakeIsometricRegistry;

beforeAll(async () => {
  await ensureTestOrg();
});

beforeEach(() => {
  registry = installFakeRegistry();
});

afterAll(async () => {
  if (createdBatchIds.length > 0) {
    await db
      .delete(creditBatches)
      .where(inArray(creditBatches.id, createdBatchIds));
  }
  if (createdRemovalIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.localEntityId, createdRemovalIds));
    await db
      .delete(certifierSyncEvents)
      .where(inArray(certifierSyncEvents.entityId, createdRemovalIds));
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, createdRemovalIds));
  }
  if (createdFacilityIds.length > 0) {
    await db
      .delete(productionProcesses)
      .where(inArray(productionProcesses.facilityId, createdFacilityIds));
    await db
      .delete(certifierProjects)
      .where(inArray(certifierProjects.facilityId, createdFacilityIds));
    await db
      .delete(facilities)
      .where(inArray(facilities.id, createdFacilityIds));
  }
  if (createdFeedstockTypeIds.length > 0) {
    await db
      .delete(feedstockTypes)
      .where(inArray(feedstockTypes.id, createdFeedstockTypeIds));
  }
});

interface Fixture {
  facilityId: string;
  removalId: string;
  creditBatchId: string;
}

async function createFixture(): Promise<Fixture> {
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
  await db.insert(certifierProjects).values({
    organizationId: TEST_ORG_ID,
    facilityId: facility.id,
    provider: "isometric",
    externalProjectId: `prj_deletion_${runId}`,
  });
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
  };
}

async function insertLedgerRow(
  fixture: Fixture,
  args: {
    status: "draft" | "submitted" | "rejected";
    externalId: string | null;
    lockedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
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

function interruptedMetadata(): Record<string, unknown> {
  return {
    lastAttemptOutcome: SUBMISSION_ATTEMPT_OUTCOMES.interrupted,
    externalMutation: SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
    lastError: "Creating Removal in Isometric failed",
  };
}

async function removalExists(removalId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: certifierRemovals.id })
    .from(certifierRemovals)
    .where(eq(certifierRemovals.id, removalId))
    .limit(1);
  return Boolean(row);
}

async function ledgerRow(id: string) {
  const [row] = await db
    .select({
      status: certificationSubmissions.status,
      lockedAt: certificationSubmissions.lockedAt,
      metadata: certificationSubmissions.metadata,
      externalId: certificationSubmissions.externalId,
    })
    .from(certificationSubmissions)
    .where(eq(certificationSubmissions.id, id))
    .limit(1);
  return row;
}

describe("deleteRemoval", () => {
  it("deletes the draft GHG Entry, releases the reservation, and removes the Removal", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    const submissionId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
      reserveBatch: true,
    });

    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });

    expect(result.deletedGhgEntryIds).toEqual([entry.id]);
    expect(registry.ghgEntries).toHaveLength(0);
    expect(registry.requestCount("DELETE", `/ghg_entries/${entry.id}`)).toBe(1);
    expect(await removalExists(fixture.removalId)).toBe(false);

    const row = await ledgerRow(submissionId);
    expect(row.status).toBe("rejected");
    expect(row.lockedAt).toBeNull();
    expect(row.externalId).toBe(entry.id);
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.lastAttemptOutcome).toBeUndefined();
    expect(metadata.lastError).toBeUndefined();
    expect(metadata.deletion).toMatchObject({
      deletedGhgEntryIds: [entry.id],
      deletedBiocharApplicationIds: [],
    });

    const [batch] = await db
      .select({
        reserved: creditBatches.productionEmissionsClaimReservedBySubmissionId,
      })
      .from(creditBatches)
      .where(eq(creditBatches.id, fixture.creditBatchId));
    expect(batch.reserved).toBeNull();

    const events = await db
      .select({
        operation: certifierSyncEvents.operation,
        status: certifierSyncEvents.status,
      })
      .from(certifierSyncEvents)
      .where(
        and(
          eq(certifierSyncEvents.entityId, fixture.removalId),
          eq(certifierSyncEvents.organizationId, TEST_ORG_ID),
        ),
      );
    expect(events).toEqual(
      expect.arrayContaining([
        { operation: "removal:delete:ghg-entry", status: "succeeded" },
        { operation: "removal:delete", status: "succeeded" },
      ]),
    );
  });

  it("removes a Removal with no ledger without touching the registry", async () => {
    const fixture = await createFixture();

    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });

    expect(result.deletedGhgEntryIds).toEqual([]);
    expect(registry.requests).toHaveLength(0);
    expect(await removalExists(fixture.removalId)).toBe(false);
  });

  it("treats an already-deleted GHG Entry as absent and still completes", async () => {
    const fixture = await createFixture();
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: `gge_gone_${fixture.removalId.slice(0, RUN_ID_LENGTH)}`,
      metadata: interruptedMetadata(),
    });

    const result = await deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });

    expect(result.deletedGhgEntryIds).toEqual([]);
    expect(await removalExists(fixture.removalId)).toBe(false);
  });

  it("refuses to finalize when a submission ran between claim and finalize", async () => {
    // Only a rejected row: the claim re-locks nothing, so the window between
    // the two transactions is open. A submit that claims a new draft in that
    // window must keep the Removal.
    const fixture = await createFixture();
    const rejectedId = await insertLedgerRow(fixture, {
      status: "rejected",
      externalId: null,
      metadata: { lastError: "Creating Removal in Isometric failed" },
    });
    const ctx = makeTestOrgContext();
    const claim = await claimRemovalDeletion(
      ctx,
      fixture.facilityId,
      fixture.removalId,
    );
    expect(claim.submissionIds).toEqual([rejectedId]);
    expect(claim.lockedSubmission).toBeNull();

    const concurrentDraftId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: null,
      lockedAt: new Date(),
      version: SUBMISSION_VERSION + 1,
    });

    await expect(
      finalizeRemovalDeletion(ctx, claim, {
        deletedGhgEntryIds: [],
        deletedBiocharApplicationIds: [],
      }),
    ).rejects.toThrow(REMOVAL_DELETE_CHANGED_ERROR);
    expect(await removalExists(fixture.removalId)).toBe(true);
    expect((await ledgerRow(concurrentDraftId)).status).toBe("draft");
    expect((await ledgerRow(rejectedId)).status).toBe("rejected");
  });

  it("refuses a submitted Removal and leaves everything in place", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "DRAFT" });
    await insertLedgerRow(fixture, { status: "submitted", externalId: entry.id });

    await expect(
      deleteRemoval(makeTestOrgContext(), {
        facilityId: fixture.facilityId,
        removalId: fixture.removalId,
      }),
    ).rejects.toThrow(REMOVAL_DELETE_SUBMITTED_ERROR);

    expect(registry.requests).toHaveLength(0);
    expect(registry.ghgEntries).toHaveLength(1);
    expect(await removalExists(fixture.removalId)).toBe(true);
  });

  it("refuses while a submission attempt still holds its lock", async () => {
    const fixture = await createFixture();
    await insertLedgerRow(fixture, {
      status: "draft",
      externalId: null,
      lockedAt: new Date(),
      metadata: null,
    });

    await expect(
      deleteRemoval(makeTestOrgContext(), {
        facilityId: fixture.facilityId,
        removalId: fixture.removalId,
      }),
    ).rejects.toThrow(REMOVAL_DELETE_IN_FLIGHT_ERROR);
    expect(await removalExists(fixture.removalId)).toBe(true);
  });

  it("releases the claim and keeps the Removal when the registry refuses the delete", async () => {
    const fixture = await createFixture();
    const entry = registry.seedGhgEntry({ status: "AWAITING_VERIFICATION" });
    const submissionId = await insertLedgerRow(fixture, {
      status: "draft",
      externalId: entry.id,
      metadata: interruptedMetadata(),
    });
    registry.failNext(`DELETE /ghg_entries/${entry.id}`, "reject-before-commit", {
      status: 422,
      body: { errors: [{ detail: "GHG entry is not in DRAFT status" }] },
    });

    const attempt = deleteRemoval(makeTestOrgContext(), {
      facilityId: fixture.facilityId,
      removalId: fixture.removalId,
    });
    await expect(attempt).rejects.toBeInstanceOf(SafeError);
    await expect(attempt).rejects.toThrow(/not in DRAFT status/);

    expect(registry.ghgEntries).toHaveLength(1);
    expect(await removalExists(fixture.removalId)).toBe(true);
    const row = await ledgerRow(submissionId);
    expect(row.status).toBe("draft");
    expect(row.lockedAt).toBeNull();
    expect((row.metadata as Record<string, unknown>).lastAttemptOutcome).toBe(
      SUBMISSION_ATTEMPT_OUTCOMES.interrupted,
    );

    const [failure] = await db
      .select({ status: certifierSyncEvents.status })
      .from(certifierSyncEvents)
      .where(
        and(
          eq(certifierSyncEvents.entityId, fixture.removalId),
          eq(certifierSyncEvents.operation, "removal:delete:ghg-entry"),
        ),
      );
    expect(failure.status).toBe("failed");
  });
});
