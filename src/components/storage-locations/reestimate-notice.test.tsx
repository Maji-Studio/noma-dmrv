// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputStockPreview as Preview } from "@/types/output-stock";
import { OutputStockPreview } from "./output-stock-preview";
import { focusMoistureField, MEASURE_AGAIN_LABEL, ReestimateNotice, REESTIMATE_TITLE } from "./reestimate-notice";
import { reestimateFigures, reestimateFlow } from "./reestimate-flow";

afterEach(cleanup);

/** The issue's worked example: a bin of 100 kg wet at 20% (80 kg dry biochar), 50 kg lost at 50% (25 kg dry). */
const wetter: Preview = {
  expectedProductVersions: {}, basisFingerprint: "basis", storageLocationId: "bin", binName: "Pure bin", binCode: "PB-001", formulationName: "Pure", lane: "product",
  beforeDryKg: 80, afterDryKg: 55, beforeSolidsKg: 80, afterSolidsKg: 55,
  removedDryKg: 25, removedWetKg: 50, movementMoisturePercent: 50,
  beforeEstimatedWetKg: 100, afterEstimatedWetKg: 110, discrepancySolidsKg: 0, blockingMessage: null, allocations: [],
  reestimate: { moisturePercent: 50, stayWetKg: 110, stayDryKg: 55 },
};
const drier: Preview = { ...wetter, afterEstimatedWetKg: 60, reestimate: null };

describe("ReestimateNotice", () => {
  it("says what saving does, in the operator's words, with one action", () => {
    render(<ReestimateNotice preview={wetter} kind="loss" onMeasureAgain={vi.fn()} />);
    expect(screen.getByText(REESTIMATE_TITLE)).toBeTruthy();
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Saving re-estimates what stays in the bin at 50% moisture, until the next count.");
    expect(notice.textContent).toContain("measure the moisture of the lost mass again before saving");
    expect(notice.textContent).not.toMatch(/reading/i);
    expect(screen.getAllByRole("button", { name: MEASURE_AGAIN_LABEL })).toHaveLength(1);
  });

  it("names a delivery as the thing to measure again", () => {
    render(<ReestimateNotice preview={wetter} kind="delivery" />);
    expect(screen.getByRole("status").textContent).toContain("measure the moisture of this delivery again");
  });

  it("renders nothing unless saving re-estimates what stays", () => {
    const { container } = render(<ReestimateNotice preview={drier} kind="loss" onMeasureAgain={vi.fn()} />);
    expect(container.innerHTML).toBe("");
    cleanup();
    const refused = render(<ReestimateNotice preview={{ ...wetter, blockingMessage: "Not enough dry biochar." }} kind="loss" />);
    expect(refused.container.innerHTML).toBe("");
  });

  it("offers no action where the form cannot take the operator back to the moisture", () => {
    render(<ReestimateNotice preview={wetter} kind="loss" />);
    expect(screen.queryByRole("button", { name: MEASURE_AGAIN_LABEL })).toBeNull();
  });

  it("calls the form's action from its one button", () => {
    const measure = vi.fn();
    render(<ReestimateNotice preview={wetter} kind="loss" onMeasureAgain={measure} />);
    fireEvent.click(screen.getByRole("button", { name: MEASURE_AGAIN_LABEL }));
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("is part of a movement preview only when the preview re-estimates", () => {
    render(<OutputStockPreview variant="movement" preview={wetter} entry={{ kind: "loss", wetMassKg: 50 }} onMeasureAgain={vi.fn()} />);
    expect(screen.getByTestId("reestimate-notice")).toBeTruthy();
    cleanup();
    render(<OutputStockPreview variant="movement" preview={drier} entry={{ kind: "loss", wetMassKg: 50 }} onMeasureAgain={vi.fn()} />);
    expect(screen.queryByTestId("reestimate-notice")).toBeNull();
  });
});

describe("focusMoistureField", () => {
  it("focuses the moisture field the operator entered, or a split draw's first reading", () => {
    document.body.innerHTML = '<input id="stock-moisture-layer-a" /><input id="stock-moisture-layer-b" />';
    Element.prototype.scrollIntoView = vi.fn();
    focusMoistureField("#stock-moisture, input[id^='stock-moisture-']");
    expect(document.activeElement?.id).toBe("stock-moisture-layer-a");
    document.body.innerHTML = '<input id="stock-moisture" />';
    focusMoistureField("#stock-moisture, input[id^='stock-moisture-']");
    expect(document.activeElement?.id).toBe("stock-moisture");
  });
});

describe("reestimateFlow", () => {
  it("balances the worked example: 100 kg wet in, 110 kg wet out, the gap drawn as its own source", () => {
    const figures = reestimateFigures(wetter)!;
    const diagram = reestimateFlow(figures, "Pure bin", "loss");
    const kg = (id: string) => diagram.nodes.flatMap((node) => node.segments).find((segment) => segment.id === id)?.kg ?? 0;
    expect(kg("bin-dry-stays")).toBe(55);
    expect(kg("bin-dry-removed")).toBe(25);
    expect(kg("bin-water-removed")).toBe(20);
    expect(kg("removed-water-missing")).toBe(5);
    expect(kg("stays-water-missing")).toBe(55);
    expect(diagram.nodes.map((node) => node.name)).toEqual(["Pure bin", "Water not in the estimate", "Stays, re-estimated", "Lost mass"]);
    expect(diagram.nodes[1].caption).toBe("60 kg");
    expect(diagram.nodes[2].caption).toBe("≈ 110 kg at 50%");
    // Every link joins two drawn segments.
    const ids = new Set(diagram.nodes.flatMap((node) => node.segments.map((segment) => segment.id)));
    for (const link of diagram.links) expect(ids.has(link.from) && ids.has(link.to)).toBe(true);
  });
});
