import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, creditBatches, emissionLineComments, organizations, removalTemplateObservations, users } from "@/db/schema";
import {
  setEmissionLineComment, deleteEmissionLineComment, getEmissionLineComment,
  listEmissionLineComments, listEmissionLineCommentsForBatches,
} from "@/data-access/emission-line-comments";
import { loadBatchEmissionLines } from "@/lib/read-models/batch-emission-lines";
import { loadFacilityEmissionsOverview } from "@/lib/read-models/facility-emissions-overview";
import type { EntryObservation } from "@/lib/certification/emission-entry-rules";
import { createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/config/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/config/env")>();
  return { ...original, env: { ...original.env, get EMISSIONS_ENTRIES_ENABLED() { return flag.enabled; } } };
});

const userId = `line-comment-user-${crypto.randomUUID()}`;
const editorId = `line-comment-editor-${crypto.randomUUID()}`;
const otherOrg = `line-comment-org-${crypto.randomUUID()}`;
const ctx = makeTestOrgContext(userId);
const foreignCtx = { ...ctx, organizationId: otherOrg };
const templateId = `line-comment-template-${crypto.randomUUID()}`;
let lineage: LineageFixture;
let otherBatch: LineageFixture;
let observationId: string;
function observation(): EntryObservation {
  return {
    externalTemplateId: templateId,
    definition: { groups: [{ id: "group", key: "pyrolysis", displayName: "Group", description: "",
      components: ["energy", "other"].map((id) => ({
        id, displayName: id, description: null, blueprintKey: "grid_electricity_use",
        inputs: [{ key: "electricity_use", type: "monitored", quantityKind: "energy" }],
      })),
    }] },
    enrichment: { energy: { electricity_use: { unit: "kWh" } }, other: { electricity_use: { unit: "kWh" } } },
    lineSources: {
      energy: { scope: "operating", entryPolicy: "additive", origin: "reviewed" },
      // A comment is valid even on a line that cannot take entries.
      other: { scope: "unassigned", entryPolicy: "none", origin: "reviewed" },
    },
  };
}
function input(componentId = "energy") {
  return { facilityId: lineage.facilityId, creditBatchId: lineage.batchId, componentId, body: "  First wording  " };
}
async function commentEvents(id: string) {
  return db.select().from(activityEvents).where(and(
    eq(activityEvents.organizationId, ctx.organizationId),
    eq(activityEvents.entityType, "emission_line_comment"), eq(activityEvents.entityId, id),
  )).orderBy(asc(activityEvents.sequence));
}

beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(users).values([userId, editorId].map((id) => ({ id, name: "Comment fixture", email: `${id}@example.test`, emailVerified: true })));
  await db.insert(organizations).values({ id: otherOrg, name: "Comment foreign fixture", slug: otherOrg });
  // Includes a submitted Removal, proving comments ignore the record-lock gate.
  lineage = await createLineageFixture("removal");
  otherBatch = await createLineageFixture("none");
  const [stored] = await db.insert(removalTemplateObservations).values({
    organizationId: TEST_ORG_ID, provider: "isometric", externalProjectId: "project", ...observation(),
    semanticFingerprint: "initial", fullFingerprint: "initial",
  }).returning();
  observationId = stored.id;
  await db.update(creditBatches).set({ removalTemplateId: templateId }).where(and(
    eq(creditBatches.organizationId, TEST_ORG_ID), inArray(creditBatches.id, [lineage.batchId, otherBatch.batchId]),
  ));
});
beforeEach(async () => {
  flag.enabled = true;
  await db.delete(emissionLineComments).where(and(
    eq(emissionLineComments.organizationId, TEST_ORG_ID),
    inArray(emissionLineComments.creditBatchId, [lineage.batchId, otherBatch.batchId]),
  ));
});
afterAll(async () => {
  if (lineage && otherBatch) await db.delete(emissionLineComments).where(and(
    eq(emissionLineComments.organizationId, TEST_ORG_ID), inArray(emissionLineComments.creditBatchId, [lineage.batchId, otherBatch.batchId]),
  ));
  if (lineage) await cleanupLineageFixture(lineage);
  if (otherBatch) await cleanupLineageFixture(otherBatch);
  await db.delete(removalTemplateObservations).where(and(
    eq(removalTemplateObservations.organizationId, TEST_ORG_ID), eq(removalTemplateObservations.externalTemplateId, templateId),
  ));
  await db.delete(activityEvents).where(inArray(activityEvents.actorUserId, [userId, editorId]));
  await db.delete(users).where(inArray(users.id, [userId, editorId]));
  await db.delete(organizations).where(eq(organizations.id, otherOrg));
});

