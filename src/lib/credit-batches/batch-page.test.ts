import { describe, expect, it } from "vitest";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import type { DerivedStatus } from "@/lib/certification/status";
import type { RecordLockView } from "@/lib/record-lock-view";
import {
  creditBatchMilestones,
  creditBatchPrimaryAction,
  isCreditBatchSent,
  overviewBadgeCount,
} from "./batch-page";
import type { CreditBatchOpenItem } from "./open-items";

type Removal = CreditBatchPageModel["removals"][number];
type Statement = NonNullable<CreditBatchPageModel["milestones"]["ghgStatement"]>;

const DRAFT_STATUS: DerivedStatus = { kind: "not-submitted", value: "draft", label: "Not submitted", isActionable: true, isTerminal: false };
const SUBMITTED_STATUS: DerivedStatus = { kind: "submitted", value: "running", label: "Submitted", isActionable: false, isTerminal: true };

function removal(overrides: Partial<Removal> = {}): Removal {
  return {
    id: "removal-1",
    code: "RM-26-001",
    status: DRAFT_STATUS,
    phase: "draft",
    createdAt: new Date("2026-10-01T10:00:00Z"),
    submittedAt: null,
    ghgStatementId: null,
    dryKg: 0,
    ...overrides,
  };
}

const STATEMENT_LABELS: Partial<Record<Statement["status"]["kind"], string>> = {
  verified: "Verified", issued: "Issued", "verification-failed": "Verification failed", "in-verification": "In verification",
};

function statement(kind: Statement["status"]["kind"], overrides: Partial<Statement> = {}): Statement {
  const status: Statement["status"] = { kind, value: "pending", label: STATEMENT_LABELS[kind] ?? kind, isActionable: false, isTerminal: false };
  return {
    id: "statement",
    reportingPeriodStartOn: "2026-07-01",
    reportingPeriodEndOn: "2026-09-30",
    hasMissingPeriod: false,
    status,
    submittedToVerifierAt: null,
    creditsIssuedAt: null,
    ...overrides,
  };
}

function model(overrides: { removals?: Removal[]; mass?: Partial<CreditBatchPageModel["mass"]>; milestones?: Partial<CreditBatchPageModel["milestones"]> } = {}): CreditBatchPageModel {
  return {
    creditBatchId: "batch",
    facilityId: "facility",
    slices: [],
    removals: overrides.removals ?? [],
    mass: {
      producedDryKg: 1000,
      appliedDryKg: 800,
      inSubmittedDryKg: 0,
      inDraftDryKg: 0,
      notInRemovalDryKg: 800,
      notAppliedDryKg: 200,
      ...overrides.mass,
    },
    milestones: {
      firstRemovalSubmittedAt: null,
      firstRemovalSubmittedCode: null,
      ghgStatement: null,
      ...overrides.milestones,
    },
  };
}

function item(id: string): CreditBatchOpenItem {
  return { id, title: id, target: { tab: "samples" } };
}

const SENT_LOCK: RecordLockView = { level: "sent", heldBy: [], usedBy: [], freeFields: [], howToFree: null, returnedBy: [] };

describe("overviewBadgeCount", () => {
  it("counts Blocking and Check, never Waiting", () => {
    expect(overviewBadgeCount({ blocking: [item("a")], check: [item("b"), item("c")], waiting: [item("d")] })).toBe(3);
    expect(overviewBadgeCount({ blocking: [], check: [], waiting: [item("d"), item("e")] })).toBe(0);
  });
});

