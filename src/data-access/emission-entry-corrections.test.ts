import type { SQL } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./certification-lineage-guards", () => ({
  getLockedCertifiedLineageForBatches: vi.fn(async () => [{
    recordLockRemoval: { id: "receiver", submissions: [], statements: [] },
  }]),
}));
vi.mock("@/lib/record-lock", () => ({ isRemovalCorrectionWindowOpen: () => true }));

it("discovers the same full batch union from every owner of the edited batch", async () => {
  const { emissionCorrectionBatchIds } = await import("./emission-entry-corrections");
  const results = [[{ id: "owner-a" }, { id: "owner-b" }, { id: null }], [{ id: "a" }, { id: "b" }, { id: "b" }]];
  const tx = { select: () => ({ from: () => ({ where: async () => results.shift(), leftJoin: () => ({ where: async () => [] }) }) }) } as unknown as DbTransaction;
  expect(await emissionCorrectionBatchIds(makeTestOrgContext(), tx, "a")).toEqual(["a", "b"]);
  expect(results).toEqual([]);
});

it("fans out distinct batches and shares pending reads across differently ordered unions", async () => {
  const { readPerCorrectionUnion } = await import("./emission-entry-corrections");
  const results = [[{ id: "owner-a" }], [{ id: "owner-b" }], [],
    [{ id: "b" }, { id: "a" }], [{ id: "a" }, { id: "b" }]];
  const where = vi.fn(async () => results.shift());
  const tx = { select: () => ({ from: () => ({ where, leftJoin: () => ({ where: async () => [] }) }) }) } as unknown as DbTransaction;
  const shared = { value: "shared" };
  const read = vi.fn(async (union: string[]) => union.includes("c") ? null : shared);
  const pending = readPerCorrectionUnion(makeTestOrgContext(), tx, ["a", "b", "a", "c"], read);
  expect(where).toHaveBeenCalledTimes(3);
  const byBatch = await pending;
  expect([...byBatch.keys()]).toEqual(["a", "b", "c"]);
  expect(byBatch.get("a")).toBe(shared);
  expect(byBatch.get("b")).toBe(shared);
  expect(byBatch.get("c")).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledWith(["a", "b"]);
  expect(read).toHaveBeenCalledWith(["c"]);
  expect(where).toHaveBeenCalledTimes(5);
  expect(results).toEqual([]);
});

it("requires org scope even for an empty fan-out", async () => {
  const { readPerCorrectionUnion } = await import("./emission-entry-corrections");
  const read = vi.fn();
  const select = vi.fn();
  const tx = { select } as unknown as DbTransaction;
  const ctx = makeTestOrgContext();
  expect(await readPerCorrectionUnion(ctx, tx, [], read)).toEqual(new Map());
  await expect(readPerCorrectionUnion({ ...ctx, organizationId: "" }, tx, [], read)).rejects.toThrow("Unauthorized");
  expect(select).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

it("propagates failed union queries and reader failures", async () => {
  const { readPerCorrectionUnion } = await import("./emission-entry-corrections");
  const failure = new Error("read failed");
  const where = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue([]);
  const tx = { select: () => ({ from: () => ({ where, leftJoin: () => ({ where: async () => [] }) }) }) } as unknown as DbTransaction;
  const read = vi.fn().mockRejectedValue(failure);
  await expect(readPerCorrectionUnion(makeTestOrgContext(), tx, ["a"], read)).rejects.toBe(failure);
  expect(read).not.toHaveBeenCalled();
  await expect(readPerCorrectionUnion(makeTestOrgContext(), tx, ["a"], read)).rejects.toBe(failure);
  expect(read).toHaveBeenCalledExactlyOnceWith(["a"]);
});

// Receiver discovery must reach a Removal even with no origin-batch applications.
it.each(["sent", "reserved", "held"])("includes a %s carry receiver's batches", async (kind) => {
  const { emissionCorrectionBatchIds } = await import("./emission-entry-corrections");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const receiver = "receiving-removal";
  const entry = { id: "entry", replacesEntryId: kind === "held" ? "original" : null,
    sentByRemovalId: kind === "sent" ? receiver : null,
    reservedByRemovalId: kind === "reserved" ? receiver : null };
  const where = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "receiving-batch" }]);
  const tx = { select: () => ({ from: () => ({ where,
    leftJoin: () => ({ where: async () => [entry] }),
    innerJoin: () => ({ where: async () => [{ id: entry.id, removalId: receiver }] }),
  }) }) } as unknown as DbTransaction;
  expect(await emissionCorrectionBatchIds(makeTestOrgContext(), tx, "origin-batch"))
    .toEqual(["origin-batch", "receiving-batch"]);
  const query = new PgDialect().sqlToQuery(where.mock.calls[1][0]);
  expect(query.params).toContain(receiver);
  expect(query.params).toContain(makeTestOrgContext().organizationId);
});


it.each([
  ["carried", "2026-06-10", true],
  ["carried", "2026-06-16", true],
  ["carried", "2026-06-17", false],
  ["member", "2026-06-10", false],
  ["member", "2026-06-11", true],
  ["member", "2026-06-16", true],
  ["member", "2026-06-17", false],
] as const)("%s correction on %s has eligibility %s", async (kind, occurredOn, allowed) => {
  const { lockEmissionCorrectionScope, assertSentEntryInCorrectionWindow, isCarriedEmissionCorrection } =
    await import("./emission-entry-corrections");
  const ctx = makeTestOrgContext();
  const members = [{ removalId: "receiver", creditBatchId: "member", startDate: "2026-06-11", applicationDate: "2026-06-16" }];
  const memberWhere = vi.fn(async (_condition: SQL) => members);
  const tx = { select: () => ({ from: () => ({
    where: async () => [],
    leftJoin: () => ({ where: async () => [] }),
    innerJoin: () => ({ innerJoin: () => ({ where: memberWhere }) }),
  }) }) } as unknown as DbTransaction;
  await lockEmissionCorrectionScope(ctx, tx, kind);
  expect(isCarriedEmissionCorrection(ctx, tx, kind, "receiver")).toBe(kind === "carried");
  const check = () => assertSentEntryInCorrectionWindow(ctx, tx, kind, "receiver", occurredOn);
  if (allowed) expect(check).not.toThrow();
  else expect(check).toThrow("Keep the entry date within this Removal's period.");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  expect(new PgDialect().sqlToQuery(memberWhere.mock.calls[0][0]).params).toContain(ctx.organizationId);
});

it("refuses a date without a locked correction window", async () => {
  const { assertSentEntryInCorrectionWindow } = await import("./emission-entry-corrections");
  expect(() => assertSentEntryInCorrectionWindow(makeTestOrgContext(), {} as DbTransaction, "carried", "receiver", "2026-06-10"))
    .toThrow("Keep the entry date within this Removal's period.");
});
