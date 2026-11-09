import { describe, expect, it } from "vitest";
import type { RemovalCorrection } from "./removal-entry-correction";
import type { RemovalWorkflowStatusInput } from "./status";
import { deriveRemovalShownStatus, listStatusLabel, removalAttentionTitle, type RemovalAttentionSource } from "./removal-shown-status";

const blocked = { state: "blocked", reasons: ["A.", "B.", "C."], fixCount: 2 };
const ready = { state: "ready", reasons: [] };
const submittedReadiness = { state: "submitted", reasons: [] };

const base = { local: null, lockInFlight: false, submissionInterrupted: false, enrichmentStatus: "available", readiness: ready };
const input = (overrides: Record<string, unknown>) => ({ ...base, ...overrides }) as unknown as RemovalWorkflowStatusInput;
const correction = (resubmitNeeded: boolean) => ({ resubmitNeeded }) as RemovalCorrection;

interface WorkflowCase {
  name: string;
  workflow: RemovalWorkflowStatusInput;
  kind: string;
  own: { value: string; label: string; sheetValue: string; sheetLabel: string; nextStep: string | null };
}

const WORKFLOWS: WorkflowCase[] = [
  { name: "checking", workflow: input({ enrichmentStatus: "loading" }), kind: "checking",
    own: { value: "running", label: "Checking status", sheetValue: "running", sheetLabel: "Checking status", nextStep: null } },
  { name: "unavailable", workflow: input({ enrichmentStatus: "unavailable" }), kind: "unavailable",
    own: { value: "pending", label: "Status unavailable", sheetValue: "pending", sheetLabel: "Status unavailable", nextStep: "The checks could not load." } },
  { name: "ready", workflow: input({ readiness: ready }), kind: "ready",
    own: { value: "ready", label: "Ready to submit", sheetValue: "draft", sheetLabel: "Not submitted", nextStep: null } },
  { name: "blocked", workflow: input({ readiness: blocked }), kind: "blocked",
    own: { value: "pending", label: "2 to fix", sheetValue: "draft", sheetLabel: "Not submitted", nextStep: null } },
  { name: "failed", workflow: input({ local: "rejected" }), kind: "failed",
    own: { value: "failed", label: "Submission failed", sheetValue: "failed", sheetLabel: "Submission failed", nextStep: null } },
  { name: "interrupted", workflow: input({ local: "draft", submissionInterrupted: true }), kind: "interrupted",
    own: { value: "failed", label: "Submission interrupted", sheetValue: "failed", sheetLabel: "Submission interrupted", nextStep: null } },
  { name: "submitting", workflow: input({ local: "draft", lockInFlight: true }), kind: "submitting",
    own: { value: "running", label: "Submitting", sheetValue: "running", sheetLabel: "Submitting",
      nextStep: "noma is sending this Removal to Isometric. This can take a few minutes." } },
  { name: "submitted", workflow: input({ local: "submitted", readiness: submittedReadiness }), kind: "submitted",
    own: { value: "issued", label: "Submitted", sheetValue: "issued", sheetLabel: "Submitted",
      nextStep: "Isometric verifies it with the GHG Statement for its reporting period." } },
];

