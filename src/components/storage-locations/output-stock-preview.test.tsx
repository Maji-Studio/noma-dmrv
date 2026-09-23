import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OutputStockPreview as Preview } from "@/types/output-stock";

// The block title's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have; the hint's copy is not what these tests assert.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
import { OutputStockAvailability, OutputStockPreview, type StockEntry } from "./output-stock-preview";

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

/**
 * The block every multi-bin surface renders: the product form shows one per
 * affected bin. It is the movement block's shape with the batch bar in place of
 * the moisture split, so the assertions here are about that bar, the headline
 * pair and what stays behind the disclosure.
 */
describe("OutputStockPreview", () => {
  it("draws the drawn batches as one bar, each batch in its own accent", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={rain} />);
    expect(html).toContain("1,150 kg dry biochar removed");
    expect(html).toContain("background:var(--acc-prod)");
    expect(html).toContain("background:var(--acc-infra)");
    // The key line names each batch and its dry mass, in bar order.
    expect(html.indexOf("Batch A 900 kg")).toBeLessThan(html.indexOf("Batch B 250 kg"));
    // The tracked quantity is the headline, before and after.
    expect(html).toContain("Dry biochar in bin");
    expect(html).toContain("1,500 kg");
    expect(html).toContain("350 kg");
  });

  it("holds the entered figures and the source runs behind Show calculation", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={rain} />);
    expect(html).toContain("Show calculation for product bin");
    expect(html).toContain("Wet removed");
    expect(html).toContain("2,000 kg");
    expect(html).toContain("Wet estimate in bin");
    expect(html).toContain("Batch breakdown");
    expect(html).toContain("Source run Run A");
    expect(html).toContain("Source run Run B");
  });

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
    expect(html).toContain("Wet stock in bin");
    expect(html).toContain("150 kg");
    expect(html).toContain("120 kg");
    expect(html).not.toContain("0 kg dry solids");
    expect(html).not.toContain("NaN");
  });

  it("keeps the ingredient wet stock pair as the headline and its modal in the action row", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, lane: "ingredient", dryLabel: "dry solids", wetLabel: "wet stock", beforeDryKg: 140, afterDryKg: 0, beforeEstimatedWetKg: 150, afterEstimatedWetKg: 0, removedDryKg: 140, removedWetKg: 150, allocations: [], beforeAllocations: [], afterAllocations: [] }} />);
    expect(html).toContain("Wet stock in bin");
    expect(html).toContain("More info");
    // Dry solids stay in the disclosure; the ingredient lane is tracked wet.
    expect(html).toContain("Dry solids removed");
    expect(html).not.toContain("dry biochar");
  });

  it("captions an addition as added and splits the wet mass it received", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, removedDryKg: -70, removedWetKg: -100, allocations: [], beforeAllocations: [], afterAllocations: [{ layerId: "new", code: "New product", wetMassKg: 100, dryMassKg: 70, runs: [] }] }} />);
    expect(html).toContain("100 kg wet added");
    expect(html).toContain("Dry solids 70 kg");
    expect(html).toContain("Dry biochar added");
  });

  it("keeps a blocker and its source breakdown visible", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, blockingMessage: "Insufficient dry stock" }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Insufficient dry stock");
    expect(html).toContain("Batch breakdown");
  });

  it("explains excess counts without claiming new stock", () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={{ ...rain, discrepancySolidsKg: 80, removedDryKg: 0, allocations: [] }} />);
    expect(html).toContain("This discrepancy adds no stock.");
    // An empty draw drops the heading instead of printing "no dry biochar
    // removed" under it: the zero is already on the block.
    expect(html).not.toContain("Batch breakdown");
  });
});

