import { beforeEach, expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), reject: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./submission-rejection", () => ({ rejectDraftSubmission: mocks.reject }));
vi.mock("./activity-events", () => ({ recordActivityChange: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => true }));
import { rejectSubmissionAndReleaseProductionClaims } from "./production-claim-reservations";
import { emissionEntries } from "@/db/schema";
const lockedAt = new Date("2026-01-01");
const patches = vi.fn();
let metadata: unknown;
beforeEach(() => {
  vi.resetAllMocks();
  metadata = null;
  const query = (result: unknown[]) => {
    const q = { from: () => q, where: () => q, orderBy: () => q, for: () => q, returning: () => q,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result).then(resolve) };
    return q;
  };
  const tx = { select: () => query([{ id: "submission", status: "draft", lockedAt, metadata }]),
    update: (table: unknown) => ({ set: (patch: object) => { patches(table, patch); return query([]); } }) };
  mocks.transaction.mockImplementation((fn) => fn(tx));
});
it("releases only the attempt's reservation, retaining zero ownership and content revision", async () => {
  await rejectSubmissionAndReleaseProductionClaims(makeTestOrgContext(), { submissionId: "submission", expectedLockedAt: lockedAt, errorMessage: "Failed" });
  const patch = patches.mock.calls.find(([table]) => table === emissionEntries)![1];
  expect(patch).toMatchObject({ sendReservedBySubmissionId: null, version: expect.anything() });
  expect(patch).not.toHaveProperty("confirmedForRemovalId");
  expect(patch).not.toHaveProperty("contentRevision");
  expect(patch).not.toHaveProperty("deletedAt");
});
it.each(["possible", "confirmed"])("retains reservations after %s external mutation", async (externalMutation) => {
  metadata = { externalMutation };
  await rejectSubmissionAndReleaseProductionClaims(makeTestOrgContext(), { submissionId: "submission", expectedLockedAt: lockedAt, errorMessage: "Failed" });
  expect(patches).not.toHaveBeenCalled();
  expect(mocks.reject).not.toHaveBeenCalled();
});
