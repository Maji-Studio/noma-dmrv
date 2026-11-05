// @vitest-environment jsdom
/**
 * The real GHG Statement sheet opened read only (a link into an archived
 * facility): no refresh, generate or submit, the reason is said once, and the
 * workflow states where the statement stands without telling anyone to act.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetReadOnly } from "@/lib/linked-record-read-only";
import { GhgStatementDetailSheet } from "./ghg-statement-detail-sheet";

const mocks = vi.hoisted(() => ({ clockOverride: undefined as { timeZone?: string } | undefined, submitProps: null as Record<string, unknown> | null }));

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
    isLoading: false, error: null,
    data: {
      statement: { id: "st-1", facilityId: "facility-archived", reportingPeriodStartOn: "2026-01-01" },
      statementSubmission: { id: "sub-1", externalId: "ghg_1", version: 1, status: "submitted" },
      statementSubmissionForStatus: { id: "sub-1", externalId: "ghg_1", version: 1, status: "submitted" },
      linkedRemovals: [{ removal: { id: "r1", code: "RM-1", startedOn: null, completedOn: null }, submission: null, creditBatches: [] }],
      remote: { status: "FAILED_VERIFICATION", ghg_entry_ids: ["e1"], pending_total_co2e_removed_kg: 100 },
      recentSyncEvents: [],
    },
  }),
  useGhgStatementReports: () => ({ data: [], error: null, isFetching: false, isLoading: false, refetch: vi.fn() }),
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

beforeEach(() => { mocks.clockOverride = undefined; mocks.submitProps = null; });
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

  it("uses the archived facility's own timezone", () => {
    renderSheet(READ_ONLY);
    expect(mocks.clockOverride).toEqual({ timeZone: "Africa/Dar_es_Salaam" });
  });
});
