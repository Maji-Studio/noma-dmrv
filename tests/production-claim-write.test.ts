import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * DB-backed tests for the §8.6.2 production-emissions claim write inside
 * `markSubmissionSubmitted` (issue #349, ADR 0020).
 *
 * The guarded UPDATE's `IS NULL OR = self` predicate is real SQL against the
 * real `credit_batches` column — the orchestrator tests mock the function and
 * the registry-boundary harness deliberately passes batch ids that match zero
 * rows, so without this suite the predicate is pinned only by code review.
 * Asserts: an unclaimed batch is stamped; a self re-claim is idempotent; a
 * foreign claim throws via the rowcount backstop AND rolls back the ledger
 * flip (fail-closed) — the pre-POST gate in the submit path is the first
 * line, this backstop is the last.
 *
 * Requires a real Postgres (`.env.test`), like
 * tests/certification-submissions.test.ts.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  markSubmissionRejected,
  markSubmissionSubmitted,
} from "@/data-access/certification";
import { markSubmissionInterrupted } from "@/data-access/certification-submissions";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierRemovals,
  creditBatches,
  facilities,
  feedstockTypes,
  productionProcesses,
} from "@/db/schema";

const TEST_USER_ID = "test-user-claim-write";

const createdFacilityIds: string[] = [];
const createdFeedstockTypeIds: string[] = [];
const createdBatchIds: string[] = [];
const createdRemovalIds: string[] = [];
const createdSubmissionIds: string[] = [];

