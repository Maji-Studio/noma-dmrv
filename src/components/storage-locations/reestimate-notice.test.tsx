// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutputStockPreview as Preview } from "@/types/output-stock";
import { OutputStockPreview } from "./output-stock-preview";
import { focusMoistureField, MEASURE_AGAIN_LABEL, moistureFieldSelectors, ReestimateNotice } from "./reestimate-notice";
import { reestimateFigures, reestimateFlow } from "./reestimate-flow";

afterEach(cleanup);

/** The issue's worked example: a bin of 100 kg wet at 20% (80 kg dry biochar), 50 kg lost at 50% (25 kg dry). */
const wetter: Preview = {
  expectedProductVersions: {}, basisFingerprint: "basis", storageLocationId: "bin", binName: "Pure bin", binCode: "PB-001", formulationName: "Pure", lane: "product",
  beforeDryKg: 80, afterDryKg: 55, beforeSolidsKg: 80, afterSolidsKg: 55,
  removedDryKg: 25, removedWetKg: 50, movementMoisturePercent: 50,
  beforeEstimatedWetKg: 100, afterEstimatedWetKg: 110, discrepancySolidsKg: 0, blockingMessage: null, allocations: [],
  reestimate: { moisturePercent: 50, layers: [{ layerId: "a", name: "P1", moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 }], stayWetKg: 110, staySolidsKg: 55, stayDryKg: 55 },
};
/** Two sub-bins: A (100 wet, 80 solids) supplies 50 kg at 50%; B (200 wet, 80 solids) is untouched. */
const split: Preview = {
  ...wetter, stockMode: "split", beforeSolidsKg: 160, afterSolidsKg: 135, beforeDryKg: 160, afterDryKg: 135, beforeEstimatedWetKg: 300, afterEstimatedWetKg: 310,
  beforeAllocations: [{ layerId: "a", code: "A", wetMassKg: 100, dryMassKg: 80, runs: [] }],
  reestimate: { moisturePercent: 50, layers: [{ layerId: "a", name: "A", moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 }], stayWetKg: 310, staySolidsKg: 135, stayDryKg: 135 },
};
/** A blend: 100 wet, 40 biochar plus 40 ingredient solids, a delivery of 50 kg at 50%. */
const blend: Preview = {
  ...wetter, beforeDryKg: 40, afterDryKg: 27.5, beforeSolidsKg: 80, afterSolidsKg: 55, removedDryKg: 12.5, removedSolidsKg: 25,
  reestimate: { moisturePercent: 50, layers: [{ layerId: "a", name: "P1", moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 }], stayWetKg: 110, staySolidsKg: 55, stayDryKg: 27.5 },
};
const drier: Preview = { ...wetter, afterEstimatedWetKg: 60, reestimate: null };

