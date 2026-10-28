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
import { flowColumnId, flowGroupId, flowLighting, layoutFlow } from "./flow-layout";
import { reachableNodeIds } from "./use-chain-graph";

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
      massFooting: null,
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
    // One record per column: "1 record" adds nothing.
    expect(layout.nodes.filter((node) => node.type === "flowColumn").every((node) => node.data.showCount === false)).toBe(true);
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
        massFooting: "wet",
        kgLabel: "100 kg",
      }),
    );

    it("collapses a column above the threshold into one group with merged edges", () => {
      const layout = layoutFlow([...intakes, ...runs], edges, noneExpanded);
      const group = layout.nodes.find((node) => node.id === flowGroupId("feedstock"));

      expect(group?.type).toBe("flowGroup");
      // The group says the count; the header does not repeat it.
      expect(layout.nodes.find((node) => node.id === flowColumnId("feedstock"))?.data.showCount).toBe(false);
      expect(layout.nodes.find((node) => node.id === flowColumnId("productionRun"))?.data.showCount).toBe(true);
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
      expect(header?.data.showCount).toBe(true);
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

describe("merged group edges", () => {
  const products = Array.from({ length: FLOW_GROUP_THRESHOLD + 1 }, (_, index) =>
    record("biocharProduct", `biochar-product:${index}`, `BP-${index}`),
  );
  const delivery = record("delivery", "delivery:1");

  it("sums wet and dry independently and drops the share mass across dry and wet footing", () => {
    // Allocation edges carry dry kg, or wet kg when dry is unknown.
    const edges = products.map((product, index) =>
      link(product.id, "delivery:1", index === 0
        ? { mass: 80, unit: "kg", massFooting: "dry", wetKg: 100, dryKg: 80 }
        : { mass: 100, unit: "kg", massFooting: "wet", wetKg: 100, dryKg: null }),
    );
    const layout = layoutFlow([...products, delivery], edges, noneExpanded);
    const data = layout.edges[0]!.data as ChainEdgeBuildData;

    expect(layout.edges).toHaveLength(1);
    expect(data.mass).toBeNull();
    expect(data.wetKg).toBe(products.length * 100);
    expect(data.dryKg).toBeNull();
    expect(data.kgLabel).toMatch(/^Wet: 1,300 kg/);
    expect(data.kgLabel).not.toContain("1,280");
    expect(data.mixedMass).toBe(true);
  });

  it("sums dry mass when every member is on a dry footing", () => {
    const edges = products.map((product) =>
      link(product.id, "delivery:1", { mass: 50, unit: "kg", massFooting: "dry", wetKg: 100, dryKg: 50 }),
    );
    const data = layoutFlow([...products, delivery], edges, noneExpanded).edges[0]!.data as ChainEdgeBuildData;

    expect(data.mass).toBe(products.length * 50);
    expect(data.mixedMass).toBe(false);
    expect(data.pctLabel).toBe("100%");
  });

  it("shows no % on a fan that holds a merge of applied and recorded mass", () => {
    const order = record("order", "order:1");
    const edges = [
      ...products.map((product, index) =>
        link(product.id, "delivery:1", {
          mass: 100,
          unit: "kg",
          massFooting: "dry",
          massBasis: index === 0 ? "recorded" : "applied",
        }),
      ),
      link("order:1", "delivery:1", { mass: 100, unit: "kg", massFooting: "dry" }),
    ];
    const layout = layoutFlow([...products, order, delivery], edges, noneExpanded);
    const pct = (source: string) =>
      (layout.edges.find((graphEdge) => graphEdge.source === source)!.data as ChainEdgeBuildData).pctLabel;

    expect(pct(flowGroupId("biocharProduct"))).toBeNull();
    // The sibling into the same delivery must not read as the whole inflow.
    expect(pct("order:1")).toBeNull();
    // Applied and recorded mass never sum, so the merge carries no figures.
    const merged = layout.edges.find((graphEdge) => graphEdge.source === flowGroupId("biocharProduct"))!
      .data as ChainEdgeBuildData;
    expect(merged.wetKg).toBeNull();
    expect(merged.dryKg).toBeNull();
    expect(merged.kgLabel).toBeNull();
  });

  it("shows no % on a fan that mixes dry kg with the wet fallback", () => {
    // Collapsed runs feed one product on dry kg and one on the wet fallback.
    const runs = Array.from({ length: FLOW_GROUP_THRESHOLD + 1 }, (_, index) =>
      record("productionRun", `production-run:${index}`, `PR-${index}`),
    );
    const dryProduct = record("biocharProduct", "biochar-product:dry");
    const wetProduct = record("biocharProduct", "biochar-product:wet");
    const edges = runs.flatMap((run) => [
      link(run.id, dryProduct.id, { mass: 40, unit: "kg", massFooting: "dry", wetKg: 100, dryKg: 40 }),
      link(run.id, wetProduct.id, { mass: 100, unit: "kg", massFooting: "wet", wetKg: 100, dryKg: null }),
    ]);
    const layout = layoutFlow([...runs, dryProduct, wetProduct], edges, noneExpanded);

    expect(layout.edges).toHaveLength(2);
    for (const graphEdge of layout.edges) {
      expect((graphEdge.data as ChainEdgeBuildData).pctLabel).toBeNull();
    }
  });
});

describe("flowLighting", () => {
  // Two separate lineages whose products collapse into one group.
  const filler = Array.from({ length: FLOW_GROUP_THRESHOLD - 1 }, (_, index) =>
    record("biocharProduct", `biochar-product:f${index}`, `BP-F${index}`),
  );
  const nodes = [
    record("productionRun", "production-run:1"),
    record("productionRun", "production-run:2"),
    record("biocharProduct", "biochar-product:1"),
    record("biocharProduct", "biochar-product:2"),
    ...filler,
    record("delivery", "delivery:1"),
    record("delivery", "delivery:2"),
  ];
  const edges = [
    link("production-run:1", "biochar-product:1"),
    link("biochar-product:1", "delivery:1"),
    link("production-run:2", "biochar-product:2"),
    link("biochar-product:2", "delivery:2"),
  ];
  const layout = layoutFlow(nodes, edges, noneExpanded);
  const group = flowGroupId("biocharProduct");

  it("never joins two lineages through a collapsed group on hover", () => {
    const lit = flowLighting(layout, edges, "production-run:1", null, reachableNodeIds)!;

    expect(lit.nodeIds).toEqual(new Set(["production-run:1", group, "delivery:1"]));
    expect(lit.edgeIds).toEqual(new Set([`production-run:1->${group}`, `${group}->delivery:1`]));
  });

  it("lights the same records for a selection as for a hover", () => {
    const focus = reachableNodeIds("production-run:1", edges);
    expect(flowLighting(layout, edges, null, focus, reachableNodeIds)).toEqual(
      flowLighting(layout, edges, "production-run:1", null, reachableNodeIds),
    );
  });

  it("lights the union of its members' lineages when a group is hovered", () => {
    const lit = flowLighting(layout, edges, group, null, reachableNodeIds)!;

    expect(lit.nodeIds).toEqual(new Set([
      group,
      "production-run:1",
      "production-run:2",
      "delivery:1",
      "delivery:2",
    ]));
  });
});

describe("flowLighting chips through a collapsed column", () => {
  // F1 feeds only R1; F2 feeds every other run; every run makes P1. The runs
  // collapse, so group → P1 stands for R1 → P1 and twelve edges off F1's lineage.
  const runs = Array.from({ length: FLOW_GROUP_THRESHOLD + 1 }, (_, index) =>
    record("productionRun", `production-run:${index}`, `PR-${index}`),
  );
  const nodes = [record("feedstock", "feedstock:1"), record("feedstock", "feedstock:2"), ...runs, record("biocharProduct", "biochar-product:1")];
  const edges = [
    link("feedstock:1", "production-run:0", { mass: 100, unit: "kg", massFooting: "wet", kgLabel: "100 kg" }),
    ...runs.slice(1).map((run) => link("feedstock:2", run.id, { mass: 100, unit: "kg", massFooting: "wet", kgLabel: "100 kg" })),
    ...runs.map((run) => link(run.id, "biochar-product:1", { mass: 40, unit: "kg", massFooting: "dry", wetKg: 50, dryKg: 40 })),
  ];
  const layout = layoutFlow(nodes, edges, noneExpanded);
  const group = flowGroupId("productionRun");
  const lit = flowLighting(layout, edges, null, reachableNodeIds("feedstock:1", edges), reachableNodeIds)!;

  it("lights the partly covered merged edge but gives it no chip", () => {
    const merged = `${group}->biochar-product:1`;
    expect(lit.edgeIds.has(merged)).toBe(true);
    expect(lit.chipEdgeIds.has(merged)).toBe(false);
  });

  it("keeps the chip on a merged edge whose every member is on the lineage", () => {
    const fromF1 = `feedstock:1->${group}`;
    expect(lit.edgeIds.has(fromF1)).toBe(true);
    expect(lit.chipEdgeIds.has(fromF1)).toBe(true);
    expect(lit.edgeIds.has(`feedstock:2->${group}`)).toBe(false);
  });
});

