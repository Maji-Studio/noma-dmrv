// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OutputStockPreview } from "@/types/output-stock";

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }) }));

const state = vi.hoisted(() => ({ blocker: null as string | null }));
vi.mock("@/hooks/use-output-stock", () => ({
  useOutputSubBins: () => ({ data: { stockMode: "mix", subBins: [] }, error: null }),
  useOutputStockBalance: () => ({ data: undefined }),
  usePostOutputStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOutputStockPreview: () => ({ isFetching: false, refetch: vi.fn(), data: {
    basisFingerprint: "basis", storageLocationId: "bin", binName: "Source bin", lane: "biochar",
    beforeDryKg: 80, afterDryKg: 0, removedDryKg: 80, removedWetKg: 100,
    beforeEstimatedWetKg: 100, afterEstimatedWetKg: 0, movementMoisturePercent: 20,
    discrepancySolidsKg: 0, allocations: [], blockingMessage: state.blocker,
  } satisfies Partial<OutputStockPreview> }),
}));
vi.mock("./output-stock-history", () => ({ OutputStockHistory: () => <button type="button">Stock history</button> }));
import { OutputStockForm } from "./output-stock-form";

afterEach(cleanup);

function renderForm() {
  return render(<OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" onCancel={vi.fn()} onRecorded={vi.fn()} />);
}

it("shows lost-mass inputs, the stock preview and blockers inline, and keeps the calculation behind the (i)", async () => {
  state.blocker = null;
  const { container, rerender } = renderForm();
  const inline = container.textContent ?? "";
  // The wet balance, the dry pair and the movement card are decision info.
  for (const label of ["Stock history", "Source bin", "Wet stock in bin, estimate", "Dry biochar in bin", "80 kg"]) expect(inline).toContain(label);
  expect(inline).not.toContain("Dry biochar removed");
  expect(inline).not.toContain("Original entry");
  expect(inline).toContain("Date and time");
  expect(inline).toContain("Wet mass removed");
  expect(inline).toContain("Save lost mass");
  expect(inline).not.toContain("Show calculation");
  expect(container.querySelector('input[type="radio"]')).toBeNull();

  state.blocker = "Not enough stock in this bin";
  rerender(<OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" onCancel={vi.fn()} onRecorded={vi.fn()} />);
  expect(container.textContent).toContain(state.blocker);

  // The figures behind the movement sit in the card's single (i).
  const infos = container.querySelectorAll("[data-explanation-info]");
  expect(infos).toHaveLength(1);
  fireEvent.click(infos[0]);
  const panel = await screen.findByRole("dialog");
  expect(panel.textContent).toContain("Dry biochar removed");
  expect(container.textContent).not.toContain("Batch breakdown");
});
