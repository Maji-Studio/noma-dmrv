// @vitest-environment jsdom
/** The Removal sheet's structure (#1554): header badge, untitled status block, Removal, Isometric, Records. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalWorkflowStatus } from "@/lib/certification/status";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { RemovalListRow } from "./removal-list-state";
import { RemovalDetailSheet, sheetStatusFor, thingsToFixLine } from "./removal-detail-sheet";

const BASE_FACTS = vi.hoisted(() => ({
  batches: [{ id: "cb-1", code: "CB-26-001" }, { id: "cb-2", code: "CB-26-002" }],
  facilityName: "Mafinga plant",
  dryTonnes: 12.34,
  co2eEstimateTonnes: 30.04,
  durabilityLabel: "1000-year (R₀ reflectance)",
  samplingLabel: "Sampled",
}));
const mocks = vi.hoisted(() => ({
  facts: undefined as object | undefined,
  breakdown: undefined as object | undefined,
  factsError: false,
  refetch: vi.fn(),
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "" }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/use-certification", () => ({
  useDeleteRemoval: () => ({ isPending: false, mutate: vi.fn(), reset: vi.fn() }),
  useRemovalBreakdown: () => ({ data: mocks.breakdown }),
  useFacilityCertifierSummary: () => ({ data: { mapping: { externalProjectId: "prj_1" } } }),
}));
vi.mock("@/hooks/use-removal-sheet-facts", () => ({ useRemovalSheetFacts: () => ({ data: mocks.facts, isLoading: false, isError: mocks.factsError, isFetching: false, refetch: mocks.refetch }) }));
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
beforeEach(() => {
  mocks.facts = { ...BASE_FACTS };
  mocks.breakdown = undefined;
  mocks.factsError = false;
  mocks.refetch.mockClear();
});
afterEach(cleanup);


const BLOCKED: RemovalWorkflowStatus = { kind: "blocked", value: "pending", label: "Needs attention", reasons: ["a", "b", "c"], isActionable: true, canRetry: false };

const SUMMARY = {
  removalId: "rem-1", code: "RM-0001", startedOn: "2026-02-02", completedOn: "2026-03-20", memberBatchCodes: ["CB-26-001", "CB-26-002"], externalId: null, version: null,
  local: "draft", lockInFlight: false, submissionInterrupted: false, hasFinalizedSubmission: false, deletionInProgress: false,
  submissionAttempts: [], evidenceLinks: null, submissionWarnings: [], recentSyncEvents: [], missingProductionRuns: [], enrichmentStatus: "available",
  readiness: { state: "blocked", reasons: ["Add a lab report.", "Link a delivery proof."] },
} as unknown as RemovalListRow;

function renderSheet(summary: RemovalListRow = SUMMARY, lock?: RecordLockView) {
  render(<RemovalDetailSheet summary={summary} lock={lock} isProduction={false} facilityId="f1" open onClose={vi.fn()} />);
}

describe("RemovalDetailSheet structure", () => {
  it("orders the sections Removal, Isometric, Records", () => {
    renderSheet();
    const titles = Array.from(document.querySelectorAll("[data-detail-section] > :first-child")).map((el) => el.textContent);
    expect(titles.filter((t) => ["Removal", "Isometric", "Records"].includes(t ?? ""))).toEqual(["Removal", "Isometric", "Records"]);
    expect(screen.queryByText("Submission status")).toBeNull();
  });

  it("fills Removal in the prototype's order: CO₂e, dry mass, window, credit batches, facility", () => {
    renderSheet();
    const section = screen.getByText("Removal", { exact: true }).closest("[data-detail-section]")!;
    const labels = Array.from(section.querySelectorAll("span.body-small")).map((el) => el.textContent ?? "");
    const order = ["Estimated CO₂e stored", "Biochar dry mass", "Reporting window", "Credit batches (2)", "Facility"].map((l) => labels.findIndex((t) => t.startsWith(l)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(section.textContent).toContain("30.0 t CO₂e");
    expect(section.textContent).toContain("12.3 t");
    expect(section.textContent).toContain("Mafinga plant");
  });

  it("links each credit batch code to its page", () => {
    renderSheet();
    expect(screen.getByRole("link", { name: "CB-26-001" }).getAttribute("href")).toContain("/credit-batches/cb-1");
    expect(screen.getByRole("link", { name: "CB-26-002" }).getAttribute("href")).toContain("/credit-batches/cb-2");
  });

  it("holds the project and durability and sampling in Isometric", () => {
    renderSheet();
    const section = screen.getByText("Isometric", { exact: true }).closest("[data-detail-section]")!;
    expect(section.textContent).not.toContain("Destination");
    expect(section.textContent).toContain("Project");
    expect(section.querySelector("a[href*='/project/prj_1']")?.textContent).toContain("prj_1");
    expect(section.textContent).toContain("Durability and sampling");
    expect(section.textContent).toContain("1000-year (R₀ reflectance), sampled");
  });

  it("keeps Estimated CO₂e stored on the local estimate when the registry has a net figure", () => {
    mocks.breakdown = { status: "available", value: { netRemovedKg: 99000 } };
    renderSheet();
    const section = screen.getByText("Removal", { exact: true }).closest("[data-detail-section]")!;
    expect(section.textContent).toContain("30.0 t CO₂e");
    expect(section.textContent).not.toContain("99.0 t");
  });

  it("shows a load failure with Try again, not missing data, when the facts read fails", () => {
    mocks.facts = undefined;
    mocks.factsError = true;
    renderSheet();
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText("Not yet computed")).toBeNull();
    expect(document.body.textContent).toContain("Reporting window");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("shows Not yet computed when no estimate exists", () => {
    mocks.facts = { ...(mocks.facts as object), co2eEstimateTonnes: null };
    renderSheet();
    expect(screen.getByText("Not yet computed")).toBeTruthy();
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

  it("tells a ready draft in the footer that it is ready to submit", () => {
    renderSheet({ ...SUMMARY, readiness: { state: "ready", reasons: [] } } as unknown as RemovalListRow);
    expect(screen.getByText("Ready to submit")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review & submit" })).toBeTruthy();
  });

  it("counts the things to fix in the footer next to Review & submit", () => {
    renderSheet();
    expect(screen.getByText("2 things to fix before submitting")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review & submit" })).toBeTruthy();
  });

  it("drops the Allocation section and points to the credit batch's Emissions tab behind an (i)", () => {
    renderSheet();
    expect(screen.queryByText("Allocation")).toBeNull();
    expect(screen.getByRole("button", { name: "About Credit batches" })).toBeTruthy();
  });
});

describe("RemovalDetailSheet readiness blockers", () => {
  it.each([
    ["interrupted", { local: "draft", submissionInterrupted: true }],
    ["failed", { local: "rejected", submissionAttempts: [{ outcome: { kind: "failed", message: "Isometric refused it." } }] }],
  ])("lists no readiness blocker when the Removal is %s, and keeps the outcome notice", (_state, over) => {
    renderSheet({ ...SUMMARY, ...over } as unknown as RemovalListRow);
    expect(document.body.textContent).not.toContain("Add a lab report.");
    expect(document.body.textContent).not.toContain("Link a delivery proof.");
    expect(document.querySelector(".peer\\/status")?.childElementCount).toBeGreaterThan(0);
  });
});

describe("RemovalDetailSheet status line", () => {
  it("announces a changing status line through a live Notice", () => {
    renderSheet({ ...SUMMARY, local: "draft", lockInFlight: true } as unknown as RemovalListRow);
    const line = screen.getByText(/sending this Removal to Isometric/);
    expect(line.closest("[role='status']")).not.toBeNull();
  });
});

describe("RemovalDetailSheet returned Removal", () => {
  it("does not say Isometric is verifying a Removal that was returned", () => {
    renderSheet({ ...SUMMARY, local: "submitted", externalId: "rmv_1", readiness: { state: "submitted", reasons: [] }, correction: { removalId: "rem-1", removalCode: "RM-0001", windowOpen: true, resubmitNeeded: true, statement: { id: "st", status: "FAILED_VERIFICATION", reportingPeriodStartOn: "2026-02-02", reportingPeriodEndOn: "2026-03-20" }, batches: [], changed: [] } } as unknown as RemovalListRow);
    expect(document.body.textContent).not.toContain("Isometric verifies it");
  });
});

describe("RemovalDetailSheet returned by lock", () => {
  it("does not say Isometric is verifying when the return arrives through the lock and there is no correction", () => {
    const lock = { level: "open", returnedBy: [{ statement: { kind: "ghgStatement", id: "st", label: null, facilityId: "f1", period: { startedOn: "2026-02-02", completedOn: "2026-03-20" } }, statementStatus: "FAILED_VERIFICATION" }] } as unknown as RecordLockView;
    renderSheet({ ...SUMMARY, local: "submitted", externalId: "rmv_1", readiness: { state: "submitted", reasons: [] } } as unknown as RemovalListRow, lock);
    expect(document.body.textContent).toContain("failed verification");
    expect(document.body.textContent).not.toContain("Isometric verifies it");
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
    expect(thingsToFixLine({ ...BLOCKED, kind: "ready", reasons: [] } as RemovalWorkflowStatus)).toBe("Ready to submit");
    expect(thingsToFixLine({ ...BLOCKED, kind: "submitted", reasons: [] } as RemovalWorkflowStatus)).toBeNull();
  });
});
