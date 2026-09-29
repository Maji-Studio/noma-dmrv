import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchingOutputBin } from "@/types/output-stock";
type BalanceBin = { storageLocationId: string; facilityId: string } | null;
const state = vi.hoisted(() => ({ bins: [] as MatchingOutputBin[], loading: false, error: false, inputs: [] as BalanceBin[] }));
vi.mock("@/components/storage-locations/output-stock-history", () => ({ OutputStockHistory: ({ storageLocationId, facilityId }: { storageLocationId: string; facilityId: string }) => <button data-history-bin={storageLocationId} data-facility={facilityId}>More info</button> }));
vi.mock("@/hooks/use-output-stock", () => ({
  useMatchingOutputBins: () => ({ data: state.bins, isLoading: false, error: null }),
  useOutputStockBalance: (input: BalanceBin) => {
    state.inputs.push(input);
    const bin = state.bins.find(bin => bin.id === input?.storageLocationId);
    return { isLoading: state.loading, error: state.error ? new Error("Unavailable") : null, data: state.loading || state.error || !bin ? undefined : {
      binName: bin.name, binCode: bin.code, formulationName: "Pure biochar", lane: "product", beforeDryKg: 100, afterDryKg: 0,
      beforeEstimatedWetKg: null, afterEstimatedWetKg: null, estimateMoisturePercent: null,
      beforeAllocations: [{ layerId: "batch", code: "BP-001", dryMassKg: 100, wetMassKg: null, runs: [] }], afterAllocations: [],
    } };
  },
}));
import { MatchingOutputBins } from "./matching-output-bins";

beforeEach(() => { state.loading = false; state.error = false; state.inputs = []; });
describe("MatchingOutputBins", () => {
  it("renders every bin beyond the first page without selecting or reserving stock", () => {
    state.bins = Array.from({ length: 25 }, (_, i) => ({ id: String(i), code: `B${i}`, name: `Bin ${i + 1}`, dryMassKg: 100, recordedWetMassKg: 150, estimatedWetMassKg: null }));
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(html.match(/role="article"/g)).toHaveLength(25);
    expect(html).toContain("Bin 25");
    expect(html).toContain("100 kg dry biochar");
    // The reservation rule lives in the block's hint, not as a sentence above it.
    expect(html).not.toContain("Orders do not reserve stock.");
    expect(html).not.toContain("150 kg");
  });
  it("explicitly permits an order without stock", () => {
    state.bins = [];
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(html).toContain("You can save this order now");
  });
  it("shows current layers and history without a withdrawal", () => {
    state.bins = [{ id: "bin", code: "B1", name: "Bin", dryMassKg: 100, recordedWetMassKg: 150, estimatedWetMassKg: null }];
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(state.inputs).toEqual([{ storageLocationId: "bin", facilityId: "facility" }]);
    // The bar names the batch on hand and its dry mass, in its own accent.
    expect(html).toContain('aria-label="Batches in Bin: BP-001 100 kg"');
    expect(html).toContain("BP-001 100 kg dry");
    expect(html).toContain("background:var(--acc-prod)");
    expect(html).toContain('data-history-bin="bin" data-facility="facility"');
    expect(html).toContain("More info");
    // Without a resolved wet estimate the headline falls back to dry stock.
    expect(html).toContain("Available dry stock");
    expect(html).toContain("100 kg dry biochar");
    expect(html).not.toContain("wet");
    expect(html).not.toMatch(/Before loading|After loading|removed|>0 kg dry biochar|150 kg/);
  });
  it("leads with the bin's wet estimate and keeps dry stock as detail", () => {
    state.bins = [{ id: "bin", code: "B1", name: "Bin", dryMassKg: 100, recordedWetMassKg: 150, estimatedWetMassKg: 118 }];
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(html).toContain("Available wet stock, estimate");
    expect(html).toContain("118 kg wet");
    expect(html).toContain("At the moisture recorded for each batch");
    expect(html).toContain("100 kg dry biochar");
  });
  it.each(["loading", "error"] as const)("keeps stock informational when details are %s", status => {
    state[status] = true;
    state.bins = [{ id: "bin", code: "B1", name: "Bin", dryMassKg: 100, recordedWetMassKg: 150, estimatedWetMassKg: null }];
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("100 kg dry biochar");
    expect(html).toContain("More info");
    expect(html).not.toContain("150 kg");
  });
});
