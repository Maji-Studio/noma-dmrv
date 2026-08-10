import { describe, expect, it } from "vitest";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { deriveCreditBatchLifecycle } from "./credit-batch-lifecycle";

function summary(
  overrides: Partial<CreditBatchHealthSummary> = {},
): CreditBatchHealthSummary {
  return {
    state: "ready",
    issueCount: 0,
    removalId: null,
    removalStatus: null,
    ghgStatementId: null,
    ghgStatementStatus: null,
    ...overrides,
  };
}

describe("deriveCreditBatchLifecycle", () => {
  it("distinguishes incomplete from submission-ready pre-submission batches", () => {
    expect(deriveCreditBatchLifecycle(summary())).toMatchObject({
      badgeStatus: "ready",
      label: "Batch data ready",
      stepStates: ["success", "inactive", "inactive", "inactive"],
    });
    expect(
      deriveCreditBatchLifecycle(
        summary({ state: "incomplete", issueCount: 3 }),
      ),
    ).toMatchObject({
      badgeStatus: "pending",
      label: "Open",
    });
  });

  it("shows a ready batch as ready when its removal is not submitted", () => {
    expect(
      deriveCreditBatchLifecycle(
        summary({
          removalId: "removal-1",
          removalStatus: {
            kind: "not-submitted",
            value: "draft",
            label: "Not submitted",
            isActionable: true,
            isTerminal: false,
          },
        }),
      ),
    ).toMatchObject({
      badgeStatus: "ready",
      label: "Batch data ready",
    });
  });

  it("reports the removal state after grouping", () => {
    const lifecycle = deriveCreditBatchLifecycle(
      summary({
        removalId: "removal-1",
        removalStatus: {
          kind: "submitted",
          value: "issued",
          label: "Submitted",
          isActionable: false,
          isTerminal: true,
        },
      }),
    );

    expect(lifecycle.label).toBe("Removal submitted");
    expect(lifecycle.currentStepIndex).toBe(1);
    expect(lifecycle.stepStates).toEqual([
      "success",
      "active",
      "inactive",
      "inactive",
    ]);
  });

  it("surfaces an interrupted removal on the credit-batch lifecycle", () => {
    const lifecycle = deriveCreditBatchLifecycle(
      summary({
        removalId: "removal-1",
        removalStatus: {
          kind: "interrupted",
          value: "failed",
          label: "Submission interrupted",
          isActionable: false,
          isTerminal: false,
        },
      }),
    );

    expect(lifecycle).toMatchObject({
      badgeStatus: "failed",
      label: "Submission interrupted",
      currentStepIndex: 0,
      stepStates: ["failed", "inactive", "inactive", "inactive"],
    });
  });

  it("uses the downstream statement as the highest lifecycle signal", () => {
    const lifecycle = deriveCreditBatchLifecycle(
      summary({
        removalId: "removal-1",
        removalStatus: {
          kind: "submitted",
          value: "issued",
          label: "Submitted",
          isActionable: false,
          isTerminal: true,
        },
        ghgStatementId: "statement-1",
        ghgStatementStatus: {
          kind: "in-verification",
          value: "pending",
          label: "In verification",
          isActionable: false,
          isTerminal: false,
        },
      }),
    );

    expect(lifecycle.label).toBe("In verification");
    expect(lifecycle.currentStepIndex).toBe(1);
  });

  it("reserves the final success milestone for issued credits", () => {
    const lifecycle = deriveCreditBatchLifecycle(
      summary({
        removalId: "removal-1",
        ghgStatementId: "statement-1",
        ghgStatementStatus: {
          kind: "issued",
          value: "issued",
          label: "Issued",
          isActionable: false,
          isTerminal: true,
        },
      }),
    );

    expect(lifecycle.label).toBe("Credits issued");
    expect(lifecycle.stepStates).toEqual([
      "success",
      "success",
      "success",
      "success",
    ]);
  });

  it("derives lifecycle from the stable kind rather than display copy", () => {
    const lifecycle = deriveCreditBatchLifecycle(
      summary({
        removalId: "removal-1",
        ghgStatementId: "statement-1",
        ghgStatementStatus: {
          kind: "verified",
          value: "verified",
          label: "Verifier approved",
          isActionable: false,
          isTerminal: true,
        },
      }),
    );

    expect(lifecycle.label).toBe("Verified");
    expect(lifecycle.currentStepIndex).toBe(2);
  });
});
