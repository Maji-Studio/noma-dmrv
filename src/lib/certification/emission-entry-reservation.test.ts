import { expect, it } from "vitest";
import { emissionEntryCanBeReserved } from "./emission-entry-reservation";
const entry = { id: "e", creditBatchId: "b", contentRevision: 2, deletedAt: null, kind: "value" as const,
  confirmedForRemovalId: null, sentByRemovalId: null, sendReservedBySubmissionId: null };
const args = { entry, expectedRevision: 2, memberBatchIds: ["b"], removalId: "r", submissionId: "s", priorReservationTransferable: false };
it("accepts the exact reviewed revision, including this Removal's previous claim", () => {
  expect(emissionEntryCanBeReserved(args)).toBe(true);
  expect(emissionEntryCanBeReserved({ ...args, entry: { ...entry, sentByRemovalId: "r", sendReservedBySubmissionId: "s" } })).toBe(true);
});
it.each([
  { contentRevision: 3 }, { deletedAt: new Date() }, { creditBatchId: "other" }, { sentByRemovalId: "other" },
  { sendReservedBySubmissionId: "other" }, { kind: "zero" as const, confirmedForRemovalId: "other" },
])("refuses changed content, membership and foreign ownership (%j)", (patch) => {
  expect(emissionEntryCanBeReserved({ ...args, entry: { ...entry, ...patch } })).toBe(false);
});
it("only takes a foreign reservation when the production takeover policy allows it", () => {
  expect(emissionEntryCanBeReserved({ ...args, entry: { ...entry, sendReservedBySubmissionId: "old" }, priorReservationTransferable: true })).toBe(true);
});
it("reserves only this draft's zero", () => {
  expect(emissionEntryCanBeReserved({ ...args, entry: { ...entry, kind: "zero", confirmedForRemovalId: "r" } })).toBe(true);
});
