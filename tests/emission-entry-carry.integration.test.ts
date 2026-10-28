import { loadRemovalCarriedEntries } from "@/data-access/removal-carried-entries";
import { normalizeCarriedEntriesForHash } from "@/fn/certification/removal-entry-hash";
import { MIN_VISIBLE_NOT_APPLIED_DRY_KG } from "@/lib/credit-batches/application-mass";
/** Real database contracts. Run only in the configured throwaway test database. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { integer, pgSchema, text } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import { recordEmissionZeros } from "@/data-access/emission-zeros";
import { LOCK_TTL_MS } from "@/lib/isometric/utils/lock";
import { loadRemovalEntryContext, frozenEntriesForAttempt } from "@/fn/certification/removal-entry-context";
import { resolveScopeForRemoval } from "@/fn/certification/removal-scope";
import { loadBatchEmissionContext } from "@/fn/certification/batch-emission-context";
import { applications, creditBatchApplications, facilities } from "@/db/schema";
import { facilityToday } from "@/lib/date-utils";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, certifierGhgStatements, certifierRemovals, creditBatches,
  emissionEntries, emissionEntryValues, productionProcesses, productionRuns, removalTemplateObservations, users } from "@/db/schema";
import { createEmissionEntry, getEmissionEntry, updateEmissionEntry } from "@/data-access/emission-entries";
import { loadFacilityEmissionEntryCarry } from "@/data-access/emission-entry-carry";
import { reserveProductionEmissionsClaims, rejectSubmissionAndReleaseProductionClaims } from "@/data-access/production-claim-reservations";
import { markSubmissionSubmitted } from "@/data-access/submission-ledger-transitions";
import { claimRemovalDeletion, finalizeRemovalDeletion } from "@/data-access/certifier-removal-deletion";
import { cleanupLineageFixture, createLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";

const registry = vi.hoisted(() => ({ getGhgStatement: vi.fn(), resolveClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: registry.getGhgStatement }));
registry.getGhgStatement.mockResolvedValue({ status: "FAILED_VERIFICATION", submitted_at: "2099-01-01T00:00:00Z", ghg_entry_ids: ["carried"] });
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: registry.resolveClient }));
const userId = `carry-${crypto.randomUUID()}`;
const ctx = { ...makeTestOrgContext(userId), orgRole: "admin" as const };
const LOCK_WAIT_MS = 5_000;
const activity = pgSchema("pg_catalog").view("pg_stat_activity", { pid: integer("pid"), waitEventType: text("wait_event_type") }).existing();
let origin: LineageFixture;
let receiving: LineageFixture;
let observation: typeof removalTemplateObservations.$inferSelect;
let movedProcessId: string;
let entry: Awaited<ReturnType<typeof createEmissionEntry>>;
beforeAll(async () => { await ensureTestOrg(); });
beforeEach(async () => {
  await db.insert(users).values({ id: userId, email: `${userId}@example.test`, emailVerified: true }).onConflictDoNothing();
  origin = await createLineageFixture("none");
  receiving = await createLineageFixture("none");
  [observation] = await db.insert(removalTemplateObservations).values({ organizationId: ctx.organizationId,
    provider: "isometric", externalProjectId: "carry-project", externalTemplateId: `carry-${crypto.randomUUID()}`,
    semanticFingerprint: "carry", fullFingerprint: "carry", definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "",
      components: [{ id: "line", displayName: "Electricity", description: null, blueprintKey: "grid_electricity_use",
        inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] }] }] },
    enrichment: { line: { electricity_use: { unit: "kWh" } } }, lineSources: { line: { scope: "operating", entryPolicy: "additive", origin: "reviewed" } },
  }).returning();
  await db.update(creditBatches).set({ removalTemplateId: observation.externalTemplateId }).where(inArray(creditBatches.id, [origin.batchId, receiving.batchId]));
  // The batch's process identity is (process, facility, feedstock type), so the receiving batch needs a process at the origin's facility.
  [{ id: movedProcessId }] = await db.insert(productionProcesses).values({ organizationId: ctx.organizationId,
    facilityId: origin.facilityId, feedstockTypeId: receiving.feedstockTypeId }).returning({ id: productionProcesses.id });
  await db.update(creditBatches).set({ facilityId: origin.facilityId, productionProcessId: movedProcessId }).where(eq(creditBatches.id, receiving.batchId));
  await db.update(certifierRemovals).set({ facilityId: origin.facilityId }).where(eq(certifierRemovals.id, receiving.removalId));
  entry = await createEmissionEntry(ctx, { creditBatchId: origin.batchId, componentId: "line", occurredOn: "2026-06-10",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "120", unit: "kWh" }] });
  // The fixture applies 190 dry kg. Match its production to represent a fully applied origin.
  await db.update(productionRuns).set({ biocharDryMassKg: 190 }).where(eq(productionRuns.id, origin.productionRunId));
  await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal",
    localEntityType: "removal", localEntityId: origin.removalId, version: 1, status: "submitted", submittedAt: new Date(), externalId: "origin-sent" });
});
afterEach(async () => {
  await db.delete(emissionEntries).where(and(inArray(emissionEntries.creditBatchId, [origin.batchId, receiving.batchId]), eq(emissionEntries.kind, "zero")));
  await db.delete(emissionEntryValues).where(eq(emissionEntryValues.entryId, entry.id));
  await db.delete(emissionEntries).where(eq(emissionEntries.id, entry.id));
  await db.update(creditBatches).set({ facilityId: receiving.facilityId, productionProcessId: receiving.productionProcessId }).where(eq(creditBatches.id, receiving.batchId));
  await db.delete(productionProcesses).where(eq(productionProcesses.id, movedProcessId));
  await db.update(certifierRemovals).set({ facilityId: receiving.facilityId }).where(eq(certifierRemovals.id, receiving.removalId));
  await cleanupLineageFixture(receiving);
  await cleanupLineageFixture(origin);
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.id, observation.id));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
async function attempt() {
  const [row] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal",
    localEntityType: "removal", localEntityId: receiving.removalId, version: 1, status: "draft", lockedAt: new Date(),
    payloadHash: "carry", payloadSnapshot: { frozenEntrySet: [{ entryId: entry.id, contentRevision: entry.contentRevision }] },
  }).returning();
  return row;
}
function reserve(row: Awaited<ReturnType<typeof attempt>>) {
  return reserveProductionEmissionsClaims(ctx, { removalId: receiving.removalId, submissionId: row.id, creditBatchIds: [],
    entryClaim: { memberBatchIds: [receiving.batchId], frozenEntrySet: [{ entryId: entry.id, contentRevision: entry.contentRevision }] } });
}
it("derives a receiver, refuses stock left under lock, then stamps the original entry for its receiver", async () => {
  const context = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId);
  expect(context.entries.find(row => row.id === entry.id)?.carry.receiver?.removalId).toBe(receiving.removalId);
  const row = await attempt();
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId)).entries.find(item => item.id === entry.id)?.carry.waitingReason).toBe("noDraft");
  await db.update(productionRuns).set({ biocharDryMassKg: 285 }).where(eq(productionRuns.id, origin.productionRunId));
  await expect(reserve(row)).rejects.toThrow("Emissions entries changed");
  await db.update(productionRuns).set({ biocharDryMassKg: 190 }).where(eq(productionRuns.id, origin.productionRunId));
  registry.getGhgStatement.mockClear();
  registry.resolveClient.mockClear();
  await reserve(row);
  expect(registry.getGhgStatement).not.toHaveBeenCalled();
  expect(registry.resolveClient).not.toHaveBeenCalled();
  const reserved = await getEmissionEntry(ctx, entry.id);
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId, db, undefined, { ownedBatchIds: [origin.batchId] })).entries.find(item => item.id === entry.id)?.carry.receiver?.removalId).toBe(receiving.removalId);
  await expect(updateEmissionEntry(ctx, { id: entry.id, expectedVersion: reserved.version, note: "changed" })).rejects.toThrow("reserved or sent");
  await markSubmissionSubmitted(ctx, row.id, { externalId: "carried", expectedLockedAt: row.lockedAt!,
    productionEmissionsClaim: { removalId: receiving.removalId, creditBatchIds: [] } });
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({ sentByRemovalId: receiving.removalId, creditBatchId: origin.batchId, occurredOn: "2026-06-10", sendReservedBySubmissionId: null });
});
it("releases a carried claim after a definitive failed attempt", async () => {
  const row = await attempt();
  await reserve(row);
  await rejectSubmissionAndReleaseProductionClaims(ctx, { submissionId: row.id, expectedLockedAt: row.lockedAt!, errorMessage: "fixture failure" });
  expect((await getEmissionEntry(ctx, entry.id)).sendReservedBySubmissionId).toBeNull();
});
it("releases a carried claim when its receiving Removal is deleted", async () => {
  const row = await attempt();
  await reserve(row);
  await db.update(certificationSubmissions).set({ lockedAt: new Date(0) }).where(eq(certificationSubmissions.id, row.id));
  const claim = await claimRemovalDeletion(ctx, origin.facilityId, receiving.removalId);
  await finalizeRemovalDeletion(ctx, claim, { deletedGhgEntryIds: [], deletedBiocharApplicationIds: [], absentGhgEntryIds: [], absentBiocharApplicationIds: [], unresolvedBiocharApplicationReferences: [],
    productionBatches: (claim.productionBatches ?? []).map(batch => ({ creditBatchId: batch.creditBatchId, externalId: batch.externalProductionBatchId, outcome: "absent" as const })) });
  expect(await getEmissionEntry(ctx, entry.id)).toMatchObject({ creditBatchId: origin.batchId, sendReservedBySubmissionId: null, sentByRemovalId: null });
});
it("keeps a carried entry locked after the receiver's statement is returned", async () => {
  const row = await attempt();
  await reserve(row);
  await markSubmissionSubmitted(ctx, row.id, { externalId: "carried", expectedLockedAt: row.lockedAt!, productionEmissionsClaim: { removalId: receiving.removalId, creditBatchIds: [] } });
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: ctx.organizationId, facilityId: origin.facilityId, reportingPeriodEndOn: "2026-06-30" }).returning();
  receiving.ghgStatementId = statement.id;
  await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(eq(certifierRemovals.id, receiving.removalId));
  await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "ghg_statement", localEntityType: "ghgStatement",
    localEntityId: statement.id, version: 1, status: "submitted", externalId: "returned", submittedAt: new Date(), metadata: { remoteStatus: "FAILED_VERIFICATION", removalIds: ["carried"] } });
  const sent = await getEmissionEntry(ctx, entry.id);
  await expect(updateEmissionEntry(ctx, { id: entry.id, expectedVersion: sent.version, note: "correction" })).rejects.toThrow("reserved or sent");
});
it("locks the origin and receiving batches before waiting on the carried entry", async () => {
  const row = await attempt();
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>(resolve => { acquired = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const blocker = db.transaction(async tx => {
    await tx.select().from(emissionEntries).where(eq(emissionEntries.id, entry.id)).for("update");
    acquired();
    await held;
  });
  await ready;
  let writerPid: number | undefined;
  const onAcquire = (client: PoolClient) => { writerPid = (client as PoolClient & { processID: number }).processID; };
  db.$client.once("acquire", onAcquire);
  const sending = reserve(row);
  try {
    await vi.waitFor(async () => {
      expect(writerPid).toBeDefined();
      const [waiting] = await db.select().from(activity).where(eq(activity.pid, writerPid!));
      expect(waiting?.waitEventType).toBe("Lock");
    }, { timeout: LOCK_WAIT_MS });
    for (const id of [origin.batchId, receiving.batchId].sort()) {
      await expect(db.transaction(tx => tx.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, id))).for("update", { noWait: true }))).rejects.toThrow();
    }
  } finally {
    db.$client.off("acquire", onAcquire);
    release();
    await blocker;
    await sending;
  }
});


it("carry discovery never refreshes the registry, including a returned origin statement", async () => {
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: ctx.organizationId,
    facilityId: origin.facilityId, reportingPeriodEndOn: "2026-06-30" }).returning();
  origin.ghgStatementId = statement.id;
  await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(eq(certifierRemovals.id, origin.removalId));
  await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "ghg_statement",
    localEntityType: "ghgStatement", localEntityId: statement.id, version: 1, status: "submitted", externalId: "returned-origin", submittedAt: new Date(),
    metadata: { remoteStatus: "FAILED_VERIFICATION", submittedToVerifierAt: "2026-07-01T00:00:00Z", removalIds: ["origin-sent"] } });
  registry.getGhgStatement.mockClear();
  registry.resolveClient.mockClear();
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId)).entries.some(item => item.id === entry.id)).toBe(true);
  expect(registry.getGhgStatement).not.toHaveBeenCalled();
  expect(registry.resolveClient).not.toHaveBeenCalled();
});

it.each([true, false])("records a zero for an empty own draft when its late entry carries or waits (receiver: %s)", async hasReceiver => {
  await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityId, origin.removalId)));
  await db.update(applications).set({ applicationDate: new Date("2026-10-03T00:00:00Z") }).where(eq(applications.id, origin.applicationId));
  await db.update(emissionEntries).set({ occurredOn: "2026-10-05" }).where(eq(emissionEntries.id, entry.id));
  await db.update(applications).set({ applicationDate: new Date(hasReceiver ? "2026-10-06T00:00:00Z" : "2026-10-03T00:00:00Z") }).where(eq(applications.id, receiving.applicationId));
  const facts = await loadBatchEmissionContext(ctx, origin.facilityId, [{ id: origin.batchId, removalTemplateId: observation.externalTemplateId }],
    { templatesById: { [observation.externalTemplateId]: { observation } } });
  expect(facts.batchFacts[origin.batchId].entriesWithoutRemoval).toEqual([]);
  expect(facts.batchFacts[origin.batchId].entries.find(item => item.id === entry.id)?.carry).toMatchObject(hasReceiver
    ? { receiver: { removalId: receiving.removalId }, waitingReason: null } : { receiver: null, waitingReason: "noDraft" });
  const saved = await recordEmissionZeros(ctx, { removalId: origin.removalId, creditBatchId: origin.batchId, componentIds: ["line"] });
  expect(saved.entryIds).toHaveLength(1);
});

it("requires the origin period to end before the facility's local today", async () => {
  const [facility] = await db.select().from(facilities).where(eq(facilities.id, origin.facilityId));
  await db.update(creditBatches).set({ startDate: facilityToday(facility.timezone), endDate: facilityToday(facility.timezone) }).where(eq(creditBatches.id, origin.batchId));
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId)).entries).toEqual([]);
  await db.update(creditBatches).set({ startDate: "2026-06-01", endDate: "2026-06-30" }).where(eq(creditBatches.id, origin.batchId));
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId)).entries.some(item => item.id === entry.id)).toBe(true);
});

it.each([null, "draft"])("keeps a fully applied entry with its batch when a later application is still available (%s)", async owner => {
  await db.delete(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityId, origin.removalId)));
  if (owner === null) await db.update(creditBatchApplications).set({ removalId: null }).where(eq(creditBatchApplications.creditBatchId, origin.batchId));
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId)).entries).toEqual([]);
});


it("fails closed when the origin production mass is unknown", async () => {
  await db.update(productionRuns).set({ biocharDryMassKg: null }).where(eq(productionRuns.id, origin.productionRunId));
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId)).entries.find(item => item.id === entry.id)?.carry)
    .toEqual({ receiver: null, waitingReason: null });
});


it("keeps an expired carried reservation in the resumed frozen compilation and revalidates it", async () => {
  const row = await attempt();
  await reserve(row);
  await db.update(certificationSubmissions).set({ lockedAt: new Date(Date.now() - LOCK_TTL_MS) })
    .where(eq(certificationSubmissions.id, row.id));
  const facility = { templatesById: { [observation.externalTemplateId]: { observation } } };
  const scope = await resolveScopeForRemoval(ctx, receiving.removalId);
  const facts = await loadBatchEmissionContext(ctx, origin.facilityId, scope.memberBatches, facility,
    { claimedAttempt: { removalId: receiving.removalId }, ownedRemovalId: receiving.removalId });
  const frozen = frozenEntriesForAttempt(row, facts);
  expect(frozen).toEqual([{ entryId: entry.id, contentRevision: entry.contentRevision }]);
  const compiled = await loadRemovalEntryContext(ctx, scope, facts, facility, frozen);
  expect(compiled?.contributions.selectedEntryIds).toContain(entry.id);
  expect(compiled?.contributions.blockers.some(blocker => blocker.message.includes("Emissions entries changed"))).toBe(false);
  const discovery = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId);
  expect(discovery.entries.find(item => item.id === entry.id)).toMatchObject({
    reservationKnownInactive: true, reservedByRemovalId: receiving.removalId,
    carry: { receiver: { removalId: receiving.removalId } },
  });
  await reserve(row);
  expect((await getEmissionEntry(ctx, entry.id)).sendReservedBySubmissionId).toBe(row.id);
});

it("allows a known inactive terminal reservation back into candidate discovery", async () => {
  const row = await attempt();
  await reserve(row);
  await db.update(certificationSubmissions).set({ status: "rejected", lockedAt: null, metadata: { externalMutation: "none" } })
    .where(eq(certificationSubmissions.id, row.id));
  const discovery = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId);
  expect(discovery.entries.find(item => item.id === entry.id)).toMatchObject({
    reservationKnownInactive: true, reservedByRemovalId: null, carry: { receiver: { removalId: receiving.removalId } },
  });
});

it.each(["FAILED_VERIFICATION", null])("keeps an in-window late entry with a returned or unknown own statement (%s)", async remoteStatus => {
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: ctx.organizationId,
    facilityId: origin.facilityId, reportingPeriodEndOn: "2026-06-30" }).returning();
  origin.ghgStatementId = statement.id;
  await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(eq(certifierRemovals.id, origin.removalId));
  await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "ghg_statement",
    localEntityType: "ghgStatement", localEntityId: statement.id, version: 1, status: "submitted", externalId: "returned-origin", submittedAt: new Date(),
    metadata: { remoteStatus, submittedToVerifierAt: "2026-07-01T00:00:00Z", removalIds: ["origin-sent"] } });
  registry.getGhgStatement.mockClear();
  registry.resolveClient.mockClear();
  const own = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId);
  expect(own.entries.find(item => item.id === entry.id)?.carry).toEqual({ receiver: null, waitingReason: null });
  expect(own.ownContenders).toContainEqual(expect.objectContaining({ removalId: origin.removalId, contenderKind: "correction" }));
  // Past the own window there is no own contender, even if its statement returned.
  await db.update(applications).set({ applicationDate: new Date("2026-10-06T00:00:00Z") }).where(eq(applications.id, receiving.applicationId));
  await db.update(emissionEntries).set({ occurredOn: "2026-10-05" }).where(eq(emissionEntries.id, entry.id));
  const carried = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId);
  expect(carried.entries.find(item => item.id === entry.id)?.carry.receiver?.removalId).toBe(receiving.removalId);
  expect(registry.getGhgStatement).not.toHaveBeenCalled();
  expect(registry.resolveClient).not.toHaveBeenCalled();
});


it("does not give an expired resumable carry to a better-ranked rival Removal", async () => {
  const row = await attempt();
  await reserve(row);
  await db.update(certificationSubmissions).set({ lockedAt: new Date(Date.now() - LOCK_TTL_MS) })
    .where(eq(certificationSubmissions.id, row.id));
  const rival = await createLineageFixture("none");
  const [process] = await db.insert(productionProcesses).values({ organizationId: ctx.organizationId,
    facilityId: origin.facilityId, feedstockTypeId: rival.feedstockTypeId }).returning();
  try {
    await db.update(creditBatches).set({ facilityId: origin.facilityId, productionProcessId: process.id,
      removalTemplateId: observation.externalTemplateId }).where(eq(creditBatches.id, rival.batchId));
    await db.update(certifierRemovals).set({ facilityId: origin.facilityId, createdAt: new Date(0) }).where(eq(certifierRemovals.id, rival.removalId));
    const discovered = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId);
    expect(discovered.contenders.map(item => item.removalId)).toContain(rival.removalId);
    expect(discovered.entries.find(item => item.id === entry.id)?.carry.receiver?.removalId).toBe(receiving.removalId);
    const [rivalAttempt] = await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId,
      provider: "isometric", submissionType: "removal", localEntityType: "removal", localEntityId: rival.removalId,
      version: 1, status: "draft", lockedAt: new Date() }).returning();
    await expect(reserveProductionEmissionsClaims(ctx, { removalId: rival.removalId, submissionId: rivalAttempt.id,
      creditBatchIds: [], entryClaim: { memberBatchIds: [rival.batchId], frozenEntrySet: [{ entryId: entry.id, contentRevision: entry.contentRevision }] },
    })).rejects.toThrow("Emissions entries changed");
    expect((await getEmissionEntry(ctx, entry.id)).sendReservedBySubmissionId).toBe(row.id);
  } finally {
    await db.update(creditBatches).set({ facilityId: rival.facilityId, productionProcessId: rival.productionProcessId }).where(eq(creditBatches.id, rival.batchId));
    await db.update(certifierRemovals).set({ facilityId: rival.facilityId }).where(eq(certifierRemovals.id, rival.removalId));
    await db.delete(productionProcesses).where(eq(productionProcesses.id, process.id));
    await cleanupLineageFixture(rival);
  }
});

it.each([0, 0.001, MIN_VISIBLE_NOT_APPLIED_DRY_KG - 0.001, MIN_VISIBLE_NOT_APPLIED_DRY_KG, MIN_VISIBLE_NOT_APPLIED_DRY_KG + 0.001])(
  "elects a carry receiver only at zero remaining mass (%s dry kg remaining)", async remaining => {
    const [slice] = await db.select().from(creditBatchApplications).where(and(
      eq(creditBatchApplications.organizationId, ctx.organizationId), eq(creditBatchApplications.creditBatchId, origin.batchId),
    ));
    await db.update(productionRuns).set({ biocharDryMassKg: slice.allocatedDryMassKg + remaining }).where(and(
      eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, origin.productionRunId),
    ));
    const loaded = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId);
    expect(loaded.entries.find(item => item.id === entry.id)?.carry.receiver?.removalId ?? null)
      .toBe(remaining === 0 ? receiving.removalId : null);
  },
);


it("the narrow sheet read equals full-context selection for a real draft carry candidate", async () => {
  const scope = await resolveScopeForRemoval(ctx, receiving.removalId);
  const facility = { templatesById: { [observation.externalTemplateId]: { observation } } };
  const facts = await loadBatchEmissionContext(ctx, scope.facilityId, scope.memberBatches, facility,
    { ownedRemovalId: receiving.removalId });
  const full = await loadRemovalEntryContext(ctx, scope, facts, facility);
  const { carriedEntries: narrow, lateEntries } = await loadRemovalCarriedEntries(ctx, receiving.removalId);
  expect(lateEntries).toEqual([]);
  expect(narrow.map(item => item.entryId)).toEqual([entry.id]);
  expect(narrow).toEqual(full!.contributions.carriedEntries);
});

it("the narrow sent read preserves the full-context carried list and its frozen values", async () => {
  const scope = await resolveScopeForRemoval(ctx, receiving.removalId);
  const facility = { templatesById: { [observation.externalTemplateId]: { observation } } };
  const facts = await loadBatchEmissionContext(ctx, scope.facilityId, scope.memberBatches, facility,
    { ownedRemovalId: receiving.removalId });
  const full = await loadRemovalEntryContext(ctx, scope, facts, facility);
  expect(full!.contributions.carriedEntries!.map(item => item.entryId)).toEqual([entry.id]);
  await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal",
    localEntityType: "removal", localEntityId: receiving.removalId, version: 1, status: "submitted", submittedAt: new Date(),
    payloadSnapshot: { templateObservationId: observation.id, semantic: { carriedEntries: normalizeCarriedEntriesForHash(full!.contributions.carriedEntries) } },
  });
  await db.update(emissionEntryValues).set({ magnitude: "999" }).where(and(
    eq(emissionEntryValues.organizationId, ctx.organizationId), eq(emissionEntryValues.entryId, entry.id)));
  expect((await loadRemovalCarriedEntries(ctx, receiving.removalId)).carriedEntries).toEqual(
    full!.contributions.carriedEntries!.map(item => ({ ...item, value: { magnitude: item.value.magnitude, unit: item.value.unit } })));
});

it.each(["FAILED_VERIFICATION", "DRAFT", null].flatMap(status => ["additive", "single"].map(lineRule => ({ status, lineRule }))))(
  "discovers the own-batch revision from persisted returned lineage ($status, $lineRule)", async ({ status, lineRule }) => {
  const occurredOn = lineRule === "single" ? "2026-06-01" : "2026-06-10";
  if (lineRule === "single") {
    await db.update(removalTemplateObservations).set({
      lineSources: { line: { scope: "operating", entryPolicy: "single", origin: "reviewed" } },
    }).where(and(eq(removalTemplateObservations.organizationId, ctx.organizationId), eq(removalTemplateObservations.id, observation.id)));
    await db.update(emissionEntries).set({ lineRule: "single", occurredOn }).where(and(
      eq(emissionEntries.organizationId, ctx.organizationId), eq(emissionEntries.id, entry.id),
    ));
  }
  // A sent snapshot is frozen, so the origin attempt is recreated as sent before the entry was recorded.
  await db.delete(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, ctx.organizationId), eq(certificationSubmissions.localEntityId, origin.removalId),
    eq(certificationSubmissions.submissionType, "removal"),
  ));
  await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "removal",
    localEntityType: "removal", localEntityId: origin.removalId, version: 1, status: "submitted", submittedAt: new Date("2026-07-01"),
    externalId: "origin-sent", payloadSnapshot: { semantic: {} } });
  const [statement] = await db.insert(certifierGhgStatements).values({ organizationId: ctx.organizationId,
    facilityId: origin.facilityId, reportingPeriodEndOn: "2026-06-30" }).returning();
  origin.ghgStatementId = statement.id;
  await db.update(certifierRemovals).set({ ghgStatementId: statement.id }).where(and(
    eq(certifierRemovals.organizationId, ctx.organizationId), eq(certifierRemovals.id, origin.removalId),
  ));
  await db.insert(certificationSubmissions).values({ organizationId: ctx.organizationId, provider: "isometric", submissionType: "ghg_statement",
    localEntityType: "ghgStatement", localEntityId: statement.id, version: 1, status: "submitted", externalId: "returned-origin", submittedAt: new Date(),
    metadata: { remoteStatus: status, submittedToVerifierAt: "2026-07-02T00:00:00Z", removalIds: ["origin-sent"] } });
  registry.getGhgStatement.mockClear(); registry.resolveClient.mockClear();
  const discovery = await loadFacilityEmissionEntryCarry(ctx, origin.facilityId, db, undefined, { ownedBatchIds: [origin.batchId] });
  const discovered = discovery.entries.find(item => item.id === entry.id)!;
  expect(discovery.ownContenders).toContainEqual(expect.objectContaining({ contenderKind: "correction", removalId: origin.removalId }));
  expect(discovered.carry).toMatchObject({ receiver: null, waitingReason: null });
  expect(discovered.revisionOf).toEqual(status ? { removalId: origin.removalId, removalCode: discovered.earlierRemovalCode } : null);
  const own = await loadRemovalCarriedEntries(ctx, origin.removalId);
  expect(own.carriedEntries).toEqual([]);
  expect(own.lateEntries.map(item => item.entryId)).toEqual(status ? [entry.id] : []);
  if (status) expect(own.lateEntries[0]).toMatchObject({ creditBatchId: origin.batchId, componentName: "Electricity",
    occurredOn, value: { magnitude: "120", unit: "kWh" }, earlierRemovalId: origin.removalId });
  expect((await loadRemovalCarriedEntries(ctx, receiving.removalId)).carriedEntries).toEqual([]);
  expect(registry.getGhgStatement).not.toHaveBeenCalled();
  expect(registry.resolveClient).not.toHaveBeenCalled();
});
