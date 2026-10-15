import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn(), delete: vi.fn(), patch: vi.fn(), error: vi.fn(), condition: undefined as unknown }));
vi.mock("@/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("@/lib/storage", () => ({ getStorageProvider: () => ({ name: "local-fs", bucket: "current-bucket", deleteObject: mocks.delete }) }));
vi.mock("@/lib/log", () => ({ logger: { error: mocks.error, child: () => ({ error: mocks.error }) } }));
import { drainStorageObjectDeletionsAcrossOrganizations } from "./storage-object-deletions";
const BUDGET_MS = 100;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  const batches = [[{ id: "deletion", organizationId: "org" }], []];
  mocks.select.mockImplementation(() => ({ from: () => ({ where: (condition: unknown) => {
    mocks.condition = condition;
    return { orderBy: () => ({ limit: async () => batches.shift() ?? [] }) };
  } }) }));
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: "deletion", organizationId: "org", storageProvider: "local-fs", storageBucket: "current-bucket", storageKey: "private-key" }] }) }) }),
    update: () => ({ set: (patch: unknown) => { mocks.patch(patch); return { where: async () => {} }; } }),
  };
  mocks.transaction.mockImplementation((fn) => fn(tx));
});
afterEach(() => vi.useRealTimers());
it("defers a stalled deletion and records an attempt for backoff without a failure", async () => {
  const attemptedAt = new Date();
  mocks.delete.mockImplementation(() => new Promise<void>(() => {}));
  const draining = drainStorageObjectDeletionsAcrossOrganizations(BUDGET_MS);
  await vi.advanceTimersByTimeAsync(BUDGET_MS);
  expect(await draining).toEqual({ completed: 0, failed: 0, deferred: 1 });
  expect(mocks.patch).toHaveBeenCalledOnce();
  expect(mocks.patch).toHaveBeenCalledWith(expect.objectContaining({ lastAttemptAt: attemptedAt, lastErrorCode: "DEADLINE" }));
  const patch = mocks.patch.mock.calls[0][0];
  const increment = new PgDialect().sqlToQuery(patch.attemptCount);
  expect(increment.sql).toBe('"storage_object_deletions"."attempt_count" + 1');
  expect(mocks.error).not.toHaveBeenCalled();
});
it("still counts provider errors as failures", async () => {
  mocks.delete.mockRejectedValue(new Error("provider failed"));
  expect(await drainStorageObjectDeletionsAcrossOrganizations(BUDGET_MS)).toEqual({ completed: 0, failed: 1, deferred: 0 });
  expect(mocks.patch).toHaveBeenCalledWith(expect.objectContaining({ lastErrorCode: "storage_delete_failed" }));
});
it("filters cross-org batches by the configured provider and bucket", async () => {
  mocks.delete.mockResolvedValue(undefined);
  expect(await drainStorageObjectDeletionsAcrossOrganizations(BUDGET_MS)).toEqual({ completed: 1, failed: 0, deferred: 0 });
  const query = new PgDialect().sqlToQuery(mocks.condition as Parameters<PgDialect["sqlToQuery"]>[0]);
  expect(query.sql).toContain('"storage_object_deletions"."storage_provider" =');
  expect(query.sql).toContain('"storage_object_deletions"."storage_bucket" =');
  expect(query.params).toEqual(expect.arrayContaining(["local-fs", "current-bucket"]));
});
