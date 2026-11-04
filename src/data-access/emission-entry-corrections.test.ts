import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { creditBatchApplications } from "@/db/schema";
import type { RecordLockRemoval } from "@/lib/record-lock";
import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

vi.mock("@/db", () => ({ db: {} }));
const mocks = vi.hoisted(() => ({ locked: vi.fn(), lineage: vi.fn() }));
vi.mock("./certification-lineage-guards", async importOriginal => ({
  ...await importOriginal<typeof import("./certification-lineage-guards")>(),
  getLockedCertifiedLineageForBatches: mocks.locked,
  getCertifiedLineage: mocks.lineage,
}));

function fact(id: string, status = "FAILED_VERIFICATION"): RecordLockRemoval {
  return { id, submissions: [{ status: "submitted", externalId: id, submittedAt: "2026-07-01T00:00:00Z" }],
    statements: [{ id: `statement-${id}`, status, fresh: true, inFlight: false, submittedToVerifier: true,
      returnedAt: "2026-07-02T00:00:00Z", removalExternalIds: [id] }] };
}

function correctionFixture(kind = "sent", originStatus = "FAILED_VERIFICATION", receiverStatus = "FAILED_VERIFICATION") {
  const ctx = makeTestOrgContext();
  const members = [
    { removalId: "origin", creditBatchId: "a", startDate: "2026-06-01", applicationDate: "2026-06-16" },
    { removalId: "receiver", creditBatchId: "member", startDate: "2026-06-11", applicationDate: "2026-06-16" },
    { removalId: "shared", creditBatchId: "member", startDate: "2026-06-11", applicationDate: "2026-06-16" },
    { removalId: "shared", creditBatchId: "neighbor", startDate: "2026-06-11", applicationDate: "2026-06-16" },
  ];
  const facts = [fact("origin", originStatus), fact("receiver", receiverStatus), fact("shared")];
  mocks.locked.mockResolvedValue(facts.map(recordLockRemoval => ({ recordLockRemoval })));
  mocks.lineage.mockResolvedValue(facts.map(recordLockRemoval => ({ recordLockRemoval })));
  const conditions: SQL[] = [];
  const tx = { select: (selection: { id?: unknown }) => ({ from: () => ({
    where: async (condition: SQL) => {
      conditions.push(condition);
      const params = new PgDialect().sqlToQuery(condition).params;
      expect(params).toContain(ctx.organizationId);
      return selection.id === creditBatchApplications.removalId
        ? members.filter(row => params.includes(row.creditBatchId)).map(row => ({ id: row.removalId }))
        : members.filter(row => params.includes(row.removalId)).map(row => ({ id: row.creditBatchId }));
    },
    leftJoin: () => ({ where: async () => [{ id: "entry", replacesEntryId: kind === "held" ? "original" : null,
      sentByRemovalId: kind === "sent" ? "receiver" : null, reservedByRemovalId: kind === "reserved" ? "receiver" : null }] }),
    innerJoin: () => ({ where: async () => [{ id: "entry", removalId: "receiver" }],
      innerJoin: () => ({ where: async (condition: SQL) => { conditions.push(condition); return members; } }),
    }),
  }) }) } as unknown as DbTransaction;
  return { ctx, tx, conditions, members };
}

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

it.each(["sent", "reserved", "held"])("excludes a %s receiver from reads but locks its full base union", async kind => {
  const { emissionCorrectionBatchIds, discoverEmissionCorrectionScope, lockEmissionCorrectionScope } = await import("./emission-entry-corrections");
  const { ctx, tx } = correctionFixture(kind);
  expect(await emissionCorrectionBatchIds(ctx, tx, "a")).toEqual(["a"]);
  const scope = await discoverEmissionCorrectionScope(ctx, tx, "a");
  expect(scope.batchIds).toEqual(["a", "member", "neighbor"]);
  expect(scope.receiverUnions.get("receiver")).toEqual(["member", "neighbor"]);
  mocks.locked.mockClear();
  await lockEmissionCorrectionScope(ctx, tx, "a");
  expect(mocks.locked).toHaveBeenCalledExactlyOnceWith(ctx, tx, scope.batchIds);
});

it.each([
  ["FAILED_VERIFICATION", "AWAITING_VERIFICATION", "origin", "receiver"],
  ["AWAITING_VERIFICATION", "FAILED_VERIFICATION", "receiver", "origin"],
])("evaluates origin %s and receiver %s independently, including revalidation", async (originStatus, receiverStatus, open, closed) => {
  const { lockEmissionCorrectionScope, revalidateEmissionCorrectionScope, emissionCorrectionWindow } = await import("./emission-entry-corrections");
  const { ctx, tx } = correctionFixture("sent", originStatus, receiverStatus);
  await lockEmissionCorrectionScope(ctx, tx, "a");
  expect(emissionCorrectionWindow(ctx, tx, "a", open)).toBeDefined();
  expect(emissionCorrectionWindow(ctx, tx, "a", closed)).toBeUndefined();
  await revalidateEmissionCorrectionScope(ctx, tx, "a");
  expect(emissionCorrectionWindow(ctx, tx, "a", open)).toBeDefined();
  expect(emissionCorrectionWindow(ctx, tx, "a", closed)).toBeUndefined();
});

