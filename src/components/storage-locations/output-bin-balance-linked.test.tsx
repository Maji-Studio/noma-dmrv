// @vitest-environment jsdom
/** A read-only output bin reads its stock through the linked inventory read, not the live reads (#1502). */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ linked: [] as unknown[], balance: [] as unknown[], subBins: [] as unknown[] }));

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "UTC", hint: "" }) }));
vi.mock("@/hooks/use-output-stock", () => ({
  useLinkedOutputBinInventory: (input: unknown) => {
    calls.linked.push(input);
    return input
      ? {
          data: {
            contents: { stockMode: "mix", subBins: [] },
            balance: { binName: "Archived bin", beforeDryKg: 120, beforeEstimatedWetKg: 150, moistureEstimate: { moisturePercent: 20, basis: null } },
          },
          isLoading: false,
          error: null,
        }
      : { data: undefined, isLoading: false, error: null };
  },
  useOutputStockBalance: (input: unknown) => {
    calls.balance.push(input);
    return { data: undefined, isLoading: false, error: new Error("Output bin not found or archived") };
  },
  useOutputSubBins: (input: unknown) => {
    calls.subBins.push(input);
    return { data: undefined, isLoading: false, error: null };
  },
  useOutputStockHistory: () => ({ data: [], isLoading: false, error: null, dataUpdatedAt: 0 }),
}));
vi.mock("./output-stock-history", () => ({ OutputStockHistory: () => null }));

import { OutputBinBalance } from "./output-bin-balance";

afterEach(() => {
  cleanup();
  calls.linked = [];
  calls.balance = [];
  calls.subBins = [];
});

describe("OutputBinBalance on a read-only bin", () => {
  it("shows the stock from the linked read and leaves the live reads idle", () => {
    render(<OutputBinBalance storageLocationId="bin-1" facilityId="fac-1" capacityKg={null} readOnly />);
    expect(screen.queryByText(/not found or archived/)).toBeNull();
    expect(screen.getByText(/150/)).toBeTruthy();
    expect(calls.linked.every((input) => input !== null)).toBe(true);
    expect(calls.balance.every((input) => input === null)).toBe(true);
    expect(calls.subBins.every((input) => input === null)).toBe(true);
  });

  it("keeps the linked read idle on an editable bin", () => {
    render(<OutputBinBalance storageLocationId="bin-1" facilityId="fac-1" capacityKg={null} />);
    expect(calls.linked.every((input) => input === null)).toBe(true);
    expect(calls.balance.every((input) => input !== null)).toBe(true);
  });
});
