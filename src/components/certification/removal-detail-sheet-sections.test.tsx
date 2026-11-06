// @vitest-environment jsdom
/** The Removal sheet's structure (#1554): header badge, untitled status block, Removal, Isometric, Records. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemovalWorkflowStatus } from "@/lib/certification/status";
import type { RemovalListRow } from "./removal-list-state";
import { RemovalDetailSheet, sheetStatusFor, thingsToFixLine } from "./removal-detail-sheet";

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/use-certification", () => ({
  useDeleteRemoval: () => ({ isPending: false, mutate: vi.fn(), reset: vi.fn() }),
  useFacilityCertifierSummary: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-removal-carried-entries", () => ({ useRemovalCarriedEntries: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-removal-delete-access", () => ({
  useRemovalDeleteAccess: () => ({ viewerCanDeleteRegistryRemovals: true, hasRegisteredProductionBatches: false }),
}));
vi.mock("./sources-panel", () => ({ SourcesPanel: () => null }));
vi.mock("./removal-carbon-breakdown", () => ({ RemovalCarbonBreakdown: () => null }));
vi.mock("./production-batch-links", () => ({ ProductionBatchLinks: () => null }));
vi.mock("./submission-history", () => ({ SubmissionHistory: () => null }));
vi.mock("./carried-entries", () => ({ CarriedEntriesSection: () => null, RevisionLateEntriesSection: () => null }));
vi.mock("./removal-records", () => ({ RemovalRecords: () => <p>records</p> }));
vi.mock("./certification-status-badge", () => ({ CertificationStatusBadge: ({ label }: { label: string }) => <span data-testid="badge">{label}</span> }));
afterEach(cleanup);

const BLOCKED: RemovalWorkflowStatus = { kind: "blocked", value: "pending", label: "Needs attention", reasons: ["a", "b", "c"], isActionable: true, canRetry: false };

const SUMMARY = {
  removalId: "rem-1", code: "RM-0001", startedOn: "2026-02-02", completedOn: "2026-03-20", memberBatchCodes: ["CB-1"], externalId: null, version: null,
  local: "draft", lockInFlight: false, submissionInterrupted: false, hasFinalizedSubmission: false, deletionInProgress: false,
  submissionAttempts: [], evidenceLinks: null, submissionWarnings: [], recentSyncEvents: [], missingProductionRuns: [], enrichmentStatus: "available",
  readiness: { state: "blocked", reasons: ["Add a lab report.", "Link a delivery proof."] },
} as unknown as RemovalListRow;

function renderSheet() {
  render(<RemovalDetailSheet summary={SUMMARY} isProduction={false} facilityId="f1" open onClose={vi.fn()} />);
}

describe("RemovalDetailSheet structure", () => {
  it("orders the sections Removal, Isometric, Records", () => {
    renderSheet();
    const titles = Array.from(document.querySelectorAll("[data-detail-section] > :first-child")).map((el) => el.textContent);
    expect(titles.filter((t) => ["Removal", "Isometric", "Records"].includes(t ?? ""))).toEqual(["Removal", "Isometric", "Records"]);
    expect(screen.queryByText("Submission status")).toBeNull();
  });

  it("puts the status badge in the header beside the code, and the draft reads Not submitted", () => {
    renderSheet();
    const heading = screen.getByRole("heading", { name: "RM-0001" });
    expect(heading.parentElement!.contains(screen.getByTestId("badge"))).toBe(true);
    expect(screen.getByTestId("badge").textContent).toBe("Not submitted");
  });

  it("leaves no status block when nothing needs saying, and lists no blocker detail", () => {
    renderSheet();
    expect(document.body.textContent).not.toContain("Add a lab report.");
    expect(document.querySelector(".peer\\/status")?.childElementCount).toBe(0);
  });

  it("counts the things to fix in the footer next to Review & submit", () => {
    renderSheet();
    expect(screen.getByText("2 things to fix before submitting")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review & submit" })).toBeTruthy();
  });

  it("drops the Allocation section and points to the credit batch's Emissions tab behind an (i)", () => {
    renderSheet();
    expect(screen.queryByText("Allocation")).toBeNull();
    expect(screen.getByRole("button", { name: /More about Credit batches/ })).toBeTruthy();
  });
});

describe("sheet status helpers", () => {
  it("maps a draft to Not submitted and keeps other states", () => {
    expect(sheetStatusFor(BLOCKED)).toEqual({ value: "draft", label: "Not submitted" });
    expect(sheetStatusFor({ ...BLOCKED, kind: "submitted", value: "issued", label: "Submitted" })).toEqual({ value: "issued", label: "Submitted" });
  });

  it("counts and pluralizes things to fix", () => {
    expect(thingsToFixLine(BLOCKED)).toBe("3 things to fix before submitting");
    expect(thingsToFixLine({ ...BLOCKED, reasons: ["a"] })).toBe("1 thing to fix before submitting");
    expect(thingsToFixLine({ ...BLOCKED, kind: "ready", reasons: [] } as RemovalWorkflowStatus)).toBeNull();
  });
});