afterAll(async () => {
  if (createdSubmissionIds.length > 0) {
    await db
      .delete(certificationSubmissions)
      .where(inArray(certificationSubmissions.id, createdSubmissionIds));
  }
  if (createdBatchIds.length > 0) {
    await db
      .delete(creditBatches)
      .where(inArray(creditBatches.id, createdBatchIds));
  }
  if (createdRemovalIds.length > 0) {
    await db
      .delete(certifierRemovals)
      .where(inArray(certifierRemovals.id, createdRemovalIds));
  }
  if (createdFacilityIds.length > 0) {
    await db
      .delete(productionProcesses)
      .where(inArray(productionProcesses.facilityId, createdFacilityIds));
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
  batchId: string;
  removalAId: string;
  removalBId: string;
}

// Minimal real rows the claim UPDATE needs: a credit batch (with its facility /
// feedstock-type / production-process FK chain) and two removals to claim from.
async function createFixture(): Promise<Fixture> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({ organizationId: TEST_ORG_ID, code: `FAC-PCW-${tag}`, name: `PCW Facility ${tag}` })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-PCW-${tag}`,
        name: `PCW Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    createdFeedstockTypeIds.push(feedstockType.id);

    const [productionProcess] = await tx
      .insert(productionProcesses)
      .values({ organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: feedstockType.id })
      .returning({ id: productionProcesses.id });

    const [removalA] = await tx
      .insert(certifierRemovals)
      .values({ organizationId: TEST_ORG_ID, facilityId: facility.id })
      .returning({ id: certifierRemovals.id });
    const [removalB] = await tx
      .insert(certifierRemovals)
      .values({ organizationId: TEST_ORG_ID, facilityId: facility.id })
      .returning({ id: certifierRemovals.id });
    createdRemovalIds.push(removalA.id, removalB.id);

    const [batch] = await tx
      .insert(creditBatches)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CB-PCW-${tag}`,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        productionProcessId: productionProcess.id,
        status: "pending",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        certifier: "isometric",
        removalId: removalA.id,
      })
      .returning({ id: creditBatches.id });
    createdBatchIds.push(batch.id);

    return { batchId: batch.id, removalAId: removalA.id, removalBId: removalB.id };
  });
}

async function insertDraftSubmission(
  removalId: string,
  version: number,
): Promise<string> {
  const [row] = await db
    .insert(certificationSubmissions)
    .values({
      organizationId: TEST_ORG_ID,
      provider: "isometric",
      submissionType: "removal",
      localEntityType: "removal",
      localEntityId: removalId,
      version,
      status: "draft",
      payloadHash: `hash-pcw-${crypto.randomUUID().slice(0, 8)}`,
      payloadSnapshot: { fixture: "production-claim-write" },
    })
    .returning({ id: certificationSubmissions.id });
  createdSubmissionIds.push(row.id);
  return row.id;
}

async function readClaim(batchId: string): Promise<string | null> {
  const [row] = await db
    .select({
      claimedBy: creditBatches.productionEmissionsClaimedByRemovalId,
    })
    .from(creditBatches)
    .where(eq(creditBatches.id, batchId));
  return row.claimedBy;
}


beforeAll(() => ensureTestOrg());

describe("markSubmissionSubmitted — production-emissions claim write (§8.6.2)", () => {
  it("stamps an unclaimed batch, is idempotent on self re-claim, and fails loudly on a foreign claim", async () => {
    const { batchId, removalAId, removalBId } = await createFixture();

    // 1. Unclaimed → the claiming removal is stamped.
    const subA1 = await insertDraftSubmission(removalAId, 1);
    await markSubmissionSubmitted(makeTestOrgContext(TEST_USER_ID), subA1, {
      externalId: "ext_pcw_a1",
      productionEmissionsClaim: {
        removalId: removalAId,
        creditBatchIds: [batchId],
      },
    });
    expect(await readClaim(batchId)).toBe(removalAId);

    // 2. Self re-claim (resubmit/supersede by the SAME removal) → unchanged.
    const subA2 = await insertDraftSubmission(removalAId, 2);
    await markSubmissionSubmitted(makeTestOrgContext(TEST_USER_ID), subA2, {
      externalId: "ext_pcw_a2",
      supersedePreviousId: subA1,
      productionEmissionsClaim: {
        removalId: removalAId,
        creditBatchIds: [batchId],
      },
    });
    expect(await readClaim(batchId)).toBe(removalAId);

    // 3. Foreign claim (a DIFFERENT removal) → the guarded UPDATE's
    // `IS NULL OR = self` predicate excludes the row; the rowcount backstop
    // throws, the original claimant survives, and the ledger flip ROLLS BACK
    // (fail-closed) — a registry POST can no longer be marked submitted while
    // its claim silently no-ops.
    const subB1 = await insertDraftSubmission(removalBId, 1);
    await expect(
      markSubmissionSubmitted(makeTestOrgContext(TEST_USER_ID), subB1, {
        externalId: "ext_pcw_b1",
        productionEmissionsClaim: {
          removalId: removalBId,
          creditBatchIds: [batchId],
        },
      }),
    ).rejects.toThrow(/1 credit batch was claimed by another Removal/);
    expect(await readClaim(batchId)).toBe(removalAId);
    const [ledgerRow] = await db
      .select({ status: certificationSubmissions.status })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, subB1));
    expect(ledgerRow.status).toBe("draft");
  });

  it("leaves claims untouched when no productionEmissionsClaim is passed", async () => {
    const { batchId, removalAId } = await createFixture();
    const sub = await insertDraftSubmission(removalAId, 1);
    await markSubmissionSubmitted(makeTestOrgContext(TEST_USER_ID), sub, {
      externalId: "ext_pcw_plain",
    });
    expect(await readClaim(batchId)).toBeNull();
  });
});

describe("markSubmissionRejected", () => {
  it("does not downgrade a row that already reached submitted", async () => {
    const { removalAId } = await createFixture();
    const submissionId = await insertDraftSubmission(removalAId, 1);
    const orgCtx = makeTestOrgContext(TEST_USER_ID);

    await markSubmissionSubmitted(orgCtx, submissionId, {
      externalId: "ext_pcw_submitted_guard",
    });
    await markSubmissionRejected(orgCtx, submissionId, {
      errorMessage: "Later verification failed.",
    });

    const [row] = await db
      .select({
        status: certificationSubmissions.status,
        externalId: certificationSubmissions.externalId,
        metadata: certificationSubmissions.metadata,
      })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, submissionId));
    expect(row).toMatchObject({
      status: "submitted",
      externalId: "ext_pcw_submitted_guard",
    });
    expect(
      (row.metadata as Record<string, unknown> | null)?.lastError,
    ).toBeUndefined();
  });
});

describe("markSubmissionInterrupted", () => {
  it("records recovery metadata without unlocking or changing draft status", async () => {
    const { removalAId } = await createFixture();
    const submissionId = await insertDraftSubmission(removalAId, 1);
    const lockedAt = new Date();
    await db
      .update(certificationSubmissions)
      .set({ lockedAt })
      .where(eq(certificationSubmissions.id, submissionId));

    await markSubmissionInterrupted(
      makeTestOrgContext(TEST_USER_ID),
      submissionId,
      {
        errorMessage: "Safe submission error",
        expectedLockedAt: lockedAt,
        externalMutation: "confirmed",
      },
    );

    const [row] = await db
      .select({
        status: certificationSubmissions.status,
        lockedAt: certificationSubmissions.lockedAt,
        metadata: certificationSubmissions.metadata,
      })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, submissionId));
    expect(row.status).toBe("draft");
    expect(row.lockedAt?.getTime()).toBe(lockedAt.getTime());
    expect(row.metadata).toMatchObject({
      lastError: "Safe submission error",
      lastAttemptOutcome: "interrupted",
      externalMutation: "confirmed",
    });

    await markSubmissionSubmitted(
      makeTestOrgContext(TEST_USER_ID),
      submissionId,
      { externalId: "ext_interrupted_reconciled" },
    );
    const [submitted] = await db
      .select({ metadata: certificationSubmissions.metadata })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, submissionId));
    expect(submitted.metadata).toEqual({});
  });

  it("does not mark a successor lock or a submitted row as interrupted", async () => {
    const { removalAId } = await createFixture();
    const submissionId = await insertDraftSubmission(removalAId, 1);
    const staleLock = new Date(Date.now() - 60_000);
    const successorLock = new Date();
    await db
      .update(certificationSubmissions)
      .set({ lockedAt: successorLock })
      .where(eq(certificationSubmissions.id, submissionId));

    await markSubmissionInterrupted(
      makeTestOrgContext(TEST_USER_ID),
      submissionId,
      {
        errorMessage: "Stale attempt error",
        expectedLockedAt: staleLock,
        externalMutation: "possible",
      },
    );
    let [row] = await db
      .select({
        status: certificationSubmissions.status,
        lockedAt: certificationSubmissions.lockedAt,
        metadata: certificationSubmissions.metadata,
      })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, submissionId));
    expect(row).toMatchObject({ status: "draft", metadata: null });
    expect(row.lockedAt?.getTime()).toBe(successorLock.getTime());

    await markSubmissionSubmitted(
      makeTestOrgContext(TEST_USER_ID),
      submissionId,
      { externalId: "ext_successor_submitted" },
    );
    await markSubmissionInterrupted(
      makeTestOrgContext(TEST_USER_ID),
      submissionId,
      {
        errorMessage: "Late cleanup error",
        expectedLockedAt: successorLock,
        externalMutation: "confirmed",
      },
    );
    [row] = await db
      .select({
        status: certificationSubmissions.status,
        lockedAt: certificationSubmissions.lockedAt,
        metadata: certificationSubmissions.metadata,
      })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, submissionId));
    expect(row).toMatchObject({ status: "submitted", metadata: {} });
    expect(row.lockedAt).toBeNull();
  });
});
