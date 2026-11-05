// @vitest-environment jsdom
/**
 * The real GHG Statement sheet opened read only (a link into an archived
 * facility): no refresh, generate or submit, the reason is said once, and the
 * workflow states where the statement stands without telling anyone to act.
 */
import { TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";
import { GhgStatementDetailSheet } from "./ghg-statement-detail-sheet";

const mocks = vi.hoisted(() => ({
  clockOverride: undefined as { timeZone?: string } | undefined,
  submitProps: null as Record<string, unknown> | null,
  // Each state a statement can be read in; the sheet must never tell a read-only viewer to act in any of them.
  remote: { status: "FAILED_VERIFICATION", ghg_entry_ids: ["e1"], pending_total_co2e_removed_kg: 100 } as Record<string, unknown> | null,
  reports: [] as { id: string; version: number; lifecycle: string; reviewUrl: string }[],
  reportsError: null as Error | null,
  refetchReports: vi.fn(),
  stateError: null as Error | null,
  stateData: true,
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: (_id: string, override?: { timeZone?: string }) => {
    mocks.clockOverride = override;
    return { timeZone: override?.timeZone ?? "UTC", hint: "" };
  },
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/use-certification", () => ({
  useGhgStatementState: () => ({
    isLoading: false, error: mocks.stateError,
    data: !mocks.stateData ? undefined : {
      statement: { id: "st-1", facilityId: "facility-archived", reportingPeriodStartOn: "2026-01-01" },
      statementSubmission: { id: "sub-1", externalId: "ghg_1", version: 1, status: "submitted" },
      statementSubmissionForStatus: { id: "sub-1", externalId: "ghg_1", version: 1, status: "submitted" },
      linkedRemovals: [{ removal: { id: "r1", code: "RM-1", startedOn: null, completedOn: null }, submission: null, creditBatches: [] }],
      remote: mocks.remote,
      recentSyncEvents: [],
    },
  }),
  useGhgStatementReports: () => ({ data: mocks.reports, error: mocks.reportsError, isFetching: false, isLoading: false, refetch: mocks.refetchReports }),
  useGhgStatementBreakdown: () => ({ data: { status: "available", message: "" }, isLoading: false, error: null }),
  useRefreshGhgStatementStatus: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("./ghg-statement-submit-dialog", () => ({ GhgStatementSubmitDialog: (props: Record<string, unknown>) => { mocks.submitProps = props; return null; } }));
vi.mock("./ghg-statement-carbon-breakdown", () => ({ GhgStatementCarbonBreakdown: () => null }));
vi.mock("./ghg-statement-technical-details", () => ({ GhgStatementTechnicalDetails: () => <p>Technical body</p> }));
vi.mock("./removal-batches-accordion", () => ({ RemovalBatchesAccordion: () => null }));
vi.mock("./submission-status-badge", () => ({ SubmissionStatusBadge: () => null }));
vi.mock("./certification-status-badge", () => ({ CertificationStatusBadge: () => null }));
vi.mock("./registry-record-link", () => ({ RegistryRecordLink: () => null }));

const READ_ONLY: SheetReadOnly = {
  tone: "info",
  message: "Old Plant is archived, so this GHG Statement is read-only.",
  facility: { name: "Old Plant", href: "/facilities/old", rest: " is archived, so this GHG Statement is read-only." },
};
const ITEM = {
  statement: { id: "st-1", facilityId: "facility-archived", reportingPeriodStartOn: "2026-01-01" },
  effectiveReportingPeriodEndOn: "2026-03-31", remotePeriodMissing: false,
} as never;

function renderSheet(readOnly?: SheetReadOnly) {
  render(<GhgStatementDetailSheet item={ITEM} isProduction={false} canManageReports open onClose={vi.fn()} readOnly={readOnly} timeZone={readOnly ? "Africa/Dar_es_Salaam" : undefined} />);
}

const INSTRUCTION_WORDS = /\b(resubmit|submit|refresh|retry|reload|generate|create|edit)\b|submit again|try again|when you submit|Use Refresh/i;
const STATES: [string, () => void][] = [
  ["failed verification", () => {}],
  ["pending changes", () => { mocks.remote = { status: "DRAFT", ghg_entry_ids: ["e1"], pending_total_co2e_removed_kg: 100 }; }],
  ["draft with no entries", () => { mocks.remote = { status: "DRAFT", ghg_entry_ids: [], pending_total_co2e_removed_kg: 100 }; }],
  ["live data unavailable", () => { mocks.remote = null; mocks.stateError = new Error("stale"); }],
  ["prepared report", () => { mocks.reports = [{ id: "r1", version: 2, lifecycle: "prepared", reviewUrl: "/r1" }]; }],
  ["reports failed to load", () => { mocks.reportsError = new Error("reports"); }],
];

beforeEach(() => {
  mocks.clockOverride = undefined; mocks.submitProps = null;
  mocks.remote = { status: "FAILED_VERIFICATION", ghg_entry_ids: ["e1"], pending_total_co2e_removed_kg: 100 };
  mocks.reports = []; mocks.reportsError = null; mocks.stateError = null; mocks.stateData = true;
});
afterEach(cleanup);

describe("GhgStatementDetailSheet", () => {
  it("offers Refresh and Resubmit when it is not read only", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: /Refresh/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resubmit" })).toBeTruthy();
    expect(mocks.submitProps).toMatchObject({ canSubmit: true });
    expect(document.body.textContent).toContain("then resubmit");
  });

  it("offers no write action and says the reason once when read only", () => {
    renderSheet(READ_ONLY);
    expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resubmit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    expect(mocks.submitProps).toMatchObject({ canSubmit: false, canGenerate: false });
    expect(screen.queryByText("Technical body")).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text.split("is archived, so this GHG Statement is read-only.")).toHaveLength(2);
    expect(text).toContain("Verification failed.");
    expect(text).not.toContain("then resubmit");
    expect(text).not.toContain("when you submit");
  });

  it.each(STATES)("gives no instruction when read only and %s", (_name, setUp) => {
    setUp();
    renderSheet(READ_ONLY);
    // The failed reports read keeps its Try again button, which only reads again.
    expect(document.body.textContent?.replace(TRY_AGAIN_LABEL, "")).not.toMatch(INSTRUCTION_WORDS);
  });

  it("gives no instruction when read only and the statement could not be loaded", () => {
    mocks.stateData = false;
    renderSheet(READ_ONLY);
    expect(document.body.textContent).toContain("could not be loaded");
    expect(document.body.textContent).not.toMatch(INSTRUCTION_WORDS);
  });

  it("keeps the instruction for an editable sheet in the same states", () => {
    mocks.remote = null; mocks.stateError = new Error("stale");
    renderSheet();
    expect(document.body.textContent).toMatch(/Use Refresh/);
  });

  it("gives a member no Refresh", () => {
    render(<GhgStatementDetailSheet item={ITEM} isProduction={false} canManageReports={false} open onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
  });

  it.each(STATES)("gives a member no instruction when %s", (_name, setUp) => {
    setUp();
    render(<GhgStatementDetailSheet item={ITEM} isProduction={false} canManageReports={false} open onClose={vi.fn()} />);
    // A failed reports read keeps its Try again button for a member (tested below); no other text instructs.
    expect(document.body.textContent?.replace(TRY_AGAIN_LABEL, "")).not.toMatch(INSTRUCTION_WORDS);
  });

  it("offers a member Try again when the reports fail, which only reads them again", () => {
    mocks.reportsError = new Error("reports");
    render(<GhgStatementDetailSheet item={ITEM} isProduction={false} canManageReports={false} open onClose={vi.fn()} />);
    screen.getByRole("button", { name: "Try again" }).click();
    expect(mocks.refetchReports).toHaveBeenCalledOnce();
  });

  it("gives a member no Refresh instruction when details are stale", () => {
    mocks.remote = null; mocks.stateError = new Error("stale");
    render(<GhgStatementDetailSheet item={ITEM} isProduction={false} canManageReports={false} open onClose={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/Use Refresh|Refresh and try again/);
  });

  it("uses the archived facility's own timezone", () => {
    renderSheet(READ_ONLY);
    expect(mocks.clockOverride).toEqual({ timeZone: "Africa/Dar_es_Salaam" });
  });
});