describe("deriveRemovalShownStatus", () => {
  describe.each(WORKFLOWS)("$name, no correction", ({ workflow, kind, own }) => {
    it("shows the workflow's own status on every surface", () => {
      const shown = deriveRemovalShownStatus({ workflow });
      expect(shown.workflow.kind).toBe(kind);
      expect(shown.list).toEqual({ value: own.value, label: own.label });
      expect(shown.sheet).toEqual({ value: own.sheetValue, label: own.sheetLabel });
      expect(shown.searchText).toBe(own.label);
      expect(shown.showLockCell).toBe(true);
      expect(shown.nextStep).toBe(own.nextStep);
    });

    it("appends the lock return to the search text only and silences the next step", () => {
      const shown = deriveRemovalShownStatus({ workflow, returnedByLock: true });
      expect(shown.list).toEqual({ value: own.value, label: own.label });
      expect(shown.sheet).toEqual({ value: own.sheetValue, label: own.sheetLabel });
      expect(shown.searchText).toBe(`${own.label} Correction needed`);
      expect(shown.showLockCell).toBe(true);
      expect(shown.nextStep).toBeNull();
    });

    it.each([
      [false, "Correction needed"],
      [true, "Resubmit needed"],
    ] as const)("overlays the correction (resubmitNeeded %s)", (resubmitNeeded, label) => {
      const shown = deriveRemovalShownStatus({ workflow, correction: correction(resubmitNeeded), returnedByLock: true });
      expect(shown.workflow.kind).toBe(kind);
      expect(shown.list).toEqual({ value: "pending", label });
      // The sheet keeps "Not submitted" for a draft that is not sent yet, even under a correction.
      const draft = kind === "ready" || kind === "blocked";
      expect(shown.sheet).toEqual(draft ? { value: "draft", label: "Not submitted" } : { value: "pending", label });
      // The correction replaces the lock suffix rather than adding to it.
      expect(shown.searchText).toBe(`${own.label} ${label}`);
      expect(shown.showLockCell).toBe(false);
      expect(shown.nextStep).toBeNull();
    });
  });
});

describe("listStatusLabel", () => {
  it("counts a blocked draft's reasons as what to fix", () => {
    expect(listStatusLabel({ kind: "blocked", label: "Needs attention", reasons: ["A.", "B.", "C."] })).toBe("3 to fix");
    expect(listStatusLabel({ kind: "blocked", label: "Needs attention", reasons: ["A."] })).toBe("1 to fix");
  });

  it("reads the fix count the review lists when it differs from the reasons", () => {
    expect(listStatusLabel({ kind: "blocked", label: "Needs attention", reasons: ["A.", "B.", "C.", "D.", "E."], fixCount: 1 })).toBe("1 to fix");
  });

  it("keeps every other state's own label", () => {
    expect(listStatusLabel({ kind: "ready", label: "Ready to submit", reasons: [] })).toBe("Ready to submit");
    expect(listStatusLabel({ kind: "interrupted", label: "Submission interrupted", reasons: ["Retry."] })).toBe("Submission interrupted");
  });
});

describe("removalAttentionTitle", () => {
  const draft = (readiness: Extract<RemovalAttentionSource, { kind: "draft" }>["readiness"]) => removalAttentionTitle({ kind: "draft", readiness });

  it.each([
    ["unavailable", null, "Couldn't check. Open it to see what is left."],
    ["ready", { state: "ready", reasons: [] }, "Ready to submit"],
    ["blocked by reasons", { state: "blocked", reasons: ["A.", "B.", "C."] }, "3 to fix"],
    ["blocked with fixCount", { state: "blocked", reasons: ["A.", "B.", "C."], fixCount: 1 }, "1 to fix"],
    ["blocked with none", { state: "blocked", reasons: [] }, "0 to fix"],
    ["submitting", { state: "inProgress", reasons: [] }, null],
  ] as const)("draft %s", (_name, readiness, title) => {
    expect(draft(readiness as Extract<RemovalAttentionSource, { kind: "draft" }>["readiness"])).toBe(title);
  });

  it("words a rejected Removal as the list does", () => {
    expect(removalAttentionTitle({ kind: "rejected" })).toBe("Submission failed");
  });

  it("names the correction state while its window is open, else the plain return", () => {
    expect(removalAttentionTitle({ kind: "returned", correction: correction(false) })).toBe("Correction needed");
    expect(removalAttentionTitle({ kind: "returned", correction: correction(true) })).toBe("Resubmit needed");
    expect(removalAttentionTitle({ kind: "returned", correction: undefined })).toBe("Returned by Isometric");
  });
});
