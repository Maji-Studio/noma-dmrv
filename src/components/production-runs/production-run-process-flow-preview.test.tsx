// @vitest-environment jsdom
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { layoutMassFlow } from "@/components/ui/mass-flow-sankey";
import { processFlowDiagram, ProcessFlowPreview, PROCESS_FLOW_WATER_INFLOW_LABEL } from "./production-run-process-flow-preview";

const run = {
  sourceBinName: "Feedstock July",
  feedstockKg: 100,
  feedstockMoisturePercent: 10,
  feedstockDryKg: 90,
  reactorName: "Reactor 1",
  biocharKg: 50,
  biocharMoisturePercent: 10,
  biocharDryKg: 45,
  destinationBinName: "Biochar July",
};

const FLOW_WIDTH_PX = 560;

afterEach(cleanup);

/** Text as the operator reads it, with the markup and its entities resolved. */
function text(node: ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

describe("ProcessFlowPreview", () => {
  it("draws the run as a mass flow: source bin, reactor, destination bin, then what left the process", () => {
    const rendered = text(<ProcessFlowPreview {...run} />);

    expect(rendered).toContain("Dry yield 50%");
    expect(rendered).toContain("Feedstock July 100 kg wet mass, 90 kg dry");
    expect(rendered).toContain("Reactor 1");
    expect(rendered).toContain("Biochar July 50 kg wet mass, 45 kg dry");
    expect(rendered).toContain("Water driven off 10 kg");
    expect(rendered).toContain("Conversion loss 45 kg");
    expect(rendered).toContain(`${PROCESS_FLOW_WATER_INFLOW_LABEL} 5 kg`);
    expect(rendered.indexOf("Feedstock July")).toBeLessThan(rendered.indexOf("Reactor 1"));
    expect(rendered.indexOf("Reactor 1")).toBeLessThan(rendered.indexOf("Biochar July"));
  });

  it("drives the water off before the reactor and the conversion loss out of it, on the dry basis", () => {
    const diagram = processFlowDiagram(run);

    expect(diagram?.links).toEqual([
      { from: "feed-dry", to: "reactor" },
      { from: "made", to: "biochar-dry" },
    ]);
    expect(diagram?.exits?.map((exit) => [exit.from, exit.name])).toEqual([
      ["feed-water", "Water driven off"],
      ["loss", "Conversion loss"],
    ]);
    const masses = Object.fromEntries(diagram!.nodes.flatMap((node) => node.segments.map((segment) => [segment.id, segment.kg])));
    expect(masses).toEqual({ "feed-water": 10, "feed-dry": 90, loss: 45, made: 45, "biochar-dry": 45, "biochar-water": 5 });
  });

  it("balances wet feedstock plus water taken up against water driven off, conversion loss and wet biochar", () => {
    const balancedRun = { ...run, feedstockKg: 500, feedstockMoisturePercent: 20, feedstockDryKg: 400, biocharKg: 300, biocharMoisturePercent: 2.5, biocharDryKg: 292.5 };
    const diagram = processFlowDiagram(balancedRun)!;
    const rendered = text(<ProcessFlowPreview {...balancedRun} />);
    const masses = Object.fromEntries(diagram.nodes.flatMap((node) => node.segments.map((segment) => [segment.id, segment.kg])));
    const waterIn = diagram.inflows!.reduce((total, inflow) => total + masses[inflow.to], 0);
    const losses = diagram.exits!.reduce((total, exit) => total + masses[exit.from], 0);

    expect(rendered).toContain("500 kg wet mass, 400 kg dry");
    expect(rendered).toContain("300 kg wet mass, 292.5 kg dry");
    expect(rendered).toContain("Water driven off 100 kg");
    expect(rendered).toContain("Conversion loss 107.5 kg");
    expect(rendered).toContain(`${PROCESS_FLOW_WATER_INFLOW_LABEL} 7.5 kg`);
    expect(waterIn).toBe(7.5);
    expect(balancedRun.feedstockKg + waterIn).toBe(losses + balancedRun.biocharKg);
    expect(diagram.inflows).toEqual([{ to: "biochar-water", name: PROCESS_FLOW_WATER_INFLOW_LABEL, caption: "7.5 kg" }]);
    expect(diagram.nodes[2].segments.find((segment) => segment.id === "biochar-water")?.kind).toBe("addedWater");
    expect(renderToStaticMarkup(<ProcessFlowPreview {...balancedRun} />)).toContain("var(--color-moisture-added-water)");
  });

  it.each([0, null])("hides the inflow when dry equals wet, with moisture %s", (biocharMoisturePercent) => {
    const dryRun = { ...run, biocharDryKg: run.biocharKg, biocharMoisturePercent };
    const diagram = processFlowDiagram(dryRun)!;

    expect(diagram.inflows).toEqual([]);
    expect(text(<ProcessFlowPreview {...dryRun} />)).not.toContain(PROCESS_FLOW_WATER_INFLOW_LABEL);
    expect(layoutMassFlow(diagram, FLOW_WIDTH_PX)!.bands.map((band) => band.key)).not.toContain("inflow->biochar-water");
  });

  it("hides the inflow and bin water segment when the water mass rounds to zero", () => {
    const tinyWaterRun = { ...run, feedstockKg: 500, feedstockDryKg: 400, biocharKg: 300, biocharMoisturePercent: 0.01, biocharDryKg: 299.97 };
    const diagram = processFlowDiagram(tinyWaterRun)!;
    const layout = layoutMassFlow(diagram, FLOW_WIDTH_PX)!;

    expect(diagram.inflows).toEqual([]);
    expect(text(<ProcessFlowPreview {...tinyWaterRun} />)).not.toContain(PROCESS_FLOW_WATER_INFLOW_LABEL);
    expect(layout.bands.map((band) => band.key)).not.toContain("inflow->biochar-water");
    expect(layout.nodes[2].segments.find((segment) => segment.id === "biochar-water")?.h).toBe(0);
    expect(diagram.nodes[2].segments.find((segment) => segment.id === "biochar-dry")?.kg).toBe(tinyWaterRun.biocharDryKg);
  });

  it("keeps the yield arithmetic behind the caption's (i)", async () => {
    const html = renderToStaticMarkup(<ProcessFlowPreview {...run} />);

    expect(html).toContain("About Process flow");
    expect(html).not.toContain("Show calculation");
    expect(html).not.toContain("Dry feedstock in");
    expect(html).not.toContain("biochar out / feedstock in");

    render(<ProcessFlowPreview {...run} />);
    fireEvent.click(screen.getByRole("button", { name: "About Process flow" }));
    expect(await screen.findByText("Dry feedstock in")).toBeTruthy();
    expect(screen.getByText("Dry biochar out")).toBeTruthy();
    expect(screen.getByText("Dry yield = biochar out / feedstock in. 45 kg / 90 kg = 50%.")).toBeTruthy();
  });

  it("shows the yield headline and the flow without any interaction", () => {
    const shown = text(<ProcessFlowPreview {...run} />);
    expect(shown).toContain("Dry yield");
    expect(shown).toContain("50%");
    expect(shown).toContain("Feedstock July");
    expect(shown).toContain("Conversion loss");
    expect(shown).toContain(PROCESS_FLOW_WATER_INFLOW_LABEL);
  });

  it("offers no (i) for the arithmetic until a yield resolves", () => {
    const html = renderToStaticMarkup(<ProcessFlowPreview {...run} biocharKg={null} biocharMoisturePercent={null} biocharDryKg={null} />);
    expect(html).not.toContain("About Process flow");
  });

  it("falls back to a wet flow, with water and conversion loss as one exit, when the output dry mass is unresolved", () => {
    const rendered = text(<ProcessFlowPreview {...run} biocharMoisturePercent={null} biocharDryKg={null} />);

    expect(rendered).toContain("Wet yield 50%");
    expect(rendered).toContain("Feedstock July 100 kg wet mass");
    expect(rendered).toContain("Water and conversion loss 50 kg");
    expect(rendered).not.toContain("Water driven off");
    expect(rendered).not.toContain("kg dry");
    expect(rendered).not.toContain(PROCESS_FLOW_WATER_INFLOW_LABEL);
  });

  it("falls back to a wet flow when the input dry mass is unresolved", () => {
    const rendered = text(<ProcessFlowPreview {...run} feedstockMoisturePercent={null} feedstockDryKg={null} />);

    expect(rendered).toContain("Wet yield 50%");
    expect(rendered).toContain("Water and conversion loss 50 kg");
    expect(rendered).not.toContain("kg dry");
    expect(rendered).not.toContain(PROCESS_FLOW_WATER_INFLOW_LABEL);
  });

  it("names the field to fill at every unpicked stop, and renders nothing before the first one", () => {
    const rendered = text(
      <ProcessFlowPreview {...run} sourceBinName={null} reactorName={null} destinationBinName="Biochar July" />,
    );

    expect(rendered).toContain("Select source bin");
    expect(rendered).toContain("Select reactor");
    expect(rendered).not.toContain("Select destination bin");
    expect(
      renderToStaticMarkup(<ProcessFlowPreview {...run} sourceBinName={null} reactorName={null} destinationBinName={null} />),
    ).toBe("");
  });

  it("draws nothing to scale until both wet masses are in, and names the ones missing", () => {
    const noOutput = renderToStaticMarkup(<ProcessFlowPreview {...run} biocharKg={null} biocharMoisturePercent={null} biocharDryKg={null} />);
    const neither = text(
      <ProcessFlowPreview {...run} feedstockKg={null} feedstockDryKg={null} biocharKg={null} biocharMoisturePercent={null} biocharDryKg={null} />,
    );

    expect(noOutput).not.toContain("data-mass-flow");
    expect(noOutput).toContain("Record the biochar wet mass to draw the flow.");
    // No yield resolves, so the headline is left out; the line above names what is missing.
    expect(text(<ProcessFlowPreview {...run} biocharKg={null} biocharMoisturePercent={null} biocharDryKg={null} />)).not.toContain("Yield");
    expect(neither).toContain("Record the feedstock wet mass and the biochar wet mass to draw the flow.");
  });
});