describe("OutputStockAvailability", () => {
  it("leads with the dry stock when no moisture gives a wet estimate, with no before and after", () => {
    const html = renderToStaticMarkup(<OutputStockAvailability
      binName="Product bin" dryKg={1150} allocations={rain.allocations} actions={<button>Stock history</button>}
    />);
    expect(html).toContain("Batch A 900 kg");
    expect(html).toContain("Available dry stock");
    expect(html).toContain("1,150 kg dry biochar");
    expect(html).not.toContain("wet");
    expect(html).toContain("Stock history");
    expect(html).toContain("Source run Run A");
    expect(html).not.toMatch(/before|after/i);
  });

  it("leads with the wet estimate at its basis and keeps the dry stock as a Detailed row", async () => {
    let renderer!: ReactTestRenderer;
    const element = <FormDetailProvider scope="availability"><FormDetailControl /><OutputStockAvailability
      binName="Output bin B2" dryKg={2380} wetEstimate={{ kg: 2833.4, basis: "At 16% departure moisture" }} allocations={rain.allocations}
    /></FormDetailProvider>;
    await act(async () => { renderer = create(element); });
    const visible = (node: ReactTestInstance | string): string => typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
    await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
    const text = visible(renderer.root);
    expect(text).toContain("Available wet stock, estimate");
    expect(text).toContain("≈ 2,833 kg wet");
    expect(text).toContain("At 16% departure moisture");
    expect(text).toContain("Available dry stock");
    expect(text).toContain("2,380 kg dry biochar");
    expect(text.indexOf("≈ 2,833 kg wet")).toBeLessThan(text.indexOf("Batch A"));
    expect(text.indexOf("Batch A")).toBeLessThan(text.indexOf("Available dry stock"));
    await act(async () => renderer.unmount());
  });

  it("states an empty bin as a figure rather than a bar", () => {
    const html = renderToStaticMarkup(<OutputStockAvailability binName="Empty bin" dryKg={0} />);
    expect(html).toContain("0 kg dry biochar");
    expect(html).not.toContain("Batch breakdown");
    expect(html).not.toContain("Show calculation");
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
  async function render(preview: Preview, entry?: StockEntry) {
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<FormDetailProvider scope="stock"><FormDetailControl /><OutputStockPreview variant="movement" preview={preview} entry={entry} /></FormDetailProvider>); });
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

  it("leads with the wet estimate and its entry, then the split bar, then the dry pair as a row", async () => {
    const card = await render(loss, { kind: "loss", wetMassKg: 10 });
    const text = card.text();
    expect(text).toContain("Wet stock in bin, estimate");
    expect(text).toMatch(/≈ 500\s+490 kg/);
    expect(text).toContain("10 kg wet lost at 30% moisture");
    expect(text).toMatch(/Dry solids\s+7 kg/);
    expect(text).toMatch(/Water\s+3 kg/);
    expect(card.markup()).toContain('"data-moisture-segment":"dry"');
    expect(card.renderer.root.findAll(node => node.props.role === "group" && node.props["aria-label"] === "Dry biochar in bin: 350 kg before, 343 kg after")).toHaveLength(1);
    expect(text.indexOf("Wet stock in bin")).toBeLessThan(text.indexOf("Dry solids"));
    expect(text.indexOf("Dry solids")).toBeLessThan(text.indexOf("Dry biochar in bin"));
    // The entered figures are the inputs, not the consequence, so none of them
    // is readable until the disclosure is opened.
    expect(text).not.toContain("Wet removed");
    expect(text).not.toContain("Moisture ");
    expect(text).not.toContain("Batch A");
    await act(async () => card.renderer.unmount());
  });

  it("names each entry kind in the headline caption", async () => {
    for (const [entry, line] of [
      [{ kind: "correction", wetMassKg: 10 }, "10 kg wet removed at 30% moisture"],
      [{ kind: "delivery", wetMassKg: 10 }, "10 kg wet loaded at 30% moisture"],
    ] as const) {
      const card = await render(loss, entry);
      expect(card.text()).toContain(line);
      await act(async () => card.renderer.unmount());
    }
    const count = await render({ ...loss, removedWetKg: null, removedDryKg: 0, afterDryKg: 350, allocations: [] }, { kind: "count", wetMassKg: 2650 });
    expect(count.text()).toContain("Counted 2,650 kg wet at 30% moisture");
    await count.open();
    expect(count.text()).toContain("Counted wet mass");
    await act(async () => count.renderer.unmount());
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
    // The balances are on the block already; the rows add only the entry.
    expect(opened).not.toContain("Wet estimate in bin");
    expect(opened).toContain("Batch A");
    expect(opened).not.toContain("Batch B");
    await act(async () => card.renderer.unmount());
  });

  it("falls back to the dry pair as the headline when no moisture gives a wet estimate", async () => {
    const card = await render({ ...loss, removedWetKg: null, estimateMoisturePercent: null, beforeEstimatedWetKg: null, afterEstimatedWetKg: null }, { kind: "count", wetMassKg: 0 });
    expect(card.markup()).not.toContain("data-moisture-segment");
    expect(card.text()).not.toContain("Wet stock in bin");
    expect(card.text()).not.toContain("Not available");
    expect(card.text()).toContain("Dry biochar in bin");
    expect(card.text()).toContain("343 kg");
    expect(card.text()).toContain("Counted 0 kg wet");
    await card.open();
    expect(card.text()).toContain("Dry biochar removed");
    expect(card.text()).not.toContain("Moisture");
    await act(async () => card.renderer.unmount());
  });

  it("explains a drying only count below the recorded wet stock above an unchanged pair", async () => {
    const card = await render({ ...loss, removedWetKg: null, removedDryKg: 0, beforeDryKg: 343, afterDryKg: 343,
      beforeEstimatedWetKg: 428.75, beforeRecordedWetKg: 460, afterEstimatedWetKg: 428.75, estimateMoisturePercent: 20, allocations: [] });
    const text = card.text();
    expect(text).toContain("Drying alone does not remove dry biochar.");
    expect(text).toContain("Unchanged");
    expect(card.markup()).toContain('"data-moisture-segment":"dry"');
    expect(text).toMatch(/≈ 460\s+429 kg/);
    expect(text.indexOf("Drying alone")).toBeLessThan(text.indexOf("Dry biochar in bin"));
    // A count draws no layer, so the disclosure falls back to what the bin keeps.
    await card.open();
    expect(card.text()).toContain("Batch A");
    expect(card.text()).not.toContain("Batch B");
    await act(async () => card.renderer.unmount());
  });

  it.each([["matches", 428.75], ["exceeds", 420], ["has no recorded figure for", null]])("says nothing about drying when the count %s the recorded wet stock", async (_case, beforeRecordedWetKg) => {
    const card = await render({ ...loss, removedWetKg: null, removedDryKg: 0, beforeDryKg: 343, afterDryKg: 343,
      beforeEstimatedWetKg: 428.75, beforeRecordedWetKg, afterEstimatedWetKg: 428.75, estimateMoisturePercent: 20, allocations: [] });
    expect(card.text()).not.toContain("Drying alone");
    await act(async () => card.renderer.unmount());
  });

  it("shows a refused movement at its current balance, without an after figure or a verb", async () => {
    const card = await render({ ...loss, removedDryKg: 0, afterDryKg: 350, afterEstimatedWetKg: 500, allocations: [],
      blockingMessage: "Loss exceeds the dry biochar in this bin." });
    const text = card.text();
    // Before is ≈ 500 kg wet and 350 kg dry; the refused after figures never show.
    expect(text).toContain("≈ 500 kg");
    expect(text).toContain("10 kg wet at 30% moisture");
    expect(text).not.toMatch(/lost at|≈ 500\s+500 kg|350 kg\s+350 kg/);
    expect(text).not.toContain("Unchanged");
    await act(async () => card.renderer.unmount());
  });

  it("does not call a refused loss a drying only count", async () => {
    // The planner returns nothing removed for a loss it refuses, with the
    // entered wet mass still attached; the blocking message is the sentence.
    const card = await render({ ...loss, removedDryKg: 0, afterDryKg: 350, afterEstimatedWetKg: 500, allocations: [],
      blockingMessage: "Loss exceeds the dry biochar in this bin." });
    expect(card.text()).not.toContain("Drying alone");
    expect(card.text()).toContain("Loss exceeds the dry biochar in this bin.");
    await act(async () => card.renderer.unmount());
  });

  it("keeps the bar off a count that exceeds tracked solids", async () => {
    const card = await render({ ...loss, removedWetKg: null, removedDryKg: 0, discrepancySolidsKg: 80, allocations: [] });
    expect(card.markup()).not.toContain("data-moisture-segment");
    expect(card.text()).toContain("Count exceeds tracked solids");
    await act(async () => card.renderer.unmount());
  });

  it("keeps the ingredient wet stock pair as the headline", async () => {
    const card = await render({ ...loss, lane: "ingredient", dryLabel: "dry solids", wetLabel: "wet stock",
      beforeEstimatedWetKg: 150, afterEstimatedWetKg: 140, allocations: [], afterAllocations: [] });
    expect(card.text()).toContain("Wet stock in bin");
    // Ingredient wet stock is tracked, not estimated at the entered moisture.
    expect(card.text()).not.toContain("estimate");
    expect(card.text()).toMatch(/Dry solids\s+7 kg/);
    expect(card.text()).toContain("Dry solids in bin");
    await card.open();
    expect(card.text()).toContain("Dry solids removed");
    await act(async () => card.renderer.unmount());
  });
});
