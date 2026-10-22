// @vitest-environment jsdom
/**
 * Deleting a credit batch from its page returns to the list. The dialog stays
 * open and busy until the list has rendered, and the success toast arrives
 * with it: the page never sits still with nothing busy, and the toast is never
 * up beside a dialog that still reads busy (#1364).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense, use, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, conflictCode } from "@/lib/conflict-ref";
import { ToastProvider } from "@/components/ui/toast";
import { CreditBatchPage } from "./credit-batch-page";

const FACILITY_ID = "facility-1";
const LIST_PATH = "/credit-batches";

const harness = vi.hoisted(() => ({
  remove: vi.fn(),
  pushSpy: vi.fn(),
  push: undefined as ((href: string) => void) | undefined,
  batch: { id: "batch-1", version: 3, code: "CB-1", facilityId: "facility-1", startDate: "2026-09-01", endDate: "2026-09-30" },
}));

// A tiny pathname store, so the toast provider sees the route change like the app does.
const path = { value: "/credit-batches/batch-1", listeners: new Set<() => void>() };
const setPath = (next: string) => { path.value = next; path.listeners.forEach((l) => l()); };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => { harness.pushSpy(href); harness.push?.(href); } }),
  usePathname: () => useSyncExternalStore(
    (l) => { path.listeners.add(l); return () => path.listeners.delete(l); },
    () => path.value,
    () => path.value,
  ),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  parseAsStringLiteral: () => ({ withDefault: () => ({ withOptions: () => ({}) }) }),
  useQueryState: () => ["overview", vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: FACILITY_ID, isResolving: false }) }));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-certification")>()),
  useBatchHealth: () => ({ data: undefined }),
  useBatchDurabilitySummary: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-emission-entries", () => ({ useBatchEmissionLines: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatch: () => ({ data: harness.batch, isPending: false }),
  useCreditBatchPageModel: () => ({ data: undefined }),
  useUpdateCreditBatch: () => ({ isPending: false }),
  useDeleteCreditBatch: () => ({ mutateAsync: harness.remove, isPending: false }),
}));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/components/record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).stubRecordLockComponentsModule);
vi.mock("@/components/navigation", () => ({ EntityNotFound: () => null }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: () => null }));
vi.mock("./credit-batch-form", () => ({ CreditBatchForm: () => null }));
vi.mock("./credit-batch-emissions-tab", () => ({ CreditBatchEmissionsTab: () => null }));
vi.mock("./credit-batch-page-overview", () => ({ CreditBatchOverview: () => null }));
vi.mock("./credit-batch-page-removals", () => ({ CreditBatchRemovalsTab: () => null }));
vi.mock("./credit-batch-page-tabs", () => ({
  CreditBatchActivitiesTab: () => null, CreditBatchProductionTab: () => null, CreditBatchSamplesTab: () => null,
}));
vi.mock("./credit-batch-page-header", async () => {
  const { useCreditBatchPage } = await import("./credit-batch-page-context");
  return {
    CreditBatchKeyNumbers: () => null,
    CreditBatchPageHeader: ({ onDelete }: { onDelete: () => void }) => {
      useCreditBatchPage();
      return <button type="button" onClick={onDelete}>Delete credit batch</button>;
    },
  };
});

/** Stands in for the router: pushing suspends the next route until `finish` is called. */
let finishNavigation!: () => void;
function Suspender({ gate }: { gate: Promise<void> }) {
  use(gate);
  return null;
}
function Shell() {
  const [gate, setGate] = useState<Promise<void> | null>(null);
  useEffect(() => {
    harness.push = () => setGate(new Promise<void>((resolve) => { finishNavigation = resolve; }));
  }, []);
  return (
    <ToastProvider>
      <CreditBatchPage creditBatchId="batch-1" canManage />
      <Suspense fallback={null}>{gate && <Suspender gate={gate} />}</Suspense>
    </ToastProvider>
  );
}

const deleteButton = () => screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement;
const openDialog = async () => {
  render(<Shell />);
  fireEvent.click(screen.getByRole("button", { name: "Delete credit batch" }));
  await screen.findByRole("dialog");
};

beforeEach(() => {
  harness.remove.mockReset();
  harness.pushSpy.mockReset();
  setPath("/credit-batches/batch-1");
});
afterEach(cleanup);

describe("deleting a credit batch from its page", () => {
  it("keeps the dialog busy, and shows no toast, until the list has rendered", async () => {
    harness.remove.mockResolvedValue({ success: true });
    await openDialog();

    fireEvent.click(deleteButton());

    // The delete is done and the route change has started, but the list is not there yet.
    await waitFor(() => expect(finishNavigation).toBeTypeOf("function"));
    await waitFor(() => expect(deleteButton().getAttribute("aria-busy")).toBe("true"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(deleteButton().textContent).toBe("Delete");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Credit batch deleted.")).toBeNull();

    // The list renders: the toast arrives with it.
    await act(async () => { setPath(LIST_PATH); finishNavigation(); });
    expect(await screen.findByText("Credit batch deleted.")).toBeTruthy();
  });

  it("closes the dialog and toasts the error, with no navigation, when the delete fails", async () => {
    harness.remove.mockRejectedValue(new Error("boom"));
    await openDialog();

    fireEvent.click(deleteButton());

    expect(await screen.findByText(/was not deleted|boom/i)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Credit batch deleted.")).toBeNull();
    expect(harness.pushSpy).not.toHaveBeenCalled();
  });

  it("opens the in-use dialog for a conflict, with no navigation", async () => {
    harness.remove.mockRejectedValue(new ConflictError("Has Samples.", { conflict: { entity: "sample", id: "s1", code: conflictCode("S-1") } }));
    await openDialog();

    fireEvent.click(deleteButton());

    expect(await screen.findByText(/Has Samples\./)).toBeTruthy();
    expect(screen.queryByText("Credit batch deleted.")).toBeNull();
    expect(harness.pushSpy).not.toHaveBeenCalled();
  });
});
