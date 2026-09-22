import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OutputStockPreview as Preview } from "@/types/output-stock";

// The card title's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have; the hint's copy is not what these tests assert.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import { OutputStockPreview } from "./output-stock-preview";

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

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
    expect(html).toContain("Source run Run A");
    expect(html).toContain("Source run Run B");
    expect(html).toContain("900 kg");
    expect(html).toContain("250 kg");
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
    // An empty draw drops the heading instead of printing "no dry biochar
    // removed" under it: the zero is already on the card.
    expect(html).not.toContain("Batch breakdown");
  });
});

/**
 * The movement card, which is the only thing the form surfaces render.
 *
 * Read top to bottom the card has to answer what was entered, what the bin holds
 * and how that was reached, with the third answer collapsed. The assertions here
 * are about that order and that boundary, not about the split bar's own
 * arithmetic, which `MoistureSplit` owns.
 */
describe("StockMovementCard", () => {
  const loss: Preview = {
    basisFingerprint: "basis", storageLocationId: "bin", binName: "Biochar bin", binCode: "BB-001", lane: "biochar",
    beforeDryKg: 350, afterDryKg: 343, beforeSolidsKg: 350, afterSolidsKg: 343,
    removedDryKg: 7, removedWetKg: 10, estimateMoisturePercent: 30,
    beforeEstimatedWetKg: 500, afterEstimatedWetKg: 490, discrepancySolidsKg: 0, blockingMessage: null,
    allocations: [{ layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 7, runs: [] }],
    afterAllocations: [
      { layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 343, runs: [] },
      { layerId: "b", code: "Batch B", wetMassKg: null, dryMassKg: 0, runs: [] },
    ],
  };

  function visible(node: ReactTestInstance | string): string {
    return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
  }
  async function render(preview: Preview) {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="stock"><FormDetailControl /><OutputStockPreview followFormDetail preview={preview} /></FormDetailProvider>); });
    // The card is the Detailed presentation of this surface; Simple keeps only
    // the notices, which the boundary suite covers.
    await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
    const disclosure = () => renderer.root.findAllByType("button").find(node => node.props["aria-controls"]);
    return {
      renderer,
      markup: () => JSON.stringify(renderer.toJSON()),
      text: () => visible(renderer.root),
      open: async () => act(async () => disclosure()!.props.onClick()),
      disclosure,
    };
  }

  it("draws the entered wet mass as a split bar above the dry balance pair", async () => {
    const card = await render(loss);
    const text = card.text();
    expect(text).toContain("What you entered");
    expect(text).toMatch(/Dry solids\s+7 kg/);
    expect(text).toMatch(/Water\s+3 kg/);
    expect(card.markup()).toContain('"data-moisture-segment":"dry"');
    expect(text).toContain("Dry biochar in bin");
    expect(text).toContain("350 kg");
    expect(text).toContain("343 kg");
    expect(text.indexOf("What you entered")).toBeLessThan(text.indexOf("Dry biochar in bin"));
    // The entered figures are the inputs, not the consequence, so none of them
    // is readable until the disclosure is opened.
    expect(text).not.toContain("Wet removed");
    expect(text).not.toContain("Moisture");
    expect(text).not.toContain("Batch A");
    await act(async () => card.renderer.unmount());
  });

  it("holds the entered figures and the FIFO draw behind Show calculation, zero layers hidden", async () => {
    const card = await render(loss);
    await card.open();
    const opened = card.text();
    expect(opened).toContain("Wet removed");
    expect(opened).toContain("10 kg");
    expect(opened).toContain("Dry biochar removed");
    expect(opened).toContain("Moisture");
    expect(opened).toContain("30%");
    expect(opened).toContain("Wet estimate in bin");
    expect(opened).toContain("490 kg");
    expect(opened).toContain("Batch A");
    expect(opened).not.toContain("Batch B");
    await act(async () => card.renderer.unmount());
  });

  it("shows the pair alone when a dry only entry has no wet mass to split", async () => {
    const card = await render({ ...loss, removedWetKg: null, estimateMoisturePercent: null, beforeEstimatedWetKg: null, afterEstimatedWetKg: null });
    expect(card.text()).not.toContain("What you entered");
    expect(card.markup()).not.toContain("data-moisture-segment");
    expect(card.text()).toContain("Dry biochar in bin");
    expect(card.text()).toContain("343 kg");
    await card.open();
    expect(card.text()).toContain("Dry biochar removed");
    expect(card.text()).not.toContain("Moisture");
    await act(async () => card.renderer.unmount());
  });

  it("explains a drying only count above an unchanged pair", async () => {
    const card = await render({ ...loss, removedWetKg: null, removedDryKg: 0, beforeDryKg: 343, afterDryKg: 343,
      beforeEstimatedWetKg: 420, afterEstimatedWetKg: 428.75, estimateMoisturePercent: 20, allocations: [] });
    const text = card.text();
    expect(text).toContain("Drying alone does not remove dry biochar.");
    expect(text).toContain("Unchanged");
    expect(card.markup()).toContain('"data-moisture-segment":"dry"');
    expect(text.indexOf("Drying alone")).toBeLessThan(text.indexOf("Dry biochar in bin"));
    // A count draws no layer, so the disclosure falls back to what the bin keeps.
    await card.open();
    expect(card.text()).toContain("Batch A");
    expect(card.text()).not.toContain("Batch B");
    await act(async () => card.renderer.unmount());
  });

  it("keeps the bar off a count that exceeds tracked solids", async () => {
    const card = await render({ ...loss, removedWetKg: null, removedDryKg: 0, discrepancySolidsKg: 80, allocations: [] });
    expect(card.text()).not.toContain("What you entered");
    expect(card.text()).toContain("Count exceeds tracked solids");
    await act(async () => card.renderer.unmount());
  });

  it("keeps the ingredient wet stock pair as the headline", async () => {
    const card = await render({ ...loss, lane: "ingredient", dryLabel: "dry solids", wetLabel: "wet stock",
      beforeEstimatedWetKg: 150, afterEstimatedWetKg: 140, allocations: [], afterAllocations: [] });
    expect(card.text()).toContain("Wet stock in bin");
    expect(card.text()).toMatch(/Dry solids\s+7 kg/);
    await card.open();
    expect(card.text()).toContain("Dry solids removed");
    expect(card.text()).toContain("Dry solids in bin");
    await act(async () => card.renderer.unmount());
  });
});
