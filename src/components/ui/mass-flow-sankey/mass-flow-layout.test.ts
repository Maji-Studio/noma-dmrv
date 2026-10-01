import { describe, expect, it } from "vitest";
import {
  FLOW_HEIGHT_PX,
  LABEL_HEIGHT_PX,
  layoutMassFlow,
  MIN_SEGMENT_PX,
  NODE_WIDTH_PX,
  type MassFlowDiagram,
} from "./mass-flow-layout";

const WIDTH = 560;

/** Feedstock 1,000 kg (200 water, 800 dry) through a reactor to 300 kg of biochar. */
const run: MassFlowDiagram = {
  nodes: [
    { id: "source", column: 0, name: "Feedstock", caption: "1,000 kg wet", segments: [{ id: "water", kg: 200, kind: "water" }, { id: "dry", kg: 800, kind: "dry" }] },
    { id: "reactor", column: 1, name: "Reactor", segments: [{ id: "loss", kg: 530, kind: "released" }, { id: "made", kg: 270, kind: "process" }] },
    { id: "bin", column: 2, name: "Biochar", caption: "300 kg wet", segments: [{ id: "char", kg: 270, kind: "dry" }, { id: "char-water", kg: 30, kind: "water" }] },
  ],
  links: [{ from: "dry", to: "reactor" }, { from: "made", to: "char" }],
  exits: [{ from: "water", name: "Water driven off", caption: "200 kg" }, { from: "loss", name: "Conversion loss", caption: "530 kg" }],
};

const fixedWidth = (text: string) => text.length * 6;

