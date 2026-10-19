import { describe, expect, it } from "vitest";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { creditBatchStateOf } from "./batch-state";

const open: CreditBatchHealthSummary = {
  state: "incomplete",
  issueCount: 3,
  removalId: null,
  removalCode: null,
  productionEmissionsClaimedByRemovalCode: null,
  removalStatus: null,
  ghgStatementId: null,
  ghgStatementStatus: null,
};

describe("creditBatchStateOf", () => {
  it("has no state before readiness loads", () => {
    expect(creditBatchStateOf(undefined)).toEqual({ state: null, blockingCount: 0 });
  });

  it("counts blocking items while the batch is Open", () => {
    expect(creditBatchStateOf(open)).toEqual({ state: "blocking", blockingCount: 3 });
  });

  it("is Ready with no count once the data is complete", () => {
    expect(creditBatchStateOf({ ...open, state: "ready", issueCount: 0 })).toEqual({ state: "ready", blockingCount: 0 });
  });

  it("drops the count once a Removal is submitted", () => {
    const submitted = creditBatchStateOf({
      ...open,
      removalId: "removal-1",
      removalStatus: { kind: "submitted", value: "issued", label: "Submitted", isActionable: false, isTerminal: false },
    });
    expect(submitted).toEqual({ state: "submitted", blockingCount: 0 });
  });
});
