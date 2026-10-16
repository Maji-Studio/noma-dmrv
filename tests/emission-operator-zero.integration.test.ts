import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certificationSubmissions, creditBatches, emissionEntries, emissionEntryValues, removalTemplateObservations, users } from "@/db/schema";
import { createEmissionEntry, markNothingToRecord, updateEmissionEntry, deleteEmissionEntry } from "@/data-access/emission-entries";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import { loadFacilityEmissionEntryFlows } from "@/data-access/emission-entry-energy";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
import { formatFacilityDate } from "@/lib/date-utils";
import { facilities, productionRuns } from "@/db/schema";

const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({
  emissionsEntriesEnabled: () => gate.enabled,
  requireEmissionsEntriesEnabled: () => { if (!gate.enabled) throw new Error("Disabled"); },
}));
const userId = `operator-zero-${crypto.randomUUID()}`;
const ctx = makeTestOrgContext(userId);
const templateId = `operator-zero-${crypto.randomUUID()}`;
let fixture: LineageFixture;
const entryIds: string[] = [];
const submissionIds: string[] = [];
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values({ id: userId, name: "Zero fixture", email: `${userId}@example.test`, emailVerified: true });
  fixture = await createLineageFixture("none");
  await db.insert(removalTemplateObservations).values({
    organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project", externalTemplateId: templateId,
    semanticFingerprint: "zero", fullFingerprint: "zero",
    definition: { groups: [{ id: "g", key: "pyrolysis", displayName: "Group", description: "",
      components: ["lab", "site"].map(id => ({ id, displayName: id, description: null, blueprintKey: "grid_electricity_use",
        inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }] })),
    }] },
    enrichment: { lab: { electricity_use: { unit: "kWh" } }, site: { electricity_use: { unit: "kWh" } } },
    lineSources: {
      lab: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
      site: { scope: "operating", entryPolicy: "additive", origin: "reviewed", automaticSource: "run-electricity" },
    },
  }).returning();
  await db.update(creditBatches).set({ removalTemplateId: templateId }).where(eq(creditBatches.id, fixture.batchId));
});
afterEach(async () => {
  gate.enabled = true;
  if (entryIds.length) {
    await db.delete(emissionEntryValues).where(inArray(emissionEntryValues.entryId, entryIds));
    await db.delete(emissionEntries).where(inArray(emissionEntries.id, entryIds));
    entryIds.length = 0;
  }
  if (submissionIds.length) {
    await db.delete(certificationSubmissions).where(inArray(certificationSubmissions.id, submissionIds));
    submissionIds.length = 0;
  }
});
afterAll(async () => {
  if (fixture) await cleanupLineageFixture(fixture);
  await db.delete(removalTemplateObservations).where(eq(removalTemplateObservations.externalTemplateId, templateId));
  await db.delete(activityEvents).where(eq(activityEvents.actorUserId, userId));
  await db.delete(users).where(eq(users.id, userId));
});
const input = () => ({ facilityId: fixture.facilityId, creditBatchId: fixture.batchId, componentId: "lab", note: "  No lab work.  " });
async function zero() {
  const row = await markNothingToRecord(ctx, input());
  entryIds.push(row.id);
  return row;
}
async function value(componentId = "lab") {
  const row = await createEmissionEntry(ctx, { creditBatchId: fixture.batchId, componentId, occurredOn: "2026-06-13",
    values: [{ inputKey: "electricity_use", quantityKind: "energy", magnitude: "7", unit: "kWh" }] });
  entryIds.push(row.id);
  return row;
}
it("creates, edits and deletes an evidence-free operator zero using the facility day", async () => {
  const row = await zero();
  const [facility] = await db.select().from(facilities).where(eq(facilities.id, fixture.facilityId));
  expect(row).toMatchObject({ note: "No lab work.", confirmedForRemovalId: null, values: [], occurredOn: formatFacilityDate(new Date(), facility.timezone) });
  const lines = await loadBatchEmissionLines(ctx, fixture.facilityId, fixture.batchId);
  expect(lines.find(line => line.componentId === "lab")).toMatchObject({ state: "confirmedZero", entries: [expect.objectContaining({ note: "No lab work.", confirmedForRemovalId: null })] });
  expect(lines.find(line => line.componentId === "lab")?.blocker).toBeUndefined();
  await expect(updateEmissionEntry(ctx, { id: row.id, expectedVersion: row.version, note: "  " })).rejects.toThrow("Enter a note");
  const saved = await updateEmissionEntry(ctx, { id: row.id, expectedVersion: row.version, note: "  No samples. ", occurredOn: "2026-06-14" });
  expect(saved).toMatchObject({ note: "No samples.", occurredOn: "2026-06-14", version: 2, contentRevision: 2 });
  await expect(deleteEmissionEntry(ctx, row.id, 1)).rejects.toMatchObject({ code: "stale_version" });
  await deleteEmissionEntry(ctx, row.id, saved.version);
  expect((await loadBatchEmissionLines(ctx, fixture.facilityId, fixture.batchId)).find(line => line.componentId === "lab")?.state).toBe("empty");
});
it("refuses duplicates, blank notes and wrong-facility writes; the database enforces note and uniqueness", async () => {
  await expect(markNothingToRecord(ctx, { ...input(), note: " \t\n" })).rejects.toThrow("Enter a note");
  await expect(markNothingToRecord(ctx, { ...input(), facilityId: crypto.randomUUID() })).rejects.toThrow();
  const row = await zero();
  await expect(markNothingToRecord(ctx, input())).rejects.toThrow("already marked");
  const [persisted] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, row.id));
  await expect(db.insert(emissionEntries).values({ ...persisted, id: crypto.randomUUID() })).rejects.toThrow();
  await expect(db.update(emissionEntries).set({ note: " \t\n" }).where(eq(emissionEntries.id, row.id))).rejects.toThrow();
});
it("atomically replaces a zero with a value and captures its deletion without the note", async () => {
  const row = await zero();
  await value();
  const [stored] = await db.select().from(emissionEntries).where(eq(emissionEntries.id, row.id));
  expect(stored.deletedAt).not.toBeNull();
  const events = await db.select().from(activityEvents).where(and(eq(activityEvents.entityId, row.id), eq(activityEvents.action, "deleted")));
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events, (_key, value) => typeof value === "bigint" ? String(value) : value)).not.toContain("No lab work.");
  await expect(markNothingToRecord(ctx, input())).rejects.toThrow("This line has entries.");
});
it("serializes simultaneous operator-zero creates", async () => {
  const results = await Promise.allSettled([markNothingToRecord(ctx, input()), markNothingToRecord(ctx, input())]);
  for (const result of results) if (result.status === "fulfilled") entryIds.push(result.value.id);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
});
it.each(["reserved", "sent"])("refuses zero edits, deletion and replacement while %s", async kind => {
  const row = await zero();
  const [submission] = await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: "isometric",
    submissionType: "removal", localEntityType: "removal", localEntityId: fixture.removalId }).returning();
  submissionIds.push(submission.id);
  await db.update(emissionEntries).set(kind === "sent" ? { sentByRemovalId: fixture.removalId } : { sendReservedBySubmissionId: submission.id }).where(eq(emissionEntries.id, row.id));
  await expect(updateEmissionEntry(ctx, { id: row.id, expectedVersion: 1, note: "Blocked" })).rejects.toThrow("reserved or sent");
  await expect(deleteEmissionEntry(ctx, row.id, 1)).rejects.toThrow("reserved or sent");
  await expect(value()).rejects.toThrow("reserved or sent");
  expect(await db.select().from(emissionEntries).where(and(eq(emissionEntries.creditBatchId, fixture.batchId), eq(emissionEntries.kind, "value")))).toEqual([]);
});
it("adds only counting site entries to org-scoped facility energy, with the flag off unchanged", async () => {
  const site = await value("site");
  await value("lab");
  expect(await loadFacilityEmissionEntryFlows(ctx, fixture.facilityId)).toEqual([
    { source: "grid", creditBatchId: fixture.batchId, day: "2026-06-13", activity: 7 },
  ]);
  await expect(loadFacilityEmissionEntryFlows({ ...ctx, organizationId: "foreign-org" }, fixture.facilityId)).rejects.toThrow();
  gate.enabled = false;
  expect(await loadFacilityEmissionEntryFlows(ctx, fixture.facilityId)).toEqual([]);
  gate.enabled = true;
  await deleteEmissionEntry(ctx, site.id, site.version);
  expect(await loadFacilityEmissionEntryFlows(ctx, fixture.facilityId)).toEqual([]);
  // A valid zero on the manual line contributes no energy either.
  const [lab] = await db.select().from(emissionEntries).where(and(eq(emissionEntries.creditBatchId, fixture.batchId), eq(emissionEntries.componentId, "lab")));
  await deleteEmissionEntry(ctx, lab.id, lab.version);
  await zero();
  expect(await loadFacilityEmissionEntryFlows(ctx, fixture.facilityId)).toEqual([]);
});

it("refuses a positive automatic figure and accepts a recorded zero figure", async () => {
  await db.update(productionRuns).set({ electricityKwh: 3 }).where(eq(productionRuns.id, fixture.productionRunId));
  await expect(markNothingToRecord(ctx, { ...input(), componentId: "site" })).rejects.toThrow("records from production runs");
  await db.update(productionRuns).set({ electricityKwh: 0 }).where(eq(productionRuns.id, fixture.productionRunId));
  const row = await markNothingToRecord(ctx, { ...input(), componentId: "site" });
  entryIds.push(row.id);
  expect((await loadBatchEmissionLines(ctx, fixture.facilityId, fixture.batchId)).find(line => line.componentId === "site")?.state).toBe("confirmedZero");
});
