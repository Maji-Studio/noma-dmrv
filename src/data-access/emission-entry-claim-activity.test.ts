import { expect, it, vi } from "vitest";
import { makeTestOrgContext } from "../../tests/helpers/test-org";
import { certificationSubmissions, creditBatchApplications, creditBatches, emissionEntries } from "@/db/schema";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), activity: vi.fn() }));
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("./activity-events", () => ({ recordActivityChange: mocks.activity }));
vi.mock("./submission-rejection", () => ({ rejectDraftSubmission: vi.fn() }));
vi.mock("@/lib/certification/emissions-entry-gate", () => ({ emissionsEntriesEnabled: () => true }));
import { reserveProductionEmissionsClaims, rejectSubmissionAndReleaseProductionClaims } from "./production-claim-reservations";

it("captures the entry claim link on reserve and release without changing content", async () => {
  const lockedAt = new Date();
  const ctx = makeTestOrgContext();
  let entry = { id: "entry", creditBatchId: "batch", kind: "value", contentRevision: 1,
    deletedAt: null, sentByRemovalId: null, sendReservedBySubmissionId: null as string | null };
  const query = (rows: object[]) => {
    const q = { where: () => q, orderBy: () => q, for: () => q, returning: () => q,
      then: (resolve: (rows: object[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return q;
  };
  const tx = {
    select: () => ({ from: (table: unknown) => query(table === creditBatches ? [{ id: "batch" }]
      : table === creditBatchApplications ? [{ creditBatchId: "batch" }]
      : table === emissionEntries ? [entry]
      : table === certificationSubmissions ? [{ id: "attempt", status: "draft", provider: "isometric",
        submissionType: "removal", localEntityType: "removal", localEntityId: "removal", lockedAt, metadata: null }] : []) }),
    update: (table: unknown) => ({ set: (patch: typeof entry) => {
      if (table !== emissionEntries) return query([]);
      expect(patch).not.toHaveProperty("contentRevision");
      entry = { ...entry, ...patch };
      return query([entry]);
    } }),
  };
  mocks.transaction.mockImplementation((run) => run(tx));
  await reserveProductionEmissionsClaims(ctx, { removalId: "removal", submissionId: "attempt", creditBatchIds: [],
    entryClaim: { memberBatchIds: ["batch"], frozenEntrySet: [{ entryId: "entry", contentRevision: 1 }] } });
  expect(mocks.activity).toHaveBeenLastCalledWith(ctx, tx, expect.objectContaining({ entityType: "emission_entry", entityId: "entry" }),
    expect.objectContaining({ sendReservedBySubmissionId: null }), expect.objectContaining({ sendReservedBySubmissionId: "attempt" }), { skipEmpty: true });
  await rejectSubmissionAndReleaseProductionClaims(ctx, { submissionId: "attempt", expectedLockedAt: lockedAt, errorMessage: "Stopped" });
  expect(mocks.activity).toHaveBeenLastCalledWith(ctx, tx, expect.objectContaining({ entityType: "emission_entry", entityId: "entry" }),
    expect.objectContaining({ sendReservedBySubmissionId: "attempt" }), expect.objectContaining({ sendReservedBySubmissionId: null }), { skipEmpty: true });
});
