import { describe, expect, it } from "vitest";
import { decideRemovalMembership } from "@/lib/isometric/utils/ghg-entry-membership";

describe("decideRemovalMembership", () => {
  it("links unlinked removals mapped from Isometric removal ids", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_a", "rmv_b"],
      externalToLocal: new Map([
        ["rmv_a", "local-a"],
        ["rmv_b", "local-b"],
      ]),
      currentMembership: new Map([
        ["local-a", null],
        ["local-b", null],
      ]),
      ghgStatementId: "stmt-1",
    });

    expect(decision.toLink.sort()).toEqual(["local-a", "local-b"]);
    expect(decision.linkedRemovalIds.sort()).toEqual(["local-a", "local-b"]);
    expect(decision.warnings).toEqual([]);
  });

  it("does not steal a removal already linked to a different statement", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_a"],
      externalToLocal: new Map([["rmv_a", "local-a"]]),
      currentMembership: new Map([["local-a", "other-stmt"]]),
      ghgStatementId: "stmt-1",
    });

    expect(decision.toLink).toEqual([]);
    expect(decision.linkedRemovalIds).toEqual([]);
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0]).toContain("different GHG statement");
  });

  it("treats a removal already linked to this statement as idempotent", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_a"],
      externalToLocal: new Map([["rmv_a", "local-a"]]),
      currentMembership: new Map([["local-a", "stmt-1"]]),
      ghgStatementId: "stmt-1",
    });

    // Not re-stamped, but counted as linked — no warning.
    expect(decision.toLink).toEqual([]);
    expect(decision.linkedRemovalIds).toEqual(["local-a"]);
    expect(decision.warnings).toEqual([]);
  });

  it("warns when Isometric returns a removal with no local ledger row", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_a", "rmv_ghost"],
      externalToLocal: new Map([["rmv_a", "local-a"]]),
      currentMembership: new Map([["local-a", null]]),
      ghgStatementId: "stmt-1",
    });

    expect(decision.toLink).toEqual(["local-a"]);
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0]).toContain("rmv_ghost");
    expect(decision.warnings[0]).toContain("it is not saved in noma");
  });

  it("warns when a ledger row points at a missing removal row", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_a"],
      externalToLocal: new Map([["rmv_a", "local-gone"]]),
      currentMembership: new Map(), // removal row absent
      ghgStatementId: "stmt-1",
    });

    expect(decision.toLink).toEqual([]);
    expect(decision.linkedRemovalIds).toEqual([]);
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0]).toContain("no removal row");
  });

  it("dedupes when two external ids map to the same local removal", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_a", "rmv_a2"],
      externalToLocal: new Map([
        ["rmv_a", "local-a"],
        ["rmv_a2", "local-a"],
      ]),
      currentMembership: new Map([["local-a", null]]),
      ghgStatementId: "stmt-1",
    });

    expect(decision.toLink).toEqual(["local-a"]);
    expect(decision.linkedRemovalIds).toEqual(["local-a"]);
    expect(decision.warnings).toEqual([]);
  });

  it("ignores extras in externalToLocal that are not in externalRemovalIds", () => {
    // The caller may pre-load a wider ledger window into externalToLocal;
    // decideRemovalMembership must only act on entries Isometric actually
    // returned for this statement.
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_present"],
      externalToLocal: new Map([
        ["rmv_present", "local-present"],
        ["rmv_extra", "local-extra"],
      ]),
      currentMembership: new Map([
        ["local-present", null],
        ["local-extra", null],
      ]),
      ghgStatementId: "stmt-1",
    });

    // Only the present mapping is linked; the extra is silently ignored.
    expect(decision.toLink).toEqual(["local-present"]);
    expect(decision.linkedRemovalIds).toEqual(["local-present"]);
    expect(decision.warnings).toEqual([]);
  });

  it("returns an empty decision for an empty removal set", () => {
    expect(
      decideRemovalMembership({
        externalRemovalIds: [],
        externalToLocal: new Map(),
        currentMembership: new Map(),
        ghgStatementId: "stmt-1",
      }),
    ).toEqual({ toLink: [], linkedRemovalIds: [], warnings: [] });
  });

  it("links some and warns on others in one mixed pass", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_new", "rmv_mine", "rmv_theirs", "rmv_ghost"],
      externalToLocal: new Map([
        ["rmv_new", "local-new"],
        ["rmv_mine", "local-mine"],
        ["rmv_theirs", "local-theirs"],
      ]),
      currentMembership: new Map([
        ["local-new", null],
        ["local-mine", "stmt-1"],
        ["local-theirs", "other-stmt"],
      ]),
      ghgStatementId: "stmt-1",
    });

    expect(decision.toLink).toEqual(["local-new"]);
    expect(decision.linkedRemovalIds.sort()).toEqual([
      "local-mine",
      "local-new",
    ]);
    // rmv_theirs (steal guard) + rmv_ghost (no local record).
    expect(decision.warnings).toHaveLength(2);
  });
});
