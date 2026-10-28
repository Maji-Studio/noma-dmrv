import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";

vi.mock("@/db", () => ({ db: {} }));

it("discovers the same full batch union from every owner of the edited batch", async () => {
  const { emissionCorrectionBatchIds } = await import("./emission-entry-corrections");
  const results = [[{ id: "owner-a" }, { id: "owner-b" }, { id: null }], [{ id: "a" }, { id: "b" }, { id: "b" }]];
  const tx = { select: () => ({ from: () => ({ where: async () => results.shift() }) }) } as unknown as DbTransaction;
  expect(await emissionCorrectionBatchIds(makeTestOrgContext(), tx, "a")).toEqual(["a", "b"]);
  expect(results).toEqual([]);
});

it("fans out distinct batches and shares pending reads across differently ordered unions", async () => {
  const { readPerCorrectionUnion } = await import("./emission-entry-corrections");
  const results = [[{ id: "owner-a" }], [{ id: "owner-b" }], [],
    [{ id: "b" }, { id: "a" }], [{ id: "a" }, { id: "b" }]];
  const where = vi.fn(async () => results.shift());
  const tx = { select: () => ({ from: () => ({ where }) }) } as unknown as DbTransaction;
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
  const tx = { select: () => ({ from: () => ({ where }) }) } as unknown as DbTransaction;
  const read = vi.fn().mockRejectedValue(failure);
  await expect(readPerCorrectionUnion(makeTestOrgContext(), tx, ["a"], read)).rejects.toBe(failure);
  expect(read).not.toHaveBeenCalled();
  await expect(readPerCorrectionUnion(makeTestOrgContext(), tx, ["a"], read)).rejects.toBe(failure);
  expect(read).toHaveBeenCalledExactlyOnceWith(["a"]);
});