it("still closes the receiver window when one of its own shared holders is in verification", async () => {
  const { lockEmissionCorrectionScope, emissionCorrectionWindow } = await import("./emission-entry-corrections");
  const { ctx, tx } = correctionFixture();
  mocks.locked.mockResolvedValue([fact("origin"), fact("receiver"), fact("shared", "AWAITING_VERIFICATION")]
    .map(recordLockRemoval => ({ recordLockRemoval })));
  await lockEmissionCorrectionScope(ctx, tx, "a");
  expect(emissionCorrectionWindow(ctx, tx, "a", "origin")).toBeDefined();
  expect(emissionCorrectionWindow(ctx, tx, "a", "receiver")).toBeUndefined();
});

it("excludes application owners from carry receivers", async () => {
  const { discoverEmissionCorrectionScope } = await import("./emission-entry-corrections");
  const { ctx, tx } = correctionFixture();
  expect((await discoverEmissionCorrectionScope(ctx, tx, "member")).receiverUnions.size).toBe(0);
});

it("refuses an unfenced statement on revalidation", async () => {
  const { lockEmissionCorrectionScope, revalidateEmissionCorrectionScope } = await import("./emission-entry-corrections");
  const { ctx, tx } = correctionFixture();
  await lockEmissionCorrectionScope(ctx, tx, "a");
  const changed = fact("receiver");
  changed.statements = changed.statements.map(statement => ({ ...statement, id: "new-statement" }));
  mocks.lineage.mockResolvedValue([{ recordLockRemoval: changed }]);
  await expect(revalidateEmissionCorrectionScope(ctx, tx, "a"))
    .rejects.toThrow("Certification lineage changed while it was being locked");
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
  const { ctx, tx, conditions } = correctionFixture();
  const batchId = kind === "carried" ? "a" : "member";
  await lockEmissionCorrectionScope(ctx, tx, batchId);
  expect(isCarriedEmissionCorrection(ctx, tx, batchId, "receiver")).toBe(kind === "carried");
  const check = () => assertSentEntryInCorrectionWindow(ctx, tx, batchId, "receiver", occurredOn);
  if (allowed) expect(check).not.toThrow();
  else expect(check).toThrow("Keep the entry date within this Removal's period.");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  for (const condition of conditions) expect(new PgDialect().sqlToQuery(condition).params).toContain(ctx.organizationId);
});

it("refuses a date without a locked correction window", async () => {
  const { assertSentEntryInCorrectionWindow } = await import("./emission-entry-corrections");
  expect(() => assertSentEntryInCorrectionWindow(makeTestOrgContext(), {} as DbTransaction, "carried", "receiver", "2026-06-10"))
    .toThrow("Keep the entry date within this Removal's period.");
});

it("keeps a base-holder carry receiver closed while its own union has a holder awaiting verification", async () => {
  const { discoverEmissionCorrectionScope, lockEmissionCorrectionScope, revalidateEmissionCorrectionScope, emissionCorrectionWindow } =
    await import("./emission-entry-corrections");
  const { ctx, tx, members } = correctionFixture();
  // R1={a, member}, R2={member, neighbor}, R3={neighbor}; only R2 receives a.
  members.splice(0, members.length,
    { removalId: "origin", creditBatchId: "a", startDate: "2026-06-01", applicationDate: "2026-06-16" },
    { removalId: "origin", creditBatchId: "member", startDate: "2026-06-01", applicationDate: "2026-06-16" },
    { removalId: "receiver", creditBatchId: "member", startDate: "2026-06-01", applicationDate: "2026-06-16" },
    { removalId: "receiver", creditBatchId: "neighbor", startDate: "2026-06-01", applicationDate: "2026-06-16" },
    { removalId: "shared", creditBatchId: "neighbor", startDate: "2026-06-01", applicationDate: "2026-06-16" },
  );
  const scope = await discoverEmissionCorrectionScope(ctx, tx, "a");
  expect(scope.baseBatchIds).toEqual(["a", "member"]);
  expect(scope.receiverUnions.get("receiver")).toContain("neighbor");
  const pendingFacts = [fact("origin"), fact("receiver"), fact("shared", "AWAITING_VERIFICATION")]
    .map(recordLockRemoval => ({ recordLockRemoval }));
  mocks.locked.mockResolvedValue(pendingFacts);
  await lockEmissionCorrectionScope(ctx, tx, "a");
  expect(emissionCorrectionWindow(ctx, tx, "a", "origin")).toBeDefined();
  expect(emissionCorrectionWindow(ctx, tx, "a", "receiver")).toBeUndefined();

  const reopened = correctionFixture();
  reopened.members.splice(0, reopened.members.length, ...members);
  await lockEmissionCorrectionScope(reopened.ctx, reopened.tx, "a");
  expect(emissionCorrectionWindow(reopened.ctx, reopened.tx, "a", "receiver")).toBeDefined();
  mocks.lineage.mockResolvedValue(pendingFacts);
  await revalidateEmissionCorrectionScope(reopened.ctx, reopened.tx, "a");
  expect(emissionCorrectionWindow(reopened.ctx, reopened.tx, "a", "receiver")).toBeUndefined();
});

it("queries the edited batch's application owners once during discovery", async () => {
  const { discoverEmissionCorrectionScope } = await import("./emission-entry-corrections");
  const { ctx, tx, conditions } = correctionFixture();
  await discoverEmissionCorrectionScope(ctx, tx, "a");
  expect(conditions.filter(condition => new PgDialect().sqlToQuery(condition).params.includes("a"))).toHaveLength(1);
});
