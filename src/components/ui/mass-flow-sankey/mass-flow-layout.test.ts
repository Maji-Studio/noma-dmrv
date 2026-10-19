import { describe, expect, it } from "vitest";
import {
  EXIT_SPAN_SHARE,
  FLOW_HEIGHT_PX,
  bandPath,
  LABEL_HEIGHT_PX,
  LABEL_OFFSET_PX,
  layoutMassFlow,
  MIN_SEGMENT_PX,
  NODE_WIDTH_PX,
  type LaidOutLabel,
  type MassFlowDiagram,
} from "./mass-flow-layout";

const WIDTH = 560;
const BAND_COORDINATE_PAIRS = 8;

function pathCoordinates(path: string): [number, number][] {
  return [...path.matchAll(/([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?),([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
}

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

const runWithInflow: MassFlowDiagram = {
  ...run,
  nodes: run.nodes.map((node) => ({
    ...node,
    segments: node.segments.map((segment) => segment.id === "char-water" ? { ...segment, kind: "addedWater", fill: "var(--color-moisture-added-water)" } : segment),
  })),
  inflows: [{ to: "char-water", name: "Water taken up", caption: "30 kg" }],
};

/** The run with a 40% wet biochar: 4,000 kg in, 1,000 kg wet out, 400 kg of it water taken up. */
const heavyWaterRun: MassFlowDiagram = {
  nodes: [
    { id: "source", column: 0, name: "E2E Feedstock Bin ce57419b", caption: "4,000 kg wet, 3,000 kg dry", segments: [{ id: "water", kg: 1000, kind: "water" }, { id: "dry", kg: 3000, kind: "dry" }] },
    { id: "reactor", column: 1, name: "E2E Seed Reactor ce57419b", segments: [{ id: "loss", kg: 2400, kind: "released" }, { id: "made", kg: 600, kind: "process" }] },
    { id: "bin", column: 2, name: "E2E Biochar Pile ce57419b", caption: "1,000 kg wet, 600 kg dry", segments: [{ id: "char", kg: 600, kind: "dry" }, { id: "char-water", kg: 400, kind: "addedWater" }] },
  ],
  links: [{ from: "dry", to: "reactor" }, { from: "made", to: "char" }],
  exits: [{ from: "water", name: "Water driven off", caption: "1,000 kg" }, { from: "loss", name: "Conversion loss", caption: "2,400 kg" }],
  inflows: [{ to: "char-water", name: "Water taken up", caption: "400 kg" }],
};

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A band's bounds: its curves keep their control points level with their ends, so the points bound it. */
function bandBox(path: string): Box {
  const coordinates = pathCoordinates(path);
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** A label's text box, measured the way `fixedWidth` measures it. */
function labelBox(label: LaidOutLabel): Box {
  const width = Math.min(label.maxWidth, Math.max(fixedWidth(label.name), fixedWidth(label.caption ?? "")));
  const left = label.align === "left" ? label.x : label.x - width;
  return { left, right: left + width, top: label.y, bottom: label.y + LABEL_HEIGHT_PX };
}

/** Boxes overlap when they share area; boxes that only meet along an edge do not. */
function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe("layoutMassFlow", () => {
  it("captures signed SVG coordinate pairs for bounds checks", () => {
    expect(pathCoordinates("M-5,10 L20,-7 M+.5,-.25 L1e-3,-2E+2")).toEqual([[-5, 10], [20, -7], [0.5, -0.25], [0.001, -200]]);
  });

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

  it("keeps minimum-height bands that pool into one segment inside it", () => {
    const pooled: MassFlowDiagram = {
      nodes: [
        { id: "char", column: 0, name: "Biochar", segments: [{ id: "char-water", kg: 1, kind: "water" }, { id: "char-dry", kg: 999, kind: "dry" }] },
        { id: "blend", column: 0, name: "Ingredient", segments: [{ id: "blend-water", kg: 1, kind: "water" }, { id: "blend-solids", kg: 999, kind: "solids" }] },
        { id: "product", column: 1, name: "Product", segments: [{ id: "out-water", kg: 2, kind: "water" }, { id: "out-dry", kg: 999, kind: "dry" }, { id: "out-solids", kg: 999, kind: "solids" }] },
      ],
      links: [
        { from: "char-water", to: "out-water" },
        { from: "char-dry", to: "out-dry" },
        { from: "blend-water", to: "out-water" },
        { from: "blend-solids", to: "out-solids" },
      ],
    };
    const layout = layoutMassFlow(pooled, WIDTH)!;
    const water = layout.nodes[2].segments.find((segment) => segment.id === "out-water")!;
    expect(water.h).toBe(MIN_SEGMENT_PX);

    for (const key of ["char-water->out-water", "blend-water->out-water"]) {
      const path = layout.bands.find((band) => band.key === key)!.path;
      // The band's end edge: "L x1,bottom" after the curve that ends at "x1,top".
      const [, top, bottom] = /C[^C]* [\d.]+,([\d.]+) L[\d.]+,([\d.]+)/.exec(path)!.map(Number);
      expect(top).toBeGreaterThanOrEqual(water.y);
      expect(bottom).toBeLessThanOrEqual(water.y + water.h + 1e-9);
    }
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

  it("runs an inflow in from the left under the arriving band, rising into its whole segment", () => {
    const layout = layoutMassFlow(runWithInflow, WIDTH)!;
    const [, reactor, bin] = layout.nodes;
    const water = bin.segments.find((segment) => segment.id === "char-water")!;
    const band = layout.bands.find((candidate) => candidate.key === "inflow->char-water")!;
    const label = layout.labels.find((candidate) => candidate.key === "char-water-inflow")!;
    const [startX, startY] = pathCoordinates(band.path)[0];

    expect(band).toMatchObject({ kind: "addedWater", fill: "var(--color-moisture-added-water)", fade: { x0: bin.x, x1: startX } });
    expect(startX).toBeGreaterThan(reactor.x + NODE_WIDTH_PX);
    expect(startX).toBeLessThan(bin.x);
    // It starts below its segment and rises into it, so air shows under the band above.
    expect(startY).toBeGreaterThan(water.y);
    expect(band.path).toBe(bandPath(startX, startY, bin.x, water.y, water.h));
    // Its label hangs under the faded far end, as an exit's sits above its own.
    expect(label).toMatchObject({ name: "Water taken up", caption: "30 kg", align: "left", x: startX, figure: true });
    expect(label.y).toBeGreaterThan(startY + water.h);
    expect(layout.height).toBeGreaterThanOrEqual(label.y + LABEL_HEIGHT_PX);
  });

  it("starts an inflow past the upstream stop label in its rows, so that label keeps its place", () => {
    const layout = layoutMassFlow(heavyWaterRun, WIDTH, fixedWidth)!;
    const reactor = layout.nodes.find((node) => node.id === "reactor")!;
    const reactorLabel = layout.labels.find((label) => label.key === "reactor")!;
    const [startX] = pathCoordinates(layout.bands.find((band) => band.key === "inflow->char-water")!.path)[0];

    expect(reactorLabel.y).toBeCloseTo(reactor.y + reactor.h + LABEL_OFFSET_PX);
    expect(startX).toBeGreaterThan(labelBox(reactorLabel).right);
  });

  it("keeps an inflow's full span when shortening it would not leave room, and steps the stop labels clear", () => {
    const narrow = 303;
    const layout = layoutMassFlow(heavyWaterRun, narrow, fixedWidth)!;
    const bin = layout.nodes.find((node) => node.id === "bin")!;
    const band = bandBox(layout.bands.find((candidate) => candidate.key === "inflow->char-water")!.path);
    const inflowLabel = labelBox(layout.labels.find((label) => label.key === "char-water-inflow")!);

    expect(band.left).toBeCloseTo(bin.x - narrow * EXIT_SPAN_SHARE);
    for (const key of ["reactor", "bin"]) {
      expect(layout.labels.find((label) => label.key === key)!.y).toBeGreaterThanOrEqual(inflowLabel.bottom);
    }
  });

  it("skips inflows into missing, zero and earlier-column segments, but keeps tiny inflows visible", () => {
    const layout = layoutMassFlow({
      nodes: [
        { id: "source", column: 0, name: "Source", segments: [{ id: "early", kg: 10, kind: "addedWater" }] },
        { id: "bin", column: 1, name: "Biochar", segments: [{ id: "dry", kg: 1000, kind: "dry" }, { id: "tiny", kg: 0.1, kind: "addedWater" }, { id: "zero", kg: 0, kind: "addedWater" }] },
      ],
      links: [],
      inflows: ["tiny", "zero", "missing", "early"].map((to) => ({ to, name: "Water in", caption: "Water mass" })),
    }, WIDTH)!;

    expect(layout.bands.map((band) => band.key)).toEqual(["inflow->tiny"]);
    expect(layout.labels.filter((label) => label.key.endsWith("-inflow")).map((label) => label.key)).toEqual(["tiny-inflow"]);
    expect(layout.nodes[1].segments.find((segment) => segment.id === "tiny")?.h).toBe(MIN_SEGMENT_PX);
  });

  it("skips an inflow when the diagram has a single column", () => {
    const layout = layoutMassFlow({
      nodes: [{ id: "bin", column: 0, name: "Biochar", segments: [{ id: "dry", kg: 100, kind: "dry" }, { id: "wet", kg: 10, kind: "addedWater" }] }],
      links: [],
      inflows: [{ to: "wet", name: "Water in", caption: "10 kg" }],
    }, WIDTH)!;

    expect(layout.bands).toEqual([]);
  });

  it.each(
    [375, 303, WIDTH].flatMap((width) => [
      { width, name: "a thin inflow", diagram: runWithInflow },
      { width, name: "a thick inflow", diagram: heavyWaterRun },
    ]),
  )("keeps $name clear of every label, band and node at $width px", ({ width, diagram }) => {
    const layout = layoutMassFlow(diagram, width, fixedWidth)!;
    const inflowBand = layout.bands.find((band) => band.key.startsWith("inflow->"))!;
    const inflowLabel = layout.labels.find((label) => label.key.endsWith("-inflow"))!;
    const inflowBoxes = [bandBox(inflowBand.path), labelBox(inflowLabel)];
    const others = [
      ...layout.labels.filter((label) => label !== inflowLabel).map(labelBox),
      ...layout.bands.filter((band) => band !== inflowBand).map((band) => bandBox(band.path)),
      ...layout.nodes.map((node) => ({ left: node.x, right: node.x + NODE_WIDTH_PX, top: node.y, bottom: node.y + node.h })),
    ];

    for (const inflow of inflowBoxes) {
      for (const other of others) expect(overlaps(inflow, other)).toBe(false);
    }
    expect(overlaps(bandBox(inflowBand.path), labelBox(inflowLabel))).toBe(false);
  });

  it.each([375, 303])("keeps inflows, nodes and labels inside a %spx width and labels apart", (width) => {
    const layout = layoutMassFlow(runWithInflow, width, fixedWidth)!;

    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + NODE_WIDTH_PX).toBeLessThanOrEqual(width);
    }
    for (const band of layout.bands) {
      const coordinates = pathCoordinates(band.path);
      expect(coordinates).toHaveLength(BAND_COORDINATE_PAIRS);
      for (const [x, y] of coordinates) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(layout.height);
      }
    }
    for (const [index, label] of layout.labels.entries()) {
      const left = label.align === "left" ? label.x : label.x - label.maxWidth;
      const right = label.align === "left" ? label.x + label.maxWidth : label.x;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(width);
      expect(label.y + LABEL_HEIGHT_PX).toBeLessThanOrEqual(layout.height);
      for (const other of layout.labels.slice(index + 1)) {
        expect(overlaps(labelBox(label), labelBox(other))).toBe(false);
      }
    }
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
