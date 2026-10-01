import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchingOutputBin } from "@/types/output-stock";
type BalanceBin = { storageLocationId: string; facilityId: string } | null;
const state = vi.hoisted(() => ({ bins: [] as MatchingOutputBin[], loading: false, error: false, inputs: [] as BalanceBin[] }));
vi.mock("@/hooks/use-output-stock", () => ({
  useMatchingOutputBins: () => ({ data: state.bins, isLoading: false, error: null }),
  useOutputStockBalance: (input: BalanceBin) => {
    state.inputs.push(input);
    const bin = state.bins.find(bin => bin.id === input?.storageLocationId);
    return { isLoading: state.loading, error: state.error ? new Error("Unavailable") : null, data: state.loading || state.error || !bin ? undefined : {
      binName: bin.name, binCode: bin.code, formulationName: "Pure biochar", lane: "product", beforeDryKg: 100, afterDryKg: 0,
      beforeEstimatedWetKg: null, afterEstimatedWetKg: null, movementMoisturePercent: null,
      beforeAllocations: [{ layerId: "batch", code: "BP-001", dryMassKg: 100, wetMassKg: null, runs: [] }], afterAllocations: [],
    } };
  },
}));
import { MatchingOutputBinList, MatchingOutputBins, summarizeMatchingStock } from "./matching-output-bins";
const renderList = () => renderToStaticMarkup(<MatchingOutputBinList bins={state.bins} facilityId="facility" />);

beforeEach(() => { state.loading = false; state.error = false; state.inputs = []; });
describe("MatchingOutputBins", () => {
  it("renders every bin beyond the first page without selecting or reserving stock", () => {
    state.bins = Array.from({ length: 25 }, (_, i) => ({ id: String(i), code: `B${i}`, name: `Bin ${i + 1}`, dryMassKg: 100, estimatedWetMassKg: null }));
    const html = renderList();
    expect(html.match(/role="article"/g)).toHaveLength(25);
    expect(html).toContain("Bin 25");
    expect(html).toContain("100 kg dry biochar");
    // The reservation rule lives in the block's hint, not as a sentence above it.
    expect(html).not.toContain("Orders do not reserve stock.");
    expect(html).not.toContain("150 kg");
  });
  it("shows one wet total with dry as a secondary line, and the button opens the bins", () => {
    state.bins = [
      { id: "a", code: "B1", name: "Bin A", dryMassKg: 100, estimatedWetMassKg: 120 },
      { id: "b", code: "B2", name: "Bin B", dryMassKg: 70, estimatedWetMassKg: 80 },
    ];
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Available wet stock, estimate");
    expect(text).toContain("≈ 200 kg wet");
    expect(text).toContain("Available dry stock 170 kg");
    expect(text).not.toContain("Tap to see");
    expect(text).toContain("2 bins");
    expect(html).not.toContain('role="article"');
  });
  it("says how many bins a partial wet estimate covers and keeps wet as the headline", () => {
    const bins = [
      { id: "a", code: "B1", name: "A", dryMassKg: 100, estimatedWetMassKg: 120 },
      { id: "b", code: "B2", name: "B", dryMassKg: 70, estimatedWetMassKg: 50 },
      { id: "c", code: "B3", name: "C", dryMassKg: 30, estimatedWetMassKg: null },
    ];
    const summary = summarizeMatchingStock(bins);
    expect(summary.wet).toBe("≈ 170 kg wet in 2 of 3 bins");
    expect(summary.dry).toBe("200 kg");
  });
  it("says how many bins a partial dry sum covers", () => {
    const summary = summarizeMatchingStock([
      { id: "a", code: "B1", name: "A", dryMassKg: 100, estimatedWetMassKg: 120 },
      { id: "b", code: "B2", name: "B", dryMassKg: null, estimatedWetMassKg: 50 },
      { id: "c", code: "B3", name: "C", dryMassKg: 30, estimatedWetMassKg: 10 },
    ]);
    expect(summary.dry).toBe("130 kg in 2 of 3 bins");
    expect(summary.wet).toBe("≈ 180 kg wet");
  });
  it("reads Not available when nothing resolves", () => {
    const summary = summarizeMatchingStock([{ id: "a", code: "B1", name: "A", dryMassKg: null, estimatedWetMassKg: null }]);
    expect(summary.wet).toBeNull();
    expect(summary.dry).toBeNull();
  });
  it("explicitly permits an order without stock", () => {
    state.bins = [];
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(html).toContain("You can save this order now");
  });
  it("shows current layers without a withdrawal or a history action", () => {
    state.bins = [{ id: "bin", code: "B1", name: "Bin", dryMassKg: 100, estimatedWetMassKg: null }];
    const html = renderList();
    expect(state.inputs).toEqual([{ storageLocationId: "bin", facilityId: "facility" }]);
    // The bar names the batch on hand and its dry mass, in its own accent.
    expect(html).toContain('aria-label="Batches in Bin: BP-001 100 kg"');
    expect(html).toContain("BP-001 100 kg dry");
    expect(html).toContain("background:var(--acc-prod)");
    expect(html).not.toContain("Stock history");
    // Without a resolved wet estimate the headline falls back to dry stock.
    expect(html).toContain("Available dry stock");
    expect(html).toContain("100 kg dry biochar");
    expect(html).not.toContain("wet");
    expect(html).not.toMatch(/Before loading|After loading|removed|>0 kg dry biochar|150 kg/);
  });
  it("leads with the bin's wet estimate and reads dry stock as a secondary line", () => {
    state.bins = [{ id: "bin", code: "B1", name: "Bin", dryMassKg: 100, estimatedWetMassKg: 118 }];
    const html = renderList();
    expect(html).toContain("Available wet stock, estimate");
    expect(html).toContain("118 kg wet");
    expect(html).toContain("At the latest moisture reading of each batch");
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Available dry stock 100 kg");
  });
  it.each(["loading", "error"] as const)("keeps stock informational when details are %s", status => {
    state[status] = true;
    state.bins = [{ id: "bin", code: "B1", name: "Bin", dryMassKg: 100, estimatedWetMassKg: null }];
    const html = renderList();
    expect(html).toContain('role="status"');
    expect(html).toContain("100 kg dry biochar");
    expect(html).not.toContain("150 kg");
  });
});
