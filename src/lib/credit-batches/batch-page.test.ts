import { UNKNOWN_FACILITY_TIMEZONE } from "@/lib/date-utils";
import { describe, expect, it } from "vitest";
import type { CreditBatchPageModel } from "@/data-access/credit-batch-page-model";
import type { DerivedStatus } from "@/lib/certification/status";
import type { RecordLockView } from "@/lib/record-lock-view";
import {
  creditBatchMilestones,
  creditBatchPrimaryAction,
  isCreditBatchSent,
  overviewBadgeCount,
  readOnlyOpenItems,
  tabBadge,
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
  it("reads submission and issuance instants on the batch facility calendar", () => {
    const at = new Date("2026-10-21T22:00:00Z");
    const steps = creditBatchMilestones({
      timeZone: "Africa/Dar_es_Salaam", blockingCount: 0, openCount: 0,
      pageModel: model({
        mass: { inSubmittedDryKg: 800 },
        milestones: {
          firstRemovalSubmittedAt: at, firstRemovalSubmittedCode: "RM-26-001",
          ghgStatement: statement("issued", { creditsIssuedAt: at.toISOString() }),
        },
      }),
    });
    expect(steps[1].caption).toBe("RM-26-001, Oct 22, 2026");
    expect(steps[3].caption).toBe("Oct 22, 2026");
  });

  it("reads Open to-dos with the Overview badge count while items block", () => {
    // 2 Blocking + 2 Check: the step shows the same 4 as the Overview tab.
    const [data, removalStep, verified, issued] = creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE, blockingCount: 2, openCount: 4, pageModel: model() });
    expect(data).toEqual({ key: "data", label: "Open to-dos", state: "current", caption: null, count: 4 });
    expect([removalStep.state, verified.state, issued.state]).toEqual(["todo", "todo", "todo"]);
  });

  it("reads Ready for submission when only Check items remain", () => {
    expect(creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE, blockingCount: 0, openCount: 3, pageModel: model() })[0]).toEqual({ key: "data", label: "Ready for submission", state: "done", caption: null });
  });

  it("reads Ready for submission without a date once nothing blocks, and names a draft Removal", () => {
    const steps = creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE, blockingCount: 0, openCount: 0, pageModel: model({ removals: [removal()] }) });
    expect(steps[0]).toEqual({ key: "data", label: "Ready for submission", state: "done", caption: null });
    expect(steps[1]).toMatchObject({ state: "current", caption: "RM-26-001 in draft" });
  });

  it("shows the submitted share of a partly sent batch", () => {
    const steps = creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE,
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
    const steps = creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE,
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
    const issued = creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE, blockingCount: 0, openCount: 0, pageModel: model({ milestones: { ...base, ghgStatement: statement("issued", { creditsIssuedAt: "2026-11-03" }) } }) });
    expect(issued.map((step) => step.state)).toEqual(["done", "done", "done", "done"]);
    expect(issued[3].caption).toBe("Nov 3, 2026");
    const failed = creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE, blockingCount: 0, openCount: 0, pageModel: model({ milestones: { ...base, ghgStatement: statement("verification-failed") } }) });
    expect(failed[2]).toMatchObject({ state: "failed", caption: "Verification failed" });
  });

  it("names the data step without a verdict while the health loads or failed", () => {
    expect(creditBatchMilestones({ timeZone: UNKNOWN_FACILITY_TIMEZONE, blockingCount: null, openCount: 0, pageModel: undefined })[0]).toEqual({ key: "data", label: "Batch data", state: "current", caption: null });
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

describe("tabBadge", () => {
  const item = (id: string, target: CreditBatchOpenItem["target"]): CreditBatchOpenItem => ({ id, title: id, target });
  const groups = {
    blocking: [item("b1", { tab: "samples" }), item("b2", { tab: "emissions" })],
    check: [item("c1", { tab: "emissions" })],
    waiting: [item("w1", { tab: "removals" })],
  };

  it("gives Overview the total and each tab its own count", () => {
    expect(tabBadge("overview", groups)).toEqual({ count: 3, blocking: true });
    expect(tabBadge("samples", groups)).toEqual({ count: 1, blocking: true });
    expect(tabBadge("emissions", groups)).toEqual({ count: 2, blocking: true });
    expect(tabBadge("production", groups)).toBeNull();
  });

  it("counts href and Overview targets only in the Overview total", () => {
    const g = { blocking: [item("h", { href: "/settings" }), item("o", { tab: "overview", rowId: "batch-details" })], check: [], waiting: [] };
    expect(tabBadge("overview", g)).toEqual({ count: 2, blocking: true });
    for (const tab of ["production", "samples", "emissions", "removals"] as const) expect(tabBadge(tab, g)).toBeNull();
  });

  it("never counts Waiting items", () => {
    expect(tabBadge("removals", groups)).toBeNull();
  });

  it("uses the Check style on a tab with no Blocking item", () => {
    const g = { blocking: [], check: [item("c", { tab: "samples" })], waiting: [] };
    expect(tabBadge("samples", g)).toEqual({ count: 1, blocking: false });
    expect(tabBadge("overview", g)).toEqual({ count: 1, blocking: false });
  });

  it("never gives Activities a badge", () => {
    expect(tabBadge("activities", groups)).toBeNull();
  });
});

describe("readOnlyOpenItems", () => {
  const item = (id: string, target: CreditBatchOpenItem["target"], detail?: string): CreditBatchOpenItem => ({ id, title: id, target, detail });
  it("turns Emissions, repair and batch-details rows into plain facts and keeps other tabs", () => {
    const groups = readOnlyOpenItems({
      blocking: [],
      check: [
        item("late", { tab: "emissions" }, "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Oct 1, 2026."),
        item("fix", { href: "/settings" }, "Open the Removal to see why."),
        item("samples", { tab: "samples" }, "Upload a lab report to one of its Samples. You can still submit the Removal."),
      ],
      waiting: [],
    });
    const [late, fix, samples] = groups.check;
    expect(late.target).toBeNull();
    expect(late.detail).toBe("It is not in this credit batch.");
    expect(fix.target).toBeNull();
    expect(fix.detail).toBeUndefined();
    expect(samples.target).toEqual({ tab: "samples" });
    expect(samples.detail).toBeUndefined();
  });
});
