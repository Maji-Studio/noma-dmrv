import { describe, expect, it } from "vitest";
import { draftRemovalAttentionItems } from "./removal-attention";

const createdAt = new Date("2026-11-01T00:00:00Z");

describe("draftRemovalAttentionItems", () => {
  it("words a blocked draft as its count to fix and a ready draft as ready", () => {
    const items = draftRemovalAttentionItems(
      [
        { removalId: "r1", code: "RM-1", createdAt, readiness: { state: "blocked", reasons: ["A.", "B.", "C."] } },
        { removalId: "r2", code: "RM-2", createdAt, readiness: { state: "ready", reasons: [] } },
      ],
      "fac-1",
    );
    expect(items.map((item) => [item.entityCode, item.title])).toEqual([
      ["RM-1", "3 to fix."],
      ["RM-2", "Ready to submit."],
    ]);
    expect(items[0].href).toContain("r1");
  });

  it("gives a Removal with a submission running no row", () => {
    expect(
      draftRemovalAttentionItems([{ removalId: "r3", code: "RM-3", createdAt, readiness: { state: "inProgress", reasons: [] } }], "fac-1"),
    ).toEqual([]);
  });
});
