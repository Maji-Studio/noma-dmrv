/** Real PostgreSQL contract test. Run only against the migrated throwaway DB. */
import { afterAll, beforeAll, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions } from "@/db/schema/certification";
import { ensureTestOrg, TEST_ORG_ID } from "./helpers/test-org";

const ids: string[] = [];
beforeAll(async () => { await ensureTestOrg(); });
afterAll(async () => {
  if (ids.length) await db.delete(certificationSubmissions).where(and(
    eq(certificationSubmissions.organizationId, TEST_ORG_ID), inArray(certificationSubmissions.id, ids),
  ));
});
it.each(["submitted", "accepted", "rejected", "superseded"] as const)("freezes payload after %s, including status reversal", async (status) => {
  const [row] = await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: "isometric",
    submissionType: "removal", localEntityType: "removal", localEntityId: crypto.randomUUID(),
    payloadSnapshot: { frozenEntrySet: [{ entryId: "entry", contentRevision: 1 }] }, status: "draft" }).returning();
  ids.push(row.id);
  const where = and(eq(certificationSubmissions.id, row.id), eq(certificationSubmissions.organizationId, TEST_ORG_ID));
  // Recovery journals are legal while the attempt is a draft.
  const snapshot = { frozenEntrySet: [{ entryId: "entry", contentRevision: 1 }], journaled: { sample: "remote" } };
  await db.update(certificationSubmissions).set({ payloadSnapshot: snapshot }).where(where);
  await db.update(certificationSubmissions).set({ status }).where(where);
  await expect(db.update(certificationSubmissions).set({ payloadSnapshot: { changed: true } }).where(where)).rejects.toThrow();
  await expect(db.update(certificationSubmissions).set({ status: "draft", payloadSnapshot: {} }).where(where)).rejects.toThrow();
  // Metadata/status maintenance and writing an identical JSON value stay legal.
  await db.update(certificationSubmissions).set({ metadata: { checked: true }, payloadSnapshot: snapshot }).where(where);
  // Resetting a rejected attempt to draft must not unfreeze its original snapshot.
  await db.update(certificationSubmissions).set({ status: "draft", metadata: {}, payloadSnapshotFrozen: false }).where(where);
  await expect(db.update(certificationSubmissions).set({ payloadSnapshot: {} }).where(where)).rejects.toThrow();
  // Recovery journals stay writable after the freeze (durability measurement retries).
  const journaled = { ...snapshot, journaled: { sample: "remote", recovered: "remote-2" } };
  await db.update(certificationSubmissions).set({ payloadSnapshot: journaled }).where(where);
  await expect(db.update(certificationSubmissions).set({
    payloadSnapshot: { ...journaled, frozenEntrySet: [] },
  }).where(where)).rejects.toThrow();
  const [stored] = await db.select().from(certificationSubmissions).where(where);
  expect(stored.payloadSnapshot).toEqual(journaled);
  expect(stored.payloadSnapshotFrozen).toBe(true);
});
