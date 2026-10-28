// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkedSheet } from "../../../tests/helpers/linked-sheet-mocks";

const FACILITY = { id: "fac-1", code: "FAC-001", name: "Mafinga", version: 1, archivedAt: null };
const ARCHIVED = { id: "fac-2", code: "FAC-002", name: "Old site", version: 1, archivedAt: new Date("2026-01-01") };
const harness = vi.hoisted(() => ({
  toastError: vi.fn(),
  setFacilityId: vi.fn(),
  lookups: [] as Array<{ id?: string } | undefined>,
  linked: { data: undefined as unknown, isError: false, isSuccess: false },
}));

vi.mock("nuqs", async () => (await import("../../../tests/helpers/linked-sheet-mocks")).nuqsModule);
vi.mock("@/hooks/use-facilities", () => {
  const mutation = () => ({ startDraft: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useFacilities: (filters?: { id?: string }, organizationId?: string | null) => {
      // The lookup for a linked facility passes an id; the list never does.
      if (filters?.id || organizationId === null) {
        harness.lookups.push(filters);
        return organizationId === null ? { data: undefined, isError: false, isSuccess: false } : harness.linked;
      }
      return { data: { items: [FACILITY, ARCHIVED], total: 2, totalPages: 1 }, isLoading: false, error: null };
    },
    useFacilityCountries: () => ({ data: [] }),
    useFacilityOutputStock: () => ({ data: undefined, isPending: false, isError: false }),
    useFacilityStats: () => ({ data: undefined, isLoading: false, isError: false }),
    useCreateFacility: mutation,
    useUpdateFacility: mutation,
    useArchiveFacility: mutation,
    useRestoreFacility: mutation,
  };
});
vi.mock("@/hooks/use-facility-context", () => ({
  useFacilityContext: () => ({ setFacilityId: harness.setFacilityId, facilityId: "fac-other" }),
}));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), setPageSize: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/components/ui/toast", () => {
  const toast = { success: vi.fn(), error: (message: string) => harness.toastError(message) };
  return { useToast: () => toast };
});
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, title, onOpenChange }: { open: boolean; title: string; onOpenChange: (open: boolean) => void }) =>
    open ? <div role="dialog" aria-label={title}><button type="button" onClick={() => onOpenChange(false)}>Close sheet</button></div> : null,
}));
vi.mock("@/components/ui/loading-skeleton", () => ({ CardSkeleton: () => null }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, FacilityArt: () => null }));
vi.mock("./facility-form", () => ({ FacilityForm: () => null }));
vi.mock("./facility-card", () => ({
  FacilityCard: ({ facility, onView }: { facility: typeof FACILITY; onView: (facility: typeof FACILITY) => void }) => (
    <button type="button" onClick={() => onView(facility)}>{`Open ${facility.code}`}</button>
  ),
}));
vi.mock("./archive-facility-dialog", () => ({ ArchiveFacilityDialog: () => null }));
vi.mock("./facility-registry-link-notice", () => ({ FacilityRegistryLinkNotice: () => null }));
vi.mock("./facility-read-sections", () => ({ facilitySheetSections: () => [] }));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button type="button" onClick={onClick}>{children}</button>,
  EmptyState: () => null,
  ListPagination: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
}));

import { FacilityList } from "./facility-list";

beforeEach(() => {
  linkedSheet.reset();
  harness.toastError.mockReset();
  harness.setFacilityId.mockReset();
  harness.lookups = [];
  harness.linked = { data: undefined, isError: false, isSuccess: false };
});
afterEach(cleanup);

describe("FacilityList record link", () => {
  it("opens the sheet for the facility the page was entered with", () => {
    linkedSheet.params.facility = FACILITY.id;
    harness.linked = { data: { items: [FACILITY] }, isError: false, isSuccess: true };
    render(<FacilityList />);
    expect(harness.lookups.at(-1)).toEqual({ id: FACILITY.id, pageSize: 1 });
    expect(screen.getByRole("dialog", { name: "FAC-001" })).toBeTruthy();
  });

  it("opens a plain visit with no sheet, even once the provider writes the working facility", () => {
    const view = render(<FacilityList />);
    linkedSheet.params.facility = "fac-other";
    view.rerender(<FacilityList />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(harness.lookups.every((filters) => filters === undefined || filters.id === undefined)).toBe(true);
  });

  it("makes a clicked facility the working facility and closing keeps it", () => {
    const view = render(<FacilityList />);
    fireEvent.click(screen.getByRole("button", { name: "Open FAC-001" }));
    expect(harness.setFacilityId).toHaveBeenCalledWith(FACILITY.id);
    view.rerender(<FacilityList />);
    expect(screen.getByRole("dialog", { name: "FAC-001" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close sheet" }));
    view.rerender(<FacilityList />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(harness.setFacilityId).toHaveBeenCalledTimes(1);
  });

  it("never makes an archived facility the working facility", () => {
    render(<FacilityList />);
    fireEvent.click(screen.getByRole("button", { name: "Open FAC-002" }));
    expect(harness.setFacilityId).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "FAC-002" })).toBeTruthy();
  });

  it("toasts when the linked facility is missing", () => {
    linkedSheet.params.facility = "gone";
    harness.linked = { data: { items: [] }, isError: false, isSuccess: true };
    render(<FacilityList />);
    expect(harness.toastError).toHaveBeenCalledWith("Linked facility could not be opened");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
