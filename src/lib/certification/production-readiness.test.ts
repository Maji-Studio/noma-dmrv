import { describe, expect, it } from "vitest";
import { missingApplicationLineageGap } from "./production-readiness";

describe("missingApplicationLineageGap", () => {
  it.each([
    ["creditBatch", "this credit batch"],
    ["removal", "this Removal"],
  ] as const)("routes a %s with no completed member runs to Production Runs", (scope, subject) => {
    expect(
      missingApplicationLineageGap({
        hasCompletedMemberProductionRuns: false,
        scope,
      }),
    ).toEqual({
      kind: "noProductionRuns",
      detail: `No completed production runs are linked to ${subject}. Complete a matching production run to continue.`,
      fixTarget: "productionRuns",
    });
  });

  it.each([
    ["creditBatch", "this credit batch"],
    ["removal", "this Removal"],
  ] as const)("routes a %s with member runs but no applications to Applications", (scope, subject) => {
    expect(
      missingApplicationLineageGap({
        hasCompletedMemberProductionRuns: true,
        scope,
      }),
    ).toEqual({
      kind: "noApplications",
      detail: `No applications are linked to ${subject}'s production runs. Review the product, delivery, and application chain.`,
      fixTarget: "applications",
    });
  });
});