describe("ReestimateNotice", () => {
  it("asks to check the moisture and shows the bin before and after, with one action", () => {
    render(<ReestimateNotice preview={wetter} kind="loss" onMeasureAgain={vi.fn()} />);
    expect(screen.getByText("Check the moisture: 50% against the bin's 20%")).toBeTruthy();
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("If 50% is right, saving changes the bin until it is counted again.");
    expect(notice.textContent).toMatch(/Bin now\s*100 kg at 20%/);
    expect(notice.textContent).toMatch(/After saving\s*110 kg at 50%/);
    expect(notice.textContent).not.toMatch(/estimate|next count|reading|removal/i);
    expect(screen.getAllByRole("button", { name: MEASURE_AGAIN_LABEL })).toHaveLength(1);
  });

  it("explains the rise in the operator's numbers behind the (i)", () => {
    render(<ReestimateNotice preview={wetter} kind="delivery" />);
    fireEvent.click(screen.getByRole("button", { name: "About Why the bin goes up" }));
    expect(screen.getByText("80 kg of the bin is biochar. This delivery takes 25 kg of it, so 55 kg stays. Counted at 50% moisture, those 55 kg weigh 110 kg.")).toBeTruthy();
  });

  it("names the sub-bin a split bin changes and sends the action to its row", () => {
    const measure = vi.fn();
    render(<ReestimateNotice preview={split} kind="delivery" onMeasureAgain={measure} />);
    const text = screen.getByRole("status").textContent;
    expect(text).toContain("Check the moisture: 50% against A's 20%");
    expect(text).toContain("If 50% is right, saving changes A until the bin is counted again.");
    expect(text).toMatch(/A now\s*100 kg at 20%/);
    expect(text).toMatch(/After saving\s*110 kg at 50%/);
    fireEvent.click(screen.getByRole("button", { name: MEASURE_AGAIN_LABEL }));
    expect(measure).toHaveBeenCalledWith("a");
  });

  it("lists several sub-bins at one reading", () => {
    const layers = [{ layerId: "a", name: "A", moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 }, { layerId: "b", name: "B", moisturePercent: 50, stayWetKg: 100, staySolidsKg: 50 }];
    const beforeAllocations = [{ layerId: "a", code: "A", wetMassKg: 100, dryMassKg: 80, runs: [] }, { layerId: "b", code: "B", wetMassKg: 90, dryMassKg: 72, runs: [] }];
    render(<ReestimateNotice preview={{ ...split, beforeAllocations, reestimate: { moisturePercent: 50, layers, stayWetKg: 400, staySolidsKg: 191, stayDryKg: 191 } }} kind="loss" onMeasureAgain={vi.fn()} />);
    const text = screen.getByRole("status").textContent;
    expect(text).toContain("Check the moisture: 50% for A and B");
    expect(text).toContain("If 50% is right, saving changes A and B until the bin is counted again.");
    expect(text).toMatch(/B now\s*90 kg at 20%/);
  });

  it("shows one pair per sub-bin when the readings differ, never a bin average", () => {
    const layers = [{ layerId: "a", name: "A", moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 }, { layerId: "b", name: "B", moisturePercent: 60, stayWetKg: 140, staySolidsKg: 56 }];
    const beforeAllocations = [{ layerId: "a", code: "A", wetMassKg: 100, dryMassKg: 80, runs: [] }, { layerId: "b", code: "B", wetMassKg: 90, dryMassKg: 72, runs: [] }];
    render(<ReestimateNotice preview={{ ...split, beforeAllocations, reestimate: { moisturePercent: null, layers, stayWetKg: 400, staySolidsKg: 191, stayDryKg: 191 } }} kind="loss" onMeasureAgain={vi.fn()} />);
    const text = screen.getByRole("status").textContent;
    expect(screen.getByText("Check the moisture readings")).toBeTruthy();
    expect(text).toContain("If these readings are right, saving changes A and B until the bin is counted again.");
    expect(text).toMatch(/A now\s*100 kg at 20%/);
    expect(text).toMatch(/After saving\s*140 kg at 60%/);
  });

  it("says the bin for a mix pile and sends the action to the single field", () => {
    const measure = vi.fn();
    render(<ReestimateNotice preview={{ ...split, stockMode: "mix" }} kind="loss" onMeasureAgain={measure} />);
    expect(screen.getByRole("status").textContent).toContain("saving changes the bin until it is counted again");
    fireEvent.click(screen.getByRole("button", { name: MEASURE_AGAIN_LABEL }));
    expect(measure).toHaveBeenCalledWith(undefined);
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
  it("tries the affected sub-bin's row, then the single field, then the first reading", () => {
    Element.prototype.scrollIntoView = vi.fn();
    document.body.innerHTML = '<input id="stock-moisture-layer-a" /><input id="stock-moisture-layer-b" />';
    focusMoistureField(moistureFieldSelectors("stock", "stock-moisture", "layer-b"));
    expect(document.activeElement?.id).toBe("stock-moisture-layer-b");
    focusMoistureField(moistureFieldSelectors("stock", "stock-moisture"));
    expect(document.activeElement?.id).toBe("stock-moisture-layer-a");
    document.body.innerHTML = '<input id="stock-moisture" />';
    focusMoistureField(moistureFieldSelectors("stock", "stock-moisture", "gone"));
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
    expect(diagram.nodes.map((node) => node.name)).toEqual(["Pure bin", "Extra water at 50%", "Stays after saving", "Lost mass"]);
    expect(diagram.nodes[1].caption).toBe("60 kg");
    expect(diagram.nodes[2].caption).toBe("≈ 110 kg at 50%");
    expect(diagram.nodes[0].caption).toBe("≈ 100 kg at 20%");
    // Every link joins two drawn segments.
    const ids = new Set(diagram.nodes.flatMap((node) => node.segments.map((segment) => segment.id)));
    for (const link of diagram.links) expect(ids.has(link.from) && ids.has(link.to)).toBe(true);
  });

  it("counts a blend's ingredient solids as solids, not water", () => {
    const diagram = reestimateFlow(reestimateFigures(blend)!, "Blend bin", "delivery");
    expect(diagram.nodes[0].caption).toBe("≈ 100 kg at 20%");
    expect(diagram.nodes.find((node) => node.id === "removed")!.caption).toBe("50 kg at 50%");
    expect(diagram.nodes.find((node) => node.id === "stays")!.caption).toBe("≈ 110 kg at 50%");
    const kg = (id: string) => diagram.nodes.flatMap((node) => node.segments).find((segment) => segment.id === id)?.kg ?? 0;
    expect(kg("bin-water-removed")).toBe(20);
    expect(kg("bin-dry-removed")).toBe(25);
  });

  it("does not claim one moisture for what stays when only some sub-bins re-estimate", () => {
    const diagram = reestimateFlow(reestimateFigures(split)!, "Split bin", "loss");
    const stays = diagram.nodes.find((node) => node.id === "stays")!;
    expect(stays.name).toBe("Stays");
    expect(stays.caption).toBe("≈ 310 kg");
  });
});
