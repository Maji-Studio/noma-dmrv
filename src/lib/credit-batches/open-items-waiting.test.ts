import { describe, expect, it } from "vitest";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import { buildCreditBatchWaitingItems } from "./open-items";

function pageModel(): CreditBatchPageModel {
  return {
    creditBatchId: "batch",
    facilityId: "facility",
    slices: [],
    removals: [],
    mass: {
      producedDryKg: 100,
      appliedDryKg: 50,
      inSubmittedDryKg: 0,
      inDraftDryKg: 0,
      notInRemovalDryKg: 50,
      notAppliedDryKg: 50,
    },
    milestones: {
      firstRemovalSubmittedAt: null,
      firstRemovalSubmittedCode: null,
      ghgStatement: {
        id: "statement",
        reportingPeriodStartOn: null,
        reportingPeriodEndOn: "2026-06-30",
        hasMissingPeriod: false,
        status: { kind: "in-verification", value: "pending", label: "In verification", isActionable: false, isTerminal: false },
        submittedToVerifierAt: null,
        creditsIssuedAt: null,
      },
    },
  };
}

describe("buildCreditBatchWaitingItems", () => {
  it("lists a statement in verification and biochar not applied yet, then clears them", () => {
    const model = pageModel();
    expect(buildCreditBatchWaitingItems(model)).toEqual([
      {
        id: "verification:statement",
        title: "GHG Statement Ends Jun 30, 2026: In verification",
        target: { tab: "removals" },
      },
      {
        id: "not-applied",
        title: "0.05 t produced but not applied yet",
        detail: "It can join a Removal once its application is recorded.",
        target: { tab: "removals" },
      },
    ]);
    model.mass.notAppliedDryKg = null;
    model.milestones.ghgStatement!.status = { kind: "verified", value: "verified", label: "Verified", isActionable: false, isTerminal: true };
    expect(buildCreditBatchWaitingItems(model)).toEqual([]);
  });

  it("is empty before the page model loads", () => {
    expect(buildCreditBatchWaitingItems(undefined)).toEqual([]);
  });

  it.each([null, 0, 0.001, 4.999])("omits the unapplied item for %s dry kg", notAppliedDryKg => {
    const model = pageModel();
    model.mass.notAppliedDryKg = notAppliedDryKg;
    model.milestones.ghgStatement = null;
    expect(buildCreditBatchWaitingItems(model)).toEqual([]);
  });

  it.each([5, 5.001])("shows the unapplied item at the visible threshold for %s dry kg", notAppliedDryKg => {
    const model = pageModel();
    model.mass.notAppliedDryKg = notAppliedDryKg;
    model.milestones.ghgStatement = null;
    expect(buildCreditBatchWaitingItems(model)).toEqual([{
      id: "not-applied",
      title: "0.01 t produced but not applied yet",
      detail: "It can join a Removal once its application is recorded.",
      target: { tab: "removals" },
    }]);
  });

  it.each([
    {
      reportingPeriodStartOn: "2026-01-01",
      hasMissingPeriod: false,
      title: "GHG Statement Jan 1 to Jun 30, 2026: In verification",
    },
    {
      reportingPeriodStartOn: "2026-01-01",
      hasMissingPeriod: true,
      title: "GHG Statement No period set: In verification",
    },
  ])("formats the waiting period: $title", ({ title, ...period }) => {
    const model = pageModel();
    Object.assign(model.milestones.ghgStatement!, period);
    expect(buildCreditBatchWaitingItems(model)[0].title).toBe(title);
  });
});
