import { beforeEach, expect, it, vi } from "vitest";
import type { RecordLockRemoval } from "@/lib/record-lock";
import type { LockedCertifiedLineageRow } from "./certification-lineage-guards";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { listEmissionEntryDraftContenders } from "./emission-entry-contenders";
import { emissionCorrectionBatchIds } from "./emission-entry-corrections";
import { getCertifiedLineageForBatches } from "./certification-lineage-guards";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => true }));
vi.mock("./emission-entry-corrections", () => ({ emissionCorrectionBatchIds: vi.fn(async () => ["a", "b"]) }));
vi.mock("./certification-lineage-guards", () => ({ getCertifiedLineageForBatches: vi.fn() }));
const returned: RecordLockRemoval = { id: "returned", submissions: [{ id: "attempt", status: "submitted", externalId: "remote", submittedAt: "2026-01-01" }],
  statements: [{ id: "statement", status: "FAILED_VERIFICATION", submittedToVerifier: true, fresh: true, returnedAt: "2026-02-01", removalExternalIds: ["remote"] }] };
function reader() {
  const rows = [[{ removalId: "returned" }], [{ removalId: "returned", creditBatchId: "a", metadata: {},
    createdAt: new Date("2026-01-01"), startDate: "2026-01-01", applicationDate: new Date("2026-01-31") }]];
  return { select: () => {
    const query = { from: () => query, innerJoin: () => query, where: async () => rows.shift() };
    return query;
  } } as unknown as NonNullable<Parameters<typeof listEmissionEntryDraftContenders>[2]>;
}
beforeEach(() => vi.clearAllMocks());
it("uses the write scope's full batch union, including a blocking holder beyond the contender's own batch", async () => {
  vi.mocked(getCertifiedLineageForBatches).mockResolvedValue([
    lineage(returned),
    lineage({ id: "other", submissions: [], statements: [{ id: "verified", status: "VERIFIED", submittedToVerifier: true, fresh: false }] }),
  ]);
  const ctx = makeTestOrgContext();
  const executor = reader();
  expect(await listEmissionEntryDraftContenders(ctx, ["a"], executor)).toEqual([]);
  expect(emissionCorrectionBatchIds).toHaveBeenCalledWith(ctx, executor, "a");
  expect(getCertifiedLineageForBatches).toHaveBeenCalledWith(ctx, executor, ["a", "b"], expect.any(Map));
});
it("offers the correction when the same union has no blocking holder", async () => {
  vi.mocked(getCertifiedLineageForBatches).mockResolvedValue([lineage(returned)]);
  expect(await listEmissionEntryDraftContenders(makeTestOrgContext(), ["a"], reader())).toMatchObject([
    { removalId: "returned", contenderKind: "correction", creditBatchIds: ["a"] },
  ]);
});

function lineage(recordLockRemoval: RecordLockRemoval): LockedCertifiedLineageRow {
  return { removalId: recordLockRemoval.id, creditBatchId: "a", targetId: recordLockRemoval.id, ghgStatementId: null, recordLockRemoval };
}
