import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OutputStockPreview as Preview } from "@/types/output-stock";
import { OutputStockPreview } from "./output-stock-preview";

const rain: Preview = {
  basisFingerprint: "basis", storageLocationId: "bin", binName: "Product bin", binCode: "PB-001", formulationName: "Mix", lane: "product",
  beforeDryKg: 1500, afterDryKg: 350, beforeSolidsKg: 1820, afterSolidsKg: 420,
  removedDryKg: 1150, removedWetKg: 2000, estimateMoisturePercent: 30,
  beforeEstimatedWetKg: 2600, afterEstimatedWetKg: 600, discrepancySolidsKg: 0, blockingMessage: null,
  allocations: [
    { layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 900, runs: [{ productionRunId: "r1", code: "Run A", dryMassKg: 900 }] },
    { layerId: "b", code: "Batch B", wetMassKg: null, dryMassKg: 250, runs: [{ productionRunId: "r2", code: "Run B", dryMassKg: 250 }] },
  ],
};

describe("OutputStockPreview", () => {
  it("links application and certification blockers to their records", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, blockingMessage: "Correction blocked", blockers: [
      { entity: "application", id: "app-id", code: "APP-001" },
      { entity: "removal", id: "removal-id", code: "Removal" },
      { entity: "ghgStatement", id: "statement-id", code: "GHG Statement" },
    ] }} />);
    expect(html).toContain('/applications?ids=app-id');
    expect(html).toContain('/certification/removals?removal=removal-id');
    expect(html).toContain('/certification/ghg-statements?statement=statement-id');
  });
  it("shows an unavailable ingredient dry estimate without claiming zero dry solids", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, lane: "ingredient", dryLabel: "dry solids", wetLabel: "wet stock", beforeDryKg: null, afterDryKg: null, removedDryKg: null, beforeSolidsKg: null, afterSolidsKg: null, beforeEstimatedWetKg: 150, afterEstimatedWetKg: 120, beforeAllocations: [], afterAllocations: [], allocations: [] }} />);
    expect(html).toContain("150 kg");
    expect(html).toContain("120 kg");
    expect(html).not.toContain("0 kg dry solids");
    expect(html).not.toContain("NaN");
  });
  it("shows ingredient dry solids and retains the emptied bin on the shared scale", () => {
    const html = renderToStaticMarkup(<OutputStockPreview commonScale={2600} preview={{ ...rain, lane: "ingredient", dryLabel: "dry solids", wetLabel: "wet stock", beforeDryKg: 140, afterDryKg: 0, beforeEstimatedWetKg: 150, afterEstimatedWetKg: 0, removedDryKg: 140, removedWetKg: 150, allocations: [], beforeAllocations: [{ layerId: "ingredient", code: "Compost", wetMassKg: 150, dryMassKg: 140, runs: [] }], afterAllocations: [{ layerId: "ingredient", code: "Compost", wetMassKg: 0, dryMassKg: 0, runs: [] }] }} />);
    expect(html).toContain('140 kg dry solids');
    expect(html).toContain('0 kg wet stock');
    expect(html).not.toContain('dry biochar');
    expect(html.match(/aria-valuemax="2600"/g)).toHaveLength(2);
  });
  it("gives the newly received product a visible batch segment", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, removedDryKg: -90, removedWetKg: -100, beforeAllocations: [], afterAllocations: [{ layerId: "new", code: "New product", wetMassKg: 100, dryMassKg: 90, runs: [] }] }} />);
    expect(html).toContain('100 kg wet added');
    expect(html).toContain('90 kg dry biochar added');
    expect(html).toContain('data-stock-batch="new"');
    expect(html).toContain('background-color:var(--acc-prod)');
  });
  it("renders the rain example with wet first, conserved dry values and a common scale", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={rain} />);
    expect(html.indexOf("2,000 kg wet removed")).toBeLessThan(html.indexOf("1,150 kg dry biochar removed"));
    expect(html).toContain("2,600 kg wet estimate");
    expect(html).toContain("600 kg wet estimate");
    expect(html).toContain("350 kg");
    expect(html.match(/aria-valuemax="2600"/g)).toHaveLength(2);
    expect(html).toContain("height:100%");
    expect(html).toContain("height:23.076923076923077%");
    expect(html).toContain("Source run Run A: 900 kg dry biochar");
    expect(html).toContain("Source run Run B: 250 kg dry biochar");
    expect(html).toContain("do not replace recorded pile measurements");
  });
  it("renders saved layer balances and keeps the depleted batch after loading", () => {
    const beforeAllocations = [
      { ...rain.allocations[0], wetMassKg: 1100 / 0.7 },
      { ...rain.allocations[1], wetMassKg: 720 / 0.7, dryMassKg: 600 },
    ];
    const afterAllocations = [
      { ...rain.allocations[0], wetMassKg: 0, dryMassKg: 0 },
      { ...rain.allocations[1], wetMassKg: 600, dryMassKg: 350 },
    ];
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, beforeAllocations, afterAllocations }} moreInfo={<button>More info</button>} />);
    expect(html.match(/data-stock-batch="a"/g)).toHaveLength(2);
    expect(html).toContain("Batch A: 0 kg dry biochar");
    expect(html).toContain("Batch B: 350 kg dry biochar");
    expect(html.match(/PB-001/g)).toHaveLength(3);
    expect(html.match(/More info/g)).toHaveLength(2);
    expect(html).toContain('width:0%;background-color:var(--acc-prod)');
    expect(html).toContain('width:23.076923076923077%;background-color:var(--acc-infra)');
  });
  it("uses an explicit dry scale when a zero count has no moisture", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, removedWetKg: null, estimateMoisturePercent: null, beforeEstimatedWetKg: null, afterEstimatedWetKg: null }} />);
    expect(html).toContain("dry biochar scale");
    expect(html).toContain("No moisture measurement was entered");
    expect(html).not.toContain("Not recorded wet removed");
    expect(html).not.toContain("At Not recorded");
  });
  it("keeps blockers and source breakdown visible", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, blockingMessage: "Insufficient dry stock" }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Insufficient dry stock");
    expect(html).toContain("Batch breakdown");
  });
  it("explains excess counts without claiming new stock", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, discrepancySolidsKg: 80, removedDryKg: 0, allocations: [] }} />);
    expect(html).toContain("This discrepancy adds no stock.");
    expect(html).toContain("No dry biochar removed.");
  });
});
