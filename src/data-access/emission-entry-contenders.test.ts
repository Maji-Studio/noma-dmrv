import { beforeEach, expect, it, vi } from "vitest";
import type { RecordLockRemoval } from "@/lib/record-lock";
import type { LockedCertifiedLineageRow } from "./certification-lineage-guards";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { listEmissionEntryDraftContenders } from "./emission-entry-contenders";
import { emissionCorrectionBatchIds } from "./emission-entry-corrections";
import { getCertifiedLineageForBatches } from "./certification-lineage-guards";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./emission-entry-corrections", () => ({ emissionCorrectionBatchIds: vi.fn(async () => ["a", "b"]) }));
vi.mock("./certification-lineage-guards", () => ({ getCertifiedLineageForBatches: vi.fn() }));
const returned: RecordLockRemoval = { id: "returned", submissions: [{ id: "attempt", status: "submitted", externalId: "remote", submittedAt: "2026-01-01" }],
  statements: [{ id: "statement", status: "FAILED_VERIFICATION", submittedToVerifier: true, fresh: true, returnedAt: "2026-02-01", removalExternalIds: ["remote"] }] };
function reader(latest?: { id: string; status: string; version: number }, ghgStatementId: string | null = null) {
  const rows = [[{ removalId: "returned" }], [{ removalId: "returned", creditBatchId: "a", metadata: {}, ghgStatementId,
    createdAt: new Date("2026-01-01"), startDate: "2026-01-01", applicationDate: new Date("2026-01-31") }], ...(latest ? [[latest]] : [])];
  return { select: () => {
    const query = { from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query, limit: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows.shift()).then(resolve) };
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
  expect(getCertifiedLineageForBatches).toHaveBeenCalledWith(ctx, executor, ["a", "b"], expect.any(Map), undefined, true);
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


it.each(["claimed", "unrelated"])("excludes only the exact latest correction draft on a submission read: %s", async (id) => {
  vi.mocked(getCertifiedLineageForBatches).mockImplementation(async (_ctx, _executor, _ids, _reads, excluded) => [
    lineage({ ...returned, submissions: [...returned.submissions, ...(excluded === "claimed" ? [] : [{ id: "claimed", status: "draft", inFlight: true }])] }),
  ]);
  const result = await listEmissionEntryDraftContenders(makeTestOrgContext(), ["a"], reader({ id: "claimed", status: "draft", version: 2 }), { removalId: "returned", submissionId: id });
  expect(result).toHaveLength(id === "claimed" ? 1 : 0);
});

it("does not exclude the correction draft for ordinary contender readers", async () => {
  vi.mocked(getCertifiedLineageForBatches).mockResolvedValue([lineage({ ...returned,
    submissions: [...returned.submissions, { id: "claimed", status: "draft", inFlight: true }] })]);
  expect(await listEmissionEntryDraftContenders(makeTestOrgContext(), ["a"], reader())).toEqual([]);
});

it.each(["current", "missing", null])("prefers the current returned statement with a fallback (%s)", async (ghgStatementId) => {
  vi.mocked(getCertifiedLineageForBatches).mockResolvedValue([lineage({ ...returned,
    statements: [...returned.statements, { ...returned.statements[0], id: "current", status: "DRAFT" }],
  })]);
  const result = await listEmissionEntryDraftContenders(makeTestOrgContext(), ["a"], reader(undefined, ghgStatementId));
  expect(result[0].returnedStatement).toEqual(ghgStatementId === "current"
    ? { id: "current", status: "DRAFT" } : { id: "statement", status: "FAILED_VERIFICATION" });
});


it("uses persisted return facts without requesting registry refresh for advisory reads", async () => {
  const saved = { ...returned, statements: returned.statements.map(statement => ({ ...statement, fresh: false })) };
  vi.mocked(getCertifiedLineageForBatches).mockResolvedValue([lineage(saved)]);
  const ctx = makeTestOrgContext();
  const executor = reader();
  expect(await listEmissionEntryDraftContenders(ctx, ["a"], executor, undefined, true)).toMatchObject([
    { removalId: "returned", contenderKind: "correction" },
  ]);
  expect(getCertifiedLineageForBatches).toHaveBeenCalledWith(ctx, executor, ["a", "b"], expect.any(Map), undefined, false);
  expect(saved.statements[0].fresh).toBe(false);
});

it("does not treat persisted return facts as fresh authorization on submission reads", async () => {
  vi.mocked(getCertifiedLineageForBatches).mockResolvedValue([lineage({ ...returned,
    statements: returned.statements.map(statement => ({ ...statement, fresh: false })),
  })]);
  expect(await listEmissionEntryDraftContenders(makeTestOrgContext(), ["a"], reader())).toEqual([]);
});
