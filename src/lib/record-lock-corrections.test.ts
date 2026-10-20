import { expect, it } from "vitest";
import { isRemovalCorrectionWindowOpen, isReturnedStatement, type RecordLockRemoval } from "./record-lock";
const returned: RecordLockRemoval = { id: "removal", submissions: [{ status: "submitted", externalId: "remote", submittedAt: "2026-01-01" }], statements: [{ id: "statement", status: "FAILED_VERIFICATION", fresh: true, submittedToVerifier: true, returnedAt: "2026-02-01", removalExternalIds: ["remote"] }] };
it.each(["DRAFT", "FAILED_VERIFICATION", "AWAITING_VERIFICATION", "VERIFIED", "CREDITS_ISSUED", "UNKNOWN", null])("fails closed except for returned status %s", (status) => {
  const statement = { ...returned.statements[0], status };
  const open = status === "DRAFT" || status === "FAILED_VERIFICATION";
  expect(isReturnedStatement(statement)).toBe(open);
  expect(isRemovalCorrectionWindowOpen({ ...returned, statements: [statement] })).toBe(open);
});
it.each([{ fresh: false }, { inFlight: true }, { status: "DRAFT", submittedToVerifier: false }])("requires fresh, idle verifier return facts: %j", (patch) => {
  expect(isRemovalCorrectionWindowOpen({ ...returned, statements: [{ ...returned.statements[0], ...patch }] })).toBe(false);
});
it("refuses an in-flight lineage attempt or another verified statement", () => {
  expect(isRemovalCorrectionWindowOpen(returned, [returned, { id: "other", submissions: [{ status: "draft", inFlight: true }], statements: [] }])).toBe(false);
  expect(isRemovalCorrectionWindowOpen(returned, [returned, { id: "other", submissions: [], statements: [{ ...returned.statements[0], status: "VERIFIED" }] }])).toBe(false);
});
