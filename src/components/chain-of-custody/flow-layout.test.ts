import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  FLOW_COLUMN_PITCH,
  FLOW_GROUP_THRESHOLD,
  FLOW_NODE_BOX_WIDTH,
  FLOW_NODE_SIZE,
  FLOW_ROW_PITCH,
  LINEAGE_NODE_STYLES,
  type LineageNodeKind,
} from "./chain-constants";
import type { ChainEdgeBuildData } from "./chain-edge-mass";
import type { ChainNodeData } from "./chain-node";
import { flowColumnId, flowGroupId, layoutFlow } from "./flow-layout";

function record(kind: LineageNodeKind, id: string, shortCode = id): Node {
  const style = LINEAGE_NODE_STYLES[kind];
  return {
    id,
    type: "chainNode",
    position: { x: 0, y: 0 },
    data: {
      kind,
      label: style.label,
      code: shortCode,
      shortCode,
      icon: style.icon,
      accent: style.accent,
      accentInk: style.accentInk,
      href: null,
      date: null,
      details: [],
    } satisfies ChainNodeData,
  };
}

function link(source: string, target: string, data: Partial<ChainEdgeBuildData> = {}): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    type: "chainEdge",
    data: {
      variant: "flow",
      inferred: false,
      mass: null,
      unit: null,
      wetKg: null,
      dryKg: null,
      kgLabel: null,
      pctLabel: null,
      massBasis: "applied",
      ...data,
    } satisfies ChainEdgeBuildData,
  };
}

const noneExpanded = { expandedKinds: new Set<LineageNodeKind>() };
const centreY = (layout: ReturnType<typeof layoutFlow>, id: string) =>
  layout.nodes.find((node) => node.id === id)!.position.y + FLOW_NODE_SIZE / 2;
const centreX = (layout: ReturnType<typeof layoutFlow>, id: string) =>
  layout.nodes.find((node) => node.id === id)!.position.x + FLOW_NODE_BOX_WIDTH / 2;

function chain() {
  return {
    nodes: [
      record("application", "application:1", "North field"),
      record("delivery", "delivery:1", "DL-1"),
      record("productionRun", "production-run:1", "PR-1"),
      record("feedstock", "feedstock:1", "FS-1"),
      record("biocharProduct", "biochar-product:1", "BP-1"),
    ],
    edges: [
      link("feedstock:1", "production-run:1", { inferred: true }),
      link("production-run:1", "biochar-product:1"),
      link("biochar-product:1", "delivery:1"),
      link("delivery:1", "application:1"),
    ],
  };
}

