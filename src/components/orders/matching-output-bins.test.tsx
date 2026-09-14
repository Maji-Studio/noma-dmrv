import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MatchingOutputBin } from "@/types/output-stock";
const state = vi.hoisted(() => ({ bins: [] as MatchingOutputBin[] }));
vi.mock("@/hooks/use-output-stock", () => ({ useMatchingOutputBins: () => ({ data: state.bins, isLoading: false, error: null }) }));
import { MatchingOutputBins } from "./matching-output-bins";

describe("MatchingOutputBins", () => {
  it("renders every bin beyond the first page without selecting or reserving stock", () => {
    state.bins = Array.from({ length: 25 }, (_, i) => ({ id: String(i), code: `B${i}`, name: `Bin ${i + 1}`, dryMassKg: 100, recordedWetMassKg: 150 }));
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(html.match(/role="article"/g)).toHaveLength(25);
    expect(html).toContain("Bin 25");
    expect(html).toContain("100 kg dry biochar available");
    expect(html).toContain("Orders do not reserve stock.");
    expect(html).not.toContain("150 kg");
  });
  it("explicitly permits an order without stock", () => {
    state.bins = [];
    const html = renderToStaticMarkup(<MatchingOutputBins facilityId="facility" formulationId="pure" />);
    expect(html).toContain("You can save this order now");
  });
});
