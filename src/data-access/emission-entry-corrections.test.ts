import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { emissionCorrectionWindow, lockEmissionCorrectionScope, lockRemovalEntryCorrectionAttempt } from "./emission-entry-corrections";
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => false }));
it("does not load lineage or authorize corrections with the flag off", async () => {
  const tx = {} as DbTransaction;
  const ctx = makeTestOrgContext();
  await expect(lockEmissionCorrectionScope(ctx, tx, "batch")).resolves.toBeUndefined();
  await expect(lockRemovalEntryCorrectionAttempt(ctx, tx, "removal")).resolves.toBeUndefined();
  expect(emissionCorrectionWindow(ctx, tx, "batch", "removal")).toBeUndefined();
});

it("discovers the same full batch union from every owner of the edited batch", async () => {
  const { emissionCorrectionBatchIds } = await import("./emission-entry-corrections");
  const results = [[{ id: "owner-a" }, { id: "owner-b" }, { id: null }], [{ id: "a" }, { id: "b" }, { id: "b" }]];
  const tx = { select: () => ({ from: () => ({ where: async () => results.shift() }) }) } as unknown as DbTransaction;
  expect(await emissionCorrectionBatchIds(makeTestOrgContext(), tx, "a")).toEqual(["a", "b"]);
  expect(results).toEqual([]);
});
