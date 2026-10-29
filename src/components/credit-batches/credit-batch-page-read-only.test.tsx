// @vitest-environment jsdom
/**
 * A link to a credit batch in an archived facility opens the routed page read
 * only (#1502): the batch shows, with the same read-only line as the other
 * kinds and no actions, instead of "Credit batch not found".
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { CREDIT_BATCH_DETAILS_ROW, type CreditBatchOpenItem } from "@/lib/credit-batches/open-items";
import { CreditBatchPage } from "./credit-batch-page";

const harness = vi.hoisted(() => ({
  linked: { ready: true, readOnly: null } as { ready: boolean; readOnly: unknown },
  linkedOptions: undefined as unknown,
  todos: undefined as unknown,
  contextFacility: "facility-2",
  batch: { id: "batch-1", version: 3, code: "CB-1", facilityId: "facility-1", startDate: "2026-09-01", endDate: "2026-09-30" },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/credit-batches/batch-1" }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  parseAsStringLiteral: () => ({ withDefault: () => ({ withOptions: () => ({}) }) }),
  useQueryState: () => ["overview", vi.fn()],
}));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityContext: () => ({ facilityId: harness.contextFacility, isResolving: false }) }));
vi.mock("@/hooks/use-linked-record-facility", () => ({
  useLinkedRecordFacility: (_record: unknown, _loading: unknown, options: unknown) => {
    harness.linkedOptions = options;
    return harness.linked;
  },
}));
vi.mock("@/hooks/use-certification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-certification")>()),
  useCreditBatchTodos: () => ({ data: harness.todos, isError: false }),
  useBatchDurabilitySummary: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-credit-batches", () => ({
  useCreditBatch: () => ({ data: harness.batch, isPending: false, isLoading: false }),
  useCreditBatchPageModel: () => ({ data: undefined }),
  useUpdateCreditBatch: () => ({ isPending: false }),
  useDeleteCreditBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).openRecordLocksModule);
vi.mock("@/components/record-locks", async () => (await import("../../../tests/helpers/record-lock-mocks")).stubRecordLockComponentsModule);
vi.mock("@/components/navigation", () => ({ EntityNotFound: () => <p>Credit batch not found</p> }));
vi.mock("@/components/ui/entity-side-sheet", () => ({ EntitySideSheet: ({ open }: { open: boolean }) => <p data-testid="edit-sheet">{`open:${open}`}</p> }));
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
    CreditBatchPageHeader: ({ primary }: { primary: unknown }) => {
      const page = useCreditBatchPage();
      return (
        <>
          <p data-testid="header">{`manage:${page.canManage} edit:${!!page.startEdit} primary:${!!primary}`}</p>
          <button type="button" onClick={() => page.openItem({ id: "details", title: "Details", target: { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW } } as CreditBatchOpenItem)}>open details</button>
          <p data-testid="items">{page.openItems.check.map((item) => `${item.id}:${item.target === null ? "text" : "action"}`).join(",")}</p>
        </>
      );
    },
  };
});

afterEach(cleanup);

describe("credit batch page in an archived facility", () => {
  it("opens read only with the facility line and no write affordances", () => {
    harness.linked = { ready: true, readOnly: { reason: "archived", facilityId: "facility-1", facilityName: "Mafinga", timezone: "UTC" } };
    render(<ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider>);
    expect(screen.queryByText("Credit batch not found")).toBeNull();
    expect(screen.getByText("Mafinga is archived, so this credit batch is read-only.")).toBeTruthy();
    expect(screen.getByTestId("header").textContent).toBe("manage:false edit:false primary:false");
  });

  it("keeps the not-found state for a batch in another facility that is not read only", () => {
    harness.linked = { ready: true, readOnly: null };
    render(<ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider>);
    expect(screen.getByText("Credit batch not found")).toBeTruthy();
  });

  it("never opens the edit sheet from a batch-details to-do, and shows to-dos as text", () => {
    harness.linked = { ready: true, readOnly: { reason: "archived", facilityId: "facility-1", facilityName: "Mafinga", timezone: "UTC" } };
    harness.todos = {
      blocking: [],
      check: [
        { id: "details", title: "Details", target: { tab: "overview", rowId: CREDIT_BATCH_DETAILS_ROW } },
        { id: "fix", title: "Fix", target: { href: "/settings" } },
        { id: "samples", title: "Samples", target: { tab: "samples" } },
      ],
      linesToDecide: 0,
    };
    render(<ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider>);
    fireEvent.click(screen.getByText("open details"));
    expect(screen.getByTestId("edit-sheet").textContent).toBe("open:false");
    expect(screen.getByTestId("items").textContent).toBe("details:text,fix:text,samples:action");
    harness.todos = undefined;
  });

  it("opens the edit sheet from the same to-do on a batch that is not read only", () => {
    harness.linked = { ready: true, readOnly: null };
    harness.contextFacility = "facility-1";
    render(<ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider>);
    fireEvent.click(screen.getByText("open details"));
    expect(screen.getByTestId("edit-sheet").textContent).toBe("open:true");
    harness.contextFacility = "facility-2";
  });

  it("renders nothing, not 'not found', while the linked facility lookup is pending", () => {
    harness.linked = { ready: false, readOnly: null };
    const { container } = render(<ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider>);
    expect(screen.queryByText("Credit batch not found")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("leaves the working facility alone", () => {
    harness.linked = { ready: true, readOnly: null };
    render(<ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider>);
    expect(harness.linkedOptions).toEqual({ switchFacility: false });
  });
});
