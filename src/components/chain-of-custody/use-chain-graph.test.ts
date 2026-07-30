import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import {
  assignEdgeRouteOffsets,
  buildLineageNodes,
  reachableNodeIds,
  useBatchChainGraph,
  useChainGraph,
} from "./use-chain-graph";

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe("reachableNodeIds", () => {
  it("walks connected lineage through direction changes", () => {
    const result = reachableNodeIds("A", [
      edge("A", "B"),
      edge("C", "B"),
      edge("C", "D"),
    ]);

    expect(result).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("keeps an isolated focused node focused", () => {
    expect(reachableNodeIds("solo", [])).toEqual(new Set(["solo"]));
  });
});

function lineage(): ChainOfCustodyData {
  return {
    facility: { id: "facility-1", code: "FAC-1", name: "Moshi" },
    application: {
      id: "application-1",
      code: "AP-1",
      status: "applied",
      applicationDate: new Date("2026-05-20T00:00:00Z"),
      fieldIdentifier: "North field",
      evidenceMethod: "visual",
      gisBoundary: null,
      biocharAppliedTons: 0.85,
      biocharAppliedDryTons: 0.82,
      soilTemperatureC: null,
      href: "/applications",
    },
    delivery: {
      id: "delivery-1",
      code: "DL-1",
      status: "delivered",
      deliveryDate: new Date("2026-05-19T00:00:00Z"),
      deliveredWetMassKg: 850,
      massDryKg: 820,
      href: "/deliveries",
    },
    order: null,
    biocharProduct: null,
    productionRun: {
      id: "run-1",
      code: "PR-1",
      status: "complete",
      date: "2026-05-17",
      biocharStorageName: "Moshi Raw Biochar Curing Pad",
      biocharOutputKg: 850,
      biocharDryMassKg: 820,
      feedstockMassDryKg: 1_500,
      href: "/production-runs",
    },
    reactor: null,
    feedstocks: [],
    warnings: [],
  };
}

describe("biochar mass labels", () => {
  it("shows wet and dry mass together on run, delivery, and application nodes", () => {
    const nodes = buildLineageNodes(lineage());

    expect(
      nodes.find((node) => node.kind === "productionRun")?.details,
    ).toContainEqual({
      label: "Biochar out",
      value: "Wet: 850 kg · Dry: 820 kg",
    });
    expect(nodes.find((node) => node.kind === "productionRun")?.code).toBe(
      "Moshi Raw Biochar Curing Pad",
    );
    expect(nodes.find((node) => node.kind === "delivery")?.details).toContainEqual({
      label: "Biochar delivered",
      value: "Wet: 850 kg · Dry: 820 kg",
    });
    expect(
      nodes.find((node) => node.kind === "application")?.details,
    ).toContainEqual({
      label: "Biochar applied",
      value: "Wet: 850 kg · Dry: 820 kg",
    });
  });

  it("falls back to the production run code when no biochar bin name exists", () => {
    const data = lineage();
    data.productionRun!.biocharStorageName = null;

    expect(
      buildLineageNodes(data).find(
        (node) => node.kind === "productionRun",
      )?.code,
    ).toBe("PR-1");
  });

  it("keeps the wet and dry pair on the application flow edge", () => {
    const { edges } = useChainGraph(lineage());
    const applicationEdge = edges.find(
      (graphEdge) =>
        graphEdge.source === "delivery:delivery-1" &&
        graphEdge.target === "application:application-1",
    );

    expect(applicationEdge?.data?.kgLabel).toBe(
      "Wet: 850 kg · Dry: 820 kg",
    );
  });

  it("renders every mass-weighted source run with its allocated wet and dry mass", () => {
    const data = lineage();
    data.productionRun = null;
    data.reactor = null;
    data.biocharProduct = {
      id: "product-1",
      code: "BP-1",
      status: "available",
      productionDate: new Date("2026-05-18T00:00:00Z"),
      massKg: 850,
      moistureContentPercent: 2,
      formulationName: null,
      linkedProductionRunId: null,
      href: "/biochar-products",
    };
    data.sources = [
      {
        productionRun: {
          id: "run-1",
          code: "PR-1",
          status: "complete",
          date: "2026-05-16",
          biocharStorageName: "Raw biochar bin",
          biocharOutputKg: 600,
          biocharDryMassKg: 588,
          feedstockMassDryKg: 1_200,
          href: "/production-runs",
        },
        reactor: null,
        feedstocks: [],
        allocatedWetMassKg: 510,
        allocatedDryMassKg: 499.8,
      },
      {
        productionRun: {
          id: "run-2",
          code: "PR-2",
          status: "complete",
          date: "2026-05-17",
          biocharStorageName: "Raw biochar bin",
          biocharOutputKg: 400,
          biocharDryMassKg: 392,
          feedstockMassDryKg: 800,
          href: "/production-runs",
        },
        reactor: null,
        feedstocks: [],
        allocatedWetMassKg: 340,
        allocatedDryMassKg: 333.2,
      },
    ];

    const { nodes, edges } = useChainGraph(data);

    expect(
      nodes.filter((node) => node.id.startsWith("production-run:")),
    ).toHaveLength(2);
    expect(
      edges.find(
        (graphEdge) =>
          graphEdge.source === "production-run:run-1" &&
          graphEdge.target === "biochar-product:product-1",
      )?.data?.kgLabel,
    ).toBe("Wet: 510 kg · Dry: 499.8 kg");
    expect(
      edges.find(
        (graphEdge) =>
          graphEdge.source === "production-run:run-2" &&
          graphEdge.target === "biochar-product:product-1",
      )?.data?.kgLabel,
    ).toBe("Wet: 340 kg · Dry: 333.2 kg");
  });

  it("merges commingled slices without multiplying lot mass or understating applied mass", () => {
    const first = lineage();
    first.biocharProduct = {
      id: "product-1",
      code: "BP-1",
      status: "available",
      productionDate: new Date("2026-05-18T00:00:00Z"),
      massKg: 850,
      moistureContentPercent: 2,
      formulationName: null,
      linkedProductionRunId: "run-1",
      href: "/biochar-products",
    };
    first.productionRun = {
      ...first.productionRun!,
      id: "run-1",
      code: "PR-1",
    };
    first.sources = [{
      productionRun: first.productionRun,
      reactor: null,
      feedstocks: [],
      allocatedWetMassKg: 510,
      allocatedDryMassKg: 499.8,
    }];
    first.application.biocharAppliedTons = 0.51;
    first.application.biocharAppliedDryTons = 0.4998;

    const second = lineage();
    second.biocharProduct = {
      ...first.biocharProduct,
      linkedProductionRunId: "run-2",
    };
    second.productionRun = {
      ...second.productionRun!,
      id: "run-2",
      code: "PR-2",
    };
    second.sources = [{
      productionRun: second.productionRun,
      reactor: null,
      feedstocks: [],
      allocatedWetMassKg: 340,
      allocatedDryMassKg: 333.2,
    }];
    second.application.biocharAppliedTons = 0.34;
    second.application.biocharAppliedDryTons = 0.3202;

    const { nodes, edges } = useBatchChainGraph([first, second]);
    const sourceLabels = ["run-1", "run-2"].map((runId) =>
      edges.find(
        (graphEdge) =>
          graphEdge.source === `production-run:${runId}` &&
          graphEdge.target === "biochar-product:product-1",
      )?.data?.kgLabel,
    );
    const sourceWetMasses = sourceLabels.map((label) =>
      Number(String(label).match(/Wet: ([\d.]+)/)?.[1]),
    );

    expect(sourceLabels).toEqual([
      "Wet: 510 kg · Dry: 499.8 kg",
      "Wet: 340 kg · Dry: 333.2 kg",
    ]);
    expect(sourceWetMasses.reduce((sum, mass) => sum + mass, 0)).toBe(850);

    expect(
      nodes.filter((node) => node.id === "application:application-1"),
    ).toHaveLength(1);
    expect(
      nodes.find((node) => node.id === "application:application-1")?.data
        .details,
    ).toContainEqual({
      label: "Biochar applied",
      value: "Wet: 850 kg · Dry: 820 kg",
    });
    expect(
      edges.find(
        (graphEdge) =>
          graphEdge.source === "delivery:delivery-1" &&
          graphEdge.target === "application:application-1",
      )?.data?.kgLabel,
    ).toBe("Wet: 850 kg · Dry: 820 kg");
  });
});

/** Matches the clamp in use-chain-graph.ts; a lane never exceeds it. */
const MAX_ROUTE_OFFSET = 70;

function flowEdge(source: string, target: string): Edge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    data: { variant: "flow", routeOffsetX: null },
  };
}

