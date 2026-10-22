/** Real database contracts. Run only in the configured throwaway test database. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { integer, pgSchema, text } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
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

vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => ({ status: "FAILED_VERIFICATION", submitted_at: "2099-01-01T00:00:00Z", ghg_entry_ids: ["carried"] }) }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));
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
  await reserve(row);
  const reserved = await getEmissionEntry(ctx, entry.id);
  expect((await loadFacilityEmissionEntryCarry(ctx, origin.facilityId)).entries.find(item => item.id === entry.id)?.carry.receiver?.removalId).toBe(receiving.removalId);
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
