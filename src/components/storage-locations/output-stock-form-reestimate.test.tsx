// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reestimate: null as object | null }));
vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "Facility time: UTC" }) }));
vi.mock("@/hooks/use-output-stock", () => ({
  useOutputSubBins: () => ({ data: { stockMode: "mix", subBins: [] }, error: null }),
  useOutputStockBalance: () => ({ data: undefined }),
  usePostOutputStock: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOutputStockPreview: () => ({
    data: { basisFingerprint: "basis", blockingMessage: null, reestimate: state.reestimate, beforeEstimatedWetKg: 100, afterEstimatedWetKg: 110, beforeSolidsKg: 80, afterSolidsKg: 55, removedWetKg: 50, removedDryKg: 25, binName: "Bin", moistureEstimate: { moisturePercent: 20, wetKg: 100, basis: { source: "recorded", at: "2026-09-12T12:00:00.000Z" } } },
    isFetching: false, error: null, refetch: vi.fn(),
  }),
}));
vi.mock("./output-stock-preview", () => ({ OutputStockPreview: () => null, OutputStockAllocations: () => null }));
vi.mock("./output-stock-history", () => ({ OutputStockHistory: () => null }));
import { OutputStockForm } from "./output-stock-form";

afterEach(cleanup);

function open() {
  render(<OutputStockForm storageLocationId="00000000-0000-4000-8000-000000000002" facilityId="00000000-0000-4000-8000-000000000003" onCancel={vi.fn()} onRecorded={vi.fn()} />);
  fireEvent.change(document.querySelector("#stock-moisture")!, { target: { value: "50" } });
}

describe("Lost mass moisture advisory", () => {
  it("keeps the far-from-estimate advisory when the loss does not re-estimate", () => {
    state.reestimate = null;
    open();
    expect(screen.getByText(/50% is 30 points above the 20% estimate/)).toBeTruthy();
  });

  it("drops it while the re-estimate notice says what to do, and keeps the estimate cue", () => {
    state.reestimate = { moisturePercent: 50, layers: [{ layerId: "a", name: "P1", moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 }], stayWetKg: 110, staySolidsKg: 55, stayDryKg: 55 };
    open();
    expect(screen.queryByText(/points above/)).toBeNull();
    expect(screen.getByText("Estimated moisture: 20%")).toBeTruthy();
  });
});
