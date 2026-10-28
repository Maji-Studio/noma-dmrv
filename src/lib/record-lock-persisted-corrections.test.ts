import { expect, it } from "vitest";
import { isRemovalCorrectionWindowOpen, readsAsCorrectionWindowOpenFromPersisted, type RecordLockRemoval } from "./record-lock";

const returned: RecordLockRemoval = { id: "owner",
  submissions: [{ status: "submitted", externalId: "remote", submittedAt: "2026-01-01" }],
  statements: [{ id: "statement", status: "FAILED_VERIFICATION", fresh: false, submittedToVerifier: true,
    returnedAt: "2026-02-01", removalExternalIds: ["remote"] }],
};
it("uses persisted returns only for display and does not authorize a correction", () => {
  expect(readsAsCorrectionWindowOpenFromPersisted(returned.id, [returned])).toBe(true);
  expect(isRemovalCorrectionWindowOpen(returned)).toBe(false);
  expect(returned.statements[0].fresh).toBe(false);
});
it("allows an idle shared holder whose draft statement was never sent to a verifier", () => {
  const draft = { id: "other", submissions: [], statements: [
    { id: "draft-statement", status: "DRAFT", fresh: false, submittedToVerifier: false },
  ] };
  expect(readsAsCorrectionWindowOpenFromPersisted(returned.id, [returned, draft])).toBe(true);
});
it("does not invent a returned owner from empty or incomplete lineage", () => {
  expect(readsAsCorrectionWindowOpenFromPersisted(returned.id, [])).toBe(false);
  expect(readsAsCorrectionWindowOpenFromPersisted(returned.id, [{ id: "other", submissions: [], statements: [] }])).toBe(false);
});
it.each(["VERIFIED", "AWAITING_VERIFICATION", null])("fails closed on a shared holder's persisted %s status", status => {
  expect(readsAsCorrectionWindowOpenFromPersisted(returned.id, [returned, {
    id: "other", submissions: [], statements: [{ ...returned.statements[0], status }],
  }])).toBe(false);
});
it("retains shared statement in-flight protection when interpreting saved facts", () => {
  expect(readsAsCorrectionWindowOpenFromPersisted(returned.id, [returned, {
    id: "other", submissions: [], statements: [{ ...returned.statements[0], inFlight: true }],
  }])).toBe(false);
});
