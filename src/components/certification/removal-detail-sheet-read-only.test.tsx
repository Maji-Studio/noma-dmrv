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
import type { RecordLockView } from "@/lib/record-lock-view";
import type { RemovalListRow } from "./removal-list-state";
import { RemovalDetailSheet } from "./removal-detail-sheet";

const mocks = vi.hoisted(() => ({ clockOverride: undefined as { timeZone?: string } | undefined, sourcesEditable: null as boolean | null, facts: undefined as undefined }));

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
  useRemovalBreakdown: () => ({ data: undefined }),
  useFacilityCertifierSummary: () => ({ data: { mapping: { externalProjectId: "prj_1" } } }),
}));
vi.mock("@/hooks/use-removal-sheet-facts", () => ({ useRemovalSheetFacts: () => ({ data: mocks.facts, isLoading: false }) }));
vi.mock("@/hooks/use-removal-carried-entries", () => ({ useRemovalCarriedEntries: () => ({ data: undefined }) }));
// The records read has its own tests and needs a query client.
vi.mock("./removal-records", () => ({ RemovalRecords: () => null }));
vi.mock("@/hooks/use-removal-delete-access", () => ({
  useRemovalDeleteAccess: () => ({ viewerCanDeleteRegistryRemovals: true, hasRegisteredProductionBatches: false }),
}));
vi.mock("@/lib/certification/status", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/certification/status")>(),
  deriveRemovalWorkflowStatus: () => ({ kind: "ready", value: "ready", label: "Ready", reasons: ["Add a lab report to continue."], canRetry: true, isActionable: true }),
}));
vi.mock("./sources-panel", () => ({ SourcesPanel: ({ isEditable }: { isEditable: boolean }) => { mocks.sourcesEditable = isEditable; return <p>Included files are copied when you submit.</p>; } }));
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

/** Every word that tells the reader to act. A read-only sheet states facts and uses none of them. */
const INSTRUCTION_WORDS = /\b(resubmit|submit|refresh|retry|reload|generate|correct|edit)\b|submit again|try again|when you submit|Add a lab report/i;

const LOCK = {
  level: "open", heldBy: [], usedBy: [], freeFields: [], howToFree: null,
  returnedBy: [{
    removal: { kind: "removal", id: "rem-1", label: null, facilityId: "facility-archived", period: { startedOn: "2026-07-01", completedOn: "2026-09-30" } },
    statement: { kind: "ghgStatement", id: "st-1", label: null, facilityId: "facility-archived", period: { startedOn: "2026-07-01", completedOn: "2026-09-30" } },
    statementStatus: "FAILED_VERIFICATION",
  }],
} as unknown as RecordLockView;

const SUMMARY = {
  removalId: "rem-1", code: "RM-0001", startedOn: null, completedOn: null, memberBatchCodes: ["CB-1"], externalId: null, version: null,
  local: "draft", lockInFlight: false, submissionInterrupted: false, hasFinalizedSubmission: false, deletionInProgress: false,
  submissionAttempts: [{ outcome: { kind: "failed", message: "Isometric refused it." } }], evidenceLinks: { mismatchCount: 1, unconfirmedCount: 0 }, submissionWarnings: [], recentSyncEvents: [], readiness: null,
  missingProductionRuns: [{ creditBatchId: "batch-1", creditBatchCode: "CB-1", runs: [{ id: "run-1", code: "RUN-1", canAdd: true }] }],
  correction: {
    removalId: "rem-1", removalCode: "RM-0001", windowOpen: true, resubmitNeeded: true,
    statement: { id: "st-1", status: "FAILED_VERIFICATION", reportingPeriodStartOn: "2026-07-01", reportingPeriodEndOn: "2026-09-30" },
    batches: [], changed: [],
  },
} as unknown as RemovalListRow;

function renderSheet(readOnly?: SheetReadOnly, summary: RemovalListRow = SUMMARY, lock?: RecordLockView) {
  render(<RemovalDetailSheet summary={summary} lock={lock} isProduction={false} facilityId="facility-archived" open onClose={vi.fn()} canManage readOnly={readOnly} timeZone={readOnly ? "Africa/Dar_es_Salaam" : undefined} />);
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
    expect(document.body.textContent).toMatch(INSTRUCTION_WORDS);
  });

  it("shows no write action and no instruction to take one when read only", () => {
    renderSheet(READ_ONLY);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("link", { name: "Resubmit Removal" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Review & submit" })).toBeNull();
    expect(mocks.sourcesEditable).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(document.body.textContent).toContain("Old Plant");
    expect(screen.getByRole("button", { name: "Close", hidden: true })).toBeTruthy();
  });

  it("gives no instruction in a read-only Removal that Isometric returned", () => {
    renderSheet(READ_ONLY, { ...SUMMARY, correction: undefined }, LOCK);
    expect(document.body.textContent).toContain("failed verification");
    expect(document.body.textContent).not.toMatch(INSTRUCTION_WORDS);
  });

  it("gives no instruction in a read-only Removal with a correction to resubmit", () => {
    renderSheet(READ_ONLY);
    expect(document.body.textContent).toContain("changed since this Removal was sent");
    expect(document.body.textContent).toContain("Isometric lists different evidence");
    expect(document.body.textContent).not.toMatch(INSTRUCTION_WORDS);
  });

  it("gives the control Removal an instruction in the returned state", () => {
    renderSheet(undefined, { ...SUMMARY, correction: undefined }, LOCK);
    expect(document.body.textContent).toMatch(/Correct this Removal/);
  });

  it("uses the archived facility's own timezone", () => {
    renderSheet(READ_ONLY);
    expect(mocks.clockOverride).toEqual({ timeZone: "Africa/Dar_es_Salaam" });
  });
});
