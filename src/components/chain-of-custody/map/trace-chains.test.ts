import { describe, expect, it } from "vitest";
import { buildChains, chainFor, chainStepLighting, chainSteps, chainTo, stepIndexOf } from "./trace-chains";
import { BATCH_EDGES, BATCH_NODES, FACILITY, FIELD_ONE, SUPPLIER_ONE, SUPPLIER_TWO, batchGeo, batchModel, edge, recordNode } from "./trace-fixtures";
import { buildTraceModel } from "./trace-model";

describe("buildChains", () => {
  it("makes one chain per field, fields in code order", () => {
    const chains = buildChains(batchModel());
    expect(chains.map((chain) => chain.end.id)).toEqual(["application:ap1", "application:ap2"]);
  });

  it("lists every record upstream of the end in chain order", () => {
    const chain = chainTo(batchModel(), "application:ap1")!;
    expect(chain.steps.map((step) => step.shortCode)).toEqual([
      "FS-26-001",
      "FS-26-002",
      "PR-26-001",
      "BP-26-001",
      "DL-26-001",
      "Field A",
    ]);
  });

  it("counts a chain's one-way km with each road once", () => {
    const chain = chainTo(batchModel(), "application:ap1")!;
    // 30 + 60 inbound, 420 outbound once although two product layers carry it.
    expect(chain.distanceKm).toBe(510);
    expect([...chain.legIds].sort()).toEqual(["in-1", "in-2", "out-1", "out-1-layer-2"]);
  });

  it("ends a chain at the delivery when nothing is applied yet", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 5), BATCH_EDGES.slice(0, 4), batchGeo({ legs: batchGeo().legs.slice(0, 2) }));
    const chains = buildChains(model);
    expect(chains.map((chain) => chain.end.id)).toEqual(["delivery:dl1"]);
    expect(chains[0]!.steps).toHaveLength(5);
  });

  it("ends a chain at the bin's product when it has no delivery either", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 4), BATCH_EDGES.slice(0, 3), batchGeo({ legs: batchGeo().legs.slice(0, 2) }));
    expect(buildChains(model).map((chain) => chain.end.id)).toEqual(["biochar-product:bp1"]);
  });

  it("never makes a chain of a lone feedstock", () => {
    const model = buildTraceModel(BATCH_NODES.slice(0, 1), [], batchGeo());
    expect(buildChains(model)).toEqual([]);
  });
});

describe("chainFor", () => {
  it("picks the first chain through a record, fields first", () => {
    const model = batchModel();
    const chain = chainFor(model, buildChains(model), "production-run:pr1")!;
    expect(chain.end.id).toBe("application:ap1");
  });

  it("falls back to a chain that ends at the record", () => {
    const model = batchModel();
    expect(chainFor(model, [], "delivery:dl1")!.end.id).toBe("delivery:dl1");
    expect(chainFor(model, [], "missing:x")).toBeNull();
  });
});

describe("chainSteps", () => {
  it("groups a chain into one step per stage, converging records together", () => {
    const steps = chainSteps(chainTo(batchModel(), "application:ap1")!);
    expect(steps.map((step) => step.kind)).toEqual(["feedstock", "productionRun", "biocharProduct", "delivery", "application"]);
    expect(steps[0]!.title).toBe("2 feedstock intakes");
    expect(steps[0]!.records.map((record) => record.shortCode)).toEqual(["FS-26-001", "FS-26-002"]);
  });

  it("keeps a stage with one record a plain step under its kind label", () => {
    const steps = chainSteps(chainTo(batchModel(), "application:ap1")!);
    expect(steps[1]!.title).toBe("Production run");
    expect(steps[1]!.records).toHaveLength(1);
  });

  it("titles several runs and products with their count and plural", () => {
    const nodes = [...BATCH_NODES, recordNode("productionRun", "production-run:pr2", "PR-26-002"), recordNode("biocharProduct", "biochar-product:bp2", "BP-26-002")];
    const edges = [...BATCH_EDGES, edge("feedstock:fs2", "production-run:pr2"), edge("production-run:pr2", "biochar-product:bp2"), edge("biochar-product:bp2", "delivery:dl1")];
    const model = buildTraceModel(nodes, edges, batchGeo());
    const steps = chainSteps(chainTo(model, "application:ap1")!);
    expect(steps.map((step) => step.title)).toEqual([
      "2 feedstock intakes",
      "2 production runs",
      "2 biochar products",
      "Delivery",
      "Application",
    ]);
  });

  it("finds the step that holds a record", () => {
    const steps = chainSteps(chainTo(batchModel(), "application:ap1")!);
    expect(stepIndexOf(steps, "feedstock:fs2")).toBe(0);
    expect(stepIndexOf(steps, "application:ap1")).toBe(4);
    expect(stepIndexOf(steps, "missing:x")).toBe(-1);
  });
});

describe("chainStepLighting", () => {
  it("keeps the whole chain lit and frames every record of a grouped step", () => {
    const model = batchModel();
    const chain = chainTo(model, "application:ap1")!;
    const intakes = chainStepLighting(model, chain, chainSteps(chain)[0]!);
    expect(intakes.nodeIds!.has("application:ap1")).toBe(true);
    expect(intakes.nodeIds!.has("application:ap2")).toBe(false);
    expect(intakes.legIds).toEqual(chain.legIds);
    expect([...intakes.currentNodeIds].sort()).toEqual(["feedstock:fs1", "feedstock:fs2"]);
    expect(intakes.points).toContainEqual(SUPPLIER_ONE);
    expect(intakes.points).toContainEqual(SUPPLIER_TWO);
  });

  it("frames a step at the facility on the facility", () => {
    const model = batchModel();
    const chain = chainTo(model, "application:ap1")!;
    expect(chainStepLighting(model, chain, chainSteps(chain)[1]!).points).toEqual([FACILITY]);
  });

  it("frames a delivery on the roads it supplied", () => {
    const model = batchModel();
    const chain = chainTo(model, "application:ap1")!;
    const points = chainStepLighting(model, chain, chainSteps(chain)[3]!).points;
    expect(points).toContainEqual(FACILITY);
    expect(points).toContainEqual(FIELD_ONE);
  });

  it("frames a chain with no geolocated records on the facility", () => {
    const model = buildTraceModel(BATCH_NODES, BATCH_EDGES, batchGeo({ nodes: [], legs: [] }));
    const chain = chainTo(model, "application:ap1")!;
    expect(chain.distanceKm).toBe(0);
    expect(chainStepLighting(model, chain, chainSteps(chain)[0]!).points).toEqual([FACILITY]);
  });
});
