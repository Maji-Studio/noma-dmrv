import { setComponentFilePolicy } from "@/data-access/component-file-policy";
import { and } from "drizzle-orm";
import { productionRuns } from "@/db/schema";
import { attachEmissionLineFile, listEmissionLineFilesForBatches } from "@/data-access/emission-line-files";
import { confirmDocumentUploadInTransaction, uploadFactsFor } from "@/data-access/document-writes";
import { EMISSION_ENTRIES_CHANGED } from "@/lib/certification/emission-entry-messages";
import { createEmissionLineFileFixture, cleanupEmissionLineFileFixture, COMPONENT_ID, FILE_UPLOAD, FILE_STORAGE } from "./helpers/emission-line-file-fixture";
import { insertRemovalFixture } from "./helpers/removal-fixture";
import { getMetadataValue } from "@/lib/certification/submission-metadata";
/**
 * DB-backed coverage for the pre-POST whole-batch production claim reservation.
 * Competing Removal submissions must serialize on the credit-batch row, while
 * an interrupted attempt with a possible registry mutation remains fail-closed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { markSubmissionSubmitted } from "@/data-access/certification";
import { markSubmissionAttemptStarted, markSubmissionInterrupted } from "@/data-access/certification-submissions";
import { deleteDocumentApp } from "@/lib/operations/documents";
import { runOperationInProcess } from "@/lib/operations/runner";
const deleteViaApp = (ctx: Parameters<typeof runOperationInProcess>[1], documentId: string) => runOperationInProcess(deleteDocumentApp, ctx, { documentId, expectedVersion: 1 });
import { requestRemovalEvidenceRefresh } from "@/data-access/removal-evidence-refresh";
import {
  rejectSubmissionAndReleaseProductionClaims,
  reserveProductionEmissionsClaims,
} from "@/data-access/production-claim-reservations";
import { db } from "@/db";
import {
  activityEvents,
  certificationSubmissions,
  certifierRemovals,
  creditBatches,
  facilities,
  feedstockTypes,
  productionProcesses,
  documents,
} from "@/db/schema";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { SUBMISSION_EXTERNAL_MUTATIONS } from "@/lib/certification/submission-metadata";
import { TEST_SITE_POSITION,
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
const POST_EXPIRY_OFFSET_MS = 1_000;

interface Fixture {
  facilityId: string;
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
    await db.delete(activityEvents).where(inArray(activityEvents.creditBatchId, createdBatchIds));
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
      .values({ ...TEST_SITE_POSITION, timezone: "UTC",
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

    const [removalA, removalB] = await insertRemovalFixture(tx, [
        { organizationId: TEST_ORG_ID, facilityId: facility.id },
        { organizationId: TEST_ORG_ID, facilityId: facility.id },
      ]);
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
      facilityId: facility.id,
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
  it("reviews only the current interrupted draft and preserves its snapshot", async () => {
    const fixture = await createFixture();
    const draft = await insertDraft(fixture.removalAId, 1);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const args = { removalId: fixture.removalAId, submissionId: draft.id };
    const [document] = await db.insert(documents).values({ organizationId: TEST_ORG_ID, fileUrl: "https://example.com/evidence.pdf", documentType: "pdf", entityType: "facility", entityId: fixture.facilityId, fileName: "reviewed-evidence.pdf", mimeType: "application/pdf" }).returning();
    const reconcile = vi.fn(async () => [{ documentId: document.id }]);
    await expect(requestRemovalEvidenceRefresh(ctx, args, reconcile)).rejects.toThrow("Only an interrupted attempt");
    expect(reconcile).not.toHaveBeenCalled();
    await db.update(certificationSubmissions).set({
      metadata: { lastAttemptOutcome: "interrupted", externalMutation: "none" },
    }).where(eq(certificationSubmissions.id, draft.id));
    await expect(requestRemovalEvidenceRefresh({ ...ctx, orgRole: "member" }, args, reconcile)).rejects.toThrow();
    await expect(requestRemovalEvidenceRefresh({ ...ctx, organizationId: "other-org" }, args, reconcile)).rejects.toThrow();
    expect(reconcile).not.toHaveBeenCalled();
    await requestRemovalEvidenceRefresh(ctx, args, reconcile);
    const [saved] = await db.select().from(certificationSubmissions).where(eq(certificationSubmissions.id, draft.id));
    expect(saved.payloadSnapshot).toEqual({ fixture: "production-claim-reservation" });
    expect(saved.status).toBe("draft");
    expect(saved.metadata).toMatchObject({ evidenceRefreshCandidates: [{ documentId: document.id }] });
    await expect(deleteViaApp(ctx, document.id)).rejects.toThrow("reviewed certification evidence");
    await db.update(certificationSubmissions).set({ externalId: "rmv-already-created" }).where(eq(certificationSubmissions.id, draft.id));
    await expect(requestRemovalEvidenceRefresh(ctx, args, reconcile)).rejects.toThrow("Only an interrupted attempt");
    expect(reconcile).toHaveBeenCalledTimes(1);
    await db.delete(documents).where(eq(documents.id, document.id));
  });

  it("refuses evidence removed between discovery and acquiring its mirror lock", async () => {
    const fixture = await createFixture();
    const draft = await insertDraft(fixture.removalAId, 1);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    await db.update(certificationSubmissions).set({ metadata: { lastAttemptOutcome: "interrupted", externalMutation: "none" } }).where(eq(certificationSubmissions.id, draft.id));
    const [document] = await db.insert(documents).values({ organizationId: TEST_ORG_ID, fileUrl: "https://example.com/evidence.pdf", documentType: "pdf", entityType: "facility", entityId: fixture.facilityId, fileName: "review-race.pdf" }).returning();
    await expect(requestRemovalEvidenceRefresh(ctx, { removalId: fixture.removalAId, submissionId: draft.id }, async () => {
      await deleteViaApp(ctx, document.id);
      return [{ documentId: document.id }];
    })).rejects.toThrow();
    const [saved] = await db.select().from(certificationSubmissions).where(eq(certificationSubmissions.id, draft.id));
    expect(saved.metadata).not.toHaveProperty("evidenceRefreshCandidates");
  });

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
    const history = await db.select().from(activityEvents).where(eq(activityEvents.creditBatchId, fixture.batchId))
      .orderBy(activityEvents.sequence);
    // A resume keeps the same reservation, so only reserve and release record activity.
    expect(history).toHaveLength(2);
    for (const event of history) expect(event).toMatchObject({
      entityType: "credit_batch", entityId: fixture.batchId, creditBatchId: fixture.batchId,
      action: "updated", source: "form", actorUserId: ctx.userId,
    });
    expect(history[0].changedFields).toEqual(["productionEmissionsClaimReservedBySubmissionId"]);
    expect(history[1].changedFields).toEqual(["productionEmissionsClaimReservedBySubmissionId"]);
    expect(history[0].changes).toEqual({ productionEmissionsClaimReservedBySubmissionId: { from: null, to: winner.id } });
    expect(history[1].changes).toEqual({ productionEmissionsClaimReservedBySubmissionId: { from: winner.id, to: null } });
    await rejectSubmissionAndReleaseProductionClaims(ctx, {
      submissionId: winner.id, expectedLockedAt: winner.lockedAt, errorMessage: "Repeated refusal",
    });
    expect(await db.select().from(activityEvents).where(eq(activityEvents.creditBatchId, fixture.batchId))).toHaveLength(history.length);
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
        now: new Date(
          draftA.lockedAt.getTime() + LOCK_TTL_MS + POST_EXPIRY_OFFSET_MS,
        ),
      }),
    ).rejects.toThrow(/already sending production inputs/);
    expect(await readReservation(fixture.batchId)).toBe(draftA.id);
  });
});

describe("reviewed evidence reservation transfer", () => {
it("transfers only a mutation-free reviewed predecessor to its linked version of the same Removal", async () => {
  const fixture = await createFixture();
  const previous = await insertDraft(fixture.removalAId, 1);
  const next = await insertDraft(fixture.removalAId, 2);
  const foreign = await insertDraft(fixture.removalBId, 1);
  const ctx = makeTestOrgContext(TEST_USER_ID);
  await reserveProductionEmissionsClaims(ctx, {removalId: fixture.removalAId, submissionId: previous.id, creditBatchIds: [fixture.batchId]});
  await db.update(certificationSubmissions).set({metadata: {externalMutation: "confirmed", lastAttemptOutcome: "interrupted", evidenceRefreshCandidates: [{documentId: "proof"}]}}).where(eq(certificationSubmissions.id, previous.id));
  for (const id of [next.id, foreign.id]) {
    await db.update(certificationSubmissions).set({metadata: {supersedePreviousId: previous.id}}).where(eq(certificationSubmissions.id, id));
  }
  await expect(reserveProductionEmissionsClaims(ctx, {removalId: fixture.removalBId, submissionId: foreign.id, creditBatchIds: [fixture.batchId]})).rejects.toThrow("already sending");
  await expect(reserveProductionEmissionsClaims(ctx, {removalId: fixture.removalAId, submissionId: next.id, creditBatchIds: [fixture.batchId]})).rejects.toThrow("already sending");
  await db.update(certificationSubmissions).set({metadata: {externalMutation: "none", lastAttemptOutcome: "interrupted", evidenceRefreshCandidates: [{documentId: "proof"}]}}).where(eq(certificationSubmissions.id, previous.id));
  await reserveProductionEmissionsClaims(ctx, {removalId: fixture.removalAId, submissionId: next.id, creditBatchIds: [fixture.batchId]});
  expect(await readReservation(fixture.batchId)).toBe(next.id);
  const [prior] = await db.select().from(certificationSubmissions).where(eq(certificationSubmissions.id, previous.id));
  expect(prior.payloadSnapshot).toEqual({fixture: "production-claim-reservation"});
  expect(prior.status).toBe("draft");
});

});


describe("attempt-started marker guards and terminal cleanup", () => {
  it("guards org, draft status and exact lock, preserves confirmed, and leaves the TTL bypass closed", async () => {
    const fixture = await createFixture();
    const row = await insertDraft(fixture.removalAId, 1);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    const read = async () => (await db.select().from(certificationSubmissions)
      .where(eq(certificationSubmissions.id, row.id)))[0];
    expect(await markSubmissionAttemptStarted({ ...ctx, organizationId: "another-org" }, row.id, row.lockedAt)).toBe(false);
    expect(await markSubmissionAttemptStarted(ctx, row.id, new Date(0))).toBe(false);
    expect(getMetadataValue((await read()).metadata, "externalMutation")).toBeNull();
    expect(await markSubmissionAttemptStarted(ctx, row.id, row.lockedAt)).toBe(true);
    expect(await read()).toMatchObject({ lockedAt: row.lockedAt, metadata: { externalMutation: "possible" } });
    expect(getMetadataValue((await read()).metadata, "lastAttemptOutcome")).toBeNull();
    await db.update(certificationSubmissions).set({ metadata: { externalMutation: "confirmed" } })
      .where(eq(certificationSubmissions.id, row.id));
    expect(await markSubmissionAttemptStarted(ctx, row.id, row.lockedAt)).toBe(true);
    expect(getMetadataValue((await read()).metadata, "externalMutation")).toBe("confirmed");
    await db.update(certificationSubmissions).set({ status: "submitted" })
      .where(eq(certificationSubmissions.id, row.id));
    expect(await markSubmissionAttemptStarted(ctx, row.id, row.lockedAt)).toBe(false);
  });

  it.each(["possible", "confirmed"] as const)("only releases a proven mutation-free attempt's possible marker (%s)", async (mutation) => {
    const fixture = await createFixture();
    const row = await insertDraft(fixture.removalAId, 1);
    const ctx = makeTestOrgContext(TEST_USER_ID);
    await reserveProductionEmissionsClaims(ctx, {
      removalId: fixture.removalAId, submissionId: row.id, creditBatchIds: [fixture.batchId], now: row.lockedAt,
    });
    await markSubmissionAttemptStarted(ctx, row.id, row.lockedAt);
    if (mutation === "confirmed") {
      await db.update(certificationSubmissions).set({ metadata: { externalMutation: mutation } })
        .where(eq(certificationSubmissions.id, row.id));
    }
    const reject = (expectedLockedAt: Date, mutationFreeAttempt?: true) => rejectSubmissionAndReleaseProductionClaims(ctx, {
      submissionId: row.id, expectedLockedAt, mutationFreeAttempt, errorMessage: "Definitive refusal",
    });
    await reject(row.lockedAt);
    await reject(new Date(0), true);
    expect(await readReservation(fixture.batchId)).toBe(row.id);
    await reject(row.lockedAt, true);
    const [saved] = await db.select().from(certificationSubmissions).where(eq(certificationSubmissions.id, row.id));
    expect(saved.status).toBe(mutation === "possible" ? "rejected" : "draft");
    expect(getMetadataValue(saved.metadata, "externalMutation")).toBe(mutation === "possible" ? null : "confirmed");
    expect(await readReservation(fixture.batchId)).toBe(mutation === "possible" ? null : row.id);
  });
});

describe("component-file revision fence", () => {
  it.each(["existing-anchor", "new-anchor", "pending-only", "unchanged"])("compares the reviewed set under the batch lock (%s)", async kind => {
    const fixture = await createEmissionLineFileFixture();
    const { ctx, batch, removal, run } = fixture;
    const electricityKwh = 1;
    const sha256Length = 64;
    try {
      await db.update(productionRuns).set({ electricityKwh }).where(and(
        eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, run.id),
      ));
      const attach = () => attachEmissionLineFile(ctx, { creditBatchId: batch.id, componentId: COMPONENT_ID, upload: FILE_UPLOAD }, FILE_STORAGE);
      const confirm = (document: Awaited<ReturnType<typeof attach>>) => db.transaction(tx => confirmDocumentUploadInTransaction(ctx, tx, {
        ...uploadFactsFor(document), finalKey: `confirmed/${document.id}`, inspectedSizeBytes: FILE_UPLOAD.sizeBytes,
        inspectedContentType: FILE_UPLOAD.contentType, inspectedSha256: "a".repeat(sha256Length),
      }));
      if (kind !== "new-anchor") {
        expect(await confirm(await attach())).toMatchObject({ kind: "uploaded" });
      }
      const reviewed = [...new Map((await listEmissionLineFilesForBatches(ctx, [batch.id]))
        .filter(row => row.document).map(row => [row.anchor.id, { anchorId: row.anchor.id, version: row.anchor.version }])).values()];
      if (kind !== "unchanged") {
        const pending = await attach();
        if (kind !== "pending-only") expect(await confirm(pending)).toMatchObject({ kind: "uploaded" });
      }
      const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
        provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: removal.id,
        version: 1, status: "draft", lockedAt: new Date(), payloadHash: crypto.randomUUID(), payloadSnapshot: {},
      }).returning();
      const reserve = (frozenLineFileSet: typeof reviewed) => reserveProductionEmissionsClaims(ctx, {
        removalId: removal.id, submissionId: submission.id, creditBatchIds: [batch.id], frozenLineFileSet,
      });
      if (kind === "unchanged" || kind === "pending-only") {
        await expect(reserve(reviewed)).resolves.toBeUndefined();
      } else {
        await expect(reserve(reviewed)).rejects.toMatchObject({ code: "conflict", message: EMISSION_ENTRIES_CHANGED, retryable: true });
        const [saved] = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id)));
        expect(saved.productionEmissionsClaimReservedBySubmissionId).toBeNull();
        const refreshed = [...new Map((await listEmissionLineFilesForBatches(ctx, [batch.id]))
          .filter(row => row.document).map(row => [row.anchor.id, { anchorId: row.anchor.id, version: row.anchor.version }])).values()];
        await expect(reserve(refreshed)).resolves.toBeUndefined();
      }
    } finally {
      await cleanupEmissionLineFileFixture(fixture);
    }
  });
});

it("refuses required proof introduced after review even with no uploaded files", async () => {
  const fixture = await createEmissionLineFileFixture();
  const { ctx, batch, removal, run, observation } = fixture;
  const electricityKwh = 1;
  try {
    await db.update(productionRuns).set({ electricityKwh }).where(and(
      eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, run.id),
    ));
    const none = await setComponentFilePolicy(ctx, { observationId: observation.id, componentId: COMPONENT_ID,
      filePolicy: "none", expectedVersion: observation.version });
    const reviewed = await listEmissionLineFilesForBatches(ctx, [batch.id]);
    expect(reviewed).toEqual([]);
    await setComponentFilePolicy(ctx, { observationId: observation.id, componentId: COMPONENT_ID,
      filePolicy: "lineFile", expectedVersion: none.version });
    const [submission] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
      provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: removal.id,
      version: 1, status: "draft", lockedAt: new Date(), payloadHash: crypto.randomUUID(), payloadSnapshot: {},
    }).returning();
    await expect(reserveProductionEmissionsClaims(ctx, { removalId: removal.id, submissionId: submission.id,
      creditBatchIds: [batch.id], frozenLineFileSet: [],
    })).rejects.toMatchObject({ code: "conflict", message: EMISSION_ENTRIES_CHANGED, retryable: true });
  } finally {
    await cleanupEmissionLineFileFixture(fixture);
  }
});
