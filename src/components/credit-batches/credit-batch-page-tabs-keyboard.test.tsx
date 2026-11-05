// @vitest-environment jsdom
/**
 * The page tabs follow the WAI-ARIA tabs pattern like the Crew tabs: one tab
 * stop, and Left/Right/Home/End move focus and select.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
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
// A real state per query key, so selecting a tab re-renders the page.
vi.mock("nuqs", () => ({
  parseAsString: { withOptions: () => ({}) },
  parseAsStringLiteral: () => ({ withDefault: (value: string) => ({ withOptions: () => ({ defaultValue: value }) }) }),
  useQueryState: (_key: string, parser: { defaultValue?: string }) => {
    const [value, setValue] = useState<string | null>(null);
    return [value ?? parser.defaultValue ?? null, setValue];
  },
}));
vi.mock("@/hooks/use-linked-record-facility", () => ({ useLinkedRecordFacility: () => ({ ready: true, readOnly: null }) }));
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
vi.mock("./credit-batch-page-tabs", () => ({ CreditBatchActivitiesTab: () => null, CreditBatchProductionTab: () => null, CreditBatchSamplesTab: () => null }));
vi.mock("./credit-batch-view", () => ({ durabilityLabel: () => "Standard" }));


function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><CreditBatchPage creditBatchId="batch-1" canManage /></ToastProvider></QueryClientProvider>);
}

const tabs = () => screen.getAllByRole("tab");
const selectedTab = () => tabs().find((node) => node.getAttribute("aria-selected") === "true")!;

beforeEach(() => {
  harness.loadTodos.mockReset();
  harness.loadTodos.mockResolvedValue({ success: true, data: { state: "complete", linesToDecide: 0, blocking: [], check: [] } });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("credit batch page tabs keyboard", () => {
  it("keeps only the selected tab in the tab order", async () => {
    renderPage();
    await screen.findAllByRole("tab");
    expect(tabs().map((node) => node.getAttribute("tabindex"))).toEqual(tabs().map((node) => (node === selectedTab() ? "0" : "-1")));
  });

  it("moves focus and selection with ArrowRight, ArrowLeft, End and Home", async () => {
    renderPage();
    await screen.findAllByRole("tab");
    const first = tabs()[0]!;
    const last = tabs().at(-1)!;
    expect(selectedTab()).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(selectedTab()).toBe(tabs()[1]);
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs()[1]!.getAttribute("tabindex")).toBe("0");
    expect(first.getAttribute("tabindex")).toBe("-1");

    fireEvent.keyDown(tabs()[1]!, { key: "ArrowLeft" });
    expect(selectedTab()).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(selectedTab()).toBe(last);
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Home" });
    expect(selectedTab()).toBe(first);
    fireEvent.keyDown(first, { key: "End" });
    expect(selectedTab()).toBe(last);
    expect(document.activeElement).toBe(last);
  });
});