describe("layoutFlow", () => {
  it("puts each kind in its own column, in chain order, skipping empty kinds", () => {
    const { nodes, edges } = chain();
    const layout = layoutFlow(nodes, edges, noneExpanded);

    expect(centreX(layout, "feedstock:1")).toBe(0);
    expect(centreX(layout, "production-run:1")).toBe(FLOW_COLUMN_PITCH);
    expect(centreX(layout, "biochar-product:1")).toBe(2 * FLOW_COLUMN_PITCH);
    expect(centreX(layout, "delivery:1")).toBe(3 * FLOW_COLUMN_PITCH);
    expect(centreX(layout, "application:1")).toBe(4 * FLOW_COLUMN_PITCH);
    expect(layout.nodes.filter((node) => node.type === "flowColumn").map((node) => node.id)).toEqual([
      flowColumnId("feedstock"),
      flowColumnId("productionRun"),
      flowColumnId("biocharProduct"),
      flowColumnId("delivery"),
      flowColumnId("application"),
    ]);
  });

  it("draws a one-to-one chain as a straight line", () => {
    const { nodes, edges } = chain();
    const layout = layoutFlow(nodes, edges, noneExpanded);
    const heights = nodes.map((node) => centreY(layout, node.id));

    expect(new Set(heights).size).toBe(1);
    expect(heights.every(Number.isFinite)).toBe(true);
  });

  it("spaces a column one row apart in code order and centres it", () => {
    const nodes = [record("feedstock", "feedstock:b", "FS-10"), record("feedstock", "feedstock:a", "FS-2")];
    const layout = layoutFlow(nodes, [], noneExpanded);

    expect(centreY(layout, "feedstock:a")).toBe(centreY(layout, "feedstock:b") - FLOW_ROW_PITCH);
    expect(centreY(layout, "feedstock:a") + centreY(layout, "feedstock:b")).toBe(0);
  });

  it("places a reactor above the runs it served", () => {
    const nodes = [
      record("feedstock", "feedstock:1"),
      record("reactor", "reactor:1"),
      record("productionRun", "production-run:1"),
    ];
    const edges = [
      link("feedstock:1", "production-run:1"),
      link("reactor:1", "production-run:1", { variant: "equipment" }),
    ];
    const layout = layoutFlow(nodes, edges, noneExpanded);

    expect(centreY(layout, "reactor:1")).toBe(centreY(layout, "production-run:1") - FLOW_ROW_PITCH);
  });

  it("places an order next to the delivery it was shipped on", () => {
    const nodes = [
      record("biocharProduct", "biochar-product:1"),
      record("biocharProduct", "biochar-product:2"),
      record("order", "order:1"),
      record("delivery", "delivery:1"),
      record("delivery", "delivery:2"),
    ];
    const edges = [
      link("biochar-product:1", "delivery:1"),
      link("biochar-product:2", "delivery:2"),
      link("order:1", "delivery:2"),
    ];
    const layout = layoutFlow(nodes, edges, noneExpanded);

    expect(centreY(layout, "order:1")).toBe(centreY(layout, "delivery:2"));
  });

  describe("groups", () => {
    const count = FLOW_GROUP_THRESHOLD + 1;
    const intakes = Array.from({ length: count }, (_, index) =>
      record("feedstock", `feedstock:${index}`, `FS-${index}`),
    );
    const runs = [record("productionRun", "production-run:1"), record("productionRun", "production-run:2")];
    const edges = intakes.map((intake, index) =>
      link(intake.id, index % 2 ? "production-run:1" : "production-run:2", {
        inferred: true,
        mass: 100,
        unit: "kg",
        kgLabel: "100 kg",
      }),
    );

    it("collapses a column above the threshold into one group with merged edges", () => {
      const layout = layoutFlow([...intakes, ...runs], edges, noneExpanded);
      const group = layout.nodes.find((node) => node.id === flowGroupId("feedstock"));

      expect(group?.type).toBe("flowGroup");
      expect(group?.data.title).toBe(`${count} feedstocks`);
      expect(layout.nodes.some((node) => node.id === "feedstock:0")).toBe(false);
      expect(layout.displayIdOf("feedstock:3")).toBe(flowGroupId("feedstock"));
      expect(layout.edges.map((graphEdge) => graphEdge.id).sort()).toEqual([
        `${flowGroupId("feedstock")}->production-run:1`,
        `${flowGroupId("feedstock")}->production-run:2`,
      ]);
      const toRunTwo = layout.edges.find((graphEdge) => graphEdge.target === "production-run:2")!;
      const data = toRunTwo.data as ChainEdgeBuildData;
      expect(data.inferred).toBe(true);
      expect(data.mass).toBe(Math.ceil(count / 2) * 100);
      expect(data.kgLabel).toBe(`${(Math.ceil(count / 2) * 100).toLocaleString()} kg`);
      // A split: the group sends this share of its intakes' wood to run 2.
      expect(data.pctLabel).toBe(`${Math.round((Math.ceil(count / 2) / count) * 100)}%`);
    });

    it("keeps every record when the column is expanded, and offers to collapse it", () => {
      const layout = layoutFlow([...intakes, ...runs], edges, {
        expandedKinds: new Set<LineageNodeKind>(["feedstock"]),
        onCollapse: () => {},
      });

      expect(layout.nodes.filter((node) => node.type === "chainNode" && node.id.startsWith("feedstock:"))).toHaveLength(count);
      const header = layout.nodes.find((node) => node.id === flowColumnId("feedstock"));
      expect(header?.data.count).toBe(count);
      expect(typeof header?.data.onCollapse).toBe("function");
      expect(layout.edges).toHaveLength(count);
    });

    it("leaves a column at the threshold expanded with no collapse action", () => {
      const layout = layoutFlow([...intakes.slice(1), ...runs], edges.slice(1), noneExpanded);

      expect(layout.nodes.some((node) => node.type === "flowGroup")).toBe(false);
      expect(layout.nodes.find((node) => node.id === flowColumnId("feedstock"))?.data.onCollapse).toBeUndefined();
    });

    it("does not mutate the edges it was given", () => {
      const before = JSON.stringify(edges);
      layoutFlow([...intakes, ...runs], edges, noneExpanded);
      expect(JSON.stringify(edges)).toBe(before);
    });
  });
});
