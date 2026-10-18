// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";
import { RecordMonthGrid } from "./record-month-grid";

const mocks = vi.hoisted(() => ({ createEntry: vi.fn(), upload: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/emissions/cb" }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/hooks/use-file-upload", () => ({ useFileUpload: () => ({ upload: mocks.upload }) }));
vi.mock("@/hooks/use-emission-entries", () => ({
  invalidateEmissionEntryReads: vi.fn(),
  useCreateEmissionEntry: () => ({ isPending: false, mutateAsync: mocks.createEntry }),
  useConfirmEmissionEntry: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

const SCOPE = { facilityId: "fac", creditBatchId: "cb" };
const BATCH = { creditBatchId: "cb", code: "CB-1", startDate: "2026-09-01", endDate: null };
const EMPTY = makeLine({ componentId: "fuel", displayName: "Diesel use emissions" });
const RECORDED = makeLine({ state: "filled", entries: [makeEntry()] });
const SINGLE = makeLine({ componentId: "single", displayName: "Commissioning emissions", entryPolicy: "single", state: "filled", entries: [makeEntry({ componentId: "single" })] });

function renderGrid(lines = [EMPTY, RECORDED, SINGLE]) {
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RecordMonthGrid lines={lines} batch={BATCH} scope={SCOPE} today="2026-10-18" onDone={onDone} onEnterAgain={vi.fn()} />
    </QueryClientProvider>,
  );
  return onDone;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecordMonthGrid", () => {
  it("lists open lines first, then recorded lines that add up entries, and keeps single-entry lines done", () => {
    renderGrid();
    const open = screen.getByRole("list", { name: "Open lines" });
    expect(within(open).getByText("Diesel use emissions")).toBeTruthy();
    const recorded = screen.getByRole("list", { name: "Add to recorded lines" });
    expect(within(recorded).getByText(RECORDED.displayName)).toBeTruthy();
    expect(within(recorded).getByLabelText(/Energy/)).toBeTruthy();
    expect(screen.queryByText("Commissioning emissions")).toBeNull();
    expect(screen.getByRole("button", { name: "Show done lines (1)" })).toBeTruthy();
  });

  it("drops a draft typed in units the template no longer uses", () => {
    const grid = (unit: string) => (
      <QueryClientProvider client={new QueryClient()}>
        <RecordMonthGrid
          lines={[makeLine({ inputShape: [{ key: "energy", type: "monitored", quantityKind: "energy", unit }] } as never)]}
          batch={BATCH} scope={SCOPE} today="2026-10-18" onDone={vi.fn()} onEnterAgain={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(grid("kWh"));
    fireEvent.change(screen.getByLabelText(/Energy/), { target: { value: "2" } });
    rerender(grid("Wh"));
    expect(screen.getByLabelText(/Energy/)).toHaveProperty("value", "");
    expect((screen.getByRole("button", { name: "Save all" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves a second month on a recorded line", async () => {
    mocks.createEntry.mockResolvedValue({ id: "entry-9" });
    const onDone = renderGrid([RECORDED]);
    fireEvent.change(screen.getByLabelText(/Energy/), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save all" }));
    await waitFor(() => expect(mocks.createEntry).toHaveBeenCalledWith(expect.objectContaining({ componentId: "line-1", creditBatchId: "cb" })));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
