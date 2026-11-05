// @vitest-environment jsdom
/**
 * The real Removal sheet opened read only (a link into an archived facility):
 * nothing in it can change the Removal, and nothing tells the viewer to.
 * The same fixture without readOnly shows every action, so the gates are what
 * these tests prove.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";
import type { RemovalListRow } from "./removal-list-state";
import { RemovalDetailSheet } from "./removal-detail-sheet";

const mocks = vi.hoisted(() => ({ clockOverride: undefined as { timeZone?: string } | undefined, sourcesEditable: null as boolean | null }));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: (_id: string, override?: { timeZone?: string }) => {
    mocks.clockOverride = override;
    return { timeZone: override?.timeZone ?? "UTC", hint: "" };
  },
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/use-certification", () => ({
  useDeleteRemoval: () => ({ isPending: false, mutate: vi.fn(), reset: vi.fn() }),
  useFacilityCertifierSummary: () => ({ data: { mapping: { externalProjectId: "prj_1" } } }),
}));
vi.mock("@/hooks/use-removal-carried-entries", () => ({ useRemovalCarriedEntries: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-removal-delete-access", () => ({
  useRemovalDeleteAccess: () => ({ viewerCanDeleteRegistryRemovals: true, hasRegisteredProductionBatches: false }),
}));
vi.mock("@/lib/certification/status", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/certification/status")>(),
  deriveRemovalWorkflowStatus: () => ({ kind: "ready", value: "ready", label: "Ready", reasons: [], canRetry: false, isActionable: true }),
}));
vi.mock("./sources-panel", () => ({ SourcesPanel: ({ isEditable }: { isEditable: boolean }) => { mocks.sourcesEditable = isEditable; return null; } }));
vi.mock("./removal-carbon-breakdown", () => ({ RemovalCarbonBreakdown: () => null }));
vi.mock("./production-batch-links", () => ({ ProductionBatchLinks: () => null }));
vi.mock("./submission-history", () => ({ SubmissionHistory: () => null }));
vi.mock("./carried-entries", () => ({ CarriedEntriesSection: () => null, RevisionLateEntriesSection: () => null }));
vi.mock("./certification-status-badge", () => ({ CertificationStatusBadge: () => null }));

const READ_ONLY: SheetReadOnly = {
  tone: "info",
  message: "Old Plant is archived, so this Removal is read-only.",
  facility: { name: "Old Plant", href: "/facilities/old", rest: " is archived, so this Removal is read-only." },
};

const SUMMARY = {
  removalId: "rem-1", code: "RM-0001", startedOn: null, completedOn: null, memberBatchCodes: ["CB-1"], externalId: null, version: null,
  local: "draft", lockInFlight: false, submissionInterrupted: false, hasFinalizedSubmission: false, deletionInProgress: false,
  submissionAttempts: [], submissionWarnings: [], recentSyncEvents: [], evidenceLinks: [], readiness: null,
  missingProductionRuns: [{ creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true }] }],
  correction: {
    removalId: "rem-1", removalCode: "RM-0001", windowOpen: true, resubmitNeeded: true,
    statement: { id: "st-1", status: "FAILED_VERIFICATION", reportingPeriodStartOn: "2026-07-01", reportingPeriodEndOn: "2026-09-30" },
    batches: [], changed: [],
  },
} as unknown as RemovalListRow;

function renderSheet(readOnly?: SheetReadOnly) {
  render(<RemovalDetailSheet summary={SUMMARY} isProduction={false} facilityId="facility-archived" open onClose={vi.fn()} canManage readOnly={readOnly} timeZone={readOnly ? "Africa/Dar_es_Salaam" : undefined} />);
}

beforeEach(() => { mocks.sourcesEditable = null; mocks.clockOverride = undefined; });
afterEach(cleanup);

describe("RemovalDetailSheet", () => {
  it("offers every action when it is not read only", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Delete Removal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Resubmit Removal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review & submit" })).toBeTruthy();
    expect(mocks.sourcesEditable).toBe(true);
    expect(document.body.textContent).toContain("Resubmit it, then resubmit");
  });

  it("shows no write action and no instruction to take one when read only", () => {
    renderSheet(READ_ONLY);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("link", { name: "Resubmit Removal" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Review & submit" })).toBeNull();
    expect(mocks.sourcesEditable).toBe(false);
    expect(document.body.textContent).not.toContain("Resubmit it");
    expect(document.body.textContent).not.toContain("in Edit");
    expect(document.body.textContent).toContain("Old Plant");
    expect(screen.getByRole("button", { name: "Close", hidden: true })).toBeTruthy();
  });

  it("uses the archived facility's own timezone", () => {
    renderSheet(READ_ONLY);
    expect(mocks.clockOverride).toEqual({ timeZone: "Africa/Dar_es_Salaam" });
  });
});
