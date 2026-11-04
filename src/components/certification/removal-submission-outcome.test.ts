import { describe, expect, it } from "vitest";
import type { RemovalWorkflowStatus } from "@/lib/certification/status";
import { submissionOutcomeFor } from "./removal-detail-sheet";
import type { RemovalListRow } from "./removal-list-state";

const differs = { kind: "differs", creditBatchId: "cb", creditBatchCode: "CB-1", differences: [], shared: false, sharedWith: null } as const;
const row = (outcome?: unknown) => ({ submissionAttempts: outcome ? [{ id: "a", at: "2026-10-27T11:05:00.000Z", errorMessage: null, outcome }] : [] }) as unknown as RemovalListRow;
const status = (kind: RemovalWorkflowStatus["kind"]) => ({ kind }) as RemovalWorkflowStatus;

describe("submissionOutcomeFor", () => {
  it("leads with the drift stop when a retried interrupted draft stopped before claiming anything", () => {
    expect(submissionOutcomeFor(row(differs), status("interrupted"))).toEqual(differs);
  });

  it("keeps the interrupted notice when the newest attempt is not a drift stop", () => {
    expect(submissionOutcomeFor(row({ kind: "failed", message: null }), status("interrupted"))).toEqual({ kind: "interrupted" });
    expect(submissionOutcomeFor(row(), status("interrupted"))).toEqual({ kind: "interrupted" });
  });

  it("shows nothing for a submitted, submitting or replaced Removal", () => {
    for (const kind of ["submitted", "submitting", "superseded"] as const) {
      expect(submissionOutcomeFor(row(differs), status(kind))).toBeNull();
    }
  });
});
