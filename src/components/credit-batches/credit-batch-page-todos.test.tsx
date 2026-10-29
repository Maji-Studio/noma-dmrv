// @vitest-environment jsdom
/**
 * The page reads its to-dos in one server call. When that read fails it says
 * so once, with Retry, and shows no list and no counts built from the failure.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { certificationKeys } from "@/hooks/use-certification";
import { CreditBatchPage } from "./credit-batch-page";

const harness = vi.hoisted(() => ({
  loadTodos: vi.fn(),
  batch: { id: "batch-1", version: 1, code: "CB-1", facilityId: "facility-1", startDate: "2026-09-01", endDate: "2026-09-30" },
  // Biochar produced but not applied: a Waiting item that must not show beside a failed read.
  pageModel: {
    creditBatchId: "batch-1", facilityId: "facility-1", slices: [], removals: [],
    mass: { producedDryKg: 100, appliedDryKg: 50, inSubmittedDryKg: 0, inDraftDryKg: 0, notInRemovalDryKg: 50, notAppliedDryKg: 50 },
    milestones: { firstRemovalSubmittedAt: null, firstRemovalSubmittedCode: null, ghgStatement: null },
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/credit-batches/batch-1" }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  parseAsStringLiteral: () => ({ withDefault: () => ({ withOptions: () => ({}) }) }),
  useQueryState: () => ["overview", vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: "facility-1", isResolving: false }) }));
vi.mock("@/fn/certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fn/certification")>()),
  loadCreditBatchTodosFn: harness.loadTodos,
}));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatch: () => ({ data: harness.batch, isPending: false }),
  useCreditBatchPageModel: () => ({ data: harness.pageModel }),
  useUpdateCreditBatch: () => ({ isPending: false }),
  useDeleteCreditBatch: () => ({ isPending: false }),
}));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/components/record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).stubRecordLockComponentsModule);
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("./credit-batch-form", () => ({ CreditBatchForm: () => null }));
vi.mock("./credit-batch-page-header", () => ({ CreditBatchPageHeader: () => null, CreditBatchKeyNumbers: () => null }));
vi.mock("./credit-batch-removal-template", () => ({ CreditBatchRemovalTemplate: () => null }));
vi.mock("./credit-batch-view", () => ({ durabilityLabel: () => "Standard" }));

const TODOS = {
  state: "incomplete", linesToDecide: 0,
  blocking: [{ id: "health:samples", title: "No lab Samples", target: { tab: "samples" } }],
  check: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider></QueryClientProvider>) };
}

beforeEach(() => harness.loadTodos.mockReset());
afterEach(cleanup);

describe("credit batch page to-dos", () => {
  it("shows the groups from the server read", async () => {
    harness.loadTodos.mockResolvedValue({ success: true, data: TODOS });
    renderPage();
    expect(await screen.findByText("No lab Samples")).toBeTruthy();
    expect(screen.getByText("Blocking")).toBeTruthy();
    expect(screen.getByText(/produced but not applied yet/)).toBeTruthy();
    expect(harness.loadTodos).toHaveBeenCalledWith("facility-1", "batch-1");
  });

  it("links the run code of a missing-run Check outside its Add in Edit button", async () => {
    harness.loadTodos.mockResolvedValue({ success: true, data: { ...TODOS, blocking: [], check: [{
      id: "missing-production-run:run-1", productionRun: { id: "run-1", code: "RUN-1" },
      title: "RUN-1 is not in this credit batch yet", titleAfterCode: " is not in this credit batch yet", detail: "Its emissions are not counted.",
      target: { tab: "overview", rowId: "batch-details" },
    }] } });
    renderPage();
    const link = await screen.findByRole("link", { name: "RUN-1" });
    expect(link.getAttribute("href")).toContain("run-1");
    expect(link.closest("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Add in Edit" })).toBeTruthy();
  });

  it("offers Open Emissions, not Add in Edit, for a Sent batch's late run", async () => {
    harness.loadTodos.mockResolvedValue({ success: true, data: { ...TODOS, blocking: [], check: [{
      id: "late-production-run:run-1", productionRun: { id: "run-1", code: "RUN-1" },
      title: "RUN-1 was recorded after RM-9 was sent", titleAfterCode: " was recorded after RM-9 was sent",
      detail: "It is not in this credit batch. Record its diesel and power on the Emissions tab, dated Sep 10, 2026.",
      target: { tab: "emissions" },
    }] } });
    renderPage();
    expect(await screen.findByRole("link", { name: "RUN-1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Emissions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add in Edit" })).toBeNull();
  });

  it("shows the notice and Retry, and no to-do groups or counts, when the read fails", async () => {
    harness.loadTodos.mockResolvedValue({ success: false, error: "boom" });
    renderPage();
    expect(await screen.findByText("Blocking items could not be checked. Retry to load them.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    for (const title of ["Blocking", "Check", "Waiting"]) expect(screen.queryByText(title)).toBeNull();
    expect(screen.queryByText(/produced but not applied yet/)).toBeNull();
    expect(screen.queryByText(/Nothing is open/)).toBeNull();
    expect(screen.queryByLabelText(/open to-do/)).toBeNull();
  });

  it("reads again on Retry and shows the list once it answers", async () => {
    harness.loadTodos.mockResolvedValueOnce({ success: false, error: "boom" });
    harness.loadTodos.mockResolvedValue({ success: true, data: TODOS });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No lab Samples")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/could not be checked/)).toBeNull());
  });

  it("shows the notice and no items or counts when a refetch fails after a good read, and Retry recovers", async () => {
    harness.loadTodos.mockResolvedValueOnce({ success: true, data: TODOS });
    const { client } = renderPage();
    expect(await screen.findByText("No lab Samples")).toBeTruthy();
    harness.loadTodos.mockResolvedValueOnce({ success: false, error: "boom" });
    await client.refetchQueries({ queryKey: certificationKeys.batchTodos("facility-1", "batch-1") });
    expect(await screen.findByText("Blocking items could not be checked. Retry to load them.")).toBeTruthy();
    expect(screen.queryByText("No lab Samples")).toBeNull();
    for (const title of ["Blocking", "Check", "Waiting"]) expect(screen.queryByText(title)).toBeNull();
    expect(screen.queryByText(/produced but not applied yet/)).toBeNull();
    harness.loadTodos.mockResolvedValue({ success: true, data: TODOS });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No lab Samples")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/could not be checked/)).toBeNull());
  });
});
