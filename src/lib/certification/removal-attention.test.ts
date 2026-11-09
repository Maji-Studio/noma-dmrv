import { describe, expect, it } from "vitest";
import type { RemovalCorrection } from "./removal-entry-correction";
import { removalAttentionRows } from "./removal-attention";

const createdAt = new Date("2026-11-01T00:00:00Z");
const none = { drafts: [], rejected: [], returned: [] };

describe("removalAttentionRows", () => {
  it("words a blocked draft as its count to fix and a ready draft as ready", () => {
    const { drafts } = removalAttentionRows(
      {
        ...none,
        drafts: [
          { removalId: "r1", code: "RM-1", createdAt, readiness: { state: "blocked", reasons: ["A.", "B.", "C."] } },
          { removalId: "r2", code: "RM-2", createdAt, readiness: { state: "ready", reasons: [] } },
        ],
      },
      "fac-1",
    );
    expect(drafts.map((item) => [item.entityCode, item.title])).toEqual([
      ["RM-1", "3 to fix"],
      ["RM-2", "Ready to submit"],
    ]);
    expect(drafts[0].href).toContain("r1");
  });

  it("keeps a draft with unavailable readiness linked and covered", () => {
    const rows = removalAttentionRows({ ...none, drafts: [{ removalId: "r-unavailable", code: "RM-1", createdAt, readiness: null }] }, "fac-1");
    expect(rows.drafts[0]).toMatchObject({ entityCode: "RM-1", title: "Couldn't check. Open it to see what is left.", recordIds: ["r-unavailable"] });
    expect(rows.drafts[0].href).toContain("removal=r-unavailable");
    expect(rows.covered.has("r-unavailable")).toBe(true);
  });

  it("counts the fixes the review lists, not the reasons", () => {
    const { drafts } = removalAttentionRows(
      { ...none, drafts: [{ removalId: "r4", code: "RM-4", createdAt, readiness: { state: "blocked", reasons: ["A.", "B.", "C.", "D.", "E."], fixCount: 1 } }] },
      "fac-1",
    );
    expect(drafts[0].title).toBe("1 to fix");
  });

  it("names a rejected Removal as the Removals list does", () => {
    const { rejected } = removalAttentionRows({ ...none, rejected: [{ removalId: "r5", code: "RM-5", createdAt }] }, "fac-1");
    expect(rejected[0].title).toBe("Submission failed");
    expect(rejected[0].href).toContain("r5");
  });

  it("gives a returned Removal one row, Resubmit needed or Correction needed, else the batch wording", () => {
    const correction = (resubmitNeeded: boolean) => ({ resubmitNeeded }) as RemovalCorrection;
    const { returned } = removalAttentionRows(
      {
        ...none,
        returned: [
          { removalId: "a", code: "RM-A", createdAt, correction: correction(true) },
          { removalId: "b", code: "RM-B", createdAt, correction: correction(false) },
          { removalId: "c", code: "RM-C", createdAt, correction: undefined },
        ],
      },
      "fac-1",
    );
    expect(returned.map((row) => [row.removalId, row.item.title])).toEqual([
      ["a", "Resubmit needed"],
      ["b", "Correction needed"],
      ["c", "Returned by Isometric"],
    ]);
    expect(returned[0].item.href).toContain("a");
  });

  it("gives a Removal with a submission running no row", () => {
    expect(
      removalAttentionRows({ ...none, drafts: [{ removalId: "r3", code: "RM-3", createdAt, readiness: { state: "inProgress", reasons: [] } }] }, "fac-1").drafts,
    ).toEqual([]);
  });
});
