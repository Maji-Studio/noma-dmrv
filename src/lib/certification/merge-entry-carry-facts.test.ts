import { expect, it } from "vitest";
import { mergeEntryCarryFacts } from "./merge-entry-carry-facts";

it("attaches the revision destination alongside the earlier Removal without retaining stale facts", () => {
  const revisionOf = { removalId: "rm-9", removalCode: "RM-009" };
  expect(mergeEntryCarryFacts([{ id: "late" }, { id: "other", revisionOf }], [
    { id: "late", revisionOf, earlierRemovalId: "rm-9", earlierRemovalCode: "RM-009" },
  ])).toEqual([
    { id: "late", revisionOf, recordedAfter: revisionOf },
    { id: "other", revisionOf: undefined, recordedAfter: null },
  ]);
});
