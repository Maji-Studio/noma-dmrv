/**
 * DB-backed tests for the §8.6.2 production-emissions claim write inside
 * `markSubmissionSubmitted` (issue #349, ADR 0020).
 *
 * The guarded UPDATE's `IS NULL OR = self` predicate is real SQL against the
 * real `credit_batches` column — the orchestrator tests mock the function and
 * the registry-boundary harness deliberately passes batch ids that match zero
 * rows, so without this suite the predicate is pinned only by code review.
 * Asserts: an unclaimed batch is stamped; a self re-claim is idempotent; a
 * foreign claim is silently skipped (the row keeps its original claimant)
 * while the ledger flip itself still commits — the loud foreign-claim error
 * belongs to the submit path's pre-POST gate, not this transaction.
 *
 * Requires a real Postgres (`.env.test`), like
 * tests/certification-submissions.test.ts.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { markSubmissionSubmitted } from "@/data-access/certification";
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
      .values({ code: `FAC-PCW-${tag}`, name: `PCW Facility ${tag}` })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        code: `FT-PCW-${tag}`,
        name: `PCW Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    createdFeedstockTypeIds.push(feedstockType.id);

    const [productionProcess] = await tx
      .insert(productionProcesses)
      .values({ facilityId: facility.id, feedstockTypeId: feedstockType.id })
      .returning({ id: productionProcesses.id });

    const [removalA] = await tx
      .insert(certifierRemovals)
      .values({ facilityId: facility.id })
      .returning({ id: certifierRemovals.id });
    const [removalB] = await tx
      .insert(certifierRemovals)
      .values({ facilityId: facility.id })
      .returning({ id: certifierRemovals.id });
    createdRemovalIds.push(removalA.id, removalB.id);

    const [batch] = await tx
      .insert(creditBatches)
      .values({
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

describe("markSubmissionSubmitted — production-emissions claim write (§8.6.2)", () => {
  it("stamps an unclaimed batch, is idempotent on self re-claim, and skips a foreign claim", async () => {
    const { batchId, removalAId, removalBId } = await createFixture();

    // 1. Unclaimed → the claiming removal is stamped.
    const subA1 = await insertDraftSubmission(removalAId, 1);
    await markSubmissionSubmitted(TEST_USER_ID, subA1, {
      externalId: "ext_pcw_a1",
      productionEmissionsClaim: {
        removalId: removalAId,
        creditBatchIds: [batchId],
      },
    });
    expect(await readClaim(batchId)).toBe(removalAId);

    // 2. Self re-claim (resubmit/supersede by the SAME removal) → unchanged.
    const subA2 = await insertDraftSubmission(removalAId, 2);
    await markSubmissionSubmitted(TEST_USER_ID, subA2, {
      externalId: "ext_pcw_a2",
      supersedePreviousId: subA1,
      productionEmissionsClaim: {
        removalId: removalAId,
        creditBatchIds: [batchId],
      },
    });
    expect(await readClaim(batchId)).toBe(removalAId);

    // 3. Foreign claim (a DIFFERENT removal) → the guarded UPDATE's
    // `IS NULL OR = self` predicate matches zero rows; the original claimant
    // survives and the ledger flip still commits (silent-skip by design —
    // the loud guard is the submit path's pre-POST assertion).
    const subB1 = await insertDraftSubmission(removalBId, 1);
    await markSubmissionSubmitted(TEST_USER_ID, subB1, {
      externalId: "ext_pcw_b1",
      productionEmissionsClaim: {
        removalId: removalBId,
        creditBatchIds: [batchId],
      },
    });
    expect(await readClaim(batchId)).toBe(removalAId);
    const [ledgerRow] = await db
      .select({ status: certificationSubmissions.status })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, subB1));
    expect(ledgerRow.status).toBe("submitted");
  });

  it("leaves claims untouched when no productionEmissionsClaim is passed", async () => {
    const { batchId, removalAId } = await createFixture();
    const sub = await insertDraftSubmission(removalAId, 1);
    await markSubmissionSubmitted(TEST_USER_ID, sub, {
      externalId: "ext_pcw_plain",
    });
    expect(await readClaim(batchId)).toBeNull();
  });
});
