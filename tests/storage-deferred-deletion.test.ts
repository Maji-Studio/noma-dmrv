import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storageObjectDeletions } from "@/db/schema";
import { enqueueStorageObjectDeletion, processPendingStorageObjectDeletions } from "@/data-access/storage-object-deletions";
import { __setStorageProviderForTests } from "@/lib/storage";
import { RetirementStorageProvider } from "./helpers/document-retirement";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
const ctx = makeTestOrgContext();
it("does not drain a deferred key even after a late PUT; drains when due", async () => {
  await ensureTestOrg(); const provider = new RetirementStorageProvider(); __setStorageProviderForTests(provider);
  const key = `org/${ctx.organizationId}/uploads/deferred/${Date.now()}`;
  try {
    await db.transaction((tx) => enqueueStorageObjectDeletion(ctx, tx, { storageProvider: provider.name, storageBucket: provider.bucket, storageKey: key, notBefore: new Date(Date.now() + 60_000) }));
    await processPendingStorageObjectDeletions(ctx);
    await provider.putObject(key);
    await processPendingStorageObjectDeletions(ctx);
    expect(provider.deleteCalls).not.toContain(key); expect(provider.objects.has(key)).toBe(true);
    await db.update(storageObjectDeletions).set({ notBefore: new Date(0) }).where(and(eq(storageObjectDeletions.organizationId, ctx.organizationId), eq(storageObjectDeletions.storageKey, key)));
    await processPendingStorageObjectDeletions(ctx);
    expect(provider.deleteCalls).toContain(key); expect(provider.objects.has(key)).toBe(false);
  } finally {
    __setStorageProviderForTests(null);
    await db.delete(storageObjectDeletions).where(eq(storageObjectDeletions.storageKey, key));
  }
});

it("bounds a stalled deletion and leaves subsequent entries queued", async () => {
  const { organizations } = await import("@/db/schema");
  const organizationId = `drain-budget-${crypto.randomUUID()}`;
  const scoped = { ...ctx, organizationId };
  await db.insert(organizations).values({ id: organizationId, name: "Drain budget", slug: organizationId });
  const provider = new RetirementStorageProvider();
  let started = 0;
  provider.deleteObject = async () => { started++; await new Promise<void>(() => {}); };
  __setStorageProviderForTests(provider);
  const budgetMs = 100;
  const schedulingToleranceMs = 500;
  try {
    for (const storageKey of ["slow", "next"]) await db.transaction((tx) => enqueueStorageObjectDeletion(scoped, tx, { storageProvider: provider.name, storageBucket: provider.bucket, storageKey }));
    const began = Date.now();
    const result = await processPendingStorageObjectDeletions(scoped, { budgetMs });
    expect(result).toEqual({ completed: 0, failed: 0, deferred: 1 });
    expect(Date.now() - began).toBeLessThan(budgetMs + schedulingToleranceMs);
    expect(started).toBe(1);
    const rows = await db.select().from(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, organizationId));
    expect(rows.every((row) => row.completedAt === null)).toBe(true);
    expect(rows.filter((row) => row.attemptCount === 0)).toHaveLength(1);
    expect(rows.find((row) => row.storageKey === "slow")).toMatchObject({ attemptCount: 1, lastAttemptAt: expect.any(Date), lastErrorCode: "DEADLINE" });
    expect(rows.find((row) => row.storageKey === "next")).toMatchObject({ attemptCount: 0, lastAttemptAt: null, lastErrorCode: null });
  } finally {
    __setStorageProviderForTests(null);
    await db.delete(storageObjectDeletions).where(eq(storageObjectDeletions.organizationId, organizationId));
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
});
