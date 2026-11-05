// @vitest-environment jsdom
/**
 * A link to a Removal of an archived facility is not on the working facility's
 * list. It opens that Removal's sheet read only, and the working facility stays.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemovalListRow } from "./removal-list-state";
import { RemovalsList } from "./removals-list";

const REMOVAL_ID = "11111111-1111-4111-8111-111111111111";
const WORKING_FACILITY = "facility-working";
const ARCHIVED_FACILITY = "facility-archived";

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, string | null>,
  readOnly: null as null | { reason: "archived"; facilityId: string; facilityName: string; timezone: string },
  listedFacilities: [] as string[],
  sheetProps: [] as Record<string, unknown>[],
  archivedEntries: true,
  toastError: vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (param: string) => [mocks.query[param] ?? null, (value: string | null) => { mocks.query[param] = value; }],
}));
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }),
  useFacilityContext: () => ({ facilityId: WORKING_FACILITY, selectedFacility: { name: "Working", code: "WRK" }, facilities: [{ id: WORKING_FACILITY }], setFacilityId: vi.fn() }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: mocks.toastError }) }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => ({ isOpen: false, clear: vi.fn() }) }));
vi.mock("@/hooks/use-record-locks", () => ({ useRecordLocks: () => ({ locks: {} }) }));
vi.mock("@/hooks/use-removal-carried-entries", () => ({
  useRemovalCarriedEntries: (id: string | null) => ({
    data: id ? { facilityId: ARCHIVED_FACILITY, carriedEntries: [], lateEntries: [] } : undefined,
    isLoading: false, isError: false, isSuccess: !!id,
  }),
}));
vi.mock("@/hooks/use-linked-record-facility", () => ({
  useLinkedRecordFacility: (record: unknown) => ({ ready: !!record, readOnly: record ? mocks.readOnly : null }),
}));
vi.mock("@/hooks/use-certification", () => ({
  // The working facility lists nothing; the archived facility lists the linked Removal.
  useRemovalsForFacility: (facilityId: string, enabled = true) => {
    if (enabled) mocks.listedFacilities.push(facilityId);
    return {
      isLoading: false, error: null,
      data: !enabled ? undefined : { isProduction: false, removals: facilityId === ARCHIVED_FACILITY && mocks.archivedEntries ? [{ removal: { id: REMOVAL_ID } }] : [] },
    };
  },
  useRemovalPreflightSummaries: () => ({}),
  useFacilityCertifierSummary: () => ({ data: undefined }),
}));
vi.mock("./removal-list-state", () => ({
  buildRemovalListRows: (identities: { removal: { id: string } }[]) =>
    identities.map((identity) => ({ removalId: identity.removal.id, code: "RM-0001", submittedOn: { kind: "never" } }) as unknown as RemovalListRow),
}));
vi.mock("./new-removal-dialog", () => ({ NewRemovalDialog: () => null }));
vi.mock("./removal-detail-sheet", () => ({
  RemovalDetailSheet: (props: { summary: { code: string }; facilityId: string; readOnly?: { message: string } }) => {
    mocks.sheetProps.push(props);
    return <div role="dialog" aria-label={props.summary.code}>{props.readOnly?.message ?? "Editable sheet"}</div>;
  },
}));

beforeEach(() => {
  mocks.query = { removal: REMOVAL_ID };
  mocks.readOnly = { reason: "archived", facilityId: ARCHIVED_FACILITY, facilityName: "Old Plant", timezone: "UTC" };
  mocks.listedFacilities = [];
  mocks.sheetProps = [];
  mocks.archivedEntries = true;
  mocks.toastError.mockClear();
});
afterEach(cleanup);

describe("Removals link into an archived facility", () => {
  it("opens the Removal's sheet read only with the archived facility", () => {
    render(<RemovalsList canManage />);
    const sheet = screen.getByRole("dialog", { name: "RM-0001" });
    expect(sheet.textContent).toBe("Old Plant is archived, so this Removal is read-only.");
    expect(mocks.sheetProps.at(-1)).toMatchObject({ facilityId: ARCHIVED_FACILITY });
    expect(mocks.listedFacilities).toContain(ARCHIVED_FACILITY);
  });

  it("says so when the archived facility's list does not hold the Removal", () => {
    mocks.archivedEntries = false;
    render(<RemovalsList canManage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith("Linked Removal could not be opened");
    expect(mocks.query.removal).toBeNull();
  });

  it("opens nothing read only for a facility that is not archived", () => {
    mocks.readOnly = null;
    render(<RemovalsList canManage />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.listedFacilities).not.toContain(ARCHIVED_FACILITY);
  });
});
