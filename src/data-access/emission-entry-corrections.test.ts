import { expect, it } from "vitest";
import type { DbTransaction } from "@/db";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
it("discovers the same full batch union from every owner of the edited batch", async () => {
  const { emissionCorrectionBatchIds } = await import("./emission-entry-corrections");
  const results = [[{ id: "owner-a" }, { id: "owner-b" }, { id: null }], [{ id: "a" }, { id: "b" }, { id: "b" }]];
  const tx = { select: () => ({ from: () => ({ where: async () => results.shift() }) }) } as unknown as DbTransaction;
  expect(await emissionCorrectionBatchIds(makeTestOrgContext(), tx, "a")).toEqual(["a", "b"]);
  expect(results).toEqual([]);
});
