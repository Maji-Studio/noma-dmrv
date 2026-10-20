// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import type { OutputStockPreview as Preview } from "@/types/output-stock";
import { OutputStockAvailability, OutputStockPreview, type StockEntry } from "./output-stock-preview";

afterEach(cleanup);

/** Text as the operator reads it: elements are separated by a space. */
function readable(node: Node): string {
  const walk = (current: Node): string => current.nodeType === Node.TEXT_NODE
    ? current.textContent ?? ""
    : [...current.childNodes].map(walk).join(" ");
  return walk(node).replace(/\s+/g, " ");
}

/** Opens the block's (i) and returns the panel's text. */
async function openInfo(name: RegExp | string): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name }));
  return readable(await screen.findByRole("dialog"));
}

const rain: Preview = {
  expectedProductVersions: {},
  basisFingerprint: "basis", storageLocationId: "bin", binName: "Product bin", binCode: "PB-001", formulationName: "Mix", lane: "product",
  beforeDryKg: 1500, afterDryKg: 350, beforeSolidsKg: 1820, afterSolidsKg: 420,
  removedDryKg: 1150, removedWetKg: 2000, movementMoisturePercent: 30,
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
 * pair and what stays behind the (i).
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

  it("holds the entered figures and the source runs behind the caption's (i)", async () => {
    const html = renderToStaticMarkup(<OutputStockPreview preview={rain} />);
    expect(html).toContain("How product bin is worked out");
    expect(html).not.toContain("Show calculation");
    for (const hidden of ["Wet removed", "Batch breakdown", "Source run Run A"]) expect(html).not.toContain(hidden);

    render(<OutputStockPreview preview={rain} />);
    const panel = await openInfo("How product bin is worked out");
    expect(panel).toContain("Wet removed");
    expect(panel).toContain("2,000 kg");
    expect(panel).toContain("Wet estimate in bin");
    expect(panel).toContain("Batch breakdown");
    expect(panel).toContain("Source run Run A");
    expect(panel).toContain("Source run Run B");
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

  it("keeps the ingredient wet stock pair as the headline and its modal in the action row", async () => {
    const ingredient = { ...rain, lane: "ingredient" as const, dryLabel: "dry solids" as const, wetLabel: "wet stock" as const, beforeDryKg: 140, afterDryKg: 0, beforeEstimatedWetKg: 150, afterEstimatedWetKg: 0, removedDryKg: 140, removedWetKg: 150, allocations: [], beforeAllocations: [], afterAllocations: [] };
    const { container } = render(<OutputStockPreview preview={ingredient} />);
    expect(container.textContent).toContain("Wet stock in bin");
    expect(container.textContent).toContain("More info");
    expect(container.textContent).not.toContain("Dry solids removed");
    // Dry solids stay in the (i); the ingredient lane is tracked wet.
    const panel = await openInfo(/^How .* is worked out$/);
    expect(panel).toContain("Dry solids removed");
    expect(container.textContent).not.toContain("dry biochar");
  });

  it("captions an addition as added and splits the wet mass it received", async () => {
    const added = { ...rain, removedDryKg: -70, removedWetKg: -100, allocations: [], beforeAllocations: [], afterAllocations: [{ layerId: "new", code: "New product", wetMassKg: 100, dryMassKg: 70, runs: [] }] };
    const html = renderToStaticMarkup(<OutputStockPreview preview={added} />);
    expect(html).toContain("100 kg wet mass added");
    expect(html).toContain("Dry solids 70 kg");
    render(<OutputStockPreview preview={added} />);
    expect(await openInfo(/^How .* is worked out$/)).toContain("Dry biochar added");
  });

  it("keeps a blocker visible and its source breakdown behind the (i)", async () => {
    const blocked = { ...rain, blockingMessage: "Insufficient dry stock" };
    const html = renderToStaticMarkup(<OutputStockPreview preview={blocked} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Insufficient dry stock");
    expect(html).not.toContain("Batch breakdown");
    render(<OutputStockPreview preview={blocked} />);
    expect(await openInfo(/^How .* is worked out$/)).toContain("Batch breakdown");
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
  it("leads with the dry stock when no moisture gives a wet estimate, with no before and after", async () => {
    const block = <OutputStockAvailability
      binName="Product bin" dryKg={1150} allocations={rain.allocations} actions={<button>Stock history</button>}
    />;
    const html = renderToStaticMarkup(block);
    expect(html).toContain("Batch A 900 kg");
    expect(html).toContain("Available dry biochar");
    expect(html).toContain("1,150 kg dry biochar");
    expect(html).not.toContain("wet");
    expect(html).toContain("Stock history");
    expect(html).not.toContain("Source run Run A");
    expect(html).not.toMatch(/before|after/i);
    render(block);
    expect(await openInfo("How product bin is worked out")).toContain("Source run Run A");
  });

  it("leads with the wet estimate at its basis and reads the dry stock as a secondary line", () => {
    const { container } = render(<OutputStockAvailability
      binName="Output bin B2" dryKg={2380} wetEstimate={{ kg: 2833.4, basis: "At 16% departure moisture" }} allocations={rain.allocations}
    />);
    const text = readable(container);
    expect(text).toContain("Available wet stock, estimate");
    expect(text).toContain("2,833 kg wet mass");
    expect(text).toContain("2,380 kg dry biochar");
    expect(text).toContain("At 16% departure moisture");
    // The dry line sits under the headline, before the batch bar.
    expect(text.indexOf("2,833 kg wet mass")).toBeLessThan(text.indexOf("2,380 kg dry biochar"));
    expect(text.indexOf("2,380 kg dry biochar")).toBeLessThan(text.indexOf("Batch A"));
  });

  it("states an empty bin as a figure rather than a bar", () => {
    const html = renderToStaticMarkup(<OutputStockAvailability binName="Empty bin" dryKg={0} />);
    expect(html).toContain("0 kg dry biochar");
    expect(html).not.toContain("Batch breakdown");
    expect(html).not.toContain("is worked out");
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
    expectedProductVersions: {},
    basisFingerprint: "basis", storageLocationId: "bin", binName: "Biochar bin", binCode: "BB-001", lane: "biochar",
    beforeDryKg: 350, afterDryKg: 343, beforeSolidsKg: 350, afterSolidsKg: 343,
    removedDryKg: 7, removedWetKg: 10, movementMoisturePercent: 30,
    beforeEstimatedWetKg: 500, afterEstimatedWetKg: 490, discrepancySolidsKg: 0, blockingMessage: null,
    allocations: [{ layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 7, runs: [] }],
    afterAllocations: [
      { layerId: "a", code: "Batch A", wetMassKg: null, dryMassKg: 343, runs: [] },
      { layerId: "b", code: "Batch B", wetMassKg: null, dryMassKg: 0, runs: [] },
    ],
  };

  /** Renders the card; `text` is what is visible without a press, `open` the (i) panel's text. */
  function card(preview: Preview, entry?: StockEntry) {
    const { container } = render(<OutputStockPreview variant="movement" preview={preview} entry={entry} />);
    return {
      container,
      markup: () => container.innerHTML,
      text: () => readable(container),
      open: () => openInfo(/^How .* is worked out$/),
    };
  }

  it("leads with the wet estimate and its entry, then the split bar, then the dry pair as a row", () => {
    const view = card(loss, { kind: "loss", wetMassKg: 10 });
    const text = view.text();
    expect(text).toContain("Wet stock in bin, estimate");
    expect(text).toMatch(/≈ 500\s+490 kg/);
    expect(text).toContain("10 kg wet mass lost at 30% moisture");
    // A biochar bin's dry part is dry biochar itself, so the bar names it.
    expect(text).toMatch(/Dry biochar\s+7 kg/);
    expect(text).toMatch(/Water\s+3 kg/);
    expect(view.markup()).toContain('data-moisture-segment="dry"');
    expect(view.container.querySelectorAll('[role="group"][aria-label="Dry biochar in bin: 350 kg before, 343 kg after"]')).toHaveLength(1);
    expect(text.indexOf("Wet stock in bin")).toBeLessThan(text.search(/Dry biochar\s+7 kg/));
    expect(text.search(/Dry biochar\s+7 kg/)).toBeLessThan(text.indexOf("Dry biochar in bin"));
    // The dry before and after line stays visible without a press. The entered
    // figures are the inputs, not the consequence, so none of them is readable
    // until the (i) is opened.
    expect(text).toContain("343 kg");
    expect(text).not.toContain("Wet removed");
    expect(text).not.toContain("Moisture ");
    expect(text).not.toContain("Batch A");
    expect(text).not.toContain("Show calculation");
    // The split carries no formula or (i) of its own here: the card's (i) is the only one.
    expect(view.container.querySelectorAll("[data-explanation-info]")).toHaveLength(1);
    expect(text).not.toContain("Dry = wet");
  });

  it("names each entry kind in the headline caption", async () => {
    for (const [entry, line] of [
      [{ kind: "correction", wetMassKg: 10 }, "10 kg wet mass removed at 30% moisture"],
      [{ kind: "delivery", wetMassKg: 10 }, "10 kg wet mass loaded at 30% moisture"],
    ] as const) {
      const view = card(loss, entry);
      expect(view.text()).toContain(line);
      cleanup();
    }
    const count = card({ ...loss, removedWetKg: null, removedDryKg: 0, afterDryKg: 350, allocations: [] }, { kind: "count", wetMassKg: 2650 });
    expect(count.text()).toContain("Counted 2,650 kg wet mass at 30% moisture");
    expect(await count.open()).toContain("Counted wet mass");
  });

  it("holds the entered figures and the FIFO draw behind the (i), zero layers hidden", async () => {
    const opened = await card(loss).open();
    expect(opened).toContain("Wet removed");
    expect(opened).toContain("10 kg");
    expect(opened).toContain("Dry biochar removed");
    expect(opened).toContain("Moisture");
    expect(opened).toContain("30%");
    // The balances are on the block already; the rows add only the entry.
    expect(opened).not.toContain("Wet estimate in bin");
    expect(opened).toContain("Batch A");
    expect(opened).not.toContain("Batch B");
  });

  it("falls back to the dry pair as the headline when no moisture gives a wet estimate", async () => {
    const view = card({ ...loss, removedWetKg: null, movementMoisturePercent: null, beforeEstimatedWetKg: null, afterEstimatedWetKg: null }, { kind: "count", wetMassKg: 0 });
    expect(view.markup()).not.toContain("data-moisture-segment");
    expect(view.text()).not.toContain("Wet stock in bin");
    expect(view.text()).not.toContain("Not available");
    expect(view.text()).toContain("Dry biochar in bin");
    expect(view.text()).toContain("343 kg");
    expect(view.text()).toContain("Counted 0 kg wet mass");
    const opened = await view.open();
    expect(opened).toContain("Dry biochar removed");
    expect(opened).not.toContain("Moisture");
  });

  it("explains a drying only count below the estimated wet stock above an unchanged pair", async () => {
    const view = card({ ...loss, removedWetKg: null, removedDryKg: 0, beforeDryKg: 343, afterDryKg: 343,
      beforeEstimatedWetKg: 460, afterEstimatedWetKg: 428.75, movementMoisturePercent: 20, allocations: [] });
    const text = view.text();
    expect(text).toContain("Drying alone does not remove dry biochar.");
    expect(text).toContain("Unchanged");
    expect(view.markup()).toContain('data-moisture-segment="dry"');
    expect(text).toMatch(/≈ 460\s+429 kg/);
    expect(text.indexOf("Drying alone")).toBeLessThan(text.indexOf("Dry biochar in bin"));
    // A count draws no layer, so the (i) falls back to what the bin keeps.
    const opened = await view.open();
    expect(opened).toContain("Batch A");
    expect(opened).not.toContain("Batch B");
  });

  it.each([["matches", 428.75], ["exceeds", 420], ["has no estimate for", null]])("says nothing about drying when the count %s the estimated wet stock", (_case, beforeEstimatedWetKg) => {
    const view = card({ ...loss, removedWetKg: null, removedDryKg: 0, beforeDryKg: 343, afterDryKg: 343,
      beforeEstimatedWetKg, afterEstimatedWetKg: 428.75, movementMoisturePercent: 20, allocations: [] });
    expect(view.text()).not.toContain("Drying alone");
  });

  it("shows what a reading resets as an estimate block, an arrow and a reading block", () => {
    const moistureReset = { layerCodes: ["B-0419"], before: { moisturePercent: 35, wetKg: 675.48 }, after: { moisturePercent: 33, wetKg: 655.32 } };
    expect(card({ ...loss, moistureReset }).text()).toMatch(/Moisture updated ·\s*B-0419\s*Estimate\s*35(\.0)?%\s*675 kg wet mass\s*Reading\s*33(\.0)?%\s*655 kg wet mass/);
    cleanup();
    expect(card({ ...loss, moistureReset, blockingMessage: "Loss exceeds the dry biochar in this bin." }).text()).not.toContain("Moisture updated");
  });

  it("shows a refused movement at its current balance, without an after figure or a verb", () => {
    const text = card({ ...loss, removedDryKg: 0, afterDryKg: 350, afterEstimatedWetKg: 500, allocations: [],
      blockingMessage: "Loss exceeds the dry biochar in this bin." }).text();
    // Before is ≈ 500 kg wet and 350 kg dry; the refused after figures never show.
    expect(text).toContain("≈ 500 kg");
    expect(text).toContain("10 kg wet mass at 30% moisture");
    expect(text).not.toMatch(/lost at|≈ 500\s+500 kg|350 kg\s+350 kg/);
    expect(text).not.toContain("Unchanged");
  });

  it("does not call a refused loss a drying only count", () => {
    // The planner returns nothing removed for a loss it refuses, with the
    // entered wet mass still attached; the blocking message is the sentence.
    const text = card({ ...loss, removedDryKg: 0, afterDryKg: 350, afterEstimatedWetKg: 500, allocations: [],
      blockingMessage: "Loss exceeds the dry biochar in this bin." }).text();
    expect(text).not.toContain("Drying alone");
    expect(text).toContain("Loss exceeds the dry biochar in this bin.");
  });

  it("keeps the bar off a count that exceeds tracked solids", () => {
    const view = card({ ...loss, removedWetKg: null, removedDryKg: 0, discrepancySolidsKg: 80, allocations: [] });
    expect(view.markup()).not.toContain("data-moisture-segment");
    expect(view.text()).toContain("Count exceeds tracked solids");
  });

  it("keeps the ingredient wet stock pair as the headline", async () => {
    const view = card({ ...loss, lane: "ingredient", dryLabel: "dry solids", wetLabel: "wet stock",
      beforeEstimatedWetKg: 150, afterEstimatedWetKg: 140, allocations: [], afterAllocations: [] });
    expect(view.text()).toContain("Wet stock in bin");
    // Ingredient wet stock is tracked, not estimated at the entered moisture.
    expect(view.text()).not.toContain("estimate");
    expect(view.text()).toMatch(/Dry solids\s+7 kg/);
    expect(view.text()).toContain("Dry solids in bin");
    expect(await view.open()).toContain("Dry solids removed");
  });
});
