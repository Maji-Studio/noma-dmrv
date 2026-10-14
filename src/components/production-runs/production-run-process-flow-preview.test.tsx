import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The block's InfoHint is a Base UI tooltip, which needs a DOM this node
// environment does not have; the hint's copy is not what these tests assert.
vi.mock("@/components/ui/tooltip", () => ({ InfoHint: () => null }));
import { FormDetailControl, FormDetailProvider } from "@/components/forms/form-detail-context";
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

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

/** Text a level leaves on screen: parts behind `hidden` do not count. */
function visible(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.props.hidden ? "" : node.children.map(visible).join(" ");
}

/** Text as the operator reads it, with the markup and its entities resolved. */
function text(node: ReactElement): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
}

describe("ProcessFlowPreview", () => {
  it("draws the run as a mass flow: source bin, reactor, destination bin, then what left the process", () => {
    const rendered = text(<ProcessFlowPreview {...run} />);

    expect(rendered).toContain("Dry yield 50%");
    expect(rendered).toContain("Feedstock July 100 kg wet, 90 kg dry");
    expect(rendered).toContain("Reactor 1");
    expect(rendered).toContain("Biochar July 50 kg wet, 45 kg dry");
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

    expect(rendered).toContain("500 kg wet, 400 kg dry");
    expect(rendered).toContain("300 kg wet, 292.5 kg dry");
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

  it("keeps the yield arithmetic behind the block's own disclosure", () => {
    const html = renderToStaticMarkup(<ProcessFlowPreview {...run} />);

    expect(html).toContain("Show calculation for process flow");
    expect(html).toContain("Dry feedstock in");
    expect(html).toContain("Dry biochar out");
    expect(html).toContain("Dry yield = biochar out / feedstock in. 45 kg / 90 kg = 50%.");
  });

  it("shows the yield headline and the flow at both levels and adds the calculation in Detailed", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FormDetailProvider scope="production-run"><FormDetailControl /><ProcessFlowPreview {...run} /></FormDetailProvider>);
    });
    const simple = visible(renderer.root);
    expect(simple).toContain("Dry yield");
    expect(simple).toContain("50%");
    expect(simple).toContain("Feedstock July");
    expect(simple).toContain("Conversion loss");
    expect(simple).toContain(PROCESS_FLOW_WATER_INFLOW_LABEL);
    expect(simple).not.toContain("Show calculation");

    await act(async () => renderer.root.findAllByType("input").find(node => node.props.value === "detailed")!.props.onChange());
    const detailed = visible(renderer.root);
    expect(detailed).toContain("Feedstock July");
    expect(detailed).toContain(PROCESS_FLOW_WATER_INFLOW_LABEL);
    expect(detailed).toContain("Show calculation");
    await act(async () => renderer.unmount());
  });

  it("falls back to a wet flow, with water and conversion loss as one exit, when the output dry mass is unresolved", () => {
    const rendered = text(<ProcessFlowPreview {...run} biocharMoisturePercent={null} biocharDryKg={null} />);

    expect(rendered).toContain("Wet yield 50%");
    expect(rendered).toContain("Feedstock July 100 kg wet");
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
    // No yield resolves, so the headline names the missing figure, not a basis.
    expect(text(<ProcessFlowPreview {...run} biocharKg={null} biocharMoisturePercent={null} biocharDryKg={null} />)).toContain("Yield Not available");
    expect(neither).toContain("Record the feedstock wet mass and the biochar wet mass to draw the flow.");
  });
});
