// @vitest-environment jsdom
/**
 * GHG Statements: a link to a statement of an archived facility opens its sheet
 * read only, and members (non-admins) get no Sync or New action, since the
 * server requires an admin for both.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GhgStatementsList } from "./ghg-statements-list";

const STATEMENT_ID = "statement-1";
const WORKING_FACILITY = "facility-working";
const ARCHIVED_FACILITY = "facility-archived";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  readOnly: null as null | { reason: "archived"; facilityId: string; facilityName: string; timezone: string },
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (param: string) => [mocks.query[param] ?? null, (value: string | null) => { mocks.query[param] = value; }],
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
  useFacilityContext: () => ({ facilityId: WORKING_FACILITY, facilities: [{ id: WORKING_FACILITY }] }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/hooks/use-linked-record-facility", () => ({
  useLinkedRecordFacility: (record: unknown) => ({ ready: !!record, readOnly: record ? mocks.readOnly : null }),
}));
vi.mock("@/hooks/use-certification", () => ({
  useFacilityCertifierSummary: () => ({
    data: { mapping: {}, linkedFacilityCount: 1, viewerCanManage: true, isProduction: false },
    isLoading: false, isError: false,
  }),
  useGhgStatementsForFacility: () => ({ data: [], isLoading: false, error: null, isFetching: false, refetch: vi.fn() }),
  useGhgStatementState: () => ({
    isLoading: false, isError: false, isSuccess: true,
    data: {
      statement: { id: STATEMENT_ID, facilityId: ARCHIVED_FACILITY, reportingPeriodStartOn: "2026-01-01" },
      effectiveReportingPeriodEndOn: "2026-03-31", remotePeriodMissing: false,
    },
  }),
  useSyncGhgStatementsFromRegistry: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("./ghg-statement-create-dialog", () => ({ GhgStatementCreateDialog: () => null }));
vi.mock("./ghg-statement-detail-sheet", () => ({
  GhgStatementDetailSheet: (props: { item: { statement: { facilityId: string } }; canManageReports: boolean; readOnly?: { message: string } }) => (
    <div role="dialog" aria-label="GHG Statement">{props.readOnly?.message ?? "Editable sheet"} {props.item.statement.facilityId}</div>
  ),
}));

beforeEach(() => {
  mocks.query = {};
  mocks.readOnly = null;
});
afterEach(cleanup);

describe("GHG Statements link into an archived facility", () => {
  it("opens the statement's sheet read only from the linked read", () => {
    mocks.query = { statement: STATEMENT_ID };
    mocks.readOnly = { reason: "archived", facilityId: ARCHIVED_FACILITY, facilityName: "Old Plant", timezone: "UTC" };
    render(<GhgStatementsList canManage />);
    expect(screen.getByRole("dialog", { name: "GHG Statement" }).textContent)
      .toBe(`Old Plant is archived, so this GHG Statement is read-only. ${ARCHIVED_FACILITY}`);
  });

  it("opens nothing for a statement outside this list when its facility is not archived", () => {
    mocks.query = { statement: STATEMENT_ID };
    render(<GhgStatementsList canManage />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("GHG Statements admin actions", () => {
  it("shows Sync from registry and New GHG Statement to an admin", () => {
    render(<GhgStatementsList canManage />);
    expect(screen.getByRole("button", { name: "Sync from registry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New GHG Statement" })).toBeTruthy();
  });

  it("gives a member neither action", () => {
    render(<GhgStatementsList />);
    expect(screen.queryByRole("button", { name: "Sync from registry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New GHG Statement" })).toBeNull();
  });
});
