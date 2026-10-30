// @vitest-environment jsdom
/**
 * A link to a production run in an archived facility (#1502): the normal read
 * hides it, so the separate linked read opens the sheet read only, with the
 * archived facility's own timezone for its times.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = { id: "run-1", code: "RUN-1", date: "2026-09-01", facilityId: "facility-x", version: 1 };
const harness = vi.hoisted(() => ({
  normal: { data: null as unknown, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false },
  linked: { data: null as unknown, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false },
  linkedEnabled: [] as boolean[],
  sectionFacilities: [] as unknown[],
  toastError: vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  useQueryState: (key: string) => [key === "run" ? RUN.id : null, vi.fn()],
}));
vi.mock("@/hooks/use-facilities", async (importOriginal) => (await import("../../../tests/helpers/facility-lookup-mocks")).activeFacilityLookupModule(await importOriginal()));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: null, facilities: [] }) }));
vi.mock("@/hooks/use-linked-record-facility", () => ({
  useLinkedRecordFacility: (record: unknown) => ({
    ready: !!record,
    readOnly: record ? { reason: "archived", facilityId: "facility-x", facilityName: "Mafinga", timezone: "Africa/Dar_es_Salaam" } : null,
  }),
}));
vi.mock("@/hooks/use-production-runs", () => ({
  useProductionRuns: () => ({ data: { items: [], totalPages: 0 } }),
  useProductionRun: () => harness.normal,
  useLinkedProductionRun: (_id: string, enabled: boolean) => { harness.linkedEnabled.push(enabled); return harness.linked; },
  useProductionRunStats: () => ({}),
  useCreateProductionRun: () => ({}), useUpdateProductionRun: () => ({}),
  useDeleteProductionRun: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({ useCreditBatches: () => ({ data: [] }) }));
vi.mock("@/hooks/use-debounce", () => ({ useDebounce: (value: string) => value }));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/hooks/use-open-create-intent", () => ({ useOpenCreateIntent: () => undefined }));
vi.mock("@/hooks/use-list-pagination", () => ({
  useListPagination: () => ({ currentPage: 1, pageSize: 25, setCurrentPage: vi.fn(), onPaginationChange: vi.fn() }),
  useReconcileListPage: () => undefined,
}));
vi.mock("@/hooks/use-create-with-evidence", () => ({ useCreateWithEvidence: () => ({ reset: vi.fn(), confirmClose: () => true }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ error: harness.toastError, success: vi.fn() }) }));
vi.mock("@/components/navigation", () => ({ SelectFacilityEmptyState: () => <p>Select a facility</p> }));
vi.mock("@/components/forms", () => ({ ServerError: () => null }));
vi.mock("@/components/ui", () => ({
  Button: () => null, EmptyState: () => null, PageHeader: () => null, RowActionsMenu: () => null,
}));
vi.mock("@/components/ui/data-table", () => ({
  DataTable: Object.assign(() => null, { Toolbar: () => null, Search: () => null, Controls: () => null, FilterSelect: () => null, ColumnVisibility: () => null, Pagination: () => null }),
}));
vi.mock("@/components/ui/stat-card", () => ({ StatCard: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({
  EntitySideSheet: ({ open, readOnly, title }: { open: boolean; readOnly?: { message: string }; title: string; children?: ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{readOnly?.message}</div> : null,
}));
vi.mock("@/components/ui/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));
vi.mock("@/components/ui/in-use-delete-dialog", () => ({ InUseDeleteDialog: () => null, InUseReference: () => null }));
vi.mock("@/components/certification/entity-certify-readiness-badge", () => ({ EntityCertifyReadinessBadge: () => null }));
vi.mock("./production-run-form", () => ({ ProductionRunForm: () => null }));
vi.mock("./production-run-read-sections", () => ({
  productionRunSheetSections: (_run: unknown, facilities: unknown) => { harness.sectionFacilities.push(facilities); return []; },
  RunStatusBadge: () => null,
}));
vi.mock("./production-incident-table", () => ({ ProductionIncidentTable: () => null }));
vi.mock("./production-sample-table", () => ({ ProductionSampleTable: () => null }));

import { ProductionRunList } from "./production-run-list";

beforeEach(() => {
  harness.normal = { data: null, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false };
  harness.linked = { data: RUN, isLoading: false, isFetching: false, isPending: false, isSuccess: true, isError: false };
  harness.linkedEnabled = [];
  harness.sectionFacilities = [];
  harness.toastError.mockReset();
});
afterEach(cleanup);

describe("ProductionRunList link into an archived facility", () => {
  it("opens the run from the linked read, read only, without the could-not-open toast", () => {
    render(<ProductionRunList />);
    expect(harness.linkedEnabled.at(-1)).toBe(true);
    expect(screen.getByRole("dialog", { name: "RUN-1" }).textContent).toBe("Mafinga is archived, so this production run is read-only.");
    expect(harness.toastError).not.toHaveBeenCalled();
  });

  it("reads times in the archived facility's timezone, not the working facility's", () => {
    render(<ProductionRunList />);
    expect(harness.sectionFacilities.at(-1)).toEqual([{ id: "facility-x", timezone: "Africa/Dar_es_Salaam" }]);
  });

  it("does not use the linked read while the normal read answers", () => {
    harness.normal = { ...harness.normal, data: RUN };
    render(<ProductionRunList />);
    expect(harness.linkedEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it("tries the linked read when the normal read errored, even with cached data", () => {
    harness.normal = { ...harness.normal, data: RUN, isError: true };
    render(<ProductionRunList />);
    expect(harness.linkedEnabled.at(-1)).toBe(true);
    expect(screen.getByRole("dialog", { name: "RUN-1" }).textContent).toBe("Mafinga is archived, so this production run is read-only.");
  });
});