function offsetOf(graphEdge: Edge): unknown {
  return graphEdge.data?.routeOffsetX;
}

describe("branching edge routes", () => {
  it("gives every edge in a two-run, three-product fan a separate lane", () => {
    const fanEdges: Edge[] = ["run-1", "run-2"].flatMap((runId) =>
      ["product-1", "product-2", "product-3"].map((productId) =>
        flowEdge(runId, productId),
      ),
    );

    assignEdgeRouteOffsets(fanEdges);

    const routeOffsets = fanEdges.map(offsetOf);

    expect(fanEdges).toHaveLength(6);
    expect(routeOffsets.every((offset) => typeof offset === "number")).toBe(true);
    expect(new Set(routeOffsets).size).toBe(6);
  });

  it("keeps a clamped eight-edge fan inside the corridor without collapsing lanes", () => {
    const fanEdges: Edge[] = ["run-1", "run-2"].flatMap((runId) =>
      ["product-1", "product-2", "product-3", "product-4"].map((productId) =>
        flowEdge(runId, productId),
      ),
    );

    assignEdgeRouteOffsets(fanEdges);

    const routeOffsets = fanEdges.map((graphEdge) => offsetOf(graphEdge) as number);

    expect(fanEdges).toHaveLength(8);
    expect(new Set(routeOffsets).size).toBe(8);
    expect(Math.max(...routeOffsets.map(Math.abs))).toBe(MAX_ROUTE_OFFSET);
  });

  it("leaves an ordinary one-to-one hand-off on the default midpoint", () => {
    const edges: Edge[] = [
      flowEdge("run-1", "product-1"),
      flowEdge("product-1", "order-1"),
    ];

    assignEdgeRouteOffsets(edges);

    expect(offsetOf(edges[0]) ?? null).toBeNull();
    expect(offsetOf(edges[1]) ?? null).toBeNull();
  });

  it("ignores equipment edges sharing a source with a flow fan", () => {
    const equipmentEdge: Edge = {
      id: "run-1->reactor-1",
      source: "run-1",
      target: "reactor-1",
      data: { variant: "equipment", routeOffsetX: null },
    };
    const edges: Edge[] = [
      flowEdge("run-1", "product-1"),
      flowEdge("run-1", "product-2"),
      equipmentEdge,
    ];

    assignEdgeRouteOffsets(edges);

    expect(offsetOf(equipmentEdge) ?? null).toBeNull();
    // Two lanes, not three: the equipment edge must not widen the fan.
    expect(edges.slice(0, 2).map(offsetOf)).toEqual([-14, 14]);
  });

  it("orders lanes by the laid-out vertical position, not by edge id", () => {
    const nodeY: Record<string, number> = {
      "run-1": 0,
      "product-a": 300,
      "product-b": 100,
      "product-c": 200,
    };
    const edges: Edge[] = ["product-a", "product-b", "product-c"].map(
      (productId) => flowEdge("run-1", productId),
    );

    assignEdgeRouteOffsets(edges, (nodeId) => nodeY[nodeId] ?? 0);

    // Id order is a, b, c; layout order is b, c, a.
    expect(edges.map(offsetOf)).toEqual([28, -28, 0]);
  });
});