it("creates, edits with a version, conflicts, and hard deletes while retaining wording in batch activity", async () => {
  const created = await setEmissionLineComment(ctx, input());
  expect(created).toMatchObject({ body: "First wording", version: 1, createdBy: userId, updatedBy: userId });
  expect(await getEmissionLineComment(ctx, created.id)).toEqual(created);
  expect(await listEmissionLineComments(ctx, lineage.batchId)).toEqual([created]);
  await expect(setEmissionLineComment(ctx, input())).rejects.toMatchObject({ code: "conflict" });
  const edited = await setEmissionLineComment({ ...ctx, userId: editorId }, { ...input(), body: "  Second wording  ", id: created.id, expectedVersion: 1 });
  expect(edited).toMatchObject({ id: created.id, body: "Second wording", version: 2, createdBy: userId, updatedBy: editorId });
  await expect(setEmissionLineComment(ctx, { ...input(), id: created.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "stale_version" });
  await expect(deleteEmissionLineComment(ctx, { facilityId: lineage.facilityId, id: created.id, expectedVersion: 1 }))
    .rejects.toMatchObject({ code: "stale_version" });
  expect(await deleteEmissionLineComment(ctx, { id: created.id, expectedVersion: 2 })).toEqual({ id: created.id });
  expect(await listEmissionLineComments(ctx, lineage.batchId)).toEqual([]);
  await expect(getEmissionLineComment(ctx, created.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(setEmissionLineComment(ctx, { ...input(), id: created.id, expectedVersion: 2 })).rejects.toMatchObject({ code: "stale_version" });
  // A stale edit of the deleted comment must not overwrite the comment that replaced it.
  const replacement = await setEmissionLineComment(ctx, { ...input(), body: "Replacement wording" });
  await expect(setEmissionLineComment(ctx, { ...input(), body: "Stale wording", id: created.id, expectedVersion: 1 }))
    .rejects.toMatchObject({ code: "stale_version" });
  expect(await getEmissionLineComment(ctx, replacement.id)).toMatchObject({ body: "Replacement wording", version: 1 });
  await deleteEmissionLineComment(ctx, { id: replacement.id, expectedVersion: 1 });
  const events = await commentEvents(created.id);
  expect(events.map((event) => event.action)).toEqual(["created", "updated", "deleted"]);
  expect(events.every((event) => event.creditBatchId === lineage.batchId)).toBe(true);
  expect(events[0].changes.body).toEqual({ from: null, to: "First wording" });
  expect(events[1].changes.body).toEqual({ from: "First wording", to: "Second wording" });
  expect(events[1].changedFields).toEqual(["body"]);
});

it("serializes competing creates into one success and one conflict", async () => {
  const outcomes = await Promise.allSettled([setEmissionLineComment(ctx, input()), setEmissionLineComment(ctx, input())]);
  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === "rejected")).toMatchObject({ reason: { code: "conflict" } });
  expect(await listEmissionLineComments(ctx, lineage.batchId)).toHaveLength(1);
});

it("rejects unknown lines and mismatched facilities without activity or mutations", async () => {
  await expect(setEmissionLineComment(ctx, input("unknown"))).rejects.toMatchObject({ code: "validation_failed" });
  await expect(setEmissionLineComment(ctx, { ...input(), facilityId: otherBatch.facilityId })).rejects.toMatchObject({ code: "not_found" });
  expect(await listEmissionLineComments(ctx, lineage.batchId)).toEqual([]);
  const created = await setEmissionLineComment(ctx, input());
  await expect(setEmissionLineComment(ctx, { ...input(), facilityId: otherBatch.facilityId, id: created.id, expectedVersion: created.version }))
    .rejects.toMatchObject({ code: "not_found" });
  await expect(deleteEmissionLineComment(ctx, { facilityId: otherBatch.facilityId, id: created.id, expectedVersion: created.version }))
    .rejects.toMatchObject({ code: "not_found" });
  expect(await getEmissionLineComment(ctx, created.id)).toEqual(created);
  expect(await commentEvents(created.id)).toHaveLength(1);
});

it("isolates reads and writes across organizations with a composite FK backstop", async () => {
  const created = await setEmissionLineComment(ctx, input());
  expect(await listEmissionLineComments(foreignCtx, lineage.batchId)).toEqual([]);
  expect(await listEmissionLineCommentsForBatches(foreignCtx, [lineage.batchId, otherBatch.batchId])).toEqual([]);
  expect(await listEmissionLineCommentsForBatches(ctx, [])).toEqual([]);
  await expect(getEmissionLineComment(foreignCtx, created.id)).rejects.toMatchObject({ code: "not_found" });
  await expect(setEmissionLineComment(foreignCtx, { ...input(), id: created.id, expectedVersion: created.version })).rejects.toMatchObject({ code: "not_found" });
  await expect(setEmissionLineComment(foreignCtx, input("other"))).rejects.toMatchObject({ code: "not_found" });
  await expect(deleteEmissionLineComment(foreignCtx, { id: created.id, expectedVersion: created.version })).rejects.toMatchObject({ code: "not_found" });
  await expect(db.insert(emissionLineComments).values({ ...created, id: crypto.randomUUID(), organizationId: otherOrg })).rejects.toThrow();
  expect(await getEmissionLineComment(ctx, created.id)).toEqual(created);
  expect(await commentEvents(created.id)).toHaveLength(1);
});

it("enforces uniqueness and a nonblank body in the database", async () => {
  const created = await setEmissionLineComment(ctx, input());
  await expect(db.insert(emissionLineComments).values({ ...created, id: crypto.randomUUID() })).rejects.toThrow();
  await expect(db.insert(emissionLineComments).values({ ...created, id: crypto.randomUUID(), componentId: "other", body: "   " })).rejects.toThrow();
});

it("joins only matching current-template lines and keeps all derived emissions facts unchanged", async () => {
  const before = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  const overview = await loadFacilityEmissionsOverview(ctx, lineage.facilityId);
  const created = await setEmissionLineComment(ctx, input());
  const other = await setEmissionLineComment(ctx, input("other"));
  await setEmissionLineComment(ctx, { ...input(), facilityId: otherBatch.facilityId, creditBatchId: otherBatch.batchId, body: "Other batch" });
  const lines = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
  expect(lines.find((line) => line.componentId === "energy")?.comment).toEqual({
    id: created.id, body: created.body, version: created.version, updatedAt: created.updatedAt, updatedBy: userId,
  });
  expect(lines.find((line) => line.componentId === "other")?.comment?.id).toBe(other.id);
  expect(lines.map((line) => ({ ...line, comment: null }))).toEqual(before);
  expect(await loadFacilityEmissionsOverview(ctx, lineage.facilityId)).toEqual(overview);
  expect(await listEmissionLineCommentsForBatches(ctx, [lineage.batchId, otherBatch.batchId])).toHaveLength(3);
  const source = observation();
  source.definition.groups[0].components = source.definition.groups[0].components.filter((component) => component.id !== "energy");
  await db.update(removalTemplateObservations).set({ definition: source.definition }).where(eq(removalTemplateObservations.id, observationId));
  try {
    const after = await loadBatchEmissionLines(ctx, lineage.facilityId, lineage.batchId);
    expect(after.some((line) => line.comment?.id === created.id)).toBe(false);
    expect(await getEmissionLineComment(ctx, created.id)).toEqual(created);
    // Deletion still works after a template removes the component.
    await deleteEmissionLineComment(ctx, { id: created.id, expectedVersion: created.version });
  } finally {
    await db.update(removalTemplateObservations).set({ definition: observation().definition }).where(eq(removalTemplateObservations.id, observationId));
  }
});

it("reads saved comments with the flag off and refuses both writes", async () => {
  const created = await setEmissionLineComment(ctx, input());
  flag.enabled = false;
  try {
    expect(await getEmissionLineComment(ctx, created.id)).toEqual(created);
    await expect(setEmissionLineComment(ctx, { ...input(), id: created.id, expectedVersion: created.version })).rejects.toThrow("not available");
    await expect(deleteEmissionLineComment(ctx, { id: created.id, expectedVersion: created.version })).rejects.toThrow("not available");
  } finally {
    flag.enabled = true;
  }
});
