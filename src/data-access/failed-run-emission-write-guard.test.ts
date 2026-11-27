import { expect, it, vi } from "vitest";
import type { DbTransaction } from "@/db";
import { synchronizeFailedEmissionBatches } from "./failed-run-emission-write-guard";

vi.mock("@/db", () => ({ db: {} }));
const ctx = { organizationId: "org", userId: "user", orgRole: "admin" as const, isPlatformAdmin: false };

it.each([
  ["productionRun", "production run"], ["creditBatch", "credit batch"], ["vehicle", "vehicle"],
  ["feedstock", "feedstock"], ["feedstockType", "feedstock type"], ["facility", "facility"],
] as const)("names %s when a production reservation refuses its edit", async (subject, label) => {
  const responses = [
    [{ productionEmissionsClaimReservedBySubmissionId: "submission" }],
    [{ provider: "isometric", submissionType: "removal", localEntityType: "removal", metadata: {}, localEntityId: "removal", status: "draft", lockedAt: new Date() }],
    [{ code: "RM-001" }],
  ];
  const select = () => {
    const rows = responses.shift();
    const query = { from: () => query, where: () => query, orderBy: () => query,
      for: async () => rows, then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  };
  const refusal = synchronizeFailedEmissionBatches(ctx, { select } as unknown as DbTransaction, ["batch"], subject);
  await expect(refusal)
    .rejects.toMatchObject({ code: "certification_locked", message: expect.stringContaining(`Cannot update this ${label} because it is locked by a certification submission.`) });
  await expect(refusal).rejects.toMatchObject({ message: expect.stringContaining("RM-001") });
});