describe("creditBatchMilestones", () => {
  it("reads Open to-dos with the Overview badge count while items block", () => {
    // 2 Blocking + 2 Check: the step shows the same 4 as the Overview tab.
    const [data, removalStep, verified, issued] = creditBatchMilestones({ blockingCount: 2, openCount: 4, pageModel: model() });
    expect(data).toEqual({ key: "data", label: "Open to-dos", state: "current", caption: null, count: 4 });
    expect([removalStep.state, verified.state, issued.state]).toEqual(["todo", "todo", "todo"]);
  });

  it("reads Ready for submission when only Check items remain", () => {
    expect(creditBatchMilestones({ blockingCount: 0, openCount: 3, pageModel: model() })[0]).toEqual({ key: "data", label: "Ready for submission", state: "done", caption: null });
  });

  it("reads Ready for submission without a date once nothing blocks, and names a draft Removal", () => {
    const steps = creditBatchMilestones({ blockingCount: 0, openCount: 0, pageModel: model({ removals: [removal()] }) });
    expect(steps[0]).toEqual({ key: "data", label: "Ready for submission", state: "done", caption: null });
    expect(steps[1]).toMatchObject({ state: "current", caption: "RM-26-001 in draft" });
  });

  it("shows the submitted share of a partly sent batch", () => {
    const steps = creditBatchMilestones({
      blockingCount: 0,
      openCount: 0,
      pageModel: model({
        removals: [removal({ phase: "submitted", status: SUBMITTED_STATUS, submittedAt: new Date("2026-10-12T00:00:00Z") })],
        mass: { inSubmittedDryKg: 300, notInRemovalDryKg: 500 },
        milestones: { firstRemovalSubmittedAt: new Date("2026-10-12T00:00:00Z"), firstRemovalSubmittedCode: "RM-26-001" },
      }),
    });
    expect(steps[1]).toMatchObject({ state: "done", caption: "RM-26-001, 0.30 t of 0.80 t" });
    expect(steps[2]).toMatchObject({ state: "current", caption: null });
  });

  it("dates a fully sent Removal and keeps Verified undated", () => {
    const submittedAt = new Date("2026-10-12T12:00:00Z");
    const steps = creditBatchMilestones({
      blockingCount: 0,
      openCount: 0,
      pageModel: model({
        removals: [removal({ phase: "submitted", status: SUBMITTED_STATUS, submittedAt, dryKg: 800 })],
        mass: { inSubmittedDryKg: 800, notInRemovalDryKg: 0 },
        milestones: { firstRemovalSubmittedAt: submittedAt, firstRemovalSubmittedCode: "RM-26-001", ghgStatement: statement("verified") },
      }),
    });
    expect(steps[1].caption).toBe("RM-26-001, Oct 12, 2026");
    expect(steps[2]).toMatchObject({ state: "done", caption: null });
    expect(steps[3]).toMatchObject({ state: "current", caption: null });
  });

  it("dates issued credits and marks failed verification", () => {
    const base = { firstRemovalSubmittedAt: new Date("2026-10-12T00:00:00Z"), firstRemovalSubmittedCode: "RM-26-001" };
    const issued = creditBatchMilestones({ blockingCount: 0, openCount: 0, pageModel: model({ milestones: { ...base, ghgStatement: statement("issued", { creditsIssuedAt: "2026-11-03" }) } }) });
    expect(issued.map((step) => step.state)).toEqual(["done", "done", "done", "done"]);
    expect(issued[3].caption).toBe("Nov 3, 2026");
    const failed = creditBatchMilestones({ blockingCount: 0, openCount: 0, pageModel: model({ milestones: { ...base, ghgStatement: statement("verification-failed") } }) });
    expect(failed[2]).toMatchObject({ state: "failed", caption: "Verification failed" });
  });

  it("names the data step without a verdict while the health loads or failed", () => {
    expect(creditBatchMilestones({ blockingCount: null, openCount: 0, pageModel: undefined })[0]).toEqual({ key: "data", label: "Batch data", state: "current", caption: null });
  });
});

describe("creditBatchPrimaryAction", () => {
  it("waits for the health and the page model", () => {
    expect(creditBatchPrimaryAction({ blocking: undefined, pageModel: model(), lock: undefined })).toBeNull();
    expect(creditBatchPrimaryAction({ blocking: [], pageModel: undefined, lock: undefined })).toBeNull();
  });

  it("offers nothing while a blocking item exists", () => {
    expect(creditBatchPrimaryAction({ blocking: [item("first"), item("second")], pageModel: model({ removals: [removal()] }), lock: undefined })).toBeNull();
    expect(creditBatchPrimaryAction({ blocking: [item("first")], pageModel: model(), lock: undefined })).toBeNull();
  });

  it("opens the draft Removal before starting a new one", () => {
    expect(creditBatchPrimaryAction({ blocking: [], pageModel: model({ removals: [removal()] }), lock: undefined }))
      .toEqual({ kind: "draft", label: "Open RM-26-001", removalId: "removal-1" });
  });

  it("starts a Removal when applied biochar is in none", () => {
    expect(creditBatchPrimaryAction({ blocking: [], pageModel: model(), lock: undefined })).toEqual({ kind: "start", label: "Start Removal" });
  });

  it("offers nothing when no applied biochar waits", () => {
    expect(creditBatchPrimaryAction({ blocking: [], pageModel: model({ mass: { appliedDryKg: 0, notInRemovalDryKg: 0 } }), lock: undefined })).toBeNull();
  });

  it("offers nothing once a Removal or the batch is submitted", () => {
    const submitted = model({ removals: [removal({ phase: "submitted", status: SUBMITTED_STATUS })] });
    expect(creditBatchPrimaryAction({ blocking: [item("a")], pageModel: submitted, lock: undefined })).toBeNull();
    expect(creditBatchPrimaryAction({ blocking: [], pageModel: model(), lock: SENT_LOCK })).toBeNull();
  });
});

describe("isCreditBatchSent", () => {
  it("is false for an open batch, a draft Removal and while the model loads", () => {
    expect(isCreditBatchSent({ pageModel: model(), lock: undefined })).toBe(false);
    expect(isCreditBatchSent({ pageModel: model({ removals: [removal()] }), lock: undefined })).toBe(false);
    expect(isCreditBatchSent({ pageModel: undefined, lock: undefined })).toBe(false);
  });

  it("is true once a Removal is submitted or the record lock says sent", () => {
    expect(isCreditBatchSent({ pageModel: model({ removals: [removal({ phase: "submitted", status: SUBMITTED_STATUS })] }), lock: undefined })).toBe(true);
    expect(isCreditBatchSent({ pageModel: model(), lock: SENT_LOCK })).toBe(true);
    expect(isCreditBatchSent({ pageModel: undefined, lock: SENT_LOCK })).toBe(true);
  });
});
