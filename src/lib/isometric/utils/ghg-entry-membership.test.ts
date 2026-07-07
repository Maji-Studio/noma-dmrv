import { describe, expect, it } from "vitest";
import {
  decideRemovalMembership,
  expectedButExcludedWarnings,
  type ExpectedRemoval,
} from "./ghg-entry-membership";

describe("decideRemovalMembership", () => {
  it("links an unlinked removal Isometric returned", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_1"],
      externalToLocal: new Map([["rmv_1", "local-1"]]),
      currentMembership: new Map([["local-1", null]]),
      ghgStatementId: "ggs-a",
    });
    expect(decision.toLink).toEqual(["local-1"]);
    expect(decision.linkedRemovalIds).toEqual(["local-1"]);
    expect(decision.warnings).toEqual([]);
  });

  it("is idempotent for a removal already linked to this statement", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_1"],
      externalToLocal: new Map([["rmv_1", "local-1"]]),
      currentMembership: new Map([["local-1", "ggs-a"]]),
      ghgStatementId: "ggs-a",
    });
    expect(decision.toLink).toEqual([]);
    expect(decision.linkedRemovalIds).toEqual(["local-1"]);
    expect(decision.warnings).toEqual([]);
  });

  it("never steals a removal already owned by another statement", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_1"],
      externalToLocal: new Map([["rmv_1", "local-1"]]),
      currentMembership: new Map([["local-1", "ggs-other"]]),
      ghgStatementId: "ggs-a",
    });
    expect(decision.toLink).toEqual([]);
    expect(decision.linkedRemovalIds).toEqual([]);
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0]).toContain("already linked to a different");
  });

  it("warns about a registry id with no local ledger row", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_unknown"],
      externalToLocal: new Map(),
      currentMembership: new Map(),
      ghgStatementId: "ggs-a",
    });
    expect(decision.toLink).toEqual([]);
    expect(decision.linkedRemovalIds).toEqual([]);
    expect(decision.warnings[0]).toContain("no local record");
  });

  it("dedupes when two external ids map to the same local removal", () => {
    const decision = decideRemovalMembership({
      externalRemovalIds: ["rmv_1", "rmv_1-dup"],
      externalToLocal: new Map([
        ["rmv_1", "local-1"],
        ["rmv_1-dup", "local-1"],
      ]),
      currentMembership: new Map([["local-1", null]]),
      ghgStatementId: "ggs-a",
    });
    expect(decision.toLink).toEqual(["local-1"]);
    expect(decision.linkedRemovalIds).toEqual(["local-1"]);
  });
});

describe("expectedButExcludedWarnings", () => {
  const expected: ExpectedRemoval[] = [
    { localId: "local-1", externalId: "rmv_1" },
    { localId: "local-2", externalId: "rmv_2" },
    { localId: "local-3", externalId: "rmv_3" },
  ];

  it("returns no warnings when every expected removal linked", () => {
    expect(
      expectedButExcludedWarnings(expected, [
        "local-1",
        "local-2",
        "local-3",
      ]),
    ).toEqual([]);
  });

  it("flags an expected removal the registry placed elsewhere", () => {
    const warnings = expectedButExcludedWarnings(expected, [
      "local-1",
      "local-3",
    ]);
    expect(warnings).toHaveLength(1);
    // The warning names the registry-facing id the operator recognises,
    // not the internal local uuid.
    expect(warnings[0]).toContain("rmv_2");
    expect(warnings[0]).not.toContain("local-2");
  });

  it("flags every excluded removal when the registry linked none", () => {
    const warnings = expectedButExcludedWarnings(expected, []);
    expect(warnings).toHaveLength(3);
  });

  it("returns nothing when nothing was expected", () => {
    expect(expectedButExcludedWarnings([], ["local-9"])).toEqual([]);
  });

  it("counts a removal linked even if extra unexpected ones also linked", () => {
    // `linkedRemovalIds` may include removals we did not predict (e.g. one the
    // registry pulled forward); those don't produce a warning here.
    const warnings = expectedButExcludedWarnings(
      [{ localId: "local-1", externalId: "rmv_1" }],
      ["local-1", "local-surprise"],
    );
    expect(warnings).toEqual([]);
  });
});
