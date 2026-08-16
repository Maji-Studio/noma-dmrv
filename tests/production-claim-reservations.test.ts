/**
 * DB-backed coverage for the pre-POST whole-batch production claim reservation.
 * Competing Removal submissions must serialize on the credit-batch row, while
 * an interrupted attempt with a possible registry mutation remains fail-closed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { markSubmissionSubmitted } from "@/data-access/certification";
import { markSubmissionInterrupted } from "@/data-access/certification-submissions";
import {
  rejectSubmissionAndReleaseProductionClaims,
  reserveProductionEmissionsClaims,
} from "@/data-access/production-claim-reservations";
import { db } from "@/db";
import {
  certificationSubmissions,
  certifierRemovals,
  creditBatches,
  facilities,
  feedstockTypes,
  productionProcesses,
} from "@/db/schema";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { SUBMISSION_EXTERNAL_MUTATIONS } from "@/lib/certification/submission-metadata";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

const TEST_USER_ID = "test-user-production-claim-reservation";
const createdFacilityIds: string[] = [];
const createdFeedstockTypeIds: string[] = [];
const createdBatchIds: string[] = [];
const createdRemovalIds: string[] = [];
const createdSubmissionIds: string[] = [];

interface Fixture {
  batchId: string;
  removalAId: string;
  removalBId: string;
}

interface Draft {
  id: string;
  lockedAt: Date;
}

beforeAll(() => ensureTestOrg());

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

async function createFixture(): Promise<Fixture> {
  const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
  return db.transaction(async (tx) => {
    const [facility] = await tx
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FAC-PCR-${tag}`,
        name: `PCR Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    createdFacilityIds.push(facility.id);

    const [feedstockType] = await tx
      .insert(feedstockTypes)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FT-PCR-${tag}`,
        name: `PCR Feedstock ${tag}`,
        category: "forestry",
        usage: "pyrolysis",
      })
      .returning({ id: feedstockTypes.id });
    createdFeedstockTypeIds.push(feedstockType.id);

    const [productionProcess] = await tx
      .insert(productionProcesses)
      .values({
        organizationId: TEST_ORG_ID,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
      })
      .returning({ id: productionProcesses.id });

    const [removalA, removalB] = await tx
      .insert(certifierRemovals)
      .values([
        { organizationId: TEST_ORG_ID, facilityId: facility.id },
        { organizationId: TEST_ORG_ID, facilityId: facility.id },
      ])
      .returning({ id: certifierRemovals.id });
    createdRemovalIds.push(removalA.id, removalB.id);

    const [batch] = await tx
      .insert(creditBatches)
      .values({
        organizationId: TEST_ORG_ID,
        code: `CB-PCR-${tag}`,
        facilityId: facility.id,
        feedstockTypeId: feedstockType.id,
        productionProcessId: productionProcess.id,
        status: "pending",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        certifier: "isometric",
      })
      .returning({ id: creditBatches.id });
    createdBatchIds.push(batch.id);
    return {
      batchId: batch.id,
      removalAId: removalA.id,
      removalBId: removalB.id,
    };
  });
}

async function insertDraft(
  removalId: string,
  version: number,
  lockedAt = new Date("2026-08-16T10:00:00.000Z"),
): Promise<Draft> {
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
      lockedAt,
      payloadHash: `hash-pcr-${crypto.randomUUID().slice(0, 8)}`,
      payloadSnapshot: { fixture: "production-claim-reservation" },
    })
    .returning({
      id: certificationSubmissions.id,
      lockedAt: certificationSubmissions.lockedAt,
    });
  createdSubmissionIds.push(row.id);
  if (!row.lockedAt) throw new Error("Fixture draft lock was not persisted");
  return { id: row.id, lockedAt: row.lockedAt };
}

async function readReservation(batchId: string): Promise<string | null> {
  const [row] = await db
    .select({
      owner: creditBatches.productionEmissionsClaimReservedBySubmissionId,
    })
    .from(creditBatches)
    .where(eq(creditBatches.id, batchId));
  return row.owner;
}

async function readClaim(batchId: string): Promise<string | null> {
  const [row] = await db
    .select({ owner: creditBatches.productionEmissionsClaimedByRemovalId })
    .from(creditBatches)
    .where(eq(creditBatches.id, batchId));
  return row.owner;
}

describe("production-emissions claim reservations", () => {
  it("serializes competing drafts before POST and releases a definitive failure", async () => {
    const fixture = await createFixture();
    const draftA = await insertDraft(fixture.removalAId, 1);
    const draftB = await insertDraft(fixture.removalBId, 1);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const reserve = (removalId: string, submissionId: string) =>
      reserveProductionEmissionsClaims(ctx, {
        removalId,
        submissionId,
        creditBatchIds: [fixture.batchId],
        now: draftA.lockedAt,
      });

    const results = await Promise.allSettled([
      reserve(fixture.removalAId, draftA.id),
      reserve(fixture.removalBId, draftB.id),
    ]);
    const winnerIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const winner = winnerIndex === 0 ? draftA : draftB;
    const winnerRemovalId = winnerIndex === 0
      ? fixture.removalAId
      : fixture.removalBId;
    expect(await readReservation(fixture.batchId)).toBe(winner.id);
    await expect(reserve(winnerRemovalId, winner.id)).resolves.toBeUndefined();

    await rejectSubmissionAndReleaseProductionClaims(ctx, {
      submissionId: winner.id,
      expectedLockedAt: winner.lockedAt,
      errorMessage: "Definitive pre-POST refusal.",
    });
    expect(await readReservation(fixture.batchId)).toBeNull();
    const [rejected] = await db
      .select({ status: certificationSubmissions.status })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, winner.id));
    expect(rejected.status).toBe("rejected");
  });

  it("releases after an inner definitive rejection already changed the ledger", async () => {
    const fixture = await createFixture();
    const draft = await insertDraft(fixture.removalAId, 1);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    await reserveProductionEmissionsClaims(ctx, {
      removalId: fixture.removalAId,
      submissionId: draft.id,
      creditBatchIds: [fixture.batchId],
      now: draft.lockedAt,
    });
    await db
      .update(certificationSubmissions)
      .set({ status: "rejected", lockedAt: null })
      .where(eq(certificationSubmissions.id, draft.id));

    await rejectSubmissionAndReleaseProductionClaims(ctx, {
      submissionId: draft.id,
      expectedLockedAt: draft.lockedAt,
      errorMessage: "Registry rejected the request before creating anything.",
    });
    expect(await readReservation(fixture.batchId)).toBeNull();
  });

  it("transfers only a stale mutation-free reservation", async () => {
    const fixture = await createFixture();
    const lockedAt = new Date("2026-08-16T08:00:00.000Z");
    const draftA = await insertDraft(fixture.removalAId, 1, lockedAt);
    const draftB = await insertDraft(fixture.removalBId, 1, lockedAt);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    await reserveProductionEmissionsClaims(ctx, {
      removalId: fixture.removalAId,
      submissionId: draftA.id,
      creditBatchIds: [fixture.batchId],
      now: lockedAt,
    });

    await reserveProductionEmissionsClaims(ctx, {
      removalId: fixture.removalBId,
      submissionId: draftB.id,
      creditBatchIds: [fixture.batchId],
      now: new Date(lockedAt.getTime() + LOCK_TTL_MS),
    });
    expect(await readReservation(fixture.batchId)).toBe(draftB.id);
  });

  it("rejects a resumed stale attempt after its reservation transfers", async () => {
    const fixture = await createFixture();
    const lockedAt = new Date("2026-08-16T08:00:00.000Z");
    const draftA = await insertDraft(fixture.removalAId, 1, lockedAt);
    const draftB = await insertDraft(fixture.removalBId, 1, lockedAt);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    await reserveProductionEmissionsClaims(ctx, {
      removalId: fixture.removalAId,
      submissionId: draftA.id,
      creditBatchIds: [fixture.batchId],
      now: lockedAt,
    });
    await reserveProductionEmissionsClaims(ctx, {
      removalId: fixture.removalBId,
      submissionId: draftB.id,
      creditBatchIds: [fixture.batchId],
      now: new Date(lockedAt.getTime() + LOCK_TTL_MS),
    });

    await expect(
      markSubmissionSubmitted(ctx, draftA.id, {
        externalId: "ext_stale_resumed_attempt",
        productionEmissionsClaim: {
          removalId: fixture.removalAId,
          creditBatchIds: [fixture.batchId],
        },
      }),
    ).rejects.toThrow(/claimed by another Removal/);
    expect(await readClaim(fixture.batchId)).toBeNull();
    expect(await readReservation(fixture.batchId)).toBe(draftB.id);
    const [staleDraft] = await db
      .select({ status: certificationSubmissions.status })
      .from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, draftA.id));
    expect(staleDraft.status).toBe("draft");
  });

  it.each([
    SUBMISSION_EXTERNAL_MUTATIONS.possible,
    SUBMISSION_EXTERNAL_MUTATIONS.confirmed,
  ])("retains a stale reservation after a %s external mutation", async (mutation) => {
    const fixture = await createFixture();
    const draftA = await insertDraft(fixture.removalAId, 1);
    const draftB = await insertDraft(fixture.removalBId, 1);
    const ctx = makeTestOrgContext(TEST_USER_ID);

    await reserveProductionEmissionsClaims(ctx, {
      removalId: fixture.removalAId,
      submissionId: draftA.id,
      creditBatchIds: [fixture.batchId],
      now: draftA.lockedAt,
    });
    await markSubmissionInterrupted(ctx, draftA.id, {
      errorMessage: "Registry response was ambiguous.",
      expectedLockedAt: draftA.lockedAt,
      externalMutation: mutation,
    });

    await expect(
      reserveProductionEmissionsClaims(ctx, {
        removalId: fixture.removalBId,
        submissionId: draftB.id,
        creditBatchIds: [fixture.batchId],
        now: new Date(draftA.lockedAt.getTime() + LOCK_TTL_MS + 1_000),
      }),
    ).rejects.toThrow(/already sending production inputs/);
    expect(await readReservation(fixture.batchId)).toBe(draftA.id);
  });
});