describe("layoutMassFlow", () => {
  it("scales every column to one height: the heaviest column fills the flow", () => {
    const layout = layoutMassFlow(run, WIDTH)!;
    const [source, reactor, bin] = layout.nodes;

    expect(source.h).toBeCloseTo(FLOW_HEIGHT_PX);
    expect(reactor.h).toBeCloseTo(FLOW_HEIGHT_PX * 0.8);
    expect(bin.h).toBeCloseTo(FLOW_HEIGHT_PX * 0.3);
  });

  it("spreads the columns across the measured width", () => {
    const layout = layoutMassFlow(run, WIDTH)!;

    expect(layout.width).toBe(WIDTH);
    expect(layout.nodes.map((node) => node.x)).toEqual([0, (WIDTH - NODE_WIDTH_PX) / 2, WIDTH - NODE_WIDTH_PX]);
  });

  it("lines a later node up with the first band arriving at it, so the main band runs straight", () => {
    const layout = layoutMassFlow(run, WIDTH)!;
    const [source, reactor, bin] = layout.nodes;
    const dry = source.segments.find((segment) => segment.id === "dry")!;
    const made = reactor.segments.find((segment) => segment.id === "made")!;

    expect(reactor.y).toBeCloseTo(dry.y);
    expect(bin.y).toBeCloseTo(made.y);
  });

  it("takes a band's colour from the segment it delivers into", () => {
    const bands = layoutMassFlow(run, WIDTH)!.bands;

    expect(bands.find((band) => band.key === "dry->reactor")?.kind).toBe("dry");
    expect(bands.find((band) => band.key === "made->char")?.kind).toBe("dry");
  });

  it("raises each exit to the label row and fades it out, with its label above the end", () => {
    const layout = layoutMassFlow(run, WIDTH)!;
    const exits = layout.bands.filter((band) => band.fade);
    const labels = layout.labels.filter((label) => label.key.endsWith("-exit"));

    expect(exits.map((band) => band.key)).toEqual(["water->exit", "loss->exit"]);
    expect(labels.map((label) => [label.name, label.y, label.align])).toEqual([
      ["Water driven off", 0, "right"],
      ["Conversion loss", 0, "right"],
    ]);
    expect(labels.map((label) => label.x)).toEqual(exits.map((band) => band.fade!.x1));
  });

  it("puts each node's label under it, ending at the edge in the last column", () => {
    const layout = layoutMassFlow(run, WIDTH, fixedWidth)!;
    const label = (key: string) => layout.labels.find((candidate) => candidate.key === key)!;

    expect(label("source")).toMatchObject({ align: "left", x: 0 });
    expect(label("reactor")).toMatchObject({ align: "left", x: (WIDTH - NODE_WIDTH_PX) / 2 });
    expect(label("bin")).toMatchObject({ align: "right", x: WIDTH });
    expect(layout.height).toBeGreaterThanOrEqual(label("bin").y + LABEL_HEIGHT_PX);
  });

  it("steps a label down below one it would overlap", () => {
    const narrow = 200;
    const layout = layoutMassFlow(run, narrow, (text) => text.length * 20)!;
    const [source, reactor] = ["source", "reactor"].map((key) => layout.labels.find((label) => label.key === key)!);

    expect(reactor.y).toBeGreaterThanOrEqual(source.y + LABEL_HEIGHT_PX);
  });

  it("keeps a tiny segment visible and skips a zero one", () => {
    const layout = layoutMassFlow(
      {
        nodes: [{ id: "a", column: 0, name: "A", segments: [{ id: "big", kg: 1000, kind: "dry" }, { id: "tiny", kg: 0.1, kind: "water" }, { id: "none", kg: 0, kind: "addedWater" }] }],
        links: [],
      },
      WIDTH,
    )!;
    const heights = Object.fromEntries(layout.nodes[0].segments.map((segment) => [segment.id, segment.h]));

    expect(heights.tiny).toBe(MIN_SEGMENT_PX);
    expect(heights.none).toBe(0);
  });

  it("draws nothing without mass or width", () => {
    expect(layoutMassFlow({ nodes: [{ id: "a", column: 0, name: "A", segments: [{ id: "s", kg: 0, kind: "dry" }] }], links: [] }, WIDTH)).toBeNull();
    expect(layoutMassFlow(run, 0)).toBeNull();
  });

  it("names a node's parts in a column beside it, level with each part and joined by a leader", () => {
    const product: MassFlowDiagram = {
      nodes: [
        { id: "biochar", column: 0, name: "Biochar", segments: [{ id: "in-dry", kg: 270, kind: "dry" }, { id: "in-water", kg: 30, kind: "water" }] },
        {
          id: "product",
          column: 1,
          name: "Product",
          segments: [
            { id: "dry", kg: 270, kind: "dry", label: { name: "Dry biochar", figure: "270 kg (90%)" } },
            { id: "water", kg: 30, kind: "water", label: { name: "Water", figure: "30 kg (10%)" } },
          ],
        },
      ],
      links: [{ from: "in-dry", to: "dry" }, { from: "in-water", to: "water" }],
    };
    const layout = layoutMassFlow(product, WIDTH, fixedWidth)!;
    const node = layout.nodes.find((candidate) => candidate.id === "product")!;
    const parts = layout.labels.filter((label) => label.key.startsWith("part-"));
    const dry = node.segments[0];

    // The part column is reserved, so the node sits short of the edge.
    expect(node.x + NODE_WIDTH_PX).toBeLessThan(WIDTH);
    expect(parts.map((label) => [label.name, label.caption, label.align, label.figure])).toEqual([
      ["Dry biochar", "270 kg (90%)", "left", true],
      ["Water", "30 kg (10%)", "left", true],
    ]);
    expect(parts[0].x).toBeGreaterThan(node.x + NODE_WIDTH_PX);
    expect(parts[0].y + LABEL_HEIGHT_PX / 2).toBeCloseTo(dry.y + dry.h / 2);
    expect(parts[1].y).toBeGreaterThanOrEqual(parts[0].y + LABEL_HEIGHT_PX);
    expect(layout.leaders.map((leader) => leader.key)).toEqual(["part-dry", "part-water"]);
    // The product's own name moves under the part column instead of ending at the edge.
    expect(layout.labels.find((label) => label.key === "product")).toMatchObject({ align: "left", x: node.x });
  });
});
