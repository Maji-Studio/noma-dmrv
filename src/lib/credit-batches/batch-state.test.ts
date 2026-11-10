import { describe, expect, it } from "vitest";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import { creditBatchStateOf } from "./batch-state";
import { deriveCreditBatchLifecycle } from "@/lib/certification/credit-batch-lifecycle";
import { deriveRemovalStatus, type LocalSubmissionStatus } from "@/lib/certification/status";

const open: CreditBatchHealthSummary = {
  state: "incomplete",
  issueCount: 2,
  linesToDecide: 0,
  checkCount: 1,
  removalId: null,
  removalCode: null,
  productionEmissionsClaimedByRemovalCode: null,
  removalStatus: null,
  removalInterrupted: false,
  hasSubmittedRemoval: false,
  ghgStatementId: null,
  ghgStatementStatus: null,
};

describe("creditBatchStateOf", () => {
  it.each<{
    holder: string;
    newest: LocalSubmissionStatus;
    hasSubmittedRemoval: boolean;
    inFlight?: boolean;
    interrupted?: boolean;
    ready?: boolean;
  }>([
    { holder: "only newest submitted", newest: "submitted", hasSubmittedRemoval: true },
    { holder: "older submitted and newer draft", newest: "draft", hasSubmittedRemoval: true },
    { holder: "older submitted and newer rejected", newest: "rejected", hasSubmittedRemoval: true },
    { holder: "older submitted and newer superseded", newest: "superseded", hasSubmittedRemoval: true },
    { holder: "older submitted and newer in progress", newest: "draft", inFlight: true, hasSubmittedRemoval: true },
    { holder: "interrupted and submitted holders", newest: "submitted", hasSubmittedRemoval: true, interrupted: true },
    { holder: "no submitted holder, ready", newest: "draft", hasSubmittedRemoval: false, ready: true },
    { holder: "no submitted holder, incomplete", newest: "draft", hasSubmittedRemoval: false },
  ])("uses the batch phase for $holder", ({ newest, hasSubmittedRemoval, inFlight = false, interrupted = false, ready = false }) => {
    const input: CreditBatchHealthSummary = {
      ...open,
      state: ready ? "ready" : "incomplete",
      issueCount: ready ? 0 : open.issueCount,
      removalId: "newest-holder",
      removalStatus: deriveRemovalStatus({ local: newest, lockInFlight: inFlight }),
      removalInterrupted: interrupted,
      hasSubmittedRemoval,
    };
    expect(creditBatchStateOf(input)).toEqual({
      state: interrupted ? "interrupted" : hasSubmittedRemoval ? "submitted" : ready ? "ready" : "blocking",
      blockingCount: interrupted || !hasSubmittedRemoval && !ready ? open.issueCount : 0,
      openTodoCount: interrupted || !hasSubmittedRemoval && !ready ? open.issueCount + open.checkCount : 0,
    });
    expect(deriveCreditBatchLifecycle(input)).toMatchObject({
      currentStep: interrupted || !hasSubmittedRemoval ? "open" : "removal-submitted",
      currentStepFailed: interrupted,
      label: interrupted ? "Submission interrupted" : hasSubmittedRemoval ? "Removal submitted" : ready ? "Batch data ready" : "Open",
    });
  });

  it("has no state before readiness loads", () => {
    expect(creditBatchStateOf(undefined)).toEqual({ state: null, blockingCount: 0, openTodoCount: 0 });
  });

  it("counts Blocking and Check items while the batch is Open", () => {
    expect(creditBatchStateOf(open)).toEqual({ state: "blocking", blockingCount: 2, openTodoCount: 3 });
  });

  it("shows no count while Ready, even with Check items", () => {
    expect(creditBatchStateOf({ ...open, state: "ready", issueCount: 0, checkCount: 2 })).toEqual({ state: "ready", blockingCount: 0, openTodoCount: 0 });
  });

  it("drops the count once a Removal is submitted", () => {
    const submitted = creditBatchStateOf({
      ...open,
      removalId: "removal-1",
      removalStatus: { kind: "submitted", value: "issued", label: "Submitted", isActionable: false, isTerminal: false },
    });
    expect(submitted).toEqual({ state: "submitted", blockingCount: 0, openTodoCount: 0 });
  });
  it("reads interrupted when an older holder is interrupted and the newest is submitted", () => {
    expect(creditBatchStateOf({
      ...open,
      removalId: "newest-submitted",
      removalStatus: { kind: "submitted", value: "issued", label: "Submitted", isActionable: false, isTerminal: false },
      removalInterrupted: true,
    })).toEqual({ state: "interrupted", blockingCount: 2, openTodoCount: 3 });
  });
  it.each([
    { issueCount: 2, checkCount: 1, openTodoCount: 3 },
    { issueCount: 0, checkCount: 2, openTodoCount: 2 },
    { issueCount: 0, checkCount: 0, openTodoCount: 0 },
  ])("keeps $openTodoCount open to-dos during an interrupted submission", ({ issueCount, checkCount, openTodoCount }) => {
    expect(creditBatchStateOf({ ...open, removalInterrupted: true, issueCount, checkCount }))
      .toEqual({ state: "interrupted", blockingCount: issueCount, openTodoCount });
  });
  it("drops the count once credits are issued", () => {
    expect(creditBatchStateOf({
      ...open,
      ghgStatementId: "statement-1",
      ghgStatementStatus: { kind: "issued", value: "issued", label: "Issued", isActionable: false, isTerminal: true },
    })).toEqual({ state: "issued", blockingCount: 0, openTodoCount: 0 });
  });
});
