// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FacilityList } from "./facility-list";

const state = vi.hoisted(() => ({
  stats: { data: undefined as unknown, isLoading: false, isError: false },
  archivedArgs: [] as boolean[],
}));

vi.mock("@/hooks/use-facilities", () => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
  useFacilities: () => ({ data: { items: [], total: 25, totalPages: 3 }, isLoading: false, error: null }),
  useFacilityCountries: () => ({ data: [] }),
  useFacilityStats: (archived: boolean) => {
    state.archivedArgs.push(archived);
    return state.stats;
  },
  useCreateFacility: mutation,
  useUpdateFacility: mutation,
  useArchiveFacility: mutation,
  useRestoreFacility: mutation,
  };
});
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ setFacilityId: vi.fn() }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: unknown) => value }));
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 10, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("@/components/ui/loading-skeleton", () => ({ CardSkeleton: () => null }));
vi.mock("@/components/ui/illustrations", () => ({ ILLUSTRATION_SIZE: { empty: 0 }, FacilityArt: () => null }));
vi.mock("./facility-form", () => ({ FacilityForm: () => null }));
vi.mock("./facility-card", () => ({ FacilityCard: () => null }));
vi.mock("./archive-facility-dialog", () => ({ ArchiveFacilityDialog: () => null }));
vi.mock("./facility-registry-link-notice", () => ({ FacilityRegistryLinkNotice: () => null }));
vi.mock("./facility-read-sections", () => ({ facilitySheetSections: () => [] }));
vi.mock("@/components/ui/stat-card", () => ({
  StatCard: ({ title, value, description, isError }: { title: string; value: ReactNode; description?: string; isError?: boolean }) => (
    <section aria-label={title}>{isError ? "Could not load" : value}<small>{description}</small></section>
  ),
}));
vi.mock("@/components/ui", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  EmptyState: () => null,
  ListPagination: () => null,
  PageHeader: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
}));

afterEach(() => {
  cleanup();
  state.archivedArgs = [];
});

describe("FacilityList summary cards", () => {
  it("shows whole-list totals for the archived toggle, never page wording", () => {
    state.stats = { data: { totalFacilities: 25, totalReactors: 40, totalStorageBins: 90 }, isLoading: false, isError: false };
    render(<FacilityList />);

    expect(screen.getByLabelText("Active facilities").textContent).toContain("25");
    expect(screen.getByLabelText("Total reactors").textContent).toContain("40");
    expect(screen.getByLabelText("Total reactors").textContent).toContain("Across all active facilities");
    expect(screen.getByLabelText("Total storage bins").textContent).toContain("90");
    expect(document.body.textContent).not.toContain("on this page");
    expect(state.archivedArgs.at(-1)).toBe(false);
  });

  it("asks for the archived totals when the toggle is on", () => {
    state.stats = { data: { totalFacilities: 2, totalReactors: 3, totalStorageBins: 4 }, isLoading: false, isError: false };
    render(<FacilityList />);
    fireEvent.click(screen.getByRole("button", { name: /Archived/ }));

    expect(state.archivedArgs.at(-1)).toBe(true);
    expect(screen.getByLabelText("Archived facilities").textContent).toContain("2");
    expect(screen.getByLabelText("Total storage bins").textContent).toContain("Across all archived facilities");
  });

  it("shows the failure, not zeros, when the totals could not load", () => {
    state.stats = { data: undefined, isLoading: false, isError: true };
    render(<FacilityList />);

    expect(screen.getAllByText("Could not load")).toHaveLength(3);
  });
});
