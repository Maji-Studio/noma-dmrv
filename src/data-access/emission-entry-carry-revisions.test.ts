import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import type { RecordLockRemoval } from "@/lib/record-lock";

const mocks = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn(), lineage: vi.fn(), union: vi.fn() }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("./record-lock-lineage", () => ({ readRecordLockLineage: mocks.lineage }));
vi.mock("./emission-entry-corrections", () => ({ emissionCorrectionBatchIds: mocks.union }));
vi.mock("./emission-entry-contenders", () => ({ loadEmissionEntryReservations: async () => [] }));
vi.mock("./credit-batch-accounting", () => ({ loadCreditBatchRollups: async () => ({}) }));
vi.mock("./emission-entries", () => ({ hydrateEmissionEntries: async () => [entry] }));
vi.mock("@/lib/certification/emission-entry-facts", () => ({ deriveEmissionEntryFacts: (entries: unknown[]) => entries }));
vi.mock("./removal-template-observations", () => ({
  getLatestTemplateObservations: async () => [], getTemplateObservationsByIds: async () => [{ id: "observation", definition: { groups: [] }, lineSources: {} }],
}));
vi.mock("./emission-entry-carry-queries", () => ({
  listCarryCandidates: async () => [{ entry, batch, timezone: "UTC" }],
  listOwnedCarryEntries: async () => [],
  listCarryRemovalMembers: async (_ctx: unknown, _facilityId: string, _executor: unknown, origins?: string[]) => origins
    ? [{ removal, batch, applicationDate: "2026-03-31" }] : [],
}));
import { loadFacilityEmissionEntryCarry } from "./emission-entry-carry";

const ctx = makeTestOrgContext();
const batch = { id: "origin", code: "CB-origin", startDate: "2026-03-01", endDate: "2026-03-31" };
const removal = { id: "owner", code: "RM-owner", createdAt: new Date("2026-03-01"), ghgStatementId: "returned" };
const entry = { id: "late", observationId: "observation", creditBatchId: batch.id, componentId: "component",
  kind: "value", lineRule: "additive", occurredOn: "2026-03-15", createdAt: new Date("2026-04-02"),
  deletedAt: null, sentByRemovalId: null, heldForRemovalId: null, sendReservedBySubmissionId: null,
  counts: true, values: [{ inputKey: "diesel", magnitude: "12", unit: "L" }],
};
const owner: RecordLockRemoval = { id: removal.id,
  submissions: [{ status: "submitted", externalId: "remote-owner", submittedAt: "2026-04-01T00:00:00Z" }],
  statements: [{ id: "returned", status: "FAILED_VERIFICATION", fresh: false, submittedToVerifier: true,
    returnedAt: "2026-04-02T00:00:00Z", removalExternalIds: ["remote-owner"] }],
};

beforeEach(() => {
  vi.resetAllMocks();
  const query = { from: vi.fn(), innerJoin: vi.fn(), leftJoin: vi.fn(), where: mocks.where };
  query.from.mockReturnValue(query); query.innerJoin.mockReturnValue(query); query.leftJoin.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.where.mockResolvedValueOnce([{ creditBatchId: batch.id, removalId: removal.id, allocatedDryMassKg: 0 }])
    .mockResolvedValueOnce([removal])
    .mockResolvedValueOnce([{ removalId: removal.id, batch }])
    .mockResolvedValueOnce([{ id: "attempt", localEntityId: removal.id, status: "submitted", submittedAt: new Date("2026-04-01") }]);
  mocks.union.mockResolvedValue([batch.id, "shared"]);
  mocks.lineage.mockResolvedValueOnce([owner]);
});

async function announcement(holders: RecordLockRemoval[]) {
  mocks.where.mockResolvedValueOnce(holders.map(holder => ({ removalId: holder.id, id: holder.id,
    ghgStatementId: holder.id === owner.id ? "returned" : holder.statements[0]?.id ?? null })));
  mocks.lineage.mockResolvedValueOnce(holders);
  const result = await loadFacilityEmissionEntryCarry(ctx, "facility");
  expect(mocks.union).toHaveBeenCalledExactlyOnceWith(ctx, expect.anything(), batch.id);
  return result.entries[0].revisionOf;
}

it("announces the returned owner's revision when no other holder exists", async () => {
  expect(await announcement([owner])).toEqual({ removalId: removal.id, removalCode: removal.code });
});
it("does not announce a revision when another holder in the shared batch union is verified", async () => {
  expect(await announcement([owner, { id: "shared-holder", submissions: [], statements: [
    { id: "verified", status: "VERIFIED", fresh: false, submittedToVerifier: true },
  ] }])).toBeNull();
});
it("does not announce a revision when another shared holder is in flight", async () => {
  expect(await announcement([owner, { id: "shared-holder", submissions: [{ status: "draft", inFlight: true }], statements: [] }])).toBeNull();
});
it("does not announce a revision when another holder's statement status is unknown", async () => {
  expect(await announcement([owner, { id: "shared-holder", submissions: [], statements: [
    { id: "unknown", status: null, fresh: false, submittedToVerifier: true },
  ] }])).toBeNull();
});
it("propagates a failed shared union read instead of swallowing it", async () => {
  mocks.union.mockRejectedValueOnce(new Error("read failed"));
  mocks.lineage.mockResolvedValueOnce([owner]);
  await expect(loadFacilityEmissionEntryCarry(ctx, "facility")).rejects.toThrow("read failed");
});
it("propagates a failed shared lineage read instead of swallowing it", async () => {
  mocks.where.mockResolvedValueOnce([{ removalId: owner.id, id: owner.id, ghgStatementId: "returned" }]);
  mocks.lineage.mockRejectedValueOnce(new Error("read failed"));
  await expect(loadFacilityEmissionEntryCarry(ctx, "facility")).rejects.toThrow("read failed");
});
it("does not announce a revision when a shared holder's covering statement is missing", async () => {
  mocks.where.mockResolvedValueOnce([{ removalId: owner.id, id: owner.id, ghgStatementId: "returned" },
    { removalId: "shared-holder", id: "shared-holder", ghgStatementId: "missing" }]);
  mocks.lineage.mockResolvedValueOnce([owner, { id: "shared-holder", submissions: [], statements: [] }]);
  expect((await loadFacilityEmissionEntryCarry(ctx, "facility")).entries[0].revisionOf).toBeNull();
});
